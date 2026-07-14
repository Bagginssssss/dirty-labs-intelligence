// INB-141 — route e2e for BA Repeat Purchase (HTTP-double): preamble skip end-to-end,
// brand=1 / asin=N rows stored, report_key logged.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const logInserts: Record<string, unknown>[] = []
const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') return send(200, wantsObject ? {} : [])
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/report_ingestion_log')) {
      try { const b = JSON.parse(raw); logInserts.push(Array.isArray(b) ? b[0] : b) } catch { /* ignore */ }
    }
    return send(wantsObject ? 200 : 201, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const PREAMBLE = 'Reporting Range=["Weekly"],Select week=["Week 28 | 2026-07-05 - 2026-07-11 2026"]'
const METRIC_HEADER = '"Number of Orders","Unique Customer Count","Repeat Ordered Product Sales: Sales","Repeat Ordered Product Sales: Change vs. Prior Period","Repeat Ordered Product Sales: % Share of Total Sales","Repeat Ordered Units: Units","Repeat Ordered Units: Change vs. Prior Period","Repeat Ordered Units: % Share of Total Units","Repeat Customer Count: Count","Repeat Customer Count: Change vs. Prior Period","Repeat Customer Share: % Share of Total Customers","Repeat Customer Share: Change vs. Prior Period"'
const METRICS = '"17890","16475","39871.99","13.87","8.07","1672","15.31","8.13","1219","10.12","7.4","0.13"'
const AMETRICS = '"2362","2323","836.54","-19.68","1.54","42","-14.29","1.67","38","-17.39","1.64","-0.48"'

const BRAND_CSV = [PREAMBLE, `"Brand Name",${METRIC_HEADER},"Reporting Date"`, `"Dirty Labs",${METRICS},"2026-07-11"`].join('\n')
const ASIN_CSV = [
  PREAMBLE,
  `"ASIN","Product Title","Brand Name","Category Name",${METRIC_HEADER},"Reporting Date"`,
  `"B09B7WLWW3","Title A","Dirty Labs","Health & Personal Care",${AMETRICS},"2026-07-11"`,
  `"B09B7YS1VK","Title B","Dirty Labs","Health & Personal Care",${AMETRICS},"2026-07-11"`,
].join('\n')

function post(csv: string, name: string) {
  const body = new FormData()
  body.append('file', new File([csv], name, { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

test('brand view: preamble skipped, 1 row stored, report_key=ba_repeat_purchase_brand', async () => {
  logInserts.length = 0
  const res = await post(BRAND_CSV, 'RPB_Brand.csv')
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.table, 'brand_analytics_repeat_purchase')
  assert.equal(json.rows_stored, 1)
  assert.equal(logInserts[0]?.report_key, 'ba_repeat_purchase_brand')
})

test('ASIN view: 2 data rows stored, report_key=ba_repeat_purchase_asin', async () => {
  logInserts.length = 0
  const res = await post(ASIN_CSV, 'RPB_ASIN.csv')
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.rows_stored, 2)
  assert.equal(logInserts[0]?.report_key, 'ba_repeat_purchase_asin')
})
