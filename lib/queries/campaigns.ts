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
  status: string | null
  report_date: string
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
        .select('campaign_id, ad_type, spend, sales_7d, orders_7d, clicks, impressions, ntb_orders_14d, status, report_date')
        .eq('brand_id', brandId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date', { ascending: true })
        .order('campaign_id', { ascending: true })
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

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function aggregateByCampaign(
  perf: RawPerf[],
  meta: Map<string, CampaignMeta>
): CampaignRow[] {
  // Anchor is_likely_active to data recency, not CURRENT_DATE.
  // Ingestion lag (e.g. data stops Apr 30 but today is May 15) would mark all campaigns
  // inactive if we used Date.now() as the reference.
  let dataMaxDate = ''
  for (const row of perf) {
    if (row.report_date > dataMaxDate) dataMaxDate = row.report_date
  }
  const dataMaxMs = dataMaxDate ? new Date(dataMaxDate + 'T00:00:00Z').getTime() : 0

  const acc = new Map<string, CampaignRow>()
  // Separate tracker avoids mutating CampaignRow with intermediate build state.
  const tracker = new Map<string, { latestStatus: string | null; latestSpendDate: string | null }>()

  // Rows arrive ascending by report_date (ORDER BY report_date ASC) so the last
  // non-null status seen per campaign is the most recent.
  for (const row of perf) {
    const cid  = row.campaign_id
    const info = meta.get(cid)

    if (!acc.has(cid)) {
      acc.set(cid, {
        campaign_uuid:  cid,
        campaign_name:  info?.campaign_name ?? null,
        ad_type:        info?.ad_type ?? row.ad_type ?? null,
        targeting_type: info?.targeting_type ?? null,
        launch_date:    info?.launch_date ?? null,
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
        current_status:    null,
        latest_spend_date: null,
        is_likely_active:  false,
      })
      tracker.set(cid, { latestStatus: null, latestSpendDate: null })
    }

    const agg = acc.get(cid)!
    agg.spend       += Number(row.spend) || 0
    agg.sales       += Number(row.sales_7d) || 0
    agg.orders      += Number(row.orders_7d) || 0
    agg.clicks      += Number(row.clicks) || 0
    agg.impressions += Number(row.impressions) || 0
    agg.ntb_orders  += Number(row.ntb_orders_14d) || 0

    const t = tracker.get(cid)!
    if (row.status !== null && row.status !== undefined) t.latestStatus = row.status
    if ((Number(row.spend) || 0) > 0 && row.report_date > (t.latestSpendDate ?? '')) {
      t.latestSpendDate = row.report_date
    }
  }

  for (const [cid, row] of acc.entries()) {
    row.roas     = row.spend > 0 ? row.sales / row.spend : null
    row.acos     = row.sales > 0 ? row.spend / row.sales : null
    row.cvr      = row.clicks > 0 ? row.orders / row.clicks : null
    row.ntb_rate = row.orders > 0 ? row.ntb_orders / row.orders : null

    const t = tracker.get(cid)!
    const status = (t.latestStatus === 'ENABLED' || t.latestStatus === 'PAUSED')
      ? t.latestStatus
      : null
    row.current_status    = status
    row.latest_spend_date = t.latestSpendDate

    if (t.latestSpendDate && dataMaxMs > 0 && status !== 'PAUSED') {
      const spendMs = new Date(t.latestSpendDate + 'T00:00:00Z').getTime()
      row.is_likely_active = (dataMaxMs - spendMs) <= ACTIVE_WINDOW_MS
    } else {
      row.is_likely_active = false
    }
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
