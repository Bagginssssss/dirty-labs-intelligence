import type { MappedRow, RawRow } from './types'
import { makeGetter } from './types'

// Scale Insights import/negative/revive rule change logs (INB-148). One shared
// header across the three exports; log_type is derived from the Action column
// (the same value the detector gates on). Rows whose Action is anything else
// (e.g. 'Bidding Rule') map to log_type null and are dropped by REQUIRED_NOT_NULL
// in the ingest route — they belong in scale_insights_bid_log, not here.
export interface ScaleInsightsRuleChangeLogRow extends MappedRow {
  created_date: string | null
  log_type: 'import' | 'negative' | 'revive' | null
  asin: string | null
  sku: string | null
  short_name: string | null
  campaign: string
  ad_group: string
  keyword_or_target: string
  rule_name: string
  criteria: string | null
  change_value: string
  code: string | null
  details: string | null
}

// INB-172 (global-by-necessity, keyed on the Action column value): the three exports (import/negative/
// revive) share this one table + mapper. SAFE — the map IS the discriminator; each Action value uniquely
// and consistently determines log_type, each file carries only its own Action, and unmatched actions →
// null → dropped by REQUIRED_NOT_NULL. No sibling report assigns a different meaning to the same key.
const LOG_TYPE_BY_ACTION: Record<string, 'import' | 'negative' | 'revive'> = {
  'import rule': 'import',
  'negative rule': 'negative',
  'revive rule': 'revive',
}

export function mapScaleInsightsRuleChangeLog(
  row: RawRow,
  brandId: string,
): ScaleInsightsRuleChangeLogRow {
  const get = makeGetter(row)

  // Created is a bare date (YYYY-MM-DD, no time) — keep as-is when well-formed.
  const createdRaw = get('', 'Created', 'created').trim()
  const created_date = /^\d{4}-\d{2}-\d{2}$/.test(createdRaw) ? createdRaw : null

  const action = get('', 'Action', 'action').trim().toLowerCase()
  const log_type = LOG_TYPE_BY_ACTION[action] ?? null

  // Non-key text columns: empty → null. Key text columns (campaign, ad_group,
  // keyword_or_target, rule_name, change_value): empty → '' to match the
  // NOT NULL DEFAULT '' dedup-key columns (empty strings must compare equal).
  const orNull = (v: string) => (v.trim() ? v : null)

  return {
    brand_id: brandId,
    created_date,
    log_type,
    asin:       orNull(get('', 'ASIN', 'asin')),
    sku:        orNull(get('', 'SKU', 'sku')),
    short_name: orNull(get('', 'ShortName', 'Short Name', 'short_name')),
    campaign:          get('', 'Campaign', 'campaign'),
    ad_group:          get('', 'AdGroup', 'Ad Group', 'ad_group'),
    keyword_or_target: get('', 'Keyword', 'keyword', 'Target', 'target'),
    rule_name:         get('', 'Rule', 'rule_name', 'rule'),
    criteria:     orNull(get('', 'Criteria', 'criteria')),
    change_value:      get('', 'Change', 'change'),
    code:         orNull(get('', 'Code', 'code')),
    details:      orNull(get('', 'Details', 'details')),
  }
}
