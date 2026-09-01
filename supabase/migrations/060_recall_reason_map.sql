-- 060: INB-177 — map the RECALL return reason code to product_fault.
--
-- The 2026 FBA Customer Returns census surfaced one row with reason='RECALL', a code absent from the
-- 22-code seed (migration 052) → it stored fault_class='unmapped' and raised the loader's unmapped-code
-- warning. A product recall is a product-level defect/safety issue, so it buckets with DEFECTIVE /
-- QUALITY_UNACCEPTABLE as product_fault (operator-confirmed taxonomy, INB-177 G1).
--
-- This INSERT updates the LIVE join (sku_return_rates reads return_reason_map directly), but it does
-- NOT reclassify the already-stored fba_customer_returns.fault_class snapshot — that row is backfilled
-- separately by scripts/inb177-recall-backfill.mjs (a stored 'unmapped' → 'product_fault' UPDATE).
-- Mirrored in lib/return-reason-map.ts (RETURN_REASON_BUCKETS) in the same commit.
INSERT INTO public.return_reason_map (reason_code, fault_class, notes) VALUES
  ('RECALL', 'product_fault', 'Product recall — defect/safety issue (INB-177)')
ON CONFLICT (reason_code) DO NOTHING;
