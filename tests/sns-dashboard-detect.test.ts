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
  // INB-164 — Sales by Number of Deliveries (subs_state_delivery_segment is unique to this export)
  ['Deliveries breakdown', ['subs_state_delivery_segment', 'shipped_revenue (SUM)'], SNAP],
  // INB-173 — Coupon Driven Sales (daily; the greedy calc_date_granularity signature claims it)
  ['Coupon Driven Sales', ['calc_date_granularity', 'Subscribe & Save Coupon (SUM)', 'Reorder Coupon (SUM)', 'Standard Coupon (SUM)'], DAILY],
  // INB-173 — the two "Segments" snapshots (split on their distinct value column, not "Segments")
  ['Customer LTV by segment', ['Segments', 'Average GMS'], SNAP],
  ['Customer Share by segment', ['Segments', 'Customer Percentage (CUSTOM)'], SNAP],
  // INB-173 — Total deliveries; 'new_segement' is Amazon's misspelling, matched verbatim
  ['Total deliveries breakdown', ['new_segement', 'shipped_revenue (SUM)'], SNAP],
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

// INB-173 anti-collision (detector level): the two "Segments" files share col 1 but must NOT match on
// "segments" alone — each is claimed by its distinct value column, and neither cross-matches the
// deliveries reports. (The report-VALUE split is asserted in the mapper test; here we prove routing.)
test('anti-collision: Customer LTV (Segments+Average GMS) does NOT satisfy the Customer Share signature', () => {
  // Customer Share needs customer_percentage; the LTV file lacks it → only the LTV signature can match.
  assert.equal(detectReportType(['Segments', 'Average GMS']).tableName, 'sns_dashboard_snapshots')
})
test('anti-collision: new_segement (typo) is distinct from subs_state_delivery_segment and from "segments"', () => {
  // The all-sales deliveries file must not be swallowed by INB-164's deliveries signature nor by either
  // Segments signature — "segments" is not a substring of "new_segement" (which carries "segement").
  const det = detectReportType(['new_segement', 'shipped_revenue (SUM)'])
  assert.equal(det.reportType, 'sns_dashboard_snapshots')
})
