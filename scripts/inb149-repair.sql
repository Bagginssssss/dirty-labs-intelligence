-- INB-149 data repair — run AFTER migration 041 is applied, BEFORE migration 042.
-- Reviewable script; executed chat-side (not by the agent), as a gated step.
--
-- Goal: backfill ad_type on all purchased_product_report rows, then remove the
-- lossy SB rows (advertised_asin IS NULL) so migration 042 can build a NULL-proof
-- unique key. The dropped SB metrics are recovered by re-uploading the SB export
-- through the new aggregating mapper (INB-149 code). The deleted rows are archived
-- first, so the DELETE is reversible until explicitly dropped after QC.
--
-- ⚠️ STEP 0 (SAFETY PROOF) MUST PASS BEFORE THE DELETE. Numbers verified 2026-07-09;
--    re-run at apply time — more weekly SB files may have landed since.

-- ── STEP 0a — no SP data in the delete set ────────────────────────────────────
-- Every campaign that has any null-advertised_asin row must have ZERO
-- advertised_asin-populated (SP-export) rows. unsafe_null_rows_in_mixed_campaigns
-- MUST be 0. If it is > 0, ABORT — a genuine SP campaign would lose data.
WITH per_campaign AS (
  SELECT p.campaign_id, c.campaign_name,
         COUNT(*) FILTER (WHERE p.advertised_asin IS NULL)     AS null_rows,
         COUNT(*) FILTER (WHERE p.advertised_asin IS NOT NULL) AS nonnull_rows
  FROM public.purchased_product_report p
  JOIN public.campaigns c ON c.id = p.campaign_id
  GROUP BY p.campaign_id, c.campaign_name
)
SELECT
  (SELECT COALESCE(SUM(null_rows), 0) FROM per_campaign WHERE null_rows > 0 AND nonnull_rows > 0)
    AS unsafe_null_rows_in_mixed_campaigns,   -- MUST be 0
  -- 0b — reconcile INB-145's "236": the only non-SB./SBV.-prefixed campaign in the
  -- delete set is "SB - Brand - Store Spotlight - Branded" (an SB Brand ad format;
  -- "SB " space, not "SB." dot). It is SB, not SP.
  (SELECT COALESCE(SUM(null_rows), 0) FROM per_campaign
     WHERE null_rows > 0 AND campaign_name NOT ILIKE 'SB.%' AND campaign_name NOT ILIKE 'SBV.%')
    AS non_sbdot_null_rows,
  (SELECT COUNT(*) FROM per_campaign WHERE null_rows > 0 AND nonnull_rows > 0)
    AS mixed_campaign_count;                   -- MUST be 0

-- Optional detail: list the non-SB./SBV. campaigns in the delete set (expect only
-- "SB - Brand - Store Spotlight - Branded").
WITH per_campaign AS (
  SELECT c.campaign_name,
         COUNT(*) FILTER (WHERE p.advertised_asin IS NULL) AS null_rows,
         COUNT(*) FILTER (WHERE p.advertised_asin IS NOT NULL) AS nonnull_rows
  FROM public.purchased_product_report p
  JOIN public.campaigns c ON c.id = p.campaign_id
  GROUP BY c.campaign_name
)
SELECT campaign_name, null_rows, nonnull_rows
FROM per_campaign
WHERE null_rows > 0 AND campaign_name NOT ILIKE 'SB.%' AND campaign_name NOT ILIKE 'SBV.%'
ORDER BY null_rows DESC;

-- ── STEP 1 — archive the delete set (reversible until dropped post-QC) ─────────
CREATE TABLE public.purchased_product_report_sb_pre149 AS
  SELECT * FROM public.purchased_product_report WHERE advertised_asin IS NULL;

-- ── STEP 2 — backfill ad_type on ALL rows ─────────────────────────────────────
-- advertised_asin present ⟺ SP export; NULL ⟺ SB family, split SBV vs SB by prefix.
UPDATE public.purchased_product_report p
SET ad_type = CASE
  WHEN p.advertised_asin IS NOT NULL THEN 'SP'
  WHEN c.campaign_name ILIKE 'SBV.%'  THEN 'SBV'
  ELSE 'SB'
END
FROM public.campaigns c
WHERE c.id = p.campaign_id;

-- ── STEP 3 — delete the lossy SB rows (only after STEP 0a = 0) ─────────────────
DELETE FROM public.purchased_product_report WHERE advertised_asin IS NULL;

-- ── STEP 4 — verification (all must hold) ─────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.purchased_product_report WHERE advertised_asin IS NULL) AS remaining_null_asin,     -- 0
  (SELECT COUNT(*) FROM public.purchased_product_report WHERE ad_type IS NULL)          AS ad_type_null,             -- 0
  (SELECT COUNT(*) FROM public.purchased_product_report WHERE ad_type <> 'SP')          AS survivors_not_sp,         -- 0 (all survivors are SP until SB re-upload)
  (SELECT COUNT(*) FROM public.purchased_product_report_sb_pre149)                      AS archived_rows,            -- = pre-delete null_asin count
  (SELECT COALESCE(SUM(n - 1), 0) FROM (
     SELECT COUNT(*) n FROM public.purchased_product_report
     GROUP BY brand_id, campaign_id, report_date, ad_type,
              COALESCE(advertised_asin, ''), COALESCE(purchased_asin, ''), COALESCE(attribution_type, '')
     HAVING COUNT(*) > 1) d)                                                            AS dupes_on_new_key;         -- 0
