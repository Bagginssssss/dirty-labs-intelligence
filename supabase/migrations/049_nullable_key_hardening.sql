-- 049: harden the six latent nullable-key tables — empty the INB-149 allowlist (INB-151).
--
-- Each of these tables has a nullable text column inside its UNIQUE key. Postgres treats NULLs as
-- distinct, so overlapping upserts can duplicate silently (the INB-82 / INB-149 defect class). All
-- six are still LATENT as of this migration — zero duplicate groups under the COALESCE(col,'')
-- normalized key (verified live) — so every ADD CONSTRAINT below is collision-free and the whole
-- migration is one atomic transaction with NO dedupe step. This is the fourth execution of the
-- INB-148/149/150 pattern; the code commit empties NULLABLE_KEY_ALLOWLIST so the checker enforces
-- this class account-wide, permanently.
--
-- Per table (INB-150 ordering — drop the constraint BEFORE normalizing any in-key column):
--   DROP CONSTRAINT -> UPDATE NULL->'' -> SET DEFAULT '' + SET NOT NULL -> ADD CONSTRAINT (same
--   name + columns, so the INB-88 fixture / UPSERT_CONFLICT_KEYS need no change). Every nullable
--   key column is text, so '' is the canonical empty value.
--
-- Live NULL-key backfill counts (rest are 0-row, kept for correctness/idempotency):
--   sp_targeting_report: 2 rows (both targeting AND match_type NULL on the same 2 rows).

-- ── sp_targeting_report (targeting, match_type) ───────────────────────────────
ALTER TABLE public.sp_targeting_report DROP CONSTRAINT uq_sp_targeting_report;
UPDATE public.sp_targeting_report SET targeting  = '' WHERE targeting  IS NULL;   -- 2 rows
UPDATE public.sp_targeting_report SET match_type = '' WHERE match_type IS NULL;   -- 2 rows
ALTER TABLE public.sp_targeting_report
  ALTER COLUMN targeting  SET DEFAULT '', ALTER COLUMN targeting  SET NOT NULL,
  ALTER COLUMN match_type SET DEFAULT '', ALTER COLUMN match_type SET NOT NULL;
ALTER TABLE public.sp_targeting_report ADD CONSTRAINT uq_sp_targeting_report
  UNIQUE (brand_id, campaign_id, ad_group_id, report_date, targeting, match_type);

-- ── sp_campaign_performance (ad_type) ─────────────────────────────────────────
ALTER TABLE public.sp_campaign_performance DROP CONSTRAINT uq_campaign_performance;
UPDATE public.sp_campaign_performance SET ad_type = '' WHERE ad_type IS NULL;     -- 0 rows
ALTER TABLE public.sp_campaign_performance
  ALTER COLUMN ad_type SET DEFAULT '', ALTER COLUMN ad_type SET NOT NULL;
ALTER TABLE public.sp_campaign_performance ADD CONSTRAINT uq_campaign_performance
  UNIQUE (brand_id, campaign_id, report_date, ad_type);

-- ── sp_search_term_report (customer_search_term, targeting) ───────────────────
ALTER TABLE public.sp_search_term_report DROP CONSTRAINT uq_sp_search_term_report;
UPDATE public.sp_search_term_report SET customer_search_term = '' WHERE customer_search_term IS NULL; -- 0 rows
UPDATE public.sp_search_term_report SET targeting = '' WHERE targeting IS NULL;   -- 0 rows
ALTER TABLE public.sp_search_term_report
  ALTER COLUMN customer_search_term SET DEFAULT '', ALTER COLUMN customer_search_term SET NOT NULL,
  ALTER COLUMN targeting            SET DEFAULT '', ALTER COLUMN targeting            SET NOT NULL;
ALTER TABLE public.sp_search_term_report ADD CONSTRAINT uq_sp_search_term_report
  UNIQUE (brand_id, campaign_id, ad_group_id, report_date, customer_search_term, targeting);

-- ── scale_insights_keyword_rank (keyword) ─────────────────────────────────────
ALTER TABLE public.scale_insights_keyword_rank DROP CONSTRAINT uq_keyword_rank;
UPDATE public.scale_insights_keyword_rank SET keyword = '' WHERE keyword IS NULL; -- 0 rows
ALTER TABLE public.scale_insights_keyword_rank
  ALTER COLUMN keyword SET DEFAULT '', ALTER COLUMN keyword SET NOT NULL;
ALTER TABLE public.scale_insights_keyword_rank ADD CONSTRAINT uq_keyword_rank
  UNIQUE (brand_id, asin_id, keyword, report_date);

-- ── smartscout_subcategory_brands (subcategory) + drop the redundant twin ─────
-- Twin uq_smartscout_brands (migration 019) is already absent live; DROP IF EXISTS is a defensive
-- no-op so it can never resurface. The live upsert key targets uq_sscb.
ALTER TABLE public.smartscout_subcategory_brands DROP CONSTRAINT IF EXISTS uq_smartscout_brands;
ALTER TABLE public.smartscout_subcategory_brands DROP CONSTRAINT uq_sscb;
UPDATE public.smartscout_subcategory_brands SET subcategory = '' WHERE subcategory IS NULL; -- 0 rows
ALTER TABLE public.smartscout_subcategory_brands
  ALTER COLUMN subcategory SET DEFAULT '', ALTER COLUMN subcategory SET NOT NULL;
ALTER TABLE public.smartscout_subcategory_brands ADD CONSTRAINT uq_sscb
  UNIQUE (brand_id, brand_name, subcategory, snapshot_date);

-- ── subscribe_and_save (sku) ──────────────────────────────────────────────────
ALTER TABLE public.subscribe_and_save DROP CONSTRAINT uq_subscribe_and_save;
UPDATE public.subscribe_and_save SET sku = '' WHERE sku IS NULL;                  -- 0 rows
ALTER TABLE public.subscribe_and_save
  ALTER COLUMN sku SET DEFAULT '', ALTER COLUMN sku SET NOT NULL;
ALTER TABLE public.subscribe_and_save ADD CONSTRAINT uq_subscribe_and_save
  UNIQUE (brand_id, asin_id, sku, report_date);

-- ── key-semantics comments ────────────────────────────────────────────────────
COMMENT ON COLUMN public.sp_targeting_report.targeting  IS 'Targeting expression; NOT NULL DEFAULT '''' — '''' = none (INB-151).';
COMMENT ON COLUMN public.sp_targeting_report.match_type IS 'Match type; NOT NULL DEFAULT '''' — '''' = none (INB-151).';
COMMENT ON COLUMN public.sp_campaign_performance.ad_type IS 'SP/SB/SBV from campaign-name prefix; NOT NULL DEFAULT '''' (INB-151).';
COMMENT ON COLUMN public.sp_search_term_report.customer_search_term IS 'Customer search term; NOT NULL DEFAULT '''' (INB-151).';
COMMENT ON COLUMN public.sp_search_term_report.targeting IS 'Targeting expression; NOT NULL DEFAULT '''' (INB-151).';
COMMENT ON COLUMN public.scale_insights_keyword_rank.keyword IS 'Tracked keyword; NOT NULL DEFAULT '''' (INB-151).';
COMMENT ON COLUMN public.smartscout_subcategory_brands.subcategory IS 'Operator-selected subcategory; NOT NULL DEFAULT '''' (INB-151).';
COMMENT ON COLUMN public.subscribe_and_save.sku IS 'Seller SKU; NOT NULL DEFAULT '''' — '''' = none (INB-151).';
