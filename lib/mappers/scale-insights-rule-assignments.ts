import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, norm, parseNumeric } from './types'

// Scale Insights AssignedRules / UnassignedRules snapshot exports (INB-148).
// Account-wide rule assignments per ad group. Both files upsert into one table;
// is_assigned is CONTENT-derived (any rule list non-empty), not file-of-origin —
// Unassigned is an exact subset of Assigned (all-rule-columns-empty twins), so
// the two files commute under the (snapshot_date, campaign, ad_group) key.

// Source header → DB array column. Eleven rule-list columns (the ticket said ten
// but the real Assigned export carries eleven).
const RULE_COLUMNS: Array<[header: string, column: string]> = [
  ['Bidding Rules', 'bidding_rules'],
  ['Import Rules', 'import_rules'],
  ['Negative Rules', 'negative_rules'],
  ['Negative Word Rules', 'negative_word_rules'],
  ['Blacklist Rules', 'blacklist_rules'],
  ['Revive Rules', 'revive_rules'],
  ['Status Rules', 'status_rules'],
  ['Default Bid Rules', 'default_bid_rules'],
  ['Day Parting Rules', 'day_parting_rules'],
  ['Placement Rules', 'placement_rules'],
  ['Daily Budget Rules', 'daily_budget_rules'],
]

// Splits a rule-list cell into individual rule names. Rule names themselves
// contain ", " (e.g. "…2nd-highest clicks, 2nd-fastest adjustments…"), so a
// naive comma split is wrong. Rule boundaries are ", " followed by "[" (bracket
// tag like [Strategy]) or an uppercase letter (a new capitalized rule name);
// an internal ", " is always followed by a lowercase letter or digit.
// Verified lossless (join(', ') reconstructs the cell) across the real Assigned
// file: 15,604 rules from 1,666 cells, zero reconstruction mismatches.
export function splitRuleCell(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  return trimmed.split(/, (?=[[A-Z])/)
}

export interface ScaleInsightsRuleAssignmentsRow extends MappedRow {
  snapshot_date: string
  sponsored_type: string
  portfolio: string | null
  campaign: string
  ad_group: string
  custom_group: string | null
  strategy: string | null
  is_assigned: boolean
  rules_raw: Record<string, string> | null
  last_30d_spend: number | null
  [column: string]: unknown   // the eleven text[] rule columns
}

export function mapScaleInsightsRuleAssignments(
  row: RawRow,
  brandId: string,
  context?: MapperContext,
): ScaleInsightsRuleAssignmentsRow {
  const get = makeGetter(row)
  const hasCol = (header: string) => Object.keys(row).some(k => norm(k) === norm(header))
  const orNull = (v: string) => (v.trim() ? v : null)

  const snapshot_date =
    (context?.date_range_start && context.date_range_start.trim()) ||
    new Date().toISOString().split('T')[0]

  // The Unassigned export has no rule columns at all — detect by the presence of
  // the Bidding Rules column (same discriminator the detector uses).
  const isAssignedFile = hasCol('Bidding Rules')

  const arrays: Record<string, string[] | null> = {}
  let rules_raw: Record<string, string> | null = null
  let anyRules = false

  if (isAssignedFile) {
    rules_raw = {}
    for (const [header, column] of RULE_COLUMNS) {
      const rawCell = get('', header)
      rules_raw[column] = rawCell
      const arr = rawCell.trim() ? splitRuleCell(rawCell) : null
      arrays[column] = arr
      if (arr) anyRules = true
    }
  } else {
    for (const [, column] of RULE_COLUMNS) arrays[column] = null
  }

  return {
    brand_id: brandId,
    snapshot_date,
    sponsored_type: get('', 'Sponsored', 'sponsored'),
    portfolio:  orNull(get('', 'Portfolio', 'portfolio')),
    campaign:          get('', 'Campaign', 'campaign'),
    ad_group:          get('', 'AdGroup', 'Ad Group', 'ad_group'),
    custom_group: orNull(get('', 'Custom Group', 'custom_group')),
    strategy:     orNull(get('', 'Strategy', 'strategy')),
    is_assigned: anyRules,
    ...arrays,
    rules_raw,
    last_30d_spend: parseNumeric(get('', 'Last 30 Days Ad Spend', 'last_30d_spend')),
  }
}
