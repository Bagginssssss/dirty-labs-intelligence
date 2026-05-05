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

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getMonthlyTarget, AOV_TARGET, CAC_TARGET, MER_TARGET } from './targets';
import type { MonthIndex } from './targets';
import { fmtUSDCompact, fmtUSD, fmtRoas, fmtIntCompact } from './format';
// TODO[wire]: replace with real exports from your existing query layer.
// import { getAccountSummary, getCampaignsByAdType, getHarvestCandidates } from '@/lib/queries/account';
// import { getCampaignWatchlist } from '@/lib/queries/campaigns';
// import { getRankMovers } from '@/lib/queries/rank';
// import { getSearchQueryGaps } from '@/lib/queries/keywords';
// import { getOpportunities } from '@/lib/queries/opportunities';
// import { getAnomalies } from '@/lib/queries/anomalies';
// import { getASINPerformance, getSSPerformance } from '@/lib/queries/products';
// import { calculateDerivedMetricsRange } from '@/lib/derived-metrics';

export const BRAND_ID = '47a96175-ed58-4104-a2ff-c925d6143309';

/* -------------------------------------------------------------------------- */
/* Goal rail                                                                  */
/* -------------------------------------------------------------------------- */

async function loadGoalRail(period: ResolvedPeriod): Promise<GoalCard[]> {
  const endDate = new Date(period.end + 'T00:00:00Z');
  const year = endDate.getUTCFullYear();
  const monthIndex = endDate.getUTCMonth() as MonthIndex;
  const m = String(monthIndex + 1).padStart(2, '0');
  const monthStart = `${year}-${m}-01`;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;

  const { data: rows } = await supabaseAdmin
    .from('derived_metrics_daily')
    .select('total_revenue, total_ppc_spend, total_ppc_sales, total_orders, ntb_orders, ss_revenue, metric_date')
    .eq('brand_id', BRAND_ID)
    .gte('metric_date', monthStart)
    .lte('metric_date', monthEnd);

  type Row = Record<string, unknown>;
  const typedRows = (rows ?? []) as unknown as Row[];

  const sum = (field: string): number =>
    typedRows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);

  const totalRevenue  = sum('total_revenue');
  const totalSpend    = sum('total_ppc_spend');
  const totalPpcSales = sum('total_ppc_sales');
  const totalOrders   = sum('total_orders');
  const totalNtb      = sum('ntb_orders');
  const ssRevenue     = sum('ss_revenue');

  const actualRoas = totalSpend > 0 ? totalPpcSales / totalSpend : null;
  const actualMer  = totalSpend > 0 ? totalRevenue  / totalSpend : null;
  const actualAov  = totalOrders > 0 ? totalRevenue / totalOrders : null;
  const actualCac  = totalNtb > 0   ? totalSpend   / totalNtb    : null;

  const salesTarget = getMonthlyTarget('sales', year, monthIndex);
  const spendTarget = getMonthlyTarget('spend', year, monthIndex);
  const roasTarget  = getMonthlyTarget('roas',  year, monthIndex);
  const ntbTarget   = getMonthlyTarget('ntb',   year, monthIndex);

  const varPct = (actual: number | null, target: number | null): number | null =>
    actual !== null && target !== null && target !== 0
      ? (actual - target) / target
      : null;

  const pace = (actual: number | null, target: number | null): number | null =>
    actual !== null && target !== null && target !== 0
      ? Math.min(Math.max(actual / target, 0), 1.25)
      : null;

  const freshnessDate = period.end;
  const hasData = typedRows.length > 0;

  const penetration = totalRevenue > 0 ? ssRevenue / totalRevenue : null;
  const ssVariance: number | string | null =
    penetration !== null && penetration >= 0.30 ? 'on track' : null;

  return [
    {
      id: 'total_sales',
      label: 'TOTAL SALES',
      value: hasData ? fmtUSDCompact(totalRevenue) : '—',
      target: salesTarget !== null ? fmtUSDCompact(salesTarget) : '—',
      variance: varPct(totalRevenue, salesTarget),
      pacing: pace(totalRevenue, salesTarget),
      freshnessDate,
    },
    {
      id: 'ad_spend',
      label: 'AD SPEND',
      value: hasData ? fmtUSDCompact(totalSpend) : '—',
      target: spendTarget !== null ? fmtUSDCompact(spendTarget) : '—',
      variance: varPct(totalSpend, spendTarget),
      pacing: pace(totalSpend, spendTarget),
      freshnessDate,
    },
    {
      id: 'ppc_roas',
      label: 'PPC ROAS',
      value: fmtRoas(actualRoas),
      target: roasTarget !== null ? fmtRoas(roasTarget) : '—',
      variance: varPct(actualRoas, roasTarget),
      pacing: pace(actualRoas, roasTarget),
      freshnessDate,
    },
    {
      id: 'mer',
      label: 'MER',
      value: fmtRoas(actualMer),
      target: fmtRoas(MER_TARGET),
      variance: varPct(actualMer, MER_TARGET),
      pacing: pace(actualMer, MER_TARGET),
      freshnessDate,
    },
    {
      id: 'aov',
      label: 'AOV',
      value: actualAov !== null ? fmtUSD(actualAov, 2) : '—',
      target: fmtUSD(AOV_TARGET, 2),
      variance: varPct(actualAov, AOV_TARGET),
      pacing: pace(actualAov, AOV_TARGET),
      freshnessDate,
    },
    {
      id: 'ntb_customers',
      label: 'NTB CUSTOMERS',
      value: hasData ? fmtIntCompact(totalNtb) : '—',
      target: ntbTarget !== null ? fmtIntCompact(ntbTarget) : '—',
      variance: varPct(totalNtb, ntbTarget),
      pacing: pace(totalNtb, ntbTarget),
      freshnessDate,
      sourceTag: 'BA pending',
    },
    {
      id: 'cac',
      label: 'CAC',
      value: actualCac !== null ? fmtUSD(actualCac, 2) : '—',
      target: fmtUSD(CAC_TARGET, 2),
      variance: varPct(actualCac, CAC_TARGET),
      pacing: pace(actualCac, CAC_TARGET),
      freshnessDate,
    },
    {
      id: 'ss_revenue',
      label: 'S&S REVENUE',
      value: hasData ? fmtUSDCompact(ssRevenue) : '—',
      target: '—',
      variance: ssVariance,
      pacing: null,
      freshnessDate,
    },
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
  const { data, error } = await supabaseAdmin
    .from('report_ingestion_log')
    .select('report_type, date_range_start, rows_stored, ingested_at')
    .eq('brand_id', BRAND_ID)
    .eq('status', 'success');

  if (error || !data || data.length === 0) {
    return {
      lastIngest: '—',
      totalRows: 0,
      reportTypeCount: 0,
      monthsLoaded: 0,
      backfillStatus: 'not started',
      overdueReports: [],
      spApiConnected: false,
    };
  }

  // max(ingested_at)
  const lastIngest = data
    .map(r => r.ingested_at as string)
    .sort()
    .at(-1)
    ?.slice(0, 10) ?? '—';

  // sum(rows_stored)
  const totalRows = data.reduce((acc, r) => acc + (Number(r.rows_stored) || 0), 0);

  // count distinct report_type
  const reportTypeCount = new Set(data.map(r => r.report_type as string)).size;

  // count distinct YYYY-MM from date_range_start (data period, not ingestion timestamp)
  const months = new Set(
    data
      .map(r => (r.date_range_start as string | null)?.slice(0, 7))
      .filter((m): m is string => !!m)
  );
  const monthsLoaded = months.size;

  return {
    lastIngest,
    totalRows,
    reportTypeCount,
    monthsLoaded,
    backfillStatus: monthsLoaded >= 12 ? 'complete' : 'in progress',
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
