import { MappedRow, RawRow, MapperContext, makeGetter, parseDate, parseNumeric } from './types'

export interface SmartscoutSubcategoryProductsRow extends MappedRow {
  snapshot_date: string | null
  parent_asin: string | null
  asin: string | null
  subcategory: string | null
  title: string | null
  brand_name: string | null
  category: string | null
  primary_subcategory_rank: number | null
  est_monthly_revenue: number | null
  ttm_revenue: number | null
  ttm_revenue_change: number | null
  opportunity_score: number | null
  is_variation: boolean | null
  price: number | null
  review_count: number | null
  review_rating: number | null
  fulfillment_type: string | null
  listing_quality_score: number | null
  monthly_units_sold: number | null
  num_sellers: number | null
  buy_box_pct: number | null
  has_coupons: boolean | null
  asin_count: number | null
  monthly_revenue_per_review: number | null
  monthly_revenue_growth: number | null
  avg_monthly_revenue: number | null
  avg_monthly_units: number | null
  category_revenue_rank: number | null
  category_revenue_pct: number | null
  brand_revenue_pct: number | null
  date_first_available: string | null
  seller_type: string | null
}

function mapOneRow(
  row: RawRow,
  brandId: string,
  snapshotDate: string | null
): SmartscoutSubcategoryProductsRow | null {
  const get = makeGetter(row)

  const asinRaw = get('', 'ASIN', 'asin')
  const parentAsinRaw = get('', 'Parent ASIN', 'parent_asin')
  const effectiveParentAsin = parentAsinRaw || asinRaw
  // Actual SmartScout header: "Primary Subcategory Name" → primary_subcategory_name
  const subcategory = get('', 'Primary Subcategory Name', 'Primary Subcategory', 'Subcategory', 'subcategory') || null

  if (!asinRaw || !subcategory) return null

  const isVariationRaw = get('', 'Is Variation', 'is_variation')
  const hasCouponsRaw = get('', 'Has Coupons', 'has_coupons', 'Coupon')
  // TTM Revenue Change is a dollar amount with quotes: "$4,962,962.30"
  const ttmRevenueChangeRaw = get('', 'TTM Revenue Change', 'TTM Revenue Change %', 'ttm_revenue_change')

  return {
    brand_id:                   brandId,
    snapshot_date:              snapshotDate,
    parent_asin:                effectiveParentAsin || null,
    asin:                       asinRaw || null,
    subcategory,
    title:                      get('', 'Title', 'Product Title', 'title') || null,
    brand_name:                 get('', 'Brand', 'brand_name', 'brand') || null,
    // Actual header: "Main Category Name"
    category:                   get('', 'Main Category Name', 'Main Category', 'Category', 'category') || null,
    primary_subcategory_rank:   parseNumeric(get('', 'Primary Subcategory Rank', 'primary_subcategory_rank', 'Subcategory Rank')),
    est_monthly_revenue:        parseNumeric(get('', 'Est. Monthly Revenue', 'Estimated Monthly Revenue', 'est_monthly_revenue')),
    // Actual header: "Est. 12 Month Revenue" (trailing 12-month revenue)
    ttm_revenue:                parseNumeric(get('', 'Est. 12 Month Revenue', 'TTM Revenue', 'ttm_revenue')),
    ttm_revenue_change:         parseNumeric(ttmRevenueChangeRaw.replace(/"/g, '')),
    opportunity_score:          parseNumeric(get('', 'Opportunity Score', 'opportunity_score')),
    is_variation:               isVariationRaw === 'TRUE' ? true : isVariationRaw === 'FALSE' ? false : null,
    // Actual header: "Buy Box Price" (closest proxy for product price)
    price:                      parseNumeric(get('', 'Buy Box Price', 'Price', 'price')),
    // Actual headers: "Listing Review Count", "Child Review Count"
    review_count:               parseNumeric(get('', 'Listing Review Count', 'Child Review Count', 'Review Count', 'review_count')),
    review_rating:              parseNumeric(get('', 'Rating', 'Star Rating', 'review_rating', 'stars')),
    fulfillment_type:           get('', 'Fulfillment', 'fulfillment_type', 'FBA/FBM', 'Fulfillment Type') || null,
    // Actual header: "Page Score"
    listing_quality_score:      parseNumeric(get('', 'Page Score', 'Listing Quality Score', 'listing_quality_score', 'LQS')),
    // Actual header: "Est. Monthly Units Sold"
    monthly_units_sold:         parseNumeric(get('', 'Est. Monthly Units Sold', 'Est. Monthly Units', 'Estimated Monthly Units', 'monthly_units_sold')),
    // Actual header: "All Sellers" (total seller count)
    num_sellers:                parseNumeric(get('', 'All Sellers', 'FBA Sellers', 'Sellers', 'num_sellers')),
    buy_box_pct:                parseNumeric(get('', 'Buy Box %', 'buy_box_pct', 'Buy Box Percentage')),
    has_coupons:                hasCouponsRaw === 'TRUE' ? true : hasCouponsRaw === 'FALSE' ? false : null,
    // Actual header: "Item Count"
    asin_count:                 parseNumeric(get('', 'Item Count', '# ASINs', 'ASIN Count', 'asin_count')),
    monthly_revenue_per_review: parseNumeric(get('', 'Monthly Revenue per Review', 'monthly_revenue_per_review')),
    // Actual header: "1 Month Growth" (stored as decimal fraction, e.g. 0.044 = 4.4%)
    monthly_revenue_growth:     parseNumeric(get('', '1 Month Growth', 'Monthly Revenue Growth %', 'Monthly Revenue Growth', 'monthly_revenue_growth')),
    avg_monthly_revenue:        parseNumeric(get('', 'Avg Monthly Revenue', 'avg_monthly_revenue', 'Average Monthly Revenue')),
    avg_monthly_units:          parseNumeric(get('', 'Avg Monthly Units', 'avg_monthly_units', 'Average Monthly Units')),
    // Actual header: "Main Category Rank"
    category_revenue_rank:      parseNumeric(get('', 'Main Category Rank', 'Category Revenue Rank', 'category_revenue_rank')),
    category_revenue_pct:       parseNumeric(get('', 'Category Revenue %', 'Category Revenue Percentage', 'category_revenue_pct')),
    brand_revenue_pct:          parseNumeric(get('', 'Brand Revenue %', 'Brand Revenue Percentage', 'brand_revenue_pct')),
    date_first_available:       parseDate(get('', 'Date First Available', 'date_first_available', 'First Available Date')),
    seller_type:                get('', 'Seller Type', 'seller_type') || null,
  }
}

// Batch mapper: pre-processes all rows, groups by (parent_asin, subcategory),
// and keeps the row with the lowest primary_subcategory_rank per group.
export function mapSmartscoutSubcategoryProducts(
  rows: RawRow[],
  brandId: string,
  context?: MapperContext
): SmartscoutSubcategoryProductsRow[] {
  const snapshotDate = context?.date_range_start ?? null

  const mapped = rows
    .map(row => mapOneRow(row, brandId, snapshotDate))
    .filter((r): r is SmartscoutSubcategoryProductsRow => r !== null)

  const seen = new Map<string, SmartscoutSubcategoryProductsRow>()
  for (const row of mapped) {
    const key = `${row.parent_asin ?? ''}::${row.subcategory ?? ''}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, row)
    } else {
      const existingRank = (existing.primary_subcategory_rank as number | null) ?? Infinity
      const newRank = (row.primary_subcategory_rank as number | null) ?? Infinity
      if (newRank < existingRank) seen.set(key, row)
    }
  }

  return Array.from(seen.values())
}
