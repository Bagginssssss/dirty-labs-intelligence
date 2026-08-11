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

test('SNS_DAILY_REPORTS: 5 reports, unique signatures, every slug reachable', () => {
  assert.equal(SNS_DAILY_REPORTS.length, 5)
  const sigs = SNS_DAILY_REPORTS.map(r => r.signature)
  assert.equal(new Set(sigs).size, 5, 'signatures are unique')
  const keys = SNS_DAILY_REPORTS.map(r => r.reportKey)
  assert.equal(new Set(keys).size, 5, 'report_keys are unique')
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

test('INB-167: all 5 real export fixtures identify to distinct reports; no unmapped columns', () => {
  const got = ['sns-daily-sales.csv', 'sns-daily-share.csv', 'sns-daily-subcount.csv', 'sns-daily-coupon-sales.csv', 'sns-daily-coupon-subs.csv']
    .map(f => { const p = fixture(f); return { key: identifySnsDailyReport(p.headers)?.reportKey, unmapped: unmappedSnsDailyColumns(p.headers) } })
  assert.deepEqual(got.map(g => g.key).sort(), ['sns_dashboard_coupon_sales', 'sns_dashboard_coupon_subs', 'sns_dashboard_reorder_share', 'sns_dashboard_sales', 'sns_dashboard_subscription_count'])
  for (const g of got) assert.deepEqual(g.unmapped, [], `${g.key} has no unmapped columns`)
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

test('snapshot avg reorders: dim2 empty', () => {
  const out = mapSnsDashboardSnapshots({ 'calc_is_subscriber': 'Subscribers', 'calc_avg_reorder (CUSTOM)': '3.7561' }, BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'avg_reorders', dim1: 'Subscribers', dim2: '', value: 3.7561 }])
})

test('snapshot retention: 30 Days / 90 Days', () => {
  const out = mapSnsDashboardSnapshots({ 'calc_metric_name': '90 Days', 'calc_retention (CUSTOM)': '0.8407' }, BRAND, { date_range_start: '2026-07-14' })
  assert.deepEqual(out, [{ brand_id: BRAND, snapshot_date: '2026-07-14', report: 'subscriber_retention', dim1: '90 Days', dim2: '', value: 0.8407 }])
})
