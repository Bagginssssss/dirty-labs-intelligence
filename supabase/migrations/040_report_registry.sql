-- 040: report registry + ingestion-log report_key FK (INB-145).
--
-- The true operational taxonomy is ~34 distinct downloads (a report = one file
-- pulled on a cadence); the platform tracked an aggregated list. This table
-- enumerates every true report; report_ingestion_log.report_key tags every
-- upload going forward at the true-report level. Foundation for INB-146
-- (coverage backfill) and INB-147 (tile command center).
--
-- Discriminator jsonb identifies a report's rows within a shared table:
--   {"column": c, "values": [v, ...]}            — column value match
--   {"column": c, "op": "is_null"|"is_not_null"} — null-ness match
--   NULL                                          — whole table
-- All column names/values verified against the LIVE schema during reconcile
-- (ad_type not ad_product; normalized SmartScout codes; asin_id uuids).
--
-- Seed is idempotent (ON CONFLICT DO NOTHING); rows are managed by migration/
-- SQL for now. lib/report-registry.ts mirrors this seed exactly (commit 2);
-- the post-apply cross-check diffs DB rows against the TS module.

CREATE TABLE IF NOT EXISTS public.report_registry (
  report_key            text PRIMARY KEY,
  display_name          text NOT NULL,
  source_group          text NOT NULL CHECK (source_group IN
    ('Sponsored Ads', 'Brand Analytics', 'Business Reports', 'Subscribe & Save',
     'Virtual Bundles', 'SmartScout', 'ScaleInsights')),
  cadence               text NOT NULL CHECK (cadence IN
    ('weekly', 'monthly', 'snapshot_weekly', 'ad_hoc')),
  pull_period           text,
  target_table          text NOT NULL,
  discriminator         jsonb,
  requires_period_dates boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            int,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

COMMENT ON TABLE public.report_registry IS
  'One row per true operational report (a file downloaded on a cadence). INB-145. Seeded by migration; INB-146 coverage and INB-147 tiles read from here.';

ALTER TABLE public.report_ingestion_log
  ADD COLUMN IF NOT EXISTS report_key text REFERENCES public.report_registry(report_key);
CREATE INDEX IF NOT EXISTS idx_ril_report_key
  ON public.report_ingestion_log USING btree (report_key);

COMMENT ON COLUMN public.report_ingestion_log.report_key IS
  'True-report tag derived at upload time (INB-145). NULL = pre-INB-145 upload or underivable (ambiguous file); history is INB-146''s coverage concern, not an event backfill.';

INSERT INTO public.report_registry
  (report_key, display_name, source_group, cadence, pull_period, target_table,
   discriminator, requires_period_dates, is_active, sort_order, notes)
VALUES
  -- ── Sponsored Ads (weekly, last 30d; shared tables discriminated on ad_type) ──
  ('sp_campaign_performance', 'SP Campaign Performance', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_campaign_performance', '{"column":"ad_type","values":["SP"]}', false, true, 1, NULL),
  ('sb_campaign_performance', 'SB Campaign Performance (incl. SBV)', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_campaign_performance', '{"column":"ad_type","values":["SB","SBV"]}', false, true, 2, NULL),
  ('sp_targeting', 'SP Targeting', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_targeting_report', '{"column":"ad_type","values":["SP"]}', false, true, 3, NULL),
  ('sb_keyword', 'SB Keyword (incl. SBV)', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_targeting_report', '{"column":"ad_type","values":["SB","SBV"]}', false, true, 4, NULL),
  ('sp_search_term', 'SP Search Term', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_search_term_report', '{"column":"ad_type","values":["SP"]}', false, true, 5, NULL),
  ('sb_search_term', 'SB Search Term', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'sp_search_term_report', '{"column":"ad_type","values":["SB","SBV"]}', false, true, 6, NULL),
  ('sp_purchased_product', 'SP Purchased Product', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'purchased_product_report', '{"column":"advertised_asin","op":"is_not_null"}', false, true, 7,
   '236 SP-campaign rows carry NULL advertised_asin (land under sb_attributed_purchases'' predicate) — INB-149.'),
  ('sb_attributed_purchases', 'SB Attributed Purchases', 'Sponsored Ads', 'weekly', 'Last 30 days',
   'purchased_product_report', '{"column":"advertised_asin","op":"is_null"}', false, true, 8,
   'Ingests via the shared purchased_asin detector branch. KNOWN DEFECTS: lossy (14d metrics dropped by the SP-shaped mapper) and dupe-prone (NULL advertised_asin defeats the unique key; 4,983 excess rows found 2026-07-09). Remediation: INB-149.'),

  -- ── Brand Analytics (weekly) ──────────────────────────────────────────────
  ('sqp_weekly', 'Search Query Performance', 'Brand Analytics', 'weekly', 'Latest week',
   'search_query_performance', NULL, false, true, 1,
   'Weekly from May 2026; table also holds 12 monthly-era periods (May 2025 – Apr 2026).'),
  ('customer_loyalty', 'Customer Loyalty Analytics', 'Brand Analytics', 'weekly', 'Latest week',
   'brand_analytics_customer_loyalty', '{"column":"granularity","values":["weekly"]}', false, true, 2,
   'Weekly pull is the tracked report; monthly history exists in-table. A monthly upload derives NO report_key (logged NULL + warning).'),

  -- ── Business Reports (weekly, last 30d) ───────────────────────────────────
  ('business_report_daily', 'Sales & Traffic (Daily)', 'Business Reports', 'weekly', 'Last 30 days',
   'business_report_daily', NULL, false, true, 1, NULL),
  ('business_report_child_asin', 'Sales & Traffic by Child ASIN', 'Business Reports', 'weekly', 'Last 30 days',
   'business_report', NULL, true, true, 2,
   'Period-aggregate rows carry no date — requires_period_dates preserves the INB-109 gate.'),

  -- ── Subscribe & Save ──────────────────────────────────────────────────────
  ('subscribe_and_save', 'S&S Performance', 'Subscribe & Save', 'monthly', 'Latest month',
   'subscribe_and_save', NULL, false, true, 1,
   'Overlapping rolling ~30d windows labeled at period start (INB-136 covering-period semantics).'),

  -- ── Virtual Bundles (weekly via email Tuesdays, rolling 90d) ──────────────
  ('vb_sales_summary', 'VB Sales (Summary)', 'Virtual Bundles', 'weekly', 'Rolling 90d',
   'virtual_bundle_sales_snapshots', NULL, false, true, 1,
   'Amazon pushes by email on Tuesdays; multi-section 90-day snapshot export.'),
  ('vb_sales_per_order', 'VB Sales (Per Order)', 'Virtual Bundles', 'weekly', 'Rolling 90d',
   'virtual_bundle_sales_daily', NULL, false, true, 2,
   'Amazon pushes by email on Tuesdays; flat per-order/daily export.'),

  -- ── SmartScout (snapshot exports; date supplied on the upload form) ───────
  ('smartscout_brands_liquid_laundry', 'SmartScout Brands — Liquid Laundry', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_brands', '{"column":"subcategory","values":["laundry_detergent"]}', true, true, 1,
   'Stored code laundry_detergent covers both Liquid Laundry Detergent and Pacs & Tablets display names.'),
  ('smartscout_brands_dishwasher', 'SmartScout Brands — Dishwasher Detergent', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_brands', '{"column":"subcategory","values":["dishwasher_detergent"]}', true, true, 2, NULL),
  ('smartscout_brands_stain_removers', 'SmartScout Brands — Stain Removers', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_brands', '{"column":"subcategory","values":["laundry_stain_remover"]}', true, true, 3, NULL),
  ('smartscout_brands_toilet_cleaners', 'SmartScout Brands — Toilet Cleaners', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_brands', '{"column":"subcategory","values":["toilet_bowl_cleaner"]}', true, true, 4, NULL),
  ('smartscout_products_liquid_laundry', 'SmartScout Products — Liquid Laundry', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_products', '{"column":"subcategory","values":["laundry_detergent"]}', true, true, 5, NULL),
  ('smartscout_products_dishwasher', 'SmartScout Products — Dishwasher Detergent', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_products', '{"column":"subcategory","values":["dishwasher_detergent"]}', true, true, 6, NULL),
  ('smartscout_products_stain_removers', 'SmartScout Products — Stain Removers', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_products', '{"column":"subcategory","values":["laundry_stain_remover"]}', true, true, 7, NULL),
  ('smartscout_products_toilet_cleaners', 'SmartScout Products — Toilet Cleaners', 'SmartScout', 'snapshot_weekly', 'Point-in-time',
   'smartscout_subcategory_products', '{"column":"subcategory","values":["toilet_bowl_cleaner"]}', true, true, 8, NULL),

  -- ── ScaleInsights (weekly). Rank table stores asin_id uuid only; the human
  --    ASIN is echoed in the discriminator + display name. ────────────────────
  ('si_rank_b09b7ys1vk', 'SI Keyword Rank — B09B7YS1VK (Liquid Laundry, Signature)', 'ScaleInsights', 'weekly', 'Latest export',
   'scale_insights_keyword_rank', '{"column":"asin_id","values":["04a2dc1b-6fe1-4043-9004-04d97ee3eb4e"],"asin":"B09B7YS1VK"}', false, true, 1, NULL),
  ('si_rank_b09msp7m5y', 'SI Keyword Rank — B09MSP7M5Y (Liquid Laundry, Scent Free)', 'ScaleInsights', 'weekly', 'Latest export',
   'scale_insights_keyword_rank', '{"column":"asin_id","values":["0b4255cd-046e-42c2-ac97-3b3b503f5dfc"],"asin":"B09MSP7M5Y"}', false, true, 2, NULL),
  ('si_rank_b09b85ngbt', 'SI Keyword Rank — B09B85NGBT (Dishwasher Detergent)', 'ScaleInsights', 'weekly', 'Latest export',
   'scale_insights_keyword_rank', '{"column":"asin_id","values":["45a09193-1d30-4070-a17e-c003372735ba"],"asin":"B09B85NGBT"}', false, true, 3, NULL),
  ('si_rank_b0bl8mwlm5', 'SI Keyword Rank — B0BL8MWLM5 (Hand Wash & Delicates)', 'ScaleInsights', 'weekly', 'Latest export',
   'scale_insights_keyword_rank', '{"column":"asin_id","values":["a5e24c7d-72ba-45c7-85f5-0d12196ccded"],"asin":"B0BL8MWLM5"}', false, true, 4, NULL),
  ('si_rank_b0fqpmnj6z', 'SI Keyword Rank — B0FQPMNJ6Z (Toilet Bowl Cleaner)', 'ScaleInsights', 'weekly', 'Latest export',
   'scale_insights_keyword_rank', '{"column":"asin_id","values":["d8de583a-78a1-4200-b07e-b02107cafabe"],"asin":"B0FQPMNJ6Z"}', false, true, 5, NULL),
  ('si_bid_log', 'SI Bid Log', 'ScaleInsights', 'weekly', 'Rolling 7d (widenable)',
   'scale_insights_bid_log', NULL, false, true, 6,
   'Backfilled to Jan 2025. Rolling window export — do not skip weeks; window widenable for recovery.'),
  ('si_import_log', 'SI Import Rule Change Log', 'ScaleInsights', 'weekly', 'Rolling 7d (widenable)',
   'scale_insights_rule_change_log', '{"column":"log_type","values":["import"]}', false, true, 7,
   'Rolling window export — do not skip weeks; window widenable for recovery.'),
  ('si_negative_log', 'SI Negative Rule Change Log', 'ScaleInsights', 'weekly', 'Rolling 7d (widenable)',
   'scale_insights_rule_change_log', '{"column":"log_type","values":["negative"]}', false, true, 8,
   'Rolling window export — do not skip weeks; window widenable for recovery.'),
  ('si_revive_log', 'SI Revive Rule Change Log', 'ScaleInsights', 'weekly', 'Rolling 7d (widenable)',
   'scale_insights_rule_change_log', '{"column":"log_type","values":["revive"]}', false, true, 9,
   'Rolling window export — do not skip weeks; window widenable for recovery.'),
  ('si_rules_assigned', 'SI Assigned Rules Snapshot', 'ScaleInsights', 'weekly', 'Point-in-time',
   'scale_insights_rule_assignments', NULL, true, true, 10,
   'Point-in-time export — pull Assigned+Unassigned back-to-back, same-day upload.'),
  ('si_rules_unassigned', 'SI Unassigned Rules Snapshot', 'ScaleInsights', 'weekly', 'Point-in-time',
   'scale_insights_rule_assignments', NULL, true, true, 11,
   'Point-in-time pair — pull back-to-back with Assigned, same-day upload. File-of-origin is content-derived post-upsert (is_assigned); upload attribution uses header shape.'),

  -- ── Planned (not yet ingesting) ───────────────────────────────────────────
  ('ba_top_search_terms', 'BA Top Search Terms', 'Brand Analytics', 'weekly', 'Latest week',
   'brand_analytics_top_search_terms', NULL, false, false, 3, 'Planned — INB-140. Target table does not exist yet.'),
  ('ba_repeat_purchase', 'BA Repeat Purchase Behavior', 'Brand Analytics', 'ad_hoc', NULL,
   'brand_analytics_repeat_purchase', NULL, false, false, 4, 'Planned — INB-141. Target table does not exist yet.'),
  ('amc_query_results', 'AMC Query Results', 'Brand Analytics', 'ad_hoc', NULL,
   'amc_query_results', NULL, false, false, 5, 'Planned — INB-142. Target table does not exist yet.')
ON CONFLICT (report_key) DO NOTHING;
