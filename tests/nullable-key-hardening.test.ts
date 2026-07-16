// INB-151 — the six latent nullable-key tables are hardened (NOT NULL DEFAULT '') and the
// INB-149 allowlist is EMPTY, so the checker enforces the defect class account-wide. These pins:
//   (a) the allowlist is {} (RED while any entry remains);
//   (b) the checker still flags a nullable key column under the empty allowlist;
//   (c) the six hardened constraints (no nullable key columns) pass;
//   (d) each affected mapper emits '' (never null) for its key column(s) — behaviour otherwise
//       unchanged (dedup already coerced null→'' in its key string).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NULLABLE_KEY_ALLOWLIST } from '../lib/upsert-config.ts'
import { findNullableUniqueKeyColumns } from '../lib/upsert-constraint-check.ts'
import { mapSpTargeting } from '../lib/mappers/sp-targeting.ts'
import { mapSpSearchTerm } from '../lib/mappers/sp-search-term.ts'
import { mapScaleInsightsKeywordRank } from '../lib/mappers/scale-insights-keyword-rank.ts'
import { mapSubscribeAndSave } from '../lib/mappers/subscribe-and-save.ts'
import { mapSmartscoutSubcategoryBrands } from '../lib/mappers/smartscout-subcategory-brands.ts'
import { mapSpCampaignPerformance } from '../lib/mappers/sp-campaign-performance.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// ── the point of the ticket ──────────────────────────────────────────────────
test('NULLABLE_KEY_ALLOWLIST is empty — nullable-key defect class enforced account-wide', () => {
  assert.deepEqual(NULLABLE_KEY_ALLOWLIST, {})
})

test('checker still flags a nullable key column under the empty allowlist', () => {
  const v = findNullableUniqueKeyColumns(
    [{ table_name: 'x', index_name: 'uq_x', columns: ['brand_id', 'sku'], nullable_columns: ['sku'] }],
    {},
  )
  assert.equal(v.length, 1)
  assert.equal(v[0].table, 'x')
})

test('checker: the six hardened constraints (no nullable key columns) → zero violations', () => {
  const hardened = [
    { table_name: 'sp_targeting_report', index_name: 'uq_sp_targeting_report', columns: ['brand_id', 'campaign_id', 'ad_group_id', 'report_date', 'targeting', 'match_type'], nullable_columns: [] },
    { table_name: 'sp_campaign_performance', index_name: 'uq_campaign_performance', columns: ['brand_id', 'campaign_id', 'report_date', 'ad_type'], nullable_columns: [] },
    { table_name: 'sp_search_term_report', index_name: 'uq_sp_search_term_report', columns: ['brand_id', 'campaign_id', 'ad_group_id', 'report_date', 'customer_search_term', 'targeting'], nullable_columns: [] },
    { table_name: 'scale_insights_keyword_rank', index_name: 'uq_keyword_rank', columns: ['brand_id', 'asin_id', 'keyword', 'report_date'], nullable_columns: [] },
    { table_name: 'smartscout_subcategory_brands', index_name: 'uq_sscb', columns: ['brand_id', 'brand_name', 'subcategory', 'snapshot_date'], nullable_columns: [] },
    { table_name: 'subscribe_and_save', index_name: 'uq_subscribe_and_save', columns: ['brand_id', 'asin_id', 'sku', 'report_date'], nullable_columns: [] },
  ]
  assert.deepEqual(findNullableUniqueKeyColumns(hardened, {}), [])
})

// ── per-family mapper pins (key columns emit '' when absent; values pass through) ──
test('sp-targeting: targeting/match_type → "" when absent; values pass through', () => {
  const absent = mapSpTargeting({ 'Campaign Name': 'SP.X', 'Ad Group Name': 'AG', 'Start Date': '2026-07-01' }, BRAND)
  assert.equal(absent.targeting, '')
  assert.equal(absent.match_type, '')
  const present = mapSpTargeting({ 'Campaign Name': 'SP.X', 'Ad Group Name': 'AG', 'Start Date': '2026-07-01', 'Targeting': 'dirty labs', 'Match Type': 'BROAD' }, BRAND)
  assert.equal(present.targeting, 'dirty labs')
  assert.equal(present.match_type, 'BROAD')
})

test('sp-search-term: customer_search_term/targeting → "" when absent', () => {
  const r = mapSpSearchTerm({ 'Campaign Name': 'SP.X', 'Ad Group Name': 'AG', 'Date': '2026-07-01' }, BRAND)
  assert.equal(r.customer_search_term, '')
  assert.equal(r.targeting, '')
})

test('keyword-rank: keyword → "" when absent; value passes through', () => {
  const rows = mapScaleInsightsKeywordRank({ 'ASIN': 'B09B7YS1VK', '2026-07-11': '5' }, BRAND)
  assert.ok(rows.length >= 1)
  assert.equal(rows[0].keyword, '')
  const present = mapScaleInsightsKeywordRank({ 'ASIN': 'B09B7YS1VK', 'Keyword': 'detergent', '2026-07-11': '5' }, BRAND)
  assert.equal(present[0].keyword, 'detergent')
})

test('subscribe-and-save: sku → "" when absent', () => {
  const r = mapSubscribeAndSave({ 'ASIN': 'B09B7YS1VK', 'Reporting Period Start': '2026-07-01' }, BRAND)
  assert.equal(r.sku, '')
})

test('smartscout brands: subcategory → "" when no form subcategory (constraint safety)', () => {
  const r = mapSmartscoutSubcategoryBrands({ 'Brand': 'Tide' }, BRAND, {})
  assert.equal(r[0].subcategory, '')
})

test('sp-campaign: ad_type is always a non-null string (defaults SP)', () => {
  const r = mapSpCampaignPerformance({ 'Campaign Name': 'SP.X', 'Start Date': '2026-07-01' }, BRAND)
  assert.equal(typeof r.ad_type, 'string')
  assert.equal(r.ad_type, 'SP')
})
