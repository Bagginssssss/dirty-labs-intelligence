import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SubscribeAndSaveRow extends MappedRow {
  _asin: string
  report_date: string | null
  date_range_end: string | null
  sku: string | null
  fulfilled_by: string | null
  category: string | null
  seller_funding_pct: number | null
  active_subscriptions: number | null
  new_subscriptions: number | null
  cancelled_subscriptions: number | null
  ss_units_shipped: number | null
  ss_revenue: number | null
  ss_discount_amount: number | null
  reorder_rate: number | null
  sns_sales_penetration: number | null
  oos_rate: number | null
  lost_sales_oos: number | null
  coupon_subscription_share: number | null
  coupon_sales_penetration: number | null
}

export function mapSubscribeAndSave(row: RawRow, brandId: string, context?: MapperContext): SubscribeAndSaveRow {
  const get = makeGetter(row)

  return {
    brand_id: brandId,
    _asin: get('', 'ASIN', 'asin'),

    report_date:    parseDate(get('', 'Reporting Period Start', 'Date', 'date', 'report_date', 'month')),
    date_range_end: parseDate(get('', 'Reporting Period End',   'date_range_end')),

    sku:          get(null as unknown as string, 'SKU',          'sku')          || null,
    fulfilled_by: get(null as unknown as string, 'Fulfilled by', 'fulfilled_by') || null,
    category:     get(null as unknown as string, 'Category',     'category')     || null,

    seller_funding_pct: parseNumeric(get('', 'Seller Funding %', 'seller_funding_pct')),

    // "Period End Subscription Balance" is a decimal in the file (e.g. 13638.0) — round to integer.
    active_subscriptions: parseInteger(get('', 'Period End Subscription Balance', 'Active Subscriptions', 'active_subscriptions', 'active_subscribers')),

    // Not present in the Amazon S&S export — kept in schema for other data sources.
    new_subscriptions:      null,
    cancelled_subscriptions: null,
    ss_discount_amount:     null,
    reorder_rate:           null,

    // "SnS shipped units" is a decimal in the file (e.g. 6495.5) — round to integer.
    ss_units_shipped: parseInteger(get('', 'SnS shipped units', 'Units Shipped', 'ss_units_shipped')),
    ss_revenue:       parseNumeric(get('', 'SnS Sales',         'Revenue',       'ss_revenue')),

    // Decimal format (0–1 range): 0.4035 = 40.35%. parseFloat handles scientific notation (e.g. 2.0E-4).
    sns_sales_penetration:    parseNumeric(get('', 'SnS Sales Penetration %',               'sns_sales_penetration')),
    oos_rate:                 parseNumeric(get('', 'Not delivered due to OOS %',             'oos_rate')),
    lost_sales_oos:           parseNumeric(get('', 'Lost Sales due to OOS',                  'lost_sales_oos')),
    coupon_subscription_share: parseNumeric(get('', 'Share of coupon driven Subscriptions', 'coupon_subscription_share')),
    coupon_sales_penetration:  parseNumeric(get('', 'Coupon Sales Penetration',              'coupon_sales_penetration')),
  }
}
