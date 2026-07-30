// INB-162 — SKU Economics mapper: dynamic triplet detection, component flagging,
// active/skip boundary, MM/DD/YYYY parse, fee-row derivation, and the non-fatal warnings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectFeeTriplets,
  isActiveSkuEconRow,
  mapSkuEconomicsWeekly,
  buildSkuEconomicsFees,
  skuEconomicsWarnings,
  COMPONENT_FEES,
} from '../lib/mappers/sku-economics.ts'
import { detectReportType } from '../lib/report-detector.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// The identity/sales columns + a representative set of fee triplets + the two lone per-unit
// COGS/Misc columns + the two net-proceeds outputs (mirrors the real 51-col shape at smaller scale).
const HEADERS = [
  'Amazon store', 'Start date', 'End date', 'Parent ASIN', 'ASIN', 'FNSKU', 'MSKU', 'Currency code',
  'Average sales price', 'Units sold', 'Units returned', 'Net units sold', 'Sales', 'Net sales',
  'Base fulfillment fee per unit', 'Base fulfillment fee quantity', 'Base fulfillment fee total',
  'Fuel and Logistics-related surcharge per unit', 'Fuel and Logistics-related surcharge quantity', 'Fuel and Logistics-related surcharge total',
  'FBA fulfillment fees per unit', 'FBA fulfillment fees quantity', 'FBA fulfillment fees total',
  'Referral fee per unit', 'Referral fee quantity', 'Referral fee total',
  'Sponsored Products charge per unit', 'Sponsored Products charge quantity', 'Sponsored Products charge total',
  'Cost of goods sold per unit', 'Miscellaneous cost per unit',
  'Net proceeds total', 'Net proceeds per net unit sold',
]

function rowOf(overrides: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {}
  for (const h of HEADERS) r[h] = ''
  return { ...r, ...overrides }
}

// A normal sales row: net proceeds = net_sales − (FBA fulfillment + Referral + SP charge),
// base+fuel are COMPONENTS excluded from the sum. 100 − (4 + 15 + 5) = 76.
const SALES_ROW = rowOf({
  'Amazon store': 'US', 'Start date': '07/19/2026', 'End date': '07/25/2026',
  'Parent ASIN': 'B0PARENT', 'ASIN': 'B0ASIN01', 'MSKU': '110124-FBA', 'Currency code': 'USD',
  'Average sales price': '10.00', 'Units sold': '10', 'Units returned': '2', 'Net units sold': '8',
  'Sales': '120.00', 'Net sales': '100.00',
  'Base fulfillment fee per unit': '0.30', 'Base fulfillment fee quantity': '10', 'Base fulfillment fee total': '3.00',
  'Fuel and Logistics-related surcharge per unit': '0.10', 'Fuel and Logistics-related surcharge quantity': '10', 'Fuel and Logistics-related surcharge total': '1.00',
  'FBA fulfillment fees per unit': '0.40', 'FBA fulfillment fees quantity': '10', 'FBA fulfillment fees total': '4.00',
  'Referral fee per unit': '1.50', 'Referral fee quantity': '10', 'Referral fee total': '15.00',
  'Sponsored Products charge per unit': '0.50', 'Sponsored Products charge quantity': '10', 'Sponsored Products charge total': '5.00',
  'Net proceeds total': '76.00', 'Net proceeds per net unit sold': '9.50',
})

// A fee-only reconciliation row: no units, no sales, but a fee → kept (net proceeds −4.09).
const FEE_ONLY_ROW = rowOf({
  'Amazon store': 'US', 'Start date': '07/19/2026', 'End date': '07/25/2026',
  'ASIN': 'B0ASIN02', 'MSKU': 'Amazon.Found.B0ASIN02',
  'FBA fulfillment fees total': '4.09',
  'Net proceeds total': '-4.09',
})

// Fully inert: everything empty/zero → skipped.
const INERT_ROW = rowOf({ 'Amazon store': 'US', 'Start date': '07/19/2026', 'End date': '07/25/2026', 'MSKU': '110999', 'Units sold': '0', 'Net sales': '0' })

// ── detection ────────────────────────────────────────────────────────────────────
test('detectReportType: SKU Economics header → sku_economics_weekly', () => {
  const det = detectReportType(HEADERS)
  assert.equal(det.reportType, 'sku_economics_weekly')
  assert.equal(det.tableName, 'sku_economics_weekly')
})

test('detectReportType: a business-report header does NOT route to sku_economics_weekly', () => {
  const det = detectReportType(['Date', 'Sessions - Total', 'Page Views - Total', 'Child ASIN'])
  assert.notEqual(det.reportType, 'sku_economics_weekly')
})

// ── triplet detection ────────────────────────────────────────────────────────────
test('detectFeeTriplets: finds all 5 triplets, ignores lone per-unit + total-only columns', () => {
  const triplets = detectFeeTriplets(HEADERS)
  const names = triplets.map(t => t.feeType).sort()
  assert.deepEqual(names, [
    'Base fulfillment fee', 'FBA fulfillment fees', 'Fuel and Logistics-related surcharge',
    'Referral fee', 'Sponsored Products charge',
  ])
  // "Cost of goods sold" / "Miscellaneous cost" (per-unit only) and "Net proceeds" (total only) excluded.
  assert.ok(!names.includes('Cost of goods sold'))
  assert.ok(!names.includes('Net proceeds'))
})

test('COMPONENT_FEES flags exactly the two components present in the fixture', () => {
  const triplets = detectFeeTriplets(HEADERS)
  const comp = triplets.filter(t => COMPONENT_FEES.has(t.feeType)).map(t => t.feeType).sort()
  assert.deepEqual(comp, ['Base fulfillment fee', 'Fuel and Logistics-related surcharge'])
})

test('COMPONENT_FEES covers both rollup component pairs (INB-162 addendum: storage rollup)', () => {
  // Fulfillment rollup: Base fulfillment fee + Fuel surcharge = FBA fulfillment fees.
  // Storage rollup:     Base monthly storage fee + Storage utilization surcharge = Monthly inventory storage fee.
  assert.ok(COMPONENT_FEES.has('Base fulfillment fee'))
  assert.ok(COMPONENT_FEES.has('Fuel and Logistics-related surcharge'))
  assert.ok(COMPONENT_FEES.has('Base monthly storage fee'))
  assert.ok(COMPONENT_FEES.has('Storage utilization surcharge'))
  assert.equal(COMPONENT_FEES.size, 4)
})

// ── active / skip boundary ─────────────────────────────────────────────────────────
test('isActiveSkuEconRow: sales row active, fee-only row active, inert row skipped', () => {
  const triplets = detectFeeTriplets(HEADERS)
  assert.equal(isActiveSkuEconRow(SALES_ROW, triplets), true)
  assert.equal(isActiveSkuEconRow(FEE_ONLY_ROW, triplets), true)   // kept per the 26-row decision
  assert.equal(isActiveSkuEconRow(INERT_ROW, triplets), false)
})

// ── weekly mapper ──────────────────────────────────────────────────────────────────
test('mapSkuEconomicsWeekly: 2 active rows kept (inert dropped), dates + fields parsed', () => {
  const out = mapSkuEconomicsWeekly([SALES_ROW, FEE_ONLY_ROW, INERT_ROW], BRAND)
  assert.equal(out.length, 2)
  const a = out[0]
  assert.equal(a.week_start, '2026-07-19')
  assert.equal(a.week_end, '2026-07-25')
  assert.equal(a.marketplace, 'US')
  assert.equal(a.msku, '110124-FBA')
  assert.equal(a.asin, 'B0ASIN01')
  assert.equal(a.units_sold, 10)
  assert.equal(a.net_units_sold, 8)
  assert.equal(a.net_sales, 100)
  assert.equal(a.net_proceeds_total, 76)
  assert.equal(a.fnsku, null)          // empty FNSKU → null
})

// ── fee rows ─────────────────────────────────────────────────────────────────────
test('buildSkuEconomicsFees: one row per (weekly row × present fee), key mirrors parent, is_component set', () => {
  const fees = buildSkuEconomicsFees([SALES_ROW, FEE_ONLY_ROW, INERT_ROW], BRAND)
  // SALES_ROW: 5 present triplets. FEE_ONLY_ROW: only FBA fulfillment fees present. INERT: none.
  assert.equal(fees.length, 6)

  const salesFees = fees.filter(f => f.msku === '110124-FBA')
  assert.equal(salesFees.length, 5)
  const byType = Object.fromEntries(salesFees.map(f => [f.fee_type, f]))
  assert.equal(byType['Base fulfillment fee'].is_component, true)
  assert.equal(byType['Fuel and Logistics-related surcharge'].is_component, true)
  assert.equal(byType['FBA fulfillment fees'].is_component, false)
  assert.equal(byType['Referral fee'].total, 15)
  assert.equal(byType['Referral fee'].quantity, 10)
  assert.equal(byType['Sponsored Products charge'].total, 5)
  // parent-key mirroring
  assert.equal(byType['Referral fee'].week_start, '2026-07-19')
  assert.equal(byType['Referral fee'].marketplace, 'US')
  assert.equal(byType['Referral fee'].asin, 'B0ASIN01')

  const feeOnly = fees.filter(f => f.msku === 'Amazon.Found.B0ASIN02')
  assert.equal(feeOnly.length, 1)
  assert.equal(feeOnly[0].fee_type, 'FBA fulfillment fees')
  assert.equal(feeOnly[0].total, 4.09)
})

test('buildSkuEconomicsFees: credits stored as negative totals, signs unflipped', () => {
  const creditRow = rowOf({
    'Amazon store': 'US', 'Start date': '07/19/2026', 'End date': '07/25/2026', 'ASIN': 'B0ASIN03', 'MSKU': 'SKU3',
    'Units sold': '1', 'Net sales': '10',
    'Referral fee per unit': '-1.00', 'Referral fee quantity': '1', 'Referral fee total': '-1.00',
    'Net proceeds total': '11.00',
  })
  const fees = buildSkuEconomicsFees([creditRow], BRAND)
  const ref = fees.find(f => f.fee_type === 'Referral fee')!
  assert.equal(ref.total, -1)
})

// ── warnings ─────────────────────────────────────────────────────────────────────
test('skuEconomicsWarnings: clean file → no warnings', () => {
  assert.deepEqual(skuEconomicsWarnings([SALES_ROW, FEE_ONLY_ROW, INERT_ROW]), [])
})

test('skuEconomicsWarnings: net-proceeds identity violation is flagged', () => {
  // Same as SALES_ROW but net proceeds is wrong (should be 76, file says 80 → delta 4).
  const bad = { ...SALES_ROW, 'Net proceeds total': '80.00' }
  const w = skuEconomicsWarnings([bad])
  assert.equal(w.length, 1)
  assert.match(w[0], /net-proceeds identity/)
})

test('skuEconomicsWarnings: populated COGS/Misc column is flagged loudly', () => {
  const withCogs = { ...SALES_ROW, 'Cost of goods sold per unit': '2.50' }
  const w = skuEconomicsWarnings([withCogs])
  assert.ok(w.some(m => /Cost of goods sold/.test(m)))
})
