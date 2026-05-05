import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface BusinessReportDailyRow extends MappedRow {
  report_date:                  string | null
  ordered_product_sales:        number | null
  ordered_product_sales_b2b:    number | null
  units_ordered:                number | null
  units_ordered_b2b:            number | null
  total_order_items:            number | null
  total_order_items_b2b:        number | null
  page_views_total:             number | null
  page_views_total_b2b:         number | null
  sessions_total:               number | null
  sessions_total_b2b:           number | null
  // Stored as raw percentage (e.g. 97.99), not decimal (0.9799).
  // parseNumeric strips the trailing % sign; callers divide by 100 at the boundary.
  buy_box_pct:                  number | null
  buy_box_pct_b2b:              number | null
  unit_session_pct:             number | null
  unit_session_pct_b2b:         number | null
  average_offer_count:          number | null
  average_parent_items:         number | null
}

export function mapBusinessReportDaily(
  row: RawRow,
  brandId: string,
  _context?: MapperContext
): BusinessReportDailyRow {
  const get = makeGetter(row)

  // Date comes from each CSV row's Date column — unlike the ASIN-level monthly
  // business_report which has no date column and relies on the upload form field.
  const report_date = parseDate(get('', 'Date', 'date'))

  return {
    brand_id: brandId,
    report_date,
    ordered_product_sales:      parseNumeric(get('', 'Ordered Product Sales',       'ordered_product_sales')),
    ordered_product_sales_b2b:  parseNumeric(get('', 'Ordered Product Sales - B2B', 'ordered_product_sales_b2b')),
    units_ordered:              parseInteger(get('', 'Units Ordered',               'units_ordered')),
    units_ordered_b2b:          parseInteger(get('', 'Units Ordered - B2B',         'units_ordered_b2b')),
    total_order_items:          parseInteger(get('', 'Total Order Items',            'total_order_items')),
    total_order_items_b2b:      parseInteger(get('', 'Total Order Items - B2B',      'total_order_items_b2b')),
    page_views_total:           parseInteger(get('', 'Page Views - Total',           'Page Views – Total', 'page_views_total')),
    page_views_total_b2b:       parseInteger(get('', 'Page Views - Total - B2B',    'page_views_total_b2b')),
    sessions_total:             parseInteger(get('', 'Sessions - Total',             'Sessions – Total', 'sessions_total')),
    sessions_total_b2b:         parseInteger(get('', 'Sessions - Total - B2B',      'Sessions – Total – B2B', 'sessions_total_b2b')),
    buy_box_pct:                parseNumeric(get('', 'Featured Offer (Buy Box) Percentage',       'Buy Box Percentage',       'buy_box_pct')),
    buy_box_pct_b2b:            parseNumeric(get('', 'Featured Offer (Buy Box) Percentage - B2B', 'Buy Box Percentage - B2B', 'buy_box_pct_b2b')),
    unit_session_pct:           parseNumeric(get('', 'Unit Session Percentage',       'unit_session_percentage',       'unit_session_pct')),
    unit_session_pct_b2b:       parseNumeric(get('', 'Unit Session Percentage - B2B', 'unit_session_percentage_b2b', 'unit_session_pct_b2b')),
    average_offer_count:        parseInteger(get('', 'Average Offer Count',  'average_offer_count')),
    average_parent_items:       parseInteger(get('', 'Average Parent Items',  'average_parent_items')),
  }
}
