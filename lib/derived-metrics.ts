import { supabaseAdmin } from '@/lib/supabase-admin'

type Row = Record<string, unknown>

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function sumField(rows: Row[], field: string): number {
  return rows.reduce((acc, r) => acc + toNum(r[field]), 0)
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

// ─── S&S covering-period resolution (INB-136) ─────────────────────────────────
//
// subscribe_and_save rows are period aggregates: overlapping rolling ~30-day
// windows pulled weekly, labeled at period START (report_date) with the end in
// date_range_end. A daily metric therefore resolves each day against the period
// that COVERS it, per (asin_id, sku), with two per-rail rules agreed in INB-136:
//   • active_subscriptions is STATE (period-end balance) → CARRY the covering
//     period's value onto each covered day (consumers read the latest day).
//   • ss_revenue is FLOW (period total) → DISTRIBUTE total ÷ covered days
//     (consumers SUM daily rows; carrying would inflate ~30×).
// Overlaps: the LATEST covering period wins (max report_date), decided PER RAIL
// among rows with non-null data — a degenerate pull with null rails must never
// zero a covered day. Null date_range_end → the row covers only its start day.

export interface SnsPeriodRow {
  asin_id: string | null
  sku: string | null
  report_date: string
  date_range_end: string | null
  active_subscriptions: number | null
  ss_revenue: number | null
}

export interface SnsDayValues {
  activeSubscriptions: number
  ssRevenue: number
  rowsCovering: number
}

function daysInclusive(start: string, end: string): number {
  const ms = Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')
  return Math.round(ms / 86_400_000) + 1
}

export function resolveSnsForDay(rows: SnsPeriodRow[], date: string): SnsDayValues {
  const covering = rows.filter(r => {
    const end = r.date_range_end ?? r.report_date
    return r.report_date <= date && date <= end
  })

  // Group covering rows by (asin_id, sku); within each group pick the latest
  // period independently for each rail among rows where that rail is non-null.
  const groups = new Map<string, SnsPeriodRow[]>()
  for (const row of covering) {
    const key = `${row.asin_id ?? ''}::${row.sku ?? ''}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  const latestWith = (list: SnsPeriodRow[], rail: 'active_subscriptions' | 'ss_revenue') =>
    list
      .filter(r => r[rail] !== null && r[rail] !== undefined)
      .reduce<SnsPeriodRow | null>(
        (best, r) => (best === null || r.report_date > best.report_date ? r : best),
        null,
      )

  let activeSubscriptions = 0
  let ssRevenue = 0
  for (const list of groups.values()) {
    const stateWinner = latestWith(list, 'active_subscriptions')
    if (stateWinner) activeSubscriptions += toNum(stateWinner.active_subscriptions)

    const flowWinner = latestWith(list, 'ss_revenue')
    if (flowWinner) {
      const end = flowWinner.date_range_end ?? flowWinner.report_date
      ssRevenue += toNum(flowWinner.ss_revenue) / daysInclusive(flowWinner.report_date, end)
    }
  }

  return { activeSubscriptions, ssRevenue, rowsCovering: covering.length }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DailyMetrics {
  total_ppc_spend:         number
  total_ppc_sales:         number
  blended_roas:            number | null
  sp_roas:                 number | null
  sb_roas:                 number | null
  total_revenue:           number
  organic_revenue:         number
  mer:                     number | null
  ntb_orders:              number
  ntb_rate:                number | null
  total_orders:            number
  aov:                     number | null
  total_clicks:            number
  total_impressions:       number
  account_cvr:             number | null
  ss_active_subscriptions: number
  ss_revenue:              number
  ss_revenue_pct_of_total: number | null
}

export interface CalculationResult {
  status:     'ok' | 'no_data'
  brand_id:   string
  date:       string
  metrics:    DailyMetrics
  rows_found: { campaigns: number; business: number; subscribe_and_save: number }
}

// ─── Core calculation ─────────────────────────────────────────────────────────

export async function calculateDerivedMetrics(
  brandId: string,
  date: string
): Promise<CalculationResult> {

  // Step 1 — Pull raw data in parallel
  const [{ data: campaignData }, { data: businessData }, { data: ssData }] = await Promise.all([
    supabaseAdmin
      .from('sp_campaign_performance')
      .select('ad_type, spend, sales_7d, orders_7d, clicks, impressions, ntb_orders_14d, ntb_sales_14d')
      .eq('brand_id', brandId)
      .eq('report_date', date),
    supabaseAdmin
      .from('business_report_daily')
      .select('ordered_product_sales, units_ordered, sessions_total, total_order_items')
      .eq('brand_id', brandId)
      .eq('report_date', date),
    // INB-136: S&S is period-aggregate (report_date = period start) — fetch the
    // periods COVERING this day, not the ones starting on it. The or-clause keeps
    // legacy rows with a null period end (they cover only their start day).
    supabaseAdmin
      .from('subscribe_and_save')
      .select('asin_id, sku, report_date, date_range_end, active_subscriptions, ss_revenue')
      .eq('brand_id', brandId)
      .lte('report_date', date)
      .or(`date_range_end.gte.${date},and(date_range_end.is.null,report_date.eq.${date})`),
  ])

  const campaigns = (campaignData ?? []) as Row[]
  const business  = (businessData ?? []) as Row[]
  const ss        = (ssData ?? []) as unknown as SnsPeriodRow[]

  // Step 2 — Segment by ad type and aggregate
  const sp    = campaigns.filter(r => r.ad_type === 'SP')
  const sb    = campaigns.filter(r => r.ad_type === 'SB')
  const sbv   = campaigns.filter(r => r.ad_type === 'SBV')
  const sbSbv = [...sb, ...sbv]

  const spSpend    = sumField(sp, 'spend')
  const spSales    = sumField(sp, 'sales_7d')
  const sbSbvSpend = sumField(sbSbv, 'spend')
  const sbSbvSales = sumField(sbSbv, 'sales_7d')

  const totalSpend       = sumField(campaigns, 'spend')
  const totalSales       = sumField(campaigns, 'sales_7d')
  const totalOrders      = Math.round(sumField(campaigns, 'orders_7d'))
  const totalClicks      = Math.round(sumField(campaigns, 'clicks'))
  const totalImpressions = Math.round(sumField(campaigns, 'impressions'))
  const ntbOrders        = Math.round(sumField(sbSbv, 'ntb_orders_14d'))

  const totalRevenue    = sumField(business, 'ordered_product_sales')
  const totalOrderItems = Math.round(sumField(business, 'total_order_items'))
  const organicRevenue  = Math.max(0, totalRevenue - totalSales)

  // INB-136: carry state / distribute flow from the covering S&S period(s).
  const snsDay       = resolveSnsForDay(ss, date)
  const ssActiveSubs = Math.round(snsDay.activeSubscriptions)
  const ssRev        = snsDay.ssRevenue

  const metrics: DailyMetrics = {
    total_ppc_spend:         totalSpend,
    total_ppc_sales:         totalSales,
    blended_roas:            ratio(totalSales, totalSpend),
    sp_roas:                 ratio(spSales, spSpend),
    sb_roas:                 ratio(sbSbvSales, sbSbvSpend),
    total_revenue:           totalRevenue,
    organic_revenue:         organicRevenue,
    mer:                     ratio(totalRevenue, totalSpend),
    ntb_orders:              ntbOrders,
    ntb_rate:                ratio(ntbOrders, totalOrders),
    total_orders:            totalOrders,
    // AOV = revenue / total_order_items (from business_report), not orders from campaign data
    aov:                     ratio(totalRevenue, totalOrderItems),
    total_clicks:            totalClicks,
    total_impressions:       totalImpressions,
    account_cvr:             ratio(totalOrders, totalClicks),
    ss_active_subscriptions: ssActiveSubs,
    ss_revenue:              ssRev,
    ss_revenue_pct_of_total: ratio(ssRev, totalRevenue),
  }

  // Step 3 — Upsert into derived_metrics_daily
  const { error } = await supabaseAdmin
    .from('derived_metrics_daily')
    .upsert(
      {
        brand_id:      brandId,
        metric_date:   date,
        ...metrics,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,metric_date' }
    )

  if (error) throw new Error(`Upsert failed for ${date}: ${error.message}`)

  // Step 4 — Return summary
  return {
    status:     campaigns.length > 0 || business.length > 0 || ss.length > 0 ? 'ok' : 'no_data',
    brand_id:   brandId,
    date,
    metrics,
    rows_found: {
      campaigns:          campaigns.length,
      business:           business.length,
      subscribe_and_save: ss.length,
    },
  }
}

// ─── Range helper ─────────────────────────────────────────────────────────────

export async function calculateDerivedMetricsRange(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<CalculationResult[]> {
  const results: CalculationResult[] = []
  const cursor = new Date(startDate + 'T00:00:00Z')
  const end    = new Date(endDate + 'T00:00:00Z')

  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10)
    results.push(await calculateDerivedMetrics(brandId, dateStr))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return results
}
