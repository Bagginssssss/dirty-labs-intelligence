// INB-141 — deriveReportKey splits the one reportType into brand/asin report_keys on `level`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveReportKey } from '../lib/report-registry.ts'

test('level brand → ba_repeat_purchase_brand', () => {
  assert.deepEqual(deriveReportKey('brand_analytics_repeat_purchase', [], [{ level: 'brand' }]), { reportKey: 'ba_repeat_purchase_brand' })
})

test('level asin → ba_repeat_purchase_asin (many rows, one level)', () => {
  const rows = Array.from({ length: 21 }, () => ({ level: 'asin' }))
  assert.deepEqual(deriveReportKey('brand_analytics_repeat_purchase', [], rows), { reportKey: 'ba_repeat_purchase_asin' })
})

test('mixed levels → warn (null key)', () => {
  const res = deriveReportKey('brand_analytics_repeat_purchase', [], [{ level: 'brand' }, { level: 'asin' }])
  assert.equal(res.reportKey, null)
  assert.match(String(res.warning), /span|mixed|level/i)
})
