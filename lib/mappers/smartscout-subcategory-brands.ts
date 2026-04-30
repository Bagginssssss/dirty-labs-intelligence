import { MappedRow, RawRow, MapperContext, makeGetter, parseNumeric } from './types'

export interface SmartscoutSubcategoryBrandsRow extends MappedRow {
  snapshot_date: string | null
  brand_name: string | null
  est_monthly_revenue: number | null
  market_share: number | null
  market_share_change: number | null
  ad_spend_share: number | null
  dominant_seller_country: string | null
  avg_num_sellers: number | null
  avg_package_volume: number | null
  est_monthly_units: number | null
  num_asins: number | null
  total_review_count: number | null
  avg_review_count: number | null
  avg_rating: number | null
  avg_page_score: number | null
  avg_price: number | null
}

export function mapSmartscoutSubcategoryBrands(
  row: RawRow,
  brandId: string,
  context?: MapperContext
): SmartscoutSubcategoryBrandsRow[] {
  const get = makeGetter(row)
  const snapshotDate = context?.date_range_start ?? null

  const brandName = get('', 'Brand', 'brand_name', 'brand') || null
  if (!brandName) return []

  return [{
    brand_id:                brandId,
    snapshot_date:           snapshotDate,
    brand_name:              brandName,
    est_monthly_revenue:     parseNumeric(get('', 'Estimated Monthly Revenue', 'est_monthly_revenue')),
    market_share:            parseNumeric(get('', 'Market Share', 'market_share')),
    market_share_change:     parseNumeric(get('', 'Market Share Change', 'market_share_change')),
    ad_spend_share:          parseNumeric(get('', 'Ad Spend Share', 'ad_spend_share')),
    dominant_seller_country: get('', 'Dominant Seller Country', 'dominant_seller_country') || null,
    avg_num_sellers:         parseNumeric(get('', 'Average Number of Sellers', 'avg_num_sellers')),
    avg_package_volume:      parseNumeric(get('', 'Average Package Volume', 'avg_package_volume')),
    est_monthly_units:       parseNumeric(get('', 'Estimated Monthly Units Sold', 'est_monthly_units')),
    num_asins:               parseNumeric(get('', 'Number of ASINs', 'num_asins')),
    total_review_count:      parseNumeric(get('', 'Total Review Count', 'total_review_count')),
    avg_review_count:        parseNumeric(get('', 'Average Review Count', 'avg_review_count')),
    avg_rating:              parseNumeric(get('', 'Average Rating', 'avg_rating')),
    avg_page_score:          parseNumeric(get('', 'Average Page Score', 'avg_page_score')),
    avg_price:               parseNumeric(get('', 'Average Price', 'avg_price')),
  }]
}
