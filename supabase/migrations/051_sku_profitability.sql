-- 051: COGS re-key (internal_sku-primary) + profitability views + cogs report registry
--      row and coverage branch (INB-162, Stage 4).
--
-- AMENDMENT to migration 050: Darren's COGS sheet ("Amazon Avg Cost as of July 2026") is keyed
-- by "Internal DL SKU (Primary)", which equals the MSKU BASE (an MSKU is `<sku>` or `<sku>-FBA`).
-- 10 sheet SKUs are pre-launch listings absent from any sold week, so ASIN-keying would fail to
-- resolve them at ingest; internal_sku keying lets their costs activate automatically at launch.
-- cogs is EMPTY, so re-keying is zero-risk. The profitability views join on the MSKU BASE:
--   split_part(sku_economics_weekly.msku, '-', 1) = cogs.internal_sku
-- i.e. the token before the first hyphen. MSKUs are <sku>, <sku>-FBA, and version relistings
-- like <sku>-FBA-v2; every sheet internal_sku is plain numeric (no hyphen), so the leading
-- token IS the internal SKU. (A plain '-FBA$' strip missed 112102-FBA-v2 in the July week.)
-- An msku-exact override row (cogs.msku <> '') is preferred when present.

-- ── cogs: re-key to internal_sku-primary ─────────────────────────────────────
ALTER TABLE public.cogs ADD COLUMN IF NOT EXISTS internal_sku text NOT NULL DEFAULT '';
-- asin becomes derived/optional (the sheet has no ASIN); keep the column, drop its NOT NULL.
ALTER TABLE public.cogs ALTER COLUMN asin DROP NOT NULL;
-- Rebuild the no-overlap exclusion on the new key (brand, internal_sku, msku, validity range).
ALTER TABLE public.cogs DROP CONSTRAINT IF EXISTS cogs_no_overlap;
ALTER TABLE public.cogs ADD CONSTRAINT cogs_no_overlap EXCLUDE USING gist (
  brand_id     WITH =,
  internal_sku WITH =,
  msku         WITH =,
  daterange(valid_from, valid_to, '[)') WITH &&
);
CREATE INDEX IF NOT EXISTS idx_cogs_brand_internal_sku
  ON public.cogs USING btree (brand_id, internal_sku);

COMMENT ON TABLE public.cogs IS
  'Internal effective-dated unit costs (INB-162). internal_sku-PRIMARY: internal_sku = the MSKU base (an MSKU is <sku> or <sku>-FBA; both channels share one product cost). msku='''' is the general cost for every MSKU of that internal_sku; a non-'''' msku is a SKU-specific override. asin is optional/derived (the source sheet has no ASIN). valid_to NULL = current. Profitability views join on split_part(msku,''-'',1)=internal_sku (the MSKU base token before the first hyphen), preferring an msku-exact override. Loaded from the operator''s COGS sheet (SCD-2: close-changed / no-op-unchanged / insert-new).';

-- ── carry-in (a): net_units_sold COGS convention caveat (was an over-stated fact) ──
COMMENT ON COLUMN public.sku_economics_weekly.net_units_sold IS
  'Units sold − units returned. COGS is applied to NET units by CONVENTION (INB-162), which assumes returned units re-enter sellable inventory. Where returns are instead destroyed (liquids often are), this convention slightly FLATTERS profit on high-return SKUs — the destroyed unit''s COGS is never deducted. Revisit if a returns-disposition signal becomes available.';

-- ── sku_profitability_weekly (base view; msku grain) ─────────────────────────
-- total_fees excludes BOTH the two rollup COMPONENTS (is_component) and ads (Sponsored
-- Products charge, surfaced separately as `ads`). net_proceeds_total is Amazon's pre-COGS
-- figure; net_profit subtracts COGS on NET units.
--   cogs_missing means "a cost was NEEDED (net_units_sold <> 0) and not found" — a row with
--   zero net units (e.g. a fee-only reconciliation row: removal/found fees, no sale) needs no
--   cost, so cogs_amount=0, net_profit=net_proceeds_total, cogs_missing=false. This keeps a
--   zero-unit row from poisoning bool_or(cogs_missing) for an ASIN it shares with a costed
--   sales SKU. COGS is NEVER treated as 0 when it IS needed — then net_profit is NULL.
CREATE OR REPLACE VIEW public.sku_profitability_weekly AS
SELECT
  w.brand_id,
  w.week_start,
  w.week_end,
  w.marketplace,
  w.msku,
  w.asin,
  w.parent_asin,
  w.net_sales,
  w.net_units_sold                                        AS units,
  COALESCE(fee.total_fees, 0)                             AS total_fees,
  COALESCE(fee.ads, 0)                                    AS ads,
  w.net_proceeds_total,
  c.unit_cost,
  CASE
    WHEN COALESCE(w.net_units_sold, 0) = 0 THEN 0
    WHEN c.unit_cost IS NOT NULL          THEN round(w.net_units_sold * c.unit_cost, 2)
    ELSE NULL
  END                                                     AS cogs_amount,
  CASE
    WHEN COALESCE(w.net_units_sold, 0) = 0 THEN w.net_proceeds_total
    WHEN c.unit_cost IS NOT NULL          THEN round(w.net_proceeds_total - w.net_units_sold * c.unit_cost, 2)
    ELSE NULL
  END                                                     AS net_profit,
  CASE
    WHEN w.net_sales IS NULL OR w.net_sales = 0 THEN NULL
    WHEN COALESCE(w.net_units_sold, 0) = 0      THEN round(w.net_proceeds_total / w.net_sales, 4)
    WHEN c.unit_cost IS NOT NULL                THEN round((w.net_proceeds_total - w.net_units_sold * c.unit_cost) / w.net_sales, 4)
    ELSE NULL
  END                                                     AS margin_pct,
  (c.unit_cost IS NULL AND COALESCE(w.net_units_sold, 0) <> 0) AS cogs_missing
FROM public.sku_economics_weekly w
LEFT JOIN LATERAL (
  SELECT
    sum(f.total) FILTER (WHERE NOT f.is_component AND f.fee_type <> 'Sponsored Products charge') AS total_fees,
    sum(f.total) FILTER (WHERE f.fee_type = 'Sponsored Products charge')                          AS ads
  FROM public.sku_economics_fees f
  WHERE f.brand_id = w.brand_id AND f.week_start = w.week_start
    AND f.marketplace = w.marketplace AND f.msku = w.msku
) fee ON true
LEFT JOIN LATERAL (
  SELECT c2.unit_cost
  FROM public.cogs c2
  WHERE c2.brand_id = w.brand_id
    AND c2.internal_sku = split_part(w.msku, '-', 1)   -- MSKU base = token before the first hyphen
    AND w.week_start >= c2.valid_from
    AND (c2.valid_to IS NULL OR w.week_start < c2.valid_to)
    AND (c2.msku = '' OR c2.msku = w.msku)          -- general cost or this SKU's override
  ORDER BY (c2.msku = w.msku) DESC, c2.valid_from DESC   -- prefer the msku-exact override, then latest
  LIMIT 1
) c ON true;

COMMENT ON VIEW public.sku_profitability_weekly IS
  'Per (week, marketplace, msku) net profitability (INB-162). net_profit = net_proceeds_total − net_units_sold × unit_cost. cogs_missing = "a cost was NEEDED (net_units_sold<>0) and not found"; a zero-net-unit row (e.g. a fee-only reconciliation line) needs no cost → cogs_amount=0, net_profit=net_proceeds_total, cogs_missing=false, so it never poisons an ASIN rollup it shares with a costed SKU. When a cost IS needed and missing, net_profit is NULL — COGS is never treated as 0. CONVENTIONS: (1) COGS is applied to NET units, which flatters profit on high-return SKUs where returns are destroyed (see sku_economics_weekly.net_units_sold). (2) The monthly/yearly rollups assign each week to the month/year of its week_start (weeks straddling a boundary count wholly in the earlier period).';

-- ── sku_profitability_monthly (msku grain; week assigned to month of week_start) ──
-- COGS-aware rollup: if ANY constituent week lacks a cost, net_profit/cogs_amount/margin are
-- NULL and cogs_missing=true — a partial-COGS month is never reported as if fully costed.
CREATE OR REPLACE VIEW public.sku_profitability_monthly AS
SELECT
  brand_id,
  date_trunc('month', week_start)::date        AS month_start,
  marketplace,
  msku,
  max(asin)                                    AS asin,
  max(parent_asin)                             AS parent_asin,
  sum(net_sales)                               AS net_sales,
  sum(units)                                   AS units,
  sum(total_fees)                              AS total_fees,
  sum(ads)                                     AS ads,
  sum(net_proceeds_total)                      AS net_proceeds_total,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(cogs_amount) END AS cogs_amount,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(net_profit)  END AS net_profit,
  CASE WHEN bool_or(cogs_missing) OR sum(net_sales) = 0 THEN NULL
       ELSE round(sum(net_profit) / sum(net_sales), 4) END           AS margin_pct,
  bool_or(cogs_missing)                        AS cogs_missing
FROM public.sku_profitability_weekly
GROUP BY brand_id, date_trunc('month', week_start), marketplace, msku;

COMMENT ON VIEW public.sku_profitability_monthly IS
  'Monthly rollup of sku_profitability_weekly per (month_start, marketplace, msku). Each week is assigned to the month of its week_start. net_profit/cogs_amount/margin are NULL when ANY week in the month lacks COGS (cogs_missing=true) — partial-COGS months are never reported as fully costed.';

-- ── sku_profitability_yearly (msku grain; week assigned to year of week_start) ──
CREATE OR REPLACE VIEW public.sku_profitability_yearly AS
SELECT
  brand_id,
  date_trunc('year', week_start)::date         AS year_start,
  marketplace,
  msku,
  max(asin)                                    AS asin,
  max(parent_asin)                             AS parent_asin,
  sum(net_sales)                               AS net_sales,
  sum(units)                                   AS units,
  sum(total_fees)                              AS total_fees,
  sum(ads)                                     AS ads,
  sum(net_proceeds_total)                      AS net_proceeds_total,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(cogs_amount) END AS cogs_amount,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(net_profit)  END AS net_profit,
  CASE WHEN bool_or(cogs_missing) OR sum(net_sales) = 0 THEN NULL
       ELSE round(sum(net_profit) / sum(net_sales), 4) END           AS margin_pct,
  bool_or(cogs_missing)                        AS cogs_missing
FROM public.sku_profitability_weekly
GROUP BY brand_id, date_trunc('year', week_start), marketplace, msku;

COMMENT ON VIEW public.sku_profitability_yearly IS
  'Yearly rollup of sku_profitability_weekly per (year_start, marketplace, msku), week assigned to the year of its week_start. net_profit NULL when any week lacks COGS (cogs_missing=true).';

-- ── sku_profitability_weekly_by_asin (asin grain) ────────────────────────────
CREATE OR REPLACE VIEW public.sku_profitability_weekly_by_asin AS
SELECT
  brand_id,
  week_start,
  week_end,
  marketplace,
  asin,
  max(parent_asin)                             AS parent_asin,
  sum(net_sales)                               AS net_sales,
  sum(units)                                   AS units,
  sum(total_fees)                              AS total_fees,
  sum(ads)                                     AS ads,
  sum(net_proceeds_total)                      AS net_proceeds_total,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(cogs_amount) END AS cogs_amount,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(net_profit)  END AS net_profit,
  CASE WHEN bool_or(cogs_missing) OR sum(net_sales) = 0 THEN NULL
       ELSE round(sum(net_profit) / sum(net_sales), 4) END           AS margin_pct,
  bool_or(cogs_missing)                        AS cogs_missing
FROM public.sku_profitability_weekly
GROUP BY brand_id, week_start, week_end, marketplace, asin;

COMMENT ON VIEW public.sku_profitability_weekly_by_asin IS
  'ASIN-level weekly rollup of sku_profitability_weekly (channel MSKUs of one ASIN combined). net_profit NULL when any constituent MSKU-week lacks COGS.';

-- ── sku_profitability_weekly_by_parent_asin (parent-asin grain) ──────────────
CREATE OR REPLACE VIEW public.sku_profitability_weekly_by_parent_asin AS
SELECT
  brand_id,
  week_start,
  week_end,
  marketplace,
  parent_asin,
  sum(net_sales)                               AS net_sales,
  sum(units)                                   AS units,
  sum(total_fees)                              AS total_fees,
  sum(ads)                                     AS ads,
  sum(net_proceeds_total)                      AS net_proceeds_total,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(cogs_amount) END AS cogs_amount,
  CASE WHEN bool_or(cogs_missing) THEN NULL ELSE sum(net_profit)  END AS net_profit,
  CASE WHEN bool_or(cogs_missing) OR sum(net_sales) = 0 THEN NULL
       ELSE round(sum(net_profit) / sum(net_sales), 4) END           AS margin_pct,
  bool_or(cogs_missing)                        AS cogs_missing
FROM public.sku_profitability_weekly
GROUP BY brand_id, week_start, week_end, marketplace, parent_asin;

COMMENT ON VIEW public.sku_profitability_weekly_by_parent_asin IS
  'Parent-ASIN-level weekly rollup of sku_profitability_weekly. net_profit NULL when any constituent MSKU-week lacks COGS.';

-- Derived read-only views — service_role is the platform''s server-side read path
-- (dashboards render server-side; chat layer is server-side). COGS is sensitive, so no anon grant.
GRANT SELECT ON public.sku_profitability_weekly                 TO service_role;
GRANT SELECT ON public.sku_profitability_monthly                TO service_role;
GRANT SELECT ON public.sku_profitability_yearly                 TO service_role;
GRANT SELECT ON public.sku_profitability_weekly_by_asin         TO service_role;
GRANT SELECT ON public.sku_profitability_weekly_by_parent_asin  TO service_role;

-- ── report_registry: cogs loader row (idempotent) ───────────────────────────
-- Mirrored in lib/report-registry.ts REPORT_REGISTRY_SEED (Stage-4 code commit).
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('cogs', 'COGS (Unit Costs)', 'Business Reports', 'ad_hoc', 'On cost change', 'cogs',
   NULL, true, true, 4,
   'Internal effective-dated unit costs from the operator''s COGS sheet (CSV). Single effective date supplied on the upload form (valid_from). SCD-2 re-upload: close changed rows, no-op unchanged, insert new. Not an Amazon feed; ad-hoc cadence (no overdue expectation).')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: cogs branch (effective dates) ────────────────────────
-- Signature unchanged → CREATE OR REPLACE restating the full 050 body + one new ELSIF.
CREATE OR REPLACE FUNCTION public.get_coverage_dates(
  p_brand_id uuid,
  p_source_table text,
  p_filter_values text[] DEFAULT NULL
)
RETURNS TABLE (d date)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- ── Big ad tables: loose index scan over (brand_id, ad_type, report_date) ──
  IF p_source_table = 'sp_campaign_performance' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_campaign_performance s
        WHERE s.brand_id = p_brand_id
          AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
        ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_campaign_performance s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
                 AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'sp_search_term_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_search_term_report s
        WHERE s.brand_id = p_brand_id
          AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
        ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_search_term_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
                 AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'sp_targeting_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_targeting_report s
        WHERE s.brand_id = p_brand_id
          AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
        ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_targeting_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
                 AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'purchased_product_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.purchased_product_report s
        WHERE s.brand_id = p_brand_id
          AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
        ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.purchased_product_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
                 AND (p_filter_values IS NULL OR s.ad_type = ANY(p_filter_values))
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;

  -- ── bid log: loose scan over (brand_id, change_timestamp), collapse to date ──
  ELSIF p_source_table = 'scale_insights_bid_log' THEN
    RETURN QUERY
    WITH RECURSIVE ts AS (
      (SELECT s.change_timestamp AS nt FROM public.scale_insights_bid_log s
        WHERE s.brand_id = p_brand_id ORDER BY s.change_timestamp LIMIT 1)
      UNION ALL
      SELECT (SELECT s.change_timestamp FROM public.scale_insights_bid_log s
               WHERE s.brand_id = p_brand_id AND s.change_timestamp > ts.nt
               ORDER BY s.change_timestamp LIMIT 1)
      FROM ts WHERE ts.nt IS NOT NULL
    )
    SELECT DISTINCT (ts.nt)::date FROM ts WHERE ts.nt IS NOT NULL ORDER BY 1;

  -- ── Small tables (<=37K rows): plain DISTINCT, discriminator applied ─────────
  ELSIF p_source_table = 'business_report' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.business_report
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'business_report_daily' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.business_report_daily
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'search_query_performance' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.search_query_performance
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'subscribe_and_save' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.subscribe_and_save
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'brand_analytics_customer_loyalty' THEN
    RETURN QUERY SELECT DISTINCT period_end_date FROM public.brand_analytics_customer_loyalty
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR granularity = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'scale_insights_keyword_rank' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.scale_insights_keyword_rank
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR asin_id::text = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'scale_insights_rule_change_log' THEN
    RETURN QUERY SELECT DISTINCT created_date FROM public.scale_insights_rule_change_log
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR log_type = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'scale_insights_rule_assignments' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.scale_insights_rule_assignments
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'smartscout_subcategory_brands' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.smartscout_subcategory_brands
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR subcategory = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'smartscout_subcategory_products' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.smartscout_subcategory_products
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR subcategory = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'virtual_bundle_sales_daily' THEN
    RETURN QUERY SELECT DISTINCT sale_date FROM public.virtual_bundle_sales_daily
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'virtual_bundle_sales_snapshots' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.virtual_bundle_sales_snapshots
      WHERE brand_id = p_brand_id ORDER BY 1;

  -- ── S&S Dashboard (INB-144): daily discriminated on metric, snapshots on report ──
  ELSIF p_source_table = 'sns_dashboard_daily' THEN
    RETURN QUERY SELECT DISTINCT metric_date FROM public.sns_dashboard_daily
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR metric = ANY(p_filter_values))
      ORDER BY 1;
  ELSIF p_source_table = 'sns_dashboard_snapshots' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.sns_dashboard_snapshots
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR report = ANY(p_filter_values))
      ORDER BY 1;

  -- ── SKU Economics (INB-162): weekly parent, one week_start per covered week ──
  ELSIF p_source_table = 'sku_economics_weekly' THEN
    RETURN QUERY SELECT DISTINCT week_start FROM public.sku_economics_weekly
      WHERE brand_id = p_brand_id ORDER BY 1;

  -- ── COGS (INB-162): effective dates (open + closed) of the internal cost table ──
  ELSIF p_source_table = 'cogs' THEN
    RETURN QUERY SELECT DISTINCT valid_from FROM public.cogs
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) TO service_role;
