ALTER TABLE subscribe_and_save
ADD COLUMN IF NOT EXISTS date_range_end date,
ADD COLUMN IF NOT EXISTS sku text,
ADD COLUMN IF NOT EXISTS fulfilled_by text,
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS seller_funding_pct decimal(10,4),
ADD COLUMN IF NOT EXISTS sns_sales_penetration decimal(10,6),
ADD COLUMN IF NOT EXISTS oos_rate decimal(10,6),
ADD COLUMN IF NOT EXISTS lost_sales_oos decimal(14,2),
ADD COLUMN IF NOT EXISTS coupon_subscription_share decimal(10,6),
ADD COLUMN IF NOT EXISTS coupon_sales_penetration decimal(10,6);
