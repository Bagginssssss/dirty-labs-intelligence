import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAll } from './fetch-all'
import { CampaignRow } from './types'

type RawPerf = {
  campaign_id: string
  ad_type: string | null
  spend: number
  sales_7d: number
  orders_7d: number
  clicks: number
  impressions: number
  ntb_orders_14d: number | null
}

type CampaignMeta = { id: string; campaign_name: string | null; ad_type: string | null; targeting_type: string | null; launch_date: string | null }

async function fetchCampaignPerf(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<{ perf: RawPerf[]; meta: Map<string, CampaignMeta> }> {
  const [perf, metaRes] = await Promise.all([
    fetchAll<RawPerf>(() =>
      supabaseAdmin
        .from('sp_campaign_performance')
        .select('campaign_id, ad_type, spend, sales_7d, orders_7d, clicks, impressions, ntb_orders_14d')
        .eq('brand_id', brandId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
    ),
    supabaseAdmin
      .from('campaigns')
      .select('id, campaign_name, ad_type, targeting_type, launch_date')
      .eq('brand_id', brandId),
  ])

  if (metaRes.error) throw new Error(`fetchCampaignMeta failed: ${metaRes.error.message}`)

  const meta = new Map<string, CampaignMeta>()
  for (const c of (metaRes.data ?? [])) {
    meta.set(c.id, c as CampaignMeta)
  }

  return { perf, meta }
}

function aggregateByCampaign(
  perf: RawPerf[],
  meta: Map<string, CampaignMeta>
): CampaignRow[] {
  const acc = new Map<string, CampaignRow>()

  for (const row of perf) {
    const cid  = row.campaign_id
    const info = meta.get(cid)

    if (!acc.has(cid)) {
      acc.set(cid, {
        campaign_uuid: cid,
        campaign_name: info?.campaign_name ?? null,
        ad_type:       info?.ad_type ?? row.ad_type ?? null,
        targeting_type: info?.targeting_type ?? null,
        launch_date:   info?.launch_date ?? null,
        spend:     0,
        sales:     0,
        orders:    0,
        clicks:    0,
        impressions: 0,
        ntb_orders: 0,
        roas:      null,
        acos:      null,
        cvr:       null,
        ntb_rate:  null,
      })
    }

    const agg = acc.get(cid)!
    agg.spend       += Number(row.spend) || 0
    agg.sales       += Number(row.sales_7d) || 0
    agg.orders      += Number(row.orders_7d) || 0
    agg.clicks      += Number(row.clicks) || 0
    agg.impressions += Number(row.impressions) || 0
    agg.ntb_orders  += Number(row.ntb_orders_14d) || 0
  }

  for (const row of acc.values()) {
    row.roas     = row.spend > 0 ? row.sales / row.spend : null
    row.acos     = row.sales > 0 ? row.spend / row.sales : null
    row.cvr      = row.clicks > 0 ? row.orders / row.clicks : null
    row.ntb_rate = row.orders > 0 ? row.ntb_orders / row.orders : null
  }

  return Array.from(acc.values())
}

export async function getTopCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  limit = 20
): Promise<CampaignRow[]> {
  const { perf, meta } = await fetchCampaignPerf(brandId, startDate, endDate)
  const rows = aggregateByCampaign(perf, meta)
  return rows.sort((a, b) => b.sales - a.sales).slice(0, limit)
}

export async function getWasteCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  acosThreshold = 0.5,
  minSpend = 50
): Promise<CampaignRow[]> {
  const { perf, meta } = await fetchCampaignPerf(brandId, startDate, endDate)
  const rows = aggregateByCampaign(perf, meta)
  return rows
    .filter(r => r.spend >= minSpend && (r.orders === 0 || (r.acos !== null && r.acos > acosThreshold)))
    .sort((a, b) => b.spend - a.spend)
}

export async function getTopPerformingCampaigns(
  brandId: string,
  startDate: string,
  endDate: string,
  minSpend = 100,
  limit = 20
): Promise<CampaignRow[]> {
  const { perf, meta } = await fetchCampaignPerf(brandId, startDate, endDate)
  const rows = aggregateByCampaign(perf, meta)
  return rows
    .filter(r => r.spend >= minSpend && r.roas !== null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, limit)
}

export async function getCampaignsByAdType(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, CampaignRow[]>> {
  const { perf, meta } = await fetchCampaignPerf(brandId, startDate, endDate)
  const rows = aggregateByCampaign(perf, meta)

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
