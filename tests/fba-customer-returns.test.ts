// INB-160 — FBA Customer Returns: cp1252 decode, occurrence key, fault_class, warnings,
// reason-map mirror, detection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapFbaCustomerReturns, fbaReturnsWarnings } from '../lib/mappers/fba-customer-returns.ts'
import { RETURN_REASON_BUCKETS, faultClassFor } from '../lib/return-reason-map.ts'
import { detectReportType } from '../lib/report-detector.ts'
import { decodeFileContent } from '../lib/csv-parser.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const HEADERS = ['return-date', 'order-id', 'sku', 'asin', 'fnsku', 'product-name', 'quantity',
  'fulfillment-center-id', 'detailed-disposition', 'reason', 'status', 'license-plate-number', 'customer-comments']

function row(o: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {}
  for (const h of HEADERS) r[h] = ''
  return { ...r, ...o }
}

// ── cp1252 decode ──────────────────────────────────────────────────────────────
test('decodeFileContent: a Windows-1252 smart quote (0x92) decodes intact, not U+FFFD', async () => {
  // "Don<0x92>t like" — 0x92 is invalid UTF-8, valid cp1252 (→ U+2019 right single quote).
  const bytes = new Uint8Array([0x44, 0x6f, 0x6e, 0x92, 0x74, 0x20, 0x6c, 0x69, 0x6b, 0x65])
  const file = { arrayBuffer: async () => bytes.buffer, text: async () => '' }
  const out = await decodeFileContent(file)
  assert.equal(out, 'Don’t like')
  assert.ok(!out.includes('�'), 'no lossy replacement char')
})

test('decodeFileContent: valid UTF-8 is unaffected by the cp1252 fallback', async () => {
  const bytes = new TextEncoder().encode('café — déjà vu')
  const file = { arrayBuffer: async () => bytes.buffer, text: async () => '' }
  assert.equal(await decodeFileContent(file), 'café — déjà vu')
})

// ── detection ────────────────────────────────────────────────────────────────────
test('detectReportType: FBA Customer Returns header → fba_customer_returns', () => {
  const det = detectReportType(HEADERS)
  assert.equal(det.reportType, 'fba_customer_returns')
  assert.equal(det.tableName, 'fba_customer_returns')
})

// ── occurrence key (the multi-unit survival guarantee) ─────────────────────────────
test('mapFbaCustomerReturns: 3 identical rows → occurrence 1/2/3 (all survive), distinct row → 1', () => {
  const ident = { 'return-date': '2026-07-26T06:55:09+00:00', 'order-id': 'O1', 'sku': '110104-FBA', 'reason': 'DEFECTIVE', 'quantity': '1' }
  const rows = [row(ident), row(ident), row(ident),
    row({ 'return-date': '2026-07-26T06:55:09+00:00', 'order-id': 'O2', 'sku': '110106-FBA', 'reason': 'UNWANTED_ITEM', 'quantity': '1' })]
  const out = mapFbaCustomerReturns(rows, BRAND)
  assert.equal(out.length, 4)
  const o1 = out.filter(r => r.order_id === 'O1').map(r => r.occurrence).sort()
  assert.deepEqual(o1, [1, 2, 3])
  assert.equal(out.find(r => r.order_id === 'O2')!.occurrence, 1)
  // the occurrence key is unique across all rows
  const keys = new Set(out.map(r => `${r.return_ts}|${r.order_id}|${r.sku}|${r.lpn}|${r.occurrence}`))
  assert.equal(keys.size, 4)
})

test('mapFbaCustomerReturns: blank LPN groups still get distinct occurrences', () => {
  const base = { 'return-date': '2026-01-02T10:00:00+00:00', 'order-id': 'O9', 'sku': '110124-FBA', 'reason': 'UNWANTED_ITEM' } // no license-plate-number → ''
  const out = mapFbaCustomerReturns([row(base), row(base)], BRAND)
  assert.deepEqual(out.map(r => r.lpn), ['', ''])
  assert.deepEqual(out.map(r => r.occurrence).sort(), [1, 2])
})

// ── field derivation + fault_class + raw comments ──────────────────────────────────
test('mapFbaCustomerReturns: return_date derived from return_ts; fault_class snapshot; comments raw', () => {
  const out = mapFbaCustomerReturns([row({
    'return-date': '2026-07-26T06:55:09+00:00', 'order-id': 'O1', 'sku': '110104-FBA', 'asin': 'B0X',
    'reason': 'SWITCHEROO', 'quantity': '1', 'customer-comments': 'N/A',
  })], BRAND)
  const r = out[0]
  assert.equal(r.return_ts, '2026-07-26T06:55:09+00:00')
  assert.equal(r.return_date, '2026-07-26')
  assert.equal(r.fault_class, 'fraud')          // SWITCHEROO → fraud
  assert.equal(r.customer_comments, 'N/A')        // stored raw, NOT nulled
  assert.equal(r.quantity, 1)
})

test('mapFbaCustomerReturns: empty comment → null; unknown reason → fault_class unmapped', () => {
  const out = mapFbaCustomerReturns([row({ 'return-date': '2026-07-26T00:00:00+00:00', 'order-id': 'O', 'sku': 'S', 'reason': 'NEW_CODE_2027' })], BRAND)
  assert.equal(out[0].customer_comments, null)
  assert.equal(out[0].fault_class, 'unmapped')
})

// ── unmapped warning ───────────────────────────────────────────────────────────────
test('fbaReturnsWarnings: unknown reason codes warned (sorted, de-duped); clean file → []', () => {
  const rows = [row({ 'reason': 'DEFECTIVE' }), row({ 'reason': 'ZZZ_NEW' }), row({ 'reason': 'AAA_NEW' }), row({ 'reason': 'ZZZ_NEW' })]
  const w = fbaReturnsWarnings(rows)
  assert.equal(w.length, 1)
  assert.match(w[0], /AAA_NEW, ZZZ_NEW/)
  assert.deepEqual(fbaReturnsWarnings([row({ 'reason': 'DEFECTIVE' })]), [])
})

// ── reason-map mirror (⇔ 23-code migration seed: 052 + INB-177's RECALL) ───────────
test('RETURN_REASON_BUCKETS: 23 codes with the sign-off bucket counts', () => {
  const codes = Object.keys(RETURN_REASON_BUCKETS)
  assert.equal(codes.length, 23) // INB-177: +RECALL
  const counts = codes.reduce<Record<string, number>>((a, c) => { a[RETURN_REASON_BUCKETS[c]] = (a[RETURN_REASON_BUCKETS[c]] ?? 0) + 1; return a }, {})
  assert.deepEqual(counts, { product_fault: 5, logistics_fault: 5, customer_choice: 11, fraud: 2 }) // product_fault 4→5
  // INB-177 — a product recall buckets as product_fault (operator-confirmed).
  assert.equal(faultClassFor('RECALL'), 'product_fault')
  // the four codes Darren ruled on explicitly
  assert.equal(faultClassFor('SWITCHEROO'), 'fraud')
  assert.equal(faultClassFor('UNDELIVERABLE_REFUSED'), 'customer_choice')
  assert.equal(faultClassFor('NO_REASON_GIVEN'), 'customer_choice')
  assert.equal(faultClassFor('NOT_COMPATIBLE'), 'customer_choice')
  assert.equal(faultClassFor('WHATEVER'), 'unmapped')
})
