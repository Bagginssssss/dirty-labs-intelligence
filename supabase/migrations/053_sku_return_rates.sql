-- 053: sku_return_rates — the NCX (negative-customer-experience) proxy view (INB-160).
--
-- Weekly product-fault return rate per SKU: returned units and product-fault units bucketed to
-- SUNDAY-anchored weeks (matching sku_economics_weekly.week_start), over units_sold from
-- sku_economics_weekly at the same (week, MSKU) grain.
--
-- CAVEATS (documented, by design):
--  * PERIOD-RATE PROXY, not a cohort rate: a return in week W is divided by units SOLD in week W,
--    but the returned unit was almost always sold in an EARLIER week (return week != sale week).
--    Tracks direction/trend, not a true per-cohort return rate.
--  * NCX proxy only: refunds-without-return and CS contacts/buyer-messages also feed Amazon's NCX
--    and are not exportable, so this won't match Amazon's published NCX number.
--  * fault_class is the LIVE return_reason_map join (authoritative) — re-bucketing a reason code
--    updates this view immediately (the fba_customer_returns.fault_class column is only an
--    ingest-time snapshot). Unmapped reasons (no map row) are NOT counted as product-fault.
--  * NULL rates where there is no matching sku_economics_weekly sales row (never divide by 0 or a
--    missing denominator) — boundary weeks and MSKUs without economics coverage read NULL.

CREATE OR REPLACE VIEW public.sku_return_rates AS
WITH returns_weekly AS (
  SELECT
    r.brand_id,
    -- Sunday anchor: DOW(Sunday)=0, so subtracting DOW snaps any day back to its Sunday.
    (r.return_date - EXTRACT(DOW FROM r.return_date)::int) AS week_start,
    r.sku,
    max(r.asin)                                                    AS asin,
    sum(r.quantity)                                                AS returned_units,
    sum(r.quantity) FILTER (WHERE m.fault_class = 'product_fault') AS product_fault_units
  FROM public.fba_customer_returns r
  LEFT JOIN public.return_reason_map m ON m.reason_code = r.reason   -- live authoritative bucket
  GROUP BY r.brand_id, (r.return_date - EXTRACT(DOW FROM r.return_date)::int), r.sku
)
SELECT
  rw.brand_id,
  rw.week_start,
  rw.sku,
  rw.asin,
  rw.returned_units,
  COALESCE(rw.product_fault_units, 0)                                                   AS product_fault_units,
  e.units_sold,
  CASE WHEN e.units_sold > 0
       THEN round(rw.returned_units::numeric / e.units_sold, 4) END                     AS return_rate,
  CASE WHEN e.units_sold > 0
       THEN round(COALESCE(rw.product_fault_units, 0)::numeric / e.units_sold, 4) END   AS product_fault_rate
FROM returns_weekly rw
LEFT JOIN public.sku_economics_weekly e
  ON e.brand_id = rw.brand_id AND e.week_start = rw.week_start AND e.msku = rw.sku;

COMMENT ON VIEW public.sku_return_rates IS
  'NCX proxy (INB-160): weekly product-fault return rate per SKU. returned_units / product_fault_units bucketed to SUNDAY-anchored weeks (return_date - DOW), over sku_economics_weekly.units_sold at the same (week_start, msku=sku) grain. PERIOD-RATE PROXY — return week != sale week, so this tracks direction/trend, not a cohort rate; and it excludes refunds-without-return + CS contacts (not exportable), so it will not match Amazon''s NCX number. product-fault is the LIVE return_reason_map join (re-bucketing updates the view instantly); unmapped reasons are not counted. Rates are NULL where no sku_economics_weekly sales row covers the (week, sku).';

-- Derived read-only view — service_role is the platform's server-side read path (INB-162 convention).
GRANT SELECT ON public.sku_return_rates TO service_role;
