// INB — command-center coverage read must page past PostgREST's 1,000-row default.
//
// The 320-day grid window crossed 1,000 coverage rows; a single un-paginated read silently
// truncated at 1,000, dropping ~21 rows/render → phantom strip gaps + false OVERDUE. This test
// serves 1,021 coverage rows through a PostgREST-emulating double (honouring offset/limit — how
// supabase-js .range() transmits) with the TESTED report's rows placed beyond row 1,000. Pre-fix
// (one read, no offset/limit) drops them → the tile reads OVERDUE with gaps. Paginated → CURRENT.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const TODAY = '2026-07-11' // a Saturday → mostRecentSaturday = itself

// One active weekly tile (target_table has a weekly COVERAGE_CONFIG entry).
const REGISTRY = [{
  report_key: 'test_weekly', display_name: 'Test Weekly', source_group: 'Brand Analytics',
  cadence: 'weekly', pull_period: 'Latest week', target_table: 'brand_analytics_repeat_purchase',
  is_active: true, sort_order: 1, notes: null,
}]

// 21 contiguous, fully-pulled Saturdays for the tested report (data_through = the Saturday).
function saturdaysBack(end: string, n: number) {
  const out: { report_key: string; period_end: string; period_label: string; period_type: string; data_through: string }[] = []
  const d = new Date(end + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    const iso = d.toISOString().slice(0, 10)
    out.push({ report_key: 'test_weekly', period_end: iso, period_label: `W/E ${iso}`, period_type: 'weekly', data_through: iso })
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}
// 1,000 filler rows for a report_key with NO registry row (no tile), then the tested report's 21
// rows — so the tested rows sit at indices 1000..1020, dropped by any un-paginated read.
const FILLER = Array.from({ length: 1000 }, () => ({
  report_key: 'ignore_filler', period_end: '2026-01-03', period_label: 'W/E 2026-01-03', period_type: 'weekly', data_through: '2026-01-03',
}))
const COVERAGE = [...FILLER, ...saturdaysBack(TODAY, 21)]

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const send = (body: unknown) => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
  if (req.method !== 'GET') { res.statusCode = 201; return res.end('[]') }

  // Emulate PostgREST: offset defaults 0, limit defaults to (and is capped at) max-rows = 1000.
  const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0
  const reqLimit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 1000
  const limit = Math.min(reqLimit, 1000)
  const slice = (arr: unknown[]) => send(arr.slice(offset, offset + limit))

  if (url.pathname.endsWith('/report_registry')) return slice(REGISTRY)
  if (url.pathname.endsWith('/report_coverage')) return slice(COVERAGE)
  if (url.pathname.endsWith('/report_ingestion_log')) return slice([])
  return send([])
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { loadCommandCenterUncached } = await import('../lib/command-center/data-core.ts')

test('coverage read pages past 1,000 rows — a report beyond row 1,000 renders CURRENT, no phantom gaps', async () => {
  const vm = await loadCommandCenterUncached(BRAND, TODAY)
  const tile = vm.sections.flatMap(s => s.tiles).find(t => t.reportKey === 'test_weekly')
  assert.ok(tile, 'tile present')
  assert.equal(tile!.status, 'current', 'fully-covered report must not read OVERDUE from a truncated set')
  assert.equal(tile!.strip.filter(c => c.state === 'gap').length, 0, 'no phantom gaps')
})
