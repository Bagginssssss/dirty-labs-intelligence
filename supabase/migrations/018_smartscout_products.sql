DROP TABLE IF EXISTS smartscout_subcategory_products;

CREATE TABLE smartscout_subcategory_products (
  id                          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id                    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  snapshot_date               date NOT NULL,
  parent_asin                 text NOT NULL,
  asin                        text NOT NULL,
  subcategory                 text NOT NULL,
  title                       text,
  brand_name                  text,
  category                    text,
  primary_subcategory_rank    integer,
  est_monthly_revenue         numeric,
  ttm_revenue                 numeric,
  ttm_revenue_change          numeric,
  opportunity_score           numeric,
  is_variation                boolean,
  price                       numeric,
  review_count                integer,
  review_rating               numeric,
  fulfillment_type            text,
  listing_quality_score       numeric,
  monthly_units_sold          integer,
  num_sellers                 integer,
  buy_box_pct                 numeric,
  has_coupons                 boolean,
  asin_count                  integer,
  monthly_revenue_per_review  numeric,
  monthly_revenue_growth      numeric,
  avg_monthly_revenue         numeric,
  avg_monthly_units           numeric,
  category_revenue_rank       integer,
  category_revenue_pct        numeric,
  brand_revenue_pct           numeric,
  date_first_available        date,
  seller_type                 text,
  created_at                  timestamptz DEFAULT now(),
  CONSTRAINT uq_smartscout_products
    UNIQUE (brand_id, parent_asin, subcategory, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_smartscout_products_brand_snapshot
  ON smartscout_subcategory_products (brand_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_smartscout_products_parent_asin
  ON smartscout_subcategory_products (brand_id, parent_asin);

ALTER TABLE smartscout_subcategory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_authenticated ON smartscout_subcategory_products
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
