-- INB-31 long-term: add launch_date to campaigns so the dashboard can read
-- campaign launch dates with a single ~352-row read instead of aggregating
-- 49K+ rows from sp_campaign_performance on every render.
--
-- Apply this migration BEFORE deploying the matching application code changes.
-- The mapper-side maintenance (route.ts) keeps launch_date current for all
-- future ingests. The UPDATE below backfills all existing campaigns from
-- sp_campaign_performance in one shot.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS launch_date date;

CREATE INDEX IF NOT EXISTS idx_campaigns_launch_date
  ON campaigns(launch_date);

-- One-time backfill: set launch_date = earliest report_date from performance data.
-- Idempotent: skips any campaign where launch_date is already correct or earlier.
-- sp_campaign_performance.campaign_id is a UUID FK to campaigns.id.
UPDATE campaigns c
SET launch_date = sub.first_seen
FROM (
  SELECT campaign_id, MIN(report_date) AS first_seen
  FROM sp_campaign_performance
  GROUP BY campaign_id
) sub
WHERE c.id = sub.campaign_id
  AND (c.launch_date IS NULL OR c.launch_date > sub.first_seen);
