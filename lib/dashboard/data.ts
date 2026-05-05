/**
 * Dashboard data orchestration — V4.
 *
 * Single entry point: `loadDashboardData(period)` returns everything the
 * Command Center needs. Each section loader currently returns a typed
 * zero-state — replace these with the real lib/queries/* + derived-metrics
 * calls. Search the codebase for `TODO[wire]` to find each integration point.
 */

import type {
  Alert,
  AlertSummary,
  BundleCards,
  BusinessHealthData,
  CampaignRow,
  CVRBuyBoxRow,
  DashboardData,
  DashboardPeriod,
  GoalCard,
  IngestStatus,
  MarketShareView,
  PPCSnapshot,
  PPCStatRow,
  RankMover,
  SearchIntelData,
  SQPRow,
  SSCards,
  SubcategoryRankRow,
} from './types';
import type { ResolvedPeriod } from './period';

// TODO[wire]: replace with real exports from your existing query layer.
// import { supabase } from '@/lib/supabase';
// import { getAccountSummary, getCampaignsByAdType, getHarvestCandidates } from '@/lib/queries/account';
// import { getCampaignWatchlist } from '@/lib/queries/campaigns';
// import { getRankMovers } from '@/lib/queries/rank';
// import { getSearchQueryGaps } from '@/lib/queries/keywords';
// import { getOpportunities } from '@/lib/queries/opportunities';
// import { getAnomalies } from '@/lib/queries/anomalies';
// import { getGoalProgress } from '@/lib/queries/goals';
// import { getASINPerformance, getSSPerformance } from '@/lib/queries/products';
// import { calculateDerivedMetricsRange } from '@/lib/derived-metrics';

export const BRAND_ID = '47a96175-ed58-4104-a2ff-c925d6143309';

/* -------------------------------------------------------------------------- */
/* Goal rail                                                                  */
/* -------------------------------------------------------------------------- */

async function loadGoalRail(period: ResolvedPeriod): Promise<GoalCard[]> {
  // TODO[wire]: derive_metrics_daily for actuals, getGoalProgress for targets,
  // and use lib/dashboard/targets.ts for hardcoded monthly figures.
  const stub = (id: GoalCard['id'], label: string): GoalCard => ({
    id,
    label,
    value: '—',
    target: '—',
    variance: null,
    pacing: null,
    freshnessDate: period.end,
  });

  return [
    stub('total_sales',   'TOTAL SALES'),
    stub('ad_spend',      'AD SPEND'),
    stub('ppc_roas',      'PPC ROAS'),
    stub('mer',           'MER'),
    stub('aov',           'AOV'),
    { ...stub('ntb_customers', 'NTB CUSTOMERS'), sourceTag: 'BA pending' },
    stub('cac',           'CAC'),
    stub('ss_revenue',    'S&S REVENUE'),
  ];
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

async function loadAlerts(period: ResolvedPeriod): Promise<{ alerts: Alert[]; summary: AlertSummary }> {
  // TODO[wire]: getAnomalies + platform_insights critical/warning entries.
  const alerts: Alert[] = [];
  const summary: AlertSummary = {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    watch: alerts.filter((a) => a.severity === 'watch' || a.severity === 'info').length,
  };
  return { alerts, summary };
}

/* -------------------------------------------------------------------------- */
/* Business Health                                                            */
/* -------------------------------------------------------------------------- */

async function loadBusinessHealth(period: ResolvedPeriod): Promise<BusinessHealthData> {
  // TODO[wire]: smartscout_subcategory_products / _brands, business_report,
  // subscribe_and_save, virtual_bundle_sales.

  const subcategoryRanks: SubcategoryRankRow[] = [
    { key: 'dishwasher',    label: 'Dishwasher Detergent',   rank: null, revenuePerMonth: null, topAsins: [], snapshotDate: period.end },
    { key: 'laundry',       label: 'Laundry Detergent',      rank: null, revenuePerMonth: null, topAsins: [], snapshotDate: period.end },
    { key: 'stain_remover', label: 'Laundry Stain Remover',  rank: null, revenuePerMonth: null, topAsins: [], snapshotDate: period.end },
    { key: 'toilet',        label: 'Toilet Bowl Cleaner',    rank: null, revenuePerMonth: null, topAsins: [], snapshotDate: period.end },
  ];

  const marketShare: MarketShareView[] = [
    { subcategory: 'dishwasher',    label: 'Dishwasher',     rows: [], snapshotDate: period.end },
    { subcategory: 'laundry',       label: 'Laundry',        rows: [], snapshotDate: period.end },
    { subcategory: 'stain_remover', label: 'Stain Remover',  rows: [], snapshotDate: period.end },
  ];

  const cvrBuyBox: CVRBuyBoxRow[] = [];

  const ss: SSCards = {
    activeSubs: 0, activeSubsMoM: null,
    ssRevenue: 0, ssRevenueMoM: null,
    penetration: null, penetrationMoM: null,
  };

  const bundles: BundleCards = {
    revenue: 0, revenueWoW: null,
    shareOfTotal: null, shareOfTotalChange: null,
    units: 0, unitsWoW: null,
    windowLabel: '—',
  };

  return {
    subcategoryRanks,
    marketShare,
    defaultMarketShareKey: 'dishwasher',
    cvrBuyBox,
    ss,
    bundles,
  };
}

/* -------------------------------------------------------------------------- */
/* PPC                                                                        */
/* -------------------------------------------------------------------------- */

async function loadPPC(period: ResolvedPeriod): Promise<PPCSnapshot> {
  // TODO[wire]: getAccountSummary, getCampaignsByAdType, getHarvestCandidates,
  // pinned watchlist via localStorage IDs joined to sp_campaign_performance.
  const stats: PPCStatRow[] = [
    { id: 'spend',    label: 'Total spend',          primary: '—', secondary: 'target —',         tone: 'neutral' },
    { id: 'roas',     label: 'Blended ROAS',         primary: '—', secondary: 'SP — · SB —',      tone: 'neutral' },
    { id: 'sb_share', label: 'SB + SBV spend share', primary: '—', secondary: 'target 25%+',      tone: 'neutral' },
    { id: 'harvest',  label: 'Harvest candidates',   primary: '—', secondary: 'ready for exact',  tone: 'neutral' },
    { id: 'organic',  label: 'Organic revenue',      primary: '—', secondary: '— of total',       tone: 'neutral' },
  ];
  const campaigns: CampaignRow[] = [];
  return { stats, campaigns };
}

/* -------------------------------------------------------------------------- */
/* Search Intelligence                                                        */
/* -------------------------------------------------------------------------- */

async function loadSearchIntel(period: ResolvedPeriod): Promise<SearchIntelData> {
  // TODO[wire]: search_query_performance for brand queries + share gaps,
  // getRankMovers for ±5 rank changes, ASIN_NAMES for short-name lookup.
  const brandQueries: SQPRow[] = [];
  const shareGaps: SQPRow[] = [];
  const rankMovers: RankMover[] = [];
  return {
    brandQueries,
    shareGaps,
    sqpReportPeriod: period.label,
    rankMovers,
    rankWindowLabel: `${period.start} → ${period.end}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

async function loadStatus(): Promise<IngestStatus> {
  // TODO[wire]: report_ingestion_log aggregate.
  return {
    lastIngest: new Date().toISOString().slice(0, 10),
    totalRows: 0,
    reportTypeCount: 0,
    monthsLoaded: 0,
    backfillStatus: 'not started',
    overdueReports: [],
    spApiConnected: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Composite                                                                  */
/* -------------------------------------------------------------------------- */

export async function loadDashboardData(period: ResolvedPeriod): Promise<DashboardData> {
  const [goals, alertBundle, businessHealth, ppc, search, status] = await Promise.all([
    loadGoalRail(period),
    loadAlerts(period),
    loadBusinessHealth(period),
    loadPPC(period),
    loadSearchIntel(period),
    loadStatus(),
  ]);

  // TODO[wire]: when the requested period had no data and a fallback was
  // substituted, set fellBack=true and effectiveLabel to the fallback period.
  const dashboardPeriod: DashboardPeriod = {
    start: period.start,
    end: period.end,
    label: period.label,
    effectiveLabel: period.label,
    fellBack: false,
  };

  return {
    period: dashboardPeriod,
    goals,
    alerts: alertBundle.alerts,
    alertSummary: alertBundle.summary,
    businessHealth,
    ppc,
    search,
    status,
  };
}
