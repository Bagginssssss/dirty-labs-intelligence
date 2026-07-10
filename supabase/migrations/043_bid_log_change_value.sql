-- 043: scale_insights_bid_log change_value column (INB-150).
--
-- The bid-log unique key included nullable numeric columns (bid_before/bid_after,
-- NULL on 7,429 "pause" rows), so overlapping weekly uploads duplicated silently
-- (the defect class the INB-149 checker flagged). Fix mirrors the INB-148 shape:
-- a NULL-proof TEXT change_value replaces the numeric bids in the key, keeping the
-- numeric columns as clean nullable payload (analytics stay correct).
--
-- change_value is a canonical 2-decimal reconstruction of the bid transition
-- ("1.77 -> 2.04"), '' when there is no bid change (pauses). Verified lossless:
-- 0 rows exceed 2 decimal places and 0 rows have exactly one bid NULL.
--
-- Additive only. The NOT NULL + key swap land in migration 044, AFTER the repair
-- (scripts/inb150-repair.sql) backfills change_value and dedupes — a NULL-proof
-- constraint cannot be built over the existing duplicates.

ALTER TABLE public.scale_insights_bid_log
  ADD COLUMN IF NOT EXISTS change_value text;

COMMENT ON COLUMN public.scale_insights_bid_log.change_value IS
  'Canonical bid transition for the natural key (INB-150): "<before> -> <after>" at 2 decimals, '''' when no bid change (pause rows). NOT NULL from migration 044. bid_before/bid_after remain the nullable numeric payload.';
