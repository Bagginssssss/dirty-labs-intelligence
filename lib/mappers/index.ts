import { RawRow, MappedRow, MapperContext } from './types'
import { mapSpSearchTerm } from './sp-search-term'
import { mapSpTargeting } from './sp-targeting'
import { mapSpCampaignPerformance } from './sp-campaign-performance'
import { mapBusinessReport } from './business-report'
import { mapPurchasedProduct } from './purchased-product'
import { mapScaleInsightsBidLog } from './scale-insights-bid-log'
import { mapScaleInsightsKeywordRank } from './scale-insights-keyword-rank'
import { mapSubscribeAndSave } from './subscribe-and-save'
import { mapSmartscoutShareOfVoice } from './smartscout-share-of-voice'
import { mapSmartscoutBrandRevenue } from './smartscout-brand-revenue'
import { mapSearchQueryPerformance } from './search-query-performance'
import { mapSmartscoutSubcategoryProducts } from './smartscout-subcategory-products'
import { mapSmartscoutSubcategoryBrands } from './smartscout-subcategory-brands'

// MapperFn may return a single row or an array of rows (for unpivoting mappers).
export type MapperFn = (row: RawRow, brandId: string, context?: MapperContext) => MappedRow | MappedRow[]

// BatchMapperFn receives all parsed rows at once, enabling cross-row pre-processing
// (e.g. deduplication by parent ASIN before the rows are split into batches).
export type BatchMapperFn = (rows: RawRow[], brandId: string, context?: MapperContext) => MappedRow[]

const MAPPERS: Record<string, MapperFn> = {
  sp_search_term_report:       mapSpSearchTerm,
  sp_targeting_report:         mapSpTargeting,
  sp_campaign_performance:     mapSpCampaignPerformance,
  business_report:             mapBusinessReport,
  purchased_product_report:    mapPurchasedProduct,
  scale_insights_bid_log:      mapScaleInsightsBidLog,
  scale_insights_keyword_rank: mapScaleInsightsKeywordRank,
  subscribe_and_save:          mapSubscribeAndSave,
  smartscout_share_of_voice:   mapSmartscoutShareOfVoice,
  smartscout_brand_revenue:    mapSmartscoutBrandRevenue,
  search_query_performance:    mapSearchQueryPerformance,
  smartscout_subcategory_brands: mapSmartscoutSubcategoryBrands,
}

const BATCH_MAPPERS: Record<string, BatchMapperFn> = {
  smartscout_subcategory_products: mapSmartscoutSubcategoryProducts,
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
export * from './purchased-product'
export * from './scale-insights-bid-log'
export * from './scale-insights-keyword-rank'
export * from './subscribe-and-save'
export * from './smartscout-share-of-voice'
export * from './smartscout-brand-revenue'
export * from './search-query-performance'
export * from './smartscout-subcategory-products'
export * from './smartscout-subcategory-brands'
