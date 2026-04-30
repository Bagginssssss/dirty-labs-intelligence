CREATE TABLE IF NOT EXISTS smartscout_subcategory_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  brand_name text NOT NULL,
  est_monthly_revenue decimal(14,2),
  market_share decimal(10,6),
  market_share_change decimal(10,6),
  ad_spend_share decimal(10,6),
  dominant_seller_country text,
  avg_num_sellers decimal(10,4),
  avg_package_volume decimal(10,4),
  est_monthly_units integer,
  num_asins integer,
  total_review_count integer,
  avg_review_count decimal(10,2),
  avg_rating decimal(10,2),
  avg_page_score decimal(10,2),
  avg_price decimal(10,2),
  ingested_at timestamptz DEFAULT now(),
  CONSTRAINT uq_smartscout_brands
  UNIQUE (brand_id, brand_name, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ssb_brand_id ON smartscout_subcategory_brands(brand_id);
CREATE INDEX IF NOT EXISTS idx_ssb_snapshot_date ON smartscout_subcategory_brands(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_ssb_brand_name ON smartscout_subcategory_brands(brand_name);

ALTER TABLE smartscout_subcategory_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON smartscout_subcategory_brands
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
