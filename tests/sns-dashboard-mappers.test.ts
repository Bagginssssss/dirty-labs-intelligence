// INB-144 — S&S Dashboard mappers (daily unpivot + snapshot dims) and the strict-mapping helper.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapSnsDashboardDaily, unmappedSnsDailyColumns, SNS_DAILY_SLUG_MAP } from '../lib/mappers/sns-dashboard-daily.ts'
import { mapSnsDashboardSnapshots } from '../lib/mappers/sns-dashboard-snapshots.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

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

test('SNS_DAILY_SLUG_MAP covers all 10 known columns', () => {
  assert.equal(Object.keys(SNS_DAILY_SLUG_MAP).length, 10)
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
