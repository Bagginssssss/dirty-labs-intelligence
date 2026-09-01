-- 059: INB-173 — S&S dashboard reshuffle: deprecate Coupon Sales Share, register 4 new reports,
--      and disambiguate two look-alike snapshot display names.
--
-- (1) DEPRECATE sns_dashboard_coupon_sales — "Coupon Sales Share" is gone from the Seller Central
--     dashboard (last data 2026-08-09). Set is_active=false ONLY: the registry row, its 85
--     report_coverage periods, and its 1,170 fact rows (coupon_sales_share + _ly) are PRESERVED —
--     history stays valid + queryable. Deactivation removes it from the ACTIVE upload group (no strip,
--     not counted in due/overdue); NOTE it renders in the command-center PLANNED section (deriveStatus
--     maps !is_active → 'planned'; the query has no is_active filter) — flagged in INB-173 as a
--     follow-up (retired ≠ planned). sns_dashboard_coupon_subs is NOT affected (uploaded clean 08-31).
--
-- (2) REGISTER 4 new reports. Coupon Driven Sales (daily) + 3 snapshots appended at sort_order 11-14
--     (after sns_dashboard_deliveries=10) so the existing Subscribe & Save group is NOT shifted —
--     idempotent by construction (ON CONFLICT DO NOTHING; no sort_order shift to guard). No schema
--     change: NEW 1 reuses sns_dashboard_daily (discriminated on metric), NEW 2-4 reuse
--     sns_dashboard_snapshots (discriminated on report).
--
-- (3) DISAMBIGUATE display names for two look-alike pairs (INB-165 hazard — a card whose name
--     describes a different product caused a wrong export download). Make the segmentation axis
--     visible on both cards of each pair.
--
-- Mirrored byte-for-byte in lib/report-registry.ts REPORT_REGISTRY_SEED (same commit): the
-- coupon_sales is_active flip, the two display_name UPDATEs, AND the 4 inserts.
-- Re-run `npm run check:registry` after apply.

-- (1) Deprecate Coupon Sales Share (idempotent — a re-run sets the same flag).
--     is_active=false alone routes it to the command-center PLANNED section (deriveStatus maps
--     !is_active → 'planned'), alongside genuinely not-yet-built reports — misleading for the platform's
--     first RETIRED report. Cheap mitigation, zero code: mark RETIRED in the display name so the PLANNED
--     tile reads correctly. The proper fix (an explicit retired marker vs inferring retired-from-planned)
--     is a schema change tracked as a separate follow-up ticket — NOT folded in here.
UPDATE public.report_registry
   SET is_active = false
 WHERE report_key = 'sns_dashboard_coupon_sales';
UPDATE public.report_registry
   SET display_name = 'S&S Daily — Coupon Sales Share (RETIRED — Amazon removed 2026-08)'
 WHERE report_key = 'sns_dashboard_coupon_sales';

-- (3) Disambiguate the two look-alike snapshot pairs (idempotent — fixed target strings).
--     Subscriber LTV (customer-lifecycle segments) vs the new Customer LTV (purchase-behavior segments).
UPDATE public.report_registry
   SET display_name = 'S&S Snapshot — Subscriber LTV (Established / Growing / Lost)'
 WHERE report_key = 'sns_dashboard_ltv';
--     S&S-only deliveries (6 buckets, incl. Cancelled) vs the new all-sales deliveries (5 buckets).
UPDATE public.report_registry
   SET display_name = 'S&S Snapshot — Sales by Deliveries (S&S subs, 6 buckets)'
 WHERE report_key = 'sns_dashboard_deliveries';

-- (2) Register the 4 new reports.
INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  ('sns_dashboard_coupon_driven',
   'S&S Daily — Coupon Driven Sales',
   'Subscribe & Save', 'weekly', 'Last 30 days', 'sns_dashboard_daily',
   '{"column":"metric","values":["coupon_sales_sns","coupon_sales_reorder","coupon_sales_standard"]}'::jsonb,
   false, true, 11,
   'Coupon-driven sales dollars by coupon type (S&S / Reorder / Standard). Reorder + Standard are 0 on every row (confirmed across 3 weekly pulls) — the mapper STILL writes their rows so the INB-168 paired-discriminator coverage intersects to a real cap date instead of NULL. Replaces the deprecated Coupon Sales Share.'),
  ('sns_dashboard_customer_ltv',
   'S&S Snapshot — Customer LTV (One-Time / Reorder / Subscriber)',
   'Subscribe & Save', 'weekly', 'Point-in-time', 'sns_dashboard_snapshots',
   '{"column":"report","values":["customer_ltv_by_segment"]}'::jsonb,
   true, true, 12,
   'Average GMS by customer segment (One Time Customer / Reorder Customer / Subscriber). Distinct from sns_dashboard_ltv (Subscriber LTV = calc_customer_segment x purchase_type, lifecycle segments). Open segment list — labels stored verbatim. Snapshot as-of access day; no backfill.'),
  ('sns_dashboard_customer_share',
   'S&S Snapshot — Customer Share (One-Time / Reorder / Subscriber)',
   'Subscribe & Save', 'weekly', 'Point-in-time', 'sns_dashboard_snapshots',
   '{"column":"report","values":["customer_share_by_segment"]}'::jsonb,
   true, true, 13,
   'Customer-count share by segment (One Time Customer / Reorder Customer / Subscriber; fractions summing to ~1.0). Open segment list — labels stored verbatim. Snapshot as-of access day; no backfill.'),
  ('sns_dashboard_total_deliveries',
   'S&S Snapshot — Sales by Deliveries (all sales, 5 buckets)',
   'Subscribe & Save', 'weekly', 'Point-in-time', 'sns_dashboard_snapshots',
   '{"column":"report","values":["total_deliveries_breakdown"]}'::jsonb,
   true, true, 14,
   'Total shipped revenue by delivery-count bucket (1 delivery .. 5+ deliveries; all sales, not S&S-only). Distinct from sns_dashboard_deliveries (S&S-only, 6 buckets incl. Cancelled). Source header "new_segement" is Amazon''s misspelling — matched verbatim; if Amazon fixes it the exact match fails loudly. Open bucket list. Snapshot as-of access day; no backfill.')
ON CONFLICT (report_key) DO NOTHING;
