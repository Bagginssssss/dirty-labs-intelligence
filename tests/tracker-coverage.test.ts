// INB-139 — tracker freshness/coverage must be a BOUNDED server-side query.
//
// The old path pulled every source row per report type via fetchAll (448K rows
// on sp_targeting_report, ~449 sequential 1000-row pages) and deduped dates in
// JS — statement timeouts on every cache-miss load. The fix fetches the distinct
// dates via the get_report_date_coverage RPC (migration 036): one POST, ~127
// rows back. These tests pin the transport: one RPC call, ZERO row reads
// against the source table.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { REPORT_REGISTRY } from '../lib/upload-tracker/registry.ts'

let failRpc = false
let rpcBodies: Record<string, unknown>[] = []
let sourceTableGets: string[] = []

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST' && url.pathname.endsWith('/rpc/get_report_date_coverage')) {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      try { rpcBodies.push(JSON.parse(raw)) } catch { /* ignore */ }
      if (failRpc) return respond(500, { message: 'rpc rejected by test double' })
      // PostgREST shape for RETURNS TABLE (d date), already ordered by the RPC.
      return respond(200, [{ d: '2026-06-01' }, { d: '2026-06-02' }, { d: '2026-07-05' }])
    })
    return
  }

  if (req.method === 'GET') {
    // Any row-read against a source table is exactly what the fix forbids.
    sourceTableGets.push(url.pathname)
    return respond(200, [])
  }

  return respond(201, [])
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Real registry entries — the same objects loadTrackerData iterates.
const strEntry = REPORT_REGISTRY.find(e => e.internal_id === 'sp_search_term_report')!
const spSliceEntry = REPORT_REGISTRY.find(e => e.internal_id === 'sp_campaign_performance__sp')!

test('coverage: daily entry → ONE bounded RPC call, ZERO row reads on the source table', async () => {
  const mod = await import('../lib/upload-tracker/coverage.ts')
  assert.equal(typeof mod.fetchDistinctDates, 'function', 'fetchDistinctDates is exported')
  rpcBodies = []
  sourceTableGets = []
  const dates = await mod.fetchDistinctDates(strEntry, BRAND)
  assert.deepEqual(dates, ['2026-06-01', '2026-06-02', '2026-07-05'], 'RPC dates as sorted strings')
  assert.equal(rpcBodies.length, 1, 'exactly one RPC POST')
  assert.equal(rpcBodies[0].p_source_table, 'sp_search_term_report')
  assert.equal(rpcBodies[0].p_brand_id, BRAND)
  assert.equal(rpcBodies[0].p_ad_types, null, 'no source_filter → null ad_types')
  assert.deepEqual(sourceTableGets, [], 'zero paginated GET/.range() reads against the source table')
})

test('coverage: ad_type-sliced entry passes p_ad_types', async () => {
  const mod = await import('../lib/upload-tracker/coverage.ts')
  rpcBodies = []
  await mod.fetchDistinctDates(spSliceEntry, BRAND)
  assert.equal(rpcBodies.length, 1)
  assert.equal(rpcBodies[0].p_source_table, 'sp_campaign_performance')
  assert.deepEqual(rpcBodies[0].p_ad_types, ['SP'], 'registry source_filter values forwarded')
})

test('coverage companion: RPC error → helper throws naming the source table', async () => {
  const mod = await import('../lib/upload-tracker/coverage.ts')
  failRpc = true
  try {
    await assert.rejects(
      () => mod.fetchDistinctDates(strEntry, BRAND),
      (err: Error) => err.message.includes('sp_search_term_report'),
      'error message names the table'
    )
  } finally {
    failRpc = false
  }
})
