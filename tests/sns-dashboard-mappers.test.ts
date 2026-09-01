// INB-144 — S&S Dashboard mappers (daily unpivot + snapshot dims) and the strict-mapping helper.
// INB-167 — per-report exact-header mapping (the norm() collapse was the sns_sales corruption bug).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  mapSnsDashboardDaily, unmappedSnsDailyColumns, snsDailyRangeViolations,
  identifySnsDailyReport, SNS_DAILY_REPORTS,
} from '../lib/mappers/sns-dashboard-daily.ts'
import { mapSnsDashboardSnapshots } from '../lib/mappers/sns-dashboard-snapshots.ts'
import { deriveReportKey } from '../lib/report-registry.ts'
import { parseCSV } from '../lib/csv-parser.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Fixtures are byte-exact copies of the real export headers (internal whitespace preserved).
const fixture = (name: string) => parseCSV(readFileSync(`tests/fixtures/${name}`, 'utf8'))

// ── daily unpivot ──────────────────────────────────────────────────────────────
test('daily: a Sales row → 2 metric rows, timestamp sliced to date', () => {
  const row = { 'calc_date_granularity': '2026-07-10 00:00:00', 'Reorder (CUSTOM)': '35057.31', 'Subscribe & Save (CUSTOM)': '17309.5' }
  const out = mapSnsDashboardDaily(row, BRAND)
  assert.deepEqual(out, [
    { brand_id: BRAND, metric_date: '2026-07-10', metric: 'reorder_sales', value: 35057.31 },
    { brand_id: BRAND, metric_date: '2026-07-10', metric: 'sns_sales', value: 17309.5 },
  ])
})

test('daily: LY columns unpivot to _ly slugs (Subscription Count)', () => {
  const row = { 'calc_date_granularity': '2026-07-11 00:00:00', 'Last Year Active Subscriptions (CUSTOM)': '55462', 'Active Subscriptions (CUSTOM)': '64532' }
  const out = mapSnsDashboardDaily(row, BRAND)
  const byMetric = Object.fromEntries(out.map(r => [r.metric, r.value]))
  assert.deepEqual(byMetric, { active_subscriptions_ly: 55462, active_subscriptions: 64532 })
  assert.ok(out.every(r => r.metric_date === '2026-07-11'))
})

test('daily: a blank/undated row yields no metric rows (never a null metric_date)', () => {
  const out = mapSnsDashboardDaily({ 'calc_date_granularity': '', 'Reorder (CUSTOM)': '1' }, BRAND)
  assert.deepEqual(out, [])
})

// ── strict mapping helper ────────────────────────────────────────────────────────
test('unmappedSnsDailyColumns: fully-mapped file → []', () => {
  assert.deepEqual(unmappedSnsDailyColumns(['calc_date_granularity', 'Reorder (CUSTOM)', 'Subscribe & Save (CUSTOM)']), [])
})

test('unmappedSnsDailyColumns: an unknown metric column is returned by its original name', () => {
  assert.deepEqual(
    unmappedSnsDailyColumns(['calc_date_granularity', 'Reorder (CUSTOM)', 'New Widget (CUSTOM)']),
    ['New Widget (CUSTOM)'],
  )
})

test('SNS_DAILY_REPORTS: 6 reports, unique signatures, every slug reachable', () => {
  assert.equal(SNS_DAILY_REPORTS.length, 6) // INB-173: +sns_dashboard_coupon_driven
  const sigs = SNS_DAILY_REPORTS.map(r => r.signature)
  assert.equal(new Set(sigs).size, 6, 'signatures are unique')
  const keys = SNS_DAILY_REPORTS.map(r => r.reportKey)
  assert.equal(new Set(keys).size, 6, 'report_keys are unique')
  // Every report's signature is one of its own columns (so an identified file always maps ≥1 col).
  for (const r of SNS_DAILY_REPORTS) assert.ok(r.signature in r.columns, `${r.reportKey} signature is a column`)
})

// ── INB-167: per-report mapping fix (built from the REAL export bytes) ────────────
test('INB-167 fix: the real Share export maps to sns_sales_share + reorder_rate (was sns_sales → NULL)', () => {
  const p = fixture('sns-daily-share.csv')
  // Report is identified by the Reorder Rate signature (survives any S&S whitespace).
  assert.equal(identifySnsDailyReport(p.headers)?.reportKey, 'sns_dashboard_reorder_share')
  const metrics = mapSnsDashboardDaily(p.rows[0], BRAND).map(r => r.metric).sort()
  assert.deepEqual(metrics, ['reorder_rate', 'sns_sales_share'], 'S&S %-column now maps to sns_sales_share, NOT sns_sales')
  // The actual fix outcome: report_key resolves (was NULL → 400 under the old flat norm map).
  const mapped = mapSnsDashboardDaily(p.rows[0], BRAND)
  assert.equal(deriveReportKey('sns_dashboard_daily', p.headers, mapped as Record<string, unknown>[]).reportKey, 'sns_dashboard_reorder_share')
})

test('INB-167 signature match is EXACT equality: the Share file does NOT match the Sales signature', () => {
  // "Reorder (CUSTOM)" is a strict PREFIX of "Reorder Rate (CUSTOM)". If identification used
  // includes/startsWith/regex, the Share file would match the Sales signature and the fix is defeated.
  const share = fixture('sns-daily-share.csv')
  assert.equal(identifySnsDailyReport(share.headers)?.reportKey, 'sns_dashboard_reorder_share')
  // The Sales signature string is NOT among the Share file's exact headers.
  const salesSig = SNS_DAILY_REPORTS.find(r => r.reportKey === 'sns_dashboard_sales')!.signature
  assert.equal(share.headers.map(h => h.replace(/^﻿/, '').trim()).includes(salesSig), false, 'Share headers must not contain the exact "Reorder (CUSTOM)" string')
})

test('INB-167: the real Sales export still maps to reorder_sales + sns_sales → sns_dashboard_sales', () => {
  const p = fixture('sns-daily-sales.csv')
  assert.equal(identifySnsDailyReport(p.headers)?.reportKey, 'sns_dashboard_sales')
  const metrics = mapSnsDashboardDaily(p.rows[0], BRAND).map(r => r.metric).sort()
  assert.deepEqual(metrics, ['reorder_sales', 'sns_sales'])
})

test('INB-167/173: all 6 real export fixtures identify to distinct reports; no unmapped columns', () => {
  const got = ['sns-daily-sales.csv', 'sns-daily-share.csv', 'sns-daily-subcount.csv', 'sns-daily-coupon-sales.csv', 'sns-daily-coupon-subs.csv', 'sns-daily-coupon-driven.csv']
    .map(f => { const p = fixture(f); return { key: identifySnsDailyReport(p.headers)?.reportKey, unmapped: unmappedSnsDailyColumns(p.headers) } })
  assert.deepEqual(got.map(g => g.key).sort(), ['sns_dashboard_coupon_driven', 'sns_dashboard_coupon_sales', 'sns_dashboard_coupon_subs', 'sns_dashboard_reorder_share', 'sns_dashboard_sales', 'sns_dashboard_subscription_count'])
  for (const g of got) assert.deepEqual(g.unmapped, [], `${g.key} has no unmapped columns`)
})

// ── INB-173: Coupon Driven Sales — the ZERO-STORAGE requirement ────────────────────
// Reorder + Standard are 0 on every row. The mapper MUST still emit their rows: sns_dashboard_daily is
// pairedDiscriminator (INB-168), so a missing metric → no rows → the coverage intersection caps at NULL
// → the whole report reports zero coverage. All three metrics must get a row per date.
test('INB-173 zero-storage: all 3 coupon-driven metrics get a row per date, INCLUDING the all-zero ones', () => {
  const row = { 'calc_date_granularity': '2026-08-28 00:00:00', 'Subscribe & Save Coupon (SUM)': '14567.89', 'Reorder Coupon (SUM)': '0', 'Standard Coupon (SUM)': '0' }
  const out = mapSnsDashboardDaily(row, BRAND)
  assert.deepEqual(out, [
    { brand_id: BRAND, metric_date: '2026-08-28', metric: 'coupon_sales_sns', value: 14567.89 },
    { brand_id: BRAND, metric_date: '2026-08-28', metric: 'coupon_sales_reorder', value: 0 },   // stored, not skipped
    { brand_id: BRAND, metric_date: '2026-08-28', metric: 'coupon_sales_standard', value: 0 },   // stored, not skipped
  ])
})

test('INB-173 zero-storage (real fixture): every date yields all 3 coupon-driven metrics; report_key resolves', () => {
  const p = fixture('sns-daily-coupon-driven.csv')
  assert.equal(identifySnsDailyReport(p.headers)?.reportKey, 'sns_dashboard_coupon_driven')
  const mapped = p.rows.flatMap(r => mapSnsDashboardDaily(r, BRAND))
  // 3 dates × 3 metrics = 9 rows; each date carries all three metric slugs.
  assert.equal(mapped.length, 9)
  const byDate = new Map<string, Set<string>>()
  for (const r of mapped) { const d = r.metric_date as string; (byDate.get(d) ?? byDate.set(d, new Set()).get(d)!).add(r.metric as string) }
  for (const [d, metrics] of byDate) assert.deepEqual([...metrics].sort(), ['coupon_sales_reorder', 'coupon_sales_sns', 'coupon_sales_standard'], `date ${d} has all 3`)
  assert.equal(deriveReportKey('sns_dashboard_daily', p.headers, mapped as Record<string, unknown>[]).reportKey, 'sns_dashboard_coupon_driven')
})

test('INB-167 per-report scoping: "Subscribe & Save (CUSTOM)" means sns_sales under Sales, sns_sales_share under Share', () => {
  // Same exact string, different meaning by report — survives Amazon normalizing the whitespace.
  const salesRow = { 'calc_date_granularity': '2026-08-06 00:00:00', 'Reorder (CUSTOM)': '43627.89', 'Subscribe & Save (CUSTOM)': '21705.9' }
  const shareRow = { 'calc_date_granularity': '2026-08-06 00:00:00', 'Reorder Rate (CUSTOM)': '0.42', 'Subscribe & Save (CUSTOM)': '0.31' }
  assert.equal(mapSnsDashboardDaily(salesRow, BRAND).find(r => r.metric.startsWith('sns'))!.metric, 'sns_sales')
  assert.equal(mapSnsDashboardDaily(shareRow, BRAND).find(r => r.metric.startsWith('sns'))!.metric, 'sns_sales_share')
})

test('INB-167 fossil: the historical "Subscribe and Save (CUSTOM)" form still maps to sns_sales_share under Share', () => {
  const row = { 'calc_date_granularity': '2026-07-20 00:00:00', 'Reorder Rate (CUSTOM)': '0.42', 'Subscribe and Save (CUSTOM)': '0.31' }
  assert.equal(mapSnsDashboardDaily(row, BRAND).find(r => r.metric.startsWith('sns'))!.metric, 'sns_sales_share')
})

// ── INB-167 range guard ───────────────────────────────────────────────────────────
test('snsDailyRangeViolations: sns_sales < 1 and sns_sales_share > 1 are flagged; valid values pass', () => {
  assert.equal(snsDailyRangeViolations([
    { brand_id: BRAND, metric_date: '2026-08-06', metric: 'sns_sales', value: 21705.9 },
    { brand_id: BRAND, metric_date: '2026-08-06', metric: 'sns_sales_share', value: 0.31 },
  ]).length, 0)
  assert.match(snsDailyRangeViolations([{ brand_id: BRAND, metric_date: '2026-08-06', metric: 'sns_sales', value: 0.2626 }])[0], /sns_sales=0.2626/)
  assert.match(snsDailyRangeViolations([{ brand_id: BRAND, metric_date: '2026-08-06', metric: 'sns_sales_share', value: 1.5 }])[0], /sns_sales_share=1.5/)
  // null values never violate.
  assert.equal(snsDailyRangeViolations([{ brand_id: BRAND, metric_date: '2026-08-06', metric: 'sns_sales', value: null }]).length, 0)
})

// ── snapshot dims ────────────────────────────────────────────────────────────────
test('snapshot LTV: segment x purchase_type → report+dim1+dim2+value, date from form', () => {
  const row = { 'calc_customer_segment': 'Established', 'calc_purchase_type': 'Subscribe & Save', 'avg_gms (AVG)': '230.58' }
  const out = mapSnsDashboardSnapshots(row, BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'subscriber_ltv', dim1: 'Established', dim2: 'Subscribe & Save', value: 230.58 }])
})

test('snapshot avg reorders: dim2 empty (dim1 canonicalized to singular — INB-164)', () => {
  const out = mapSnsDashboardSnapshots({ 'calc_is_subscriber': 'Subscribers', 'calc_avg_reorder (CUSTOM)': '3.7561' }, BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'avg_reorders', dim1: 'Subscriber', dim2: '', value: 3.7561 }])
})

test('snapshot retention: 30 Days / 90 Days', () => {
  const out = mapSnsDashboardSnapshots({ 'calc_metric_name': '90 Days', 'calc_retention (CUSTOM)': '0.8407' }, BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'subscriber_retention', dim1: '90 Days', dim2: '', value: 0.8407 }])
})

// ── INB-164: S&S Sales by Number of Deliveries snapshot (new report) ───────────────
// Fixtures are byte-exact copies of the real 2026-08-10 exports.
const uqKey = (r: Record<string, unknown>) => `${r.snapshot_date}|${r.report}|${r.dim1}|${r.dim2}`
const mapSnap = (name: string) =>
  fixture(name).rows.flatMap(r => mapSnsDashboardSnapshots(r, BRAND, { date_range_start: '2026-08-10' }))

test('INB-164 deliveries: real export → 6 rows, report=deliveries_breakdown, dim2="", positive dollars', () => {
  const out = mapSnap('sns-snap-deliveries.csv')
  assert.equal(out.length, 6)
  assert.ok(out.every(r => r.report === 'deliveries_breakdown'), 'all report=deliveries_breakdown')
  assert.ok(out.every(r => r.dim2 === ''), 'dim2 empty string on all six (uq-key guard)')
  assert.ok(out.every(r => typeof r.value === 'number' && (r.value as number) > 0), 'positive dollar values')
  // Segment labels stored VERBATIM (open bucket list — no enum validation).
  assert.deepEqual(out.map(r => r.dim1), [
    'Cancelled subscriptions after 1 delivery',
    'Active subscriptions with 1 delivery',
    'Subscriptions with 2 deliveries',
    'Subscriptions with 3 deliveries',
    'Subscriptions with 4 deliveries',
    'Subscriptions with 5+ deliveries',
  ])
  const total = out.reduce((s, r) => s + Number(r.value), 0)
  assert.ok(Math.abs(total - 6997505.28) < 0.01, `TTM total ${total} ≈ $6,997,505.28`)
})

test('INB-164 deliveries: same file mapped twice → 6 rows on the uq key, not 12', () => {
  const keys = new Set([...mapSnap('sns-snap-deliveries.csv'), ...mapSnap('sns-snap-deliveries.csv')].map(uqKey))
  assert.equal(keys.size, 6)
})

test('INB-164 deliveries open bucket: an unseen segment label is stored verbatim, not dropped', () => {
  const out = mapSnsDashboardSnapshots(
    { 'subs_state_delivery_segment': 'Subscriptions with 6 deliveries', 'shipped_revenue (SUM)': '123.45' },
    BRAND, { date_range_start: '2026-08-10' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-08-10', report: 'deliveries_breakdown', dim1: 'Subscriptions with 6 deliveries', dim2: '', value: 123.45 }])
})

// ── INB-164: avg_reorders label normalization (per-report — avg_reorders ONLY) ─────
test('INB-164 canon: avg_reorders plural labels canonicalize to singular; singular passes through', () => {
  assert.equal(mapSnsDashboardSnapshots({ 'calc_is_subscriber': 'Subscribers', 'calc_avg_reorder (CUSTOM)': '3.7561' }, BRAND, { date_range_start: '2026-07-14' })[0].dim1, 'Subscriber')
  assert.equal(mapSnsDashboardSnapshots({ 'calc_is_subscriber': 'Non-subscribers', 'calc_avg_reorder (CUSTOM)': '1.3258' }, BRAND, { date_range_start: '2026-07-14' })[0].dim1, 'Non-subscriber')
  assert.equal(mapSnsDashboardSnapshots({ 'calc_is_subscriber': 'Subscriber', 'calc_avg_reorder (CUSTOM)': '3.7387' }, BRAND, { date_range_start: '2026-08-10' })[0].dim1, 'Subscriber')
})

// ── INB-164 BLOCKER (fail-first vs a flat global canon): subscriber_ltv holds dim1='Non-Subscriber'
//    (capital S). A global canon lowercases it → matches 'non-subscriber' → rewrites to 'Non-subscriber',
//    changing the uq key so every future LTV upload INSERTs (40→42→44). Per-report scoping preserves it.
test('INB-164 blocker: subscriber_ltv dim1 "Non-Subscriber" (capital S) is preserved byte-exact', () => {
  const out = mapSnap('sns-snap-ltv.csv')
  assert.ok(out.every(r => r.report === 'subscriber_ltv'))
  const dims = [...new Set(out.map(r => r.dim1))].sort()
  assert.deepEqual(dims, ['Established', 'Growing', 'Lost', 'Non-Subscriber'], 'capital-S Non-Subscriber NOT rewritten')
})

test('INB-164 blocker: LTV fixture mapped twice → 8 rows on the uq key, not 16', () => {
  const keys = new Set([...mapSnap('sns-snap-ltv.csv'), ...mapSnap('sns-snap-ltv.csv')].map(uqKey))
  assert.equal(keys.size, 8)
})

// ── INB-172: subscriber_ltv dim2 (calc_purchase_type) is part of uq_sns_dashboard_snapshots.
//    dim1 is already trimmed; dim2 was not, so a padded value would form a DIFFERENT uq key and
//    silently INSERT a duplicate instead of upserting. Trim dim2 too. ──
test('INB-172: subscriber_ltv dim2 is trimmed (padded calc_purchase_type → clean uq key)', () => {
  const out = mapSnsDashboardSnapshots(
    { 'calc_customer_segment': 'Established', 'calc_purchase_type': '  Subscribe & Save  ', 'avg_gms (AVG)': '230.58' },
    BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'subscriber_ltv', dim1: 'Established', dim2: 'Subscribe & Save', value: 230.58 }])
})

test('INB-172: the real LTV fixture is byte-identical after the dim2 trim (clean values unaffected)', () => {
  const out = mapSnap('sns-snap-ltv.csv')
  assert.equal(out.length, 8)
  assert.ok(out.every(r => r.report === 'subscriber_ltv'))
  assert.deepEqual([...new Set(out.map(r => r.dim2))].sort(), ['One-time Purchases', 'Subscribe & Save'])
})

// ── INB-173: the two "Segments" snapshots — THE anti-collision test (most important single test) ────
// Both files start with column "Segments"; they are separated ONLY by their distinct value column.
// If the mapper keyed on "Segments", one report's values would land in the other's slot (INB-167 class).
test('INB-173 anti-collision: the two "Segments" fixtures map to DIFFERENT report values, not the same slot', () => {
  const ltv = mapSnap('sns-snap-customer-ltv.csv')
  const share = mapSnap('sns-snap-customer-share.csv')
  assert.ok(ltv.length > 0 && share.length > 0, 'both produce rows')
  assert.ok(ltv.every(r => r.report === 'customer_ltv_by_segment'), 'Average GMS file → customer_ltv_by_segment')
  assert.ok(share.every(r => r.report === 'customer_share_by_segment'), 'Customer Percentage file → customer_share_by_segment')
  // The reports must be disjoint — neither swallowed the other.
  assert.notEqual(ltv[0].report, share[0].report)
})

test('INB-173 Customer LTV: 3 segments, verbatim dim1, dim2="", dollar values', () => {
  const out = mapSnap('sns-snap-customer-ltv.csv')
  assert.equal(out.length, 3)
  assert.ok(out.every(r => r.report === 'customer_ltv_by_segment' && r.dim2 === ''), 'report + dim2="" on all')
  assert.deepEqual(out.map(r => r.dim1), ['One Time Customer', 'Reorder Customer', 'Subscriber'])
  assert.deepEqual(out.map(r => r.value), [45.67, 123.45, 234.56])
})

test('INB-173 Customer Share: 3 segments, dim2="", fractions summing to ~1.0', () => {
  const out = mapSnap('sns-snap-customer-share.csv')
  assert.equal(out.length, 3)
  assert.ok(out.every(r => r.report === 'customer_share_by_segment' && r.dim2 === ''))
  const total = out.reduce((s, r) => s + Number(r.value), 0)
  assert.ok(Math.abs(total - 1.0) < 1e-9, `customer share sums to ~1.0 (got ${total})`)
})

test('INB-173 Total deliveries: "new_segement" typo header routes correctly, 5 buckets, dim2="", verbatim', () => {
  const out = mapSnap('sns-snap-total-deliveries.csv')
  assert.equal(out.length, 5)
  assert.ok(out.every(r => r.report === 'total_deliveries_breakdown' && r.dim2 === ''))
  assert.deepEqual(out.map(r => r.dim1), ['1 delivery', '2 deliveries', '3 deliveries', '4 deliveries', '5+ deliveries'])
  assert.ok(out.every(r => typeof r.value === 'number' && (r.value as number) > 0))
})

test('INB-173 idempotency: each new snapshot fixture mapped twice → same row count on the uq key (dim2="")', () => {
  for (const [file, n] of [['sns-snap-customer-ltv.csv', 3], ['sns-snap-customer-share.csv', 3], ['sns-snap-total-deliveries.csv', 5]] as const) {
    const keys = new Set([...mapSnap(file), ...mapSnap(file)].map(uqKey))
    assert.equal(keys.size, n, `${file} → ${n} uq keys, not ${2 * n}`)
  }
})

test('INB-173 open bucket: an unseen customer segment / delivery bucket is stored verbatim, not dropped', () => {
  const seg = mapSnsDashboardSnapshots({ 'Segments': 'Lapsed Customer', 'Average GMS': '9.99' }, BRAND, { date_range_start: '2026-08-28' })
  assert.deepEqual(seg, [{ brand_id: BRAND, snapshot_date: '2026-08-28', report: 'customer_ltv_by_segment', dim1: 'Lapsed Customer', dim2: '', value: 9.99 }])
  const del = mapSnsDashboardSnapshots({ 'new_segement': '6+ deliveries', 'shipped_revenue (SUM)': '42.42' }, BRAND, { date_range_start: '2026-08-28' })
  assert.deepEqual(del, [{ brand_id: BRAND, snapshot_date: '2026-08-28', report: 'total_deliveries_breakdown', dim1: '6+ deliveries', dim2: '', value: 42.42 }])
})
