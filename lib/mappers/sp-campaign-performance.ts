import { MappedRow, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SpCampaignPerformanceRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  report_date: string | null
  ad_type: string | null
  impressions: number | null
  clicks: number | null
  ctr: number | null
  cpc: number | null
  spend: number | null
  sales_7d: number | null
  acos: number | null
  roas: number | null
  orders_7d: number | null
  units_7d: number | null
  cvr: number | null
  // Added by migration 003
  last_year_impressions: number | null
  last_year_clicks: number | null
  last_year_spend: number | null
  last_year_cpc: number | null
  program_type: string | null
  status: string | null
  budget_amount: number | null
  targeting_type: string | null
  bidding_strategy: string | null
  // Added by migration 007 — SB Campaign Performance columns
  viewable_impressions: number | null
  vcpm: number | null
  cost_type: string | null
  attribution_window: number | null
  view_through_rate: number | null
  vctr: number | null
  video_first_quartile_views: number | null
  video_midpoint_views: number | null
  video_third_quartile_views: number | null
  video_complete_views: number | null
  video_unmutes: number | null
  five_second_views: number | null
  five_second_view_rate: number | null
  branded_searches_14d: number | null
  detail_page_views_14d: number | null
  ntb_orders_14d: number | null
  ntb_orders_pct: number | null
  ntb_sales_14d: number | null
  ntb_sales_pct: number | null
  ntb_units_14d: number | null
  ntb_units_pct: number | null
  ntb_order_rate: number | null
  acos_click: number | null
  roas_click: number | null
  sales_click: number | null
  orders_click: number | null
  units_click: number | null
  ntb_dpv: number | null
  ntb_dpv_click_conversions: number | null
  ntb_dpv_rate: number | null
  effective_cost_per_ntb_dpv: number | null
  brand_store_page_views: number | null
  atc_14d: number | null
  atc_clicks_14d: number | null
  atcr_14d: number | null
  effective_cost_per_atc: number | null
  branded_search_click_conversions: number | null
  branded_search_rate: number | null
  effective_cost_per_branded_search: number | null
  long_term_sales: number | null
  long_term_roas: number | null
}

export function mapSpCampaignPerformance(row: RawRow, brandId: string): SpCampaignPerformanceRow {
  const get = makeGetter(row)

  // No Campaign ID column in this export — use Campaign Name as natural key.
  const campaignName = get('', 'Campaign Name', 'campaign_name')

  // Derive ad_type from the Ad Type column when present; otherwise infer from
  // campaign name prefix (SBV > SB > SP). SB exports have no Ad Type column.
  let adType: string | null = get(null as unknown as string, 'Ad Type', 'ad_type') || null
  if (!adType) {
    const prefix = campaignName.toUpperCase()
    adType = prefix.startsWith('SBV') ? 'SBV' : prefix.startsWith('SB') ? 'SB' : 'SP'
  }

  const isSB = adType === 'SB' || adType === 'SBV'

  return {
    brand_id: brandId,
    _campaign_amazon_id: get('', 'Campaign ID', 'campaign_id') || campaignName,
    _campaign_name: campaignName,

    // Amazon uses "Start Date" not "Date" in this report format.
    report_date: parseDate(get('', 'Start Date', 'start_date', 'Date', 'date', 'report_date')),

    ad_type: adType,

    impressions:           parseInteger(get('', 'Impressions',            'impressions')),
    last_year_impressions: parseInteger(get('', 'Last Year Impressions',  'last_year_impressions')),

    clicks:           parseInteger(get('', 'Clicks',           'clicks')),
    last_year_clicks: parseInteger(get('', 'Last Year Clicks', 'last_year_clicks')),

    // Amazon header is "Click-Thru Rate (CTR)" — "Thru" not "Through".
    ctr: parseNumeric(get('', 'Click-Thru Rate (CTR)', 'Click-through Rate (CTR)', 'CTR', 'ctr')),

    spend:           parseNumeric(get('', 'Spend',           'spend')),
    last_year_spend: parseNumeric(get('', 'Last Year Spend', 'last_year_spend')),

    cpc:           parseNumeric(get('', 'Cost Per Click (CPC)',           'CPC', 'cpc')),
    last_year_cpc: parseNumeric(get('', 'Last Year Cost Per Click (CPC)', 'last_year_cpc')),

    // SB uses "14 Day Total Sales"; SP uses "7 Day Total Sales". Try 14-day first.
    sales_7d:  parseNumeric(get('', '14 Day Total Sales',      '7 Day Total Sales',      'sales_7d')),
    acos:      parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS)', 'ACOS', 'acos')),
    roas:      parseNumeric(get('', 'Total Return on Advertising Spend (ROAS)', 'Return on Advertising Spend (ROAS)', 'ROAS', 'roas')),
    orders_7d: parseInteger(get('', '14 Day Total Orders (#)', '7 Day Total Orders (#)', 'orders_7d')),
    units_7d:  parseInteger(get('', '14 Day Total Units (#)',  '7 Day Total Units (#)',  'units_7d')),
    cvr:       parseNumeric(get('', '14 Day Conversion Rate',  '7 Day Conversion Rate',  'cvr', 'conversion_rate')),

    // Migration 003 columns — SP-only; null for SB rows (headers absent in SB export).
    program_type:     get(null as unknown as string, 'Program Type',    'program_type')    || null,
    status:           get(null as unknown as string, 'Status',          'status')          || null,
    budget_amount:    parseNumeric(get('', 'Budget Amount', 'budget_amount')),
    targeting_type:   get(null as unknown as string, 'Targeting Type',  'targeting_type')  || null,
    bidding_strategy: get(null as unknown as string, 'Bidding strategy', 'Bidding Strategy', 'bidding_strategy') || null,

    // ── SB Campaign columns (migration 007) ──────────────────────────────────────
    viewable_impressions: parseInteger(get('', 'Viewable Impressions', 'viewable_impressions')),

    // Amazon header: "Cost per 1,000 viewable impressions (VCPM)" — comma in 1,000 is
    // stripped by parseNumeric before parsing.
    vcpm:      parseNumeric(get('', 'Cost per 1,000 viewable impressions (VCPM)', 'Cost per 1000 viewable impressions (VCPM)', 'VCPM', 'vcpm')),
    cost_type: get(null as unknown as string, 'Cost type', 'cost_type') || null,

    // 14 for SB/SBV rows (14-day attribution window); null for SP rows.
    attribution_window: isSB ? 14 : null,

    view_through_rate: parseNumeric(get('', 'View-Through Rate (VTR)',                'view_through_rate')),
    vctr:              parseNumeric(get('', 'Click-Through Rate for Views (vCTR)',     'vctr')),

    video_first_quartile_views: parseInteger(get('', 'Video First Quartile Views', 'video_first_quartile_views')),
    video_midpoint_views:       parseInteger(get('', 'Video Midpoint Views',       'video_midpoint_views')),
    video_third_quartile_views: parseInteger(get('', 'Video Third Quartile Views', 'video_third_quartile_views')),
    video_complete_views:       parseInteger(get('', 'Video Complete Views',       'video_complete_views')),
    video_unmutes:              parseInteger(get('', 'Video Unmutes',              'video_unmutes')),

    five_second_views:     parseInteger(get('', '5 Second Views',     'five_second_views')),
    five_second_view_rate: parseNumeric(get('', '5 Second View Rate', 'five_second_view_rate')),

    branded_searches_14d:  parseInteger(get('', '14 Day Branded Searches',          'branded_searches_14d')),
    detail_page_views_14d: parseInteger(get('', '14 Day Detail Page Views (DPV)',    'detail_page_views_14d')),

    ntb_orders_14d: parseInteger(get('', '14 Day New-to-brand Orders (#)',      'ntb_orders_14d')),
    ntb_orders_pct: parseNumeric(get('', '14 Day % of Orders New-to-brand',     'ntb_orders_pct')),
    ntb_sales_14d:  parseNumeric(get('', '14 Day New-to-brand Sales',           'ntb_sales_14d')),
    ntb_sales_pct:  parseNumeric(get('', '14 Day % of Sales New-to-brand',      'ntb_sales_pct')),
    ntb_units_14d:  parseInteger(get('', '14 Day New-to-brand Units (#)',        'ntb_units_14d')),
    ntb_units_pct:  parseNumeric(get('', '14 Day % of Units New-to-brand',      'ntb_units_pct')),
    ntb_order_rate: parseNumeric(get('', '14 Day New-to-brand Order Rate',      'ntb_order_rate')),

    acos_click:   parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS) - (Click)',  'acos_click')),
    roas_click:   parseNumeric(get('', 'Total Return on Advertising Spend (ROAS) - (Click)', 'roas_click')),
    sales_click:  parseNumeric(get('', '14 Day Total Sales - (Click)',                       'sales_click')),
    orders_click: parseInteger(get('', '14 Day Total Orders (#) - (Click)',                  'orders_click')),
    units_click:  parseInteger(get('', '14 Day Total Units (#) - (Click)',                   'units_click')),

    ntb_dpv:                    parseInteger(get('', 'New-to-brand detail page views',                          'ntb_dpv')),
    ntb_dpv_click_conversions:  parseInteger(get('', 'New-to-brand detail page view click-through conversions', 'ntb_dpv_click_conversions')),
    ntb_dpv_rate:               parseNumeric(get('', 'New-to-brand detail page view rate',                      'ntb_dpv_rate')),
    effective_cost_per_ntb_dpv: parseNumeric(get('', 'Effective cost per new-to-brand detail page view',        'effective_cost_per_ntb_dpv')),

    brand_store_page_views: parseInteger(get('', 'Brand Store page views', 'brand_store_page_views')),

    atc_14d:                parseInteger(get('', '14 Day ATC',                              'atc_14d')),
    atc_clicks_14d:         parseInteger(get('', '14 Day ATC Clicks',                       'atc_clicks_14d')),
    atcr_14d:               parseNumeric(get('', '14 Day ATCR',                             'atcr_14d')),
    effective_cost_per_atc: parseNumeric(get('', 'Effective cost per Add to Cart (eCPATC)', 'effective_cost_per_atc')),

    branded_search_click_conversions:  parseInteger(get('', 'Branded Searches click-through conversions', 'branded_search_click_conversions')),
    branded_search_rate:               parseNumeric(get('', 'Branded Searches Rate',                      'branded_search_rate')),
    effective_cost_per_branded_search: parseNumeric(get('', 'Effective cost per Branded Search',          'effective_cost_per_branded_search')),

    long_term_sales: parseNumeric(get('', 'Long-Term Sales', 'long_term_sales')),
    long_term_roas:  parseNumeric(get('', 'Long-Term ROAS',  'long_term_roas')),
  }
}
