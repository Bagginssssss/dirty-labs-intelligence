// INB-86 — a successful upload to a derived-metrics FEEDER table must trigger
// calculateDerivedMetricsRange for the upload's covered date window, non-fatally
// (a recalc failure is surfaced via recalc_status but never fails the upload).
// Non-feeder uploads must not recalc.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// ---------------------------------------------------------------------------
// Supabase HTTP double: all GETs return []; all writes 201 — except, when
// `failDerivedUpserts` is set, POSTs to derived_metrics_daily return 500 (to
// prove the recalc failure is non-fatal). Every derived_metrics_daily upsert's
// metric_date is recorded so tests can assert exactly which days were recalced.
// ---------------------------------------------------------------------------

let failDerivedUpserts = false
let derivedUpsertDates: string[] = []

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  if (req.method === 'GET') return respond(200, [])

  if (url.pathname.endsWith('/derived_metrics_daily')) {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      try {
        const body = JSON.parse(raw)
        for (const row of Array.isArray(body) ? body : [body]) {
          if (row?.metric_date) derivedUpsertDates.push(String(row.metric_date))
        }
      } catch { /* body not JSON — ignore */ }
      if (failDerivedUpserts) return respond(500, { message: 'derived upsert rejected by test double' })
      return respond(201, [])
    })
    return
  }

  return respond(201, [])
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Detects as business_report_daily (date + sessions + buy_box) — a FEEDER.
// Two days → covered window 2026-06-15 → 2026-06-16.
const BRD_CSV = [
  'Date,Sessions - Total,Featured Offer (Buy Box) Percentage,Units Ordered,Ordered Product Sales,Total Order Items',
  '2026-06-15,200,95%,40,"$1,000.00",40',
  '2026-06-16,180,94%,35,"$900.00",35',
].join('\n')

// Detects as search_query_performance — NOT a feeder.
const SQP_CSV = [
  'Search Query,Reporting Date,Search Query Score,Search Query Volume,Impressions: Total Count,Purchases: Brand Count',
  'laundry soap,2026-06-27,1,100,500,3',
].join('\n')

async function postCsv(csv: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const body = new FormData()
  body.append('file', new File([csv], 'report.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  return { status: res.status, json: await res.json() }
}

// ---------------------------------------------------------------------------
// Fail-first core (FAIL on pre-INB-86 code)
// ---------------------------------------------------------------------------

test('pure: recalcPlanForUpload — feeder window, non-feeder null, defensive nulls', async () => {
  const mod = await import('../lib/derived-metrics.ts')
  assert.equal(typeof mod.recalcPlanForUpload, 'function', 'recalcPlanForUpload is exported')
  assert.deepEqual(
    mod.recalcPlanForUpload('business_report_daily', '2026-06-15', '2026-06-16'),
    { start: '2026-06-15', end: '2026-06-16' },
  )
  assert.deepEqual(
    mod.recalcPlanForUpload('subscribe_and_save', '2026-05-27', '2026-06-26'),
    { start: '2026-05-27', end: '2026-06-26' },
  )
  assert.equal(mod.recalcPlanForUpload('search_query_performance', '2026-06-01', '2026-06-30'), null, 'non-feeder')
  assert.equal(mod.recalcPlanForUpload('business_report_daily', null, '2026-06-16'), null, 'missing start')
  assert.equal(mod.recalcPlanForUpload('business_report_daily', '2026-06-15', null), null, 'missing end')
  assert.equal(mod.recalcPlanForUpload('business_report_daily', '2026-06-16', '2026-06-15'), null, 'inverted window')
})

test('wiring: successful feeder upload recalcs exactly the covered window', async () => {
  derivedUpsertDates = []
  const { status, json } = await postCsv(BRD_CSV)
  assert.equal(status, 200)
  assert.equal(json.status, 'ok')
  assert.equal(json.recalc_status, 'ok')
  assert.deepEqual(
    [...derivedUpsertDates].sort(),
    ['2026-06-15', '2026-06-16'],
    'derived_metrics_daily upserted for exactly the covered dates'
  )
})

test('wiring: non-feeder upload does not recalc', async () => {
  derivedUpsertDates = []
  const { json } = await postCsv(SQP_CSV)
  assert.equal(json.status, 'ok')
  assert.equal(json.recalc_status, 'skipped')
  assert.deepEqual(derivedUpsertDates, [], 'no derived_metrics_daily writes')
})

test('wiring: recalc failure is non-fatal — upload succeeds with recalc_status failed', async () => {
  derivedUpsertDates = []
  failDerivedUpserts = true
  try {
    const { status, json } = await postCsv(BRD_CSV)
    assert.equal(status, 200, 'upload still HTTP 200')
    assert.equal(json.status, 'ok', 'upload still reports success')
    assert.equal(json.recalc_status, 'failed', 'failure surfaced, not silent')
  } finally {
    failDerivedUpserts = false
  }
})

// ---------------------------------------------------------------------------
// Companion (passes before AND after)
// ---------------------------------------------------------------------------

test('companion: core upload response fields unaffected by the recalc wiring', async () => {
  const { json } = await postCsv(BRD_CSV)
  assert.equal(json.rows_received, 2)
  assert.equal(json.rows_mapped, 2)
  assert.equal(json.rows_stored, 2)
  assert.equal(json.rows_rejected, 0)
})
