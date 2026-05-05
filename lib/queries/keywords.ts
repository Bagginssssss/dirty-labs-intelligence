import { supabaseAdmin } from '@/lib/supabase-admin'
import { SearchTermRow } from './types'

// Harvest threshold constants — tuned from defaults (orders≥1, roas≥3) which
// produced 0 March 2026 candidates due to INB-36 (targeting_type never
// populated by CSV ingestion). orders≥2 filters one-off conversions;
// clicks≥10 is the data-quality gate; ROAS≥2.5 is looser than tooling
// default 3.33 to surface optimization candidates that bid control + ASIN
// targeting can promote post-harvest. Values may be tuned further as
// operational insight builds. Tiered surface (ready vs investigation) is
// planned as INB-37.
const HARVEST_MIN_ORDERS = 2
const HARVEST_MIN_ROAS   = 2.5
const HARVEST_MIN_CLICKS = 10

type RawSTR = {
  campaign_id: string
  customer_search_term: string | null
  match_type: string | null
  ad_type: string | null
  spend: number
  sales_7d: number
  orders_7d: number
  clicks: number
  impressions: number
}

type CampaignMeta = { id: string; campaign_name: string | null; ad_type: string | null; targeting_type: string | null }

async function fetchSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<{ rows: RawSTR[]; meta: Map<string, CampaignMeta> }> {
  const [strRes, metaRes] = await Promise.all([
    supabaseAdmin
      .from('sp_search_term_report')
      .select('campaign_id, customer_search_term, match_type, ad_type, spend, sales_7d, orders_7d, clicks, impressions')
      .eq('brand_id', brandId)
      .gte('report_date', startDate)
      .lte('report_date', endDate),
    supabaseAdmin
      .from('campaigns')
      .select('id, campaign_name, ad_type, targeting_type')
      .eq('brand_id', brandId),
  ])

  if (strRes.error) throw new Error(`fetchSearchTerms failed: ${strRes.error.message}`)
  if (metaRes.error) throw new Error(`fetchCampaignMeta failed: ${metaRes.error.message}`)

  const meta = new Map<string, CampaignMeta>()
  for (const c of (metaRes.data ?? [])) {
    meta.set(c.id, c as CampaignMeta)
  }

  return { rows: (strRes.data ?? []) as unknown as RawSTR[], meta }
}

function aggregateByTerm(
  rows: RawSTR[],
  meta: Map<string, CampaignMeta>
): SearchTermRow[] {
  // Group by (customer_search_term, campaign_id)
  const acc = new Map<string, SearchTermRow>()

  for (const row of rows) {
    const term = row.customer_search_term ?? ''
    const key  = `${term}::${row.campaign_id}`
    const info = meta.get(row.campaign_id)

    if (!acc.has(key)) {
      acc.set(key, {
        search_term:   term,
        campaign_uuid: row.campaign_id,
        campaign_name: info?.campaign_name ?? null,
        match_type:    row.match_type ?? null,
        ad_type:       info?.ad_type ?? row.ad_type ?? null,
        spend:     0,
        sales:     0,
        orders:    0,
        clicks:    0,
        impressions: 0,
        roas:  null,
        acos:  null,
        cvr:   null,
      })
    }

    const agg = acc.get(key)!
    agg.spend       += Number(row.spend) || 0
    agg.sales       += Number(row.sales_7d) || 0
    agg.orders      += Number(row.orders_7d) || 0
    agg.clicks      += Number(row.clicks) || 0
    agg.impressions += Number(row.impressions) || 0
  }

  for (const row of acc.values()) {
    row.roas = row.spend > 0 ? row.sales / row.spend : null
    row.acos = row.sales > 0 ? row.spend / row.sales : null
    row.cvr  = row.clicks > 0 ? row.orders / row.clicks : null
  }

  return Array.from(acc.values())
}

export async function getTopSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
  limit = 20
): Promise<SearchTermRow[]> {
  const { rows, meta } = await fetchSearchTerms(brandId, startDate, endDate)
  const terms = aggregateByTerm(rows, meta)
  return terms.sort((a, b) => b.sales - a.sales).slice(0, limit)
}

export async function getWasteSearchTerms(
  brandId: string,
  startDate: string,
  endDate: string,
  minSpend = 20,
  acosThreshold = 0.5
): Promise<SearchTermRow[]> {
  const { rows, meta } = await fetchSearchTerms(brandId, startDate, endDate)
  const terms = aggregateByTerm(rows, meta)
  return terms
    .filter(t => t.spend >= minSpend && (t.orders === 0 || (t.acos !== null && t.acos > acosThreshold)))
    .sort((a, b) => b.spend - a.spend)
}

export async function getHarvestCandidates(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<SearchTermRow[]> {
  // INB-36 stopgap: campaigns.targeting_type is never populated by CSV
  // ingestion (column is missing from the SP Campaign Performance report).
  // Detect auto campaigns by name convention. SP.A prefix = Auto targeting,
  // parallel to SP./SB./SBV. ad-type prefixes documented in CLAUDE.md.
  const { data: autoCampaigns, error: autoErr } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('campaign_name', 'SP.A%')

  if (autoErr) throw new Error(`getHarvestCandidates campaigns failed: ${autoErr.message}`)

  const autoCampaignIds = new Set((autoCampaigns ?? []).map(c => c.id))
  if (autoCampaignIds.size === 0) return []

  const { rows, meta } = await fetchSearchTerms(brandId, startDate, endDate)
  const autoRows = rows.filter(r => autoCampaignIds.has(r.campaign_id))
  const terms    = aggregateByTerm(autoRows, meta)

  return terms
    .filter(t =>
      t.orders >= HARVEST_MIN_ORDERS &&
      t.clicks >= HARVEST_MIN_CLICKS &&
      t.roas !== null && t.roas >= HARVEST_MIN_ROAS
    )
    .sort((a, b) => b.sales - a.sales)
}

export async function getSearchTermsByMatchType(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, SearchTermRow[]>> {
  const { rows, meta } = await fetchSearchTerms(brandId, startDate, endDate)
  const terms = aggregateByTerm(rows, meta)

  const byType: Record<string, SearchTermRow[]> = {}
  for (const term of terms) {
    const type = term.match_type ?? 'UNKNOWN'
    if (!byType[type]) byType[type] = []
    byType[type].push(term)
  }
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => b.sales - a.sales)
  }
  return byType
}
