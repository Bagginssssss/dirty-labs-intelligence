-- 061: INB-175 — explicit RETIRED marker for report_registry (retired ≠ planned).
--
-- is_active=false currently conflates "not yet built" (ba_top_search_terms, amc_query_results —
-- genuinely planned) with "retired by the source" (sns_dashboard_coupon_sales — Amazon removed
-- "Coupon Sales Share" from the S&S dashboard). deriveStatus maps !is_active → 'planned', so the
-- retired report rendered under PLANNED. Add an EXPLICIT marker so the command center can tell them
-- apart. retired_at carries a THIRD, non-redundant fact — distinct from report_coverage.data_through
-- (2026-08-09, the last day Amazon published data) and from is_active (not an expected upload):
--   retired_at = the date the report was FIRST OBSERVED UNAVAILABLE from the source (the weekly run
--   where it was found gone), NOT the last-data date. Do NOT populate it with a last-data date.
--
-- Adds a column + sets one value + drops the interim display-name label — NO rows added/removed and
-- is_active is untouched, so the registry counts stay 57 / 54 / 19. Mirrored in
-- lib/report-registry.ts (REPORT_REGISTRY_SEED) in the same commit; re-run `npm run check:registry`.
ALTER TABLE public.report_registry ADD COLUMN IF NOT EXISTS retired_at date;
COMMENT ON COLUMN public.report_registry.retired_at IS
  'Date the report was first observed unavailable from the source (the run where it was found gone), NOT the last-data date (that is report_coverage.data_through). NULL = not retired. A non-null value means RETIRED (removed by the source), distinct from PLANNED (is_active=false AND retired_at NULL = not yet built).';

-- retired_at set ⇒ the report cannot also be an expected upload (retired implies inactive).
DO $$ BEGIN
  ALTER TABLE public.report_registry
    ADD CONSTRAINT report_registry_retired_implies_inactive
    CHECK (retired_at IS NULL OR is_active = false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mark the platform's first retired report; drop the interim "(RETIRED — …)" display-name label now
-- that the state carries it. 2026-08-17 = the weekly run where Coupon Sales Share was first found
-- missing (last data 2026-08-09 lives in report_coverage.data_through).
UPDATE public.report_registry
   SET retired_at = '2026-08-17',
       display_name = 'S&S Daily — Coupon Sales Share'
 WHERE report_key = 'sns_dashboard_coupon_sales';
