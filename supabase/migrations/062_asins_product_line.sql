-- 062: INB-179 — populate asins.product_line from the canonical category map (G1-approved, final).
--
-- 29 of 60 ASINs are categorised into 5 stable slugs; 31 stay NULL deliberately (see the column
-- comment). Slugs are STORAGE values — display labels live in the report layer (the buckets have been
-- relabelled for a client audience before and will be again). This column is the denominator for every
-- category figure in a client-facing report, so the migration SELF-VERIFIES and ABORTS on any mismatch.
--
-- Scope: product_line only. title / parent_asin / active are untouched. No new table / view / function.
-- Idempotent: the UPDATEs re-set the same values, the CHECK add is guarded, the assertions re-verify.

-- ── 1. Populate the 29 categorised ASINs (one UPDATE per slug, mirroring the approved map) ──
UPDATE public.asins SET product_line = 'laundry_detergent' WHERE asin IN (
  'B09B7YS1VK','B09B85NVG9','B09B83NFKQ','B0BL8ZSV5X','B09B7Z4GPZ','B09B85YVMD','B0BL8MWLM5');
UPDATE public.asins SET product_line = 'laundry_booster' WHERE asin IN (
  'B09MSP7M5Y','B0DHF1MMNC','B0GWPKMJGQ');
UPDATE public.asins SET product_line = 'dish' WHERE asin IN (
  'B09B7WLWW3','B0GFBGMFY7','B0HF6F4QXB','B09B85NGBT','B0GFBPHBQ1','B0HF6FC28C');
UPDATE public.asins SET product_line = 'toilet' WHERE asin IN (
  'B0FQPMNJ6Z');
UPDATE public.asins SET product_line = 'accessories' WHERE asin IN (
  'B09B8LKQGR','B0CZFQ5GLV','B0BPJSPLHQ','B0CCCBQ7ZM','B0CZ7NXY7S','B0D16KP62H','B0DC21PZ1C',
  'B0C34XDGFG','B0DYNR62RJ','B0GWPMKF2J','B0GWPK14QL','B0CZG2XHKC');

-- ── 2. CHECK constraint: only the 5 slugs or NULL (guarded add → idempotent) ──
DO $$ BEGIN
  ALTER TABLE public.asins
    ADD CONSTRAINT asins_product_line_check
    CHECK (product_line IS NULL OR product_line IN
      ('laundry_detergent','laundry_booster','dish','toilet','accessories'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Document the deliberate NULL (three distinct meanings). Adjacent string literals separated by a
--       newline are concatenated by Postgres, so this is one comment string. ──
COMMENT ON COLUMN public.asins.product_line IS
  'Canonical category slug (INB-179): laundry_detergent | laundry_booster | dish | toilet | accessories. '
  'Storage value only — display labels live in the report layer, not here (buckets get relabelled for '
  'client audiences). NULL is DELIBERATE and carries three distinct meanings: (1) virtual bundle — Amazon '
  'attributes bundle sales to the component ASINs, so these carry $0 in business_report and are excluded '
  'to prevent double-counting (the set is sourced from virtual_bundle_sales_daily, not hardcoded); '
  '(2) variation parent — $0 ordered revenue across every window, excluded so every category denominator '
  'is built the same way; (3) dormant — no title, no sales. Do NOT add a second category column.';

-- ── 4. Self-verify — abort the whole migration on any mismatch (client-facing denominator) ──
DO $$
DECLARE
  n_ld int; n_lb int; n_di int; n_to int; n_ac int; n_cat int; n_null int; n_total int;
  n_bundles int; n_bundle_categorised int;
BEGIN
  SELECT count(*) FILTER (WHERE product_line = 'laundry_detergent'),
         count(*) FILTER (WHERE product_line = 'laundry_booster'),
         count(*) FILTER (WHERE product_line = 'dish'),
         count(*) FILTER (WHERE product_line = 'toilet'),
         count(*) FILTER (WHERE product_line = 'accessories'),
         count(*) FILTER (WHERE product_line IS NOT NULL),
         count(*) FILTER (WHERE product_line IS NULL),
         count(*)
    INTO n_ld, n_lb, n_di, n_to, n_ac, n_cat, n_null, n_total
    FROM public.asins;
  SELECT count(DISTINCT bundle_asin) INTO n_bundles FROM public.virtual_bundle_sales_daily;
  SELECT count(*) INTO n_bundle_categorised FROM public.asins
    WHERE product_line IS NOT NULL
      AND asin IN (SELECT DISTINCT bundle_asin FROM public.virtual_bundle_sales_daily);

  IF n_ld  <> 7  THEN RAISE EXCEPTION 'laundry_detergent = % (expected 7)', n_ld; END IF;
  IF n_lb  <> 3  THEN RAISE EXCEPTION 'laundry_booster = % (expected 3)', n_lb; END IF;
  IF n_di  <> 6  THEN RAISE EXCEPTION 'dish = % (expected 6)', n_di; END IF;
  IF n_to  <> 1  THEN RAISE EXCEPTION 'toilet = % (expected 1)', n_to; END IF;
  IF n_ac  <> 12 THEN RAISE EXCEPTION 'accessories = % (expected 12)', n_ac; END IF;
  IF n_cat <> 29 THEN RAISE EXCEPTION 'categorised = % (expected 29)', n_cat; END IF;
  IF n_null <> 31 THEN RAISE EXCEPTION 'NULL = % (expected 31)', n_null; END IF;
  IF n_total <> 60 THEN RAISE EXCEPTION 'total = % (expected 60)', n_total; END IF;
  IF n_bundles <> 23 THEN RAISE EXCEPTION 'virtual bundle set = % (expected 23)', n_bundles; END IF;
  IF n_bundle_categorised <> 0 THEN
    RAISE EXCEPTION '% bundle ASIN(s) carry a category (expected 0 — would double-count)', n_bundle_categorised;
  END IF;
  RAISE NOTICE 'INB-179 OK — 7/3/6/1/12 categorised, 31 NULL, 60 total; 23 bundles, 0 categorised bundles.';
END $$;
