CREATE TABLE IF NOT EXISTS brand_analytics_customer_loyalty (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                      uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  period_end_date               date NOT NULL,
  granularity                   text NOT NULL CHECK (granularity IN ('weekly','monthly')),

  total_customers               integer,
  total_sales                   numeric(12, 2),
  total_orders                  integer,

  ntb_customers                 integer,
  ntb_sales                     numeric(12, 2),
  ntb_orders                    integer,

  repeat_customers              integer,
  repeat_sales                  numeric(12, 2),
  repeat_orders                 integer,

  repeat_purchase_rate          numeric(6, 4),
  avg_repeat_purchase_interval  numeric(6, 2),
  potential_new_customers       integer,

  ingested_at                   timestamptz DEFAULT now(),

  UNIQUE (brand_id, period_end_date, granularity)
);

CREATE INDEX idx_bacl_brand_granularity_date
  ON brand_analytics_customer_loyalty(brand_id, granularity, period_end_date DESC);

ALTER TABLE brand_analytics_customer_loyalty ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON brand_analytics_customer_loyalty
  USING (auth.role() = 'authenticated');
