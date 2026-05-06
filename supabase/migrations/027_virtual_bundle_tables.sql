-- INB-47: Replace single virtual_bundle_sales table with two purpose-specific tables.
--
-- virtual_bundle_sales_daily  — Amazon's weekly VB report (one row per bundle per day).
-- virtual_bundle_sales_snapshots — operator's 90-day rolling window snapshots (weekly).
--
-- The old virtual_bundle_sales table is NOT dropped because it holds pre-April-2025
-- historical data still referenced by the Phase-1 dashboard. Phase 2 will migrate
-- the loader to read from these new tables and deprecate the old one.

-- ─── virtual_bundle_sales_daily ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS virtual_bundle_sales_daily (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         uuid        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  bundle_asin      text        NOT NULL,
  title            text,
  sale_date        date        NOT NULL,
  bundles_sold     integer,
  total_sales_usd  decimal(14,2),
  ingested_at      timestamptz DEFAULT now(),
  CONSTRAINT uq_vbsd UNIQUE (brand_id, bundle_asin, sale_date)
);

CREATE INDEX IF NOT EXISTS idx_vbsd_brand_id   ON virtual_bundle_sales_daily(brand_id);
CREATE INDEX IF NOT EXISTS idx_vbsd_sale_date  ON virtual_bundle_sales_daily(sale_date);
CREATE INDEX IF NOT EXISTS idx_vbsd_bundle_asin ON virtual_bundle_sales_daily(bundle_asin);

ALTER TABLE virtual_bundle_sales_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON virtual_bundle_sales_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── virtual_bundle_sales_snapshots ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS virtual_bundle_sales_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  bundle_asin   text        NOT NULL,
  bundle_name   text,
  snapshot_date date        NOT NULL,   -- window end date ("through YYYY-MM-DD")
  window_start  date,
  week_number   integer,
  sales_90d     decimal(14,2),
  margin_pct    decimal(6,4),           -- stored as fraction, e.g. 0.25 for 25%
  profit_90d    decimal(14,2),
  ingested_at   timestamptz DEFAULT now(),
  CONSTRAINT uq_vbss UNIQUE (brand_id, bundle_asin, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_vbss_brand_id      ON virtual_bundle_sales_snapshots(brand_id);
CREATE INDEX IF NOT EXISTS idx_vbss_snapshot_date ON virtual_bundle_sales_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_vbss_bundle_asin   ON virtual_bundle_sales_snapshots(bundle_asin);

ALTER TABLE virtual_bundle_sales_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON virtual_bundle_sales_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
