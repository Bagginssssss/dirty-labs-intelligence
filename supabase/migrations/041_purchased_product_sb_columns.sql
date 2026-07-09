-- 041: SB Attributed Purchases columns for purchased_product_report (INB-149).
--
-- The weekly SB Attributed Purchases export has been misdetecting into the SP
-- purchased-product path since ~May 1: the SP-shaped mapper reads only 7-day
-- Other-SKU columns, so the SB file's 14-day + New-to-Brand metrics were dropped.
-- This migration adds the columns to carry the full SB column set. Additive only
-- — the NULL-proof key swap + ad_type discriminator is migration 042, AFTER the
-- data repair dedupes (a NULL-proof constraint cannot be built over the existing
-- duplicates the NULL advertised_asin let through).
--
-- ad_type is plain text (values SP/SB/SBV), matching sp_campaign_performance
-- (no CHECK). All columns nullable here; 042 makes the key columns NOT NULL.
-- Metric names mirror sp_targeting_report's 14-day / NTB / click conventions.

ALTER TABLE public.purchased_product_report
  ADD COLUMN IF NOT EXISTS ad_type          text,
  ADD COLUMN IF NOT EXISTS attribution_type text,
  ADD COLUMN IF NOT EXISTS cost_type        text,
  ADD COLUMN IF NOT EXISTS sales_14d        numeric,
  ADD COLUMN IF NOT EXISTS orders_14d       integer,
  ADD COLUMN IF NOT EXISTS units_14d        integer,
  ADD COLUMN IF NOT EXISTS ntb_sales_14d    numeric,
  ADD COLUMN IF NOT EXISTS ntb_orders_14d   integer,
  ADD COLUMN IF NOT EXISTS ntb_units_14d    integer,
  ADD COLUMN IF NOT EXISTS ntb_sales_pct    numeric,
  ADD COLUMN IF NOT EXISTS ntb_orders_pct   numeric,
  ADD COLUMN IF NOT EXISTS ntb_units_pct    numeric,
  ADD COLUMN IF NOT EXISTS sales_click      numeric,
  ADD COLUMN IF NOT EXISTS orders_click     integer,
  ADD COLUMN IF NOT EXISTS units_click      integer;

COMMENT ON COLUMN public.purchased_product_report.ad_type IS
  'SP / SB / SBV — the ads surface. Backfilled from advertised_asin nullness + campaign prefix (INB-149 repair); NOT NULL from migration 042. SP rows carry advertised_asin; SB/SBV rows do not.';
COMMENT ON COLUMN public.purchased_product_report.attribution_type IS
  'SB attributed-purchase attribution: Promoted | Brand Halo. Part of the SB natural key (NTB-split rows are summed per attribution). Empty string for SP rows (INB-149).';
