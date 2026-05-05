export type Severity = 'critical' | 'warning' | 'watch' | 'info';
export type Domain = 'PPC' | 'BUSINESS' | 'SEO';

export type DashboardPeriod = {
  start: string;
  end: string;
  label: string;
  effectiveLabel: string;
  fellBack: boolean;
};

export type GoalCardId =
  | 'total_sales' | 'ad_spend' | 'ppc_roas' | 'mer'
  | 'aov' | 'ntb_customers' | 'cac' | 'ss_revenue';

export type GoalCard = {
  id: GoalCardId;
  label: string;
  value: string;
  target: string;
  /** Number for percentage variance, or string like "on track" */
  variance: number | string | null;
  pacing: number | null;
  freshnessDate: string;
  sourceTag?: string;
  warning?: string;
};

export type Alert = {
  id: string;
  severity: Severity;
  domain: Domain;
  entity: string;
  figure: string;
  description: string;
  recommendation: string;
  href: string;
  metric: string;
};

export type AlertSummary = {
  total: number;
  critical: number;
  warning: number;
  watch: number;
};

export type SubcategoryRankRow = {
  key: 'dishwasher' | 'laundry' | 'stain_remover' | 'toilet';
  label: string;
  rank: number | null;
  revenuePerMonth: number | null;
  topAsins: string[];
  snapshotDate: string;
};

export type MarketShareRow = {
  brand: string;
  share: number;
  mom: number | null;
  isOurs: boolean;
};

export type MarketShareView = {
  subcategory: 'dishwasher' | 'laundry' | 'stain_remover';
  label: string;
  rows: MarketShareRow[];
  snapshotDate: string;
};

export type CVRBuyBoxRow = {
  asinShortName: string;
  asin: string;
  cvr: number;
  cvrTrend: 'above' | 'average' | 'below';
  buyBox: number;
};

export type SSCards = {
  activeSubs: number;
  activeSubsMoM: number | null;
  ssRevenue: number;
  ssRevenueMoM: number | null;
  penetration: number | null;
  penetrationMoM: number | null;
};

export type BundleCards = {
  revenue: number;
  revenueWoW: number | null;
  shareOfTotal: number | null;
  shareOfTotalChange: number | null;
  units: number;
  unitsWoW: number | null;
  windowLabel: string;
  lastUploadDate: string | null;
};

export type BusinessHealthData = {
  subcategoryRanks: SubcategoryRankRow[];
  marketShare: MarketShareView[];
  defaultMarketShareKey: MarketShareView['subcategory'];
  cvrBuyBox: CVRBuyBoxRow[];
  ss: SSCards;
  bundles: BundleCards;
};

export type PPCStatRow = {
  id: 'spend' | 'roas' | 'sb_share' | 'harvest' | 'organic';
  label: string;
  primary: string;
  secondary: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
};

export type CampaignStatus = 'top' | 'watching' | 'waste' | 'new';

export type CampaignRow = {
  id: string;
  name: string;
  adType: 'SP' | 'SB' | 'SBV';
  spend: number;
  roas: number | null;
  orders: number;
  impressions: number;
  status: CampaignStatus;
  pinned?: boolean;
};

export type PPCSnapshot = {
  stats: PPCStatRow[];
  campaigns: CampaignRow[];
};

export type SQPRow = {
  query: string;
  purchaseShare: number;
  searchVolume: number;
};

export type RankMover = {
  rank: number;
  keyword: string;
  asinShortName: string;
  asin: string;
  delta: number;
};

export type SearchIntelData = {
  brandQueries: SQPRow[];
  shareGaps: SQPRow[];
  sqpReportPeriod: string;
  rankMovers: RankMover[];
  rankWindowLabel: string;
};

export type IngestStatus = {
  lastIngest: string;
  totalRows: number;
  reportTypeCount: number;
  monthsLoaded: number;
  backfillStatus: string;
  overdueReports: { name: string; daysLate: number }[];
  spApiConnected: boolean;
};

export type DashboardData = {
  period: DashboardPeriod;
  goals: GoalCard[];
  alerts: Alert[];
  alertSummary: AlertSummary;
  businessHealth: BusinessHealthData;
  ppc: PPCSnapshot;
  search: SearchIntelData;
  status: IngestStatus;
};
