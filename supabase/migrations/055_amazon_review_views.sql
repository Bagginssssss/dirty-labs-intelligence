-- 055: Amazon review + rating trend views (INB-160, reviews workstream — the V4 deliverable).
--
-- Two service_role-only read views over the migration-054 tables:
--  * amazon_review_trend  — weekly incoming-review volume + avg rating per ASIN, SUNDAY-anchored on
--    review_date (matching sku_economics_weekly / sku_return_rates week convention).
--  * amazon_rating_trend  — the product-level rating/star-mix trend per ASIN with LAG deltas vs the
--    prior snapshot (the whole point of amazon_rating_snapshots is the trajectory over time).
--
-- CAVEAT (documented): amazon_review_trend buckets by review_date — WHEN the review was written, not
-- when it was pulled. Public pagination caps history at ~10 pages/filter, so early weeks are only as
-- complete as what was publicly reachable at scrape time (see docs/reviews-backfill-runplan.md).

-- ── amazon_review_trend ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.amazon_review_trend AS
SELECT
  r.brand_id,
  -- Sunday anchor: DOW(Sunday)=0, so subtracting DOW snaps any day back to its Sunday.
  (r.review_date - EXTRACT(DOW FROM r.review_date)::int) AS week_start,
  r.asin,
  count(*)                 AS review_count,          -- all reviews written that week
  round(avg(r.rating), 2)  AS avg_incoming_rating    -- avg over rated reviews (NULL ratings ignored)
FROM public.amazon_reviews r
WHERE r.review_date IS NOT NULL
GROUP BY r.brand_id, (r.review_date - EXTRACT(DOW FROM r.review_date)::int), r.asin;

COMMENT ON VIEW public.amazon_review_trend IS
  'INB-160: weekly incoming-review volume + avg rating per ASIN, SUNDAY-anchored on review_date (return_date - DOW convention). review_count = reviews WRITTEN that week (not pulled); avg_incoming_rating averages the rated reviews. Bucketed by review_date, so early weeks are only as complete as Amazon''s ~10-page/filter public history allowed at scrape time.';

-- ── amazon_rating_trend ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.amazon_rating_trend AS
SELECT
  s.brand_id,
  s.asin,
  s.snapshot_date,
  s.product_rating,
  s.count_ratings,
  s.count_reviews,
  s.pct_5_star, s.pct_4_star, s.pct_3_star, s.pct_2_star, s.pct_1_star,
  -- Deltas vs the prior snapshot for this (brand, asin). First snapshot → NULL deltas.
  s.product_rating - lag(s.product_rating) OVER w AS rating_delta,
  s.count_ratings  - lag(s.count_ratings)  OVER w AS count_ratings_delta,
  s.count_reviews  - lag(s.count_reviews)  OVER w AS count_reviews_delta,
  s.pct_5_star - lag(s.pct_5_star) OVER w AS pct_5_star_delta,
  s.pct_4_star - lag(s.pct_4_star) OVER w AS pct_4_star_delta,
  s.pct_3_star - lag(s.pct_3_star) OVER w AS pct_3_star_delta,
  s.pct_2_star - lag(s.pct_2_star) OVER w AS pct_2_star_delta,
  s.pct_1_star - lag(s.pct_1_star) OVER w AS pct_1_star_delta,
  (s.snapshot_date - lag(s.snapshot_date) OVER w) AS days_since_prev
FROM public.amazon_rating_snapshots s
WINDOW w AS (PARTITION BY s.brand_id, s.asin ORDER BY s.snapshot_date);

COMMENT ON VIEW public.amazon_rating_trend IS
  'INB-160: product-level rating/star-mix trend per ASIN from amazon_rating_snapshots (unfiltered runs only), with LAG deltas vs the prior snapshot per (brand, asin). First snapshot per ASIN has NULL deltas. Captures ratings-without-reviews (the majority of stars) — the earliest-warning rating trend.';

-- Derived read-only views — service_role is the platform''s server-side read path (INB-162 convention).
GRANT SELECT ON public.amazon_review_trend TO service_role;
GRANT SELECT ON public.amazon_rating_trend TO service_role;
