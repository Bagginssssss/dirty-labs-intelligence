import { supabaseAdmin } from '@/lib/supabase-admin'
import { AccountSummary } from './types'

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
      .from('business_report')
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
