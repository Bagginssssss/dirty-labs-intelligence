import { MappedRow, RawRow, makeGetter, parseInteger, parseNumeric } from './types'

// Raw header format for date columns before normalization.
const DATE_COL_RE = /^\d{4}-\d{2}-\d{2}$/

// Scale Insights reports "97+" for any rank beyond 97 — store as 98 to preserve sort order.
function parseRankValue(value: string): number | null {
  if (!value || value.trim() === '') return null
  const trimmed = value.trim()
  if (trimmed === '97+') return 98
  const n = parseInt(trimmed, 10)
  return isNaN(n) ? null : n
}

export interface ScaleInsightsKeywordRankRow extends MappedRow {
  _asin: string
  _title: string
  report_date: string | null
  keyword: string | null
  sku: string | null
  tracked: boolean | null
  rank_value: number | null
  search_volume: number | null
  period_sales: number | null
  period_acos: number | null
  period_conversion: number | null
  period_spent: number | null
  period_orders: number | null
  period_units: number | null
  period_clicks: number | null
  query_volume: number | null
  conversion_delta: number | null
  market_conversion: number | null
  asin_conversion: number | null
  purchase_share: number | null
}

// Unpivots one wide CSV row into one narrow DB row per date column.
// Date columns are identified by YYYY-MM-DD headers; everything else is metadata.
// Rows where the rank cell is empty are skipped — no rank, no record.
export function mapScaleInsightsKeywordRank(
  row: RawRow,
  brandId: string
): ScaleInsightsKeywordRankRow[] {
  const get = makeGetter(row)

  const asin    = get('', 'ASIN', 'asin')
  const title   = get('', 'Title', 'title')
  const sku     = get('', 'SKU', 'sku') || null
  const keyword = get(null as unknown as string, 'Keyword', 'keyword', 'search_term') || null

  const trackedRaw = get('', 'Tracked', 'tracked').trim().toLowerCase()
  const tracked: boolean | null = trackedRaw !== '' ? trackedRaw === 'yes' : null

  // Period-level metrics repeat on every unpivoted row.
  const periodSales      = parseNumeric(get('', 'Sales',             'period_sales'))
  const periodAcos       = parseNumeric(get('', 'ACOS',             'period_acos'))
  const periodConversion = parseNumeric(get('', 'Conversion',       'period_conversion'))
  const periodSpent      = parseNumeric(get('', 'Spent',            'period_spent'))
  const periodOrders     = parseInteger(get('', 'Orders',           'period_orders'))
  const periodUnits      = parseInteger(get('', 'Units',            'period_units'))
  const periodClicks     = parseInteger(get('', 'Clicks',           'period_clicks'))
  const queryVolume      = parseInteger(get('', 'Query Volume',     'query_volume'))
  const conversionDelta  = parseNumeric(get('', 'Conversion Delta', 'conversion_delta'))
  const marketConversion = parseNumeric(get('', 'Market Conversion','market_conversion'))
  const asinConversion   = parseNumeric(get('', 'Asin Conversion',  'asin_conversion'))
  const purchaseShare    = parseNumeric(get('', 'Purchase Share',   'purchase_share'))

  const result: ScaleInsightsKeywordRankRow[] = []

  for (const [key, rawValue] of Object.entries(row)) {
    // Strip BOM (defence-in-depth; csv-parser.ts transformHeader should have handled it).
    const header = key.replace(/^﻿/, '').trim()
    if (!DATE_COL_RE.test(header)) continue

    const rankValue = parseRankValue(rawValue)
    if (rankValue === null) continue  // no rank data for this date — skip

    result.push({
      brand_id: brandId,
      _asin:   asin,
      _title:  title,
      report_date: header,     // already YYYY-MM-DD — stored directly
      keyword,
      sku,
      tracked,
      rank_value:    rankValue,
      search_volume: queryVolume,
      period_sales:      periodSales,
      period_acos:       periodAcos,
      period_conversion: periodConversion,
      period_spent:      periodSpent,
      period_orders:     periodOrders,
      period_units:      periodUnits,
      period_clicks:     periodClicks,
      query_volume:      queryVolume,
      conversion_delta:  conversionDelta,
      market_conversion: marketConversion,
      asin_conversion:   asinConversion,
      purchase_share:    purchaseShare,
    })
  }

  return result
}
