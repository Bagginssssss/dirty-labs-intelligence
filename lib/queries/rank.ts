import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAll } from './fetch-all'
import { RankRow, RankMoverRow } from './types'

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

type RankRaw = {
  asin_id: string; keyword: string; rank_value: number | null
  search_volume: number | null; tracked: boolean | null; report_date: string
}

export async function getKeywordRankSummary(
  brandId: string,
  date: string
): Promise<RankRow[]> {
  const [rankRows, asinMap] = await Promise.all([
    fetchAll<RankRaw>(() =>
      supabaseAdmin
        .from('scale_insights_keyword_rank')
        .select('asin_id, keyword, rank_value, search_volume, tracked, report_date')
        .eq('brand_id', brandId)
        .eq('report_date', date)
    ),
    fetchAsinMeta(brandId),
  ])

  return rankRows.map(r => {
    const meta = asinMap.get(r.asin_id)
    return {
      keyword:       r.keyword,
      asin_id:       r.asin_id,
      asin:          meta?.asin ?? '',
      title:         meta?.title ?? null,
      rank_value:    r.rank_value !== null ? Number(r.rank_value) : null,
      search_volume: r.search_volume !== null ? Number(r.search_volume) : null,
      tracked:       r.tracked,
      report_date:   r.report_date,
    }
  }).sort((a, b) => (a.rank_value ?? 999) - (b.rank_value ?? 999))
}

type RankMoverRaw = {
  asin_id: string; keyword: string; rank_value: number | null
  search_volume: number | null; report_date: string
}

export async function getRankMovers(
  brandId: string,
  startDate: string,
  endDate: string,
  minDelta = 5
): Promise<RankMoverRow[]> {
  const [rankRows, asinMap] = await Promise.all([
    fetchAll<RankMoverRaw>(() =>
      supabaseAdmin
        .from('scale_insights_keyword_rank')
        .select('asin_id, keyword, rank_value, search_volume, report_date')
        .eq('brand_id', brandId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date')
    ),
    fetchAsinMeta(brandId),
  ])

  const SENTINEL = 98 // rank_value=98 means "97+" (off-page); exclude from delta math

  // Group by (asin_id, keyword) — track first and last NON-sentinel rank
  const acc = new Map<string, {
    asin_id: string; keyword: string; search_volume: number | null
    rv_start: number | null; rv_end: number | null
  }>()

  for (const row of rankRows) {
    const key = `${row.asin_id}::${row.keyword}`
    const rv = row.rank_value !== null ? Number(row.rank_value) : null
    const isReal = rv !== null && rv !== SENTINEL

    if (!acc.has(key)) {
      acc.set(key, {
        asin_id:       row.asin_id as string,
        keyword:       row.keyword as string,
        search_volume: row.search_volume !== null ? Number(row.search_volume) : null,
        rv_start:      isReal ? rv : null,
        rv_end:        isReal ? rv : null,
      })
    } else {
      const a = acc.get(key)!
      if (isReal) {
        // First non-sentinel chronologically becomes rv_start; every non-sentinel updates rv_end
        if (a.rv_start === null) a.rv_start = rv
        a.rv_end = rv
      }
      if (row.search_volume !== null) a.search_volume = Number(row.search_volume)
    }
  }

  return Array.from(acc.values())
    // Discard keywords whose only readings in the period were sentinel — no real baseline
    .filter(a => a.rv_start !== null && a.rv_end !== null)
    .map(a => {
      const meta = asinMap.get(a.asin_id)
      const rvDelta = a.rv_start! - a.rv_end!  // positive = improved (lower rank number)

      return {
        keyword:          a.keyword,
        asin_id:          a.asin_id,
        asin:             meta?.asin ?? '',
        title:            meta?.title ?? null,
        rank_value_start: a.rv_start,
        rank_value_end:   a.rv_end,
        rank_value_delta: rvDelta,
        search_volume:    a.search_volume,
      }
    })
    .filter(r => Math.abs(r.rank_value_delta) >= minDelta)
    .sort((a, b) => Math.abs(b.rank_value_delta) - Math.abs(a.rank_value_delta))
}
