// INB-162 — COGS loader: parse/validate, detection, and the SCD-2 planner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAndValidateCogs, planCogsWrite } from '../lib/mappers/cogs.ts'
import { detectReportType } from '../lib/report-detector.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const HEADERS = ['Class', 'Tags Level 1', 'Internal DL SKU (Primary)', 'Product Description', 'Avg/Cost']

function rowOf(o: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {}
  for (const h of HEADERS) r[h] = ''
  return { ...r, ...o }
}

// ── detection ────────────────────────────────────────────────────────────────────
test('detectReportType: COGS sheet header → cogs', () => {
  const det = detectReportType(HEADERS)
  assert.equal(det.reportType, 'cogs')
  assert.equal(det.tableName, 'cogs')
})

// ── parse + validate ───────────────────────────────────────────────────────────────
test('parseAndValidateCogs: maps SKU/cost/notes, ignores Tags', () => {
  const { valid, rejected } = parseAndValidateCogs([
    rowOf({ 'Class': 'Amazon', 'Tags Level 1': 'OTP', 'Internal DL SKU (Primary)': '110106', 'Product Description': 'Signature Detergent', 'Avg/Cost': '8.10' }),
  ])
  assert.equal(rejected.length, 0)
  assert.deepEqual(valid, [{ internal_sku: '110106', unit_cost: 8.1, notes: 'Signature Detergent' }])
})

test('parseAndValidateCogs: rejects non-Amazon Class, empty SKU, unparseable cost, in-file dup', () => {
  const { valid, rejected } = parseAndValidateCogs([
    rowOf({ 'Class': 'Amazon', 'Internal DL SKU (Primary)': '110106', 'Avg/Cost': '8.10' }),
    rowOf({ 'Class': 'Walmart', 'Internal DL SKU (Primary)': '999', 'Avg/Cost': '1.00' }),       // non-Amazon
    rowOf({ 'Class': 'Amazon', 'Internal DL SKU (Primary)': '',    'Avg/Cost': '2.00' }),          // empty SKU
    rowOf({ 'Class': 'Amazon', 'Internal DL SKU (Primary)': '110107', 'Avg/Cost': 'n/a' }),        // bad cost
    rowOf({ 'Class': 'Amazon', 'Internal DL SKU (Primary)': '110106', 'Avg/Cost': '9.00' }),       // dup SKU
  ])
  assert.deepEqual(valid.map(v => v.internal_sku), ['110106'])
  assert.equal(rejected.length, 4)
  assert.match(rejected[0].reason, /non-Amazon Class/)
  assert.match(rejected[1].reason, /empty Internal DL SKU/)
  assert.match(rejected[2].reason, /unparseable Avg\/Cost/)
  assert.match(rejected[3].reason, /duplicate Internal DL SKU/)
})

test('parseAndValidateCogs: full-precision cost preserved', () => {
  const { valid } = parseAndValidateCogs([rowOf({ 'Class': 'Amazon', 'Internal DL SKU (Primary)': 'X', 'Avg/Cost': '4.12345' })])
  assert.equal(valid[0].unit_cost, 4.12345)
})

// ── SCD-2 planner ──────────────────────────────────────────────────────────────────
test('planCogsWrite: initial load (no existing) → all inserts at effectiveDate, open', () => {
  const inc = [
    { internal_sku: '110106', unit_cost: 8.1, notes: null },
    { internal_sku: '110104', unit_cost: 4.5, notes: 'x' },
  ]
  const plan = planCogsWrite(BRAND, [], inc, '2026-01-01')
  assert.equal(plan.toInsert.length, 2)
  assert.equal(plan.toClose.length, 0)
  assert.equal(plan.unchanged, 0)
  assert.deepEqual(plan.toInsert[0], { brand_id: BRAND, internal_sku: '110106', msku: '', unit_cost: 8.1, valid_from: '2026-01-01', valid_to: null, notes: null })
})

test('planCogsWrite: unchanged cost → no-op; changed → close old + insert new; new SKU → insert', () => {
  const existing = [
    { id: 'id-106', internal_sku: '110106', unit_cost: 8.1, valid_from: '2026-01-01' },
    { id: 'id-104', internal_sku: '110104', unit_cost: 4.5, valid_from: '2026-01-01' },
  ]
  const incoming = [
    { internal_sku: '110106', unit_cost: 8.1, notes: null },   // unchanged
    { internal_sku: '110104', unit_cost: 4.75, notes: null },  // changed
    { internal_sku: '110999', unit_cost: 2.0, notes: 'new' },  // new SKU
  ]
  const plan = planCogsWrite(BRAND, existing, incoming, '2026-08-01')
  assert.equal(plan.unchanged, 1)
  assert.deepEqual(plan.toClose, [{ id: 'id-104', valid_to: '2026-08-01' }])
  assert.deepEqual(plan.toInsert.map(r => r.internal_sku).sort(), ['110104', '110999'])
  const changed = plan.toInsert.find(r => r.internal_sku === '110104')!
  assert.equal(changed.valid_from, '2026-08-01')
  assert.equal(changed.unit_cost, 4.75)
  assert.equal(changed.valid_to, null)
})

test('planCogsWrite: a changed cost with a non-forward effective date is a dateConflict (skipped)', () => {
  const existing = [{ id: 'id-106', internal_sku: '110106', unit_cost: 8.1, valid_from: '2026-08-01' }]
  const incoming = [{ internal_sku: '110106', unit_cost: 9.0, notes: null }]
  const plan = planCogsWrite(BRAND, existing, incoming, '2026-07-01')  // earlier than valid_from
  assert.deepEqual(plan.dateConflicts, ['110106'])
  assert.equal(plan.toClose.length, 0)
  assert.equal(plan.toInsert.length, 0)
})
