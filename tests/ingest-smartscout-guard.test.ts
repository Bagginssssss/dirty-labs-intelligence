// INB-152 — cross-snapshot sanity guard for SmartScout Subcategory Brands uploads.
//
// This morning a Toilet Cleaners brands file ingested under the (sticky) Stain Removers
// subcategory — ~10% brand overlap with the prior Stain Removers snapshot. The guard reads the
// most recent prior snapshot's brand names for the SELECTED subcategory and rejects (400) when
// the incoming file's brand set is near-disjoint (Jaccard < SMARTSCOUT_SNAPSHOT_OVERLAP_MIN).
// First-ever upload for a subcategory (no prior snapshot) must pass cleanly.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Minimal SmartScout Subcategory Brands CSV — headers detect as smartscout_subcategory_brands
// (Market Share + Market Share Change + Ad Spend Share, per report-detector). Brand names are
// the Lysol/Clorox family (a Toilet Cleaners set) — disjoint from the Tide/Persil prior below.
const BRANDS_CSV = [
  'Brand,Estimated Monthly Revenue,Market Share,Market Share Change,Ad Spend Share',
  'Lysol,100000,0.20,0.01,0.05',
  'Clorox,90000,0.18,-0.01,0.04',
  'Scrubbing Bubbles,50000,0.10,0.00,0.02',
].join('\n')

// Prior snapshot the DB double serves for the selected subcategory — a Tide/Persil (laundry)
// set, disjoint from the incoming Lysol/Clorox file → overlap 0 → must be rejected.
const PRIOR_BRAND_NAMES = ['Tide', 'Persil', 'Gain', 'Arm & Hammer', 'All']

// ── DB double ────────────────────────────────────────────────────────────────
// Route-aware: for GETs against smartscout_subcategory_brands it returns either the prior
// snapshot date (when the query selects snapshot_date) or the prior brand names (when it selects
// brand_name), toggled by `servePrior`. When servePrior=false it returns [] (no prior snapshot).
let servePrior = true
const dbDouble = createServer((req, res) => {
  const url = req.url ?? ''
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  res.setHeader('content-type', 'application/json')

  if (req.method === 'GET' && url.includes('smartscout_subcategory_brands')) {
    res.statusCode = 200
    if (!servePrior) return res.end('[]')
    if (url.includes('select=snapshot_date')) return res.end(JSON.stringify([{ snapshot_date: '2026-07-06' }]))
    if (url.includes('select=brand_name')) return res.end(JSON.stringify(PRIOR_BRAND_NAMES.map(n => ({ brand_name: n }))))
    return res.end('[]')
  }

  // Everything else (FK lookups, inserts, log) — succeed trivially.
  res.statusCode = req.method === 'GET' ? 200 : 201
  res.end(JSON.stringify(wantsObject ? {} : []))
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

function post(subcategory: string) {
  const body = new FormData()
  body.append('file', new File([BRANDS_CSV], 'brands.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '2026-07-13')
  body.append('date_range_end', '2026-07-13')
  body.append('subcategory', subcategory)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

test('mismatch: near-disjoint from the prior snapshot → 400, names the dropdown', async () => {
  servePrior = true
  const res = await post('laundry_stain_remover')
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /check the dropdown/i)
})

test('first-ever upload for the subcategory (no prior snapshot) → guard does not fire', async () => {
  servePrior = false
  const res = await post('toilet_bowl_cleaner')
  // The guard must not reject; any non-guard outcome is acceptable — we only assert it is NOT a
  // "check the dropdown" 400.
  if (res.status === 400) {
    const json = await res.json()
    assert.doesNotMatch(String(json.error), /check the dropdown/i, 'no prior → guard must not fire')
  }
})
