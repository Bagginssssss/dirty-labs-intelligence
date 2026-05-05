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
    supabaseAdmin
      .from('subscribe_and_save')
      .select('active_subscriptions, ss_revenue, ss_units_shipped')
      .eq('brand_id', brandId)
      .eq('report_date', date),
  ])

  const campaigns = (campaignData ?? []) as Row[]
  const business  = (businessData ?? []) as Row[]
  const ss        = (ssData ?? []) as Row[]

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

  const ssActiveSubs = Math.round(sumField(ss, 'active_subscriptions'))
  const ssRev        = sumField(ss, 'ss_revenue')

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
