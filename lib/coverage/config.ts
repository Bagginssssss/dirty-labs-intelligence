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
  // Weekly reports whose single row is anchored at the period START (periodColumn = a Sunday
  // week_start), so data_through == period_start by construction — the one row already covers
  // the whole Sun–Sat week. Every OTHER weekly report is either daily-grained (data flows
  // through the week) or END-anchored (report_date = the Saturday), so its data_through reaches
  // the period end. Without this flag the status/freshness logic mistakes a start-anchored
  // completed week for a perpetually-partial one (data_through is 6 days short of the Saturday)
  // → permanent false OVERDUE + a "Data through <week_start>" label. INB-162 addendum 2.
  weekAnchoredAtStart?: boolean
  // Monthly reports whose coverage is the PULL date (landing in the current month), not a prior
  // reporting month-end. The tile is "current" when the CURRENT month has any coverage, and only
  // goes due once a new month starts without a pull. Without this, a mid-month first pull reads a
  // permanent false OVERDUE (the prior-month check never matches). INB-160 (Amazon reviews/snapshots).
  monthlyPullDate?: boolean
  // INB-166 — window-per-pull reports (business_report_child_asin, subscribe_and_save): each pull is a
  // ~30-day period-aggregate, so coverage is ONE row per pull spanning [window_start, window_end] with
  // data_through = window_end (NOT the start). period_type stays 'snapshot' but the span is multi-day,
  // so period_start ≠ period_end is expected (unlike single-day snapshots). The maintain/backfill write
  // path takes the end from `windowEndColumn` on the row (S&S) or the ingest date_range_end param
  // (business_report, no column). The inb146 backfill SKIPS these (rebuilt by inb166-window-coverage).
  windowPerPull?: boolean
  windowEndColumn?: string
  // INB-168 — the discriminator's values are CO-EMITTED metrics that must ALL be present (a paired
  // Sales/Share/etc. export writes both columns of the pair on the same date). In the REBUILD path,
  // such a report's data_through is min(max(date)) across values, not max over the union, so a stale
  // half cannot make the tile green (the frozen reorder_share canary in INB-166). See lib/coverage/
  // paired.ts. NOT set on the SB/SBV ad_type tables: those sub-types are alternatives that legitimately
  // arrive on different dates, so union is correct for them. Rebuild-path only (post-upload unchanged).
  pairedDiscriminator?: boolean
}

export const COVERAGE_CONFIG: Record<string, CoverageTableConfig> = {
  // Sponsored Ads — daily rows bucketed to weeks
  sp_campaign_performance:          { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  sp_search_term_report:            { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  sp_targeting_report:              { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  purchased_product_report:         { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  // Seller Central
  // INB-166: window-per-pull — one coverage row per pull spanning [report_date, date_range_end],
  // data_through = date_range_end. business_report has NO end column (report_date is the window START),
  // so the live write takes date_range_end from the ingest payload; the backfill joins the ingestion
  // log. mode 'snapshot' (not monthly — a 30-day rollup pulled weekly is neither clean weekly nor
  // monthly). Rebuilt by scripts/inb166-window-coverage.mjs (inb146 skips it).
  business_report:                  { periodColumn: 'report_date',     mode: 'snapshot', eventDriven: false, windowPerPull: true },
  business_report_daily:            { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  // INB-166: window-per-pull — one coverage row per pull spanning [report_date, date_range_end],
  // data_through = date_range_end. The window end is on the row (Reporting Period End). No fixed
  // coveringWindowDays: the exact end is stored, so the tile reads "Data through <end>". Rebuilt by
  // scripts/inb166-window-coverage.mjs (inb146 skips it).
  subscribe_and_save:               { periodColumn: 'report_date',     mode: 'snapshot', eventDriven: false, windowPerPull: true, windowEndColumn: 'date_range_end' },
  virtual_bundle_sales_snapshots:   { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  virtual_bundle_sales_daily:       { periodColumn: 'sale_date',       mode: 'weekly',   eventDriven: false },
  // Brand Analytics — weekly Saturday anchors (SQP is mixed-cadence: monthly era + weekly)
  search_query_performance:         { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  brand_analytics_customer_loyalty: { periodColumn: 'period_end_date', mode: 'weekly',   eventDriven: false },
  brand_analytics_repeat_purchase:  { periodColumn: 'reporting_date',  mode: 'weekly',   eventDriven: false },
  // Scale Insights
  scale_insights_keyword_rank:      { periodColumn: 'report_date',     mode: 'weekly',   eventDriven: false },
  scale_insights_bid_log:           { periodColumn: 'change_timestamp',mode: 'weekly',   eventDriven: true  },
  scale_insights_rule_change_log:   { periodColumn: 'created_date',    mode: 'weekly',   eventDriven: true  },
  scale_insights_rule_assignments:  { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  // SmartScout — weekly snapshots
  smartscout_subcategory_brands:    { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  smartscout_subcategory_products:  { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  // Subscribe & Save Dashboard (INB-144) — dailies bucketed to weeks; snapshots point-in-time
  // INB-168: pairedDiscriminator — the 5 sns_dashboard_daily reports each pair two co-emitted metrics
  // (reorder_sales/sns_sales, reorder_rate/sns_sales_share, active_subscriptions/_ly, …). Rebuild
  // resolves data_through to min(max) across the pair so a stale half can't overstate coverage.
  sns_dashboard_daily:              { periodColumn: 'metric_date',     mode: 'weekly',   eventDriven: false, pairedDiscriminator: true },
  sns_dashboard_snapshots:          { periodColumn: 'snapshot_date',   mode: 'snapshot', eventDriven: false },
  // SKU Economics (INB-162) — weekly parent; week_start is the period-START anchor (one row
  // per week), so the tile logic treats a completed week as fully pulled (weekAnchoredAtStart).
  sku_economics_weekly:             { periodColumn: 'week_start',      mode: 'weekly',   eventDriven: false, weekAnchoredAtStart: true },
  // COGS (INB-162) — effective-dated cost snapshots; ad-hoc, tracked by effective date
  cogs:                             { periodColumn: 'valid_from',      mode: 'snapshot', eventDriven: false },
  // FBA Customer Returns (INB-160) — daily return dates bucketed to weeks (not start-anchored)
  fba_customer_returns:             { periodColumn: 'return_date',     mode: 'weekly',   eventDriven: false },
  // Amazon Reviews (INB-160) — pull cadence tracked by scraped_at (the run marker), NOT review_date
  // (which spans the full public review history). Rating snapshots by run snapshot_date. Both monthly.
  amazon_reviews:                   { periodColumn: 'scraped_at',      mode: 'monthly',  eventDriven: false, monthlyPullDate: true },
  amazon_rating_snapshots:          { periodColumn: 'snapshot_date',   mode: 'monthly',  eventDriven: false, monthlyPullDate: true },
}
