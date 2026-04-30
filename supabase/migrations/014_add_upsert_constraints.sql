-- business_report
ALTER TABLE business_report
ADD CONSTRAINT uq_business_report
UNIQUE (brand_id, asin_id, report_date);

-- sp_campaign_performance
ALTER TABLE sp_campaign_performance
ADD CONSTRAINT uq_campaign_performance
UNIQUE (brand_id, campaign_id, report_date, ad_type);

-- subscribe_and_save — includes sku because one ASIN can have multiple SKUs
ALTER TABLE subscribe_and_save
ADD CONSTRAINT uq_subscribe_and_save
UNIQUE (brand_id, asin_id, sku, report_date);

-- search_query_performance
ALTER TABLE search_query_performance
ADD CONSTRAINT uq_search_query_performance
UNIQUE (brand_id, search_query, report_date);
