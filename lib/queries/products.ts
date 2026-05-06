import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAll } from './fetch-all'
import { ASINRow, SSRow } from './types'

type AsinMeta = { id: string; asin: string; title: string | null }

async function fetchAsinMeta(brandId: string): Promise<Map<string, AsinMeta>> {
  const { data, error } = await supabaseAdmin
    .from('asins')
    .select('id, asin, title')
    .eq('brand_id', brandId)

  if (error) throw new Error(`fetchAsinMeta failed: ${error.message}`)

  const map = new Map<string, AsinMeta>()
  for (const a of (data ?? [])) map.set(a.id, a as AsinMeta)
  return map
}

type BrRaw = {
  asin_id: string; sessions_total: number | null; units_ordered: number | null
  buy_box_pct: number | null; ordered_product_sales: number | null; total_order_items: number | null
}

export async function getASINPerformance(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<ASINRow[]> {
  const [brRows, asinMap] = await Promise.all([
    fetchAll<BrRaw>(() =>
      supabaseAdmin
        .from('business_report')
        .select('asin_id, sessions_total, units_ordered, buy_box_pct, ordered_product_sales, total_order_items')
        .eq('brand_id', brandId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
    ),
    fetchAsinMeta(brandId),
  ])

  const acc = new Map<string, {
    asin_id: string; sessions: number; units_ordered: number
    revenue: number; total_order_items: number
    buy_box_sum: number; buy_box_count: number
  }>()

  for (const row of brRows) {
    const id = row.asin_id
    if (!acc.has(id)) {
      acc.set(id, { asin_id: id, sessions: 0, units_ordered: 0, revenue: 0, total_order_items: 0, buy_box_sum: 0, buy_box_count: 0 })
    }
    const a = acc.get(id)!
    a.sessions       += Number(row.sessions_total) || 0
    a.units_ordered  += Number(row.units_ordered) || 0
    a.revenue        += Number(row.ordered_product_sales) || 0
    a.total_order_items += Number(row.total_order_items) || 0
    if (row.buy_box_pct !== null && row.buy_box_pct !== undefined) {
      a.buy_box_sum   += Number(row.buy_box_pct)
      a.buy_box_count += 1
    }
  }

  return Array.from(acc.values()).map(a => {
    const meta = asinMap.get(a.asin_id)
    const cvr  = a.sessions > 0 ? a.units_ordered / a.sessions : null
    const bbPct = a.buy_box_count > 0 ? a.buy_box_sum / a.buy_box_count : null
    return {
      asin_id:       a.asin_id,
      asin:          meta?.asin ?? '',
      title:         meta?.title ?? null,
      revenue:       a.revenue,
      sessions:      a.sessions,
      units_ordered: a.units_ordered,
      buy_box_pct:   bbPct,
      cvr,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

type SsRaw = {
  asin_id: string; active_subscriptions: number | null; ss_revenue: number | null
  ss_units_shipped: number | null; reorder_rate: number | null; report_date: string
}

export async function getSSPerformance(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<SSRow[]> {
  const [ssRows, asinMap] = await Promise.all([
    fetchAll<SsRaw>(() =>
      supabaseAdmin
        .from('subscribe_and_save')
        .select('asin_id, active_subscriptions, ss_revenue, ss_units_shipped, reorder_rate, report_date')
        .eq('brand_id', brandId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date', { ascending: false })
    ),
    fetchAsinMeta(brandId),
  ])

  // Active subscriptions = latest value; revenue/units = sum
  // Pages arrive newest-first (order ascending: false), so first-seen per ASIN = most recent.
  const latestSubs = new Map<string, number>()
  const acc = new Map<string, { asin_id: string; ss_revenue: number; ss_units_shipped: number; reorder_rate_sum: number; reorder_rate_count: number }>()

  for (const row of ssRows) {
    const id = row.asin_id

    if (!latestSubs.has(id)) {
      latestSubs.set(id, Number(row.active_subscriptions) || 0)
    }

    if (!acc.has(id)) {
      acc.set(id, { asin_id: id, ss_revenue: 0, ss_units_shipped: 0, reorder_rate_sum: 0, reorder_rate_count: 0 })
    }
    const a = acc.get(id)!
    a.ss_revenue      += Number(row.ss_revenue) || 0
    a.ss_units_shipped += Number(row.ss_units_shipped) || 0
    if (row.reorder_rate !== null && row.reorder_rate !== undefined) {
      a.reorder_rate_sum   += Number(row.reorder_rate)
      a.reorder_rate_count += 1
    }
  }

  return Array.from(acc.values()).map(a => {
    const meta = asinMap.get(a.asin_id)
    return {
      asin_id:              a.asin_id,
      asin:                 meta?.asin ?? '',
      title:                meta?.title ?? null,
      active_subscriptions: latestSubs.get(a.asin_id) ?? 0,
      ss_revenue:           a.ss_revenue,
      ss_units_shipped:     a.ss_units_shipped,
      reorder_rate:         a.reorder_rate_count > 0 ? a.reorder_rate_sum / a.reorder_rate_count : null,
    }
  }).sort((a, b) => b.ss_revenue - a.ss_revenue)
}
