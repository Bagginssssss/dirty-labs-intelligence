export type ReportRegistryEntry = {
  internal_id: string;
  display_name: string;
  source_platform: 'Amazon Ads' | 'Seller Central' | 'Brand Analytics' | 'SmartScout' | 'Scale Insights';
  source_table: string;
  date_column: string;
  cadence: 'weekly' | 'monthly' | 'ad_hoc' | 'pending';
  pull_window_days: number | 'snapshot';
  granularity: 'daily' | 'weekly' | 'monthly' | 'snapshot' | 'per_order' | 'period_aggregate';
  display_order: number;
  notes?: string;
  /** Filters source-table queries to a subset of rows (e.g. a specific ad_type). Applied via .in(). */
  source_filter?: { column: string; values: string[] };
  /** Old internal_id values that map to this entry in report_ingestion_log. Upload history merges events from all IDs. */
  legacy_report_ids?: string[];
};

export const REPORT_REGISTRY: ReportRegistryEntry[] = [
  // Amazon Ads
  {
    internal_id: 'sp_campaign_performance__sp',
    display_name: 'SP Campaign Performance',
    source_platform: 'Amazon Ads',
    source_table: 'sp_campaign_performance',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 10,
    source_filter: { column: 'ad_type', values: ['SP'] },
    legacy_report_ids: ['sp_campaign_performance'],
    notes: 'Sponsored Products only (ad_type=SP). 30d pull window covers 7-14d attribution reconciliation.',
  },
  {
    internal_id: 'sp_campaign_performance__sb',
    display_name: 'SB/SBV Campaign Performance',
    source_platform: 'Amazon Ads',
    source_table: 'sp_campaign_performance',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 12,
    source_filter: { column: 'ad_type', values: ['SB', 'SBV'] },
    legacy_report_ids: ['sp_campaign_performance'],
    notes: 'Sponsored Brands + Sponsored Brands Video (ad_type IN SB,SBV). SB and SBV ride in the same Amazon Ads Sponsored Brands CSV. 30d pull window covers 14d attribution reconciliation.',
  },
  {
    internal_id: 'sp_search_term_report',
    display_name: 'Search Term Report',
    source_platform: 'Amazon Ads',
    source_table: 'sp_search_term_report',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 20,
    notes: '~38k rows; heavy fetch (per INB-81). 30d pull window for attribution reconciliation.',
  },
  {
    internal_id: 'sp_targeting_report',
    display_name: 'Targeting Report',
    source_platform: 'Amazon Ads',
    source_table: 'sp_targeting_report',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 30,
    notes: '30d pull window for attribution reconciliation.',
  },
  {
    internal_id: 'purchased_product_report',
    display_name: 'Purchased Product Report',
    source_platform: 'Amazon Ads',
    source_table: 'purchased_product_report',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 40,
    notes: '30d pull window for attribution reconciliation.',
  },

  // Seller Central
  {
    internal_id: 'business_report',
    display_name: 'Business Report (Monthly)',
    source_platform: 'Seller Central',
    source_table: 'business_report',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'monthly',
    display_order: 50,
    notes: 'Cadence: pulled weekly. Granularity: one row per month per ASIN (monthly aggregates). "(Monthly)" in display name refers to data granularity, not cadence. Populated alongside business_report_daily from a single upload action (per INB-38 hybrid arch); same ingested_at expected. 30d pull window covers returns/refund reconciliation.',
  },
  {
    internal_id: 'business_report_daily',
    display_name: 'Business Report (Daily)',
    source_platform: 'Seller Central',
    source_table: 'business_report_daily',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'daily',
    display_order: 60,
    notes: 'Per-day rows. Populated alongside business_report from a single upload action; same ingested_at expected. 30d pull window covers returns/refund reconciliation.',
  },
  {
    internal_id: 'subscribe_and_save',
    display_name: 'Subscribe & Save',
    source_platform: 'Seller Central',
    source_table: 'subscribe_and_save',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 'snapshot',
    granularity: 'period_aggregate',
    display_order: 70,
    notes: 'Period-aggregate rows (each row covers a date range — report_date + date_range_end populated). No reconciliation window — each pull reflects current subscription state. Phase 1 gap detection: skip; only verify latest upload is fresh.',
  },
  {
    internal_id: 'virtual_bundle_sales_snapshots',
    display_name: 'Virtual Bundle Sales (Summary)',
    source_platform: 'Seller Central',
    source_table: 'virtual_bundle_sales_snapshots',
    date_column: 'snapshot_date',
    cadence: 'weekly',
    pull_window_days: 90,
    granularity: 'snapshot',
    display_order: 80,
    notes: 'Amazon pushes Tuesday; covers prev 90 days. One row per (bundle, period) — periodic aggregate, not daily. Phase 1 gap detection: skip; verify latest snapshot is within weekly threshold.',
  },
  {
    internal_id: 'virtual_bundle_sales_daily',
    display_name: 'Virtual Bundle Sales (Per Order)',
    source_platform: 'Seller Central',
    source_table: 'virtual_bundle_sales_daily',
    date_column: 'sale_date',
    cadence: 'weekly',
    pull_window_days: 90,
    granularity: 'per_order',
    display_order: 90,
    notes: 'Amazon pushes Tuesday; covers prev 90 days. Per-order rows. Date column is sale_date (not report_date). Phase 1 gap detection: skip per_order (some days have no orders); only verify latest sale_date is within weekly threshold.',
  },

  // Brand Analytics
  {
    internal_id: 'search_query_performance',
    display_name: 'Search Query Performance',
    source_platform: 'Brand Analytics',
    source_table: 'search_query_performance',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 7,
    granularity: 'weekly',
    display_order: 100,
    notes: 'Weekly cadence going forward. Historical data is 12 monthly periods (May 2025 – Apr 2026) plus weekly Saturday-ending periods accumulating from May 2026 forward. Mixed-cadence is supported via the report_date pattern — no explicit granularity column on this table. 7d pull window matches actual re-pullable window for weekly SQP.',
  },
  {
    internal_id: 'brand_analytics_customer_loyalty',
    display_name: 'Customer Loyalty (BA)',
    source_platform: 'Brand Analytics',
    source_table: 'brand_analytics_customer_loyalty',
    date_column: 'period_end_date',
    cadence: 'weekly',
    pull_window_days: 30,
    granularity: 'weekly',
    display_order: 110,
    notes: 'Per INB-29. Date column is period_end_date (not report_date). Pulled weekly (Monday/Tuesday startup task); rows have weekly period_end_date anchors. 30d pull window for reconciliation overlap.',
  },

  // Scale Insights
  {
    internal_id: 'scale_insights_keyword_rank',
    display_name: 'Scale Insights Keyword Rank',
    source_platform: 'Scale Insights',
    source_table: 'scale_insights_keyword_rank',
    date_column: 'report_date',
    cadence: 'weekly',
    pull_window_days: 7,
    granularity: 'daily',
    display_order: 120,
    notes: 'Daily point-in-time snapshots. No reconciliation; 7d pull window is a light cushion.',
  },

  // SmartScout
  {
    internal_id: 'smartscout_subcategory_brands',
    display_name: 'SmartScout Subcategory Brands',
    source_platform: 'SmartScout',
    source_table: 'smartscout_subcategory_brands',
    date_column: 'snapshot_date',
    cadence: 'monthly',
    pull_window_days: 'snapshot',
    granularity: 'monthly',
    display_order: 130,
    notes: 'REQUIRES per-category designation at upload: Dishwasher / Laundry / Stain Remover. Cadence is monthly or ad hoc — no overdue flag until approaching 30 days.',
  },
  {
    internal_id: 'smartscout_subcategory_products',
    display_name: 'SmartScout Subcategory Products',
    source_platform: 'SmartScout',
    source_table: 'smartscout_subcategory_products',
    date_column: 'snapshot_date',
    cadence: 'monthly',
    pull_window_days: 'snapshot',
    granularity: 'monthly',
    display_order: 140,
    notes: 'Cadence is monthly or ad hoc — no overdue flag until approaching 30 days.',
  },

  // Pending architecture
  {
    internal_id: 'scale_insights_bid_log',
    display_name: 'Scale Insights Bid Log',
    source_platform: 'Scale Insights',
    source_table: 'scale_insights_bid_log',
    date_column: 'report_date',
    cadence: 'pending',
    pull_window_days: 'snapshot',
    granularity: 'snapshot',
    display_order: 9999,
    notes: 'PENDING ARCHITECTURE — ingestion not formalized. 2 historical upload events exist. Do not include in overdue counts. Show with darker-gray "Pending architecture" status. Verify date_column when architecture lands.',
  },
];
