-- INB-150 data repair — run AFTER migration 043 is applied, BEFORE migration 044.
-- Reviewable script; executed chat-side (not by the agent), as a gated step.
--
-- Backfills change_value + target, then keep-one dedupes so migration 044 can build
-- the NULL-proof unique key. Rows are NOT lossy (the bid mapper read its file); the
-- dupes are re-upload overlaps (content-identical) — keep-one is the right repair.
-- The whole table is archived first (cheap insurance; dropped post-QC on Darren's word).
--
-- ⚠️ STEP 2 GUARDS MUST BOTH BE 0 BEFORE STEP 3. Verified 2026-07-09; re-run at apply
--    time — a Jul backlog upload may have landed since.

-- ── STEP 1 — archive (reversible until dropped post-QC) ───────────────────────
CREATE TABLE public.scale_insights_bid_log_pre150 AS
  SELECT * FROM public.scale_insights_bid_log;

-- ── STEP 2 — guards: canonical must be lossless ───────────────────────────────
-- rows_over_2dp MUST be 0 (else 2-decimal canonical rounds real precision).
-- exactly_one_null MUST be 0 (else '' -on-both-null would drop a one-sided bid).
SELECT
  COUNT(*) FILTER (WHERE (bid_before IS NOT NULL AND bid_before <> round(bid_before,2))
                      OR (bid_after  IS NOT NULL AND bid_after  <> round(bid_after,2))) AS rows_over_2dp,   -- MUST be 0
  COUNT(*) FILTER (WHERE (bid_before IS NULL) <> (bid_after IS NULL))                    AS exactly_one_null  -- MUST be 0
FROM public.scale_insights_bid_log;

-- ── STEP 3 — backfill change_value (canonical) + target '' ────────────────────
-- Both-null → '' (pause); else per-side 2-decimal (encodes a hypothetical one-sided
-- transition losslessly). Mirrors formatBidChange() in the mapper exactly.
UPDATE public.scale_insights_bid_log
SET change_value = CASE
      WHEN bid_before IS NULL AND bid_after IS NULL THEN ''
      ELSE COALESCE(to_char(bid_before, 'FM999999990.00'), '') || ' -> '
        || COALESCE(to_char(bid_after,  'FM999999990.00'), '')
    END,
    target = COALESCE(target, '');

-- ── STEP 4 — keep-one dedupe on the new 7-column key (latest ingest wins) ──────
DELETE FROM public.scale_insights_bid_log s
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY brand_id, campaign_id, ad_group_id, change_timestamp, target, rule_name, change_value
           ORDER BY ingested_at DESC, id DESC
         ) AS rn
  FROM public.scale_insights_bid_log
) d
WHERE s.id = d.id AND d.rn > 1;

-- ── STEP 5 — verification battery (all must hold) ─────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.scale_insights_bid_log
     WHERE target IS NULL OR rule_name IS NULL OR change_value IS NULL
        OR ad_group_id IS NULL OR change_timestamp IS NULL) AS null_in_new_key_cols,   -- 0
  (SELECT COALESCE(SUM(n-1),0) FROM (
     SELECT COUNT(*) n FROM public.scale_insights_bid_log
     GROUP BY brand_id, campaign_id, ad_group_id, change_timestamp, target, rule_name, change_value
     HAVING COUNT(*) > 1) d)                                AS dupes_on_new_key,        -- 0
  (SELECT COUNT(*) FROM public.scale_insights_bid_log_pre150)
    - (SELECT COUNT(*) FROM public.scale_insights_bid_log)  AS rows_removed,            -- ≈2,207
  (SELECT COUNT(*) FROM public.scale_insights_bid_log)      AS post_count;              -- pre − removed
