import { MappedRow, RawRow, makeGetter, parseDate, parseNumeric } from './types'

export interface SmartscoutBrandRevenueRow extends MappedRow {
  report_date: string | null
  competitor_brand: string | null
  estimated_revenue: number | null
  estimated_units: number | null
  market_share_pct: number | null
  category: string | null
}

export function mapSmartscoutBrandRevenue(row: RawRow, brandId: string): SmartscoutBrandRevenueRow {
  const get = makeGetter(row)
  return {
    brand_id: brandId,
    report_date: parseDate(get('', 'Date', 'date', 'report_date', 'month', 'period')),
    competitor_brand: get(null as unknown as string, 'Competitor Brand', 'competitor_brand', 'brand', 'brand_name') || null,
    estimated_revenue: parseNumeric(get('', 'Estimated Revenue', 'estimated_revenue', 'revenue')),
    estimated_units: parseNumeric(get('', 'Estimated Units', 'estimated_units', 'units')),
    market_share_pct: parseNumeric(get('', 'Market Share %', 'Market Share', 'market_share_pct', 'market_share')),
    category: get(null as unknown as string, 'Category', 'category', 'subcategory') || null,
  }
}
