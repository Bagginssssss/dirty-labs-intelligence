-- 037: make tracker date-coverage growth-proof (INB-139, follow-up to 036).
--
-- Measured: the 036 RPC's plain SELECT DISTINCT on sp_targeting_report ran as a
-- 6.2s parallel index-only scan over the fat 6-column unique index (448K wide
-- entries, 38K heap fetches) — against the 8s statement_timeout the PostgREST
-- login role (authenticator) imposes on ALL app queries, service_role included.
--
-- Fix, two parts:
--   1. Narrow composite (brand_id, report_date) btree indexes on the 4 growing
--      ad-report tables. Plain CREATE INDEX (not CONCURRENTLY — migrations run
--      in a transaction); ~seconds of write lock per table at current volume,
--      applied in a quiet window.
--   2. CREATE OR REPLACE get_report_date_coverage: the 4 big-table branches
--      become recursive-CTE loose index scans (PG17 has no native skip scan) —
--      one index probe per distinct date, O(distinct × log n): milliseconds
--      today and at 100× growth. Small tables keep plain DISTINCT.
--
-- CORRECTNESS INVARIANT: each skip-scan MUST return the identical date set as
-- SELECT DISTINCT <date_column> ... on the same branch. SQL-level, so it is
-- verified against the live DB after apply (skip-scan output compared to a
-- direct SELECT DISTINCT for all 4 branches), not in the node test suite.
--
-- Same hardening as 036: SECURITY INVOKER, SET search_path = '', fully-qualified
-- references, static SQL only (no EXECUTE), service_role-only EXECUTE grant.

CREATE INDEX IF NOT EXISTS idx_sp_tr_brand_date
  ON public.sp_targeting_report USING btree (brand_id, report_date);
CREATE INDEX IF NOT EXISTS idx_sp_str_brand_date
  ON public.sp_search_term_report USING btree (brand_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ppr_brand_date
  ON public.purchased_product_report USING btree (brand_id, report_date);
CREATE INDEX IF NOT EXISTS idx_sp_cp_brand_date
  ON public.sp_campaign_performance USING btree (brand_id, report_date);

CREATE OR REPLACE FUNCTION public.get_report_date_coverage(
  p_brand_id uuid,
  p_source_table text,
  p_ad_types text[] DEFAULT NULL
)
RETURNS TABLE (d date)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- ── Big, growing tables: recursive-CTE loose index scan over the new
  --    (brand_id, report_date) composite — one probe per distinct date. ──────
  IF p_source_table = 'sp_campaign_performance' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_campaign_performance s
        WHERE s.brand_id = p_brand_id
          AND (p_ad_types IS NULL OR s.ad_type = ANY(p_ad_types))
        ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_campaign_performance s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
                 AND (p_ad_types IS NULL OR s.ad_type = ANY(p_ad_types))
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'sp_search_term_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_search_term_report s
        WHERE s.brand_id = p_brand_id ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_search_term_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'sp_targeting_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.sp_targeting_report s
        WHERE s.brand_id = p_brand_id ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.sp_targeting_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;
  ELSIF p_source_table = 'purchased_product_report' THEN
    RETURN QUERY
    WITH RECURSIVE dates AS (
      (SELECT s.report_date AS nd FROM public.purchased_product_report s
        WHERE s.brand_id = p_brand_id ORDER BY s.report_date LIMIT 1)
      UNION ALL
      SELECT (SELECT s.report_date FROM public.purchased_product_report s
               WHERE s.brand_id = p_brand_id AND s.report_date > dates.nd
               ORDER BY s.report_date LIMIT 1)
      FROM dates WHERE dates.nd IS NOT NULL
    )
    SELECT dates.nd FROM dates WHERE dates.nd IS NOT NULL;

  -- ── Small tables: plain DISTINCT (unchanged from 036). ────────────────────
  ELSIF p_source_table = 'business_report' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.business_report
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'business_report_daily' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.business_report_daily
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'search_query_performance' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.search_query_performance
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'brand_analytics_customer_loyalty' THEN
    RETURN QUERY SELECT DISTINCT period_end_date FROM public.brand_analytics_customer_loyalty
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'scale_insights_keyword_rank' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.scale_insights_keyword_rank
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'smartscout_subcategory_brands' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.smartscout_subcategory_brands
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'smartscout_subcategory_products' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.smartscout_subcategory_products
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSE
    RAISE EXCEPTION 'get_report_date_coverage: unknown source table %', p_source_table;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_report_date_coverage(uuid, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_report_date_coverage(uuid, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_report_date_coverage(uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_report_date_coverage(uuid, text, text[]) TO service_role;
