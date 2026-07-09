// INB-145 follow-up — server-side date-plausibility guard.
//
// A typed garbage year (275760) in the upload form's date field stamped 108 rows
// into scale_insights_rule_assignments before QC caught it: the period-date gate
// only checks presence, never sanity. This guard rejects any provided
// date_range_start/end outside [2020-01-01, 2035-12-31], any non-calendar date,
// and start > end — for ALL report types, before any DB access.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

test('periodDateRangeError: garbage year is rejected', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  assert.equal(typeof periodDateRangeError, 'function', 'periodDateRangeError is exported')
  const err = periodDateRangeError('275760-09-13', '275760-09-13')
  assert.ok(typeof err === 'string' && /2020-01-01/.test(err), 'names the supported window')
})

test('periodDateRangeError: boundary dates pass', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  assert.equal(periodDateRangeError('2020-01-01', '2035-12-31'), null)
})

test('periodDateRangeError: just-outside dates rejected on each edge', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  assert.ok(periodDateRangeError('2019-12-31', '2026-01-01'), 'below MIN')
  assert.ok(periodDateRangeError('2026-01-01', '2036-01-01'), 'above MAX')
})

test('periodDateRangeError: non-calendar date rejected', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  assert.ok(periodDateRangeError('2026-02-30', ''), 'Feb 30 is not a real date')
  assert.ok(periodDateRangeError('2026-13-01', ''), 'month 13 invalid')
})

test('periodDateRangeError: start after end rejected', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  const err = periodDateRangeError('2026-06-30', '2026-06-01')
  assert.ok(typeof err === 'string' && /is after End/.test(err))
})

test('periodDateRangeError: empty / partial / valid ranges pass', async () => {
  const { periodDateRangeError } = await import('../lib/ingest-validation.ts')
  assert.equal(periodDateRangeError('', ''), null, 'both empty (inline-date types)')
  assert.equal(periodDateRangeError('2026-06-01', ''), null, 'only start provided')
  assert.equal(periodDateRangeError('', '2026-06-30'), null, 'only end provided')
  assert.equal(periodDateRangeError('2026-06-01', '2026-06-30'), null, 'normal range')
})

// ---------------------------------------------------------------------------
// Route e2e — the guard fires before any DB access, for any report type
// ---------------------------------------------------------------------------

const dbDouble = createServer((req, res) => {
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  res.statusCode = req.method === 'GET' ? 200 : 201
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(wantsObject ? {} : []))
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
// Detects as business_report (period-aggregate; would stamp report_date from the form).
const BR_CSV = [
  '(Child) ASIN,Title,Sessions - Total,Featured Offer (Buy Box) Percentage,Units Ordered,Ordered Product Sales',
  'B0TEST00001,Test Product,100,95%,10,"$250.00"',
].join('\n')

function post(start: string, end: string) {
  const body = new FormData()
  body.append('file', new File([BR_CSV], 'report.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', start)
  body.append('date_range_end', end)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

test('e2e: garbage-year date range → 400 before any write', async () => {
  const res = await post('275760-09-13', '275760-09-13')
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /2020-01-01/)
})

test('e2e companion: an in-range date range is not rejected by the guard', async () => {
  const res = await post('2026-06-01', '2026-06-30')
  // The guard must not fire; any non-guard outcome (200/500) is acceptable here —
  // we only assert it is NOT a plausibility 400.
  if (res.status === 400) {
    const json = await res.json()
    assert.doesNotMatch(String(json.error), /supported window|is after End/, 'valid range must not trip the guard')
  }
})
