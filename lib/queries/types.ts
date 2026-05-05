export interface AccountSummary {
  start_date: string
  end_date: string
  total_revenue: number
  total_ppc_spend: number
  total_ppc_sales: number
  blended_roas: number | null
  organic_revenue: number
  mer: number | null
  ntb_orders: number
  ntb_rate: number | null
  total_orders: number
  aov: number | null
  account_cvr: number | null
  ss_active_subscriptions: number
  ss_revenue: number
  ss_revenue_pct_of_total: number | null
  days_with_data: number
}

export interface CampaignRow {
  campaign_uuid: string
  campaign_name: string | null
  ad_type: string | null
  targeting_type: string | null
  spend: number
  sales: number
  roas: number | null
  acos: number | null
  orders: number
  clicks: number
  impressions: number
  cvr: number | null
  ntb_orders: number
  ntb_rate: number | null
}

export interface SearchTermRow {
  search_term: string
  campaign_uuid: string
  campaign_name: string | null
  match_type: string | null
  ad_type: string | null
  spend: number
  sales: number
  roas: number | null
  acos: number | null
  orders: number
  clicks: number
  impressions: number
  cvr: number | null
}

export interface ASINRow {
  asin_id: string
  asin: string
  title: string | null
  revenue: number
  sessions: number
  units_ordered: number
  buy_box_pct: number | null
  cvr: number | null
}

export interface SSRow {
  asin_id: string
  asin: string
  title: string | null
  active_subscriptions: number
  ss_revenue: number
  ss_units_shipped: number
  reorder_rate: number | null
}

export interface OpportunityRow {
  search_query: string
  search_query_volume: number | null
  purchases_total: number | null
  purchases_brand: number | null
  purchases_brand_share: number | null
  impressions_brand_share: number | null
  clicks_brand_share: number | null
}

export interface CompetitorRow {
  brand_name: string
  subcategory: string
  estimated_revenue: number | null
  market_share: number | null
  snapshot_date: string
}

export interface AnomalyItem {
  type: string
  severity: 'critical' | 'warning' | 'info'
  entity: string
  metric: string
  current_value: number
  expected_value?: number
  delta_pct?: number
  note: string
}

export interface GoalProgressRow {
  metric: string
  period: string
  target: number
  actual: number
  pct_of_target: number | null
  on_track: boolean
  gap: number
}

export interface RankRow {
  keyword: string
  asin_id: string
  asin: string
  title: string | null
  rank_value: number | null
  search_volume: number | null
  tracked: boolean | null
  report_date: string
}

export interface RankMoverRow {
  keyword: string
  asin_id: string
  asin: string
  title: string | null
  rank_value_start: number | null
  rank_value_end: number | null
  rank_value_delta: number | null
  search_volume: number | null
}
