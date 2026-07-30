-- 052: FBA Customer Returns — returns table + reason→fault map + Customer Voice section
--      registry row + coverage branch (INB-160, FBA Customer Returns workstream).
--
-- The Seller Central FBA Customer Returns report (whole catalog, full history in one weekly
-- pull) is the pullable CX feed and the basis for an NCX (negative-customer-experience) proxy:
-- product-fault return rate per SKU (migration 053). Additive: two tables, one registry row +
-- widened source_group CHECK, one get_coverage_dates branch. Reviews tables (amazon_reviews,
-- amazon_rating_snapshots) are DEFERRED to a later session (migrations 054+).
--
-- Sample-locked facts (644673020664.csv, 14,749 rows, 2025-01-02 → 2026-07-26):
--  * Encoding is Windows-1252 (smart quotes 0x92) — the loader's decode has a cp1252 fallback.
--  * NO natural unique key: license-plate-number is blank on 524 rows; identical rows are genuine
--    multi-unit returns (one per unit). The key is (brand_id, return_ts, order_id, sku, lpn,
--    occurrence) where occurrence = 1-based row-number within an identical-row group, computed at
--    map time. Return history is immutable, so overlapping weekly pulls regenerate identical
--    occurrences → idempotent upsert.
--  * return-date is an ISO-8601 timestamptz → store return_ts + a derived return_date (date) for
--    weekly aggregation. quantity is always 1 in the sample but stored.
-- All dedup-key text columns are NOT NULL DEFAULT '' (INB-149 ratchet; allowlist empty).

-- ── fba_customer_returns ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fba_customer_returns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  return_ts             timestamptz NOT NULL,
  return_date           date NOT NULL,
  order_id              text NOT NULL DEFAULT '',
  sku                   text NOT NULL DEFAULT '',
  asin                  text,
  fnsku                 text,
  product_name          text,
  quantity              integer,
  fulfillment_center_id text,
  detailed_disposition  text,
  reason                text,
  status                text,
  lpn                   text NOT NULL DEFAULT '',   -- license-plate-number ('' when blank)
  occurrence            integer NOT NULL,           -- 1-based within an identical-row group (map time)
  fault_class           text,
  customer_comments     text,
  ingested_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fba_customer_returns UNIQUE (brand_id, return_ts, order_id, sku, lpn, occurrence)
);

CREATE INDEX IF NOT EXISTS idx_fba_returns_brand_date
  ON public.fba_customer_returns USING btree (brand_id, return_date);
CREATE INDEX IF NOT EXISTS idx_fba_returns_brand_sku_date
  ON public.fba_customer_returns USING btree (brand_id, sku, return_date);

COMMENT ON TABLE public.fba_customer_returns IS
  'Amazon FBA Customer Returns (INB-160): one row per returned unit. No natural key — unique on (brand_id, return_ts, order_id, sku, lpn, occurrence); occurrence disambiguates identical multi-unit rows. return_ts is the ISO-8601 timestamp; return_date is derived for weekly aggregation. customer_comments are free-text VOC verbatims stored raw (Windows-1252 decoded). SKUs are <internal>-FBA MSKUs — use split_part(sku,''-'',1) for COGS/economics cross-joins.';
COMMENT ON COLUMN public.fba_customer_returns.fault_class IS
  'Ingest-time SNAPSHOT of return_reason_map.fault_class for this row''s reason (''unmapped'' if the code was unknown at ingest). The AUTHORITATIVE bucket is the LIVE join to return_reason_map (see the sku_return_rates view) — re-bucketing a code updates the view immediately; this stored value only refreshes on re-upload. Kept for fast direct row filtering.';

-- ── return_reason_map (reference + seed; editable source of truth) ────────────
CREATE TABLE IF NOT EXISTS public.return_reason_map (
  reason_code text PRIMARY KEY,
  fault_class text NOT NULL CHECK (fault_class IN ('product_fault','logistics_fault','customer_choice','fraud')),
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.return_reason_map IS
  'Maps Amazon return reason codes to fault buckets (INB-160). Source of truth for fba_customer_returns.fault_class and the authoritative live join in the sku_return_rates view. Seeded from the 22-code census; mirrored in lib/return-reason-map.ts (the loader computes the ingest-time snapshot + warns on unmapped codes). Editable: re-bucketing here updates the view instantly.';

-- Seed the 22 observed codes. Buckets: product_fault / logistics_fault / customer_choice / fraud.
-- SWITCHEROO → fraud (buyer swap says nothing about product quality; 693 units would distort the
-- fault rate). UNDELIVERABLE_REFUSED / NO_REASON_GIVEN / NOT_COMPATIBLE → customer_choice.
INSERT INTO public.return_reason_map (reason_code, fault_class, notes) VALUES
  ('DEFECTIVE',                 'product_fault',   'Item defective / does not work'),
  ('NOT_AS_DESCRIBED',          'product_fault',   'Item differs from the listing'),
  ('QUALITY_UNACCEPTABLE',      'product_fault',   'Quality below expectation'),
  ('MISSING_PARTS',             'product_fault',   'Incomplete product'),
  ('DAMAGED_BY_FC',             'logistics_fault', 'Damaged in the fulfillment center'),
  ('DAMAGED_BY_CARRIER',        'logistics_fault', 'Damaged in transit by the carrier'),
  ('MISSED_ESTIMATED_DELIVERY', 'logistics_fault', 'Arrived late'),
  ('NEVER_ARRIVED',             'logistics_fault', 'Package never delivered'),
  ('UNDELIVERABLE_UNKNOWN',     'logistics_fault', 'Could not be delivered (unknown)'),
  ('UNWANTED_ITEM',             'customer_choice', 'No longer wanted'),
  ('ORDERED_WRONG_ITEM',        'customer_choice', 'Customer ordered the wrong item'),
  ('FOUND_BETTER_PRICE',        'customer_choice', 'Found a better price elsewhere'),
  ('NO_REASON_GIVEN',           'customer_choice', 'No reason provided — treated as no-fault'),
  ('NOT_COMPATIBLE',            'customer_choice', 'Customer judged it not compatible'),
  ('UNDELIVERABLE_REFUSED',     'customer_choice', 'Delivery refused by the customer'),
  ('APPAREL_TOO_SMALL',         'customer_choice', 'Fit — too small'),
  ('APPAREL_TOO_LARGE',         'customer_choice', 'Fit — too large'),
  ('POOR_FIT',                  'customer_choice', 'Fit — poor'),
  ('MISORDERED',                'customer_choice', 'Customer mis-ordered'),
  ('EXTRA_ITEM',                'customer_choice', 'Ordered too many'),
  ('UNAUTHORIZED_PURCHASE',     'fraud',           'Unauthorized purchase / chargeback territory'),
  ('SWITCHEROO',                'fraud',           'Buyer-swap abuse — not a product-quality signal')
ON CONFLICT (reason_code) DO NOTHING;

-- ── report_registry: new 'Customer Voice' section + fba_customer_returns row ──
-- Widen the source_group CHECK (reviews/rating tiles will join this section later).
ALTER TABLE public.report_registry DROP CONSTRAINT report_registry_source_group_check;
ALTER TABLE public.report_registry ADD  CONSTRAINT report_registry_source_group_check
  CHECK (source_group IN ('Sponsored Ads', 'Brand Analytics', 'Business Reports', 'Subscribe & Save',
                          'Virtual Bundles', 'SmartScout', 'ScaleInsights', 'Customer Voice'));

-- Mirrored byte-for-byte in lib/report-registry.ts REPORT_REGISTRY_SEED (Gate-R2 code commit).
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('fba_customer_returns', 'FBA Customer Returns', 'Customer Voice', 'weekly', 'Full history / weekly top-up',
   'fba_customer_returns', NULL, false, true, 1,
   'Seller Central Customer Returns flat file (Windows-1252). Full history in one pull; weekly top-up overlaps and is idempotent via the occurrence key. Date is in the file. Basis for the sku_return_rates NCX proxy.')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: add the fba_customer_returns branch (INB-160) ─────────
-- Signature unchanged → CREATE OR REPLACE restating the full 051 body + one new small-table
-- DISTINCT ELSIF before ELSE. Same hardening as 051 (STABLE, SECURITY INVOKER, locked
-- search_path, service_role-only). The 21 restated branches are byte-identical to 051.
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

  -- ── FBA Customer Returns (INB-160): distinct return dates ────────────────────
  ELSIF p_source_table = 'fba_customer_returns' THEN
    RETURN QUERY SELECT DISTINCT return_date FROM public.fba_customer_returns
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
