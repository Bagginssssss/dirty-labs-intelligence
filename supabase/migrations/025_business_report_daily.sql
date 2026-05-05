-- ============================================================
-- 025: business_report_daily
-- Amazon "Sales and Traffic by Date" — one row per brand per day.
-- No ASIN dimension; brand-level totals only.
-- Distinct from business_report (ASIN-level monthly snapshot).
-- ============================================================

CREATE TABLE IF NOT EXISTS business_report_daily (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                    uuid        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  report_date                 date        NOT NULL,

  -- Order metrics
  ordered_product_sales       decimal(12, 2),
  ordered_product_sales_b2b   decimal(12, 2),
  units_ordered               integer,
  units_ordered_b2b           integer,
  total_order_items           integer,
  total_order_items_b2b       integer,

  -- Traffic metrics
  page_views_total            integer,
  page_views_total_b2b        integer,
  sessions_total              integer,
  sessions_total_b2b          integer,

  -- Conversion / listing health
  buy_box_pct                 decimal(10, 6),
  buy_box_pct_b2b             decimal(10, 6),
  unit_session_pct            decimal(10, 6),
  unit_session_pct_b2b        decimal(10, 6),

  -- Catalog depth (nullable — not always present in every export variant)
  average_offer_count         integer,
  average_parent_items        integer,

  ingested_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_business_report_daily UNIQUE (brand_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_brd_brand_date
  ON business_report_daily (brand_id, report_date);

ALTER TABLE business_report_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON business_report_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
