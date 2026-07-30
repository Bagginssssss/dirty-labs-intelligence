// INB-160 — Amazon reviews run list. 11 representative child ASINs, one per Dirty Labs parent
// family (the top-selling child), DERIVED from the live sku_economics_weekly parent_asin map on
// 2026-07-30. This is a DOCUMENTED CONFIG, not a hard-coded inline list — refresh it by re-running
// REFRESH_QUERY (below) against the live DB when the catalog changes, then update REVIEW_RUN_TARGETS.
//
// Why one child per parent (INB-160 "Pagination/permutation test result"): Axesso bills per result,
// and Amazon shares reviews across a parent's child ASINs — so querying every child pays for the
// same reviewId under each. One representative child per parent captures the family's reviews once.
// Cadence: monthly unfiltered `sortBy:recent` incrementals (which also feed rating snapshots);
// star-permutation runs backfill history (reviews only). See docs/reviews-backfill-runplan.md.

export interface ReviewRunTarget {
  asin: string          // child ASIN to query on Axesso
  parentAsin: string    // its parent family
  msku: string          // MSKU (provenance; split_part(msku,'-',1) cross-joins to economics/COGS)
  family?: string       // human label where known (from the ScaleInsights rank registry)
}

// Derived 2026-07-30 — top-selling child per parent by summed sku_economics_weekly.units_sold.
// Ordered by family volume at derivation time (units in the trailing comment).
export const REVIEW_RUN_TARGETS: ReviewRunTarget[] = [
  { asin: 'B09B85NGBT', parentAsin: 'B0GQ5C6CPX', msku: '113101-FBA',              family: 'Dishwasher Detergent' },       // 265,902 u (4 children)
  { asin: 'B09B7YS1VK', parentAsin: 'B09CLSSRR7', msku: '110116-FBA',              family: 'Liquid Laundry — Signature' },  // 210,957 u (7 children)
  { asin: 'B09MSP7M5Y', parentAsin: 'B0DJPZMWKT', msku: '112101-FBA',              family: 'Liquid Laundry — Scent Free' }, // 182,744 u (2 children)
  { asin: 'B0C34XDGFG', parentAsin: 'B0C34XDGFG', msku: '110197-FBA' },                                                     // 14,742 u (1)
  { asin: 'B09B8LKQGR', parentAsin: 'B0D7J5RNK3', msku: '112102-v2' },                                                      // 12,648 u (2)
  { asin: 'B0CCCBQ7ZM', parentAsin: 'B0D16KP62H', msku: 'Amazon.Found.B0CCCBQ7ZM' },                                        // 8,760 u (2)
  { asin: 'B0FQPMNJ6Z', parentAsin: 'B0FQPMNJ6Z', msku: 'FBA195Y2PXZ6.missing2',   family: 'Toilet Bowl Cleaner' },         // 5,082 u (1)
  { asin: 'B0DC21PZ1C', parentAsin: 'B0DC21PZ1C', msku: '112199-FBA' },                                                     // 3,296 u (1)
  { asin: 'B0DYNR62RJ', parentAsin: 'B0DYNR62RJ', msku: '110199-FBA' },                                                     // 1,193 u (1)
  { asin: 'B0CZG2XHKC', parentAsin: 'B0CZG2XHKC', msku: '114119-FBA' },                                                     // 243 u (1)
  { asin: 'B0BPJSPLHQ', parentAsin: 'B0BPJSPLHQ', msku: '112102-FBA' },                                                     // 181 u (1)
]

// Refresh: run against the live DB (brand 47a96175-ed58-4104-a2ff-c925d6143309), then reconcile
// REVIEW_RUN_TARGETS with the result. Picks the highest-units child per parent family.
export const REFRESH_QUERY = `
WITH child AS (
  SELECT parent_asin, asin, sum(units_sold) AS units, sum(net_sales) AS net_sales, max(msku) AS a_msku
  FROM sku_economics_weekly
  WHERE brand_id = '47a96175-ed58-4104-a2ff-c925d6143309'
    AND parent_asin IS NOT NULL AND asin IS NOT NULL
  GROUP BY parent_asin, asin
), ranked AS (
  SELECT parent_asin, asin, a_msku,
         row_number() OVER (PARTITION BY parent_asin
                            ORDER BY units DESC NULLS LAST, net_sales DESC NULLS LAST) AS rn
  FROM child
)
SELECT parent_asin, asin AS top_child_asin, a_msku AS msku
FROM ranked WHERE rn = 1
ORDER BY parent_asin;`
