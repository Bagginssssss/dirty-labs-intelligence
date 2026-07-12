-- 046: report_coverage.data_through (INB-147).
--
-- report_coverage marks a period "present" on any-day presence, so a partially-pulled
-- week (e.g. daily Ads data through Sun 2026-07-05, one day into W/E 2026-07-11) counted
-- as covered and the command-center tile read CURRENT though the week wasn't fully
-- pulled. data_through records the MAX source date that falls inside each period, so the
-- tile can require the expected week to be fully pulled (data_through ≥ its Saturday)
-- before it reads current; a short week falls to due/overdue by the existing grace.
--
-- Maintained by both the backfill (scripts/inb146-backfill.mjs) and post-upload
-- maintenance (lib/coverage/maintain.ts). Additive; not part of the unique key
-- (report_key, period_start), so the INB-88/149 checkers are unaffected. NULL only
-- transiently until the idempotent backfill re-run repopulates every row (report_coverage
-- is rebuild-safe by design).

ALTER TABLE public.report_coverage
  ADD COLUMN IF NOT EXISTS data_through date;

COMMENT ON COLUMN public.report_coverage.data_through IS
  'Max source date within the period (INB-147). A fully-pulled weekly period has data_through = its Saturday; a partial one is short. Drives the command center''s partial-week status. Maintained by the backfill + upsertCoverageForUpload.';
