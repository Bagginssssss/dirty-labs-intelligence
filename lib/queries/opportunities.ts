import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAll } from './fetch-all'
import { OpportunityRow, CompetitorRow } from './types'

type RpcGapRow = {
  search_query:            string
  search_query_volume:     number | null
  purchases_total:         number | null
  purchases_brand:         number | null
  purchases_brand_share:   number | null
  impressions_brand_share: number | null
  clicks_brand_share:      number | null
}

// Returns search queries where brand purchase share is low (< brandShareThreshold)
// and query volume is above minVolume — high-opportunity terms Dirty Labs isn't winning.
export async function getSearchQueryGaps(
  brandId: string,
  startDate: string,
  endDate: string,
  brandShareThreshold = 0.1,
  minVolume = 500,
): Promise<OpportunityRow[]> {
  const { data, error } = await supabaseAdmin.rpc(
    'get_search_query_gaps_aggregated',
    {
      p_brand_id:              brandId,
      p_start_date:            startDate,
      p_end_date:              endDate,
      p_brand_share_threshold: brandShareThreshold,
    },
  )
  if (error) throw new Error(`get_search_query_gaps_aggregated failed: ${error.message}`)

  return ((data ?? []) as RpcGapRow[])
    .map(row => ({
      search_query:            row.search_query,
      search_query_volume:     row.search_query_volume,
      purchases_total:         Number(row.purchases_total)  > 0 ? Number(row.purchases_total)  : null,
      purchases_brand:         Number(row.purchases_brand)  > 0 ? Number(row.purchases_brand)  : null,
      purchases_brand_share:   row.purchases_brand_share,
      impressions_brand_share: row.impressions_brand_share,
      clicks_brand_share:      row.clicks_brand_share,
    }))
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

  // fetchAll pages past PostgREST's 1,000-row cap: one snapshot across all four subcategories
  // can reach ~1,800 rows — the same silent-truncation class fixed in the command center.
  // Stable order: market_share desc, then (brand_name, subcategory) which make the row unique
  // within this brand + snapshot, so pages never overlap or skip.
  const data = await fetchAll<Record<string, unknown>>(() => supabaseAdmin
    .from('smartscout_subcategory_brands')
    .select('brand_name, subcategory, market_share, snapshot_date')
    .eq('brand_id', brandId)
    .eq('snapshot_date', date)
    .order('market_share', { ascending: false })
    .order('brand_name').order('subcategory'))

  return data.map(r => ({
    brand_name:    r.brand_name as string,
    subcategory:   (r.subcategory as string | null) ?? '',
    market_share:  r.market_share !== null ? Number(r.market_share) : null,
    snapshot_date: r.snapshot_date as string,
  }))
}

// Aggregates SmartScout brand revenue across subcategories.
export async function getMarketShareByBrand(
  brandId: string,
  snapshotDate?: string
): Promise<CompetitorRow[]> {
  const landscape = await getCompetitiveLandscape(brandId, snapshotDate)

  const acc = new Map<string, { share_sum: number; share_count: number; date: string }>()
  for (const row of landscape) {
    if (!acc.has(row.brand_name)) {
      acc.set(row.brand_name, { share_sum: 0, share_count: 0, date: row.snapshot_date })
    }
    const a = acc.get(row.brand_name)!
    if (row.market_share !== null) { a.share_sum += row.market_share; a.share_count++ }
  }

  return Array.from(acc.entries())
    .map(([brand_name, a]) => ({
      brand_name,
      subcategory:  'all',
      market_share: a.share_count > 0 ? a.share_sum / a.share_count : null,
      snapshot_date: a.date,
    }))
    .sort((a, b) => (b.market_share ?? 0) - (a.market_share ?? 0))
}
