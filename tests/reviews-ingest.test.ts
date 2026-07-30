// INB-160 — reviews JSON ingest path: payload validation (pure) + the route JSON sniff/handoff.
//
// Fail-first: before the route's JSON branch existed, a JSON upload fell through to parseCSV +
// the header detector and 400'd as "Could not detect report type" — so the e2e assertions on
// report_type='amazon_reviews' / snapshots_written FAILED. They pass once the route sniffs JSON
// and early-returns into handleReviewsUpload.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// A Supabase HTTP double: GET → [], any write → 2xx. Must be up (and env pointed at it) BEFORE the
// first import that constructs supabaseAdmin, so imports of the route/handler are deferred below.
const dbDouble = createServer((req, res) => {
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') return send(200, wantsObject ? {} : [])
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
const { validateReviewsPayload } = await import('../lib/reviews-ingest.ts')
const { POST } = await import('../app/api/ingest/route.ts')

// ── validateReviewsPayload (pure) ────────────────────────────────────────────────
test('validateReviewsPayload: array of review items accepted; non-reviews rejected', () => {
  assert.ok(validateReviewsPayload([{ reviewId: 'R1' }]).items)
  assert.match(validateReviewsPayload({ reviewId: 'R1' }).error ?? '', /array/i)      // object, not array
  assert.match(validateReviewsPayload([]).error ?? '', /empty/i)
  assert.match(validateReviewsPayload([{ foo: 1 }]).error ?? '', /reviewId/)          // no reviewId
})

// ── route JSON sniff + handoff (e2e against the Supabase HTTP double) ─────────────
function unfilteredItem(over: Record<string, unknown> = {}) {
  return {
    reviewId: 'R1', asin: 'B09B7WLWW3', variationId: 'B0V', rating: '5.0 out of 5 stars',
    title: 't', text: 'b', date: 'Reviewed in the United States on July 18, 2026', userName: 'u',
    numberOfHelpful: 1, verified: true, vine: false, variationList: [], imageUrlList: [], videoUrlList: [],
    countRatings: 2969, countReviews: 635, productRating: '4.4 out of 5',
    reviewSummary: { fiveStar: { percentage: 75 }, fourStar: { percentage: 10 }, threeStar: { percentage: 4 }, twoStar: { percentage: 4 }, oneStar: { percentage: 7 } },
    filters: { reviewerType: 'all_reviews', mediaType: 'all_contents', formatType: 'all_formats' },
    ...over,
  }
}

async function postJson(items: unknown): Promise<Response> {
  const body = new FormData()
  body.append('file', new File([JSON.stringify(items)], 'axesso_run.json', { type: 'application/json' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

test('route: unfiltered JSON export → reviews handler, 1 review + 1 snapshot, run_filtered false', async () => {
  const res = await postJson([unfilteredItem()])
  const json = await res.json()
  assert.equal(json.report_type, 'amazon_reviews')
  assert.equal(json.table, 'amazon_reviews')
  assert.equal(json.rows_stored, 1)
  assert.equal(json.snapshots_written, 1)
  assert.equal(json.run_filtered, false)
})

test('route: star-filtered JSON export → reviews only, 0 snapshots, run_filtered true', async () => {
  const filtered = unfilteredItem({ filters: { reviewerType: 'all_reviews', mediaType: 'all_contents', formatType: 'all_formats', filterByStar: 'five_star' } })
  const res = await postJson([filtered])
  const json = await res.json()
  assert.equal(json.rows_stored, 1)
  assert.equal(json.snapshots_written, 0)
  assert.equal(json.run_filtered, true)
})

test('route: non-reviews JSON array → 400', async () => {
  const res = await postJson([{ foo: 1 }])
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /reviewId/)
})

test('route: JSON object (not an array) → 400', async () => {
  const body = new FormData()
  body.append('file', new File(['{"a":1}'], 'weird.json', { type: 'application/json' }))
  body.append('brand_id', BRAND)
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  assert.equal(res.status, 400)
})
