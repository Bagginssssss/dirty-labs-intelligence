// INB-188 — Amazon renamed the S&S Daily Reorder column in BOTH exports ("Reorder (CUSTOM)" →
// "Total Reorder (CUSTOM)"; "Reorder Rate (CUSTOM)" → "Total  Reorder (CUSTOM)", doubled space) and
// added a Buy Again & Save column to each. The loader identified the files by the Reorder column, so
// neither was recognized → every column unmapped → 400 for three weeks.
//
// Fixtures sns-daily-{sales,share}-v2.csv are WHOLE, byte-identical copies of the 2026-11-02 12:54 pull
// (BOM included, Oct 1–30, 30 rows each). Never retype them: the doubled spaces are the only thing
// separating the two files' headers, and every prose rendering collapses them (the INB-167 failure mode).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  mapSnsDashboardDaily, unmappedSnsDailyColumns, snsDailyRangeViolations,
  identifySnsDailyReport, SNS_DAILY_REPORTS,
} from '../lib/mappers/sns-dashboard-daily.ts'
import { deriveReportKey, REPORT_REGISTRY_SEED } from '../lib/report-registry.ts'
import { parseCSV } from '../lib/csv-parser.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

const raw = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')
const SALES_CSV = raw('sns-daily-sales-v2.csv')
const SHARE_CSV = raw('sns-daily-share-v2.csv')
const sales = parseCSV(SALES_CSV)
const share = parseCSV(SHARE_CSV)
const mapAll = (p: ReturnType<typeof parseCSV>) => p.rows.flatMap(r => mapSnsDashboardDaily(r, BRAND))

// Swap one file's header line onto the other file's data — the two misidentification scenarios.
const headerLine = (csv: string) => csv.split('\n')[0]
const withHeader = (csv: string, header: string) => [header, ...csv.split('\n').slice(1)].join('\n')

// ── byte pins: the fixtures carry the exact Amazon header strings ───────────────────
test('INB-188 fixtures: header strings are byte-exact (lengths pin the doubled spaces)', () => {
  // Lengths are the guard: a whitespace-collapsed literal or fixture fails here, not silently later.
  assert.deepEqual(sales.headers.map(h => [h, h.length]), [
    ['calc_date_granularity', 21],
    ['Total Reorder (CUSTOM)', 22],
    ['Subscribe & Save (CUSTOM)', 25],
    ['Buy Again & Save (CUSTOM)', 25],
  ])
  assert.deepEqual(share.headers.map(h => [h, h.length]), [
    ['calc_date_granularity', 21],
    ['Total  Reorder (CUSTOM)', 23],
    ['Subscribe  &  Save (CUSTOM)', 27],
    ['Buy Again  &  Save  (CUSTOM)', 28],
  ])
  assert.equal(sales.rows.length, 30)
  assert.equal(share.rows.length, 30)
})

// ── the fix: both real files identify, map fully, and resolve their report_key ──────
test('INB-188: the real Sales export → sns_dashboard_sales; 3 metrics × 30 dates = 90 rows; no unmapped', () => {
  assert.equal(identifySnsDailyReport(sales.headers)?.reportKey, 'sns_dashboard_sales')
  assert.deepEqual(unmappedSnsDailyColumns(sales.headers), [])
  const mapped = mapAll(sales)
  assert.equal(mapped.length, 90)
  assert.deepEqual([...new Set(mapped.map(r => r.metric))].sort(), ['buy_again_sales', 'reorder_sales', 'sns_sales'])
  assert.equal(new Set(mapped.map(r => r.metric_date)).size, 30)
  assert.ok(mapped.every(r => typeof r.value === 'number'), 'no null values')
  assert.equal(deriveReportKey('sns_dashboard_daily', sales.headers, mapped as Record<string, unknown>[]).reportKey, 'sns_dashboard_sales')
  assert.deepEqual(snsDailyRangeViolations(mapped), [])
})

test('INB-188: the real Share export → sns_dashboard_reorder_share; 3 metrics × 30 dates = 90 rows; no unmapped', () => {
  assert.equal(identifySnsDailyReport(share.headers)?.reportKey, 'sns_dashboard_reorder_share')
  assert.deepEqual(unmappedSnsDailyColumns(share.headers), [])
  const mapped = mapAll(share)
  assert.equal(mapped.length, 90)
  assert.deepEqual([...new Set(mapped.map(r => r.metric))].sort(), ['buy_again_share', 'reorder_rate', 'sns_sales_share'])
  assert.equal(new Set(mapped.map(r => r.metric_date)).size, 30)
  assert.ok(mapped.every(r => typeof r.value === 'number'), 'no null values')
  assert.equal(deriveReportKey('sns_dashboard_daily', share.headers, mapped as Record<string, unknown>[]).reportKey, 'sns_dashboard_reorder_share')
  assert.deepEqual(snsDailyRangeViolations(mapped), [])
})

// ── the authoritative mapping check: Sales ÷ Share = one daily total for all three pairs ─
test('INB-188 identity: for every date, X_sales ÷ X_share is the same total for reorder, S&S and Buy Again', () => {
  // A swapped or mis-paired column cannot satisfy this on 30 real days; it is independent of any band.
  const byDate = (rows: ReturnType<typeof mapAll>) => {
    const m = new Map<string, Record<string, number>>()
    for (const r of rows) {
      const d = r.metric_date as string
      ;(m.get(d) ?? m.set(d, {}).get(d)!)[r.metric as string] = r.value as number
    }
    return m
  }
  const s = byDate(mapAll(sales)), q = byDate(mapAll(share))
  assert.equal(s.size, 30)
  for (const [d, sv] of s) {
    const qv = q.get(d)!
    const totals = [
      sv.reorder_sales / qv.reorder_rate,
      sv.sns_sales / qv.sns_sales_share,
      sv.buy_again_sales / qv.buy_again_share,
    ]
    assert.ok(totals.every(Number.isFinite), `${d}: all three pairs present`)
    const spread = (Math.max(...totals) - Math.min(...totals)) / Math.min(...totals)
    assert.ok(spread < 1e-9, `${d}: implied totals diverge ${totals.join(' / ')}`)
  }
})

// ── signatures stay mutually exclusive; legacy forms still ingest ───────────────────
test('INB-188 signatures: every signature (current + legacy) is unique, exact, and one of its own columns', () => {
  const all = SNS_DAILY_REPORTS.flatMap(r => [r.signature, ...(r.legacySignatures ?? [])])
  assert.equal(new Set(all).size, all.length, 'no signature shared between reports')
  for (const r of SNS_DAILY_REPORTS) {
    for (const sig of [r.signature, ...(r.legacySignatures ?? [])]) assert.ok(sig in r.columns, `${r.reportKey}: ${sig} is a column`)
  }
  // Exactness matters MORE now: legacy "Reorder (CUSTOM)" is a suffix of BOTH new Reorder headers, so
  // any includes/endsWith match would claim the Share file for Sales.
  assert.ok(share.headers[1].endsWith('Reorder (CUSTOM)') && sales.headers[1].endsWith('Reorder (CUSTOM)'))
  const salesSigs = SNS_DAILY_REPORTS.find(r => r.reportKey === 'sns_dashboard_sales')!
  for (const sig of [salesSigs.signature, ...(salesSigs.legacySignatures ?? [])]) {
    assert.equal(share.headers.includes(sig), false, `Share headers must not contain the Sales signature ${JSON.stringify(sig)}`)
  }
})

test('INB-188 legacy: the 10-20 intermediate form (Total Reorder, no Buy Again) identifies with no unmapped columns', () => {
  // Real 10-20 pull = the v2 headers minus the Buy Again column.
  const salesMid = sales.headers.slice(0, 3), shareMid = share.headers.slice(0, 3)
  assert.equal(identifySnsDailyReport(salesMid)?.reportKey, 'sns_dashboard_sales')
  assert.equal(identifySnsDailyReport(shareMid)?.reportKey, 'sns_dashboard_reorder_share')
  assert.deepEqual(unmappedSnsDailyColumns(salesMid), [])
  assert.deepEqual(unmappedSnsDailyColumns(shareMid), [])
})

test('INB-188 legacy: the pre-rename headers still map (old Reorder keys retained)', () => {
  const oldSales = { 'calc_date_granularity': '2026-10-05 00:00:00', 'Reorder (CUSTOM)': '57154.69', 'Subscribe & Save (CUSTOM)': '25303' }
  const oldShare = { 'calc_date_granularity': '2026-10-05 00:00:00', 'Subscribe  &  Save (CUSTOM)': '0.313217692547553', 'Reorder Rate (CUSTOM)': '0.7074995107327472' }
  assert.deepEqual(mapSnsDashboardDaily(oldSales, BRAND).map(r => r.metric), ['reorder_sales', 'sns_sales'])
  assert.deepEqual(mapSnsDashboardDaily(oldShare, BRAND).map(r => r.metric), ['sns_sales_share', 'reorder_rate'])
})

// ── routing completeness: a mapped slug missing from SLUG_TO_KEY is DROPPED silently ─────
test('INB-188: each new Buy Again slug alone routes to its own file\'s report_key', () => {
  assert.equal(deriveReportKey('sns_dashboard_daily', [], [{ metric: 'buy_again_sales' }]).reportKey, 'sns_dashboard_sales')
  assert.equal(deriveReportKey('sns_dashboard_daily', [], [{ metric: 'buy_again_share' }]).reportKey, 'sns_dashboard_reorder_share')
})

test('INB-188 completeness: every mapped slug routes to its report AND is in that report\'s registry discriminator', () => {
  // deriveReportKey filters unknown slugs out (filter(Boolean)), so a gap here would let an upload pass with
  // the metric unrouted; and a slug outside the discriminator is invisible to coverage. Both fail here instead.
  for (const r of SNS_DAILY_REPORTS) {
    const seed = REPORT_REGISTRY_SEED.find(s => s.report_key === r.reportKey)
    assert.ok(seed, `${r.reportKey} is in REPORT_REGISTRY_SEED`)
    const values = (seed!.discriminator as { values?: string[] } | null)?.values ?? []
    for (const slug of new Set(Object.values(r.columns))) {
      assert.equal(deriveReportKey('sns_dashboard_daily', [], [{ metric: slug }]).reportKey, r.reportKey, `${slug} → ${r.reportKey}`)
      assert.ok(values.includes(slug), `${slug} is in the ${r.reportKey} discriminator [${values.join(', ')}]`)
    }
  }
})

// ── misidentification is BLOCKED, not stored (the files now differ only by whitespace) ───
test('INB-188 guard: Share data under single-spaced (Sales) headers → identified as Sales, then range-blocked', () => {
  const p = parseCSV(withHeader(SHARE_CSV, headerLine(SALES_CSV)))
  assert.equal(identifySnsDailyReport(p.headers)?.reportKey, 'sns_dashboard_sales') // the whitespace-only difference
  const v = snsDailyRangeViolations(mapAll(p))
  assert.equal(v.length, 30, 'every date: a ~0.3 share fraction landed in sns_sales (< 1)')
})

test('INB-188 guard: Sales data under doubled-spaced (Share) headers → identified as Share, then range-blocked', () => {
  const p = parseCSV(withHeader(SALES_CSV, headerLine(SHARE_CSV)))
  assert.equal(identifySnsDailyReport(p.headers)?.reportKey, 'sns_dashboard_reorder_share')
  const v = snsDailyRangeViolations(mapAll(p))
  assert.equal(v.length, 30, 'every date: ~20k dollars landed in sns_sales_share (> 1)')
})

// ── route e2e (HTTP-double pattern, per ingest-sns-dashboard.test.ts) ─────────────────
const dbDouble = createServer((req, res) => {
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  res.statusCode = req.method === 'GET' ? 200 : 201
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(wantsObject ? {} : []))
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(dbDouble.address() as { port: number }).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

function post(csv: string) {
  const body = new FormData()
  body.append('file', new File([csv], 'sns.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

test('INB-188 e2e: the real Sales file uploads green — 90 rows stored', async () => {
  const res = await post(SALES_CSV)
  const json = await res.json()
  assert.equal(res.status, 200, JSON.stringify(json))
  assert.equal(json.rows_stored, 90)
})

test('INB-188 e2e: the real Share file uploads green — 90 rows stored', async () => {
  const res = await post(SHARE_CSV)
  const json = await res.json()
  assert.equal(res.status, 200, JSON.stringify(json))
  assert.equal(json.rows_stored, 90)
})

test('INB-188 e2e: a single-spaced Share file is REJECTED by the range guard, zero rows stored', async () => {
  const res = await post(withHeader(SHARE_CSV, headerLine(SALES_CSV)))
  const json = await res.json()
  assert.equal(res.status, 400)
  assert.match(String(json.error), /Upload blocked: S&S Dashboard daily value out of range/)
  assert.equal(json.rows_stored, undefined)
})
