// Central display-format registry for every column in the platform.
// Import formatValue() and getFieldFormat() in any component that renders data.

export type FieldFormat =
  | 'currency_usd'  // $X,XXX.XX
  | 'percentage'    // X.XX%
  | 'ratio'         // X.XXx  (ROAS, MER)
  | 'integer'       // X,XXX
  | 'decimal'       // X.XX
  | 'text'          // raw string
  | 'date'          // MMM DD, YYYY

// ─── Format registry ──────────────────────────────────────────────────────────

export const FIELD_FORMATS: Record<string, FieldFormat> = {

  // ── Ratio / multiplier (ROAS, MER) ──────────────────────────────────────────
  roas:                    'ratio',
  roas_click:              'ratio',
  long_term_roas:          'ratio',
  blended_roas:            'ratio',
  sp_roas:                 'ratio',
  sb_roas:                 'ratio',
  asin_roas:               'ratio',
  mer:                     'ratio',

  // ── Percentage ──────────────────────────────────────────────────────────────
  ctr:                     'percentage',
  acos:                    'percentage',
  cvr:                     'percentage',  // 14-day for SB/SBV, 7-day for SP
  unit_session_pct:        'percentage',
  session_pct:             'percentage',
  page_views_pct:          'percentage',
  buy_box_pct:             'percentage',
  refund_rate:             'percentage',
  reorder_rate:            'percentage',
  ntb_rate:                'percentage',
  new_customer_pct:        'percentage',
  returning_customer_pct:  'percentage',
  ss_revenue_pct_of_total: 'percentage',
  top_of_search_is:        'percentage',
  market_share_pct:        'percentage',
  market_share:            'percentage',
  market_share_change:     'percentage',
  ad_spend_share:          'percentage',
  ttm_revenue_change:      'currency_usd',
  monthly_revenue_growth:  'percentage',
  category_revenue_pct:    'percentage',
  brand_revenue_pct:       'percentage',
  organic_pct:             'percentage',
  view_through_rate:       'percentage',
  vctr:                    'percentage',
  five_second_view_rate:   'percentage',
  ntb_orders_pct:          'percentage',
  ntb_units_pct:           'percentage',
  ntb_order_rate:          'percentage',
  ntb_dpv_rate:            'percentage',
  atcr_14d:                'percentage',
  branded_search_rate:     'percentage',
  seller_funding_pct:      'percentage',
  sns_sales_penetration:   'percentage',
  oos_rate:                'percentage',
  coupon_subscription_share: 'percentage',
  coupon_sales_penetration:  'percentage',
  period_acos:             'percentage',
  period_conversion:       'percentage',
  conversion_delta:        'percentage',
  market_conversion:       'percentage',
  asin_conversion:         'percentage',
  purchase_share:          'percentage',
  impressions_brand_share: 'percentage',
  clicks_rate:             'percentage',
  clicks_brand_share:      'percentage',
  cart_adds_rate:          'percentage',
  cart_adds_brand_share:   'percentage',
  purchases_rate:          'percentage',
  purchases_brand_share:   'percentage',
  acos_click:              'percentage',

  // ── Currency USD ────────────────────────────────────────────────────────────
  last_year_spend:         'currency_usd',
  budget_amount:           'currency_usd',
  spend:                   'currency_usd',
  // sales_7d, orders_7d, units_7d, cvr: for SB/SBV rows these represent 14-day attribution
  // (attribution_window = 14); for SP rows they represent 7-day attribution (attribution_window = null).
  sales_7d:                'currency_usd',
  vcpm:                    'currency_usd',
  sales_click:             'currency_usd',
  ntb_sales_14d:           'currency_usd',
  ntb_sales_pct:           'currency_usd',
  effective_cost_per_ntb_dpv: 'currency_usd',
  effective_cost_per_atc:  'currency_usd',
  effective_cost_per_branded_search: 'currency_usd',
  long_term_sales:         'currency_usd',
  clicks_price_median:          'currency_usd',
  clicks_brand_price_median:    'currency_usd',
  cart_adds_price_median:       'currency_usd',
  cart_adds_brand_price_median: 'currency_usd',
  purchases_price_median:       'currency_usd',
  purchases_brand_price_median: 'currency_usd',
  est_monthly_revenue:     'currency_usd',
  ttm_revenue:             'currency_usd',
  monthly_revenue_per_review: 'currency_usd',
  avg_monthly_revenue:     'currency_usd',
  avg_price:               'currency_usd',
  lost_sales_oos:          'currency_usd',
  period_sales:            'currency_usd',
  period_spent:            'currency_usd',
  advertised_sku_sales:    'currency_usd',
  other_sku_sales:         'currency_usd',
  ordered_product_sales:   'currency_usd',
  shipped_product_sales:   'currency_usd',
  ss_revenue:              'currency_usd',
  ss_discount_amount:      'currency_usd',
  total_ppc_spend:         'currency_usd',
  total_ppc_sales:         'currency_usd',
  total_revenue:           'currency_usd',
  organic_revenue:         'currency_usd',
  aov:                     'currency_usd',
  cac:                     'currency_usd',
  estimated_revenue:       'currency_usd',
  ppc_spend:               'currency_usd',
  ppc_sales:               'currency_usd',
  organic_sales:           'currency_usd',
  spend_pacing_gap:        'currency_usd',
  revenue_pacing_gap:      'currency_usd',
  target_value:            'currency_usd',  // goals table (overrideable at render time)

  // ── Decimal (bids, CPC, shares) ─────────────────────────────────────────────
  cpc:                     'decimal',
  last_year_cpc:           'decimal',
  default_bid:             'decimal',
  bid_before:              'decimal',
  bid_after:               'decimal',
  impression_share:        'decimal',
  click_share:             'decimal',
  price:                   'decimal',
  opportunity_score:       'decimal',
  review_rating:           'decimal',
  listing_quality_score:   'decimal',
  avg_num_sellers:         'decimal',
  avg_package_volume:      'decimal',
  avg_review_count:        'decimal',
  avg_rating:              'decimal',
  avg_page_score:          'decimal',

  // ── Integer ─────────────────────────────────────────────────────────────────
  impressions:             'integer',
  last_year_impressions:   'integer',
  clicks:                  'integer',
  last_year_clicks:        'integer',
  orders_7d:               'integer',  // 14-day for SB/SBV (attribution_window=14), 7-day for SP
  other_sku_orders:        'integer',
  units_7d:                'integer',  // 14-day for SB/SBV, 7-day for SP
  advertised_sku_units:    'integer',
  other_sku_units:         'integer',
  sessions_total:          'integer',
  sessions_mobile:         'integer',
  sessions_browser:        'integer',
  page_views_total:        'integer',
  units_ordered:           'integer',
  total_order_items:       'integer',
  units_refunded:          'integer',
  units_shipped:           'integer',
  orders_shipped:          'integer',
  organic_rank:            'integer',
  sponsored_rank:          'integer',
  search_volume:           'integer',
  active_subscriptions:    'integer',
  new_subscriptions:       'integer',
  cancelled_subscriptions: 'integer',
  ss_units_shipped:        'integer',
  total_clicks:            'integer',
  total_impressions:       'integer',
  total_orders:            'integer',
  ntb_orders:              'integer',
  ss_active_subscriptions: 'integer',
  ss_new_subscriptions:    'integer',
  video_views:                      'integer',
  video_first_quartile_views:       'integer',
  video_midpoint_views:             'integer',
  video_third_quartile_views:       'integer',
  video_complete_views:             'integer',
  video_unmutes:                    'integer',
  five_second_views:                'integer',
  viewable_impressions:             'integer',
  branded_searches_14d:             'integer',
  detail_page_views_14d:            'integer',
  ntb_orders_14d:                   'integer',
  ntb_units_14d:                    'integer',
  ntb_dpv:                          'integer',
  ntb_dpv_click_conversions:        'integer',
  brand_store_page_views:           'integer',
  brand_dpv_click:                  'integer',
  atc_14d:                          'integer',
  atc_clicks_14d:                   'integer',
  branded_search_click_conversions: 'integer',
  attribution_window:      'integer',
  orders_click:            'integer',
  units_click:             'integer',
  sessions:                'integer',
  page_views:              'integer',
  ss_units:                'integer',
  search_query_score:           'integer',
  search_query_volume:          'integer',
  impressions_total:            'integer',
  impressions_brand:            'integer',
  clicks_total:                 'integer',
  clicks_brand:                 'integer',
  clicks_same_day_shipping:     'integer',
  clicks_1d_shipping:           'integer',
  clicks_2d_shipping:           'integer',
  cart_adds_total:              'integer',
  cart_adds_brand:              'integer',
  cart_adds_same_day_shipping:  'integer',
  cart_adds_1d_shipping:        'integer',
  cart_adds_2d_shipping:        'integer',
  purchases_total:              'integer',
  purchases_brand:              'integer',
  purchases_same_day_shipping:  'integer',
  purchases_1d_shipping:        'integer',
  purchases_2d_shipping:        'integer',
  rank_value:              'integer',
  period_orders:           'integer',
  period_units:            'integer',
  period_clicks:           'integer',
  query_volume:            'integer',
  rows_received:           'integer',
  rows_stored:             'integer',
  rows_rejected:           'integer',
  primary_subcategory_rank: 'integer',
  review_count:            'integer',
  monthly_units_sold:      'integer',
  num_sellers:             'integer',
  asin_count:              'integer',
  avg_monthly_units:       'integer',
  category_revenue_rank:   'integer',
  estimated_units:         'integer',
  est_monthly_units:       'integer',
  num_asins:               'integer',
  total_review_count:      'integer',

  // ── Text ────────────────────────────────────────────────────────────────────
  search_query:            'text',
  customer_search_term:    'text',
  sku:                     'text',
  fulfilled_by:            'text',
  tracked:                 'text',
  asin_text:               'text',
  short_name:              'text',
  code:                    'text',
  details:                 'text',
  criteria:                'text',
  targeting:               'text',
  match_type:              'text',
  ad_type:                 'text',
  cost_type:               'text',
  campaign_name:           'text',
  campaign_id:             'text',
  portfolio_name:          'text',
  targeting_type:          'text',
  bidding_strategy:        'text',
  program_type:            'text',
  status:                  'text',
  ad_group_name:           'text',
  ad_group_id:             'text',
  asin:                    'text',
  parent_asin:             'text',
  title:                   'text',
  product_line:            'text',
  keyword:                 'text',
  brand_name:              'text',
  category:                'text',
  competitor_brand:        'text',
  advertised_sku:          'text',
  advertised_asin:         'text',
  purchased_asin:          'text',
  purchased_title:         'text',
  target:                  'text',
  rule_name:               'text',
  rule_trigger:            'text',
  change_reason:           'text',
  report_type:             'text',
  source_platform:         'text',
  ingestion_method:        'text',
  error_message:           'text',
  metric_name:             'text',
  period_type:             'text',
  unit:                    'text',
  notes:                   'text',
  name:                    'text',
  amazon_seller_id:        'text',
  amazon_ads_profile_id:   'text',
  fulfillment_type:        'text',
  seller_type:             'text',
  is_variation:            'text',
  has_coupons:             'text',
  dominant_seller_country: 'text',

  // ── Date / timestamp ────────────────────────────────────────────────────────
  report_date:             'date',
  metric_date:             'date',
  week_start:              'date',
  week_end:                'date',
  change_timestamp:        'date',
  ingested_at:             'date',
  calculated_at:           'date',
  created_at:              'date',
  updated_at:              'date',
  period_start:            'date',
  period_end:              'date',
  date_range_start:        'date',
  date_range_end:          'date',
  snapshot_date:           'date',
  date_first_available:    'date',
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const INT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',  // prevent off-by-one from local timezone shifts on date-only strings
})

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return isNaN(n) ? null : n
}

function toDateString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const s = String(value)
  // Accept ISO date (YYYY-MM-DD) or ISO datetime
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
  if (isNaN(d.getTime())) return s
  return DATE_FMT.format(d)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the FieldFormat for a given column name, or 'text' if not registered.
 */
export function getFieldFormat(fieldName: string): FieldFormat {
  return FIELD_FORMATS[fieldName] ?? 'text'
}

/**
 * Formats any value for display given its column name.
 * Returns '—' for null / undefined / empty.
 */
export function formatValue(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === '') return '—'

  const format = getFieldFormat(fieldName)

  switch (format) {
    case 'currency_usd': {
      const n = toNumber(value)
      return n === null ? String(value) : USD.format(n)
    }

    case 'percentage': {
      const n = toNumber(value)
      if (n === null) return String(value)
      // Values are stored as actual percentages (e.g. 15.3 not 0.153)
      return `${n.toFixed(2)}%`
    }

    case 'ratio': {
      const n = toNumber(value)
      if (n === null) return String(value)
      return `${n.toFixed(2)}x`
    }

    case 'integer': {
      const n = toNumber(value)
      if (n === null) return String(value)
      return INT.format(Math.round(n))
    }

    case 'decimal': {
      const n = toNumber(value)
      if (n === null) return String(value)
      return n.toFixed(2)
    }

    case 'date': {
      return toDateString(value)
    }

    case 'text':
    default:
      return String(value)
  }
}
