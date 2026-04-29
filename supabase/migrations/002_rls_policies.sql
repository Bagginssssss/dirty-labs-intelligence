-- ============================================================
-- Enable Row Level Security and add authenticated-user policies
-- for all 19 tables
-- ============================================================

-- 1. brands
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON brands
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 2. asins
ALTER TABLE asins ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON asins
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 3. campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON campaigns
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4. ad_groups
ALTER TABLE ad_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON ad_groups
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 5. sp_search_term_report
ALTER TABLE sp_search_term_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON sp_search_term_report
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 6. sp_targeting_report
ALTER TABLE sp_targeting_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON sp_targeting_report
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 7. sp_campaign_performance
ALTER TABLE sp_campaign_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON sp_campaign_performance
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 8. business_report
ALTER TABLE business_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON business_report
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 9. purchased_product_report
ALTER TABLE purchased_product_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON purchased_product_report
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 10. scale_insights_bid_log
ALTER TABLE scale_insights_bid_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON scale_insights_bid_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 11. scale_insights_keyword_rank
ALTER TABLE scale_insights_keyword_rank ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON scale_insights_keyword_rank
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 12. subscribe_and_save
ALTER TABLE subscribe_and_save ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON subscribe_and_save
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 13. smartscout_share_of_voice
ALTER TABLE smartscout_share_of_voice ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON smartscout_share_of_voice
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 14. smartscout_brand_revenue
ALTER TABLE smartscout_brand_revenue ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON smartscout_brand_revenue
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 15. derived_metrics_daily
ALTER TABLE derived_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON derived_metrics_daily
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 16. derived_metrics_weekly
ALTER TABLE derived_metrics_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON derived_metrics_weekly
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 17. derived_asin_metrics_daily
ALTER TABLE derived_asin_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON derived_asin_metrics_daily
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 18. goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON goals
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 19. report_ingestion_log
ALTER TABLE report_ingestion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON report_ingestion_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
