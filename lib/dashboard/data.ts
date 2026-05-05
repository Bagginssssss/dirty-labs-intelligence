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
import { fmtUSDCompact, fmtUSD, fmtRoas, fmtIntCompact, fmtPct, fmtPctSigned } from './format';
import { getAccountSummary } from '@/lib/queries/account';
import { getCampaignsByAdType } from '@/lib/queries/campaigns';
import { getHarvestCandidates } from '@/lib/queries/keywords';
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

  type Row = Record<string, unknown>;
  const sumRows = (arr: Row[], field: string): number =>
    arr.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);

  // Derived metrics (PPC spend, ROAS, MER, S&S, NTB fallback)
  const { data: dmdRows } = await supabaseAdmin
    .from('derived_metrics_daily')
    .select('total_revenue, total_ppc_spend, total_ppc_sales, ntb_orders, ss_revenue, metric_date')
    .eq('brand_id', BRAND_ID)
    .gte('metric_date', monthStart)
    .lte('metric_date', monthEnd);

  // Business report: correct AOV denominator is total_order_items (not total_orders)
  const { data: brRows } = await supabaseAdmin
    .from('business_report')
    .select('ordered_product_sales, total_order_items, report_date')
    .eq('brand_id', BRAND_ID)
    .gte('report_date', monthStart)
    .lte('report_date', monthEnd);

  // Brand Analytics NTB — try BA source first; fall back to derived PPC NTB
  const { data: baRows } = await supabaseAdmin
    .from('brand_analytics_customer_loyalty')
    .select('new_to_brand_customers, report_date')
    .eq('brand_id', BRAND_ID)
    .gte('report_date', monthStart)
    .lte('report_date', monthEnd);

  const typedDmd = (dmdRows ?? []) as unknown as Row[];
  const typedBr  = (brRows  ?? []) as unknown as Row[];
  const typedBa  = (baRows  ?? []) as unknown as Row[];

  const totalRevenue  = sumRows(typedDmd, 'total_revenue');
  const totalSpend    = sumRows(typedDmd, 'total_ppc_spend');
  const totalPpcSales = sumRows(typedDmd, 'total_ppc_sales');
  const ssRevenue     = sumRows(typedDmd, 'ss_revenue');

  // AOV: sum(ordered_product_sales) / sum(total_order_items) from business_report
  const totalSales = sumRows(typedBr, 'ordered_product_sales');
  const totalItems = sumRows(typedBr, 'total_order_items');
  const actualAov  = totalItems > 0 ? totalSales / totalItems : null;

  // NTB: prefer BA source; fall back to derived PPC NTB
  const baNtb      = sumRows(typedBa, 'new_to_brand_customers');
  const derivedNtb = sumRows(typedDmd, 'ntb_orders');
  const useBaSource = typedBa.length > 0 && baNtb > 0;
  const totalNtb    = useBaSource ? baNtb : derivedNtb;
  const ntbSourceTag = useBaSource ? 'BA' : 'BA pending';

  const actualRoas = totalSpend > 0 ? totalPpcSales / totalSpend : null;
  const actualMer  = totalSpend > 0 ? totalRevenue  / totalSpend : null;
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
  const hasData = typedDmd.length > 0;

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
      variance: useBaSource ? varPct(totalNtb, ntbTarget) : null,
      pacing:   useBaSource ? pace(totalNtb, ntbTarget)   : null,
      freshnessDate,
      sourceTag: ntbSourceTag,
    },
    {
      id: 'cac',
      label: 'CAC',
      value: actualCac !== null ? fmtUSD(actualCac, 2) : '—',
      target: fmtUSD(CAC_TARGET, 2),
      variance: useBaSource ? varPct(actualCac, CAC_TARGET) : null,
      pacing:   useBaSource ? pace(actualCac, CAC_TARGET)   : null,
      freshnessDate,
      sourceTag: useBaSource ? undefined : 'BA pending',
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
  const endDate = new Date(period.end + 'T00:00:00Z');
  const year = endDate.getUTCFullYear();
  const monthIndex = endDate.getUTCMonth() as MonthIndex;

  // 14-day cutoff for 'new' campaign status (compare against campaign created_at)
  const cutoff14d = new Date(endDate.getTime() - 14 * 86_400_000).toISOString();

  const [byType, harvest, acct, metaRes] = await Promise.all([
    getCampaignsByAdType(BRAND_ID, period.start, period.end),
    getHarvestCandidates(BRAND_ID, period.start, period.end),
    getAccountSummary(BRAND_ID, period.start, period.end),
    supabaseAdmin
      .from('campaigns')
      .select('id, created_at')
      .eq('brand_id', BRAND_ID),
  ]);

  const spRows  = byType['SP']  ?? [];
  const sbRows  = byType['SB']  ?? [];
  const sbvRows = byType['SBV'] ?? [];
  // Any unexpected ad_type keys (UNKNOWN, null, etc.) fold into the total
  const allRows = Object.values(byType).flat();

  const sumF = (arr: typeof allRows, f: 'spend' | 'sales') =>
    arr.reduce((a, r) => a + r[f], 0);

  const totalSpend    = sumF(allRows, 'spend');
  const totalSales    = sumF(allRows, 'sales');
  const spSpend       = sumF(spRows,  'spend');
  const spSales       = sumF(spRows,  'sales');
  const sbCombSpend   = sumF(sbRows,  'spend') + sumF(sbvRows, 'spend');
  const sbCombSales   = sumF(sbRows,  'sales') + sumF(sbvRows, 'sales');

  const blendedRoas   = totalSpend > 0  ? totalSales   / totalSpend   : null;
  const spRoas        = spSpend    > 0  ? spSales      / spSpend      : null;
  const sbRoas        = sbCombSpend > 0 ? sbCombSales  / sbCombSpend  : null;
  const sbShare       = totalSpend > 0  ? sbCombSpend  / totalSpend   : null;

  const spendTarget = getMonthlyTarget('spend', year, monthIndex);
  const roasTarget  = getMonthlyTarget('roas',  year, monthIndex);

  const spendVar = spendTarget && totalSpend > 0
    ? (totalSpend - spendTarget) / spendTarget
    : null;

  const spendTone: PPCStatRow['tone'] =
    spendVar === null  ? 'neutral'  :
    spendVar > 0.10    ? 'critical' :
    spendVar > 0.05    ? 'warning'  :
    spendVar < 0       ? 'positive' : 'neutral';

  const roasRatio = roasTarget && blendedRoas !== null
    ? blendedRoas / roasTarget
    : null;

  const roasTone: PPCStatRow['tone'] =
    roasRatio === null ? 'neutral'  :
    roasRatio >= 1.0   ? 'positive' :
    roasRatio >= 0.80  ? 'warning'  : 'critical';

  const sbShareTone: PPCStatRow['tone'] =
    sbShare === null   ? 'neutral'  :
    sbShare >= 0.25    ? 'positive' :
    sbShare >= 0.20    ? 'neutral'  : 'warning';

  const sbShareSecondary =
    sbShare === null   ? 'target 25%+'                  :
    sbShare >= 0.25    ? 'on target'                    :
    sbShare >= 0.20    ? 'target 25%+'                  :
    'underinvested · target 25%+';

  const harvestCount   = harvest.length;
  const organicRevenue = acct.organic_revenue;
  const organicShare   = acct.total_revenue > 0 ? organicRevenue / acct.total_revenue : null;

  const stats: PPCStatRow[] = [
    {
      id: 'spend',
      label: 'Total spend',
      primary: totalSpend > 0 ? fmtUSDCompact(totalSpend) : '—',
      secondary: spendTarget !== null
        ? `target ${fmtUSDCompact(spendTarget)}${spendVar !== null ? ` · ${fmtPctSigned(spendVar)}` : ''}`
        : 'target —',
      tone: spendTone,
    },
    {
      id: 'roas',
      label: 'Blended ROAS',
      primary: fmtRoas(blendedRoas),
      secondary: `SP ${fmtRoas(spRoas)} · SB ${fmtRoas(sbRoas)} · target ${roasTarget !== null ? fmtRoas(roasTarget) : '—'}`,
      tone: roasTone,
    },
    {
      id: 'sb_share',
      label: 'SB + SBV spend share',
      primary: sbShare !== null ? fmtPct(sbShare) : '—',
      secondary: sbShareSecondary,
      tone: sbShareTone,
    },
    {
      id: 'harvest',
      label: 'Harvest candidates',
      primary: `${harvestCount} terms`,
      secondary: 'ready for manual exact match',
      tone: harvestCount > 0 ? 'positive' : 'neutral',
    },
    {
      id: 'organic',
      label: 'Organic revenue',
      primary: organicRevenue > 0 ? fmtUSDCompact(organicRevenue) : '—',
      secondary: organicShare !== null ? `${fmtPct(organicShare)} of total` : '— of total',
      tone: 'neutral',
    },
  ];

  // Watchlist — map queries.CampaignRow → dashboard CampaignRow
  const createdAtMap = new Map<string, string>();
  if (!metaRes.error && metaRes.data) {
    for (const c of metaRes.data) {
      if (c.created_at) createdAtMap.set(c.id, c.created_at as string);
    }
  }

  function toAdType(raw: string | null): 'SP' | 'SB' | 'SBV' {
    if (raw === 'SBV') return 'SBV';
    if (raw === 'SB')  return 'SB';
    return 'SP';
  }

  function toStatus(
    adType: 'SP' | 'SB' | 'SBV',
    roas: number | null,
    spend: number,
    campaignId: string,
  ): CampaignRow['status'] {
    if (adType === 'SBV') return 'sbv';
    const createdAt = createdAtMap.get(campaignId);
    if (createdAt && createdAt > cutoff14d) return 'new';
    if (roas !== null && roas >= 5) return 'top';
    if (roas !== null && roas < 2 && spend > 50) return 'waste';
    return 'watching';
  }

  const watchlist: CampaignRow[] = allRows
    .filter(c => c.spend > 0)
    .map((c): CampaignRow => {
      const adType = toAdType(c.ad_type);
      return {
        id:          c.campaign_uuid,
        name:        c.campaign_name ?? c.campaign_uuid,
        adType,
        spend:       c.spend,
        roas:        c.roas,
        orders:      c.orders,
        impressions: c.impressions,
        status:      toStatus(adType, c.roas, c.spend, c.campaign_uuid),
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 200);

  return { stats, campaigns: watchlist };
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
