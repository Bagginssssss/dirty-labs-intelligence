import { supabaseAdmin } from '@/lib/supabase-admin'
import { OpportunityRow, CompetitorRow } from './types'

// Returns search queries where brand purchase share is low (< brandShareThreshold)
// and query volume is above minVolume — high-opportunity terms Dirty Labs isn't winning.
export async function getSearchQueryGaps(
  brandId: string,
  startDate: string,
  endDate: string,
  brandShareThreshold = 0.1,
  minVolume = 500
): Promise<OpportunityRow[]> {
  // Aggregate SQP rows by search_query across the date range
  type SQPRow = Record<string, unknown>

  const { data, error } = await supabaseAdmin
    .from('search_query_performance')
    .select('search_query, search_query_volume, purchases_total, purchases_brand, purchases_brand_share, impressions_brand_share, clicks_brand_share')
    .eq('brand_id', brandId)
    .gte('report_date', startDate)
    .lte('report_date', endDate)
    .lt('purchases_brand_share', brandShareThreshold)

  if (error) throw new Error(`getSearchQueryGaps failed: ${error.message}`)

  const rows = (data ?? []) as unknown as SQPRow[]

  const acc = new Map<string, {
    volume_sum: number; volume_count: number
    purchases_total: number; purchases_brand: number
    pbs_sum: number; ibs_sum: number; cbs_sum: number; count: number
  }>()

  for (const row of rows) {
    const q = String(row['search_query'] ?? '')
    if (!acc.has(q)) {
      acc.set(q, { volume_sum: 0, volume_count: 0, purchases_total: 0, purchases_brand: 0, pbs_sum: 0, ibs_sum: 0, cbs_sum: 0, count: 0 })
    }
    const a = acc.get(q)!
    a.count++
    if (row['search_query_volume'] !== null) { a.volume_sum += Number(row['search_query_volume']); a.volume_count++ }
    a.purchases_total  += Number(row['purchases_total']) || 0
    a.purchases_brand  += Number(row['purchases_brand']) || 0
    if (row['purchases_brand_share'] !== null)   a.pbs_sum += Number(row['purchases_brand_share'])
    if (row['impressions_brand_share'] !== null)  a.ibs_sum += Number(row['impressions_brand_share'])
    if (row['clicks_brand_share'] !== null)       a.cbs_sum += Number(row['clicks_brand_share'])
  }

  return Array.from(acc.entries())
    .map(([query, a]) => {
      const avgVolume = a.volume_count > 0 ? a.volume_sum / a.volume_count : null
      return {
        search_query:            query,
        search_query_volume:     avgVolume,
        purchases_total:         a.purchases_total > 0 ? a.purchases_total : null,
        purchases_brand:         a.purchases_brand > 0 ? a.purchases_brand : null,
        purchases_brand_share:   a.count > 0 ? a.pbs_sum / a.count : null,
        impressions_brand_share: a.count > 0 ? a.ibs_sum / a.count : null,
        clicks_brand_share:      a.count > 0 ? a.cbs_sum / a.count : null,
      }
    })
    .filter(r => (r.search_query_volume ?? 0) >= minVolume)
    .sort((a, b) => (b.search_query_volume ?? 0) - (a.search_query_volume ?? 0))
}

// Returns competitor brand data from the most recent SmartScout snapshot.
export async function getCompetitiveLandscape(
  brandId: string,
  snapshotDate?: string
): Promise<CompetitorRow[]> {
  let date = snapshotDate
  if (!date) {
    const { data: maxData, error: maxErr } = await supabaseAdmin
      .from('smartscout_subcategory_brands')
      .select('snapshot_date')
      .eq('brand_id', brandId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    if (maxErr || !maxData) return []
    date = maxData.snapshot_date as string
  }

  const { data, error } = await supabaseAdmin
    .from('smartscout_subcategory_brands')
    .select('brand_name, subcategory, estimated_revenue, market_share, snapshot_date')
    .eq('brand_id', brandId)
    .eq('snapshot_date', date)
    .order('estimated_revenue', { ascending: false })

  if (error) throw new Error(`getCompetitiveLandscape failed: ${error.message}`)

  return (data ?? []).map(r => ({
    brand_name:       r.brand_name as string,
    subcategory:      (r.subcategory as string | null) ?? '',
    estimated_revenue: r.estimated_revenue !== null ? Number(r.estimated_revenue) : null,
    market_share:     r.market_share !== null ? Number(r.market_share) : null,
    snapshot_date:    r.snapshot_date as string,
  }))
}

// Aggregates SmartScout brand revenue across subcategories.
export async function getMarketShareByBrand(
  brandId: string,
  snapshotDate?: string
): Promise<CompetitorRow[]> {
  const landscape = await getCompetitiveLandscape(brandId, snapshotDate)

  const acc = new Map<string, { revenue: number; share_sum: number; share_count: number; date: string }>()
  for (const row of landscape) {
    if (!acc.has(row.brand_name)) {
      acc.set(row.brand_name, { revenue: 0, share_sum: 0, share_count: 0, date: row.snapshot_date })
    }
    const a = acc.get(row.brand_name)!
    a.revenue += row.estimated_revenue ?? 0
    if (row.market_share !== null) { a.share_sum += row.market_share; a.share_count++ }
  }

  return Array.from(acc.entries())
    .map(([brand_name, a]) => ({
      brand_name,
      subcategory:       'all',
      estimated_revenue: a.revenue > 0 ? a.revenue : null,
      market_share:      a.share_count > 0 ? a.share_sum / a.share_count : null,
      snapshot_date:     a.date,
    }))
    .sort((a, b) => (b.estimated_revenue ?? 0) - (a.estimated_revenue ?? 0))
}
