-- 045: report_coverage table + bounded coverage-dates RPC (INB-146).
--
-- Coverage = for each true report (report_registry.report_key), which PERIODS have
-- data. History can't be read from report_ingestion_log (pre-INB-145 rows have NULL
-- report_key; shared-table uploads are ambiguous), so coverage is DERIVED from the
-- data tables via each registry row's discriminator, bucketed by cadence. The
-- one-time backfill (scripts/inb146-backfill.mjs) and the post-upload maintenance in
-- /api/ingest both write here; INB-147's tiles read ONLY this table (never source).
--
-- This migration is ADDITIVE: a new table, its RPC, and two sets of indexes. No
-- existing object is altered.
--
-- ── report_coverage ─────────────────────────────────────────────────────────
-- All key columns NOT NULL from birth — this table is born under the INB-149
-- nullable-key ratchet and must NEVER appear on NULLABLE_KEY_ALLOWLIST. The unique
-- key is (report_key, period_start): a report never holds two periods with the same
-- start (SQP's monthly-era ends 2026-04 and its weekly-era starts 2026-05, so their
-- period_starts never collide; business_report is monthly-grain only).
--   period_type  — grain of THIS record: 'weekly' | 'monthly' | 'snapshot'.
--   event_driven — true for the rule change logs + bid log (rows only on days rules
--                  fired). The UI renders their between-week gaps as normal, not as
--                  missing data.
--   source       — 'derived' (backfill) | 'upload' (post-upload maintenance).

CREATE TABLE IF NOT EXISTS public.report_coverage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key    text NOT NULL REFERENCES public.report_registry(report_key),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  period_label  text NOT NULL,
  period_type   text NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'snapshot')),
  event_driven  boolean NOT NULL DEFAULT false,
  source        text NOT NULL DEFAULT 'derived' CHECK (source IN ('derived', 'upload')),
  row_count     integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_coverage UNIQUE (report_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_report_coverage_report_key
  ON public.report_coverage USING btree (report_key);

COMMENT ON TABLE public.report_coverage IS
  'Derived period coverage per report_registry.report_key (INB-146). Backfilled from source tables + maintained post-upload; read-only source for INB-147 tiles. Rebuildable via TRUNCATE + scripts/inb146-backfill.mjs.';

-- ── Indexes for the bounded distinct-date reads ─────────────────────────────
-- The 4 ad tables are always read with an ad_type filter; a plain filtered DISTINCT
-- seq-scans (~2.9s at 142K rows, measured) because ad_type isn't indexed. The
-- (brand_id, ad_type, report_date) composite makes the loose index scan below
-- index-only (one probe per distinct date). bid_log's whole-table DISTINCT of 233K
-- rows measured 4.1s — a (brand_id, change_timestamp) index enables its loose scan.
CREATE INDEX IF NOT EXISTS idx_sp_cp_brand_adtype_date
  ON public.sp_campaign_performance USING btree (brand_id, ad_type, report_date);
CREATE INDEX IF NOT EXISTS idx_sp_str_brand_adtype_date
  ON public.sp_search_term_report USING btree (brand_id, ad_type, report_date);
CREATE INDEX IF NOT EXISTS idx_sp_tr_brand_adtype_date
  ON public.sp_targeting_report USING btree (brand_id, ad_type, report_date);
CREATE INDEX IF NOT EXISTS idx_ppr_brand_adtype_date
  ON public.purchased_product_report USING btree (brand_id, ad_type, report_date);
CREATE INDEX IF NOT EXISTS idx_sibl_brand_changets
  ON public.scale_insights_bid_log USING btree (brand_id, change_timestamp);

-- ── get_coverage_dates ──────────────────────────────────────────────────────
-- Distinct period-column dates for a report, optionally sliced by its discriminator
-- values (ad_type / granularity / log_type / subcategory / asin_id). Same security
-- bar as 034/036/037: STABLE, SECURITY INVOKER, locked search_path, STATIC SQL ONLY
-- (whitelist IF-ladder over the 17 active target tables — no EXECUTE / dynamic SQL),
-- service_role-only EXECUTE. Each branch hardcodes its date column + discriminator
-- column; p_filter_values NULL = whole table. Big ad tables + bid_log use recursive
-- loose index scans (PG17 has no native skip scan); the rest (all <=37K rows) use
-- plain DISTINCT. Returns TABLE (d date); change_timestamp is cast to date.
--
-- CORRECTNESS INVARIANT (verified chat-side after apply, like 037): each loose-scan
-- branch returns the identical date set as a plain SELECT DISTINCT on the same
-- filter.
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
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_coverage_dates(uuid, text, text[]) TO service_role;
