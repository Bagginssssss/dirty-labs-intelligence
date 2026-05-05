import { supabaseAdmin } from '@/lib/supabase-admin'
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

export async function getKeywordRankSummary(
  brandId: string,
  date: string
): Promise<RankRow[]> {
  const [rankRes, asinMap] = await Promise.all([
    supabaseAdmin
      .from('scale_insights_keyword_rank')
      .select('asin_id, keyword, rank_value, search_volume, tracked, report_date')
      .eq('brand_id', brandId)
      .eq('report_date', date),
    fetchAsinMeta(brandId),
  ])

  if (rankRes.error) throw new Error(`getKeywordRankSummary failed: ${rankRes.error.message}`)

  return (rankRes.data ?? []).map(r => {
    const meta = asinMap.get(r.asin_id as string)
    return {
      keyword:       r.keyword as string,
      asin_id:       r.asin_id as string,
      asin:          meta?.asin ?? '',
      title:         meta?.title ?? null,
      rank_value:    r.rank_value !== null ? Number(r.rank_value) : null,
      search_volume: r.search_volume !== null ? Number(r.search_volume) : null,
      tracked:       r.tracked as boolean | null,
      report_date:   r.report_date as string,
    }
  }).sort((a, b) => (a.rank_value ?? 999) - (b.rank_value ?? 999))
}

export async function getRankMovers(
  brandId: string,
  startDate: string,
  endDate: string,
  minDelta = 5
): Promise<RankMoverRow[]> {
  const [rankRes, asinMap] = await Promise.all([
    supabaseAdmin
      .from('scale_insights_keyword_rank')
      .select('asin_id, keyword, rank_value, search_volume, report_date')
      .eq('brand_id', brandId)
      .gte('report_date', startDate)
      .lte('report_date', endDate)
      .order('report_date'),
    fetchAsinMeta(brandId),
  ])

  if (rankRes.error) throw new Error(`getRankMovers failed: ${rankRes.error.message}`)

  // Group by (asin_id, keyword) — keep first and last date
  const acc = new Map<string, {
    asin_id: string; keyword: string; search_volume: number | null
    rv_start: number | null; rv_end: number | null
  }>()

  for (const row of (rankRes.data ?? [])) {
    const key = `${row.asin_id}::${row.keyword}`

    if (!acc.has(key)) {
      acc.set(key, {
        asin_id:       row.asin_id as string,
        keyword:       row.keyword as string,
        search_volume: row.search_volume !== null ? Number(row.search_volume) : null,
        rv_start:      row.rank_value !== null ? Number(row.rank_value) : null,
        rv_end:        row.rank_value !== null ? Number(row.rank_value) : null,
      })
    } else {
      // Rows are ordered by date — update "end" values as we go
      const a = acc.get(key)!
      a.rv_end = row.rank_value !== null ? Number(row.rank_value) : null
      if (row.search_volume !== null) a.search_volume = Number(row.search_volume)
    }
  }

  return Array.from(acc.values())
    .map(a => {
      const meta = asinMap.get(a.asin_id)
      const rvDelta = (a.rv_start !== null && a.rv_end !== null)
        ? a.rv_start - a.rv_end  // positive = improved (lower rank number)
        : null

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
    .filter(r => r.rank_value_delta !== null && Math.abs(r.rank_value_delta) >= minDelta)
    .sort((a, b) => Math.abs(b.rank_value_delta ?? 0) - Math.abs(a.rank_value_delta ?? 0))
}
