-- 063: INB-188 — S&S Daily Sales + Reorder/Share: add Buy Again & Save to both discriminators.
--
-- Amazon renamed the Reorder column in both S&S Daily exports and added a third metric column, Buy
-- Again & Save, to each. The mapper now emits buy_again_sales (Sales file) and buy_again_share (Share
-- file) into sns_dashboard_daily; this extends each report's discriminator so coverage sees the new
-- metric. Values are appended (array order is part of the INB-145 mirror check).
--
-- INB-168 pairedDiscriminator: coverage rebuild caps the union of dates at min(max date) per value.
-- buy_again_* starts 2026-10-01 but ends on the same date as its siblings, so the cap is unchanged and
-- pre-October history is NOT truncated. Before the first upload buy_again_* is empty → a rebuild logs
-- WARN and skips (upsert-only, never deletes), so apply/upload order is safe.
--
-- No rows added/removed, is_active untouched → registry stays 57 / 54. Mirrored in
-- lib/report-registry.ts (REPORT_REGISTRY_SEED) in the same commit; re-run `npm run check:registry`.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.report_registry
     SET discriminator = '{"column":"metric","values":["reorder_sales","sns_sales","buy_again_sales"]}'::jsonb
   WHERE report_key = 'sns_dashboard_sales';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'INB-188: expected 1 sns_dashboard_sales row, updated %', n; END IF;

  UPDATE public.report_registry
     SET discriminator = '{"column":"metric","values":["reorder_rate","sns_sales_share","buy_again_share"]}'::jsonb
   WHERE report_key = 'sns_dashboard_reorder_share';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'INB-188: expected 1 sns_dashboard_reorder_share row, updated %', n; END IF;
END $$;
