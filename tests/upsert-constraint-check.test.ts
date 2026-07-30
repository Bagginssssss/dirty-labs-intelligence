// INB-88 — detect upsert-config vs DB-unique-constraint mismatches.
//
// During INB-82, three tables had conflict keys configured in code but no matching
// UNIQUE constraint in the DB, so ON CONFLICT caught nothing and rolling re-pulls
// silently duplicated rows (purchased_product_report reached 1,031 dupes). These
// tests pin the pure detector: the State C fixture below reproduces exactly that
// pre-030 condition and MUST be flagged.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// State C (pre-migration-030): purchased_product_report exists but has ONLY the
// id primary key — the configured conflict key has no backing UNIQUE constraint.
const STATE_C_CONFIG = {
  purchased_product_report: 'brand_id,campaign_id,report_date,advertised_asin,purchased_asin',
}
const STATE_C_INDEXES = [
  { table_name: 'purchased_product_report', index_name: 'purchased_product_report_pkey', columns: ['id'] },
]

// Mirror of the CURRENT live DB's natural-key UNIQUE constraints (verified via
// pg_index/pg_constraint introspection, post-030 + migration 020s; see INB-88
// audit). If you add a table to the upsert config, add its constraint here too —
// this test failing is the loud signal that the migration must ship the constraint.
const CURRENT_DB_INDEXES = [
  { table_name: 'scale_insights_keyword_rank', index_name: 'uq_keyword_rank', columns: ['brand_id', 'asin_id', 'keyword', 'report_date'] },
  { table_name: 'scale_insights_bid_log', index_name: 'uq_bid_log', columns: ['brand_id', 'campaign_id', 'ad_group_id', 'change_timestamp', 'target', 'rule_name', 'change_value'] },
  { table_name: 'business_report', index_name: 'uq_business_report', columns: ['brand_id', 'asin_id', 'report_date'] },
  { table_name: 'business_report_daily', index_name: 'uq_business_report_daily', columns: ['brand_id', 'report_date'] },
  { table_name: 'sp_campaign_performance', index_name: 'uq_campaign_performance', columns: ['brand_id', 'campaign_id', 'report_date', 'ad_type'] },
  { table_name: 'sp_search_term_report', index_name: 'uq_sp_search_term_report', columns: ['brand_id', 'campaign_id', 'ad_group_id', 'report_date', 'customer_search_term', 'targeting'] },
  { table_name: 'sp_targeting_report', index_name: 'uq_sp_targeting_report', columns: ['brand_id', 'campaign_id', 'ad_group_id', 'report_date', 'targeting', 'match_type'] },
  { table_name: 'purchased_product_report', index_name: 'uq_purchased_product_report', columns: ['brand_id', 'campaign_id', 'report_date', 'ad_type', 'advertised_asin', 'purchased_asin', 'attribution_type'] },
  { table_name: 'derived_metrics_daily', index_name: 'uq_derived_metrics_daily', columns: ['brand_id', 'metric_date'] },
  { table_name: 'derived_metrics_weekly', index_name: 'uq_derived_metrics_weekly', columns: ['brand_id', 'week_start'] },
  { table_name: 'subscribe_and_save', index_name: 'uq_subscribe_and_save', columns: ['brand_id', 'asin_id', 'sku', 'report_date'] },
  { table_name: 'search_query_performance', index_name: 'uq_search_query_performance', columns: ['brand_id', 'search_query', 'report_date'] },
  { table_name: 'smartscout_subcategory_products', index_name: 'uq_smartscout_products', columns: ['brand_id', 'parent_asin', 'subcategory', 'snapshot_date'] },
  { table_name: 'smartscout_subcategory_brands', index_name: 'uq_sscb', columns: ['brand_id', 'brand_name', 'subcategory', 'snapshot_date'] },
  { table_name: 'virtual_bundle_sales', index_name: 'uq_virtual_bundle_sales', columns: ['brand_id', 'bundle_asin', 'sale_date'] },
  { table_name: 'virtual_bundle_sales_daily', index_name: 'uq_vbsd', columns: ['brand_id', 'bundle_asin', 'sale_date'] },
  { table_name: 'virtual_bundle_sales_snapshots', index_name: 'uq_vbss', columns: ['brand_id', 'bundle_asin', 'snapshot_date'] },
  { table_name: 'brand_analytics_customer_loyalty', index_name: 'brand_analytics_customer_loya_brand_id_period_end_date_gran_key', columns: ['brand_id', 'period_end_date', 'granularity'] },
  { table_name: 'platform_knowledge', index_name: 'uq_platform_knowledge', columns: ['brand_id', 'category', 'key'] },
  { table_name: 'scale_insights_rule_change_log', index_name: 'scale_insights_rule_change_log_natural_key', columns: ['brand_id', 'created_date', 'log_type', 'campaign', 'ad_group', 'keyword_or_target', 'rule_name', 'change_value'] },
  { table_name: 'scale_insights_rule_assignments', index_name: 'scale_insights_rule_assignments_natural_key', columns: ['brand_id', 'snapshot_date', 'campaign', 'ad_group'] },
  { table_name: 'report_coverage', index_name: 'uq_report_coverage', columns: ['report_key', 'period_start'] },
  { table_name: 'sns_dashboard_daily', index_name: 'uq_sns_dashboard_daily', columns: ['brand_id', 'metric_date', 'metric'] },
  { table_name: 'sns_dashboard_snapshots', index_name: 'uq_sns_dashboard_snapshots', columns: ['brand_id', 'snapshot_date', 'report', 'dim1', 'dim2'] },
  { table_name: 'brand_analytics_repeat_purchase', index_name: 'uq_brand_analytics_repeat_purchase', columns: ['brand_id', 'reporting_date', 'level', 'asin'] },
  // INB-162 — SKU Economics weekly parent (migration 050). The child sku_economics_fees is written
  // by delete-and-reinsert, not upsert, so it is intentionally absent from the upsert config and this check.
  { table_name: 'sku_economics_weekly', index_name: 'uq_sku_economics_weekly', columns: ['brand_id', 'week_start', 'marketplace', 'msku'] },
]

// ---------------------------------------------------------------------------
// The detector (fail-first: these FAIL until lib/upsert-constraint-check.ts and
// lib/upsert-config.ts exist)
// ---------------------------------------------------------------------------

test('detector: State C (conflict key configured, UNIQUE constraint absent) is flagged — the INB-82 bug', async () => {
  const mod = await import('../lib/upsert-constraint-check.ts')
  assert.equal(typeof mod.findUpsertConstraintViolations, 'function')
  const violations = mod.findUpsertConstraintViolations(STATE_C_CONFIG, STATE_C_INDEXES)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].table, 'purchased_product_report')
  assert.equal(violations[0].configuredKey, STATE_C_CONFIG.purchased_product_report)
  assert.match(violations[0].reason, /no UNIQUE constraint/i)
})

test('detector: matching is order-insensitive (ON CONFLICT semantics) and a fully missing table is flagged', async () => {
  const mod = await import('../lib/upsert-constraint-check.ts')
  // Same column SET in a different order → satisfied, no violation.
  const reordered = mod.findUpsertConstraintViolations(
    { some_table: 'a,b,c' },
    [{ table_name: 'some_table', index_name: 'uq_some_table', columns: ['c', 'a', 'b'] }],
  )
  assert.deepEqual(reordered, [])
  // Table absent from the constraint set entirely → flagged.
  const ghost = mod.findUpsertConstraintViolations({ ghost_table: 'a,b' }, [])
  assert.equal(ghost.length, 1)
  assert.equal(ghost[0].table, 'ghost_table')
  assert.match(ghost[0].reason, /no unique indexes/i)
})

test('detector: the real upsert config against the current DB constraint set → zero violations', async () => {
  const check = await import('../lib/upsert-constraint-check.ts')
  const config = await import('../lib/upsert-config.ts')
  assert.ok(config.ALL_UPSERT_CONFLICT_KEYS, 'ALL_UPSERT_CONFLICT_KEYS is exported')
  const violations = check.findUpsertConstraintViolations(config.ALL_UPSERT_CONFLICT_KEYS, CURRENT_DB_INDEXES)
  assert.deepEqual(violations, [])
})
