import { supabaseAdmin } from '@/lib/supabase-admin'
import { SearchTermRow } from './types'
import { HARVEST_READY_THRESHOLDS, HARVEST_INVESTIGATION_THRESHOLDS } from '@/lib/dashboard/thresholds'

// Shape returned by get_search_term_report_aggregated RPC.
// Derived ratios (roas, acos, cvr) are computed in JS below.
type RpcRow = {
  search_term:   string
  campaign_uuid: string
  campaign_name: string | null
  match_type:    string | null
  ad_type:       string | null
  spend:         number
  sales:         number
  orders:        number
  clicks:        number
  impressions:   number
}

// Deduplicates concurrent identical calls within the same request (e.g. from
// Promise.all in the chat loader). Keyed by brandId:startDate:endDate.
const _searchTermInflight = new Map<string, Promise<SearchTermRow[]>>()

function fetchSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<SearchTermRow[]> {
  const key = `${brandId}:${startDate}:${endDate}`
  const inflight = _searchTermInflight.get(key)
  if (inflight) return inflight

  const promise = doFetchSearchTerms(brandId, startDate, endDate)
  _searchTermInflight.set(key, promise)
  promise.finally(() => _searchTermInflight.delete(key))
  return promise
}

async function doFetchSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<SearchTermRow[]> {
  const { data, error } = await supabaseAdmin.rpc(
    'get_search_term_report_aggregated',
    { p_brand_id: brandId, p_start_date: startDate, p_end_date: endDate },
  )
  if (error) throw new Error(`get_search_term_report_aggregated failed: ${error.message}`)

  return ((data ?? []) as RpcRow[]).map(row => {
    const spend       = Number(row.spend)       || 0
    const sales       = Number(row.sales)       || 0
    const orders      = Number(row.orders)      || 0
    const clicks      = Number(row.clicks)      || 0
    const impressions = Number(row.impressions) || 0

    return {
      search_term:   row.search_term,
      campaign_uuid: row.campaign_uuid,
      campaign_name: row.campaign_name,
      match_type:    row.match_type,
      ad_type:       row.ad_type,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      roas:  spend  > 0 ? sales  / spend  : null,
      acos:  sales  > 0 ? spend  / sales  : null,
      cvr:   clicks > 0 ? orders / clicks : null,
    }
  })
}

export async function getTopSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
  limit = 20,
): Promise<SearchTermRow[]> {
  const rows = await fetchSearchTerms(brandId, startDate, endDate)
  return rows.sort((a, b) => b.sales - a.sales).slice(0, limit)
}

export async function getWasteSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
  minSpend = 20,
  acosThreshold = 0.5,
): Promise<SearchTermRow[]> {
  const rows = await fetchSearchTerms(brandId, startDate, endDate)
  return rows
    .filter(t => t.spend >= minSpend && (t.orders === 0 || (t.acos !== null && t.acos > acosThreshold)))
    .sort((a, b) => b.spend - a.spend)
}

async function fetchAutoTerms(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<SearchTermRow[]> {
  // INB-36 stopgap: campaigns.targeting_type is never populated by CSV
  // ingestion. Detect auto campaigns by name convention — SP.A prefix.
  const { data: autoCampaigns, error: autoErr } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('campaign_name', 'SP.A%')

  if (autoErr) throw new Error(`fetchAutoTerms campaigns failed: ${autoErr.message}`)

  const autoCampaignIds = new Set((autoCampaigns ?? []).map(c => c.id))
  if (autoCampaignIds.size === 0) return []

  const rows = await fetchSearchTerms(brandId, startDate, endDate)
  return rows.filter(r => autoCampaignIds.has(r.campaign_uuid))
}

export async function getHarvestCandidates(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<SearchTermRow[]> {
  const terms = await fetchAutoTerms(brandId, startDate, endDate)
  return terms
    .filter(t =>
      t.orders >= HARVEST_INVESTIGATION_THRESHOLDS.minOrders &&
      t.clicks >= HARVEST_INVESTIGATION_THRESHOLDS.minClicks &&
      t.roas !== null && t.roas >= HARVEST_INVESTIGATION_THRESHOLDS.minRoas
    )
    .sort((a, b) => b.sales - a.sales)
}

export async function getHarvestCandidatesTiered(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<{ ready: SearchTermRow[]; investigation: SearchTermRow[] }> {
  const terms = await fetchAutoTerms(brandId, startDate, endDate)
  const qualified = terms.filter(t =>
    t.orders >= HARVEST_INVESTIGATION_THRESHOLDS.minOrders &&
    t.clicks >= HARVEST_INVESTIGATION_THRESHOLDS.minClicks &&
    t.roas !== null
  )
  const ready = qualified
    .filter(t => t.roas! >= HARVEST_READY_THRESHOLDS.minRoas)
    .sort((a, b) => b.sales - a.sales)
  const investigation = qualified
    .filter(t => t.roas! >= HARVEST_INVESTIGATION_THRESHOLDS.minRoas && t.roas! < HARVEST_READY_THRESHOLDS.minRoas)
    .sort((a, b) => b.sales - a.sales)
  return { ready, investigation }
}

export async function getSearchTermsByMatchType(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, SearchTermRow[]>> {
  const rows = await fetchSearchTerms(brandId, startDate, endDate)

  const byType: Record<string, SearchTermRow[]> = {}
  for (const term of rows) {
    const type = term.match_type ?? 'UNKNOWN'
    if (!byType[type]) byType[type] = []
    byType[type].push(term)
  }
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => b.sales - a.sales)
  }
  return byType
}
