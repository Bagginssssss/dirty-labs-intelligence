// INB-36 — campaigns.targeting_type must be maintained by ingest and drive
// harvest auto-campaign detection.
//
// The data exists upstream (sp_campaign_performance.targeting_type: 'Automatic
// targeting' / 'Manual targeting') but resolveCampaignId never wrote it to
// campaigns, so the column sat 0/430 and fetchAutoTerms used a name-convention
// stopgap (campaign_name ILIKE 'SP.A%'). These tests pin the fix:
//   A. campaign INSERT during sp_campaign_performance ingest carries targeting_type
//   B. existing campaign with NULL targeting_type gets a fill-if-null PATCH
//   C. fetchAutoTerms filters on targeting_type, not the name stopgap
//   companion: a non-null stored value is NEVER overwritten (coalesce semantics)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// ---------------------------------------------------------------------------
// Supabase test double (instant PostgREST-style responses; pattern from
// tests/ingest-counter-model.test.ts / tracker-coverage.test.ts).
// ---------------------------------------------------------------------------

// Existing-campaign fixtures keyed by amazon campaign_id (= campaign name here:
// the perf export has no Campaign ID column, so the mapper falls back to name).
type CampaignFixture = { id: string; launch_date: string | null; targeting_type: string | null }
const campaignFixtures = new Map<string, CampaignFixture>()

let campaignInserts: Record<string, unknown>[] = []
let campaignPatches: { query: string; body: Record<string, unknown> }[] = []
let campaignGetQueries: string[] = []

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => resolve(raw))
  })
}

const dbDouble = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  if (url.pathname.endsWith('/rest/v1/campaigns')) {
    if (req.method === 'GET') {
      campaignGetQueries.push(url.search)
      const amazonId = (url.searchParams.get('campaign_id') ?? '').replace(/^eq\./, '')
      const row = campaignFixtures.get(amazonId)
      if (row) return respond(200, wantsObject ? row : [row])
      // Zero rows: PostgREST answers a pgrst.object request with PGRST116.
      if (wantsObject) return respond(406, { code: 'PGRST116', message: 'zero rows', details: '0 rows' })
      return respond(200, [])
    }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      campaignInserts.push(body)
      const inserted = { id: `11111111-0000-4000-8000-${String(campaignInserts.length).padStart(12, '0')}` }
      return respond(wantsObject ? 200 : 201, wantsObject ? inserted : [inserted])
    }
    if (req.method === 'PATCH') {
      campaignPatches.push({ query: url.search, body: JSON.parse(await readBody(req)) as Record<string, unknown> })
      return respond(204, {})
    }
  }

  // Everything else (report upserts, ingestion log, rpc, derived-metrics reads):
  // generic instant success — GETs see empty tables, writes are accepted.
  if (req.method === 'GET') return respond(200, wantsObject ? {} : [])
  return respond(201, [])
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')
const { getHarvestCandidates } = await import('../lib/queries/keywords.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Detects as sp_campaign_performance (campaign_name + impressions + clicks +
// date, none of the more-specific signatures' columns).
const PERF_HEADER = 'Campaign Name,Date,Impressions,Clicks,Targeting Type'

async function postPerfCsv(rows: string[]): Promise<Record<string, unknown>> {
  const body = new FormData()
  body.append('file', new File([[PERF_HEADER, ...rows].join('\n')], 'perf.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  return res.json()
}

function resetCaptures() {
  campaignInserts = []
  campaignPatches = []
  campaignGetQueries = []
  campaignFixtures.clear()
}

// ---------------------------------------------------------------------------
// Fail-first core (RED on pre-INB-36 code)
// ---------------------------------------------------------------------------

test('RED A: campaign INSERT during perf ingest carries targeting_type', async () => {
  resetCaptures()
  const json = await postPerfCsv(['SP.M.InsertCase,2026-06-15,100,10,Manual targeting'])
  assert.equal(json.rows_stored, 1, 'fixture row is stored')
  assert.equal(campaignInserts.length, 1, 'exactly one campaign insert')
  assert.equal(
    campaignInserts[0].targeting_type,
    'Manual targeting',
    'insert body must include the perf row’s targeting_type'
  )
})

test('RED B: existing campaign with NULL targeting_type gets a fill-if-null PATCH', async () => {
  resetCaptures()
  // launch_date earlier than the file’s report_date → no launch_date update fires;
  // the ONLY reason to PATCH is targeting_type.
  campaignFixtures.set('SP.A.FillCase', {
    id: '22222222-0000-4000-8000-000000000001',
    launch_date: '2026-01-01',
    targeting_type: null,
  })
  const json = await postPerfCsv(['SP.A.FillCase,2026-06-15,100,10,Automatic targeting'])
  assert.equal(json.rows_stored, 1, 'fixture row is stored')
  assert.equal(campaignInserts.length, 0, 'campaign already exists — no insert')
  const ttPatch = campaignPatches.find(p => 'targeting_type' in p.body)
  assert.ok(ttPatch, 'a campaigns PATCH must set targeting_type on the NULL row')
  assert.equal(ttPatch.body.targeting_type, 'Automatic targeting')
  assert.ok(
    ttPatch.query.includes('22222222-0000-4000-8000-000000000001'),
    'PATCH targets the existing campaign row'
  )
})

test('RED C: fetchAutoTerms filters on targeting_type, not the SP.A% name stopgap', async () => {
  resetCaptures()
  await getHarvestCandidates(BRAND, '2026-06-01', '2026-06-30')
  assert.equal(campaignGetQueries.length, 1, 'one campaigns query')
  const params = new URLSearchParams(campaignGetQueries[0])
  assert.equal(
    params.get('targeting_type'),
    'eq.Automatic targeting',
    'auto campaigns must be selected by the real column'
  )
  assert.equal(params.get('campaign_name'), null, 'the ILIKE name stopgap must be gone')
})

// ---------------------------------------------------------------------------
// Companion (green before AND after — never overwrite a non-null value)
// ---------------------------------------------------------------------------

test('companion: a non-null stored targeting_type is NOT overwritten by a different incoming value', async () => {
  resetCaptures()
  campaignFixtures.set('SP.M.KeepCase', {
    id: '33333333-0000-4000-8000-000000000001',
    launch_date: '2026-01-01',
    targeting_type: 'Manual targeting',
  })
  const json = await postPerfCsv(['SP.M.KeepCase,2026-06-15,100,10,Automatic targeting'])
  assert.equal(json.rows_stored, 1, 'fixture row is stored')
  assert.equal(
    campaignPatches.filter(p => 'targeting_type' in p.body).length,
    0,
    'coalesce semantics: stored non-null value wins, no overwrite'
  )
})
