-- 050: SKU Economics fee stream — weekly parent + long fee child + internal COGS,
--      one report_registry row, and a new get_coverage_dates branch (INB-162).
--
-- Amazon's SKU Economics report (weekly, MSKU-level, prior Sun–Sat) carries per-SKU sales,
-- every FBA/referral/ads fee as a per-unit/quantity/total TRIPLET, and Amazon's computed
-- Net proceeds — which is PRE-COGS (the COGS/Misc columns ship empty). This migration is
-- ADDITIVE: three new tables, one registry row, one coverage branch. No existing object is
-- altered except get_coverage_dates (CREATE OR REPLACE, signature unchanged). Paired with
-- lib/report-registry.ts (REPORT_REGISTRY_SEED) in the Stage-2 code commit — re-run
-- `npm run check:registry` after that commit.
--
-- Storage shapes (INB-162):
--   sku_economics_weekly — one row per (brand, week_start, marketplace, msku): identity +
--                          sales + Amazon's Net proceeds (pre-COGS).
--   sku_economics_fees   — LONG: one row per (weekly row × fee type). The fee set VARIES
--                          week to week (e.g. monthly storage only in the billed week), so
--                          the loader detects triplets dynamically — nothing fee-specific is
--                          encoded here. Child of the weekly row, mirrored on its natural key;
--                          written by delete-and-reinsert per (week_start, marketplace) so a
--                          corrected file that drops a fee type never leaves orphans.
--   cogs                 — internal effective-dated unit costs, ASIN-primary with a nullable
--                          msku override (channel SKUs like 110124 / 110124-FBA share one ASIN
--                          and thus one product cost).
-- All dedup-key TEXT columns are NOT NULL DEFAULT '' so the UNIQUE key is a plain column list
-- (PostgREST onConflict + the INB-88 checker both require that; NULLABLE_KEY_ALLOWLIST is empty
-- as of INB-151). See migration 039/047 for the pattern.

-- ── sku_economics_weekly ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sku_economics_weekly (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                  uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  week_start                date NOT NULL,
  week_end                  date NOT NULL,
  marketplace               text NOT NULL DEFAULT '',
  parent_asin               text,
  asin                      text,
  fnsku                     text,
  msku                      text NOT NULL DEFAULT '',
  currency                  text,
  avg_sales_price           numeric,
  units_sold                numeric,
  units_returned            numeric,
  net_units_sold            numeric,
  sales                     numeric,
  net_sales                 numeric,
  net_proceeds_total        numeric,
  net_proceeds_per_net_unit numeric,
  ingested_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sku_economics_weekly UNIQUE (brand_id, week_start, marketplace, msku)
);

CREATE INDEX IF NOT EXISTS idx_sku_econ_weekly_brand_week
  ON public.sku_economics_weekly USING btree (brand_id, week_start);

COMMENT ON TABLE public.sku_economics_weekly IS
  'Amazon SKU Economics weekly fee economics (INB-162): one row per (brand, week_start, marketplace, msku). net_proceeds_total is Amazon''s figure and is PRE-COGS — profitability views subtract cogs. Child fee rows live in sku_economics_fees. Coverage grain weekly (week_start = period-start Sunday).';

COMMENT ON COLUMN public.sku_economics_weekly.net_proceeds_total IS
  'Amazon''s Net proceeds = net_sales − Σ(non-component fee totals). PRE-COGS: the report''s Cost of goods sold / Miscellaneous cost columns ship empty, so net profit is derived downstream by subtracting the internal cogs table.';
COMMENT ON COLUMN public.sku_economics_weekly.net_units_sold IS
  'Units sold − units returned. COGS is applied to NET units (returns re-enter inventory).';

-- ── sku_economics_fees ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sku_economics_fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  week_start   date NOT NULL,
  marketplace  text NOT NULL DEFAULT '',
  msku         text NOT NULL DEFAULT '',
  asin         text,
  fee_type     text NOT NULL DEFAULT '',
  per_unit     numeric,
  quantity     numeric,
  total        numeric,
  is_component boolean NOT NULL DEFAULT false,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sku_economics_fees UNIQUE (brand_id, week_start, marketplace, msku, fee_type)
);

CREATE INDEX IF NOT EXISTS idx_sku_econ_fees_brand_week
  ON public.sku_economics_fees USING btree (brand_id, week_start);

COMMENT ON TABLE public.sku_economics_fees IS
  'SKU Economics fee lines in long form (INB-162): one row per (weekly row × fee type). fee_type is the exact Amazon header base minus the triplet suffix (e.g. "Referral fee", "FBA fulfillment fees", "Sponsored Products charge"). COMPONENT ROLLUP: "Base fulfillment fee" + "Fuel and Logistics-related surcharge" (is_component=true) sum to "FBA fulfillment fees" — any fee summation MUST exclude is_component rows to avoid double-counting. Credits (refunds, reimbursements) are stored as negative totals, signs unflipped. Written by delete-and-reinsert per (brand, week_start, marketplace).';

-- ── cogs (internal, effective-dated) ──────────────────────────────────────────
-- ASIN-primary with a nullable-via-'' msku override. Overlapping validity ranges per
-- (brand, asin, msku) are rejected by the exclusion constraint (btree_gist gives the
-- equality operators for the text/uuid columns; daterange && detects overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.cogs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  asin       text NOT NULL,
  msku       text NOT NULL DEFAULT '',
  unit_cost  numeric NOT NULL,
  valid_from date NOT NULL,
  valid_to   date,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cogs_no_overlap EXCLUDE USING gist (
    brand_id WITH =,
    asin     WITH =,
    msku     WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS idx_cogs_brand_asin
  ON public.cogs USING btree (brand_id, asin);

COMMENT ON TABLE public.cogs IS
  'Internal effective-dated unit costs (INB-162). ASIN-primary; msku='''' means the cost applies to every MSKU of the ASIN, a non-'''' msku is a SKU-specific override. valid_to NULL = current. Profitability views join on asin within [valid_from, valid_to), preferring an msku-specific row. Not an Amazon feed — populated from the operator''s COGS sheet.';

-- ── report_registry: 1 new row (idempotent) ──────────────────────────────────
-- Mirrored byte-for-byte in lib/report-registry.ts REPORT_REGISTRY_SEED (Stage-2 commit).
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('sku_economics_weekly', 'SKU Economics (weekly)', 'Business Reports', 'weekly', 'Prior week (Sun–Sat)',
   'sku_economics_weekly', NULL, false, true, 3,
   'MSKU-level fee economics; child fee lines in sku_economics_fees. Date is in the file (Start/End date) so no form dates are required. NOT attribution-affected — no rolling re-pull window.')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: add the sku_economics_weekly branch (INB-162) ─────────
-- Signature unchanged → CREATE OR REPLACE re-stating the full 047 body with one new
-- small-table DISTINCT ELSIF before ELSE. Same hardening as 047: STABLE, SECURITY INVOKER,
-- locked search_path, service_role-only. CORRECTNESS INVARIANT (verify chat-side after
-- apply): the new branch returns the identical date set as a plain SELECT DISTINCT week_start.
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
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) TO service_role;
