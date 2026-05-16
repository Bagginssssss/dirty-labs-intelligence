-- ============================================================
-- 030: UNIQUE constraints for sp_search_term_report, sp_targeting_report,
--      and purchased_product_report. Enables ON CONFLICT DO UPDATE upsert
--      so rolling re-pulls overwrite stale rows instead of duplicating them.
--      INB-82 Sub-task 2.
-- ============================================================

-- ─── sp_search_term_report ───────────────────────────────────────────────────
-- Natural key: (brand, campaign, ad_group, date, customer search term, targeting).
-- Real Amazon exports always populate customer_search_term and targeting, so the
-- standard UNIQUE constraint (which treats NULLs as distinct) is safe in practice.
-- Dedup with COALESCE before adding the constraint to handle any pre-fix nulls.

DELETE FROM sp_search_term_report
WHERE id NOT IN (
  SELECT DISTINCT ON (
    brand_id, campaign_id, ad_group_id, report_date,
    COALESCE(customer_search_term, ''), COALESCE(targeting, '')
  ) id
  FROM sp_search_term_report
  ORDER BY
    brand_id, campaign_id, ad_group_id, report_date,
    COALESCE(customer_search_term, ''), COALESCE(targeting, ''),
    ingested_at DESC
);

ALTER TABLE sp_search_term_report
ADD CONSTRAINT uq_sp_search_term_report
UNIQUE (brand_id, campaign_id, ad_group_id, report_date, customer_search_term, targeting);

-- ─── sp_targeting_report ─────────────────────────────────────────────────────
-- Natural key: (brand, campaign, ad_group, date, targeting expression, match type).
-- targeting is always populated in real exports; match_type is always populated
-- for keyword/product targets (BROAD/PHRASE/EXACT/TARGETING_EXPRESSION).

DELETE FROM sp_targeting_report
WHERE id NOT IN (
  SELECT DISTINCT ON (
    brand_id, campaign_id, ad_group_id, report_date,
    COALESCE(targeting, ''), COALESCE(match_type, '')
  ) id
  FROM sp_targeting_report
  ORDER BY
    brand_id, campaign_id, ad_group_id, report_date,
    COALESCE(targeting, ''), COALESCE(match_type, ''),
    ingested_at DESC
);

ALTER TABLE sp_targeting_report
ADD CONSTRAINT uq_sp_targeting_report
UNIQUE (brand_id, campaign_id, ad_group_id, report_date, targeting, match_type);

-- ─── purchased_product_report ────────────────────────────────────────────────
-- Natural key: (brand, campaign, date, advertised ASIN, purchased ASIN).
-- Both ASIN columns are always populated in real Amazon exports.

DELETE FROM purchased_product_report
WHERE id NOT IN (
  SELECT DISTINCT ON (
    brand_id, campaign_id, report_date,
    COALESCE(advertised_asin, ''), COALESCE(purchased_asin, '')
  ) id
  FROM purchased_product_report
  ORDER BY
    brand_id, campaign_id, report_date,
    COALESCE(advertised_asin, ''), COALESCE(purchased_asin, ''),
    ingested_at DESC
);

ALTER TABLE purchased_product_report
ADD CONSTRAINT uq_purchased_product_report
UNIQUE (brand_id, campaign_id, report_date, advertised_asin, purchased_asin);
