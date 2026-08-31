// INB-144 — route e2e for the S&S Dashboard exports (HTTP-double pattern, per
// period-date-plausibility.test.ts): the strict-mapping guard, daily unpivot, and the
// snapshot period-date gate.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

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

function post(csv: string, opts: { start?: string; end?: string } = {}) {
  const body = new FormData()
  body.append('file', new File([csv], 'sns.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  if (opts.start) body.append('date_range_start', opts.start)
  if (opts.end) body.append('date_range_end', opts.end)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

const SALES = [
  '"calc_date_granularity","Reorder (CUSTOM)","Subscribe & Save (CUSTOM)"',
  '"2026-07-10 00:00:00",35057.31,17309.5',
].join('\n')

test('daily happy path: Sales file unpivots to 2 metric rows stored', async () => {
  const res = await post(SALES)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.table, 'sns_dashboard_daily')
  assert.equal(json.rows_stored, 2) // one date × two value columns
})

test('strict mapping: one known + one unknown metric column → 400 naming the unknown, zero rows', async () => {
  const csv = [
    '"calc_date_granularity","Reorder (CUSTOM)","New Widget (CUSTOM)"',
    '"2026-07-10 00:00:00",100,200',
  ].join('\n')
  const res = await post(csv)
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /New Widget \(CUSTOM\)/)
  assert.equal(json.rows_stored, undefined) // never reached the store step
})

test('strict mapping: only unknown metric columns → 400, zero rows', async () => {
  const csv = [
    '"calc_date_granularity","New Widget (CUSTOM)"',
    '"2026-07-10 00:00:00",200',
  ].join('\n')
  const res = await post(csv)
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /New Widget \(CUSTOM\)/)
})

const LTV = [
  '"calc_customer_segment","calc_purchase_type","avg_gms (AVG)"',
  '"Established","Subscribe & Save",230.58',
].join('\n')

test('snapshot: form dates required (no date in file) — blank → 400', async () => {
  const res = await post(LTV)
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /period-aggregate|Date Range/i)
})

test('snapshot: with form date → stored (date stamped from the form)', async () => {
  // A recent date (1 day back): INB-174's backdated-snapshot guard rejects a form date_range_start
  // >14 days before today, so this must use a live date rather than a hardcoded (now-stale) one.
  const recent = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const res = await post(LTV, { start: recent, end: recent })
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.table, 'sns_dashboard_snapshots')
  assert.equal(json.rows_stored, 1)
})
