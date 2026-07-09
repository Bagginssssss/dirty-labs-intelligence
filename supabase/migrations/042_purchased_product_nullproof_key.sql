-- 042: NULL-proof purchased_product_report key + ad_type discriminator flip +
--      constraint-nullability introspection (INB-149).
--
-- Runs AFTER the data repair (scripts/inb149-repair.sql): ad_type is backfilled on
-- every row and the lossy NULL-advertised_asin SB rows are deleted, so the survivors
-- (all SP) are unique on the new key and NULLs can be eliminated from the key columns.
--
-- Why the key must change: NULL advertised_asin sat in the old unique key and Postgres
-- treats NULLs as distinct, so overlapping SB uploads duplicated silently (INB-82
-- failure mode). The INB-148 fix pattern: key text columns NOT NULL DEFAULT '', plain
-- column-list constraint. ad_type joins the key so SP and SB/SBV rows partition cleanly;
-- attribution_type joins so SB Promoted vs Brand Halo rows stay distinct.

-- ── 1. NULL-proof the key columns (backfill NULL→'' then constrain) ────────────
ALTER TABLE public.purchased_product_report ALTER COLUMN advertised_asin  SET DEFAULT '';
ALTER TABLE public.purchased_product_report ALTER COLUMN purchased_asin   SET DEFAULT '';
ALTER TABLE public.purchased_product_report ALTER COLUMN attribution_type SET DEFAULT '';

UPDATE public.purchased_product_report SET advertised_asin  = '' WHERE advertised_asin  IS NULL;
UPDATE public.purchased_product_report SET purchased_asin   = '' WHERE purchased_asin   IS NULL;
UPDATE public.purchased_product_report SET attribution_type = '' WHERE attribution_type IS NULL;

ALTER TABLE public.purchased_product_report ALTER COLUMN advertised_asin  SET NOT NULL;
ALTER TABLE public.purchased_product_report ALTER COLUMN purchased_asin   SET NOT NULL;
ALTER TABLE public.purchased_product_report ALTER COLUMN attribution_type SET NOT NULL;
-- ad_type is backfilled to SP/SB/SBV on every row by the repair; never '' — NOT NULL, no default.
ALTER TABLE public.purchased_product_report ALTER COLUMN ad_type SET NOT NULL;

-- ── 2. Swap the unique constraint to the NULL-proof 7-column key ──────────────
ALTER TABLE public.purchased_product_report DROP CONSTRAINT IF EXISTS uq_purchased_product_report;
ALTER TABLE public.purchased_product_report
  ADD CONSTRAINT uq_purchased_product_report UNIQUE
  (brand_id, campaign_id, report_date, ad_type, advertised_asin, purchased_asin, attribution_type);

-- ── 3. Extend the INB-88 introspection RPC with per-column nullability ─────────
-- Adds nullable_columns (the key columns whose attnotnull=false) so the checker can
-- flag the nullable-in-unique-key defect class account-wide. RETURNS TABLE signature
-- changes, so DROP + CREATE (CREATE OR REPLACE cannot alter the return type). Same
-- hardening as migration 034: SECURITY INVOKER, locked search_path, pg_catalog-qualified.
DROP FUNCTION IF EXISTS public.get_unique_constraint_columns();
CREATE FUNCTION public.get_unique_constraint_columns()
RETURNS TABLE (table_name text, index_name text, columns text[], nullable_columns text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    t.relname::text  AS table_name,
    i.relname::text  AS index_name,
    (
      SELECT pg_catalog.array_agg(a.attname::text ORDER BY x.ordinality)
      FROM pg_catalog.unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = t.oid AND a.attnum = x.attnum
    ) AS columns,
    (
      SELECT pg_catalog.array_agg(a.attname::text ORDER BY x.ordinality)
      FROM pg_catalog.unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE a.attnotnull = false
    ) AS nullable_columns
  FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class t     ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_class i     ON i.oid = ix.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE ix.indisunique
    AND n.nspname = 'public'
    AND ix.indpred IS NULL
    AND ix.indexprs IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_unique_constraint_columns() TO service_role;

-- ── 4. Flip the report_registry discriminators to ad_type (INB-149) ───────────
-- Paired with lib/report-registry.ts in the code commit; re-run npm run check:registry.
UPDATE public.report_registry
SET discriminator = '{"column":"ad_type","values":["SP"]}'::jsonb,
    notes = 'SP Sponsored Products purchased-product export (ad_type=SP; advertised_asin populated). Repaired in INB-149.',
    updated_at = now()
WHERE report_key = 'sp_purchased_product';

UPDATE public.report_registry
SET discriminator = '{"column":"ad_type","values":["SB","SBV"]}'::jsonb,
    notes = 'SB Attributed Purchases export (SB + SBV campaigns). The only purchase-level NTB source for SB. Aggregated per (campaign, report_date, purchased_asin, attribution_type); dedicated detector + mapper landed in INB-149.',
    updated_at = now()
WHERE report_key = 'sb_attributed_purchases';
