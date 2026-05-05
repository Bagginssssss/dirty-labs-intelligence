export interface DetectionResult {
  reportType: string
  tableName: string
  hint?: string   // optional extra context for the mapper, e.g. 'SB'
}

function normalize(header: string): string {
  return header
    .replace(/^﻿/, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Returns true when EVERY substring appears in at least one normalized header.
function has(normHeaders: string[], ...substrings: string[]): boolean {
  return substrings.every(sub => normHeaders.some(h => h.includes(sub)))
}

// Returns true when NO normalized header contains ANY of the substrings.
function lacks(normHeaders: string[], ...substrings: string[]): boolean {
  return substrings.every(sub => !normHeaders.some(h => h.includes(sub)))
}

// ─── Signature table ──────────────────────────────────────────────────────────
//
// ORDER IS SIGNIFICANT — first match wins.
// Rule: most-specific (fewest possible false positives) → least-specific.
//
//  1. search_query_performance — unique triple: search_query_score + impressions_total_count
//                                + purchases_brand_count
//  2. virtual_bundle_sales     — unique triple: bundle_asin + bundles_sold + total_sales
//  3. sb_search_term (hint SB) — customer_search_term + viewable_impressions + cost_type
//                                MUST precede generic SP check; SB files have all three.
//  4. sp_search_term_report    — unique column "customer_search_term"
//  5. sp_targeting_report      — unique column "top_of_search_impression_share"
//                                MUST precede smartscout_share_of_voice because
//                                "impression_share" is a substring of
//                                "top_of_search_impression_share".
//  6. purchased_product_report — unique column "purchased_asin"
//  7. scale_insights_bid_log   — unique columns "bid_before" / "bid_after"
//  8. scale_insights_kw_rank   — unique column "organic_rank"
//  9. subscribe_and_save       — unique column "active_subscriptions"
// 10. smartscout_brand_revenue — unique column "competitor_brand"
// 11. business_report          — "sessions" + "buy_box"/"page_views" (fairly unique)
// 12. smartscout_share_of_voice— "impression_share"/"click_share" with guards
//                                (lacks targeting/match_type to exclude targeting reports)
// 13. sp_campaign_performance  — most generic; last resort for Amazon campaign CSV

const SIGNATURES: Array<{
  reportType: string
  tableName: string
  hint?: string
  match: (h: string[]) => boolean
}> = [
  {
    // Amazon Brand Analytics: Search Query Performance report.
    // "Impressions: Total Count" normalises to "impressions_total_count" (": " → "_").
    // "Purchases: Brand Count"   normalises to "purchases_brand_count".
    // All three are absent from every other known report type.
    reportType: 'search_query_performance',
    tableName: 'search_query_performance',
    match: h =>
      has(h, 'search_query_score') &&
      has(h, 'impressions_total_count') &&
      has(h, 'purchases_brand_count'),
  },
  {
    // Amazon Virtual Bundle Sales report.
    // BUNDLE_ASIN, BUNDLES_SOLD, and TOTAL_SALES are unique to this export.
    reportType: 'virtual_bundle_sales',
    tableName:  'virtual_bundle_sales',
    match: h =>
      has(h, 'bundle_asin') &&
      has(h, 'bundles_sold') &&
      has(h, 'total_sales'),
  },
  {
    // SB Search Term Report shares the same table as SP.
    // Differentiators: "Viewable Impressions" and "Cost type" — absent from SP exports.
    reportType: 'sp_search_term_report',
    tableName: 'sp_search_term_report',
    hint: 'SB',
    match: h =>
      has(h, 'customer_search_term') &&
      has(h, 'viewable_impressions') &&
      has(h, 'cost_type'),
  },
  {
    reportType: 'sp_search_term_report',
    tableName: 'sp_search_term_report',
    match: h => has(h, 'customer_search_term'),
  },
  {
    // SB Keyword Report shares the same table as SP Targeting.
    // Differentiator: "Viewable Impressions" — present in SB export, absent from SP.
    // MUST precede the generic SP check; SB files match all four conditions.
    reportType: 'sp_targeting_report',
    tableName: 'sp_targeting_report',
    hint: 'SB',
    match: h =>
      has(h, 'top_of_search_impression_share') &&
      has(h, 'targeting') &&
      has(h, 'match_type') &&
      has(h, 'viewable_impressions'),
  },
  {
    // Confirmed Amazon header: "Top-of-search Impression Share"
    // Normalises to:           "top_of_search_impression_share"
    // Use the full normalised form so "impression_share" (SmartScout) cannot collide.
    // lacks viewable_impressions guards against matching the SB Keyword Report above.
    reportType: 'sp_targeting_report',
    tableName: 'sp_targeting_report',
    match: h =>
      has(h, 'top_of_search_impression_share') &&
      has(h, 'targeting') &&
      has(h, 'match_type') &&
      lacks(h, 'customer_search_term') &&
      lacks(h, 'viewable_impressions'),
  },
  {
    reportType: 'purchased_product_report',
    tableName: 'purchased_product_report',
    match: h => has(h, 'purchased_asin') || (has(h, 'advertised_asin') && has(h, 'purchased_title')),
  },
  {
    // Confirmed Scale Insights Bid Change Log headers: "Rule", "Criteria", "Change".
    // "Change" encodes bids as "0.50 -> 0.75" — no explicit bid_before / bid_after columns.
    reportType: 'scale_insights_bid_log',
    tableName: 'scale_insights_bid_log',
    match: h => has(h, 'rule') && has(h, 'criteria') && has(h, 'change'),
  },
  {
    // Fallback for older Scale Insights exports with explicit bid_before / bid_after columns.
    reportType: 'scale_insights_bid_log',
    tableName: 'scale_insights_bid_log',
    match: h => has(h, 'bid_before') || has(h, 'bid_after'),
  },
  {
    // Wide-pivot format: date columns appear as YYYY-MM-DD headers (normalised to
    // YYYY_MM_DD by the normalize() function). Unique combo: tracked + keyword +
    // query_volume + at least one date column header.
    reportType: 'scale_insights_keyword_rank',
    tableName: 'scale_insights_keyword_rank',
    match: h =>
      has(h, 'tracked') &&
      has(h, 'keyword') &&
      has(h, 'query_volume') &&
      h.some(header => /^\d{4}_\d{2}_\d{2}$/.test(header)),
  },
  {
    // Fallback for older Scale Insights exports that include an organic_rank column.
    reportType: 'scale_insights_keyword_rank',
    tableName: 'scale_insights_keyword_rank',
    match: h => has(h, 'organic_rank'),
  },
  {
    // Confirmed Amazon S&S headers normalise as:
    //   "SnS shipped units"              → "sn_s_shipped_units" ... actually:
    //   "SnS shipped units"              → "sns_shipped_units"
    //   "Period End Subscription Balance"→ "period_end_subscription_balance"
    //   "SnS Sales Penetration %"        → "sns_sales_penetration"
    reportType: 'subscribe_and_save',
    tableName: 'subscribe_and_save',
    match: h =>
      has(h, 'sns_shipped_units') &&
      has(h, 'period_end_subscription_balance') &&
      has(h, 'sns_sales_penetration'),
  },
  {
    // Fallback for non-Amazon S&S formats that use "active_subscriptions" column names.
    reportType: 'subscribe_and_save',
    tableName: 'subscribe_and_save',
    match: h => has(h, 'active_subscriptions') || has(h, 'new_subscriptions'),
  },
  {
    // SmartScout subcategory-level brand summary export.
    // "Estimated Monthly Revenue" normalises to "estimated_monthly_revenue" — the substring
    // "estimated_revenue" also appears in that form, which would match smartscout_brand_revenue.
    // This signature MUST precede that entry. Unique combination: all four columns only
    // co-occur in the Subcategory Brands report.
    reportType: 'smartscout_subcategory_brands',
    tableName: 'smartscout_subcategory_brands',
    match: h =>
      has(h, 'market_share_change') &&
      has(h, 'ad_spend_share') &&
      has(h, 'dominant_seller_country'),
  },
  {
    // SmartScout product-level subcategory export.
    // Unique combination: est_monthly_revenue (not estimated_revenue) + primary_subcategory_rank
    // + opportunity_score + is_variation. None of these appear together in any other known report.
    reportType: 'smartscout_subcategory_products',
    tableName: 'smartscout_subcategory_products',
    match: h =>
      has(h, 'est_monthly_revenue') &&
      has(h, 'primary_subcategory_rank') &&
      has(h, 'opportunity_score') &&
      has(h, 'is_variation'),
  },
  {
    reportType: 'smartscout_brand_revenue',
    tableName: 'smartscout_brand_revenue',
    match: h => has(h, 'competitor_brand') || (has(h, 'estimated_revenue') && has(h, 'market_share')),
  },
  {
    // Amazon "Sales and Traffic by Date" — brand-level daily totals. Has a "Date"
    // column; the ASIN-level monthly report does not. Must be checked first so the
    // daily file never falls through to the monthly business_report signature.
    reportType: 'business_report_daily',
    tableName: 'business_report_daily',
    match: h => has(h, 'date') && has(h, 'sessions') && (has(h, 'buy_box') || has(h, 'page_views')),
  },
  {
    // Amazon "Detail Page Sales and Traffic by Child Item" — ASIN-level monthly.
    // Tightened to require an ASIN column so it never matches the daily file if
    // signature ordering ever shifts. "date" check is intentionally absent here.
    reportType: 'business_report',
    tableName: 'business_report',
    match: h =>
      has(h, 'sessions') &&
      (has(h, 'buy_box') || has(h, 'page_views')) &&
      (has(h, 'child_asin') || has(h, 'parent_asin') || has(h, 'asin')),
  },
  {
    // Guard: lacks 'targeting' and 'match_type' so a targeting report file that
    // somehow reaches this check is never mis-labelled as SmartScout SOV.
    reportType: 'smartscout_share_of_voice',
    tableName: 'smartscout_share_of_voice',
    match: h =>
      (has(h, 'impression_share') || has(h, 'click_share')) &&
      lacks(h, 'targeting', 'match_type'),
  },
  {
    // Most generic — checked last. Any Amazon campaign CSV with impressions + clicks
    // that has not been claimed by a more specific check lands here.
    reportType: 'sp_campaign_performance',
    tableName: 'sp_campaign_performance',
    match: h =>
      has(h, 'campaign_name', 'impressions', 'clicks') &&
      lacks(h, 'customer_search_term', 'top_of_search', 'purchased_asin', 'organic_rank', 'bid_before'),
  },
]

export function detectReportType(headers: string[]): DetectionResult {
  const normHeaders = headers.map(normalize)

  for (const sig of SIGNATURES) {
    if (sig.match(normHeaders)) {
      return { reportType: sig.reportType, tableName: sig.tableName, hint: sig.hint }
    }
  }

  return { reportType: 'unknown', tableName: '' }
}

export const REPORT_TYPE_TO_TABLE: Record<string, string> = Object.fromEntries(
  SIGNATURES.map(s => [s.reportType, s.tableName])
)
