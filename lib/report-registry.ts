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
  { report_key: 'sp_purchased_product', display_name: 'SP Purchased Product', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'purchased_product_report', discriminator: { column: 'advertised_asin', op: 'is_not_null' }, requires_period_dates: false, is_active: true, sort_order: 7, notes: "236 SP-campaign rows carry NULL advertised_asin (land under sb_attributed_purchases' predicate) — INB-149." },
  { report_key: 'sb_attributed_purchases', display_name: 'SB Attributed Purchases', source_group: 'Sponsored Ads', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'purchased_product_report', discriminator: { column: 'advertised_asin', op: 'is_null' }, requires_period_dates: false, is_active: true, sort_order: 8, notes: 'Ingests via the shared purchased_asin detector branch. KNOWN DEFECTS: lossy (14d metrics dropped by the SP-shaped mapper) and dupe-prone (NULL advertised_asin defeats the unique key; 4,983 excess rows found 2026-07-09). Remediation: INB-149.' },

  // ── Brand Analytics ─────────────────────────────────────────────────────────
  { report_key: 'sqp_weekly', display_name: 'Search Query Performance', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'search_query_performance', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Weekly from May 2026; table also holds 12 monthly-era periods (May 2025 – Apr 2026).' },
  { report_key: 'customer_loyalty', display_name: 'Customer Loyalty Analytics', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_customer_loyalty', discriminator: { column: 'granularity', values: ['weekly'] }, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Weekly pull is the tracked report; monthly history exists in-table. A monthly upload derives NO report_key (logged NULL + warning).' },

  // ── Business Reports ──────────────────────────────────────────────────────────
  { report_key: 'business_report_daily', display_name: 'Sales & Traffic (Daily)', source_group: 'Business Reports', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'business_report_daily', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  { report_key: 'business_report_child_asin', display_name: 'Sales & Traffic by Child ASIN', source_group: 'Business Reports', cadence: 'weekly', pull_period: 'Last 30 days', target_table: 'business_report', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 2, notes: 'Period-aggregate rows carry no date — requires_period_dates preserves the INB-109 gate.' },

  // ── Subscribe & Save ───────────────────────────────────────────────────────────
  { report_key: 'subscribe_and_save', display_name: 'S&S Performance', source_group: 'Subscribe & Save', cadence: 'monthly', pull_period: 'Latest month', target_table: 'subscribe_and_save', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Overlapping rolling ~30d windows labeled at period start (INB-136 covering-period semantics).' },

  // ── Virtual Bundles ─────────────────────────────────────────────────────────────
  { report_key: 'vb_sales_summary', display_name: 'VB Sales (Summary)', source_group: 'Virtual Bundles', cadence: 'weekly', pull_period: 'Rolling 90d', target_table: 'virtual_bundle_sales_snapshots', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: 'Amazon pushes by email on Tuesdays; multi-section 90-day snapshot export.' },
  { report_key: 'vb_sales_per_order', display_name: 'VB Sales (Per Order)', source_group: 'Virtual Bundles', cadence: 'weekly', pull_period: 'Rolling 90d', target_table: 'virtual_bundle_sales_daily', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 2, notes: 'Amazon pushes by email on Tuesdays; flat per-order/daily export.' },

  // ── SmartScout ──────────────────────────────────────────────────────────────────
  { report_key: 'smartscout_brands_liquid_laundry', display_name: 'SmartScout Brands — Liquid Laundry', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['laundry_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 1, notes: 'Stored code laundry_detergent covers both Liquid Laundry Detergent and Pacs & Tablets display names.' },
  { report_key: 'smartscout_brands_dishwasher', display_name: 'SmartScout Brands — Dishwasher Detergent', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['dishwasher_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 2, notes: null },
  { report_key: 'smartscout_brands_stain_removers', display_name: 'SmartScout Brands — Stain Removers', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['laundry_stain_remover'] }, requires_period_dates: true, is_active: true, sort_order: 3, notes: null },
  { report_key: 'smartscout_brands_toilet_cleaners', display_name: 'SmartScout Brands — Toilet Cleaners', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_brands', discriminator: { column: 'subcategory', values: ['toilet_bowl_cleaner'] }, requires_period_dates: true, is_active: true, sort_order: 4, notes: null },
  { report_key: 'smartscout_products_liquid_laundry', display_name: 'SmartScout Products — Liquid Laundry', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['laundry_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 5, notes: null },
  { report_key: 'smartscout_products_dishwasher', display_name: 'SmartScout Products — Dishwasher Detergent', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['dishwasher_detergent'] }, requires_period_dates: true, is_active: true, sort_order: 6, notes: null },
  { report_key: 'smartscout_products_stain_removers', display_name: 'SmartScout Products — Stain Removers', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['laundry_stain_remover'] }, requires_period_dates: true, is_active: true, sort_order: 7, notes: null },
  { report_key: 'smartscout_products_toilet_cleaners', display_name: 'SmartScout Products — Toilet Cleaners', source_group: 'SmartScout', cadence: 'snapshot_weekly', pull_period: 'Point-in-time', target_table: 'smartscout_subcategory_products', discriminator: { column: 'subcategory', values: ['toilet_bowl_cleaner'] }, requires_period_dates: true, is_active: true, sort_order: 8, notes: null },

  // ── ScaleInsights ─────────────────────────────────────────────────────────────
  { report_key: 'si_rank_b09b7ys1vk', display_name: 'SI Keyword Rank — B09B7YS1VK (Liquid Laundry, Signature)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['04a2dc1b-6fe1-4043-9004-04d97ee3eb4e'], asin: 'B09B7YS1VK' }, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  { report_key: 'si_rank_b09msp7m5y', display_name: 'SI Keyword Rank — B09MSP7M5Y (Liquid Laundry, Scent Free)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['0b4255cd-046e-42c2-ac97-3b3b503f5dfc'], asin: 'B09MSP7M5Y' }, requires_period_dates: false, is_active: true, sort_order: 2, notes: null },
  { report_key: 'si_rank_b09b85ngbt', display_name: 'SI Keyword Rank — B09B85NGBT (Dishwasher Detergent)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['45a09193-1d30-4070-a17e-c003372735ba'], asin: 'B09B85NGBT' }, requires_period_dates: false, is_active: true, sort_order: 3, notes: null },
  { report_key: 'si_rank_b0bl8mwlm5', display_name: 'SI Keyword Rank — B0BL8MWLM5 (Hand Wash & Delicates)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['a5e24c7d-72ba-45c7-85f5-0d12196ccded'], asin: 'B0BL8MWLM5' }, requires_period_dates: false, is_active: true, sort_order: 4, notes: null },
  { report_key: 'si_rank_b0fqpmnj6z', display_name: 'SI Keyword Rank — B0FQPMNJ6Z (Toilet Bowl Cleaner)', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Latest export', target_table: 'scale_insights_keyword_rank', discriminator: { column: 'asin_id', values: ['d8de583a-78a1-4200-b07e-b02107cafabe'], asin: 'B0FQPMNJ6Z' }, requires_period_dates: false, is_active: true, sort_order: 5, notes: null },
  { report_key: 'si_bid_log', display_name: 'SI Bid Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_bid_log', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 6, notes: 'Backfilled to Jan 2025. Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_import_log', display_name: 'SI Import Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['import'] }, requires_period_dates: false, is_active: true, sort_order: 7, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_negative_log', display_name: 'SI Negative Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['negative'] }, requires_period_dates: false, is_active: true, sort_order: 8, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_revive_log', display_name: 'SI Revive Rule Change Log', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Rolling 7d (widenable)', target_table: 'scale_insights_rule_change_log', discriminator: { column: 'log_type', values: ['revive'] }, requires_period_dates: false, is_active: true, sort_order: 9, notes: 'Rolling window export — do not skip weeks; window widenable for recovery.' },
  { report_key: 'si_rules_assigned', display_name: 'SI Assigned Rules Snapshot', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'scale_insights_rule_assignments', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 10, notes: 'Point-in-time export — pull Assigned+Unassigned back-to-back, same-day upload.' },
  { report_key: 'si_rules_unassigned', display_name: 'SI Unassigned Rules Snapshot', source_group: 'ScaleInsights', cadence: 'weekly', pull_period: 'Point-in-time', target_table: 'scale_insights_rule_assignments', discriminator: null, requires_period_dates: true, is_active: true, sort_order: 11, notes: 'Point-in-time pair — pull back-to-back with Assigned, same-day upload. File-of-origin is content-derived post-upsert (is_assigned); upload attribution uses header shape.' },

  // ── Planned (not yet ingesting) ───────────────────────────────────────────────
  { report_key: 'ba_top_search_terms', display_name: 'BA Top Search Terms', source_group: 'Brand Analytics', cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_top_search_terms', discriminator: null, requires_period_dates: false, is_active: false, sort_order: 3, notes: 'Planned — INB-140. Target table does not exist yet.' },
  { report_key: 'ba_repeat_purchase', display_name: 'BA Repeat Purchase Behavior', source_group: 'Brand Analytics', cadence: 'ad_hoc', pull_period: null, target_table: 'brand_analytics_repeat_purchase', discriminator: null, requires_period_dates: false, is_active: false, sort_order: 4, notes: 'Planned — INB-141. Target table does not exist yet.' },
  { report_key: 'amc_query_results', display_name: 'AMC Query Results', source_group: 'Brand Analytics', cadence: 'ad_hoc', pull_period: null, target_table: 'amc_query_results', discriminator: null, requires_period_dates: false, is_active: false, sort_order: 5, notes: 'Planned — INB-142. Target table does not exist yet.' },
]

const REPORT_KEYS = new Set(REPORT_REGISTRY_SEED.map(r => r.report_key))

// SmartScout stored subcategory code → report_key suffix.
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

    case 'purchased_product_report':
      // SP export carries an Advertised ASIN column; the SB Attributed Purchases
      // export does not (it lands with advertised_asin NULL).
      return { reportKey: hasHeader(headers, 'advertised_asin') ? 'sp_purchased_product' : 'sb_attributed_purchases' }

    case 'search_query_performance':       return { reportKey: 'sqp_weekly' }
    case 'brand_analytics_customer_loyalty': {
      const g = distinctField(mappedRows, 'granularity')
      if (g.length === 1 && g[0] === 'weekly') return { reportKey: 'customer_loyalty' }
      return warn(`customer loyalty upload is ${g.join('/') || 'unknown'} granularity; only the weekly pull is a tracked report`)
    }

    case 'business_report_daily': return { reportKey: 'business_report_daily' }
    case 'business_report':       return { reportKey: 'business_report_child_asin' }
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
