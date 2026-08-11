// INB-170 — S&S Performance partial-upload guards (two independent failure modes):
//   A) mixed-window: one report_date carrying >1 date_range_end (the 2026-06-22 bundled fragment).
//   B) null-revenue: a standalone all-null / >50%-null file (the fragment as its own file).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  subscribeAndSaveMixedWindowViolation,
  subscribeAndSaveNullRevenueViolation,
} from '../lib/mappers/subscribe-and-save.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')

// ── Guard A: mixed-window ────────────────────────────────────────────────────────
test('mixed-window: a report_date with two date_range_ends is flagged, naming both windows + counts', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => ({ report_date: '2026-05-21', date_range_end: '2026-06-19', ss_revenue: 100 })),
    ...Array.from({ length: 3 }, () => ({ report_date: '2026-05-21', date_range_end: '2026-06-20', ss_revenue: null })),
  ]
  const v = subscribeAndSaveMixedWindowViolation(rows)
  assert.ok(v, 'a violation is returned')
  assert.match(v!, /2026-06-19 \(20 rows\)/)
  assert.match(v!, /2026-06-20 \(3 rows\)/)
})

test('mixed-window: a clean single-window file → null', () => {
  const rows = Array.from({ length: 18 }, () => ({ report_date: '2025-08-01', date_range_end: '2025-08-31', ss_revenue: 100 }))
  assert.equal(subscribeAndSaveMixedWindowViolation(rows), null)
})

test('mixed-window: a null date_range_end renders as "missing reporting window", not "(null)"', () => {
  const rows = [
    { report_date: '2026-05-21', date_range_end: '2026-06-19', ss_revenue: 100 },
    { report_date: '2026-05-21', date_range_end: null, ss_revenue: 50 },
  ]
  const v = subscribeAndSaveMixedWindowViolation(rows)
  assert.ok(v)
  assert.match(v!, /missing reporting window \(1 rows\)/)
  assert.doesNotMatch(v!, /\(null\)/)
})

// ── Guard B: null-revenue ────────────────────────────────────────────────────────
test('null-revenue: all rows null → flagged (100%)', () => {
  const rows = Array.from({ length: 3 }, () => ({ report_date: '2026-05-21', date_range_end: '2026-06-20', ss_revenue: null }))
  const v = subscribeAndSaveNullRevenueViolation(rows)
  assert.ok(v)
  assert.match(v!, /3\/3/)
  assert.match(v!, /100%/)
})

test('null-revenue: 3 of 18 (16.7%) legit pull → null (NOT a row-count rule)', () => {
  const rows = [
    ...Array.from({ length: 15 }, () => ({ report_date: '2025-08-01', date_range_end: '2025-08-31', ss_revenue: 100 })),
    ...Array.from({ length: 3 }, () => ({ report_date: '2025-08-01', date_range_end: '2025-08-31', ss_revenue: null })),
  ]
  assert.equal(subscribeAndSaveNullRevenueViolation(rows), null)
})

test('null-revenue: >50% flagged, exactly 50% not; empty file → null', () => {
  const mk = (rev: (number | null)[]) => rev.map(r => ({ report_date: '2026-01-01', date_range_end: '2026-01-31', ss_revenue: r }))
  assert.ok(subscribeAndSaveNullRevenueViolation(mk([null, null, null, 1])))  // 3/4 = 75% → flag
  assert.equal(subscribeAndSaveNullRevenueViolation(mk([null, null, 1, 1])), null) // 2/4 = 50% → pass (not >50)
  assert.equal(subscribeAndSaveNullRevenueViolation([]), null)
})

// ── Independence: the mixed-window fixture trips A, NOT B (it is only 13% null) ────
test('independence: the real 23-row mixed file trips mixed-window but NOT null-revenue (3/23 = 13%)', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => ({ report_date: '2026-05-21', date_range_end: '2026-06-19', ss_revenue: 100 })),
    ...Array.from({ length: 3 }, () => ({ report_date: '2026-05-21', date_range_end: '2026-06-20', ss_revenue: null })),
  ]
  assert.ok(subscribeAndSaveMixedWindowViolation(rows), 'mixed-window fires')
  assert.equal(subscribeAndSaveNullRevenueViolation(rows), null, 'null-revenue does NOT fire (13% < 50%)')
})

// ── e2e through the real route + fixtures ─────────────────────────────────────────
const dbDouble = createServer((req, res) => {
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') return send(200, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : [])
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => send(wantsObject ? 200 : 201, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : []))
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

function upload(csv: string): FormData {
  const body = new FormData()
  body.append('file', new File([csv], 'SubscribeSave.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  return body
}

test('e2e: the real 23-row mixed-window file → 400 naming both windows, no rows stored', async () => {
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body: upload(fixture('subscribe-and-save-mixed-window.csv')) }))
  assert.equal(res.status, 400)
  const json = await res.json() as Record<string, unknown>
  assert.match(String(json.error), /S&S Performance/)
  assert.match(String(json.error), /2026-06-19/)
  assert.match(String(json.error), /2026-06-20/)
})

test('e2e: the standalone 3-row all-null fragment → 400 (null-revenue guard)', async () => {
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body: upload(fixture('subscribe-and-save-fragment.csv')) }))
  assert.equal(res.status, 400)
  const json = await res.json() as Record<string, unknown>
  assert.match(String(json.error), /null ss_revenue/)
})

test('e2e: a legitimate single-window 18-row pull (3 null) → NOT 400', async () => {
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body: upload(fixture('subscribe-and-save-legit.csv')) }))
  assert.notEqual(res.status, 400)
})
