ALTER TABLE purchased_product_report
ADD COLUMN IF NOT EXISTS advertised_sku  text,
ADD COLUMN IF NOT EXISTS other_sku_orders integer;
