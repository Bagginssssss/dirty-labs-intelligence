-- 047: Subscribe & Save Dashboard exports — daily long table + snapshot table,
--      8 report_registry rows, and two new get_coverage_dates branches (INB-144).
--
-- The Seller Central S&S Dashboard exposes 5 DAILY exports (one row per day, keyed on
-- calc_date_granularity) and 3 SNAPSHOT exports (trailing-window aggregates, no date in
-- the file — captured as-of access day). This migration is ADDITIVE: two new tables,
-- eight registry rows, and two ELSIF branches folded into the coverage RPC. No existing
-- object is altered. Paired with lib/report-registry.ts (REPORT_REGISTRY_SEED) in the
-- code commit — re-run `npm run check:registry` after apply.
--
-- Storage shapes (INB-144):
--   sns_dashboard_daily      — LONG: one row per (metric_date, metric). Each daily file
--                              carries two value columns (CY + LY); the mapper unpivots
--                              them into distinct metric rows, so five files never contend
--                              over one wide row. 5 report_keys share this table,
--                              discriminated on `metric`.
--   sns_dashboard_snapshots  — one shared table; 3 report_keys discriminated on `report`.
--                              Trailing-window aggregates, so snapshot mode / no backfill.
-- Both tables: all dedup-key columns NOT NULL from birth (INB-149 ratchet); text dims are
-- NOT NULL DEFAULT '' so the UNIQUE key is a plain column list (PostgREST onConflict +
-- the INB-88 checker both require that). See migration 039 for the pattern.

-- ── sns_dashboard_daily ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sns_dashboard_daily (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  metric_date  date NOT NULL,
  metric       text NOT NULL,
  value        numeric,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sns_dashboard_daily UNIQUE (brand_id, metric_date, metric)
);

CREATE INDEX IF NOT EXISTS idx_sns_daily_brand_date
  ON public.sns_dashboard_daily USING btree (brand_id, metric_date);

COMMENT ON TABLE public.sns_dashboard_daily IS
  'S&S Dashboard daily metrics in long form (INB-144): one row per (brand, metric_date, metric slug). Five daily exports share this table; each file unpivots its CY + LY columns into distinct metric rows. Coverage grain weekly.';

-- ── sns_dashboard_snapshots ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sns_dashboard_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  report        text NOT NULL,
  dim1          text NOT NULL DEFAULT '',
  dim2          text NOT NULL DEFAULT '',
  value         numeric,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sns_dashboard_snapshots UNIQUE (brand_id, snapshot_date, report, dim1, dim2)
);

CREATE INDEX IF NOT EXISTS idx_sns_snap_brand_date
  ON public.sns_dashboard_snapshots USING btree (brand_id, snapshot_date);

COMMENT ON TABLE public.sns_dashboard_snapshots IS
  'S&S Dashboard trailing-window snapshots (INB-144): one row per (brand, snapshot_date, report, dim1, dim2). Three exports (subscriber_ltv, avg_reorders, subscriber_retention) share this table, discriminated on `report`. Snapshot mode — captured as-of access day, no backfill possible.';

-- ── report_registry: 8 new rows (idempotent) ─────────────────────────────────
-- Mirrored byte-for-byte in lib/report-registry.ts REPORT_REGISTRY_SEED.
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  -- ── S&S Dashboard dailies (weekly grain, date in the file → no form dates) ──
  ('sns_dashboard_sales', 'S&S Daily — Sales (Reorder vs S&S)', 'Subscribe & Save', 'weekly', 'Last 30 days',
   'sns_dashboard_daily', '{"column":"metric","values":["reorder_sales","sns_sales"]}', false, true, 2, NULL),
  ('sns_dashboard_reorder_share', 'S&S Daily — Reorder & S&S Share', 'Subscribe & Save', 'weekly', 'Last 30 days',
   'sns_dashboard_daily', '{"column":"metric","values":["reorder_rate","sns_sales_share"]}', false, true, 3, NULL),
  ('sns_dashboard_subscription_count', 'S&S Daily — Subscription Count', 'Subscribe & Save', 'weekly', 'Last 30 days',
   'sns_dashboard_daily', '{"column":"metric","values":["active_subscriptions","active_subscriptions_ly"]}', false, true, 4, NULL),
  ('sns_dashboard_coupon_sales', 'S&S Daily — Coupon Sales Share', 'Subscribe & Save', 'weekly', 'Last 30 days',
   'sns_dashboard_daily', '{"column":"metric","values":["coupon_sales_share","coupon_sales_share_ly"]}', false, true, 5, NULL),
  ('sns_dashboard_coupon_subs', 'S&S Daily — Coupon Subs Share', 'Subscribe & Save', 'weekly', 'Last 30 days',
   'sns_dashboard_daily', '{"column":"metric","values":["coupon_subs_share","coupon_subs_share_ly"]}', false, true, 6, NULL),

  -- ── S&S Dashboard snapshots (trailing windows; date supplied on the upload form) ──
  ('sns_dashboard_ltv', 'S&S Snapshot — Subscriber LTV by Segment', 'Subscribe & Save', 'weekly', 'Point-in-time',
   'sns_dashboard_snapshots', '{"column":"report","values":["subscriber_ltv"]}', true, true, 7,
   'Trailing 24-month avg GMS by segment x purchase type; values as-of capture date. No backfill — history starts at first capture.'),
  ('sns_dashboard_avg_reorders', 'S&S Snapshot — Avg Reorders (Sub vs Non)', 'Subscribe & Save', 'weekly', 'Point-in-time',
   'sns_dashboard_snapshots', '{"column":"report","values":["avg_reorders"]}', true, true, 8,
   'Trailing 12 months; values as-of capture date. No backfill — history starts at first capture.'),
  ('sns_dashboard_retention', 'S&S Snapshot — Subscriber Retention', 'Subscribe & Save', 'weekly', 'Point-in-time',
   'sns_dashboard_snapshots', '{"column":"report","values":["subscriber_retention"]}', true, true, 9,
   'Trailing window undocumented (likely 12mo, unverified); values as-of capture date. No backfill — history starts at first capture.')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: add the two new tables (INB-144) ──────────────────────
-- Signature unchanged → CREATE OR REPLACE re-stating the full 045 body with two new
-- Branch-C ELSIFs before ELSE (small tables, plain DISTINCT with discriminator). Same
-- hardening as 045: STABLE, SECURITY INVOKER, locked search_path, service_role-only.
-- CORRECTNESS INVARIANT (verify chat-side after apply, like 045/037): each loose-scan
-- branch returns the identical date set as a plain SELECT DISTINCT on the same filter.
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
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) TO service_role;
