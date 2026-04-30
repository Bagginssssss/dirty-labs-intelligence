-- Backfill sp_search_term_report
UPDATE sp_search_term_report
SET ad_type = 'SP'
WHERE ad_type IS NULL;

-- Backfill sp_targeting_report
UPDATE sp_targeting_report
SET ad_type = 'SP'
WHERE ad_type IS NULL;

-- Backfill sp_campaign_performance
UPDATE sp_campaign_performance
SET ad_type = 'SP'
WHERE ad_type IS NULL;
