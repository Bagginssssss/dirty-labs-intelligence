import type { RawRow, MappedRow, MapperContext } from './types'
import { mapSpSearchTerm } from './sp-search-term'
import { mapSpTargeting } from './sp-targeting'
import { mapSpCampaignPerformance } from './sp-campaign-performance'
import { mapBusinessReportBatch } from './business-report'
import { mapBusinessReportDaily } from './business-report-daily'
import { mapPurchasedProduct } from './purchased-product'
import { mapSbAttributedPurchases } from './sb-attributed-purchases'
import { mapScaleInsightsBidLog } from './scale-insights-bid-log'
import { mapScaleInsightsKeywordRank } from './scale-insights-keyword-rank'
import { mapScaleInsightsRuleChangeLog } from './scale-insights-rule-change-log'
import { mapScaleInsightsRuleAssignments } from './scale-insights-rule-assignments'
import { mapSubscribeAndSave } from './subscribe-and-save'
import { mapSmartscoutShareOfVoice } from './smartscout-share-of-voice'
import { mapSmartscoutBrandRevenue } from './smartscout-brand-revenue'
import { mapSearchQueryPerformance } from './search-query-performance'
import { mapSmartscoutSubcategoryProducts } from './smartscout-subcategory-products'
import { mapSmartscoutSubcategoryBrands } from './smartscout-subcategory-brands'
import { mapVirtualBundleSales } from './virtual-bundle-sales'
import { mapVirtualBundleDaily } from './virtual-bundle-daily'
import { mapVirtualBundleSnapshots } from './virtual-bundle-snapshots'
import { mapBrandAnalyticsCustomerLoyalty } from './brand-analytics-customer-loyalty'
import { mapSnsDashboardDaily } from './sns-dashboard-daily'
import { mapSnsDashboardSnapshots } from './sns-dashboard-snapshots'
import { mapRepeatPurchase } from './repeat-purchase'
import { mapSkuEconomicsWeekly } from './sku-economics'
import { mapFbaCustomerReturns } from './fba-customer-returns'

// MapperFn may return a single row or an array of rows (for unpivoting mappers).
export type MapperFn = (row: RawRow, brandId: string, context?: MapperContext) => MappedRow | MappedRow[]

// BatchMapperFn receives all parsed rows at once, enabling cross-row pre-processing
// (e.g. deduplication by parent ASIN before the rows are split into batches).
export type BatchMapperFn = (rows: RawRow[], brandId: string, context?: MapperContext) => MappedRow[]

const MAPPERS: Record<string, MapperFn> = {
  sp_search_term_report:       mapSpSearchTerm,
  sp_targeting_report:         mapSpTargeting,
  sp_campaign_performance:     mapSpCampaignPerformance,
  business_report_daily:       mapBusinessReportDaily,
  purchased_product_report:    mapPurchasedProduct,
  scale_insights_bid_log:      mapScaleInsightsBidLog,
  scale_insights_keyword_rank: mapScaleInsightsKeywordRank,
  scale_insights_rule_change_log:  mapScaleInsightsRuleChangeLog,
  scale_insights_rule_assignments: mapScaleInsightsRuleAssignments,
  subscribe_and_save:          mapSubscribeAndSave,
  smartscout_share_of_voice:   mapSmartscoutShareOfVoice,
  smartscout_brand_revenue:    mapSmartscoutBrandRevenue,
  search_query_performance:    mapSearchQueryPerformance,
  smartscout_subcategory_brands: mapSmartscoutSubcategoryBrands,
  virtual_bundle_sales:          mapVirtualBundleSales,
  virtual_bundle_sales_daily:    mapVirtualBundleDaily,
  // INB-144 — S&S Dashboard (2 reportTypes, 8 content-derived report_keys)
  sns_dashboard_daily:           mapSnsDashboardDaily,
  sns_dashboard_snapshots:       mapSnsDashboardSnapshots,
  // INB-141 — BA Repeat Purchase (1 reportType, 2 content-derived report_keys)
  brand_analytics_repeat_purchase: mapRepeatPurchase,
}

const BATCH_MAPPERS: Record<string, BatchMapperFn> = {
  // business_report groups multi-SKU rows per child ASIN before insert (INB-108).
  business_report:                       mapBusinessReportBatch,
  sb_attributed_purchases:               mapSbAttributedPurchases,
  smartscout_subcategory_products:       mapSmartscoutSubcategoryProducts,
  virtual_bundle_sales_snapshots:        mapVirtualBundleSnapshots,
  brand_analytics_customer_loyalty:      mapBrandAnalyticsCustomerLoyalty,
  // INB-162 — SKU Economics: batch mapper (weekly parent); child fees built separately in the route.
  sku_economics_weekly:                  mapSkuEconomicsWeekly,
  // INB-160 — FBA Customer Returns: batch mapper computes the occurrence key across rows.
  fba_customer_returns:                  mapFbaCustomerReturns,
}

export function getMapper(reportType: string): MapperFn | null {
  return MAPPERS[reportType] ?? null
}

export function getBatchMapper(reportType: string): BatchMapperFn | null {
  return BATCH_MAPPERS[reportType] ?? null
}

export * from './types'
export * from './sp-search-term'
export * from './sp-targeting'
export * from './sp-campaign-performance'
export * from './business-report'
export * from './business-report-daily'
export * from './purchased-product'
export * from './sb-attributed-purchases'
export * from './scale-insights-bid-log'
export * from './scale-insights-keyword-rank'
export * from './scale-insights-rule-change-log'
export * from './scale-insights-rule-assignments'
export * from './subscribe-and-save'
export * from './smartscout-share-of-voice'
export * from './smartscout-brand-revenue'
export * from './search-query-performance'
export * from './smartscout-subcategory-products'
export * from './smartscout-subcategory-brands'
export * from './brand-analytics-customer-loyalty'
export * from './sns-dashboard-daily'
export * from './sns-dashboard-snapshots'
export * from './repeat-purchase'
export * from './sku-economics'
export * from './fba-customer-returns'
