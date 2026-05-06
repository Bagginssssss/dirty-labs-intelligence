import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SpSearchTermRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  _ad_group_amazon_id: string
  _ad_group_name: string
  report_date: string | null
  customer_search_term: string | null
  targeting: string | null
  match_type: string | null
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
  advertised_sku_units: number | null
  other_sku_units: number | null
  advertised_sku_sales: number | null
  other_sku_sales: number | null
  video_views: number | null
  view_through_rate: number | null
  five_second_views: number | null
  // SB-only columns added by migration 005
  viewable_impressions: number | null
  vcpm: number | null
  cost_type: string | null
  attribution_window: number | null
  acos_click: number | null
  roas_click: number | null
  sales_click: number | null
  orders_click: number | null
  units_click: number | null
}

export function mapSpSearchTerm(row: RawRow, brandId: string, context?: MapperContext): SpSearchTermRow {
  const get = makeGetter(row)

  const campaignName = get('', 'Campaign Name', 'campaign_name')
  const adGroupName  = get('', 'Ad Group Name',  'ad_group_name')

  // hint === 'SB' means the detector identified this as a Sponsored Brands file.
  const isSB = context?.hint === 'SB'

  // Derive ad_type from the Ad Type column when present; otherwise infer from context.
  // SB exports have no Ad Type column — derive from campaign name prefix (SBV > SB > SP).
  let adType: string | null = get(null as unknown as string, 'Ad Type', 'ad_type') || null
  if (!adType) {
    const prefix = campaignName.toUpperCase()
    adType = prefix.startsWith('SBV') ? 'SBV' : prefix.startsWith('SB') ? 'SB' : 'SP'
  }

  return {
    brand_id: brandId,
    _campaign_amazon_id: get('', 'Campaign ID', 'campaign_id') || campaignName,
    _campaign_name: campaignName,
    _ad_group_amazon_id: get('', 'Ad Group ID', 'ad_group_id') || adGroupName,
    _ad_group_name: adGroupName,

    report_date: parseDate(get('', 'Date', 'date', 'report_date', 'Start Date', 'start_date')),

    customer_search_term: get(null as unknown as string, 'Customer Search Term', 'customer_search_term') || null,
    targeting:  get(null as unknown as string, 'Targeting',  'targeting')  || null,
    match_type: get(null as unknown as string, 'Match Type', 'match_type') || null,
    ad_type: adType,

    impressions: parseInteger(get('', 'Impressions', 'impressions')),
    clicks:      parseInteger(get('', 'Clicks',      'clicks')),

    ctr: parseNumeric(get('', 'Click-Thru Rate (CTR)', 'Click-through Rate (CTR)', 'CTR', 'ctr')),
    cpc: parseNumeric(get('', 'Cost Per Click (CPC)', 'CPC', 'cpc')),

    spend: parseNumeric(get('', 'Spend', 'spend')),

    // SB uses 14-day attribution; SP uses 7-day. Both are stored in sales_7d / orders_7d
    // since the attribution_window column records which window applies.
    // trailing spaces on some headers are stripped by csv-parser.ts transformHeader.
    sales_7d: parseNumeric(get('', '14 Day Total Sales', '7 Day Total Sales', 'sales_7d')),
    acos:     parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS)', 'ACOS', 'acos')),
    roas:     parseNumeric(get('', 'Total Return on Advertising Spend (ROAS)', 'Return on Advertising Spend (ROAS)', 'ROAS', 'roas')),

    orders_7d: parseInteger(get('', '14 Day Total Orders (#)', '7 Day Total Orders (#)', 'orders_7d')),
    units_7d:  parseInteger(get('', '14 Day Total Units (#)',  '7 Day Total Units (#)',  'units_7d')),
    cvr:       parseNumeric(get('', '14 Day Conversion Rate',  '7 Day Conversion Rate',  'cvr', 'conversion_rate')),

    // SP-only SKU breakdown columns — null for SB rows.
    advertised_sku_units: parseInteger(get('', '7 Day Advertised SKU Units (#)', 'Advertised SKU Units', 'advertised_sku_units')),
    other_sku_units:      parseInteger(get('', '7 Day Other SKU Units (#)',      'Other SKU Units',      'other_sku_units')),
    advertised_sku_sales: parseNumeric(get('', '7 Day Advertised SKU Sales',     'Advertised SKU Sales', 'advertised_sku_sales')),
    other_sku_sales:      parseNumeric(get('', '7 Day Other SKU Sales',          'Other SKU Sales',      'other_sku_sales')),

    video_views:       parseInteger(get('', 'Video Views', 'video_views')),
    view_through_rate: parseNumeric(get('', 'Video 5-Second View Rate', 'view_through_rate', 'video_5_second_view_rate')),
    five_second_views: parseInteger(get('', '5 Second Views', 'five_second_views')),

    // ── SB-only columns ───────────────────────────────────────────────────────
    viewable_impressions: parseInteger(get('', 'Viewable Impressions', 'viewable_impressions')),

    // Amazon header: "Cost per 1,000 viewable impressions (VCPM)" — comma in 1,000 is
    // stripped by parseNumeric before parsing.
    vcpm: parseNumeric(get('', 'Cost per 1,000 viewable impressions (VCPM)', 'Cost per 1000 viewable impressions (VCPM)', 'VCPM', 'vcpm')),

    cost_type: get(null as unknown as string, 'Cost type', 'cost_type') || null,

    // 14 for SB rows; null for SP rows (7-day window is implied by column names).
    attribution_window: isSB ? 14 : null,

    acos_click:   parseNumeric(get('', 'Total Advertising Cost of Sales (ACOS) - (Click)',  'acos_click')),
    roas_click:   parseNumeric(get('', 'Total Return on Advertising Spend (ROAS) - (Click)', 'roas_click')),
    sales_click:  parseNumeric(get('', '14 Day Total Sales - (Click)',   'sales_click')),
    orders_click: parseInteger(get('', '14 Day Total Orders (#) - (Click)', 'orders_click')),
    units_click:  parseInteger(get('', '14 Day Total Units (#) - (Click)',  'units_click')),
  }
}
