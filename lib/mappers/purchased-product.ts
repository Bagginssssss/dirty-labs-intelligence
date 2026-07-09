import type { MappedRow, RawRow } from './types'
import { makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface PurchasedProductRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  report_date: string | null
  // INB-149: ad_type/attribution_type join the NULL-proof key. SP export rows are
  // ad_type='SP' with an empty attribution_type; the SB path (sb-attributed-purchases)
  // writes SB/SBV. advertised_asin/purchased_asin are '' -normalized (NOT NULL columns).
  ad_type: 'SP'
  attribution_type: string
  advertised_sku: string | null
  advertised_asin: string
  purchased_asin: string
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

    ad_type: 'SP',
    attribution_type: '',

    // Amazon uses "Start Date" not "Date" in this report format.
    report_date: parseDate(get('', 'Start Date', 'start_date', 'Date', 'date', 'report_date')),

    advertised_sku:   get(null as unknown as string, 'Advertised SKU',  'advertised_sku')  || null,
    // '' -normalized: these are NOT NULL key columns as of migration 042.
    advertised_asin:  get('', 'Advertised ASIN', 'advertised_asin'),
    purchased_asin:   get('', 'Purchased ASIN',  'purchased_asin'),
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
