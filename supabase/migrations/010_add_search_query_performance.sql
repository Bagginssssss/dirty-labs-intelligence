CREATE TABLE IF NOT EXISTS search_query_performance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  search_query text NOT NULL,
  search_query_score integer,
  search_query_volume integer,
  impressions_total integer,
  impressions_brand integer,
  impressions_brand_share decimal(10,4),
  clicks_total integer,
  clicks_rate decimal(10,4),
  clicks_brand integer,
  clicks_brand_share decimal(10,4),
  clicks_price_median decimal(10,2),
  clicks_brand_price_median decimal(10,2),
  clicks_same_day_shipping integer,
  clicks_1d_shipping integer,
  clicks_2d_shipping integer,
  cart_adds_total integer,
  cart_adds_rate decimal(10,4),
  cart_adds_brand integer,
  cart_adds_brand_share decimal(10,4),
  cart_adds_price_median decimal(10,2),
  cart_adds_brand_price_median decimal(10,2),
  cart_adds_same_day_shipping integer,
  cart_adds_1d_shipping integer,
  cart_adds_2d_shipping integer,
  purchases_total integer,
  purchases_rate decimal(10,4),
  purchases_brand integer,
  purchases_brand_share decimal(10,4),
  purchases_price_median decimal(10,2),
  purchases_brand_price_median decimal(10,2),
  purchases_same_day_shipping integer,
  purchases_1d_shipping integer,
  purchases_2d_shipping integer,
  ingested_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sqp_brand_id ON search_query_performance(brand_id);
CREATE INDEX IF NOT EXISTS idx_sqp_report_date ON search_query_performance(report_date);
CREATE INDEX IF NOT EXISTS idx_sqp_search_query ON search_query_performance(search_query);

ALTER TABLE search_query_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON search_query_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);
