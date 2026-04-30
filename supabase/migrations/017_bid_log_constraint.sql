ALTER TABLE scale_insights_bid_log
ADD CONSTRAINT uq_bid_log
UNIQUE (brand_id, campaign_id, target, change_timestamp, bid_before, bid_after);
