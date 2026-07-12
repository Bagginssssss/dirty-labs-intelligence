// Per-target-table coverage config (INB-146).
//
// Keyed by target_table (17 active tables). Two report_keys that share a table (ad_type
// splits, log_type triples, subcategory/ASIN groups, the assignments pair) share one
// entry — coverage grain is a property of the data, not the discriminator.
//   periodColumn — the date/timestamp column bucketed (mirrors the route's
//                  DATE_COL_OVERRIDES + the get_coverage_dates branches). Timestamp
//                  columns are sliced to date by the caller.
//   mode         — coverage grain: 'weekly' (daily rows → Sat-ending weeks, and
//                  weekly anchors; SQP's monthly-era handled by the cutover),
//                  'monthly' (business_report — monthly aggregates), 'snapshot'
//                  (one record per date: SmartScout / VB snapshots / S&S / assignments).
//   eventDriven  — rows only exist on days rules fired; between-week gaps are NOT
//                  missing data (bid log + the rule change logs).

import type { CoverageMode } from './buckets'

export type CoverageTableConfig = {
  periodColumn: string
  mode: CoverageMode
  eventDriven: boolean
  // Covering-window reports (S&S): each snapshot represents a rolling window of this many
  // days from its date. Drives the tile's "Window X → Y" copy (INB-147). Absent = a point.
  coveringWindowDays?: number
}

export const COVERAGE_CONFIG: Record<string, CoverageTableConfig> = {
  // Sponsored Ads — daily rows bucketed to weeks
  sp_campaign_performance:          { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  sp_search_term_report:            { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  sp_targeting_report:              { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  purchased_product_report:         { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  // Seller Central
  business_report:                  { periodColumn: 'report_date',     mode: 'monthly',  eventDriven: false },
  business_report_daily:            { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  subscribe_and_save:               { periodColumn: 'report_date',     mode: 'snapshot', eventDriven: false, coveringWindowDays: 30 },
  virtual_bundle_sales_snapshots:   { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  virtual_bundle_sales_daily:       { periodColumn: 'sale_date',       mode: 'weekly',   eventDriven: false },
  // Brand Analytics — weekly Saturday anchors (SQP is mixed-cadence: monthly era + weekly)
  search_query_performance:         { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  brand_analytics_customer_loyalty: { periodColumn: 'period_end_date', mode: 'weekly',   eventDriven: false },
  // Scale Insights
  scale_insights_keyword_rank:      { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  scale_insights_bid_log:           { periodColumn: 'change_timestamp',mode: 'weekly',   eventDriven: true  },
  scale_insights_rule_change_log:   { periodColumn: 'created_date',    mode: 'weekly',   eventDriven: true  },
  scale_insights_rule_assignments:  { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  // SmartScout — weekly snapshots
  smartscout_subcategory_brands:    { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  smartscout_subcategory_products:  { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
}
