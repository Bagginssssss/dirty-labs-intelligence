-- 056: INB-165 — SI Keyword Rank registry corrections.
--  6. B09MSP7M5Y is a Laundry Booster (per asins.title), not Liquid Laundry — fix its display_name.
--  7. Seed the previously-unregistered B09B7Z4GPZ (the real Liquid Laundry, Scent Free) at sort_order
--     2, adjacent to B09B7YS1VK (=1); shift the rest of the ScaleInsights group +1 to open the slot.
-- Registry-only (no fact-table writes). Mirrored byte-for-byte in lib/report-registry.ts (same commit).
-- Idempotent: re-running is a no-op (the shift is guarded on the seed not yet existing).

-- 6. Correct the mislabeled display_name.
UPDATE public.report_registry
SET display_name = 'SI Keyword Rank — B09MSP7M5Y (Laundry Booster, Scent Free)'
WHERE report_key = 'si_rank_b09msp7m5y';

-- 7a. Open sort_order 2 in the ScaleInsights group (b09b7ys1vk stays 1; 2..11 → 3..12).
--     Guarded on the seed NOT already existing, so a re-run does not shift again / leave a gap at 3.
UPDATE public.report_registry
SET sort_order = sort_order + 1
WHERE source_group = 'ScaleInsights' AND sort_order >= 2
  AND NOT EXISTS (
    SELECT 1 FROM public.report_registry WHERE report_key = 'si_rank_b09b7z4gpz'
  );

-- 7b. Seed the previously-unregistered tracked ASIN (713 rows already in the fact table).
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('si_rank_b09b7z4gpz',
   'SI Keyword Rank — B09B7Z4GPZ (Liquid Laundry, Scent Free)',
   'ScaleInsights', 'weekly', 'Latest export', 'scale_insights_keyword_rank',
   '{"column": "asin_id", "values": ["5a9e0865-0e0a-4ff1-994b-70a7cc0a382b"], "asin": "B09B7Z4GPZ"}'::jsonb,
   false, true, 2,
   'Scent Free Bio-Liquid Laundry Detergent. Ingested since 2026-07-11 (713 rows, 23 keywords) but was unregistered → report_key resolved NULL and coverage was skipped; seeded + coverage-backfilled in INB-165.')
ON CONFLICT (report_key) DO NOTHING;
