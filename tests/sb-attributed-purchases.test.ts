// INB-149 — SB Attributed Purchases: dedicated detector + aggregating mapper,
// ad_type stamping, report_key flip, NULL-proof key, and the INB-88 nullable-key
// checker extension.
//
// The SB export was misdetecting into the SP purchased-product path (dropping all
// 14d + NTB metrics) and NULL advertised_asin in the unique key let overlapping
// uploads duplicate. These tests pin the fix.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { detectReportType } from '../lib/report-detector.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Real SB Attributed Purchases header (trailing space on "14 Day Total Sales " is
// trimmed by the csv parser; clean keys here). No Advertised SKU / 7-day columns.
const SB_HEADERS = [
  'Date', 'Currency', 'Campaign Name', 'Attribution type', 'Purchased ASIN',
  '14 Day Total Sales', '14 Day Total Orders (#)', '14 Day Total Units (#)',
  '14 Day New-to-brand Sales', '14 Day New-to-brand Orders (#)', '14 Day New-to-brand Units (#)',
  '14 Day % of Sales New-to-brand', '14 Day % of Orders New-to-brand', '14 Day % of Units New-to-brand',
  'Cost type', '14 Day Total Sales - (Click)', '14 Day Total Orders (#) - (Click)', '14 Day Total Units (#) - (Click)',
]
// Real SP Purchased Product header (has Advertised SKU/ASIN + 7 Day Other SKU).
const SP_HEADERS = [
  'Date', 'Portfolio name', 'Campaign Name', 'Country', 'Currency', 'Ad Group Name', 'Retailer',
  'Advertised SKU', 'Advertised ASIN', 'Targeting', 'Match Type', 'Purchased ASIN',
  '7 Day Other SKU Units (#)', '7 Day Other SKU Orders (#)', '7 Day Other SKU Sales',
]

// ---------------------------------------------------------------------------
// Detector separation
// ---------------------------------------------------------------------------

test('detector: SB Attributed Purchases header → sb_attributed_purchases', () => {
  const d = detectReportType(SB_HEADERS)
  assert.equal(d.reportType, 'sb_attributed_purchases')
  assert.equal(d.tableName, 'purchased_product_report')
})

test('detector companion: SP Purchased Product header still → purchased_product_report', () => {
  assert.equal(detectReportType(SP_HEADERS).reportType, 'purchased_product_report')
})

// ---------------------------------------------------------------------------
// Aggregating mapper
// ---------------------------------------------------------------------------

function sbRow(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Date: 'May 16, 2026', Currency: 'USD', 'Campaign Name': 'SBV.BR.KT - Activewear - BR KW - Store',
    'Attribution type': 'Promoted', 'Purchased ASIN': 'B09MSP7M5Y',
    '14 Day Total Sales': '$0.0', '14 Day Total Orders (#)': '0', '14 Day Total Units (#)': '0',
    '14 Day New-to-brand Sales': '$0.0', '14 Day New-to-brand Orders (#)': '0', '14 Day New-to-brand Units (#)': '0',
    'Cost type': 'CPC', '14 Day Total Sales - (Click)': '$0.0', '14 Day Total Orders (#) - (Click)': '0', '14 Day Total Units (#) - (Click)': '0',
    ...o,
  }
}

test('mapper: NTB-split rows aggregate — sum metrics, recompute NTB %', async () => {
  const { mapSbAttributedPurchases } = await import('../lib/mappers/sb-attributed-purchases.ts')
  // The real collision: same date/campaign/asin/attribution, one non-NTB + one NTB.
  const rows = [
    sbRow({ '14 Day Total Sales': '$15.71', '14 Day Total Orders (#)': '1', '14 Day Total Units (#)': '1', '14 Day New-to-brand Sales': '$0.0', '14 Day New-to-brand Orders (#)': '0', '14 Day New-to-brand Units (#)': '0' }),
    sbRow({ '14 Day Total Sales': '$22.0', '14 Day Total Orders (#)': '1', '14 Day Total Units (#)': '1', '14 Day New-to-brand Sales': '$22.0', '14 Day New-to-brand Orders (#)': '1', '14 Day New-to-brand Units (#)': '1' }),
  ]
  const out = mapSbAttributedPurchases(rows, BRAND) as Record<string, unknown>[]
  assert.equal(out.length, 1, 'the NTB split collapses to one row')
  const r = out[0]
  assert.equal(r.sales_14d, 37.71)
  assert.equal(r.orders_14d, 2)
  assert.equal(r.units_14d, 2)
  assert.equal(r.ntb_sales_14d, 22)
  assert.equal(r.ntb_orders_14d, 1)
  // recomputed blended NTB % (percent-as-number, matching parseNumeric of "%"):
  assert.ok(Math.abs((r.ntb_sales_pct as number) - (100 * 22 / 37.71)) < 1e-6)
  assert.equal(r.ad_type, 'SBV')            // SBV. prefix
  assert.equal(r.advertised_asin, '')       // SB rows carry no Advertised ASIN
  assert.equal(r.attribution_type, 'Promoted')
  assert.equal(r.purchased_asin, 'B09MSP7M5Y')
  assert.equal(r.report_date, '2026-05-16')
})

test('mapper: distinct attribution types stay separate rows; ad_type by prefix', async () => {
  const { mapSbAttributedPurchases } = await import('../lib/mappers/sb-attributed-purchases.ts')
  const out = mapSbAttributedPurchases([
    sbRow({ 'Attribution type': 'Promoted', '14 Day Total Sales': '$10.0', '14 Day Total Orders (#)': '1' }),
    sbRow({ 'Attribution type': 'Brand Halo', '14 Day Total Sales': '$5.0', '14 Day Total Orders (#)': '1' }),
    sbRow({ 'Campaign Name': 'SB.BR.KT - Laundry - Branded KW - Store', 'Attribution type': 'Promoted', '14 Day Total Sales': '$3.0' }),
    sbRow({ 'Campaign Name': 'SB - Brand - Store Spotlight - Branded', 'Attribution type': 'Promoted', '14 Day Total Sales': '$2.0' }),
  ], BRAND) as Record<string, unknown>[]
  assert.equal(out.length, 4, 'SBV Promoted + SBV Brand Halo + SB.BR Promoted + SB-dash Promoted = 4 distinct rows')
  const sbdash = out.find(r => r.attribution_type === 'Promoted' && (r as Record<string, unknown>)._campaign_name === 'SB - Brand - Store Spotlight - Branded')!
  assert.equal(sbdash.ad_type, 'SB', '"SB - " space (not SBV.) → SB')
  assert.ok(out.some(r => r.ad_type === 'SB' && r.attribution_type === 'Promoted'))
  assert.ok(out.some(r => r.ad_type === 'SBV' && r.attribution_type === 'Brand Halo'))
})

test('SP mapper: stamps ad_type=SP and empty attribution_type; asins never null', async () => {
  const { mapPurchasedProduct } = await import('../lib/mappers/purchased-product.ts')
  const r = mapPurchasedProduct({
    'Campaign Name': 'SP.BR.KT - Catch All', Date: 'May 19, 2026',
    'Advertised ASIN': 'B0CYN6VF19', 'Purchased ASIN': 'B09B7WLWW3',
  }, BRAND) as Record<string, unknown>
  assert.equal(r.ad_type, 'SP')
  assert.equal(r.attribution_type, '')
  assert.equal(r.advertised_asin, 'B0CYN6VF19')
  assert.equal(r.purchased_asin, 'B09B7WLWW3')
})

// ---------------------------------------------------------------------------
// report_key derivation + registry mirror
// ---------------------------------------------------------------------------

test('deriveReportKey: SB → sb_attributed_purchases, SP → sp_purchased_product', async () => {
  const { deriveReportKey } = await import('../lib/report-registry.ts')
  assert.equal(deriveReportKey('sb_attributed_purchases', SB_HEADERS, [{}]).reportKey, 'sb_attributed_purchases')
  assert.equal(deriveReportKey('purchased_product_report', SP_HEADERS, [{}]).reportKey, 'sp_purchased_product')
})

test('registry seed: purchased-product discriminators flipped to ad_type', async () => {
  const { REPORT_REGISTRY_SEED } = await import('../lib/report-registry.ts')
  const sp = REPORT_REGISTRY_SEED.find(r => r.report_key === 'sp_purchased_product')!
  const sb = REPORT_REGISTRY_SEED.find(r => r.report_key === 'sb_attributed_purchases')!
  assert.deepEqual(sp.discriminator, { column: 'ad_type', values: ['SP'] })
  assert.deepEqual(sb.discriminator, { column: 'ad_type', values: ['SB', 'SBV'] })
})

test('upsert-config: purchased_product_report uses the NULL-proof 7-col key', async () => {
  const { UPSERT_CONFLICT_KEYS } = await import('../lib/upsert-config.ts')
  assert.equal(
    UPSERT_CONFLICT_KEYS.purchased_product_report,
    'brand_id,campaign_id,report_date,ad_type,advertised_asin,purchased_asin,attribution_type',
  )
})

// ---------------------------------------------------------------------------
// INB-88 nullable-key checker extension
// ---------------------------------------------------------------------------

test('nullable-key checker: non-allowlisted table with a nullable key col → violation', async () => {
  const { findNullableUniqueKeyColumns } = await import('../lib/upsert-constraint-check.ts')
  const v = findNullableUniqueKeyColumns(
    [{ table_name: 'ghost_table', index_name: 'uq_ghost', columns: ['a', 'b'], nullable_columns: ['b'] }],
    {},
  )
  assert.equal(v.length, 1)
  assert.equal(v[0].table, 'ghost_table')
  assert.deepEqual(v[0].nullableColumns, ['b'])
})

test('nullable-key checker: allowlisted table is not flagged; empty nullable set is clean', async () => {
  const { findNullableUniqueKeyColumns } = await import('../lib/upsert-constraint-check.ts')
  const allow = { scale_insights_bid_log: 'known' }
  assert.deepEqual(
    findNullableUniqueKeyColumns([{ table_name: 'scale_insights_bid_log', index_name: 'uq_bid_log', columns: ['target'], nullable_columns: ['target'] }], allow),
    [],
  )
  // purchased_product_report post-042 has no nullable key cols → clean even though not allowlisted.
  assert.deepEqual(
    findNullableUniqueKeyColumns([{ table_name: 'purchased_product_report', index_name: 'uq_purchased_product_report', columns: ['brand_id', 'ad_type'], nullable_columns: [] }], {}),
    [],
  )
})

test('nullable-key allowlist: the 7 reconciled tables are present, purchased_product_report is NOT', async () => {
  const { NULLABLE_KEY_ALLOWLIST } = await import('../lib/upsert-config.ts')
  for (const t of ['scale_insights_bid_log', 'scale_insights_keyword_rank', 'smartscout_subcategory_brands',
    'sp_campaign_performance', 'sp_search_term_report', 'sp_targeting_report', 'subscribe_and_save']) {
    assert.ok(t in NULLABLE_KEY_ALLOWLIST, `${t} allowlisted`)
  }
  assert.ok(!('purchased_product_report' in NULLABLE_KEY_ALLOWLIST), 'fixed table not allowlisted')
})

// ---------------------------------------------------------------------------
// e2e: SB upload aggregates + upserts with the 7-col key, logs report_key
// ---------------------------------------------------------------------------

const pprUpserts: { onConflict: string | null; count: number }[] = []
let logReportKey: unknown
const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') {
    if (wantsObject) return send(406, { code: 'PGRST116', message: 'zero rows' }) // campaign maybeSingle → not found
    return send(200, [])
  }
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/purchased_product_report')) {
      let b: unknown = []
      try { b = JSON.parse(raw) } catch { /* ignore */ }
      pprUpserts.push({ onConflict: url.searchParams.get('on_conflict'), count: Array.isArray(b) ? b.length : 1 })
    }
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/report_ingestion_log')) {
      try { const b = JSON.parse(raw); logReportKey = (Array.isArray(b) ? b[0] : b).report_key } catch { /* ignore */ }
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

const SB_CSV = [
  SB_HEADERS.join(','),
  '"May 16, 2026",USD,SBV.BR.KT - Activewear - BR KW - Store,Promoted,B09MSP7M5Y,$15.71,1,1,$0.0,0,0,0.00%,0.00%,0.00%,CPC,$15.71,1,1',
  '"May 16, 2026",USD,SBV.BR.KT - Activewear - BR KW - Store,Promoted,B09MSP7M5Y,$22.0,1,1,$22.0,1,1,100.00%,100.00%,100.00%,CPC,$22.0,1,1',
].join('\n')

test('e2e: SB CSV → aggregated upsert on the 7-col key, report_key=sb_attributed_purchases', async () => {
  pprUpserts.length = 0
  const body = new FormData()
  body.append('file', new File([SB_CSV], 'Sponsored_Brands_Attributed_Purchases_report.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  const json = await res.json() as Record<string, unknown>
  assert.equal(json.table, 'purchased_product_report')
  assert.equal(json.rows_received, 2)
  assert.equal(json.rows_mapped, 1, 'the two NTB-split rows aggregate to one')
  assert.equal(json.rows_stored, 1)
  assert.equal(logReportKey, 'sb_attributed_purchases')
  assert.ok(pprUpserts.length >= 1)
  assert.equal(pprUpserts[0].onConflict, 'brand_id,campaign_id,report_date,ad_type,advertised_asin,purchased_asin,attribution_type')
})
