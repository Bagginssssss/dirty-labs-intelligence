import { supabaseAdmin } from '@/lib/supabase-admin'
import { AccountSummary, MonthlyAccountRow } from './types'

export async function getAccountSummary(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<AccountSummary> {
  type Row = Record<string, unknown>

  const [metricsRes, businessRes] = await Promise.all([
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('metric_date, total_ppc_spend, total_ppc_sales, total_revenue, organic_revenue, ntb_orders, total_orders, total_clicks, ss_active_subscriptions, ss_revenue')
      .eq('brand_id', brandId)
      .gte('metric_date', startDate)
      .lte('metric_date', endDate)
      .order('metric_date'),
    supabaseAdmin
      .from('business_report_daily')
      .select('ordered_product_sales, total_order_items')
      .eq('brand_id', brandId)
      .gte('report_date', startDate)
      .lte('report_date', endDate),
  ])

  if (metricsRes.error) throw new Error(`getAccountSummary metrics failed: ${metricsRes.error.message}`)
  if (businessRes.error) throw new Error(`getAccountSummary business failed: ${businessRes.error.message}`)

  const rows    = (metricsRes.data ?? []) as unknown as Row[]
  const bizRows = (businessRes.data ?? []) as unknown as Row[]

  const sum = (arr: Row[], field: string): number =>
    arr.reduce((acc, r) => acc + (Number(r[field]) || 0), 0)

  const totalSpend   = sum(rows, 'total_ppc_spend')
  const totalSales   = sum(rows, 'total_ppc_sales')
  const totalRevenue = sum(rows, 'total_revenue')
  const totalOrders  = sum(rows, 'total_orders')
  const totalClicks  = sum(rows, 'total_clicks')
  const ntbOrders    = sum(rows, 'ntb_orders')
  const ssRevenue    = sum(rows, 'ss_revenue')

  // AOV: use business_report totals (ordered_product_sales / total_order_items)
  const bizRevenue    = sum(bizRows, 'ordered_product_sales')
  const totalOrderItems = sum(bizRows, 'total_order_items')

  // S&S subscriptions are a point-in-time count — use the most recent day's value
  const lastRow = rows[rows.length - 1]
  const ssActiveSubs = lastRow ? Number(lastRow['ss_active_subscriptions']) || 0 : 0

  return {
    start_date:              startDate,
    end_date:                endDate,
    total_revenue:           totalRevenue,
    total_ppc_spend:         totalSpend,
    total_ppc_sales:         totalSales,
    blended_roas:            totalSpend > 0 ? totalSales / totalSpend : null,
    organic_revenue:         sum(rows, 'organic_revenue'),
    mer:                     totalSpend > 0 ? totalRevenue / totalSpend : null,
    ntb_orders:              ntbOrders,
    ntb_rate:                totalOrders > 0 ? ntbOrders / totalOrders : null,
    total_orders:            totalOrders,
    aov:                     totalOrderItems > 0 ? bizRevenue / totalOrderItems : null,
    account_cvr:             totalClicks > 0 ? totalOrders / totalClicks : null,
    ss_active_subscriptions: ssActiveSubs,
    ss_revenue:              ssRevenue,
    ss_revenue_pct_of_total: totalRevenue > 0 ? ssRevenue / totalRevenue : null,
    days_with_data:          rows.length,
  }
}

// Groups derived_metrics_daily by calendar month and joins authoritative
// Brand Analytics NTB data so the LLM has unambiguous per-month fields.
// ntb_customers_ba is brand-wide (canonical for CAC); ntb_orders_ppc_attributed
// is PPC-only from derived_metrics_daily (~28x undercount — PPC efficiency only).
export async function getMonthlyAccountMetrics(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAccountRow[]> {
  type DmdRow = {
    metric_date: string
    total_revenue: number | null
    total_ppc_spend: number | null
    total_ppc_sales: number | null
    organic_revenue: number | null
    ntb_orders: number | null
    total_orders: number | null
  }
  type BaRow = { period_end_date: string; ntb_customers: number | null }

  const [dmdRes, baRes] = await Promise.all([
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('metric_date, total_revenue, total_ppc_spend, total_ppc_sales, organic_revenue, ntb_orders, total_orders')
      .eq('brand_id', brandId)
      .gte('metric_date', startDate)
      .lte('metric_date', endDate)
      .order('metric_date'),
    supabaseAdmin
      .from('brand_analytics_customer_loyalty')
      .select('period_end_date, ntb_customers')
      .eq('brand_id', brandId)
      .eq('granularity', 'monthly')
      .gte('period_end_date', startDate)
      .lte('period_end_date', endDate),
  ])

  if (dmdRes.error) throw new Error(`getMonthlyAccountMetrics failed: ${dmdRes.error.message}`)

  // Build a month → ntb_customers_ba map from BA rows.
  // period_end_date is the last day of the month (e.g. 2026-03-31); slice to YYYY-MM.
  const baNtbByMonth = new Map<string, number>()
  for (const row of (baRes.data ?? []) as unknown as BaRow[]) {
    const month = row.period_end_date.slice(0, 7)
    const v = Number(row.ntb_customers) || 0
    baNtbByMonth.set(month, (baNtbByMonth.get(month) ?? 0) + v)
  }

  const acc = new Map<string, { revenue: number; spend: number; sales: number; organic: number; ntbPpc: number; orders: number }>()

  for (const row of (dmdRes.data ?? []) as unknown as DmdRow[]) {
    const month = row.metric_date.slice(0, 7)
    if (!acc.has(month)) acc.set(month, { revenue: 0, spend: 0, sales: 0, organic: 0, ntbPpc: 0, orders: 0 })
    const m = acc.get(month)!
    m.revenue += Number(row.total_revenue)    || 0
    m.spend   += Number(row.total_ppc_spend)  || 0
    m.sales   += Number(row.total_ppc_sales)  || 0
    m.organic += Number(row.organic_revenue)  || 0
    m.ntbPpc  += Number(row.ntb_orders)       || 0
    m.orders  += Number(row.total_orders)     || 0
  }

  return Array.from(acc.entries())
    .map(([month, m]) => {
      const ntbBa = baNtbByMonth.get(month) ?? null
      return {
        month,
        total_revenue:             m.revenue,
        total_ppc_spend:           m.spend,
        ppc_sales:                 m.sales,
        roas:                      m.spend > 0 ? m.sales / m.spend : null,
        mer:                       m.spend > 0 ? m.revenue / m.spend : null,
        organic_revenue:           m.organic,
        ntb_customers_ba:          ntbBa,
        cac_ba:                    ntbBa !== null && ntbBa > 0 ? m.spend / ntbBa : null,
        ntb_orders_ppc_attributed: m.ntbPpc,
        total_orders:              m.orders,
      }
    })
    .sort((a, b) => a.month.localeCompare(b.month))
}
