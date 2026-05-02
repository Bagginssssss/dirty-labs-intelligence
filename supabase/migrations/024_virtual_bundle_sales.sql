CREATE TABLE IF NOT EXISTS virtual_bundle_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  bundle_asin text NOT NULL,
  title text,
  sale_date date NOT NULL,
  bundles_sold integer,
  total_sales_usd decimal(14,2),
  report_week date,
  is_virtual_multipack boolean,
  ingested_at timestamptz DEFAULT now(),
  CONSTRAINT uq_virtual_bundle_sales
  UNIQUE (brand_id, bundle_asin, sale_date)
);

CREATE INDEX IF NOT EXISTS idx_vbs_brand_id ON virtual_bundle_sales(brand_id);
CREATE INDEX IF NOT EXISTS idx_vbs_bundle_asin ON virtual_bundle_sales(bundle_asin);
CREATE INDEX IF NOT EXISTS idx_vbs_sale_date ON virtual_bundle_sales(sale_date);

ALTER TABLE virtual_bundle_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON virtual_bundle_sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
