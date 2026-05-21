-- ============================================================
-- 033: RPC for search query gaps aggregation (INB-77 Phase 2.2)
-- Replaces fetchAll + JS GROUP BY in getSearchQueryGaps.
-- Returns one row per search_query with averaged volume and share signals.
--
-- Key design notes — ratio column handling:
--   - search_query_volume: AVG() is correct — JS uses SUM/COUNT(non-null),
--     which SQL AVG() replicates exactly (both skip NULLs in denominator).
--   - purchases_brand_share, impressions_brand_share, clicks_brand_share:
--     use SUM(col)/COUNT(*) NOT AVG(). The JS denominator is total row count
--     including rows where the share column is NULL; SQL AVG() would use only
--     non-null count in the denominator and produce different results.
--   - purchases_total, purchases_brand: SUM() — both are counts, always additive.
--
-- Pre-aggregation filter:
--   p_brand_share_threshold filters raw rows before GROUP BY (matching JS
--   behavior: only low-share periods contribute to the aggregate). Default 0.1
--   matches the JS default so callers passing no argument get identical results.
--
-- Post-aggregation (minVolume >= 500, purchases > 0 → null, sort) stays in JS.
-- ============================================================

CREATE OR REPLACE FUNCTION get_search_query_gaps_aggregated(
  p_brand_id              UUID,
  p_start_date            DATE,
  p_end_date              DATE,
  p_brand_share_threshold NUMERIC DEFAULT 0.1
)
RETURNS TABLE (
  search_query            TEXT,
  search_query_volume     NUMERIC,
  purchases_total         NUMERIC,
  purchases_brand         NUMERIC,
  purchases_brand_share   NUMERIC,
  impressions_brand_share NUMERIC,
  clicks_brand_share      NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    search_query,
    AVG(search_query_volume)                    AS search_query_volume,
    SUM(purchases_total)                        AS purchases_total,
    SUM(purchases_brand)                        AS purchases_brand,
    SUM(purchases_brand_share)  / COUNT(*)      AS purchases_brand_share,
    SUM(impressions_brand_share) / COUNT(*)     AS impressions_brand_share,
    SUM(clicks_brand_share)     / COUNT(*)      AS clicks_brand_share
  FROM  search_query_performance
  WHERE brand_id              = p_brand_id
    AND report_date           BETWEEN p_start_date AND p_end_date
    AND purchases_brand_share < p_brand_share_threshold
  GROUP BY search_query
$$;

GRANT EXECUTE ON FUNCTION get_search_query_gaps_aggregated(UUID, DATE, DATE, NUMERIC)
  TO service_role, authenticated;
