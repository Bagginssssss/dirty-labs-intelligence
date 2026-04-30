import { MappedRow, RawRow, makeGetter, parseNumeric } from './types'

export interface ScaleInsightsBidLogRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  _ad_group_amazon_id: string
  _ad_group_name: string
  change_timestamp: string | null
  target: string | null
  match_type: string | null
  bid_before: number | null
  bid_after: number | null
  rule_name: string | null
  rule_trigger: string | null
  change_reason: string | null
  // Added by migration 016
  asin_text: string | null
  sku: string | null
  short_name: string | null
  code: string | null
  details: string | null
  criteria: string | null
}

export function mapScaleInsightsBidLog(row: RawRow, brandId: string): ScaleInsightsBidLogRow {
  const get = makeGetter(row)

  // "Created" column is YYYY-MM-DD — store as midnight UTC ISO timestamp.
  const createdRaw = get('', 'Created', 'created', 'Timestamp', 'timestamp', 'change_timestamp').trim()
  let change_timestamp: string | null = null
  if (createdRaw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(createdRaw)) {
      change_timestamp = `${createdRaw}T00:00:00.000Z`
    } else {
      const d = new Date(createdRaw)
      change_timestamp = isNaN(d.getTime()) ? null : d.toISOString()
    }
  }

  // "Change" column encodes both bids as "0.50 -> 0.75".
  const changeRaw = get('', 'Change', 'change')
  const changeParts = changeRaw.split(' -> ')
  const bid_before = changeParts.length >= 2
    ? parseNumeric(changeParts[0].trim())
    : parseNumeric(get('', 'Bid Before', 'bid_before', 'old_bid'))
  const bid_after = changeParts.length >= 2
    ? parseNumeric(changeParts[1].trim())
    : parseNumeric(get('', 'Bid After', 'bid_after', 'new_bid'))

  const campaignName = get('', 'Campaign', 'Campaign Name', 'campaign_name')
  const adGroupName  = get('', 'AdGroup',  'Ad Group Name', 'ad_group_name')
  const criteriaVal  = get(null as unknown as string, 'Criteria', 'criteria') || null

  return {
    brand_id: brandId,
    // No Campaign ID / Ad Group ID columns — use name as natural key.
    _campaign_amazon_id: get('', 'Campaign ID', 'campaign_id') || campaignName,
    _campaign_name: campaignName,
    _ad_group_amazon_id: get('', 'Ad Group ID', 'ad_group_id') || adGroupName,
    _ad_group_name: adGroupName,

    change_timestamp,

    target:      get(null as unknown as string, 'Keyword', 'keyword', 'Target', 'target') || null,
    match_type:  null,  // not present in Scale Insights bid log export

    bid_before,
    bid_after,

    rule_name:     get(null as unknown as string, 'Rule',     'rule_name')     || null,
    rule_trigger:  criteriaVal,
    change_reason: get(null as unknown as string, 'Action',   'change_reason') || null,

    // Raw ASIN string — not FK-resolved (bid changes are at keyword level, not ASIN level).
    asin_text:  get(null as unknown as string, 'ASIN',       'asin_text')  || null,
    sku:        get(null as unknown as string, 'SKU',        'sku')        || null,
    short_name: get(null as unknown as string, 'Short Name', 'short_name') || null,
    code:       get(null as unknown as string, 'Code',       'code')       || null,
    details:    get(null as unknown as string, 'Details',    'details')    || null,
    criteria:   criteriaVal,
  }
}
