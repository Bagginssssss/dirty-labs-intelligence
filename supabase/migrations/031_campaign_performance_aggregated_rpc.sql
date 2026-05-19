-- ============================================================
-- 031: RPC for campaign performance aggregation (INB-77 Phase 1)
-- Replaces the 53k-row fetchAll + JS GROUP BY with a single server-side
-- aggregation. Returns one row per (brand, campaign) with summed metrics
-- and the latest status/spend-date computed in SQL.
--
-- Key design notes:
--   - sp_campaign_performance.campaign_id is a UUID FK to campaigns.id
--     (NOT campaigns.campaign_id — that's the Amazon text ID).
--   - data_max_date is carried on every row via CROSS JOIN so JS can
--     compute is_likely_active without a second query.
--   - Derived ratios (roas, acos, cvr, ntb_rate, is_likely_active) are
--     intentionally left to the JS layer to preserve exact parity with
--     the prior implementation.
-- ============================================================

CREATE OR REPLACE FUNCTION get_campaign_performance_aggregated(
  p_brand_id   UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  campaign_uuid     TEXT,
  campaign_name     TEXT,
  ad_type           TEXT,
  targeting_type    TEXT,
  launch_date       TEXT,
  spend             NUMERIC,
  sales             NUMERIC,
  orders            BIGINT,
  clicks            BIGINT,
  impressions       BIGINT,
  ntb_orders        BIGINT,
  current_status    TEXT,
  latest_spend_date DATE,
  data_max_date     DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- Scalar: the most recent report_date in the requested window.
  -- Used by JS to determine is_likely_active without a second round-trip.
  data_max AS (
    SELECT MAX(report_date) AS max_date
    FROM   sp_campaign_performance
    WHERE  brand_id   = p_brand_id
      AND  report_date BETWEEN p_start_date AND p_end_date
  ),
  -- Per-campaign: most recent non-null status (ascending date → DESC = latest first).
  latest_status AS (
    SELECT DISTINCT ON (campaign_id)
      campaign_id,
      status
    FROM   sp_campaign_performance
    WHERE  brand_id   = p_brand_id
      AND  report_date BETWEEN p_start_date AND p_end_date
      AND  status IS NOT NULL
    ORDER  BY campaign_id, report_date DESC
  )
  SELECT
    scp.campaign_id::TEXT                                   AS campaign_uuid,
    c.campaign_name,
    COALESCE(c.ad_type, MIN(scp.ad_type))                  AS ad_type,
    c.targeting_type,
    c.launch_date::TEXT                                     AS launch_date,
    SUM(scp.spend)                                          AS spend,
    SUM(scp.sales_7d)                                       AS sales,
    SUM(scp.orders_7d)                                      AS orders,
    SUM(scp.clicks)                                         AS clicks,
    SUM(scp.impressions)                                    AS impressions,
    COALESCE(SUM(scp.ntb_orders_14d), 0)                   AS ntb_orders,
    CASE
      WHEN ls.status IN ('ENABLED', 'PAUSED') THEN ls.status
      ELSE NULL
    END                                                     AS current_status,
    MAX(CASE WHEN scp.spend > 0 THEN scp.report_date END)  AS latest_spend_date,
    dm.max_date                                             AS data_max_date
  FROM        sp_campaign_performance scp
  JOIN        campaigns    c  ON c.id             = scp.campaign_id
  LEFT JOIN   latest_status ls ON ls.campaign_id  = scp.campaign_id
  CROSS JOIN  data_max      dm
  WHERE  scp.brand_id   = p_brand_id
    AND  scp.report_date BETWEEN p_start_date AND p_end_date
  GROUP BY
    scp.campaign_id,
    c.campaign_name,
    c.ad_type,
    c.targeting_type,
    c.launch_date,
    ls.status,
    dm.max_date
$$;

GRANT EXECUTE ON FUNCTION get_campaign_performance_aggregated(UUID, DATE, DATE)
  TO service_role, authenticated;
