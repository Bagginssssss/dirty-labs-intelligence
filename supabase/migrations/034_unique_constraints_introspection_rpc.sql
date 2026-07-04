-- 034: read-only introspection RPC for the upsert-config vs DB-constraint
-- detector (INB-88). Returns every non-partial, non-expression UNIQUE
-- index/constraint column set in the public schema.
--
-- SECURITY INVOKER: service_role (the only role granted EXECUTE) can already
-- read pg_catalog, so no privilege escalation is needed. Hardened regardless:
-- locked search_path, fully-qualified catalog references, pure SELECT.

CREATE OR REPLACE FUNCTION public.get_unique_constraint_columns()
RETURNS TABLE (table_name text, index_name text, columns text[])
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
    ) AS columns
  FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class t     ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_class i     ON i.oid = ix.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE ix.indisunique
    AND n.nspname = 'public'
    AND ix.indpred IS NULL    -- partial unique indexes cannot back a plain ON CONFLICT (cols)
    AND ix.indexprs IS NULL;  -- expression indexes cannot match a column-list conflict target
$$;

REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_unique_constraint_columns() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_unique_constraint_columns() TO service_role;
