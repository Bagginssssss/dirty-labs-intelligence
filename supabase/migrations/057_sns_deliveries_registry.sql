-- 057: INB-164 — register the S&S "Sales by Number of Deliveries" snapshot report.
--
-- Reuses the existing sns_dashboard_snapshots table (discriminated on `report`), so this is
-- registry-only: ONE new row, no schema change, no new get_coverage_dates branch (the table
-- already has one). The report stores absolute shipped revenue per delivery-count segment,
-- captured as-of access day (no date column, no backfill).
--
-- Appended at sort_order 10 (after sns_dashboard_retention = 9), so the existing Subscribe & Save
-- group is NOT shifted — the migration is idempotent by construction (ON CONFLICT DO NOTHING; no
-- sort_order shift to guard). Mirrored byte-for-byte in lib/report-registry.ts REPORT_REGISTRY_SEED
-- (same commit) — re-run `npm run check:registry` after apply.
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('sns_dashboard_deliveries',
   'S&S Snapshot — Sales by Number of Deliveries',
   'Subscribe & Save', 'weekly', 'Point-in-time', 'sns_dashboard_snapshots',
   '{"column":"report","values":["deliveries_breakdown"]}'::jsonb,
   true, true, 10,
   'Shipped revenue by delivery-count segment (absolute dollars; the chart shows proportions). Open bucket list — Amazon has widened it before, so labels are stored verbatim. Snapshot as-of access day; no backfill.')
ON CONFLICT (report_key) DO NOTHING;
