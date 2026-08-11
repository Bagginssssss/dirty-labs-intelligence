// INB-144 — deriveReportKey for the 8 S&S Dashboard report_keys (content-derived from
// the mapped `metric` / `report` fields; the two reportTypes fan out to 8 keys).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveReportKey } from '../lib/report-registry.ts'

const daily = (...metrics: string[]) => metrics.map(m => ({ metric: m }))
const snap = (report: string) => [{ report }]

const dailyCases: Array<[string, string[], string]> = [
  ['sns_dashboard_sales', ['reorder_sales', 'sns_sales'], 'sns_dashboard_sales'],
  ['sns_dashboard_reorder_share', ['reorder_rate', 'sns_sales_share'], 'sns_dashboard_reorder_share'],
  ['sns_dashboard_subscription_count', ['active_subscriptions', 'active_subscriptions_ly'], 'sns_dashboard_subscription_count'],
  ['sns_dashboard_coupon_sales', ['coupon_sales_share', 'coupon_sales_share_ly'], 'sns_dashboard_coupon_sales'],
  ['sns_dashboard_coupon_subs', ['coupon_subs_share', 'coupon_subs_share_ly'], 'sns_dashboard_coupon_subs'],
]

for (const [label, metrics, key] of dailyCases) {
  test(`deriveReportKey daily: ${label}`, () => {
    assert.deepEqual(deriveReportKey('sns_dashboard_daily', [], daily(...metrics)), { reportKey: key })
  })
}

const snapCases: Array<[string, string]> = [
  ['subscriber_ltv', 'sns_dashboard_ltv'],
  ['avg_reorders', 'sns_dashboard_avg_reorders'],
  ['subscriber_retention', 'sns_dashboard_retention'],
  ['deliveries_breakdown', 'sns_dashboard_deliveries'], // INB-164
]

for (const [report, key] of snapCases) {
  test(`deriveReportKey snapshot: ${report}`, () => {
    assert.deepEqual(deriveReportKey('sns_dashboard_snapshots', [], snap(report)), { reportKey: key })
  })
}

test('deriveReportKey daily: mixed metrics from two reports → warn (null key)', () => {
  const res = deriveReportKey('sns_dashboard_daily', [], daily('reorder_sales', 'active_subscriptions'))
  assert.equal(res.reportKey, null)
  assert.match(String(res.warning), /span|mixed|multiple/i)
})
