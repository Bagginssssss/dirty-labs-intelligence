-- 038: backfill campaigns.targeting_type from sp_campaign_performance (INB-36).
--
-- campaigns.targeting_type (column since 001) was never populated: 0/430 at
-- reconcile time, while sp_campaign_performance.targeting_type carries
-- 'Automatic targeting' / 'Manual targeting' on 62,894/70,734 rows (NULLs are
-- SB/SBV rows, which have no SP targeting type).
--
-- Reconcile-verified (2026-07-08, live):
--   * Single-valued per campaign — ZERO campaigns have rows with BOTH non-null
--     values, so MAX() per campaign is a deterministic pick, not a tiebreak.
--   * 319 campaigns gain a value; the 111 left NULL are 90 SB/SBV-named +
--     21 with no typed perf rows — legitimately unknown, intentionally NULL.
--
-- Idempotent: the IS DISTINCT FROM guard makes re-runs update 0 rows.
-- Ongoing maintenance is code-side (resolveCampaignId fill-if-null, commit 2);
-- this migration only heals rows ingested before that code existed.

UPDATE public.campaigns c
SET targeting_type = t.ttype
FROM (
  SELECT campaign_id, MAX(targeting_type) AS ttype
  FROM public.sp_campaign_performance
  WHERE targeting_type IS NOT NULL
  GROUP BY campaign_id
) t
WHERE c.id = t.campaign_id
  AND c.targeting_type IS DISTINCT FROM t.ttype;
