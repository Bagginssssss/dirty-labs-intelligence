-- 058: INB-169 — add the missing brand_analytics_repeat_purchase branch to get_coverage_dates.
--
-- get_coverage_dates is the coverage REBUILD source (scripts/inb146-backfill.mjs + inb166-window-
-- coverage.mjs). brand_analytics_repeat_purchase was the ONLY active target_table without a branch,
-- so a rebuild of ba_repeat_purchase_asin / _brand hit the ELSE and RAISEd 'unknown source table' —
-- a rebuild-path FAIL, even though both reports are correctly covered by the post-upload path.
--
-- This body is a VERBATIM copy of the live function (captured via pg_get_functiondef against prod),
-- with exactly ONE addition: the brand_analytics_repeat_purchase ELSIF (returns DISTINCT reporting_date,
-- discriminated by `level` — brand vs asin — the same two registry rows' discriminator). No other branch
-- is altered; a before/after pg_get_functiondef diff confirms the only delta is this branch (INB-169 G2).
CREATE OR REPLACE FUNCTION public.get_coverage_dates(p_brand_id uuid, p_source_table text, p_filter_values text[] DEFAULT NULL::text[])
 RETURNS TABLE(d date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
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
  -- INB-169: the added branch. Discriminated on `level` (brand vs asin), period column reporting_date.
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
  ELSIF p_source_table = 'sku_economics_weekly' THEN
    RETURN QUERY SELECT DISTINCT week_start FROM public.sku_economics_weekly
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'cogs' THEN
    RETURN QUERY SELECT DISTINCT valid_from FROM public.cogs
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'fba_customer_returns' THEN
    RETURN QUERY SELECT DISTINCT return_date FROM public.fba_customer_returns
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSIF p_source_table = 'amazon_reviews' THEN
    RETURN QUERY SELECT DISTINCT scraped_at::date FROM public.amazon_reviews
      WHERE brand_id = p_brand_id AND scraped_at IS NOT NULL ORDER BY 1;
  ELSIF p_source_table = 'amazon_rating_snapshots' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.amazon_rating_snapshots
      WHERE brand_id = p_brand_id ORDER BY 1;
  ELSE
    RAISE EXCEPTION 'get_coverage_dates: unknown source table %', p_source_table;
  END IF;
END;
$function$;
