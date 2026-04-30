import { MappedRow, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SmartscoutShareOfVoiceRow extends MappedRow {
  report_date: string | null
  keyword: string | null
  brand_name: string | null
  impression_share: number | null
  click_share: number | null
  search_volume: number | null
}

export function mapSmartscoutShareOfVoice(row: RawRow, brandId: string): SmartscoutShareOfVoiceRow {
  const get = makeGetter(row)
  return {
    brand_id: brandId,
    report_date: parseDate(get('', 'Date', 'date', 'report_date', 'week', 'period')),
    keyword: get(null as unknown as string, 'Keyword', 'keyword', 'search_term') || null,
    brand_name: get(null as unknown as string, 'Brand Name', 'brand_name', 'brand') || null,
    impression_share: parseNumeric(get('', 'Impression Share', 'impression_share', 'impressions_share')),
    click_share: parseNumeric(get('', 'Click Share', 'click_share', 'clicks_share')),
    search_volume: parseInteger(get('', 'Search Volume', 'search_volume', 'volume')),
  }
}
