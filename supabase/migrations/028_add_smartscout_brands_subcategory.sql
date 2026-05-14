-- INB-32: Add subcategory column to smartscout_subcategory_brands
-- Enables per-subcategory filtering in the Market Share dashboard tab
ALTER TABLE smartscout_subcategory_brands
  ADD COLUMN IF NOT EXISTS subcategory text;

-- Conflict key changes from (brand_id, brand_name, snapshot_date) to
-- (brand_id, brand_name, subcategory, snapshot_date) — drop old constraint first
ALTER TABLE smartscout_subcategory_brands
  DROP CONSTRAINT IF EXISTS uq_smartscout_subcategory_brands;

ALTER TABLE smartscout_subcategory_brands
  ADD CONSTRAINT uq_sscb UNIQUE (brand_id, brand_name, subcategory, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_sscb_brand_sub
  ON smartscout_subcategory_brands (brand_id, subcategory);
