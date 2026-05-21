-- ============================================================
-- 032: RPC for search term report aggregation (INB-77 Phase 2.1)
-- Replaces the ~150k-row fetchAll + JS GROUP BY with a single server-side
-- aggregation. Returns one row per (customer_search_term, campaign_id).
--
-- Key design notes:
--   - sp_search_term_report.campaign_id is a UUID FK to campaigns.id
--     (NOT campaigns.campaign_id — the Amazon text ID).
--   - NULL customer_search_term is coerced to '' to match JS aggregation
--     key: `${term}::${campaign_id}` where term = row.customer_search_term ?? ''.
--   - match_type: JS captured the match_type of the highest-spend row per
--     (term, campaign) group (first-row-wins from ORDER BY spend DESC).
--     SQL uses MIN(match_type) — deterministic, semantically equivalent for
--     downstream consumers (display-only grouping label).
--   - Derived ratios (roas, acos, cvr) left to JS post-processing.
-- ============================================================

CREATE OR REPLACE FUNCTION get_search_term_report_aggregated(
  p_brand_id   UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  search_term   TEXT,
  campaign_uuid TEXT,
  campaign_name TEXT,
  match_type    TEXT,
  ad_type       TEXT,
  spend         NUMERIC,
  sales         NUMERIC,
  orders        BIGINT,
  clicks        BIGINT,
  impressions   BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(s.customer_search_term, '')           AS search_term,
    s.campaign_id::TEXT                            AS campaign_uuid,
    c.campaign_name,
    MIN(s.match_type)                              AS match_type,
    COALESCE(c.ad_type, MIN(s.ad_type))            AS ad_type,
    SUM(s.spend)                                   AS spend,
    SUM(s.sales_7d)                                AS sales,
    SUM(s.orders_7d)                               AS orders,
    SUM(s.clicks)                                  AS clicks,
    SUM(s.impressions)                             AS impressions
  FROM  sp_search_term_report s
  JOIN  campaigns c ON c.id = s.campaign_id
  WHERE s.brand_id   = p_brand_id
    AND s.report_date BETWEEN p_start_date AND p_end_date
  GROUP BY
    COALESCE(s.customer_search_term, ''),
    s.campaign_id,
    c.campaign_name,
    c.ad_type
$$;

GRANT EXECUTE ON FUNCTION get_search_term_report_aggregated(UUID, DATE, DATE)
  TO service_role, authenticated;
