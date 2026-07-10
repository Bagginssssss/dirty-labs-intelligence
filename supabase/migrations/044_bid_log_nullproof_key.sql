-- 044: NULL-proof scale_insights_bid_log key on change_value (INB-150).
--
-- Runs AFTER scripts/inb150-repair.sql: change_value + target are backfilled and
-- the table is deduped on the new 7-column key (2,207 rows removed). This migration
-- drops the old constraint, constrains the key columns NOT NULL, and installs the
-- NULL-proof key.
--
-- ORDERING LESSON (INB-150 repair): the old uq_bid_log includes `target`, so
-- normalizing target NULL→'' while it is still live collides a NULL-target row with
-- an existing ''-target twin under the OLD key. Therefore the old constraint is
-- DROPPED FIRST, before any NULL→'' backfill. (The repair already normalized target
-- post-dedupe; the backfill here is a 0-row safety net.)

-- ── 1. Drop the old constraint FIRST (so normalization can't collide with it) ──
ALTER TABLE public.scale_insights_bid_log DROP CONSTRAINT IF EXISTS uq_bid_log;

-- ── 2. NULL-proof the key text columns (defaults + residual backfill + NOT NULL) ──
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN target       SET DEFAULT '';
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN rule_name    SET DEFAULT '';
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN change_value SET DEFAULT '';

UPDATE public.scale_insights_bid_log SET target       = '' WHERE target       IS NULL;
UPDATE public.scale_insights_bid_log SET rule_name    = '' WHERE rule_name    IS NULL;
UPDATE public.scale_insights_bid_log SET change_value = '' WHERE change_value IS NULL;

ALTER TABLE public.scale_insights_bid_log ALTER COLUMN target       SET NOT NULL;
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN rule_name    SET NOT NULL;
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN change_value SET NOT NULL;
-- Always present (route rejects unresolved rows / requires a date); 0 NULLs.
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN ad_group_id      SET NOT NULL;
ALTER TABLE public.scale_insights_bid_log ALTER COLUMN change_timestamp SET NOT NULL;

-- ── 3. Install the NULL-proof key ─────────────────────────────────────────────
-- bid_before/bid_after are intentionally NOT in the key (nullable numeric payload);
-- change_value carries the bid transition in a NULL-proof text form.
ALTER TABLE public.scale_insights_bid_log
  ADD CONSTRAINT uq_bid_log UNIQUE
  (brand_id, campaign_id, ad_group_id, change_timestamp, target, rule_name, change_value);
