-- 054: Amazon Reviews + Rating Snapshots — the deferred VOC half (INB-160, reviews workstream).
--
-- Adds the two Axesso-sourced Customer Voice tables (Inputs 1 & 2). The Axesso actor exports a
-- flat JSON array (one item per review, product/page metadata repeated on every item), so the
-- loader is a bespoke JSON handler (route sniffs JSON → handleReviewsUpload), NOT the CSV pipeline
-- — mirrors the COGS early-return precedent. One upload feeds BOTH tables (like SKU Economics:
-- parent + fee child). Additive: two tables, two registry rows (Customer Voice section already
-- exists from 052), two get_coverage_dates branches. The trend VIEWS land in migration 055 (V4).
--
-- Schema-lock facts (INB-160 comment "Axesso reviews sample profiled", 2026-07-30; 10-item
-- unfiltered export B09B7WLWW3 + 65-item 5-star-filtered export B0CCCBQ7ZM):
--  * Reviews are SHARED across a parent listing's child ASINs — scraping several children of one
--    parent returns the SAME reviewId under each queried ASIN. Upsert on (brand_id, review_id)
--    collapses those correctly; store the queried `asin` (last-write) AND `variation_id` (the
--    variant the reviewer actually bought — the more meaningful attribution).
--  * date "Reviewed in <country> on <US-month-name date>" → review_country + review_date.
--    rating "N.N out of 5 stars" → numeric(2,1). imageUrlList/videoUrlList → counts. variationList
--    → jsonb. profilePath + run metadata dropped.
--  * Rating snapshots come free from the SAME items (countRatings, countReviews, productRating,
--    reviewSummary star %). BUT countReviews is FILTER-DEPENDENT (INB-160 "Pagination/permutation
--    test result") — snapshots are written ONLY from UNFILTERED items (per-item filterByStar
--    absent). snapshot_date = the run date (upload form date_range_start, else the ingest date).
-- All dedup-key text columns are NOT NULL DEFAULT '' (INB-149 ratchet; allowlist stays empty).

-- ── amazon_reviews ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.amazon_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  review_id      text NOT NULL DEFAULT '',   -- Amazon "R..." id; unique + stable; dedup key
  asin           text,                        -- queried child ASIN (last-write on cross-child overlap)
  variation_id   text,                        -- the variant the reviewer bought (variationId)
  rating         numeric(2,1),
  title          text,
  body           text,
  review_date    date,
  review_country text,
  user_name      text,
  verified       boolean,
  vine           boolean,
  helpful_votes  integer,
  image_count    integer,
  video_count    integer,
  variation_list jsonb,                        -- ["Scent: …","Size: …"] — variant-level VoC slicing
  source_run     text,                         -- upload filename (Apify run export provenance)
  scraped_at     timestamptz,                  -- ingest run marker (pull cadence; drives coverage)
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_amazon_reviews UNIQUE (brand_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_reviews_brand_asin_date
  ON public.amazon_reviews USING btree (brand_id, asin, review_date);

COMMENT ON TABLE public.amazon_reviews IS
  'Amazon reviews via the Axesso Apify actor (INB-160). One row per review, upsert on (brand_id, review_id): reviews are shared across a parent listing''s child ASINs, so the same reviewId returns under each queried ASIN — review_id alone dedupes (asin is last-write; variation_id is the variant actually bought). rating parsed from "N.N out of 5 stars"; review_date/review_country from "Reviewed in <country> on <date>"; image_count/video_count from the URL-list lengths; variation_list stored as jsonb. scraped_at is the ingest run marker (pull-cadence coverage), not a review field. Raw text kept at ingest; sentiment/taxonomy enrichment is a downstream ticket.';

-- ── amazon_rating_snapshots ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.amazon_rating_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  snapshot_date  date NOT NULL,               -- run date (form date_range_start, else ingest date)
  asin           text NOT NULL DEFAULT '',
  product_rating numeric(2,1),
  count_ratings  integer,                      -- filter-stable (all star ratings, incl. text-less)
  count_reviews  integer,                      -- FILTER-DEPENDENT → only written from unfiltered runs
  pct_5_star     integer,                      -- reviewSummary star percentages (0–100)
  pct_4_star     integer,
  pct_3_star     integer,
  pct_2_star     integer,
  pct_1_star     integer,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_amazon_rating_snapshots UNIQUE (brand_id, asin, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_amazon_rating_snapshots_brand_asin_date
  ON public.amazon_rating_snapshots USING btree (brand_id, asin, snapshot_date);

COMMENT ON TABLE public.amazon_rating_snapshots IS
  'Product-level rating snapshots (INB-160), extracted from the SAME Axesso run items that feed amazon_reviews — one row per (ASIN, run). Append/upsert on (brand_id, asin, snapshot_date); re-uploading a run is idempotent. Captures ratings-without-reviews (the majority of stars, invisible to review text) → earliest-warning rating trend per ASIN. WRITTEN ONLY FROM UNFILTERED RUNS: countReviews is filter-dependent (returns the filtered count under a star filter), while countRatings and productRating are filter-stable — the loader detects unfiltered per-item (filterByStar absent) and skips snapshots for filtered items.';

-- ── report_registry: two Customer Voice rows (the section CHECK already includes ──
--    'Customer Voice' from migration 052). Mirrored byte-for-byte in
--    lib/report-registry.ts REPORT_REGISTRY_SEED at the V2 code commit.
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('amazon_reviews', 'Amazon Reviews', 'Customer Voice', 'monthly', 'Monthly unfiltered + ad-hoc backfill',
   'amazon_reviews', NULL, false, true, 2,
   'Axesso Apify actor JSON export (manual weekly/monthly upload). Upsert on (brand_id, review_id) — reviews are shared across a parent''s child ASINs; ad-hoc pulls are idempotent. requires_period_dates=false: reviews carry their own review_date; the form date only sets rating-snapshot snapshot_date (defaults to ingest date).'),
  ('amazon_rating_snapshots', 'Amazon Rating Snapshots', 'Customer Voice', 'monthly', 'Monthly unfiltered runs only',
   'amazon_rating_snapshots', NULL, false, true, 3,
   'Product-level rating/star-mix snapshots, extracted from the same unfiltered Axesso run that feeds amazon_reviews (countReviews is filter-dependent, so star-filtered backfill runs write NO snapshots). Separate tile: snapshot freshness diverges from reviews freshness. snapshot_date = run date (form date_range_start, else ingest date).')
ON CONFLICT (report_key) DO NOTHING;

-- ── get_coverage_dates: add the two Customer Voice review branches (INB-160) ──────
-- Signature unchanged → CREATE OR REPLACE restating the full 052 body + two new small-table
-- DISTINCT ELSIF branches before ELSE. (053 was a view; it did not touch this function, so 052 is
-- the current body.) Same hardening as 052 (STABLE, SECURITY INVOKER, locked search_path,
-- service_role-only). All 23 restated branches are byte-identical to 052.
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

  -- ── Amazon Reviews (INB-160): pull cadence tracked by scraped_at (run marker),
  --    NOT review_date (which spans the full public review history) ──────────────
  ELSIF p_source_table = 'amazon_reviews' THEN
    RETURN QUERY SELECT DISTINCT scraped_at::date FROM public.amazon_reviews
      WHERE brand_id = p_brand_id AND scraped_at IS NOT NULL ORDER BY 1;

  -- ── Amazon Rating Snapshots (INB-160): distinct run snapshot dates ───────────
  ELSIF p_source_table = 'amazon_rating_snapshots' THEN
    RETURN QUERY SELECT DISTINCT snapshot_date FROM public.amazon_rating_snapshots
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
