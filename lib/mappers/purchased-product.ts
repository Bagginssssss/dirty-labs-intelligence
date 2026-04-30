import { MappedRow, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface PurchasedProductRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  report_date: string | null
  advertised_sku: string | null
  advertised_asin: string | null
  purchased_asin: string | null
  purchased_title: string | null
  orders_7d: number | null
  units_7d: number | null
  other_sku_orders: number | null
  sales_7d: number | null
}

export function mapPurchasedProduct(row: RawRow, brandId: string): PurchasedProductRow {
  const get = makeGetter(row)

  // No Campaign ID column in this export — use Campaign Name as natural key.
  const campaignName = get('', 'Campaign Name', 'campaign_name')

  return {
    brand_id: brandId,
    _campaign_amazon_id: get('', 'Campaign ID', 'campaign_id') || campaignName,
    _campaign_name: campaignName,

    // Amazon uses "Start Date" not "Date" in this report format.
    report_date: parseDate(get('', 'Start Date', 'start_date', 'Date', 'date', 'report_date')),

    advertised_sku:   get(null as unknown as string, 'Advertised SKU',  'advertised_sku')  || null,
    advertised_asin:  get(null as unknown as string, 'Advertised ASIN', 'advertised_asin') || null,
    purchased_asin:   get(null as unknown as string, 'Purchased ASIN',  'purchased_asin')  || null,
    // "Purchased Title" / "Title" column not present in confirmed Amazon export.
    purchased_title:  null,

    // orders_7d not in confirmed headers for this report variant; kept for schema compat.
    orders_7d: null,

    // "7 Day Other SKU Units (#)" maps to units_7d.
    units_7d: parseInteger(get('', '7 Day Other SKU Units (#)', 'units_7d')),

    // New column added in migration 004.
    // "7 Day Other SKU Sales" has a trailing space in some exports;
    // transformHeader in csv-parser.ts trims it automatically.
    other_sku_orders: parseInteger(get('', '7 Day Other SKU Orders (#)', 'other_sku_orders')),
    sales_7d:         parseNumeric(get('', '7 Day Other SKU Sales',      'sales_7d')),
  }
}
