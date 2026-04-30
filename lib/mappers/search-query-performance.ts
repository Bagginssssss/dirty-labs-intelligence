import { MappedRow, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SearchQueryPerformanceRow extends MappedRow {
  report_date: string | null
  search_query: string | null
  search_query_score: number | null
  search_query_volume: number | null
  impressions_total: number | null
  impressions_brand: number | null
  impressions_brand_share: number | null
  clicks_total: number | null
  clicks_rate: number | null
  clicks_brand: number | null
  clicks_brand_share: number | null
  clicks_price_median: number | null
  clicks_brand_price_median: number | null
  clicks_same_day_shipping: number | null
  clicks_1d_shipping: number | null
  clicks_2d_shipping: number | null
  cart_adds_total: number | null
  cart_adds_rate: number | null
  cart_adds_brand: number | null
  cart_adds_brand_share: number | null
  cart_adds_price_median: number | null
  cart_adds_brand_price_median: number | null
  cart_adds_same_day_shipping: number | null
  cart_adds_1d_shipping: number | null
  cart_adds_2d_shipping: number | null
  purchases_total: number | null
  purchases_rate: number | null
  purchases_brand: number | null
  purchases_brand_share: number | null
  purchases_price_median: number | null
  purchases_brand_price_median: number | null
  purchases_same_day_shipping: number | null
  purchases_1d_shipping: number | null
  purchases_2d_shipping: number | null
}

export function mapSearchQueryPerformance(row: RawRow, brandId: string): SearchQueryPerformanceRow {
  const get = makeGetter(row)

  return {
    brand_id: brandId,

    report_date:  parseDate(get('', 'Reporting Date', 'reporting_date')),
    search_query: get(null as unknown as string, 'Search Query', 'search_query') || null,

    search_query_score:  parseInteger(get('', 'Search Query Score',  'search_query_score')),
    search_query_volume: parseInteger(get('', 'Search Query Volume', 'search_query_volume')),

    impressions_total:       parseInteger(get('', 'Impressions: Total Count',  'impressions_total')),
    impressions_brand:       parseInteger(get('', 'Impressions: Brand Count',  'impressions_brand')),
    // parseNumeric strips the % symbol before parsing.
    impressions_brand_share: parseNumeric(get('', 'Impressions: Brand Share %', 'impressions_brand_share')),

    clicks_total:              parseInteger(get('', 'Clicks: Total Count',             'clicks_total')),
    clicks_rate:               parseNumeric(get('', 'Clicks: Click Rate %',            'clicks_rate')),
    clicks_brand:              parseInteger(get('', 'Clicks: Brand Count',             'clicks_brand')),
    clicks_brand_share:        parseNumeric(get('', 'Clicks: Brand Share %',           'clicks_brand_share')),
    clicks_price_median:       parseNumeric(get('', 'Clicks: Price (Median)',           'clicks_price_median')),
    clicks_brand_price_median: parseNumeric(get('', 'Clicks: Brand Price (Median)',     'clicks_brand_price_median')),
    clicks_same_day_shipping:  parseInteger(get('', 'Clicks: Same Day Shipping Speed', 'clicks_same_day_shipping')),
    clicks_1d_shipping:        parseInteger(get('', 'Clicks: 1D Shipping Speed',       'clicks_1d_shipping')),
    clicks_2d_shipping:        parseInteger(get('', 'Clicks: 2D Shipping Speed',       'clicks_2d_shipping')),

    cart_adds_total:              parseInteger(get('', 'Cart Adds: Total Count',              'cart_adds_total')),
    cart_adds_rate:               parseNumeric(get('', 'Cart Adds: Cart Add Rate %',          'cart_adds_rate')),
    cart_adds_brand:              parseInteger(get('', 'Cart Adds: Brand Count',              'cart_adds_brand')),
    cart_adds_brand_share:        parseNumeric(get('', 'Cart Adds: Brand Share %',            'cart_adds_brand_share')),
    cart_adds_price_median:       parseNumeric(get('', 'Cart Adds: Price (Median)',            'cart_adds_price_median')),
    cart_adds_brand_price_median: parseNumeric(get('', 'Cart Adds: Brand Price (Median)',      'cart_adds_brand_price_median')),
    cart_adds_same_day_shipping:  parseInteger(get('', 'Cart Adds: Same Day Shipping Speed',  'cart_adds_same_day_shipping')),
    cart_adds_1d_shipping:        parseInteger(get('', 'Cart Adds: 1D Shipping Speed',        'cart_adds_1d_shipping')),
    cart_adds_2d_shipping:        parseInteger(get('', 'Cart Adds: 2D Shipping Speed',        'cart_adds_2d_shipping')),

    purchases_total:              parseInteger(get('', 'Purchases: Total Count',              'purchases_total')),
    purchases_rate:               parseNumeric(get('', 'Purchases: Purchase Rate %',          'purchases_rate')),
    purchases_brand:              parseInteger(get('', 'Purchases: Brand Count',              'purchases_brand')),
    purchases_brand_share:        parseNumeric(get('', 'Purchases: Brand Share %',            'purchases_brand_share')),
    purchases_price_median:       parseNumeric(get('', 'Purchases: Price (Median)',            'purchases_price_median')),
    purchases_brand_price_median: parseNumeric(get('', 'Purchases: Brand Price (Median)',      'purchases_brand_price_median')),
    purchases_same_day_shipping:  parseInteger(get('', 'Purchases: Same Day Shipping Speed',  'purchases_same_day_shipping')),
    purchases_1d_shipping:        parseInteger(get('', 'Purchases: 1D Shipping Speed',        'purchases_1d_shipping')),
    purchases_2d_shipping:        parseInteger(get('', 'Purchases: 2D Shipping Speed',        'purchases_2d_shipping')),
  }
}
