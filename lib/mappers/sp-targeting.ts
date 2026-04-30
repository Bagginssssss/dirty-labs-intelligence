import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SpTargetingRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  _ad_group_amazon_id: string
  _ad_group_name: string
  report_date: string | null
  targeting: string | null
  match_type: string | null
  ad_type: string | null
  impressions: number | null
  top_of_search_is: number | null
  clicks: number | null
  ctr: number | null
  cpc: number | null
  spend: number | null
  acos: number | null
  roas: number | null
  sales_7d: number | null
  orders_7d: number | null
  units_7d: number | null
  cvr: number | null
  advertised_sku_units: number | null
  other_sku_units: number | null
  advertised_sku_sales: number | null
  other_sku_sales: number | null
  // Added by migration 009 — SB Keyword Report columns
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
  brand_dpv_click: number | null
}

export function mapSpTargeting(row: RawRow, brandId: string, context?: MapperContext): SpTargetingRow {
  const get = makeGetter(row)

  // No Campaign ID / Ad Group ID columns in this export — use name as natural key.
  const campaignName = get('', 'Campaign Name', 'campaign_name')
  const adGroupName  = get('', 'Ad Group Name',  'ad_group_name')

  const isSB = context?.hint === 'SB'

  // Derive ad_type: for SB rows, infer from campaign name prefix (SBV > SB > SP).
  // For SP rows, read from the Ad Type column or default to 'SP'.
  let adType: string
  if (isSB) {
    const prefix = campaignName.toUpperCase()
    adType = prefix.startsWith('SBV') ? 'SBV' : prefix.startsWith('SB') ? 'SB' : 'SP'
  } else {
    adType = get(null as unknown as string, 'Ad Type', 'ad_type') || 'SP'
  }

  return {
    brand_id: brandId,
    _campaign_amazon_id: get('', 'Campaign ID', 'campaign_id') || campaignName,
    _campaign_name: campaignName,
    _ad_group_amazon_id: get('', 'Ad Group ID', 'ad_group_id') || adGroupName,
    _ad_group_name: adGroupName,

    // Amazon uses "Start Date" not "Date" in this report format.
    report_date: parseDate(get('', 'Start Date', 'start_date', 'Date', 'date', 'report_date')),

    targeting:  get(null as unknown as string, 'Targeting',  'targeting')  || null,
    match_type: get(null as unknown as string, 'Match Type', 'match_type') || null,
    ad_type:    adType,

    impressions: parseInteger(get('', 'Impressions', 'impressions')),

    // Confirmed Amazon header: "Top-of-search Impression Share"
    // Normalises to:           "top_of_search_impression_share"
    top_of_search_is: parseNumeric(get('', 'Top-of-search Impression Share', 'Top of Search IS', 'top_of_search_impression_share', 'top_of_search_is')),

    clicks: parseInteger(get('', 'Clicks', 'clicks')),

    // Amazon header is "Click-Thru Rate (CTR)" — "Thru" not "Through".
    ctr: parseNumeric(get('', 'Click-Thru Rate (CTR)', 'Click-through Rate (CTR)', 'CTR', 'ctr')),
    cpc: parseNumeric(get('', 'Cost Per Click (CPC)', 'CPC', 'cpc')),

    spend: parseNumeric(get('', 'Spend', 'spend')),
    acos:  parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS)', 'ACOS', 'acos')),

    // Amazon header is "Total Return on Advertising Spend (ROAS)" — "Total" prefix present.
    roas: parseNumeric(get('', 'Total Return on Advertising Spend (ROAS)', 'Return on Advertising Spend (ROAS)', 'ROAS', 'roas')),

    // SB uses "14 Day" prefix; SP uses "7 Day". Try 14-day first.
    sales_7d:  parseNumeric(get('', '14 Day Total Sales',      '7 Day Total Sales',      'sales_7d')),
    orders_7d: parseInteger(get('', '14 Day Total Orders (#)', '7 Day Total Orders (#)', 'orders_7d')),
    units_7d:  parseInteger(get('', '14 Day Total Units (#)',  '7 Day Total Units (#)',  'units_7d')),
    cvr:       parseNumeric(get('', '14 Day Conversion Rate',  '7 Day Conversion Rate',  'cvr', 'conversion_rate')),

    // Amazon prefixes these with "7 Day" in the SP export; absent from SB Keyword export.
    advertised_sku_units: parseInteger(get('', '7 Day Advertised SKU Units (#)', 'Advertised SKU Units', 'advertised_sku_units')),
    other_sku_units:      parseInteger(get('', '7 Day Other SKU Units (#)',      'Other SKU Units',      'other_sku_units')),
    advertised_sku_sales: parseNumeric(get('', '7 Day Advertised SKU Sales',     'Advertised SKU Sales', 'advertised_sku_sales')),
    other_sku_sales:      parseNumeric(get('', '7 Day Other SKU Sales',          'Other SKU Sales',      'other_sku_sales')),

    // ── SB Keyword columns (migration 009) ───────────────────────────────────────
    viewable_impressions: parseInteger(get('', 'Viewable Impressions', 'viewable_impressions')),

    // Amazon header: "Cost per 1,000 viewable impressions (VCPM)" — comma in 1,000 is
    // stripped by parseNumeric before parsing.
    vcpm:      parseNumeric(get('', 'Cost per 1,000 viewable impressions (VCPM)', 'Cost per 1000 viewable impressions (VCPM)', 'VCPM', 'vcpm')),
    cost_type: get(null as unknown as string, 'Cost type', 'cost_type') || null,

    // 14 for SB/SBV rows; null for SP rows.
    attribution_window: isSB ? 14 : null,

    view_through_rate: parseNumeric(get('', 'View-Through Rate (VTR)',            'view_through_rate')),
    vctr:              parseNumeric(get('', 'Click-Through Rate for Views (vCTR)', 'vctr')),

    video_first_quartile_views: parseInteger(get('', 'Video First Quartile Views', 'video_first_quartile_views')),
    video_midpoint_views:       parseInteger(get('', 'Video Midpoint Views',       'video_midpoint_views')),
    video_third_quartile_views: parseInteger(get('', 'Video Third Quartile Views', 'video_third_quartile_views')),
    video_complete_views:       parseInteger(get('', 'Video Complete Views',       'video_complete_views')),
    video_unmutes:              parseInteger(get('', 'Video Unmutes',              'video_unmutes')),

    five_second_views:     parseInteger(get('', '5 Second Views',     'five_second_views')),
    five_second_view_rate: parseNumeric(get('', '5 Second View Rate', 'five_second_view_rate')),

    branded_searches_14d:  parseInteger(get('', '14 Day Branded Searches',        'branded_searches_14d')),
    detail_page_views_14d: parseInteger(get('', '14 Day Detail Page Views (DPV)', 'detail_page_views_14d')),

    ntb_orders_14d: parseInteger(get('', '14 Day New-to-brand Orders (#)',     'ntb_orders_14d')),
    ntb_orders_pct: parseNumeric(get('', '14 Day % of Orders New-to-brand',    'ntb_orders_pct')),
    ntb_sales_14d:  parseNumeric(get('', '14 Day New-to-brand Sales',          'ntb_sales_14d')),
    ntb_sales_pct:  parseNumeric(get('', '14 Day % of Sales New-to-brand',     'ntb_sales_pct')),
    ntb_units_14d:  parseInteger(get('', '14 Day New-to-brand Units (#)',       'ntb_units_14d')),
    ntb_units_pct:  parseNumeric(get('', '14 Day % of Units New-to-brand',     'ntb_units_pct')),
    ntb_order_rate: parseNumeric(get('', '14 Day New-to-brand Order Rate',     'ntb_order_rate')),

    acos_click:   parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS) - (Click)',  'acos_click')),
    roas_click:   parseNumeric(get('', 'Total Return on Advertising Spend (ROAS) - (Click)', 'roas_click')),
    sales_click:  parseNumeric(get('', '14 Day Total Sales - (Click)',                       'sales_click')),
    orders_click: parseInteger(get('', '14 Day Total Orders (#) - (Click)',                  'orders_click')),
    units_click:  parseInteger(get('', '14 Day Total Units (#) - (Click)',                   'units_click')),

    brand_dpv_click: parseInteger(get('', '14 Day Brand Total Detail Page Views (#) - (Click)', 'brand_dpv_click')),
  }
}
