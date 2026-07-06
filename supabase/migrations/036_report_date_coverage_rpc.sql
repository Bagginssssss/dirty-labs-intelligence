-- 036: distinct-date coverage RPC for the upload tracker (INB-139). Replaces a
-- per-report-type fetchAll of every source row (448K rows → statement timeout)
-- with one server-side SELECT DISTINCT per table (448K rows → ~127 dates).
--
-- SECURITY INVOKER + locked search_path + STATIC SQL ONLY: the table argument is
-- resolved through an IF-ladder whitelist of static queries — no EXECUTE, no
-- dynamic SQL (per the 034 security bar). Unknown table → exception.
-- p_ad_types applies only to sp_campaign_performance (the registry's ad_type
-- slices); other branches ignore it.

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
  IF p_source_table = 'sp_campaign_performance' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.sp_campaign_performance
      WHERE brand_id = p_brand_id
        AND (p_ad_types IS NULL OR ad_type = ANY(p_ad_types))
      ORDER BY 1;
  ELSIF p_source_table = 'sp_search_term_report' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.sp_search_term_report
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'sp_targeting_report' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.sp_targeting_report
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'purchased_product_report' THEN
    RETURN QUERY SELECT DISTINCT report_date FROM public.purchased_product_report
      WHERE brand_id = p_brand_id ORDER BY 1;
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
