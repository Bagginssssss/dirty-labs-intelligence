-- 048: Brand Analytics Repeat Purchase Behavior — Brand + ASIN views (INB-141).
--
-- Amazon's weekly Repeat Purchase Behavior report ships in two views (brand totals + per-ASIN).
-- One shared table holds both, discriminated on `level`. This migration is ADDITIVE except it
-- REPLACES the never-ingested planned placeholder report_key `ba_repeat_purchase` with two active
-- report_keys (verified 0 report_ingestion_log / report_coverage refs before the DELETE). Paired
-- with lib/report-registry.ts (REPORT_REGISTRY_SEED) in the code commit — re-run check:registry.
--
-- Weekly-anchor report (like SQP / customer_loyalty): Reporting Date is the week-ending Saturday,
-- so coverage data_through = the Saturday itself (no partial-week ambiguity). Line 1 of the export
-- is a metadata preamble (Reporting Range=…,Select week=…) stripped by the parser's preprocessContent.
-- Both views are required: brand totals != sum of ASIN rows (unique-customer metrics don't aggregate).
--
-- Metrics map 1:1 to the export columns; Amazon's "Change vs. Prior Period" columns are kept as-is
-- (not recomputed) and can be negative. Text dedup cols are NOT NULL DEFAULT '' so the UNIQUE key
-- is a plain column list (PostgREST onConflict + the INB-88 checker require that; 039 pattern).

CREATE TABLE IF NOT EXISTS public.brand_analytics_repeat_purchase (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                      uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  reporting_date                date NOT NULL,
  level                         text NOT NULL CHECK (level IN ('brand', 'asin')),
  asin                          text NOT NULL DEFAULT '',
  product_title                 text,
  category                      text,
  orders                        numeric,
  unique_customers              numeric,
  repeat_sales                  numeric,
  repeat_sales_change           numeric,
  repeat_sales_share            numeric,
  repeat_units                  numeric,
  repeat_units_change           numeric,
  repeat_units_share            numeric,
  repeat_customers              numeric,
  repeat_customers_change       numeric,
  repeat_customer_share         numeric,
  repeat_customer_share_change  numeric,
  ingested_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_brand_analytics_repeat_purchase UNIQUE (brand_id, reporting_date, level, asin)
);

CREATE INDEX IF NOT EXISTS idx_barp_brand_date
  ON public.brand_analytics_repeat_purchase USING btree (brand_id, reporting_date);

COMMENT ON TABLE public.brand_analytics_repeat_purchase IS
  'BA Repeat Purchase Behavior (INB-141): brand + ASIN views in one table, discriminated on level ('''' asin for brand rows). Weekly-anchor — reporting_date = week-ending Saturday (data_through = the Saturday). Export line 1 is a metadata preamble; Amazon change columns kept as-is (can be negative).';

-- ── report_registry: replace the planned placeholder (idempotent) ─────────────
-- ba_repeat_purchase never ingested (0 log/coverage refs verified). Mirrored in TS.
DELETE FROM public.report_registry WHERE report_key = 'ba_repeat_purchase';

INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('ba_repeat_purchase_brand', 'BA Repeat Purchase — Brand View', 'Brand Analytics', 'weekly', 'Latest week',
   'brand_analytics_repeat_purchase', '{"column":"level","values":["brand"]}', false, true, 3,
   'Weekly BA export (publication lag like Customer Loyalty). Reporting Date = week-ending Saturday. Line 1 of the export is a metadata preamble.'),
  ('ba_repeat_purchase_asin', 'BA Repeat Purchase — ASIN View', 'Brand Analytics', 'weekly', 'Latest week',
   'brand_analytics_repeat_purchase', '{"column":"level","values":["asin"]}', false, true, 4,
   'Weekly BA export (publication lag like Customer Loyalty). Reporting Date = week-ending Saturday. Line 1 of the export is a metadata preamble.')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: add brand_analytics_repeat_purchase (INB-141) ─────────
-- Signature unchanged → CREATE OR REPLACE re-stating the full 047 body with one new Branch-C
-- ELSIF (plain DISTINCT, discriminated on level) before ELSE. Hardening preserved (STABLE,
-- SECURITY INVOKER, locked search_path, service_role-only). CORRECTNESS INVARIANT (verify
-- chat-side after apply): the new branch returns the identical date set as a plain SELECT DISTINCT.
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
  ELSIF p_source_table = 'brand_analytics_repeat_purchase' THEN
    RETURN QUERY SELECT DISTINCT reporting_date FROM public.brand_analytics_repeat_purchase
      WHERE brand_id = p_brand_id
        AND (p_filter_values IS NULL OR level = ANY(p_filter_values))
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
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) TO service_role;
