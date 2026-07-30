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

// Reads a raw-row value by its NORMALIZED column name (BOM/casing-insensitive).
// Used by content-based (matchRow) signatures — the three ScaleInsights rule
// change-log exports share a header with the bidding-rule log, so they can only
// be separated by the Action column's value.
function rowValue(row: Record<string, string>, normKey: string): string {
  for (const k of Object.keys(row)) {
    if (normalize(k) === normKey) return row[k] ?? ''
  }
  return ''
}

// ─── Signature table ──────────────────────────────────────────────────────────
//
// ORDER IS SIGNIFICANT — first match wins.
// Rule: most-specific (fewest possible false positives) → least-specific.
//
//  1. search_query_performance       — unique triple: search_query_score + impressions_total_count
//                                      + purchases_brand_count
//  2. virtual_bundle_sales_snapshots — first normalized header matches /^week_\d+_report_/
//                                      (multi-section 90-day rolling window export)
//  3. virtual_bundle_sales_daily     — date + bundle_asin + bundles_sold + total_sales
//                                      (replaces old virtual_bundle_sales; more specific via "date")
//  4. sb_search_term (hint SB)       — customer_search_term + viewable_impressions + cost_type
//                                      MUST precede generic SP check; SB files have all three.
//  5. sp_search_term_report          — unique column "customer_search_term"
//  6. sp_targeting_report            — unique column "top_of_search_impression_share"
//                                      MUST precede smartscout_share_of_voice because
//                                      "impression_share" is a substring of
//                                      "top_of_search_impression_share".
//  7. purchased_product_report       — unique column "purchased_asin"
//  8. scale_insights_bid_log         — unique columns "bid_before" / "bid_after"
//  9. scale_insights_kw_rank         — unique column "organic_rank"
// 10. subscribe_and_save             — unique column "active_subscriptions"
// 11. smartscout_brand_revenue       — unique column "competitor_brand"
// 12. business_report                — "sessions" + "buy_box"/"page_views" (fairly unique)
// 13. smartscout_share_of_voice      — "impression_share"/"click_share" with guards
//                                      (lacks targeting/match_type to exclude targeting reports)
// 14. sp_campaign_performance        — most generic; last resort for Amazon campaign CSV

const SIGNATURES: Array<{
  reportType: string
  tableName: string
  hint?: string
  match: (h: string[]) => boolean
  // Optional content gate: when present, the signature matches only if a sample
  // data row is supplied AND passes. A signature with matchRow is SKIPPED when no
  // sample row is available (header-only callers), so a less-specific signature
  // later in the table still wins — preserving pre-INB-148 behavior.
  matchRow?: (row: Record<string, string>) => boolean
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
    // Amazon SKU Economics (INB-162) — weekly MSKU-level fee economics. The trio
    // net_proceeds_total + msku + amazon_store co-occurs in no other known report.
    // Very specific; placed early so it can never fall through to a generic check.
    reportType: 'sku_economics_weekly',
    tableName:  'sku_economics_weekly',
    match: h =>
      has(h, 'net_proceeds_total') &&
      has(h, 'msku') &&
      has(h, 'amazon_store'),
  },
  {
    // Operator's 90-day rolling window VB snapshot export.
    // The file is multi-section: each section starts with a "Week N Report (…)" line,
    // which PapaParse consumes as the header row. After normalize() the first header
    // becomes "week_N_report_…" — matched here by prefix.
    // MUST precede virtual_bundle_sales_daily so the flat-CSV check never fires first.
    reportType: 'virtual_bundle_sales_snapshots',
    tableName:  'virtual_bundle_sales_snapshots',
    match: h => h.length > 0 && /^week_\d+_report_/.test(h[0]),
  },
  {
    // Amazon Virtual Bundle Sales daily report.
    // Replaces the old virtual_bundle_sales detector; "date" makes it unambiguous.
    // The old virtual_bundle_sales table is preserved for historical data; new uploads
    // route here until the Phase-2 dashboard migration is complete.
    reportType: 'virtual_bundle_sales_daily',
    tableName:  'virtual_bundle_sales_daily',
    match: h =>
      has(h, 'date') &&
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
      has(h, 'customer_search_term', 'date') &&
      has(h, 'viewable_impressions') &&
      has(h, 'cost_type'),
  },
  {
    reportType: 'sp_search_term_report',
    tableName: 'sp_search_term_report',
    match: h => has(h, 'customer_search_term', 'date'),
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
    // SB Attributed Purchases (INB-149) — shares purchased_product_report with the
    // SP export. Unique markers: "Attribution type" + the 14-day columns, and NO
    // "Advertised SKU"/7-day Other-SKU columns. MUST precede the SP signature (both
    // carry "Purchased ASIN"); the SP file has Advertised SKU, this one does not.
    reportType: 'sb_attributed_purchases',
    tableName: 'purchased_product_report',
    match: h => has(h, 'attribution_type') && has(h, 'purchased_asin') && lacks(h, 'advertised_sku'),
  },
  {
    reportType: 'purchased_product_report',
    tableName: 'purchased_product_report',
    match: h => has(h, 'purchased_asin') || (has(h, 'advertised_asin') && has(h, 'purchased_title')),
  },
  {
    // Scale Insights Import/Negative/Revive rule change logs (INB-148). These
    // three exports share a BYTE-IDENTICAL header with the Bidding rule change log
    // below (Created/Action/Rule/Criteria/Change/…), so header shape alone cannot
    // separate them — the Action column value is the discriminator. MUST precede
    // the bid_log signature; without a sample row (matchRow un-evaluable) this is
    // skipped and the bidding-rule signature claims the file as before.
    reportType: 'scale_insights_rule_change_log',
    tableName: 'scale_insights_rule_change_log',
    match: h => has(h, 'created') && has(h, 'action') && has(h, 'rule') && has(h, 'criteria') && has(h, 'change'),
    matchRow: row => {
      const action = rowValue(row, 'action').trim().toLowerCase()
      return action === 'import rule' || action === 'negative rule' || action === 'revive rule'
    },
  },
  {
    // Scale Insights AssignedRules export (INB-148) — account-wide rule assignments
    // per ad group. The ten/eleven rule-list columns (Bidding Rules … Daily Budget
    // Rules) are unique to this file; "sponsored" + "bidding_rules" is unambiguous.
    reportType: 'scale_insights_rule_assignments',
    tableName: 'scale_insights_rule_assignments',
    match: h => has(h, 'sponsored') && has(h, 'bidding_rules') && has(h, 'daily_budget_rules'),
  },
  {
    // Scale Insights UnassignedRules export (INB-148) — narrower header, no rule
    // columns. Same table as Assigned (is_assigned is content-derived). lacks
    // bidding_rules keeps it from ever shadowing the Assigned signature above.
    reportType: 'scale_insights_rule_assignments',
    tableName: 'scale_insights_rule_assignments',
    match: h => has(h, 'sponsored') && has(h, 'associated_asin') && has(h, 'last_30_days_ad_spend') && lacks(h, 'bidding_rules'),
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
  // ── INB-144: S&S Dashboard exports (Seller Central) ──────────────────────────
  // The 5 daily exports all share col 1 `calc_date_granularity`; one greedy signature
  // claims them all (the specific report_key is content-derived in deriveReportKey).
  // MUST precede subscribe_and_save — the Subscription Count file carries "Active
  // Subscriptions (CUSTOM)" and would otherwise match the active_subscriptions fallback.
  {
    reportType: 'sns_dashboard_daily',
    tableName: 'sns_dashboard_daily',
    match: h => has(h, 'calc_date_granularity'),
  },
  {
    // Subscriber LTV by segment (snapshot).
    reportType: 'sns_dashboard_snapshots',
    tableName: 'sns_dashboard_snapshots',
    match: h => has(h, 'calc_customer_segment') && has(h, 'calc_purchase_type') && has(h, 'avg_gms'),
  },
  {
    // Avg reorders, subscriber vs non (snapshot).
    reportType: 'sns_dashboard_snapshots',
    tableName: 'sns_dashboard_snapshots',
    match: h => has(h, 'calc_is_subscriber') && has(h, 'calc_avg_reorder'),
  },
  {
    // Subscriber retention 30/90-day (snapshot).
    reportType: 'sns_dashboard_snapshots',
    tableName: 'sns_dashboard_snapshots',
    match: h => has(h, 'calc_metric_name') && has(h, 'calc_retention'),
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
    // Subcategory Brands report — filtered at export time, no per-row subcategory column.
    // Unique combination: market_share + market_share_change + ad_spend_share only
    // co-occur in this report (not in smartscout_brand_revenue or share_of_voice).
    // This signature MUST precede smartscout_brand_revenue (which also has market_share).
    match: h =>
      has(h, 'market_share') &&
      has(h, 'market_share_change') &&
      has(h, 'ad_spend_share'),
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
    // Amazon Brand Analytics Customer Loyalty report (weekly and monthly share identical headers).
    // Unique combination: total_customers + new_to_brand_customers + repeat_purchase_rate
    // + potential_new_customers — none appear together in any other known report.
    reportType: 'brand_analytics_customer_loyalty',
    tableName:  'brand_analytics_customer_loyalty',
    match: h =>
      has(h, 'total_customers') &&
      has(h, 'new_to_brand_customers') &&
      has(h, 'repeat_purchase_rate') &&
      has(h, 'potential_new_customers'),
  },
  {
    // INB-141 — BA Repeat Purchase Behavior (brand + ASIN views share the repeat columns; the
    // mapper derives level from the ASIN column). Unique combination: both "Repeat Ordered
    // Product Sales" and "Repeat Customer Share" only co-occur here (customer_loyalty has neither).
    reportType: 'brand_analytics_repeat_purchase',
    tableName:  'brand_analytics_repeat_purchase',
    match: h => has(h, 'repeat_ordered_product_sales') && has(h, 'repeat_customer_share'),
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
      has(h, 'campaign_name', 'impressions', 'clicks', 'date') &&
      lacks(h, 'customer_search_term', 'top_of_search', 'purchased_asin', 'organic_rank', 'bid_before'),
  },
]

export function detectReportType(
  headers: string[],
  sampleRow?: Record<string, string>,
): DetectionResult {
  const normHeaders = headers.map(normalize)

  for (const sig of SIGNATURES) {
    if (!sig.match(normHeaders)) continue
    // Content-gated signatures need a sample row that passes; when none is
    // available the signature is skipped so a later one can still match.
    if (sig.matchRow && !(sampleRow && sig.matchRow(sampleRow))) continue
    return { reportType: sig.reportType, tableName: sig.tableName, hint: sig.hint }
  }

  return { reportType: 'unknown', tableName: '' }
}

export const REPORT_TYPE_TO_TABLE: Record<string, string> = Object.fromEntries(
  SIGNATURES.map(s => [s.reportType, s.tableName])
)
