import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface BusinessReportRow extends MappedRow {
  _asin: string
  _title: string
  report_date: string | null
  sessions_total: number | null
  sessions_mobile: number | null
  sessions_browser: number | null
  session_pct: number | null
  page_views_total: number | null
  page_views_pct: number | null
  buy_box_pct: number | null
  units_ordered: number | null
  unit_session_pct: number | null
  ordered_product_sales: number | null
  total_order_items: number | null
  units_refunded: number | null
  refund_rate: number | null
  shipped_product_sales: number | null
  units_shipped: number | null
}

export function mapBusinessReport(
  row: RawRow,
  brandId: string,
  context?: MapperContext
): BusinessReportRow {
  const get = makeGetter(row)

  // No date column in Amazon business reports — use the upload form's date_range_start.
  const report_date = context?.date_range_start
    ? parseDate(context.date_range_start)
    : null

  return {
    brand_id: brandId,
    // (Child) ASIN is the leaf ASIN; fall back to (Parent) ASIN if absent.
    _asin: get('', '(Child) ASIN', 'child_asin', '(Parent) ASIN', 'parent_asin', 'ASIN', 'asin'),
    _title: get('', 'Title', 'title'),
    report_date,
    sessions_total: parseInteger(get('', 'Sessions - Total', 'Sessions – Total', 'sessions_total')),
    sessions_mobile: parseInteger(get('', 'Sessions - Mobile App', 'Sessions – Mobile App', 'sessions_mobile_app', 'sessions_mobile')),
    sessions_browser: parseInteger(get('', 'Sessions - Browser', 'Sessions – Browser', 'sessions_browser')),
    // session_pct not present in the confirmed file; will be null until Amazon adds it.
    session_pct: parseNumeric(get('', 'Session Percentage - Total', 'Session Percentage – Total', 'session_percentage_total', 'session_pct')),
    page_views_total: parseInteger(get('', 'Page Views - Total', 'Page Views – Total', 'page_views_total')),
    page_views_pct: parseNumeric(get('', 'Page Views Percentage - Total', 'Page Views Percentage – Total', 'page_views_pct')),
    buy_box_pct: parseNumeric(get('', 'Featured Offer (Buy Box) Percentage', 'Buy Box Percentage', 'buy_box_pct')),
    units_ordered: parseInteger(get('', 'Units Ordered', 'units_ordered')),
    unit_session_pct: parseNumeric(get('', 'Unit Session Percentage', 'unit_session_percentage', 'unit_session_pct')),
    ordered_product_sales: parseNumeric(get('', 'Ordered Product Sales', 'ordered_product_sales')),
    total_order_items: parseInteger(get('', 'Total Order Items', 'total_order_items')),
    units_refunded: parseInteger(get('', 'Units Refunded', 'units_refunded')),
    refund_rate: parseNumeric(get('', 'Refund Rate', 'refund_rate')),
    shipped_product_sales: parseNumeric(get('', 'Shipped Product Sales', 'shipped_product_sales')),
    units_shipped: parseInteger(get('', 'Units Shipped', 'units_shipped')),
  }
}
