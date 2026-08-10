// INB-68 — honest per-stage counter model.
//
// The mapper reshapes rows between received and stored (collapse or expansion),
// and dedup was only counted per-500-row batch, so cross-batch duplicates vanished
// into rows_stored. These tests pin the model:
//   rows_mapped   = post-mapper count (reported; new)
//   rows_deduplicated = UPLOAD-WIDE last-wins dedup collapse (was per-batch)
//   identity: rows_stored = rows_mapped - rows_deduplicated - rows_rejected, exactly.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// Supabase test double: a local HTTP server answering every request with an
// instant PostgREST-style 400. Every DB write is rejected fast (the port-1 trick
// used elsewhere costs ~7s per call in connection retries — far too slow for a
// 501-row row-by-row fallback). Rows all land in the "rejected" bucket, which the
// identity must still balance exactly.
const dbDouble = createServer((_req, res) => {
  res.statusCode = 400
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ message: 'rejected by test double' }))
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Detects as search_query_performance (search_query_score + impressions_total_count
// + purchases_brand_count) — no FK resolution, so rows survive to the dedup stage.
const SQP_HEADER =
  'Search Query,Reporting Date,Search Query Score,Search Query Volume,Impressions: Total Count,Purchases: Brand Count'

function sqpRow(query: string, date = '2026-06-27'): string {
  return `${query},${date},1,100,500,3`
}

// 501 data rows; row 501 duplicates row 1's conflict key (brand_id, search_query,
// report_date). Rows 1-500 fill batch 1; row 501 starts batch 2 — the duplicate
// pair STRADDLES the 500-row batch boundary.
const STRADDLE_CSV = [
  SQP_HEADER,
  ...Array.from({ length: 500 }, (_, i) => sqpRow(`keyword ${i + 1}`)),
  sqpRow('keyword 1'),
].join('\n')

// All-unique companion (no dedup expected).
const UNIQUE_CSV = [SQP_HEADER, sqpRow('alpha'), sqpRow('bravo'), sqpRow('charlie')].join('\n')

// Validation-reject fixture: middle row has an empty Search Query (INB-117 reject).
const REJECT_CSV = [SQP_HEADER, sqpRow('alpha'), sqpRow(''), sqpRow('charlie')].join('\n')

// Detects as scale_insights_keyword_rank (tracked + keyword + query_volume + a
// YYYY-MM-DD date column header). The mapper UNPIVOTS: one CSV row → one mapped
// row per date column with a rank value. 2 CSV rows × 3 date columns = 6 mapped.
// Uses a REGISTERED rank ASIN (B09B7YS1VK → si_rank_b09b7ys1vk). INB-166's item-4 guard 400s a
// known report_type that derives NO report_key, so an unregistered test ASIN would now be blocked
// before the counter-model path — the ASIN is irrelevant to the unpivot expansion this asserts.
const EXPANSION_CSV = [
  'ASIN,Title,Keyword,Tracked,Query Volume,2026-06-25,2026-06-26,2026-06-27',
  'B09B7YS1VK,Test Product,laundry soap,Yes,1000,5,6,7',
  'B09B7YS1VK,Test Product,dish soap,Yes,800,11,12,13',
].join('\n')

async function postCsv(csv: string): Promise<Record<string, unknown>> {
  const body = new FormData()
  body.append('file', new File([csv], 'report.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  return res.json()
}

function assertIdentity(json: Record<string, unknown>, label: string) {
  const mapped = json.rows_mapped as number
  const dedup = json.rows_deduplicated as number
  const rejected = json.rows_rejected as number
  const stored = json.rows_stored as number
  assert.equal(
    stored,
    mapped - dedup - rejected,
    `${label}: rows_stored (${stored}) must equal rows_mapped (${mapped}) − rows_deduplicated (${dedup}) − rows_rejected (${rejected})`
  )
}

// Single shared upload of the 501-row fixture (used by several tests).
const straddleResult = postCsv(STRADDLE_CSV)

// ---------------------------------------------------------------------------
// Fail-first core (these FAIL on pre-INB-68 per-batch code)
// ---------------------------------------------------------------------------

test('counter: duplicate key straddling the 500-row batch boundary is counted as deduplicated', async () => {
  const json = await straddleResult
  assert.equal(json.rows_deduplicated, 1,
    'upload-wide dedup must count the row-1/row-501 duplicate; per-batch dedup sees 0')
})

test('counter: rows_mapped (post-mapper count) is reported', async () => {
  const json = await straddleResult
  assert.equal(json.rows_mapped, 501)
})

test('identity: collapse fixture — stored = mapped − deduplicated − rejected exactly', async () => {
  assertIdentity(await straddleResult, 'straddle/collapse')
})

test('identity: expansion fixture (keyword-rank unpivot, mapped > received)', async () => {
  const json = await postCsv(EXPANSION_CSV)
  assert.equal(json.rows_received, 2)
  assert.equal(json.rows_mapped, 6, 'unpivot: 2 CSV rows × 3 date columns')
  assertIdentity(json, 'expansion')
})

test('identity: validation-reject fixture (empty search_query)', async () => {
  const json = await postCsv(REJECT_CSV)
  assert.equal(json.rows_mapped, 3)
  assert.ok((json.rows_rejected as number) >= 1, 'the empty-query row is rejected')
  assertIdentity(json, 'reject')
})

test('dedupeByConflictKey: upload-wide last-occurrence-wins, counted', async () => {
  const mod = await import('../lib/ingest-validation.ts')
  assert.equal(typeof mod.dedupeByConflictKey, 'function', 'dedupeByConflictKey is exported')
  const { rows, collapsed } = mod.dedupeByConflictKey(
    [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
      { k: 'a', v: 3 },
    ],
    'k',
  )
  assert.equal(collapsed, 1)
  assert.equal(rows.length, 2)
  const kept = rows.find((r: Record<string, unknown>) => r.k === 'a')
  assert.equal(kept?.v, 3, 'last occurrence wins — matches upsert overwrite semantics')
})

test('dedupeByConflictKey: no conflict key → passthrough, zero collapsed', async () => {
  const mod = await import('../lib/ingest-validation.ts')
  const input = [{ k: 'a' }, { k: 'a' }]
  const { rows, collapsed } = mod.dedupeByConflictKey(input, undefined)
  assert.equal(collapsed, 0)
  assert.deepEqual(rows, input)
})

// ---------------------------------------------------------------------------
// Companion (passes before AND after — no over-counting)
// ---------------------------------------------------------------------------

test('companion: all-unique upload counts zero deduplicated', async () => {
  const json = await postCsv(UNIQUE_CSV)
  assert.equal(json.rows_deduplicated, 0)
})
