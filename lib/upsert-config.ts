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
  purchased_product_report:    'brand_id,campaign_id,report_date,advertised_asin,purchased_asin',
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
