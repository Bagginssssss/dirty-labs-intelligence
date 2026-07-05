// INB-136 — S&S rails resolved by COVERING period, not exact period-start date.
//
// subscribe_and_save rows are overlapping rolling ~30-day windows labeled at
// period START (report_date) with period END in date_range_end. The old
// .eq('report_date', day) join meant a period contributed only on its literal
// start day — every other covered day wrote 0 (June showed 0 across the board).
// Agreed model (INB-136): ss_active_subscriptions is STATE → CARRY the covering
// period's balance; ss_revenue is FLOW → DISTRIBUTE period total ÷ covered days;
// overlaps resolve to the LATEST covering period per (asin,sku), PER RAIL among
// rows with non-null data (a degenerate null-row period must never zero a rail).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// Supabase HTTP double with just enough PostgREST filter semantics to be honest:
// report_date=eq.D returns rows whose period START is D (what the pre-change
// join receives); report_date=lte.D returns periods started on/before D (the
// covering query's superset — the resolver still applies exact coverage).
// Upserts to derived_metrics_daily get 201.
// ---------------------------------------------------------------------------

let snsRows: Row[] = []
let dailyCampaigns: Record<string, Row[]> = {}
let dailyBusiness: Record<string, Row[]> = {}

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST') return respond(201, [])

  const dateFilter = url.searchParams.get('report_date') ?? ''
  const [op, day] = dateFilter.split('.', 2) as [string, string]

  if (url.pathname.endsWith('/sp_campaign_performance')) {
    return respond(200, op === 'eq' ? (dailyCampaigns[day] ?? []) : [])
  }
  if (url.pathname.endsWith('/business_report_daily')) {
    return respond(200, op === 'eq' ? (dailyBusiness[day] ?? []) : [])
  }
  if (url.pathname.endsWith('/subscribe_and_save')) {
    if (op === 'eq') return respond(200, snsRows.filter(r => r.report_date === day))
    if (op === 'lte') return respond(200, snsRows.filter(r => String(r.report_date) <= day))
    return respond(200, [])
  }
  return respond(200, [])
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { calculateDerivedMetrics } = await import('../lib/derived-metrics.ts')

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

function sns(asin: string, sku: string, start: string, end: string | null,
             active: number | null, revenue: number | null): Row {
  return {
    asin_id: asin, sku, report_date: start, date_range_end: end,
    active_subscriptions: active, ss_revenue: revenue, ss_units_shipped: null,
  }
}

const closeTo = (actual: unknown, expected: number, label: string, eps = 1e-6) =>
  assert.ok(Math.abs(Number(actual) - expected) < eps,
    `${label}: expected ≈${expected}, got ${actual}`)

// Single period 2026-06-01 → 2026-06-30 (30 days), two (asin,sku) groups.
// Balances 500 + 350 = 850; revenue 3000 + 1500 = 4500 → 150/day.
const SINGLE_PERIOD = [
  sns('A1', 'S1', '2026-06-01', '2026-06-30', 500, 3000),
  sns('A2', 'S2', '2026-06-01', '2026-06-30', 350, 1500),
]

// ---------------------------------------------------------------------------
// Fail-first core (FAIL on pre-INB-136 exact-date join)
// ---------------------------------------------------------------------------

test('S&S: a mid-period day gets carried balance + distributed daily revenue', async () => {
  snsRows = SINGLE_PERIOD
  const { metrics } = await calculateDerivedMetrics(BRAND, '2026-06-15')
  assert.equal(metrics.ss_active_subscriptions, 850, 'carry: sum of covering balances')
  closeTo(metrics.ss_revenue, 150, 'distribute: 4500 / 30 days')
})

test('S&S anti-overcount: every covered day ≈ total/days and the sum reproduces the source total', async () => {
  snsRows = SINGLE_PERIOD
  let sum = 0
  for (let d = 1; d <= 30; d++) {
    const day = `2026-06-${String(d).padStart(2, '0')}`
    const { metrics } = await calculateDerivedMetrics(BRAND, day)
    closeTo(metrics.ss_revenue, 150, `uniform daily rate on ${day}`)
    sum += metrics.ss_revenue
  }
  closeTo(sum, 4500, 'sum over the period equals the source period total exactly')
})

test('S&S overlap: latest covering period wins per (asin,sku) — no double count', async () => {
  snsRows = [
    sns('A1', 'S1', '2026-06-01', '2026-06-30', 500, 3000),
    sns('A1', 'S1', '2026-06-10', '2026-07-09', 620, 6200),
  ]
  const { metrics } = await calculateDerivedMetrics(BRAND, '2026-06-15')
  assert.equal(metrics.ss_active_subscriptions, 620, 'newer period B wins the state rail')
  closeTo(metrics.ss_revenue, 6200 / 30, 'only B’s daily rate — never A+B')
})

test('S&S degenerate guard: a newer covering period with NULL rails must not zero the day', async () => {
  snsRows = [
    sns('A1', 'S1', '2026-06-01', '2026-06-30', 500, 3000),
    sns('A1', 'S1', '2026-06-10', '2026-07-09', null, null), // degenerate pull
  ]
  const { metrics } = await calculateDerivedMetrics(BRAND, '2026-06-15')
  assert.equal(metrics.ss_active_subscriptions, 500, 'per-rail fallback to the older non-null period')
  closeTo(metrics.ss_revenue, 100, 'per-rail fallback: 3000 / 30')
})

test('resolveSnsForDay: inclusive coverage bounds; null date_range_end covers only the start day', async () => {
  const mod = await import('../lib/derived-metrics.ts')
  assert.equal(typeof mod.resolveSnsForDay, 'function', 'resolveSnsForDay is exported')
  const period = [sns('A1', 'S1', '2026-06-01', '2026-06-30', 100, 300)]
  assert.equal(mod.resolveSnsForDay(period, '2026-06-01').activeSubscriptions, 100, 'start day covered')
  assert.equal(mod.resolveSnsForDay(period, '2026-06-30').activeSubscriptions, 100, 'end day covered')
  assert.equal(mod.resolveSnsForDay(period, '2026-05-31').activeSubscriptions, 0, 'day before start not covered')
  assert.equal(mod.resolveSnsForDay(period, '2026-07-01').activeSubscriptions, 0, 'day after end not covered')

  const noEnd = [sns('A1', 'S1', '2026-06-05', null, 42, 84)]
  assert.equal(mod.resolveSnsForDay(noEnd, '2026-06-05').activeSubscriptions, 42, 'null end: start day covered')
  closeTo(mod.resolveSnsForDay(noEnd, '2026-06-05').ssRevenue, 84, 'null end: 1-day period, full value')
  assert.equal(mod.resolveSnsForDay(noEnd, '2026-06-06').activeSubscriptions, 0, 'null end: no carry-forward')
})

// ---------------------------------------------------------------------------
// Daily-feed regression guardrail (passes before AND after — untouched paths)
// ---------------------------------------------------------------------------

test('regression: daily PPC + business_report_daily rails are computed exactly as before', async () => {
  snsRows = []
  dailyCampaigns = {
    '2026-06-15': [
      { ad_type: 'SP', spend: 100, sales_7d: 300, orders_7d: 10, clicks: 50, impressions: 1000, ntb_orders_14d: 0, ntb_sales_14d: 0 },
      { ad_type: 'SB', spend: 40, sales_7d: 120, orders_7d: 4, clicks: 20, impressions: 500, ntb_orders_14d: 2, ntb_sales_14d: 50 },
    ],
  }
  dailyBusiness = {
    '2026-06-15': [{ ordered_product_sales: 1000, units_ordered: 40, sessions_total: 200, total_order_items: 40 }],
  }
  const { metrics } = await calculateDerivedMetrics(BRAND, '2026-06-15')
  assert.equal(metrics.total_ppc_spend, 140)
  assert.equal(metrics.total_ppc_sales, 420)
  assert.equal(metrics.total_revenue, 1000)
  closeTo(metrics.aov, 25, 'aov = 1000 / 40')
  closeTo(metrics.sp_roas, 3, 'sp roas')
  assert.equal(metrics.ntb_orders, 2)
  dailyCampaigns = {}
  dailyBusiness = {}
})
