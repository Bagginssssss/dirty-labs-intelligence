// INB-109 — period-aggregate report types must not be ingestible without the
// upload form's date range. business_report derives every row's report_date from
// date_range_start (its CSV has no date column), so blank form fields produced
// report_date = NULL and the DB's NOT NULL constraint silently killed the whole
// upload. These tests pin the upload-time gate at both levels: the pure helper in
// lib/ingest-validation.ts and the real /api/ingest POST handler.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Dummy Supabase env BEFORE importing the route: supabase-admin constructs its
// client at module scope, and pointing it at an unreachable local port guarantees
// no test can ever touch a real database (any accidental call fails instantly).
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Detects as business_report: sessions + buy_box + child_asin, and no "date"
// header (which would divert to business_report_daily).
const BUSINESS_REPORT_CSV = [
  '(Child) ASIN,Title,Sessions - Total,Featured Offer (Buy Box) Percentage,Units Ordered,Ordered Product Sales',
  'B0TEST00001,Test Product One,100,95%,10,"$250.00"',
  'B0TEST00002,Test Product Two,50,90%,5,"$125.00"',
].join('\n')

// Detects as subscribe_and_save: sns_shipped_units + period_end_subscription_balance
// + sns_sales_penetration. Inline-date — dates live in the CSV itself.
const SNS_CSV = [
  'ASIN,SKU,Reporting Period Start,Reporting Period End,SnS shipped units,Period End Subscription Balance,SnS Sales Penetration %',
  'B0TEST00001,SKU-1,2026-06-01,2026-06-07,12,40,3.5%',
].join('\n')

const FORM_DEPENDENT = [
  'business_report',
  'smartscout_subcategory_brands',
  'smartscout_subcategory_products',
]
const INLINE_DATE = [
  'subscribe_and_save',
  'sp_campaign_performance',
  'search_query_performance',
  'unknown',
]

function postIngest(csv: string, dates: { start: string; end: string }) {
  const body = new FormData()
  body.append('file', new File([csv], 'report.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  // UploadArea always appends both fields, as '' when blank — mirror that.
  body.append('date_range_start', dates.start)
  body.append('date_range_end', dates.end)
  return POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
}

async function gateFired(res: Response): Promise<boolean> {
  if (res.status !== 400) return false
  const json = await res.json()
  return /period-aggregate/.test(String(json.error ?? ''))
}

// ---------------------------------------------------------------------------
// The gate (fail-first: these three FAIL on pre-INB-109 code)
// ---------------------------------------------------------------------------

test('gate: business_report upload with empty date range → 400 with actionable error', async () => {
  const res = await postIngest(BUSINESS_REPORT_CSV, { start: '', end: '' })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.match(String(json.error), /period-aggregate/)
  assert.match(String(json.error), /Date Range Start/i)
})

test('helper: periodDatesError flags every form-dependent type when either date is blank', async () => {
  const mod = await import('../lib/ingest-validation.ts')
  assert.equal(typeof mod.periodDatesError, 'function', 'periodDatesError is exported')
  for (const type of FORM_DEPENDENT) {
    for (const [start, end] of [['', ''], ['2026-06-01', ''], ['', '2026-06-30']]) {
      const err = mod.periodDatesError(type, start, end)
      assert.ok(
        typeof err === 'string' && /period-aggregate/.test(err),
        `${type} with (start='${start}', end='${end}') must error`
      )
    }
  }
})

test('helper: requiresPeriodDates true for exactly the form-dependent types', async () => {
  const mod = await import('../lib/ingest-validation.ts')
  assert.equal(typeof mod.requiresPeriodDates, 'function', 'requiresPeriodDates is exported')
  for (const type of FORM_DEPENDENT) assert.equal(mod.requiresPeriodDates(type), true, type)
  for (const type of INLINE_DATE) assert.equal(mod.requiresPeriodDates(type), false, type)
})

// ---------------------------------------------------------------------------
// No-false-positive guards (pass before AND after the change)
// ---------------------------------------------------------------------------

test('gate companion: business_report WITH both dates is not gate-rejected', async () => {
  const res = await postIngest(BUSINESS_REPORT_CSV, { start: '2026-06-01', end: '2026-06-30' })
  assert.equal(await gateFired(res), false)
})

test('gate companion: subscribe_and_save (inline-date) with empty dates is not gate-rejected', async () => {
  const res = await postIngest(SNS_CSV, { start: '', end: '' })
  assert.equal(await gateFired(res), false)
})

test('helper: periodDatesError null when both dates present, and for inline-date types regardless', async () => {
  const mod = await import('../lib/ingest-validation.ts')
  // Pre-implementation there is nothing to over-gate; this guard activates with the helper.
  if (typeof mod.periodDatesError !== 'function') return
  for (const type of FORM_DEPENDENT) {
    assert.equal(mod.periodDatesError(type, '2026-06-01', '2026-06-30'), null, type)
  }
  for (const type of INLINE_DATE) {
    assert.equal(mod.periodDatesError(type, '', ''), null, type)
  }
})
