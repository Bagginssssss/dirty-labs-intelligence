// ============================================================================
//  ⚠️  MIRROR WARNING — lib/report-registry.ts  ⚠️
// ----------------------------------------------------------------------------
//  This module is an EXACT MIRROR of the report_registry seed in
//  supabase/migrations/040_report_registry.sql (and every future registry
//  migration). At RUNTIME the database table is the source of truth; for the
//  INGEST CODE (report_key derivation + the period-date gate) this array is.
//  THEY MUST NOT DRIFT.
//
//  ANY registry change MUST be made in BOTH places in the SAME change:
//    1. a migration (INSERT … ON CONFLICT, or UPDATE) against report_registry
//    2. REPORT_REGISTRY_SEED below
//  Then re-run  `npm run check:registry`  — it diffs this array against the
//  live table and fails on any mismatch. INB-146 (coverage), INB-147 (tiles)
//  and INB-149 (purchased-product remediation) all touch the registry; each
//  must re-verify mirror agreement before it ships.
// ============================================================================

export type Discriminator =
  | { column: string; values: string[]; asin?: string }
  | { column: string; op: 'is_null' | 'is_not_null' }
  | null

export interface RegistryRow {
  report_key: string
  display_name: string
  source_group: string
  cadence: string
  pull_period: string | null
  target_table: string
  discriminator: Discriminator
  requires_period_dates: boolean
  is_active: boolean
  sort_order: number | null
  notes: string | null
  // INB-175 — explicit RETIRED marker: the date the report was first observed unavailable from the
  // source (NOT the last-data date). NULL/absent = not retired. Optional in the seed so the 56
  // not-retired rows need not spell out `retired_at: null` (the mirror diff treats absent = null).
  retired_at?: string | null
}

// Mirror of migration 040's 37-row seed. Order matches the migration.
export const REPORT_REGISTRY_SEED: RegistryRow[] = [
  // ── Sponsored Ads ──────────────────────────────────────────────────────────
  { report_key: 'sp_campaign_performance', display_name: 'SP Campaign Performance', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_campaign_performance', discriminator: { column: 'ad_type', values: ['SP'] }, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  { report_key: 'sb_campaign_performance', display_name: 'SB Campaign Performance (incl. SBV)', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_campaign_performance', discriminator: { column: 'ad_type', values: ['SB', 'SBV'] }, requires_period_dates: false, is_active: true, sort_order: 2, notes: null },
  { report_key: 'sp_targeting', display_name: 'SP Targeting', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_targeting_report', discriminator: { column: 'ad_type', values: ['SP'] }, requires_period_dates: false, is_active: true, sort_order: 3, notes: null },
  { report_key: 'sb_keyword', display_name: 'SB Keyword (incl. SBV)', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_targeting_report', discriminator: { column: 'ad_type', values: ['SB', 'SBV'] }, requires_period_dates: false, is_active: true, sort_order: 4, notes: null },
  { report_key: 'sp_search_term', display_name: 'SP Search Term', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_search_term_report', discriminator: { column: 'ad_type', values: ['SP'] }, requires_period_dates: false, is_active: true, sort_order: 5, notes: null },
  { report_key: 'sb_search_term', display_name: 'SB Search Term', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sp_search_term_report', discriminator: { column: 'ad_type', values: ['SB', 'SBV'] }, requires_period_dates: false, is_active: true, sort_order: 6, notes: null },
  { report_key: 'sp_purchased_product', display_name: 'SP Purchased Product', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'purchased_product_report', discriminator: { column: 'ad_type', values: ['SP'] }, requires_period_dates: false, is_active: true, sort_order: 7, notes: 'SP Sponsored Products purchased-product export (ad_type=SP; advertised_asin populated). Repaired in INB-149.' },
  { report_key: 'sb_attributed_purchases', display_name: 'SB Attributed Purchases', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'purchased_product_report', discriminator: { column: 'ad_type', values: ['SB', 'SBV'] }, requires_period_dates: false, is_active: true, sort_order: 8, notes: 'SB Attributed Purchases export (SB + SBV campaigns). The only purchase-level NTB source for SB. Aggregated per (campaign, report_date, purchased_asin, attribution_type); dedicated detector + mapper landed in INB-149.' },

  // ── Brand Analytics ─────────────────────────────────────────────────────────
  { report_key: 'sqp_weekly', display_name: 'Search Query Performance', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'search_query_performance', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Weekly from May 2026; table also holds 12 monthly-era periods (May 2025 – Apr 2026).' },
  { report_key: 'customer_loyalty', display_name: 'Customer Loyalty Analytics', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_customer_loyalty', discriminator: { column: 'granularity', values: ['weekly'] }, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Weekly pull is the tracked report; monthly history exists in-table. A monthly upload derives NO report_key (logged NULL + warning).' },
  // BA Repeat Purchase Behavior (INB-141): brand + ASIN views share one table, discriminated on level. Replaces the never-ingested planned placeholder ba_repeat_purchase.
  { report_key: 'ba_repeat_purchase_brand', display_name: 'BA Repeat Purchase — Brand View', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_repeat_purchase', discriminator: { column: 'level', values: ['brand'] }, requires_period_dates: false, is_active: true, sort_order: 3, notes: 'Weekly BA export (publication lag like Customer Loyalty). Reporting Date = week-ending Saturday. Line 1 of the export is a metadata preamble.' },
  { report_key: 'ba_repeat_purchase_asin', display_name: 'BA Repeat Purchase — ASIN View', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_repeat_purchase', discriminator: { column: 'level', values: ['asin'] }, requires_period_dates: false, is_active: true, sort_order: 4, notes: 'Weekly BA export (publication lag like Customer Loyalty). Reporting Date = week-ending Saturday. Line 1 of the export is a metadata preamble.' },

  // ── Business Reports ──────────────────────────────────────────────────────────
  { report_key: 'business_report_daily', display_name: 'Sales & Traffic (Daily)', source_group: 'Business Reports', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'business_report_daily', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  { report_key: 'business_report_child_asin', display_name: 'Sales & Traffic by Child ASIN', source_group: 'Business Reports', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'business_report', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 2, notes: 'Period-aggregate rows carry no date — requires_period_dates preserves the INB-109 gate.' },
  // INB-162 — SKU Economics: weekly MSKU-level fee economics; child fee lines in sku_economics_fees (migration 050).
  { report_key: 'sku_economics_weekly', display_name: 'SKU Economics (weekly)', source_group: 'Business Reports', cadence: 'weekly', pull_period: 'Prior week (Sun–Sat)', target_table: 'sku_economics_weekly', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 3, notes: 'MSKU-level fee economics; child fee lines in sku_economics_fees. Date is in the file (Start/End date) so no form dates are required. NOT attribution-affected — no rolling re-pull window.' },
  // INB-162 — COGS unit costs (internal sheet, CSV). SCD-2 write; single effective date on the upload form.
  { report_key: 'cogs', display_name: 'COGS (Unit Costs)', source_group: 'Business Reports', cadence: 'ad_hoc', pull_period: 'On cost change', target_table: 'cogs', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 4, notes: 'Internal effective-dated unit costs from the operator\'s COGS sheet (CSV). Single effective date supplied on the upload form (valid_from). SCD-2 re-upload: close changed rows, no-op unchanged, insert new. Not an Amazon feed; ad-hoc cadence (no overdue expectation).' },

  // ── Subscribe & Save ───────────────────────────────────────────────────────────
  { report_key: 'subscribe_and_save', display_name: 'S&S Performance', source_group: 'Subscribe & Save', cadence: 'monthly', pull_period: 'Latest month', target_table: 'subscribe_and_save', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Overlapping rolling ~30d windows labeled at period start (INB-136 covering-period semantics).' },
  // S&S Dashboard exports (INB-144): 5 dailies (one table, discriminated on metric) + 3 snapshots (one table, discriminated on report).
  { report_key: 'sns_dashboard_sales', display_name: 'S&S Daily — Sales (Reorder vs S&S)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['reorder_sales', 'sns_sales'] }, requires_period_dates: false, is_active: true, sort_order: 2, notes: null },
  { report_key: 'sns_dashboard_reorder_share', display_name: 'S&S Daily — Reorder & S&S Share', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['reorder_rate', 'sns_sales_share'] }, requires_period_dates: false, is_active: true, sort_order: 3, notes: null },
  { report_key: 'sns_dashboard_subscription_count', display_name: 'S&S Daily — Subscription Count', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['active_subscriptions', 'active_subscriptions_ly'] }, requires_period_dates: false, is_active: true, sort_order: 4, notes: null },
  // INB-173 — DEPRECATED: "Coupon Sales Share" left the Seller Central dashboard (last data 2026-08-09).
  // is_active=false only — 85 coverage periods + 1,170 fact rows preserved (history stays queryable).
  // INB-175 — first RETIRED report: retired_at carries the state (first observed missing 2026-08-17), so
  // the interim "(RETIRED — …)" display-name label is removed. retired_at ⇒ is_active=false (DB CHECK).
  { report_key: 'sns_dashboard_coupon_sales', display_name: 'S&S Daily — Coupon Sales Share', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['coupon_sales_share', 'coupon_sales_share_ly'] }, requires_period_dates: false, is_active: false, sort_order: 5, notes: null, retired_at: '2026-08-17' },
  { report_key: 'sns_dashboard_coupon_subs', display_name: 'S&S Daily — Coupon Subs Share', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['coupon_subs_share', 'coupon_subs_share_ly'] }, requires_period_dates: false, is_active: true, sort_order: 6, notes: null },
  { report_key: 'sns_dashboard_ltv', display_name: 'S&S Snapshot — Subscriber LTV (Established / Growing / Lost)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['subscriber_ltv'] }, requires_period_dates: true, is_active: true, sort_order: 7, notes: 'Trailing 24-month avg GMS by segment x purchase type; values as-of capture date. No backfill — history starts at first capture.' },
  { report_key: 'sns_dashboard_avg_reorders', display_name: 'S&S Snapshot — Avg Reorders (Sub vs Non)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['avg_reorders'] }, requires_period_dates: true, is_active: true, sort_order: 8, notes: 'Trailing 12 months; values as-of capture date. No backfill — history starts at first capture.' },
  { report_key: 'sns_dashboard_retention', display_name: 'S&S Snapshot — Subscriber Retention', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['subscriber_retention'] }, requires_period_dates: true, is_active: true, sort_order: 9, notes: 'Trailing window undocumented (likely 12mo, unverified); values as-of capture date. No backfill — history starts at first capture.' },
  // INB-164 — Sales by Number of Deliveries: 4th snapshot on the shared table, discriminated on report=deliveries_breakdown. Appended at sort_order 10 (no shift of the existing group).
  { report_key: 'sns_dashboard_deliveries', display_name: 'S&S Snapshot — Sales by Deliveries (S&S subs, 6 buckets)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['deliveries_breakdown'] }, requires_period_dates: true, is_active: true, sort_order: 10, notes: 'Shipped revenue by delivery-count segment (absolute dollars; the chart shows proportions). Open bucket list — Amazon has widened it before, so labels are stored verbatim. Snapshot as-of access day; no backfill.' },
  // INB-173 — Coupon Driven Sales (daily) replaces the deprecated Coupon Sales Share; 3 new snapshots. Appended at sort_order 11-14 (no shift of the existing group).
  { report_key: 'sns_dashboard_coupon_driven', display_name: 'S&S Daily — Coupon Driven Sales', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'sns_dashboard_daily', discriminator: { column: 'metric', values: ['coupon_sales_sns', 'coupon_sales_reorder', 'coupon_sales_standard'] }, requires_period_dates: false, is_active: true, sort_order: 11, notes: 'Coupon-driven sales dollars by coupon type (S&S / Reorder / Standard). Reorder + Standard are 0 on every row (confirmed across 3 weekly pulls) — the mapper STILL writes their rows so the INB-168 paired-discriminator coverage intersects to a real cap date instead of NULL. Replaces the deprecated Coupon Sales Share.' },
  { report_key: 'sns_dashboard_customer_ltv', display_name: 'S&S Snapshot — Customer LTV (One-Time / Reorder / Subscriber)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['customer_ltv_by_segment'] }, requires_period_dates: true, is_active: true, sort_order: 12, notes: 'Average GMS by customer segment (One Time Customer / Reorder Customer / Subscriber). Distinct from sns_dashboard_ltv (Subscriber LTV = calc_customer_segment x purchase_type, lifecycle segments). Open segment list — labels stored verbatim. Snapshot as-of access day; no backfill.' },
  { report_key: 'sns_dashboard_customer_share', display_name: 'S&S Snapshot — Customer Share (One-Time / Reorder / Subscriber)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['customer_share_by_segment'] }, requires_period_dates: true, is_active: true, sort_order: 13, notes: 'Customer-count share by segment (One Time Customer / Reorder Customer / Subscriber; fractions summing to ~1.0). Open segment list — labels stored verbatim. Snapshot as-of access day; no backfill.' },
  { report_key: 'sns_dashboard_total_deliveries', display_name: 'S&S Snapshot — Sales by Deliveries (all sales, 5 buckets)', source_group: 'Subscribe & Save', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'sns_dashboard_snapshots', discriminator: { column: 'report', values: ['total_deliveries_breakdown'] }, requires_period_dates: true, is_active: true, sort_order: 14, notes: 'Total shipped revenue by delivery-count bucket (1 delivery .. 5+ deliveries; all sales, not S&S-only). Distinct from sns_dashboard_deliveries (S&S-only, 6 buckets incl. Cancelled). Source header "new_segement" is Amazon\'s misspelling — matched verbatim; if Amazon fixes it the exact match fails loudly. Open bucket list. Snapshot as-of access day; no backfill.' },

  // ── Virtual Bundles ─────────────────────────────────────────────────────────────
  { report_key: 'vb_sales_summary', display_name: 'VB Sales (Summary)', source_group: 'Virtual Bundles', cadence: 'weekly', pull_period: 'Rolling 90d', target_table: 'virtual_bundle_sales_snapshots', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Amazon pushes by email on Tuesdays; multi-section 90-day snapshot export.' },
  { report_key: 'vb_sales_per_order', display_name: 'VB Sales (Per Order)', source_group: 'Virtual Bundles', cadence: 'weekly', pull_period: 'Rolling 90d', target_table: 'virtual_bundle_sales_daily', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Amazon pushes by email on Tuesdays; flat per-order/daily export.' },

  // ── SmartScout ──────────────────────────────────────────────────────────────────
  { report_key: 'smartscout_brands_liquid_laundry', display_name: 'SmartScout Brands — Liquid Laundry', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['laundry_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 1, notes: 'Stored code laundry_detergent covers both Liquid Laundry Detergent and Pacs & Tablets display names. snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_brands_dishwasher', display_name: 'SmartScout Brands — Dishwasher Detergent', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['dishwasher_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 2, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_brands_stain_removers', display_name: 'SmartScout Brands — Stain Removers', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['laundry_stain_remover'] }, requires_period_dates: true, is_active: true, sort_order: 3, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_brands_toilet_cleaners', display_name: 'SmartScout Brands — Toilet Cleaners', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['toilet_bowl_cleaner'] }, requires_period_dates: true, is_active: true, sort_order: 4, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_products_liquid_laundry', display_name: 'SmartScout Products — Liquid Laundry', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['laundry_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 5, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_products_dishwasher', display_name: 'SmartScout Products — Dishwasher Detergent', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['dishwasher_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 6, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_products_stain_removers', display_name: 'SmartScout Products — Stain Removers', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['laundry_stain_remover'] }, requires_period_dates: true, is_active: true, sort_order: 7, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },
  { report_key: 'smartscout_products_toilet_cleaners', display_name: 'SmartScout Products — Toilet Cleaners', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['toilet_bowl_cleaner'] }, requires_period_dates: true, is_active: true, sort_order: 8, notes: 'snapshot_date = capture date (form prefills today). Before 2026-07-13, snapshots were labeled at ~30d window start — one-time label jump at the convention change; data unaffected.' },

  // ── ScaleInsights ─────────────────────────────────────────────────────────────
  { report_key: 'si_rank_b09b7ys1vk', display_name: 'SI Keyword Rank — B09B7YS1VK (Liquid Laundry, Signature)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['04a2dc1b-6fe1-4043-9004-04d97ee3eb4e'], asin: 'B09B7YS1VK' }, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  // INB-165: B09B7Z4GPZ is the real Liquid Laundry Scent Free (B09MSP7M5Y below is the Laundry Booster). Seeded at sort_order 2, adjacent to the Signature variant.
  { report_key: 'si_rank_b09b7z4gpz', display_name: 'SI Keyword Rank — B09B7Z4GPZ (Liquid Laundry, Scent Free)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['5a9e0865-0e0a-4ff1-994b-70a7cc0a382b'], asin: 'B09B7Z4GPZ' }, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Scent Free Bio-Liquid Laundry Detergent. Ingested since 2026-07-11 (713 rows, 23 keywords) but was unregistered → report_key resolved NULL and coverage was skipped; seeded + coverage-backfilled in INB-165.' },
  { report_key: 'si_rank_b09msp7m5y', display_name: 'SI Keyword Rank — B09MSP7M5Y (Laundry Booster, Scent Free)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['0b4255cd-046e-42c2-ac97-3b3b503f5dfc'], asin: 'B09MSP7M5Y' }, requires_period_dates: false, is_active: true, sort_order: 3, notes: null },
  { report_key: 'si_rank_b09b85ngbt', display_name: 'SI Keyword Rank — B09B85NGBT (Dishwasher Detergent)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['45a09193-1d30-4070-a17e-c003372735ba'], asin: 'B09B85NGBT' }, requires_period_dates: false, is_active: true, sort_order: 4, notes: null },
  { report_key: 'si_rank_b0bl8mwlm5', display_name: 'SI Keyword Rank — B0BL8MWLM5 (Hand Wash & Delicates)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['a5e24c7d-72ba-45c7-85f5-0d12196ccded'], asin: 'B0BL8MWLM5' }, requires_period_dates: false, is_active: true, sort_order: 5, notes: null },
  { report_key: 'si_rank_b0fqpmnj6z', display_name: 'SI Keyword Rank — B0FQPMNJ6Z (Toilet Bowl Cleaner)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['d8de583a-78a1-4200-b07e-b02107cafabe'], asin: 'B0FQPMNJ6Z' }, requires_period_dates: false, is_active: true, sort_order: 6, notes: null },
  { report_key: 'si_bid_log', display_name: 'SI Bid Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_bid_log', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 7, notes: 'Backfilled to Jan 2025. Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_import_log', display_name: 'SI Import Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['import'] }, requires_period_dates: false, is_active: true, sort_order: 8, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_negative_log', display_name: 'SI Negative Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['negative'] }, requires_period_dates: false, is_active: true, sort_order: 9, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_revive_log', display_name: 'SI Revive Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['revive'] }, requires_period_dates: false, is_active: true, sort_order: 10, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_rules_assigned', display_name: 'SI Assigned Rules Snapshot', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'scale_insights_rule_assignments', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 11, notes: 'Point-in-time export — pull Assigned+Unassigned back-to-back, same-day upload.' },
  { report_key: 'si_rules_unassigned', display_name: 'SI Unassigned Rules Snapshot', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'scale_insights_rule_assignments', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 12, notes: 'Point-in-time pair — pull back-to-back with Assigned, same-day upload. File-of-origin is content-derived post-upsert (is_assigned); upload attribution uses header shape.' },

  // ── Customer Voice (INB-160) ──────────────────────────────────────────────────
  { report_key: 'fba_customer_returns', display_name: 'FBA Customer Returns', source_group: 'Customer Voice', cadence: 'weekly', pull_period: 'Full history / weekly top-up', target_table: 'fba_customer_returns', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Seller Central Customer Returns flat file (Windows-1252). Full history in one pull; weekly top-up overlaps and is idempotent via the occurrence key. Date is in the file. Basis for the sku_return_rates NCX proxy.' },
  { report_key: 'amazon_reviews', display_name: 'Amazon Reviews', source_group: 'Customer Voice', cadence: 'monthly', pull_period: 'Monthly unfiltered + ad-hoc backfill', target_table: 'amazon_reviews', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Axesso Apify actor JSON export (manual weekly/monthly upload). Upsert on (brand_id, review_id) — reviews are shared across a parent\'s child ASINs; ad-hoc pulls are idempotent. requires_period_dates=false: reviews carry their own review_date; the form date only sets rating-snapshot snapshot_date (defaults to ingest date).' },
  { report_key: 'amazon_rating_snapshots', display_name: 'Amazon Rating Snapshots', source_group: 'Customer Voice', cadence: 'monthly', pull_period: 'Monthly unfiltered runs only', target_table: 'amazon_rating_snapshots', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 3, notes: 'Product-level rating/star-mix snapshots, extracted from the same unfiltered Axesso run that feeds amazon_reviews (countReviews is filter-dependent, so star-filtered backfill runs write NO snapshots). Separate tile: snapshot freshness diverges from reviews freshness. snapshot_date = run date (form date_range_start, else ingest date).' },

  // ── Planned (not yet ingesting) ───────────────────────────────────────────────
  { report_key: 'ba_top_search_terms', display_name: 'BA Top Search Terms', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_top_search_terms', discriminator: null, requires_period_dates: false, is_active: false, sort_order: 3, notes: 'Planned — INB-140. Target table does not exist yet.' },
  { report_key: 'amc_query_results', display_name: 'AMC Query Results', source_group: 'Brand Analytics', cadence: 'ad_hoc', pull_period: null, target_table: 'amc_query_results', discriminator: null, requires_period_dates: false, is_active: false, sort_order: 5, notes: 'Planned — INB-142. Target table does not exist yet.' },
]

const REPORT_KEYS = new Set(REPORT_REGISTRY_SEED.map(r => r.report_key))

// SmartScout stored subcategory code → report_key suffix.
// INB-172 (global-by-necessity, keyed on a column value): shared by the SmartScout brands AND products
// report families (two target tables). SAFE — a subcategory code maps to the same slug for both, and
// the brands_/products_ prefix at the call site disambiguates the final report_key. No sibling assigns
// a different meaning to the same code, so this stays a single global map.
const SUBCATEGORY_SLUG: Record<string, string> = {
  laundry_detergent: 'liquid_laundry',
  dishwasher_detergent: 'dishwasher',
  laundry_stain_remover: 'stain_removers',
  toilet_bowl_cleaner: 'toilet_cleaners',
}

export interface DerivedReportKey {
  reportKey: string | null
  warning?: string
}

function warn(msg: string): DerivedReportKey {
  return { reportKey: null, warning: msg }
}

// Confirms a derived key is a real registry row; unknown → null + warning.
function validated(key: string, what: string): DerivedReportKey {
  return REPORT_KEYS.has(key) ? { reportKey: key } : warn(`${what} produced unregistered report_key '${key}'`)
}

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
function hasHeader(headers: string[], normKey: string): boolean {
  return headers.some(h => normalizeHeader(h) === normKey)
}
function distinctField(rows: Record<string, unknown>[], field: string): string[] {
  const s = new Set<string>()
  for (const r of rows) { const v = r[field]; if (v != null && v !== '') s.add(String(v)) }
  return [...s]
}

function byAdType(rows: Record<string, unknown>[], spKey: string, sbKey: string): DerivedReportKey {
  const types = distinctField(rows, 'ad_type')
  if (types.length === 0) return warn('no ad_type values to derive SP/SB report_key')
  if (types.every(t => t === 'SP')) return { reportKey: spKey }
  if (types.every(t => t === 'SB' || t === 'SBV')) return { reportKey: sbKey }
  return warn(`mixed ad_type values [${types.join(', ')}] — cannot resolve a single report_key`)
}

// deriveReportKey — tags an upload at the true-report level. Ambiguous files
// (mixed ad_type / multiple subcategories / multiple rank ASINs / non-weekly
// loyalty / unmapped type) return null + a warning; the route logs NULL.
export function deriveReportKey(
  effectiveReportType: string,
  headers: string[],
  mappedRows: Record<string, unknown>[],
): DerivedReportKey {
  switch (effectiveReportType) {
    case 'sp_campaign_performance__sp': return { reportKey: 'sp_campaign_performance' }
    case 'sp_campaign_performance__sb': return { reportKey: 'sb_campaign_performance' }

    case 'sp_search_term_report': return byAdType(mappedRows, 'sp_search_term', 'sb_search_term')
    case 'sp_targeting_report':   return byAdType(mappedRows, 'sp_targeting', 'sb_keyword')

    // INB-149: the detector now separates the two purchased-product files, so the
    // report_key is by report type (no header probe needed).
    case 'purchased_product_report': return { reportKey: 'sp_purchased_product' }
    case 'sb_attributed_purchases':  return { reportKey: 'sb_attributed_purchases' }

    case 'search_query_performance':       return { reportKey: 'sqp_weekly' }
    case 'brand_analytics_customer_loyalty': {
      const g = distinctField(mappedRows, 'granularity')
      if (g.length === 1 && g[0] === 'weekly') return { reportKey: 'customer_loyalty' }
      return warn(`customer loyalty upload is ${g.join('/') || 'unknown'} granularity; only the weekly pull is a tracked report`)
    }

    case 'business_report_daily': return { reportKey: 'business_report_daily' }
    case 'business_report':       return { reportKey: 'business_report_child_asin' }
    case 'sku_economics_weekly':  return { reportKey: 'sku_economics_weekly' }
    case 'cogs':                  return { reportKey: 'cogs' }
    case 'fba_customer_returns':  return { reportKey: 'fba_customer_returns' }
    // INB-160 — reviews go through the bespoke JSON handler (which sets reportKey directly);
    // these cases are defensive parity, like the never-hit cogs case above.
    case 'amazon_reviews':          return { reportKey: 'amazon_reviews' }
    case 'amazon_rating_snapshots': return { reportKey: 'amazon_rating_snapshots' }
    case 'subscribe_and_save':    return { reportKey: 'subscribe_and_save' }

    case 'virtual_bundle_sales_snapshots': return { reportKey: 'vb_sales_summary' }
    case 'virtual_bundle_sales_daily':     return { reportKey: 'vb_sales_per_order' }

    case 'smartscout_subcategory_brands':
    case 'smartscout_subcategory_products': {
      const subs = distinctField(mappedRows, 'subcategory')
      if (subs.length !== 1) return warn(`SmartScout upload spans ${subs.length} subcategories [${subs.join(', ')}] — expected one`)
      const slug = SUBCATEGORY_SLUG[subs[0]]
      if (!slug) return warn(`unknown SmartScout subcategory '${subs[0]}'`)
      const prefix = effectiveReportType === 'smartscout_subcategory_brands' ? 'smartscout_brands_' : 'smartscout_products_'
      return validated(prefix + slug, 'SmartScout subcategory')
    }

    case 'scale_insights_keyword_rank': {
      const asins = distinctField(mappedRows, '_asin')
      if (asins.length !== 1) return warn(`keyword-rank upload spans ${asins.length} ASINs — expected one tracked ASIN`)
      return validated('si_rank_' + asins[0].toLowerCase(), 'keyword-rank ASIN')
    }
    case 'scale_insights_bid_log': return { reportKey: 'si_bid_log' }
    case 'scale_insights_rule_change_log': {
      const types = distinctField(mappedRows, 'log_type')
      if (types.length !== 1) return warn(`rule change-log upload spans ${types.length} log_types [${types.join(', ')}] — expected one`)
      return validated('si_' + types[0] + '_log', 'rule change-log log_type')
    }
    case 'scale_insights_rule_assignments':
      // Assigned export carries the rule-list columns; Unassigned does not.
      return { reportKey: hasHeader(headers, 'bidding_rules') ? 'si_rules_assigned' : 'si_rules_unassigned' }

    // INB-144 — S&S Dashboard: one reportType per table fans out to fine-grained report_keys
    // by the mapped metric/report field (each file carries exactly one report's rows).
    case 'sns_dashboard_daily': {
      // INB-172 (global-by-necessity, keyed on the mapped metric slug): shared by the 5 sns_dashboard_daily
      // reports. SAFE — each metric slug belongs to exactly one report_key, and the keys.size !== 1 guard
      // below rejects any upload that spans more than one. No sibling reinterprets a slug.
      const SLUG_TO_KEY: Record<string, string> = {
        reorder_sales: 'sns_dashboard_sales',                 sns_sales: 'sns_dashboard_sales',
        reorder_rate: 'sns_dashboard_reorder_share',          sns_sales_share: 'sns_dashboard_reorder_share',
        active_subscriptions: 'sns_dashboard_subscription_count', active_subscriptions_ly: 'sns_dashboard_subscription_count',
        coupon_sales_share: 'sns_dashboard_coupon_sales',     coupon_sales_share_ly: 'sns_dashboard_coupon_sales',
        coupon_subs_share: 'sns_dashboard_coupon_subs',       coupon_subs_share_ly: 'sns_dashboard_coupon_subs',
        // INB-173 — Coupon Driven Sales (all three metrics map to the one report_key; Reorder/Standard
        // are all-zero but still carry rows, so a paired upload resolves keys.size === 1 here).
        coupon_sales_sns: 'sns_dashboard_coupon_driven',      coupon_sales_reorder: 'sns_dashboard_coupon_driven',
        coupon_sales_standard: 'sns_dashboard_coupon_driven',
      }
      const keys = new Set(distinctField(mappedRows, 'metric').map(m => SLUG_TO_KEY[m]).filter(Boolean))
      if (keys.size !== 1) return warn(`S&S Dashboard daily upload spans ${keys.size} reports [${[...keys].join(', ')}] — expected one`)
      return validated([...keys][0], 'S&S Dashboard daily')
    }
    // INB-141 — BA Repeat Purchase: one reportType splits to brand/asin by the mapped `level`.
    case 'brand_analytics_repeat_purchase': {
      const levels = distinctField(mappedRows, 'level')
      if (levels.length !== 1) return warn(`repeat purchase upload spans ${levels.length} levels [${levels.join(', ')}] — expected one`)
      return validated(levels[0] === 'brand' ? 'ba_repeat_purchase_brand' : 'ba_repeat_purchase_asin', 'repeat purchase level')
    }
    case 'sns_dashboard_snapshots': {
      // INB-172 (global-by-necessity, keyed on the mapped `report` value): shared by the 4 snapshot
      // reports. SAFE — each report value maps to exactly one report_key; the reports.length !== 1 guard
      // below rejects a multi-report upload.
      const REPORT_TO_KEY: Record<string, string> = {
        subscriber_ltv: 'sns_dashboard_ltv',
        avg_reorders: 'sns_dashboard_avg_reorders',
        subscriber_retention: 'sns_dashboard_retention',
        deliveries_breakdown: 'sns_dashboard_deliveries', // INB-164
        // INB-173 — three new snapshots on the shared table.
        customer_ltv_by_segment: 'sns_dashboard_customer_ltv',
        customer_share_by_segment: 'sns_dashboard_customer_share',
        total_deliveries_breakdown: 'sns_dashboard_total_deliveries',
      }
      const reports = distinctField(mappedRows, 'report')
      if (reports.length !== 1 || !REPORT_TO_KEY[reports[0]]) {
        return warn(`S&S Dashboard snapshot upload spans ${reports.length} reports [${reports.join(', ')}] — expected one`)
      }
      return validated(REPORT_TO_KEY[reports[0]], 'S&S Dashboard snapshot')
    }

    default:
      return warn(`no registry mapping for report type '${effectiveReportType}'`)
  }
}

// ── Period-date gate source (INB-109 → registry-driven, INB-145) ──────────────
// reportType is the detector key (pre __sp/__sb split), which equals the
// target_table for every gated type.
export function typeRequiresPeriodDates(reportType: string): boolean {
  return REPORT_REGISTRY_SEED.some(r => r.is_active && r.requires_period_dates && r.target_table === reportType)
}

// A human label for the gate error message (the source group of the gated rows).
export function gateLabelFor(reportType: string): string | null {
  const row = REPORT_REGISTRY_SEED.find(r => r.is_active && r.requires_period_dates && r.target_table === reportType)
  return row ? row.source_group : null
}
