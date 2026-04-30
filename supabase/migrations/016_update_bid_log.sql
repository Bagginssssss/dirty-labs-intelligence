ALTER TABLE scale_insights_bid_log
ADD COLUMN IF NOT EXISTS asin_text text,
ADD COLUMN IF NOT EXISTS sku text,
ADD COLUMN IF NOT EXISTS short_name text,
ADD COLUMN IF NOT EXISTS code text,
ADD COLUMN IF NOT EXISTS details text,
ADD COLUMN IF NOT EXISTS criteria text;
