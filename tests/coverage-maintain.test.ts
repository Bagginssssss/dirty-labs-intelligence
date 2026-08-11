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

// ── INB-166 window-per-pull: data_through = window END, not the start ─────────────
test('maintain window-per-pull: business_report window comes from the ingest date range (end, not start)', async () => {
  const { upsertCoverageForUpload } = await import('../lib/coverage/maintain.ts')
  coverageUpserts.length = 0
  failCoverage = false
  // business_report rows carry only report_date (= window start); the end is the ingest date_range_end.
  await upsertCoverageForUpload({
    reportKey: 'business_report_child_asin', tableName: 'business_report',
    rows: [{ report_date: '2026-07-09' }, { report_date: '2026-07-09' }],
    dateRangeStart: '2026-07-09', dateRangeEnd: '2026-08-09',
  })
  assert.equal(coverageUpserts.length, 1)
  assert.equal(coverageUpserts[0].rows.length, 1, 'one window row per pull')
  const row = coverageUpserts[0].rows[0]
  assert.equal(row.period_start, '2026-07-09')
  assert.equal(row.period_end, '2026-08-09')       // the window END (was report_date under the old bug)
  assert.equal(row.data_through, '2026-08-09')      // the fix: END, not the start
  assert.equal(row.period_type, 'snapshot')
  assert.equal(row.period_label, 'Window 2026-07-09 → 2026-08-09')
})

test('maintain window-per-pull: subscribe_and_save takes the window end from the row date_range_end column', async () => {
  const { upsertCoverageForUpload } = await import('../lib/coverage/maintain.ts')
  coverageUpserts.length = 0
  await upsertCoverageForUpload({
    reportKey: 'subscribe_and_save', tableName: 'subscribe_and_save',
    rows: [
      { report_date: '2026-07-08', date_range_end: '2026-08-07' },
      { report_date: '2026-07-08', date_range_end: '2026-08-07' },
    ],
  })
  assert.equal(coverageUpserts.length, 1)
  assert.equal(coverageUpserts[0].rows.length, 1, 'distinct (start,end) → one window')
  const row = coverageUpserts[0].rows[0]
  assert.equal(row.period_start, '2026-07-08')
  assert.equal(row.period_end, '2026-08-07')        // END from the row column
  assert.equal(row.data_through, '2026-08-07')       // the fix: END, not report_date
  assert.equal(row.period_type, 'snapshot')
})

// ── INB-166 item-4 guard: a known report_type deriving NO report_key → 400, no coverage ──
// NOTE: the original example (the doubled-space Share export) is FIXED by INB-167 — it now resolves
// to sns_dashboard_reorder_share (that case is covered in tests/sns-dashboard-mappers.test.ts). The
// guard still needs a genuinely-null case: a keyword-rank upload for an UNREGISTERED ASIN →
// si_rank_<unknown> → validated() null → 400.
test('guard: a known report_type (keyword-rank) with an unregistered ASIN → NULL report_key → 400, no coverage', async () => {
  coverageUpserts.length = 0
  failCoverage = false
  const csv = [
    'ASIN,Title,Keyword,Tracked,Query Volume,2026-06-25',
    'B0NOTREAL99,Fake Product,laundry soap,Yes,1000,5',
  ].join('\n')
  const body = new FormData()
  body.append('file', new File([csv], 'KeywordRank_Unregistered.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  assert.equal(res.status, 400)
  const json = await res.json() as Record<string, unknown>
  assert.match(String(json.error), /scale_insights_keyword_rank/)  // names the report_type
  assert.match(String(json.error), /report_key/)                   // explains the null-key block
  assert.equal(coverageUpserts.length, 0, 'no coverage written on a blocked upload')
})
