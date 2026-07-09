// INB-148 — ScaleInsights rule change-log + assignment ingestion.
//
// Two new tables feed the rule-audit layer. Detection is CONTENT-based: the
// three change-log exports share a byte-identical header with the existing
// BiddingRule_ChangeLogs (which routes to scale_insights_bid_log), so the ONLY
// separator is the Action column value. These tests pin:
//   - detection: shared header + Action∈{Import,Negative,Revive} → rule_change_log;
//     Bidding Rule / headers-only → bid_log (existing behavior preserved)
//   - detection: Assigned / Unassigned headers → rule_assignments (was 'unknown')
//   - splitRuleCell: the comma-in-rule-name split, lossless-reconstruction
//   - mappers: log_type derivation, ''-normalization, is_assigned content-derived,
//     Unassigned arrays null, snapshot_date fallback
//   - e2e: a change-log upload upserts into scale_insights_rule_change_log with
//     the exact natural-key onConflict, counters balance
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { detectReportType } from '../lib/report-detector.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// ---------------------------------------------------------------------------
// Shared header/sample fixtures (verified against the real sample files)
// ---------------------------------------------------------------------------

// BOM on the first column, per the real exports.
const CHANGE_LOG_HEADERS = [
  '﻿Created', 'ASIN', 'SKU', 'ShortName', 'Campaign', 'AdGroup', 'Keyword',
  'Action', 'Rule', 'Criteria', 'Change', 'Code', 'Details',
]
function changeLogSample(action: string): Record<string, string> {
  return {
    Created: '2026-07-09', ASIN: 'B09MSP7M5Y', SKU: '112101-FBA', ShortName: '',
    Campaign: 'SP.CO.PT - Booster', AdGroup: 'SP.CO.PT - Booster',
    Keyword: 'B0FZXTWWYK', Action: action, Rule: '[Ad Group] No Sales',
    Criteria: 'No Sales', Change: '', Code: '', Details: '',
  }
}

const ASSIGNED_HEADERS = [
  'Sponsored', 'Associated ASIN', 'SKU', 'Short Name', 'Portfolio', 'Campaign',
  'AdGroup', 'Custom Group', 'Strategy', 'Bidding Rules', 'Import Rules',
  'Negative Rules', 'Negative Word Rules', 'Blacklist Rules', 'Revive Rules',
  'Status Rules', 'Default Bid Rules', 'Day Parting Rules', 'Placement Rules',
  'Daily Budget Rules', 'Last 30 Days Ad Spend',
]
const UNASSIGNED_HEADERS = [
  'Sponsored', 'Portfolio', 'Campaign', 'AdGroup', 'Associated ASIN', 'SKU',
  'ShortName', 'Last 30 Days Ad Spend',
]

// ---------------------------------------------------------------------------
// Detection (content-based) — RED: sampleRow ignored today → bid_log / unknown
// ---------------------------------------------------------------------------

test('detection: change-log header + Import Rule row → scale_insights_rule_change_log', () => {
  const d = detectReportType(CHANGE_LOG_HEADERS, changeLogSample('Import Rule'))
  assert.equal(d.reportType, 'scale_insights_rule_change_log')
  assert.equal(d.tableName, 'scale_insights_rule_change_log')
})

test('detection: Negative Rule and Revive Rule rows also → rule_change_log', () => {
  assert.equal(detectReportType(CHANGE_LOG_HEADERS, changeLogSample('Negative Rule')).reportType, 'scale_insights_rule_change_log')
  assert.equal(detectReportType(CHANGE_LOG_HEADERS, changeLogSample('Revive Rule')).reportType, 'scale_insights_rule_change_log')
})

test('detection: Assigned headers → scale_insights_rule_assignments', () => {
  const d = detectReportType(ASSIGNED_HEADERS)
  assert.equal(d.reportType, 'scale_insights_rule_assignments')
  assert.equal(d.tableName, 'scale_insights_rule_assignments')
})

test('detection: Unassigned headers → scale_insights_rule_assignments', () => {
  assert.equal(detectReportType(UNASSIGNED_HEADERS).reportType, 'scale_insights_rule_assignments')
})

// Companions — MUST stay green both before and after (existing behavior).
test('companion: same header with a Bidding Rule row → scale_insights_bid_log', () => {
  assert.equal(detectReportType(CHANGE_LOG_HEADERS, changeLogSample('Bidding Rule')).reportType, 'scale_insights_bid_log')
})

test('companion: headers-only (no sample row) → scale_insights_bid_log', () => {
  assert.equal(detectReportType(CHANGE_LOG_HEADERS).reportType, 'scale_insights_bid_log')
})

// ---------------------------------------------------------------------------
// splitRuleCell — the comma-in-rule-name split heuristic
// ---------------------------------------------------------------------------

test('splitRuleCell: bracketed strategy names split on ", ["', async () => {
  const { splitRuleCell } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  assert.deepEqual(splitRuleCell('[Strategy] A, [Strategy] B'), ['[Strategy] A', '[Strategy] B'])
})

test('splitRuleCell: plain names split before a capital ("Keywords, Revive")', async () => {
  const { splitRuleCell } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  assert.deepEqual(splitRuleCell('Revive Good Keywords, Revive Keywords'), ['Revive Good Keywords', 'Revive Keywords'])
})

test('splitRuleCell: internal ", <lowercase/digit>" is kept together (one rule)', async () => {
  const { splitRuleCell } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  const one = 'Target ACOS 40% - 2nd-highest clicks, 2nd-fastest adjustments - 7d LB'
  assert.deepEqual(splitRuleCell(one), [one])
})

test('splitRuleCell: empty cell → empty array; join reconstruction is lossless', async () => {
  const { splitRuleCell } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  assert.deepEqual(splitRuleCell(''), [])
  const raw = '[Strategy] X, [Strategy] Y - a, b, [Strategy] Z'
  assert.equal(splitRuleCell(raw).join(', '), raw)
})

// ---------------------------------------------------------------------------
// Change-log mapper
// ---------------------------------------------------------------------------

test('change-log mapper: log_type from Action, key cols empty-normalized, empties null', async () => {
  const { mapScaleInsightsRuleChangeLog } = await import('../lib/mappers/scale-insights-rule-change-log.ts')
  const row = mapScaleInsightsRuleChangeLog(changeLogSample('Negative Rule'), BRAND) as Record<string, unknown>
  assert.equal(row.log_type, 'negative')
  assert.equal(row.created_date, '2026-07-09')
  assert.equal(row.keyword_or_target, 'B0FZXTWWYK')
  assert.equal(row.rule_name, '[Ad Group] No Sales')
  assert.equal(row.criteria, 'No Sales')
  assert.equal(row.change_value, '')   // key col, ''-normalized (never null)
  assert.equal(row.code, null)          // non-key empty → null
  assert.equal(row.short_name, null)
})

test('change-log mapper: unknown Action → log_type null → rejected by REQUIRED_NOT_NULL', async () => {
  const { mapScaleInsightsRuleChangeLog } = await import('../lib/mappers/scale-insights-rule-change-log.ts')
  const { partitionRequiredNotNull } = await import('../lib/ingest-validation.ts')
  const bad = mapScaleInsightsRuleChangeLog(changeLogSample('Bidding Rule'), BRAND) as Record<string, unknown>
  assert.equal(bad.log_type, null)
  const { kept, rejected } = partitionRequiredNotNull([bad], 'scale_insights_rule_change_log')
  assert.equal(kept.length, 0)
  assert.equal(rejected.length, 1)
})

// ---------------------------------------------------------------------------
// Assignments mapper
// ---------------------------------------------------------------------------

function assignedRow(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    Sponsored: 'Products', 'Associated ASIN': '', SKU: '', 'Short Name': '',
    Portfolio: 'Dish', Campaign: 'SP.BR.KT - Dish', AdGroup: 'SP.BR.KT - Dish',
    'Custom Group': 'Dish Pool', Strategy: 'BR KW v2',
    'Bidding Rules': '', 'Import Rules': '', 'Negative Rules': '',
    'Negative Word Rules': '', 'Blacklist Rules': '', 'Revive Rules': '',
    'Status Rules': '', 'Default Bid Rules': '', 'Day Parting Rules': '',
    'Placement Rules': '', 'Daily Budget Rules': '', 'Last 30 Days Ad Spend': '61.17',
  }
  return { ...base, ...overrides }
}

test('assignments mapper: Assigned row with rules → is_assigned true, arrays parsed, rules_raw kept', async () => {
  const { mapScaleInsightsRuleAssignments } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  const bidding = '[Strategy] Boost Impressions 30d LB, [Strategy] BRANDED - Target ACOS 18% - 2nd-highest clicks, 2nd-fastest adjustments - 7d LB'
  const row = mapScaleInsightsRuleAssignments(
    assignedRow({ 'Bidding Rules': bidding, 'Revive Rules': 'Revive Good Keywords, Revive Keywords' }),
    BRAND,
    { date_range_start: '2026-07-09' },
  ) as Record<string, unknown>
  assert.equal(row.is_assigned, true)
  assert.equal(row.sponsored_type, 'Products')
  assert.equal(row.snapshot_date, '2026-07-09')
  assert.equal(row.last_30d_spend, 61.17)
  assert.deepEqual(row.bidding_rules, [
    '[Strategy] Boost Impressions 30d LB',
    '[Strategy] BRANDED - Target ACOS 18% - 2nd-highest clicks, 2nd-fastest adjustments - 7d LB',
  ])
  assert.deepEqual(row.revive_rules, ['Revive Good Keywords', 'Revive Keywords'])
  assert.equal(row.import_rules, null)   // empty cell → null array
  // rules_raw reconstruction: join(', ') of the parsed array === raw cell
  const rulesRaw = row.rules_raw as Record<string, string>
  assert.equal((row.bidding_rules as string[]).join(', '), rulesRaw.bidding_rules)
})

test('assignments mapper: all-empty Assigned row → is_assigned false', async () => {
  const { mapScaleInsightsRuleAssignments } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  const row = mapScaleInsightsRuleAssignments(assignedRow(), BRAND, { date_range_start: '2026-07-09' }) as Record<string, unknown>
  assert.equal(row.is_assigned, false)
})

test('assignments mapper: Unassigned row → is_assigned false, arrays + rules_raw null', async () => {
  const { mapScaleInsightsRuleAssignments } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  const row = mapScaleInsightsRuleAssignments(
    { Sponsored: 'Products', Portfolio: 'Booster', Campaign: 'SP.CO.PT - Booster - OxiClean',
      AdGroup: 'SP.CO.PT - Booster - OxiClean', 'Associated ASIN': '', SKU: '', ShortName: '',
      'Last 30 Days Ad Spend': '61.17' },
    BRAND,
    { date_range_start: '2026-07-09' },
  ) as Record<string, unknown>
  assert.equal(row.is_assigned, false)
  assert.equal(row.bidding_rules, null)
  assert.equal(row.rules_raw, null)
  assert.equal(row.snapshot_date, '2026-07-09')
})

test('assignments mapper: no form date → snapshot_date falls back to a valid date', async () => {
  const { mapScaleInsightsRuleAssignments } = await import('../lib/mappers/scale-insights-rule-assignments.ts')
  const row = mapScaleInsightsRuleAssignments(assignedRow(), BRAND, {}) as Record<string, unknown>
  assert.match(String(row.snapshot_date), /^\d{4}-\d{2}-\d{2}$/)
})

// ---------------------------------------------------------------------------
// e2e: change-log upload upserts into the right table with the natural key
// ---------------------------------------------------------------------------

const changeLogPosts: { onConflict: string | null; count: number }[] = []

const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET') {
    // maybeSingle campaign lookups (only hit on the RED mis-detection path).
    if (wantsObject) return respond(406, { code: 'PGRST116', message: 'zero rows' })
    return respond(200, [])
  }
  // POST/PATCH: capture change-log writes; accept everything else.
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/scale_insights_rule_change_log')) {
      let body: unknown = []
      try { body = JSON.parse(raw) } catch { /* ignore */ }
      changeLogPosts.push({
        onConflict: url.searchParams.get('on_conflict'),
        count: Array.isArray(body) ? body.length : 1,
      })
    }
    if (wantsObject) return respond(201, { id: '00000000-0000-4000-8000-000000000001' })
    return respond(201, [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())

const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

// Two unique change-log rows (Criteria carries commas inside quotes — real CSV).
const CHANGE_LOG_CSV = [
  '﻿Created,ASIN,SKU,ShortName,Campaign,AdGroup,Keyword,Action,Rule,Criteria,Change,Code,Details',
  '2026-07-09,B09B83NFKQ,110146-FBA,,SP.BR.KT - Catch All,Performance Broad,dirty labs detergent,Import Rule,Import Branded Discovery to Exact,">=1 Order, >=10 Clicks, <=55% ACOS",exact (1.45),,',
  '2026-07-09,B09B83NFKQ,110146-FBA,,SP.BR.KT - Catch All,Performance Exact,dirty labs soap,Import Rule,Import Branded Discovery to Exact,">=1 Order, >=10 Clicks, <=55% ACOS",exact (1.50),,',
].join('\n')

test('e2e: change-log CSV upserts into scale_insights_rule_change_log with the natural-key onConflict', async () => {
  changeLogPosts.length = 0
  const body = new FormData()
  body.append('file', new File([CHANGE_LOG_CSV], 'ImportRule_ChangeLogs.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  const json = await res.json() as Record<string, unknown>

  assert.equal(json.table, 'scale_insights_rule_change_log', 'routed to the change-log table')
  assert.equal(json.rows_stored, 2)
  assert.ok(changeLogPosts.length >= 1, 'at least one upsert POST to the change-log table')
  assert.equal(
    changeLogPosts[0].onConflict,
    'brand_id,created_date,log_type,campaign,ad_group,keyword_or_target,rule_name,change_value',
    'upsert targets the natural-key unique constraint',
  )
  // Identity: stored = mapped − deduplicated − rejected.
  assert.equal(
    json.rows_stored,
    (json.rows_mapped as number) - (json.rows_deduplicated as number) - (json.rows_rejected as number),
  )
})
