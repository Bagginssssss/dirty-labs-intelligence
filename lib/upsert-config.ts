// Single source of truth for upsert conflict keys (moved out of
// app/api/ingest/route.ts for INB-88 so the constraint-integrity checker, tests,
// and scripts can import it without pulling in the route).
//
// EVERY key here MUST have a matching UNIQUE constraint in the DB — see
// lib/upsert-constraint-check.ts and the "Adding a new ingestion table" checklist
// in CLAUDE.md. A key without its constraint means ON CONFLICT silently duplicates
// rows on re-upload (INB-82: purchased_product_report reached 1,031 dupes).

// Tables the ingest route upserts instead of inserts, keyed by their natural-key
// columns. When a conflict occurs the incoming row overwrites the stored one so
// re-uploads and overlapping date ranges always reflect the most recently
// ingested values.
export const UPSERT_CONFLICT_KEYS: Record<string, string> = {
  scale_insights_keyword_rank: 'brand_id,asin_id,keyword,report_date',
  scale_insights_bid_log:      'brand_id,campaign_id,target,change_timestamp,bid_before,bid_after',
  business_report:             'brand_id,asin_id,report_date',
  business_report_daily:       'brand_id,report_date',
  sp_campaign_performance:     'brand_id,campaign_id,report_date,ad_type',
  // Rolling-pull tables — constraint added in migration 030 (INB-82)
  sp_search_term_report:       'brand_id,campaign_id,ad_group_id,report_date,customer_search_term,targeting',
  sp_targeting_report:         'brand_id,campaign_id,ad_group_id,report_date,targeting,match_type',
  purchased_product_report:    'brand_id,campaign_id,report_date,ad_type,advertised_asin,purchased_asin,attribution_type',
  derived_metrics_daily:       'brand_id,metric_date',
  derived_metrics_weekly:      'brand_id,week_start',
  subscribe_and_save:              'brand_id,asin_id,sku,report_date',
  search_query_performance:        'brand_id,search_query,report_date',
  smartscout_subcategory_products: 'brand_id,parent_asin,subcategory,snapshot_date',
  smartscout_subcategory_brands:   'brand_id,brand_name,subcategory,snapshot_date',
  virtual_bundle_sales:                 'brand_id,bundle_asin,sale_date',
  virtual_bundle_sales_daily:           'brand_id,bundle_asin,sale_date',
  virtual_bundle_sales_snapshots:       'brand_id,bundle_asin,snapshot_date',
  brand_analytics_customer_loyalty:     'brand_id,period_end_date,granularity',
  // INB-148 — rolling-window change logs overlap by design; assignment snapshots
  // are re-uploaded weekly. Both dedup on their natural key (migration 039).
  scale_insights_rule_change_log:  'brand_id,created_date,log_type,campaign,ad_group,keyword_or_target,rule_name,change_value',
  scale_insights_rule_assignments: 'brand_id,snapshot_date,campaign,ad_group',
}

// Everything the constraint checker must cover: the ingest map above PLUS conflict
// keys hardcoded at upsert call sites outside the ingest route. Keep this in sync
// when adding a new .upsert(..., { onConflict }) anywhere:
//   - platform_knowledge: lib/memory/semantic.ts
//   - derived_metrics_daily: lib/derived-metrics.ts (mirrors the map entry above)
export const ALL_UPSERT_CONFLICT_KEYS: Record<string, string> = {
  ...UPSERT_CONFLICT_KEYS,
  platform_knowledge: 'brand_id,category,key',
}

// INB-149 — nullable-column-in-unique-key ratchet. A NULL in a unique-constraint
// column is treated as distinct by Postgres, so overlapping upserts duplicate
// silently (INB-82 / the SB Attributed Purchases defect). The extended INB-88
// checker (findNullableUniqueKeyColumns) FAILS on any such table NOT listed here.
// These 7 are pre-existing and out of INB-149's scope (report-only); each entry
// records the severity found on 2026-07-09 so the follow-up ticket can prioritise.
// purchased_product_report is deliberately ABSENT — migration 042 fixed it, so it
// must stay clean or the checker fails.
export const NULLABLE_KEY_ALLOWLIST: Record<string, string> = {
  scale_insights_bid_log:        'URGENT — 7,438 NULL-key rows, 2,213 excess dupes (2026-07-09); same defect class actively duplicating. Remediation: INB-150.',
  scale_insights_keyword_rank:   'latent — 0 NULL-key rows, 0 dupes; harden with NOT NULL DEFAULT. Housekeeping: INB-151.',
  smartscout_subcategory_brands: 'latent — 0 NULL-key rows, 0 dupes. Housekeeping: INB-151.',
  sp_campaign_performance:       'latent — 0 NULL-key rows (ad_type always set), 0 dupes. Housekeeping: INB-151.',
  sp_search_term_report:         'latent — 0 NULL-key rows, 0 dupes. Housekeeping: INB-151.',
  sp_targeting_report:           'near-latent — 2 NULL-key rows, 0 dupes. Housekeeping: INB-151.',
  subscribe_and_save:            'latent — 0 NULL-key rows, 0 dupes. Housekeeping: INB-151.',
}
