// INB-144 — detection for the 8 S&S Dashboard exports (2 reportTypes → 1 table each).
//
// The 5 dailies all share col 1 `calc_date_granularity` → one greedy signature claims them
// (report_key is content-derived downstream). The 3 snapshots have distinctive first columns
// → three signatures, all → sns_dashboard_snapshots. Real headers, verified against the
// attached CSVs (BOM already stripped by the parser before detection).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectReportType } from '../lib/report-detector.ts'

const DAILY = 'sns_dashboard_daily'
const SNAP = 'sns_dashboard_snapshots'

const cases: Array<[string, string[], string]> = [
  ['Sales', ['calc_date_granularity', 'Reorder (CUSTOM)', 'Subscribe & Save (CUSTOM)'], DAILY],
  ['Reorder/S&S share', ['calc_date_granularity', 'Reorder Rate (CUSTOM)', 'Subscribe and Save (CUSTOM)'], DAILY],
  ['Subscription Count', ['calc_date_granularity', 'Last Year Active Subscriptions (CUSTOM)', 'Active Subscriptions (CUSTOM)'], DAILY],
  ['Coupon Sales Share', ['calc_date_granularity', 'Last Year Coupon Sales Share (CUSTOM)', 'Coupon Sales Share (CUSTOM)'], DAILY],
  // double space before (CUSTOM) in the real file — must still resolve
  ['Coupon Subs Share', ['calc_date_granularity', 'Last Year Share of Coupon Subscriptions  (CUSTOM)', 'Share of Coupon Subscriptions (CUSTOM)'], DAILY],
  ['Subscriber LTV', ['calc_customer_segment', 'calc_purchase_type', 'avg_gms (AVG)'], SNAP],
  ['Avg Reorders', ['calc_is_subscriber', 'calc_avg_reorder (CUSTOM)'], SNAP],
  ['Subscriber Retention', ['calc_metric_name', 'calc_retention (CUSTOM)'], SNAP],
]

for (const [label, headers, table] of cases) {
  test(`detect: ${label} → ${table}`, () => {
    const det = detectReportType(headers)
    assert.equal(det.tableName, table)
    assert.equal(det.reportType, table) // reportType === target_table for these
  })
}

test('collision guard: Subscription Count (has "Active Subscriptions") is a daily, NOT subscribe_and_save', () => {
  // The existing subscribe_and_save signature matches on `active_subscriptions`; the daily
  // signature MUST precede it so this file — which carries calc_date_granularity — is claimed
  // as sns_dashboard_daily, not the S&S Performance report.
  const det = detectReportType(['calc_date_granularity', 'Last Year Active Subscriptions (CUSTOM)', 'Active Subscriptions (CUSTOM)'])
  assert.equal(det.reportType, 'sns_dashboard_daily')
})

test('no regression: a real S&S Performance header set (active_subscriptions, no calc_date_granularity) still → subscribe_and_save', () => {
  const det = detectReportType(['ASIN', 'SKU', 'Active Subscriptions', 'Total Subscriptions'])
  assert.equal(det.reportType, 'subscribe_and_save')
})
