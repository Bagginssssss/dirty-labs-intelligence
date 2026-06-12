// Regression tests for the business_report multi-SKU aggregation fix (INB-108).
//
// Amazon's "Detail Page Sales and Traffic by Child ASIN" can emit two rows for one
// child ASIN (an FBA SKU row with real volume + a non-FBA SKU row with tiny volume).
// Both map to the same asin_id, and the old per-row mapper + last-wins dedup let the
// tiny row overwrite the real one. The batch mapper now groups by child ASIN and sums
// the per-SKU columns instead.
//
// The mapper's mixed type/value import was split into `import type` so Node's bare TS
// type-stripping can load it here without a bundler.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapBusinessReportBatch } from '../lib/mappers/business-report.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const CTX = { date_range_start: '2026-03-01' }

// The confirmed Signature 80 example (child ASIN B09B7YS1VK): an FBA SKU row and a
// non-FBA SKU row that must SUM to 11,901 units / $338,812.34.
const SIG80_FBA: Record<string, string> = {
  '(Child) ASIN': 'B09B7YS1VK',
  'Title': 'Signature 80',
  'Units Ordered': '11,894',
  'Ordered Product Sales': '$338,609.34',
  'Total Order Items': '11,894',
  'Units Refunded': '100',
  'Refund Rate': '88%', // deliberately wrong — must not be borrowed
  'Sessions - Total': '100,000',
  'Featured Offer (Buy Box) Percentage': '95.5%',
  'Unit Session Percentage': '11.89%',
}
const SIG80_NON_FBA: Record<string, string> = {
  '(Child) ASIN': 'B09B7YS1VK',
  'Title': 'Signature 80',
  'Units Ordered': '7',
  'Ordered Product Sales': '$203.00',
  'Total Order Items': '7',
  'Units Refunded': '5',
  'Refund Rate': '71%', // deliberately wrong — must not be borrowed
  'Sessions - Total': '100,000',
  'Featured Offer (Buy Box) Percentage': '95.5%',
  'Unit Session Percentage': '0.01%',
}

test('business_report: two SKU rows for one child ASIN aggregate to the summed totals', () => {
  const out = mapBusinessReportBatch([SIG80_FBA, SIG80_NON_FBA], BRAND, CTX)

  // Collapsed to a single row for the ASIN — not two, not the last-wins tiny row.
  assert.equal(out.length, 1)
  const row = out[0]

  // Summed per-SKU volume columns match the source file totals.
  assert.equal(row.units_ordered, 11_901)
  assert.equal(row.ordered_product_sales, 338_812.34)
  assert.equal(row.total_order_items, 11_901)
  assert.equal(row.units_refunded, 105) // 100 + 5

  // ASIN-level columns are carried (identical across the SKU rows).
  assert.equal(row.sessions_total, 100_000)
  assert.equal(row.buy_box_pct, 95.5)

  // unit_session_pct is RECOMPUTED off the summed units, not carried from a row
  // (neither source row's 11.89% / 0.01% would be correct).
  assert.equal(row.unit_session_pct, (11_901 / 100_000) * 100)

  // refund_rate is RECOMPUTED off the summed refunds ÷ summed units, NOT borrowed
  // from a SKU row (neither 88% nor 71% would be correct).
  assert.equal(row.refund_rate, (105 / 11_901) * 100)

  // Identity columns preserved for downstream FK resolution.
  assert.equal(row._asin, 'B09B7YS1VK')
  assert.equal(row.report_date, '2026-03-01')
})

test('business_report: a single row per ASIN passes through unchanged (no-op)', () => {
  const solo: Record<string, string> = {
    '(Child) ASIN': 'B0XSINGLE1',
    'Title': 'Solo Product',
    'Units Ordered': '10',
    'Ordered Product Sales': '$50.00',
    'Total Order Items': '10',
    'Sessions - Total': '100',
    'Featured Offer (Buy Box) Percentage': '88.8%',
    // Deliberately NOT equal to units/sessions*100 (=10): proves it is carried,
    // not recomputed, for a one-row group.
    'Unit Session Percentage': '99.99%',
  }

  const out = mapBusinessReportBatch([solo], BRAND, CTX)
  assert.equal(out.length, 1)
  const row = out[0]

  assert.equal(row.units_ordered, 10)
  assert.equal(row.ordered_product_sales, 50)
  assert.equal(row.total_order_items, 10)
  assert.equal(row.unit_session_pct, 99.99) // carried unchanged — no recompute
})

test('business_report: distinct ASINs are not merged, multi-SKU group coexists with singletons', () => {
  const other: Record<string, string> = {
    '(Child) ASIN': 'B0OTHER999',
    'Title': 'Other Product',
    'Units Ordered': '42',
    'Ordered Product Sales': '$420.00',
    'Total Order Items': '42',
    'Sessions - Total': '500',
  }

  const out = mapBusinessReportBatch([SIG80_FBA, other, SIG80_NON_FBA], BRAND, CTX)
  // Two groups: the Signature 80 pair collapses to one, the other stays separate.
  assert.equal(out.length, 2)

  const sig = out.find(r => r._asin === 'B09B7YS1VK')
  const oth = out.find(r => r._asin === 'B0OTHER999')
  assert.equal(sig?.units_ordered, 11_901)
  assert.equal(oth?.units_ordered, 42)
})
