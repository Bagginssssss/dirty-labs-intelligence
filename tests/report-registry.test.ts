// INB-145 — report registry: seed integrity, report_key derivation, the
// registry-driven period-date gate, and the DB↔TS mirror diff.
//
// The registry (migration 040) enumerates every true operational report. This
// module's TS seed (lib/report-registry.ts) MUST mirror that DB seed exactly;
// deriveReportKey tags each upload at the true-report level; and the period-date
// gate now reads requires_period_dates from the registry (not a hardcoded list).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Live schema (table → columns) — mirror of the real DB, verified out-of-band
// (same pattern as tests/upsert-constraint-check.test.ts). Only the columns the
// registry discriminators reference need to be present.
const LIVE_SCHEMA: Record<string, string[]> = {
  sp_campaign_performance: ['ad_type'],
  sp_targeting_report: ['ad_type'],
  sp_search_term_report: ['ad_type'],
  purchased_product_report: ['ad_type', 'advertised_asin'],
  search_query_performance: ['search_query'],
  brand_analytics_customer_loyalty: ['granularity'],
  business_report_daily: ['report_date'],
  business_report: ['asin_id'],
  subscribe_and_save: ['report_date'],
  virtual_bundle_sales_snapshots: ['snapshot_date'],
  virtual_bundle_sales_daily: ['sale_date'],
  smartscout_subcategory_brands: ['subcategory'],
  smartscout_subcategory_products: ['subcategory'],
  scale_insights_keyword_rank: ['asin_id'],
  scale_insights_bid_log: ['change_timestamp'],
  scale_insights_rule_change_log: ['log_type'],
  scale_insights_rule_assignments: ['snapshot_date'],
  sns_dashboard_daily: ['metric_date', 'metric'],
  sns_dashboard_snapshots: ['snapshot_date', 'report'],
  brand_analytics_repeat_purchase: ['reporting_date', 'level'],
  sku_economics_weekly: ['week_start', 'marketplace', 'msku'],
  cogs: ['internal_sku'],
}

// ---------------------------------------------------------------------------
// Seed integrity
// ---------------------------------------------------------------------------

test('seed: 48 rows, unique keys, valid enums, 46 active / 2 planned', async () => {
  const { REPORT_REGISTRY_SEED } = await import('../lib/report-registry.ts')
  assert.equal(REPORT_REGISTRY_SEED.length, 48) // INB-162: +sku_economics_weekly +cogs (both active)
  const keys = new Set(REPORT_REGISTRY_SEED.map(r => r.report_key))
  assert.equal(keys.size, 48, 'report_keys are unique')
  assert.equal(REPORT_REGISTRY_SEED.filter(r => r.is_active).length, 46)
  assert.equal(REPORT_REGISTRY_SEED.filter(r => !r.is_active).length, 2)
  const GROUPS = new Set(['Sponsored Ads', 'Brand Analytics', 'Business Reports', 'Subscribe & Save', 'Virtual Bundles', 'SmartScout', 'ScaleInsights'])
  const CADENCES = new Set(['weekly', 'monthly', 'snapshot_weekly', 'ad_hoc'])
  for (const r of REPORT_REGISTRY_SEED) {
    assert.ok(GROUPS.has(r.source_group), `${r.report_key} source_group`)
    assert.ok(CADENCES.has(r.cadence), `${r.report_key} cadence`)
  }
})

test('seed: requires_period_dates on exactly 15 rows', async () => {
  const { REPORT_REGISTRY_SEED } = await import('../lib/report-registry.ts')
  // 11 + the 3 S&S Dashboard snapshot reports (INB-144) + cogs (INB-162).
  assert.equal(REPORT_REGISTRY_SEED.filter(r => r.requires_period_dates).length, 15)
})

test('seed: every active target_table exists and every discriminator column is real', async () => {
  const { REPORT_REGISTRY_SEED } = await import('../lib/report-registry.ts')
  for (const r of REPORT_REGISTRY_SEED) {
    if (!r.is_active) continue
    const cols = LIVE_SCHEMA[r.target_table]
    assert.ok(cols, `active ${r.report_key}: target_table ${r.target_table} exists`)
    if (r.discriminator && 'column' in r.discriminator) {
      assert.ok(cols.includes(r.discriminator.column), `${r.report_key}: discriminator column ${r.discriminator.column} on ${r.target_table}`)
    }
  }
})

// ---------------------------------------------------------------------------
// report_key derivation — ≥1 case per source group
// ---------------------------------------------------------------------------

async function derive(type: string, headers: string[], rows: Record<string, unknown>[]) {
  const { deriveReportKey } = await import('../lib/report-registry.ts')
  return deriveReportKey(type, headers, rows)
}

test('derive: campaign performance splits on the effective __sp/__sb suffix', async () => {
  assert.equal((await derive('sp_campaign_performance__sp', [], [{ ad_type: 'SP' }])).reportKey, 'sp_campaign_performance')
  assert.equal((await derive('sp_campaign_performance__sb', [], [{ ad_type: 'SB' }])).reportKey, 'sb_campaign_performance')
})

test('derive: search-term / targeting split on distinct ad_type', async () => {
  assert.equal((await derive('sp_search_term_report', [], [{ ad_type: 'SP' }, { ad_type: 'SP' }])).reportKey, 'sp_search_term')
  assert.equal((await derive('sp_search_term_report', [], [{ ad_type: 'SB' }, { ad_type: 'SBV' }])).reportKey, 'sb_search_term')
  assert.equal((await derive('sp_targeting_report', [], [{ ad_type: 'SP' }])).reportKey, 'sp_targeting')
  assert.equal((await derive('sp_targeting_report', [], [{ ad_type: 'SBV' }])).reportKey, 'sb_keyword')
  const mixed = await derive('sp_search_term_report', [], [{ ad_type: 'SP' }, { ad_type: 'SB' }])
  assert.equal(mixed.reportKey, null)
  assert.ok(mixed.warning, 'mixed ad_type warns')
})

test('derive: purchased-product pair splits by report type (INB-149 — detector now separates them)', async () => {
  // Was a header probe; INB-149 gave the SB export its own detector signature, so
  // the report_key is by effective report type.
  assert.equal((await derive('purchased_product_report', ['Date', 'Campaign Name', 'Advertised ASIN', 'Purchased ASIN'], [{}])).reportKey, 'sp_purchased_product')
  assert.equal((await derive('sb_attributed_purchases', ['Date', 'Campaign Name', 'Purchased ASIN'], [{}])).reportKey, 'sb_attributed_purchases')
})

test('derive: loyalty weekly → key, monthly → null+warn', async () => {
  assert.equal((await derive('brand_analytics_customer_loyalty', [], [{ granularity: 'weekly' }])).reportKey, 'customer_loyalty')
  const monthly = await derive('brand_analytics_customer_loyalty', [], [{ granularity: 'monthly' }])
  assert.equal(monthly.reportKey, null)
  assert.ok(monthly.warning)
})

test('derive: business + S&S + VB static keys', async () => {
  assert.equal((await derive('business_report', [], [{}])).reportKey, 'business_report_child_asin')
  assert.equal((await derive('business_report_daily', [], [{}])).reportKey, 'business_report_daily')
  assert.equal((await derive('sku_economics_weekly', [], [{}])).reportKey, 'sku_economics_weekly')
  assert.equal((await derive('cogs', [], [{}])).reportKey, 'cogs')
  assert.equal((await derive('subscribe_and_save', [], [{}])).reportKey, 'subscribe_and_save')
  assert.equal((await derive('search_query_performance', [], [{}])).reportKey, 'sqp_weekly')
  assert.equal((await derive('virtual_bundle_sales_snapshots', [], [{}])).reportKey, 'vb_sales_summary')
  assert.equal((await derive('virtual_bundle_sales_daily', [], [{}])).reportKey, 'vb_sales_per_order')
})

test('derive: SmartScout subcategory → slug', async () => {
  assert.equal((await derive('smartscout_subcategory_brands', [], [{ subcategory: 'dishwasher_detergent' }])).reportKey, 'smartscout_brands_dishwasher')
  assert.equal((await derive('smartscout_subcategory_products', [], [{ subcategory: 'laundry_detergent' }])).reportKey, 'smartscout_products_liquid_laundry')
  const mixed = await derive('smartscout_subcategory_brands', [], [{ subcategory: 'dishwasher_detergent' }, { subcategory: 'toilet_bowl_cleaner' }])
  assert.equal(mixed.reportKey, null)
  assert.ok(mixed.warning)
})

test('derive: keyword rank by _asin, unknown ASIN warns', async () => {
  assert.equal((await derive('scale_insights_keyword_rank', [], [{ _asin: 'B09B7YS1VK' }])).reportKey, 'si_rank_b09b7ys1vk')
  const unknown = await derive('scale_insights_keyword_rank', [], [{ _asin: 'B0NOTREAL99' }])
  assert.equal(unknown.reportKey, null)
  assert.ok(unknown.warning)
})

test('derive: SI change-log by log_type, bid-log static', async () => {
  assert.equal((await derive('scale_insights_rule_change_log', [], [{ log_type: 'import' }])).reportKey, 'si_import_log')
  assert.equal((await derive('scale_insights_rule_change_log', [], [{ log_type: 'negative' }])).reportKey, 'si_negative_log')
  assert.equal((await derive('scale_insights_rule_change_log', [], [{ log_type: 'revive' }])).reportKey, 'si_revive_log')
  assert.equal((await derive('scale_insights_bid_log', [], [{}])).reportKey, 'si_bid_log')
})

test('derive: assignments split on the Bidding Rules header', async () => {
  assert.equal((await derive('scale_insights_rule_assignments', ['Sponsored', 'Campaign', 'Bidding Rules', 'Daily Budget Rules'], [{}])).reportKey, 'si_rules_assigned')
  assert.equal((await derive('scale_insights_rule_assignments', ['Sponsored', 'Portfolio', 'Campaign', 'AdGroup', 'Last 30 Days Ad Spend'], [{}])).reportKey, 'si_rules_unassigned')
})

test('derive: a type with no registry mapping → null + warning', async () => {
  const r = await derive('smartscout_brand_revenue', [], [{}])
  assert.equal(r.reportKey, null)
  assert.ok(r.warning)
})

test('derive: every produced report_key exists in the seed', async () => {
  const { REPORT_REGISTRY_SEED } = await import('../lib/report-registry.ts')
  const keys = new Set(REPORT_REGISTRY_SEED.map(r => r.report_key))
  const produced = [
    (await derive('sp_campaign_performance__sp', [], [{ ad_type: 'SP' }])).reportKey,
    (await derive('smartscout_subcategory_brands', [], [{ subcategory: 'toilet_bowl_cleaner' }])).reportKey,
    (await derive('scale_insights_rule_change_log', [], [{ log_type: 'revive' }])).reportKey,
    (await derive('scale_insights_keyword_rank', [], [{ _asin: 'B0FQPMNJ6Z' }])).reportKey,
  ]
  for (const k of produced) assert.ok(k && keys.has(k), `${k} is a seeded report_key`)
})

// ---------------------------------------------------------------------------
// Period-date gate — registry-driven (RED: rule_assignments newly gated)
// ---------------------------------------------------------------------------

test('gate: scale_insights_rule_assignments now requires period dates', async () => {
  const { requiresPeriodDates } = await import('../lib/ingest-validation.ts')
  assert.equal(requiresPeriodDates('scale_insights_rule_assignments'), true)
})

test('gate pinning: existing detector types keep their exact date-gate flags', async () => {
  const { requiresPeriodDates } = await import('../lib/ingest-validation.ts')
  const TRUE_TYPES = ['business_report', 'smartscout_subcategory_brands', 'smartscout_subcategory_products']
  const FALSE_TYPES = [
    'sp_campaign_performance', 'sp_search_term_report', 'sp_targeting_report',
    'purchased_product_report', 'search_query_performance', 'brand_analytics_customer_loyalty',
    'business_report_daily', 'subscribe_and_save', 'virtual_bundle_sales_snapshots',
    'virtual_bundle_sales_daily', 'scale_insights_keyword_rank', 'scale_insights_bid_log',
    'scale_insights_rule_change_log', 'smartscout_brand_revenue', 'smartscout_share_of_voice', 'unknown',
  ]
  for (const t of TRUE_TYPES) assert.equal(requiresPeriodDates(t), true, `${t} stays gated`)
  for (const t of FALSE_TYPES) assert.equal(requiresPeriodDates(t), false, `${t} stays ungated`)
})

// ---------------------------------------------------------------------------
// DB↔TS mirror diff (pure)
// ---------------------------------------------------------------------------

test('mirror diff: identical row sets → no differences', async () => {
  const { diffRegistrySeed } = await import('../lib/report-registry-check.ts')
  const rows = [{ report_key: 'a', display_name: 'A', source_group: 'SmartScout', cadence: 'weekly', pull_period: null, target_table: 't', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 1, notes: null }]
  const diff = diffRegistrySeed(rows, rows.map(r => ({ ...r })))
  assert.deepEqual(diff, [])
})

test('mirror diff: a changed field and a missing row are both reported', async () => {
  const { diffRegistrySeed } = await import('../lib/report-registry-check.ts')
  const ts = [
    { report_key: 'a', display_name: 'A', source_group: 'SmartScout', cadence: 'weekly', pull_period: null, target_table: 't', discriminator: { column: 'c', values: ['x'] }, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
    { report_key: 'b', display_name: 'B', source_group: 'SmartScout', cadence: 'weekly', pull_period: null, target_table: 't', discriminator: null, requires_period_dates: false, is_active: true, sort_order: 2, notes: null },
  ]
  const db = [
    { report_key: 'a', display_name: 'A', source_group: 'SmartScout', cadence: 'weekly', pull_period: null, target_table: 't', discriminator: { values: ['y'], column: 'c' }, requires_period_dates: false, is_active: true, sort_order: 1, notes: null },
  ]
  const diff = diffRegistrySeed(ts, db)
  assert.ok(diff.some(d => d.report_key === 'a' && /discriminator/.test(d.reason)), 'changed discriminator flagged')
  assert.ok(diff.some(d => d.report_key === 'b' && /missing/i.test(d.reason)), 'missing-in-db row flagged')
})

// ---------------------------------------------------------------------------
// e2e: the ingestion-log row carries the derived report_key
// ---------------------------------------------------------------------------

const logInserts: Record<string, unknown>[] = []
const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') return send(200, wantsObject ? {} : [])
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/report_ingestion_log')) {
      try { const b = JSON.parse(raw); logInserts.push(Array.isArray(b) ? b[0] : b) } catch { /* ignore */ }
    }
    return send(wantsObject ? 200 : 201, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const IMPORT_LOG_CSV = [
  '﻿Created,ASIN,SKU,ShortName,Campaign,AdGroup,Keyword,Action,Rule,Criteria,Change,Code,Details',
  '2026-07-09,B09B83NFKQ,110146-FBA,,SP.BR.KT - Catch All,Performance Broad,dirty labs detergent,Import Rule,Import Branded Discovery to Exact,">=1 Order",exact (1.45),,',
].join('\n')

test('e2e: import-rule upload logs report_key=si_import_log', async () => {
  logInserts.length = 0
  const body = new FormData()
  body.append('file', new File([IMPORT_LOG_CSV], 'ImportRule_ChangeLogs.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  assert.ok(logInserts.length >= 1, 'an ingestion-log row was written')
  assert.equal(logInserts[0].report_key, 'si_import_log')
})
