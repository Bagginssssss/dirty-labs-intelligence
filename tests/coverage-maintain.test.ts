// INB-146 — post-upload report_coverage maintenance.
//
// A successful upload upserts coverage for the periods it touched (onConflict
// report_key,period_start → idempotent). Ambiguous (null report_key) uploads write no
// coverage. A coverage-upsert failure must NEVER fail the ingest (derived metadata).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// ── HTTP Supabase double: capture report_coverage upserts; toggle it to 500 ──────
const coverageUpserts: { onConflict: string | null; rows: Record<string, unknown>[] }[] = []
let failCoverage = false

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => {
    res.statusCode = s
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(b))
  }
  if (req.method === 'GET') {
    if (wantsObject) return send(406, { code: 'PGRST116', message: 'zero rows' })
    return send(200, [])
  }
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/report_coverage')) {
      let rows: Record<string, unknown>[] = []
      try { const b = JSON.parse(raw); rows = Array.isArray(b) ? b : [b] } catch { /* ignore */ }
      coverageUpserts.push({ onConflict: url.searchParams.get('on_conflict'), rows })
      if (failCoverage) return send(500, { message: 'simulated coverage failure' })
    }
    if (wantsObject) return send(201, { id: '11111111-0000-4000-8000-000000000001' })
    return send(201, [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'

const { POST } = await import('../app/api/ingest/route.ts')

const BID_HEADERS = ['Created', 'ASIN', 'SKU', 'ShortName', 'Campaign', 'AdGroup', 'Keyword', 'Action', 'Rule', 'Criteria', 'Change', 'Code', 'Details']
const BID_CSV = [
  BID_HEADERS.join(','),
  '2026-06-14,B09MSP7M5Y,112101-FBA,,SD.CO.PT - Booster,SD.CO.PT - Booster,B00I8YAT42,Bidding Rule,Increase Bid - No Clicks,No Clicks,1.77 -> 2.04,,',
].join('\n')

function bidUpload(): FormData {
  const body = new FormData()
  body.append('file', new File([BID_CSV], 'BiddingRule_ChangeLogs.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  return body
}

// ── e2e: upload upserts coverage for the touched week, idempotent key ────────────
test('e2e: bid-log upload upserts report_coverage for the touched week (event_driven)', async () => {
  coverageUpserts.length = 0
  failCoverage = false
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body: bidUpload() }))
  const json = await res.json() as Record<string, unknown>
  assert.equal(json.table, 'scale_insights_bid_log')

  assert.equal(coverageUpserts.length, 1, 'exactly one report_coverage upsert')
  assert.equal(coverageUpserts[0].onConflict, 'report_key,period_start')
  // Created 2026-06-14 (Sunday) → week ending Saturday 2026-06-20; event-driven bid log.
  const row = coverageUpserts[0].rows[0]
  assert.equal(row.report_key, 'si_bid_log')
  assert.equal(row.period_start, '2026-06-14')
  assert.equal(row.period_end, '2026-06-20')
  assert.equal(row.period_type, 'weekly')
  assert.equal(row.event_driven, true)
  assert.equal(row.source, 'upload')
})

// ── pinning: a coverage failure never fails the ingest ───────────────────────────
test('pinning: report_coverage upsert 500 → ingest still succeeds', async () => {
  coverageUpserts.length = 0
  failCoverage = true
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body: bidUpload() }))
  const json = await res.json() as Record<string, unknown>
  assert.equal(res.status, 200)
  assert.equal(json.table, 'scale_insights_bid_log')
  assert.ok((json.rows_stored as number) >= 1, 'rows still stored despite coverage failure')
  assert.equal(coverageUpserts.length, 1, 'coverage was attempted (and failed) — not skipped')
  failCoverage = false
})

// ── maintain unit: null report_key writes no coverage ────────────────────────────
test('maintain: null report_key → no coverage upsert', async () => {
  const { upsertCoverageForUpload } = await import('../lib/coverage/maintain.ts')
  coverageUpserts.length = 0
  await upsertCoverageForUpload({ reportKey: null, tableName: 'scale_insights_bid_log', rows: [{ change_timestamp: '2026-06-14' }] })
  assert.equal(coverageUpserts.length, 0)
})

test('maintain: valid report_key buckets rows and upserts once', async () => {
  const { upsertCoverageForUpload } = await import('../lib/coverage/maintain.ts')
  coverageUpserts.length = 0
  failCoverage = false
  await upsertCoverageForUpload({
    reportKey: 'sp_search_term',
    tableName: 'sp_search_term_report',
    rows: [{ report_date: '2026-06-24' }, { report_date: '2026-06-25' }],
  })
  assert.equal(coverageUpserts.length, 1)
  assert.equal(coverageUpserts[0].rows[0].report_key, 'sp_search_term')
  assert.equal(coverageUpserts[0].rows[0].period_end, '2026-06-27') // both days → week ending Sat 06-27
  assert.equal(coverageUpserts[0].rows[0].event_driven, false)
})
