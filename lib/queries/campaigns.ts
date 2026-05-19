import { supabaseAdmin } from '@/lib/supabase-admin'
import { CampaignRow } from './types'

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// Shape returned by the get_campaign_performance_aggregated RPC.
// Derived ratios (roas, acos, cvr, ntb_rate, is_likely_active) are computed
// in JS below to preserve exact parity with the prior implementation.
type RpcRow = {
  campaign_uuid:     string
  campaign_name:     string | null
  ad_type:           string | null
  targeting_type:    string | null
  launch_date:       string | null
  spend:             number
  sales:             number
  orders:            number
  clicks:            number
  impressions:       number
  ntb_orders:        number
  current_status:    string | null
  latest_spend_date: string | null
  data_max_date:     string | null
}

async function fetchCampaignPerf(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<CampaignRow[]> {
  const { data, error } = await supabaseAdmin.rpc(
    'get_campaign_performance_aggregated',
    { p_brand_id: brandId, p_start_date: startDate, p_end_date: endDate },
  )
  if (error) throw new Error(`get_campaign_performance_aggregated failed: ${error.message}`)

  const rows = (data ?? []) as RpcRow[]

  // Anchor is_likely_active to data recency, not CURRENT_DATE — same logic as before.
  const dataMaxDate = rows[0]?.data_max_date ?? ''
  const dataMaxMs   = dataMaxDate ? new Date(dataMaxDate + 'T00:00:00Z').getTime() : 0

  return rows.map(row => {
    const spend       = Number(row.spend)       || 0
    const sales       = Number(row.sales)       || 0
    const orders      = Number(row.orders)      || 0
    const clicks      = Number(row.clicks)      || 0
    const impressions = Number(row.impressions) || 0
    const ntb_orders  = Number(row.ntb_orders)  || 0

    const roas     = spend  > 0 ? sales  / spend  : null
    const acos     = sales  > 0 ? spend  / sales  : null
    const cvr      = clicks > 0 ? orders / clicks : null
    const ntb_rate = orders > 0 ? ntb_orders / orders : null

    const status: CampaignRow['current_status'] =
      (row.current_status === 'ENABLED' || row.current_status === 'PAUSED')
        ? row.current_status
        : null

    let is_likely_active = false
    if (row.latest_spend_date && dataMaxMs > 0 && status !== 'PAUSED') {
      const spendMs = new Date(row.latest_spend_date + 'T00:00:00Z').getTime()
      is_likely_active = (dataMaxMs - spendMs) <= ACTIVE_WINDOW_MS
    }

    return {
      campaign_uuid:     row.campaign_uuid,
      campaign_name:     row.campaign_name,
      ad_type:           row.ad_type,
      targeting_type:    row.targeting_type,
      launch_date:       row.launch_date,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      ntb_orders,
      roas,
      acos,
      cvr,
      ntb_rate,
      current_status:    status,
      latest_spend_date: row.latest_spend_date,
      is_likely_active,
    }
  })
}

export async function getTopCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  limit = 20,
): Promise<CampaignRow[]> {
  const rows = await fetchCampaignPerf(brandId, startDate, endDate)
  return rows.sort((a, b) => b.sales - a.sales).slice(0, limit)
}

export async function getWasteCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  acosThreshold = 0.5,
  minSpend = 50,
): Promise<CampaignRow[]> {
  const rows = await fetchCampaignPerf(brandId, startDate, endDate)
  return rows
    .filter(r => r.spend >= minSpend && (r.orders === 0 || (r.acos !== null && r.acos > acosThreshold)))
    .sort((a, b) => b.spend - a.spend)
}

export async function getTopPerformingCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  minSpend = 100,
  limit = 20,
): Promise<CampaignRow[]> {
  const rows = await fetchCampaignPerf(brandId, startDate, endDate)
  return rows
    .filter(r => r.spend >= minSpend && r.roas !== null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, limit)
}

export async function getCampaignsByAdType(
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, CampaignRow[]>> {
  const rows = await fetchCampaignPerf(brandId, startDate, endDate)

  const byType: Record<string, CampaignRow[]> = {}
  for (const row of rows) {
    const type = row.ad_type ?? 'UNKNOWN'
    if (!byType[type]) byType[type] = []
    byType[type].push(row)
  }
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => b.sales - a.sales)
  }
  return byType
}
