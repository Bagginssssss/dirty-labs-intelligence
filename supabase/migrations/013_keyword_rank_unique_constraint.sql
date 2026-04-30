ALTER TABLE scale_insights_keyword_rank
ADD CONSTRAINT uq_keyword_rank
UNIQUE (brand_id, asin_id, keyword, report_date);
