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
  Domain,
  GoalCard,
  IngestStatus,
  MarketShareView,
  PPCSnapshot,
  PPCStatRow,
  RankMover,
  SearchIntelData,
  Severity,
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
import { getAnomalies } from '@/lib/queries/anomalies';
import { getASINPerformance } from '@/lib/queries/products';
import { getRankMovers } from '@/lib/queries/rank';
import { shortName, ASIN_NAMES } from './asin-names';

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

  const [
    { data: dmdRows },
    { data: brRows },
    { data: baRows },
    sbGoalRes,
  ] = await Promise.all([
    // Derived metrics (PPC spend, ROAS, MER, S&S, NTB fallback)
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_revenue, total_ppc_spend, total_ppc_sales, ntb_orders, ss_revenue, metric_date')
      .eq('brand_id', BRAND_ID)
      .gte('metric_date', monthStart)
      .lte('metric_date', monthEnd),
    // Business report: correct AOV denominator is total_order_items (not total_orders)
    supabaseAdmin
      .from('business_report_daily')
      .select('ordered_product_sales, total_order_items, report_date')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', monthStart)
      .lte('report_date', monthEnd),
    // Brand Analytics NTB — try BA source first; fall back to derived PPC NTB
    supabaseAdmin
      .from('brand_analytics_customer_loyalty')
      .select('new_to_brand_customers, report_date')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', monthStart)
      .lte('report_date', monthEnd),
    // Earliest SB/SBV row — used to flag SP-only goal cards when period predates coverage
    supabaseAdmin
      .from('sp_campaign_performance')
      .select('report_date')
      .eq('brand_id', BRAND_ID)
      .in('ad_type', ['SB', 'SBV'])
      .order('report_date', { ascending: true })
      .limit(1),
  ]);

  const sbGoalFrom   = (!sbGoalRes.error && (sbGoalRes.data?.[0]?.report_date as string | undefined)) || null;
  const sbGoalComplete = sbGoalFrom !== null && monthStart >= sbGoalFrom;
  const spOnlyTag    = sbGoalComplete ? undefined : 'SP only';

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
      sourceTag: spOnlyTag,
    },
    {
      id: 'ppc_roas',
      label: 'PPC ROAS',
      value: fmtRoas(actualRoas),
      target: roasTarget !== null ? fmtRoas(roasTarget) : '—',
      variance: varPct(actualRoas, roasTarget),
      pacing: pace(actualRoas, roasTarget),
      freshnessDate,
      sourceTag: spOnlyTag,
    },
    {
      id: 'mer',
      label: 'MER',
      value: fmtRoas(actualMer),
      target: fmtRoas(MER_TARGET),
      variance: varPct(actualMer, MER_TARGET),
      pacing: pace(actualMer, MER_TARGET),
      freshnessDate,
      sourceTag: spOnlyTag,
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
/* Alerts — markdown helpers                                                  */
/* -------------------------------------------------------------------------- */

function stripMd(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^---+\n?/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Parse a platform_insights markdown content blob into plain-text Alert fields.
 * Expected structure:
 *   ## [emoji] SEVERITY: Campaign Name
 *   **Figure | Spend | Status**
 *   ### What the data shows
 *   Plain explanation...
 *   ### Recommended action
 *   1. Do this thing.
 */
function parseInsightContent(title: string, content: string): {
  entity: string; figure: string; description: string; recommendation: string;
} {
  let entity = title.slice(0, 80);
  let figure = title.slice(0, 80);
  let description = '';
  let recommendation = 'Review AI analysis and act on findings.';

  const lines = content.split('\n');

  // Entity: "## [emoji] SEVERITY: Campaign name" — take text after last ": "
  const entityLine = lines.find(l => /^## /.test(l));
  if (entityLine) {
    const raw = entityLine.replace(/^## /, '').trim();
    const colon = raw.indexOf(': ');
    entity = ((colon !== -1 ? raw.slice(colon + 2) : raw).trim()).slice(0, 80);
  }

  // Figure: first **bold** line (the stats summary immediately after entity header)
  const boldMatch = content.match(/^\*\*(.+?)\*\*\s*$/m);
  if (boldMatch) figure = boldMatch[1].trim().slice(0, 120);

  // Description: first paragraph under "### What the data shows" or "### Context"
  let capDesc = false;
  for (const line of lines) {
    if (/^###\s+(What the data shows|Context)/i.test(line)) { capDesc = true; continue; }
    if (capDesc && /^#/.test(line)) break;
    if (capDesc && line.trim() && !line.startsWith('#')) {
      const plain = stripMd(line);
      if (plain.length > 20) {
        const sentEnd = plain.slice(0, 180).search(/[.!?]\s/);
        description = sentEnd > 20 ? plain.slice(0, sentEnd + 1) : plain.slice(0, 180);
        break;
      }
    }
  }
  if (!description) {
    // Fallback: first substantive non-header paragraph
    const fallback = lines.find(l =>
      !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('**') && l.trim().length > 40
    );
    if (fallback) description = stripMd(fallback).slice(0, 180);
  }

  // Recommendation: first item from "### Recommended action"
  let capRec = false;
  for (const line of lines) {
    if (/^###\s+(Recommended action|What you should do)/i.test(line)) { capRec = true; continue; }
    if (capRec && /^#/.test(line)) break;
    if (capRec && line.trim()) {
      recommendation = stripMd(line).replace(/^\d+\.\s*/, '').trim().slice(0, 200);
      break;
    }
  }

  return { entity, figure, description, recommendation };
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

async function loadAlerts(period: ResolvedPeriod): Promise<{ alerts: Alert[]; summary: AlertSummary }> {
  // lookbackDays spans the full dashboard period so getAnomalies windows correctly
  // even when derived_metrics_daily has one monthly-aggregate row instead of daily rows.
  const periodDays = Math.max(1,
    Math.round((new Date(period.end + 'T00:00:00Z').getTime() - new Date(period.start + 'T00:00:00Z').getTime()) / 86_400_000) + 1
  );

  // platform_insights: 14-day wall-clock lookback (not period-relative).
  // 14 days chosen so we catch insights written on weekends or skipped cycles.
  const insightsCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [anomalyItems, insightsRes] = await Promise.all([
    getAnomalies(BRAND_ID, period.end, periodDays),
    supabaseAdmin
      .from('platform_insights')
      .select('id, insight_type, severity, title, content, created_at')
      .eq('brand_id', BRAND_ID)
      .in('severity', ['critical', 'warning'])
      .gte('created_at', insightsCutoff)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  // ── helpers ────────────────────────────────────────────────────────────────

  function anomalyDomain(type: string): Domain {
    if (['roas_drop', 'high_acos_campaign', 'zero_sales_campaign'].includes(type)) return 'PPC';
    if (['spend_pacing', 'buy_box_drop', 'low_ntb_rate'].includes(type)) return 'BUSINESS';
    return 'PPC';
  }

  function anomalyFigure(a: (typeof anomalyItems)[0]): { figure: string; metric: string } {
    switch (a.type) {
      case 'roas_drop':
        return { figure: `${a.current_value.toFixed(2)}x ROAS`, metric: `${a.current_value.toFixed(2)}x ROAS` };
      case 'spend_pacing':
        return { figure: `$${Math.round(a.current_value).toLocaleString()} MTD`, metric: `$${Math.round(a.current_value).toLocaleString()} spend` };
      case 'buy_box_drop':
        return { figure: `${a.current_value.toFixed(1)}% buy box`, metric: `${a.current_value.toFixed(1)}% buy box` };
      case 'high_acos_campaign':
        return { figure: `${(a.current_value * 100).toFixed(1)}% ACoS`, metric: `${(a.current_value * 100).toFixed(1)}% ACoS` };
      case 'zero_sales_campaign':
        return { figure: '0 orders', metric: '0 orders' };
      case 'low_ntb_rate':
        return { figure: `${(a.current_value * 100).toFixed(2)}% NTB rate`, metric: `${(a.current_value * 100).toFixed(2)}% NTB` };
      default:
        return { figure: String(a.current_value), metric: a.metric };
    }
  }

  const ANOMALY_RECS: Record<string, string> = {
    roas_drop:           'Audit top-spend campaigns; pause underperformers and shift budget to high-ROAS ad groups.',
    spend_pacing:        'Increase daily budgets or raise bids on high-performing campaigns to hit the monthly target.',
    buy_box_drop:        'Check for price suppression, FBA inventory levels, and seller competition on the ASIN.',
    high_acos_campaign:  'Reduce bids on high-ACoS targets, add negatives, and review match types.',
    zero_sales_campaign: 'Pause campaign or add negative keywords; verify search term relevance.',
    low_ntb_rate:        'Increase SB/SBV budget and test new creative to capture more upper-funnel traffic.',
  };

  function mapOneAnomaly(a: (typeof anomalyItems)[0], idx: number): Alert {
    const domain = anomalyDomain(a.type);
    const entity = /^B[A-Z0-9]{9}$/.test(a.entity) ? shortName(a.entity) : a.entity;
    const { figure, metric } = anomalyFigure(a);
    return {
      id:             `anom-${a.type}-${idx}`,
      severity:       a.severity as Severity,
      domain,
      entity,
      figure,
      description:    a.note,
      recommendation: ANOMALY_RECS[a.type] ?? 'Review and act.',
      href:           domain === 'PPC' ? '/ppc' : domain === 'SEO' ? '/seo' : '/business',
      metric,
    };
  }

  function insightDomain(insightType: string): Domain {
    const t = insightType.toLowerCase();
    if (/campaign|spend|roas|acos|ppc|bid|harvest/.test(t)) return 'PPC';
    if (/rank|sqp|search.?query|impression.?share/.test(t)) return 'SEO';
    return 'BUSINESS';
  }

  function normalizeSeverity(s: string): Severity {
    if (s === 'critical') return 'critical';
    if (s === 'warning')  return 'warning';
    if (s === 'watch')    return 'watch';
    return 'info';
  }

  // ── group anomalies by type ────────────────────────────────────────────────
  const byType = new Map<string, typeof anomalyItems>();
  for (const a of anomalyItems) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type)!.push(a);
  }

  // ── 2A: parent ASIN filter + unknown ASIN tracking ─────────────────────────
  // asins.parent_asin is null for all rows in this brand (verified via migration query).
  // Fallback heuristic: ASINs absent from ASIN_NAMES are treated as unknown/deprecated
  // — excluded from individual alerts, counted for a catalog hygiene info alert instead.
  let unknownAsinCount = 0;
  const rawAlerts: Alert[] = [];
  let anomIdx = 0;

  // ── buy_box_drop: split known vs unknown ───────────────────────────────────
  const bbItems = byType.get('buy_box_drop') ?? [];
  const knownBb = bbItems.filter(a => a.entity in ASIN_NAMES);
  unknownAsinCount += bbItems.length - knownBb.length;
  if (knownBb.length > 3) {
    rawAlerts.push({
      id: 'agg-buy-box', severity: 'critical', domain: 'BUSINESS',
      entity: `${knownBb.length} ASINs`,
      figure: `${knownBb.length} with low buy box`,
      description: `${knownBb.length} ASINs have buy box below 90% in the period.`,
      recommendation: 'Check FBA inventory, pricing, and seller competition for each ASIN.',
      href: '/business', metric: `${knownBb.length} ASINs`,
    });
  } else {
    for (const a of knownBb) rawAlerts.push(mapOneAnomaly(a, anomIdx++));
  }

  // ── 2B: high_acos_campaign — aggregate when >3 ───────────────────────────
  const acosItems = byType.get('high_acos_campaign') ?? [];
  if (acosItems.length > 3) {
    const totalSpend = acosItems.reduce((sum, a) => {
      const m = a.note.match(/on \$(\d+)/);
      return sum + (m ? Number(m[1]) : 0);
    }, 0);
    const topSev: Severity = acosItems.some(a => a.severity === 'critical') ? 'critical' : 'warning';
    rawAlerts.push({
      id: 'agg-high-acos', severity: topSev, domain: 'PPC',
      entity: `${acosItems.length} campaigns`,
      figure: totalSpend > 0 ? `${fmtUSDCompact(totalSpend)} waste` : `${acosItems.length} campaigns`,
      description: `${acosItems.length} campaigns above target ACoS · ${fmtUSDCompact(totalSpend)} combined spend.`,
      recommendation: 'Reduce bids on high-ACoS targets, add negatives, and review match types.',
      href: '/ppc',
      metric: `${fmtUSDCompact(totalSpend)} ACoS waste`,
    });
  } else {
    for (const a of acosItems) rawAlerts.push(mapOneAnomaly(a, anomIdx++));
  }

  // ── remaining anomaly types: individual (≤3 each by construction) ─────────
  const handled = new Set(['buy_box_drop', 'high_acos_campaign']);
  for (const [type, items] of byType) {
    if (handled.has(type)) continue;
    for (const a of items) rawAlerts.push(mapOneAnomaly(a, anomIdx++));
  }

  // ── platform insights ──────────────────────────────────────────────────────
  type PiRow = Record<string, unknown>;
  const insightAlerts: Alert[] = ((insightsRes.data ?? []) as unknown as PiRow[]).map((row): Alert => {
    const domain = insightDomain(row['insight_type'] as string);
    const { entity, figure, description, recommendation } = parseInsightContent(
      row['title'] as string,
      row['content'] as string,
    );
    return {
      id:             row['id'] as string,
      severity:       normalizeSeverity(row['severity'] as string),
      domain,
      entity,
      figure,
      description:    description || 'See AI analysis for details.',
      recommendation,
      href:           domain === 'PPC' ? '/ppc' : domain === 'SEO' ? '/seo' : '/business',
      metric:         (row['insight_type'] as string).replace(/_/g, ' '),
    };
  });
  rawAlerts.push(...insightAlerts);

  // ── 2C: catalog hygiene info alert ────────────────────────────────────────
  if (unknownAsinCount > 0) {
    rawAlerts.push({
      id: 'catalog-hygiene', severity: 'info', domain: 'BUSINESS',
      entity: 'Catalog hygiene',
      figure: `${unknownAsinCount} unknown ASINs`,
      description: `${unknownAsinCount} ASINs in business_report not present in ASIN_NAMES — likely deprecated or competitor data leak.`,
      recommendation: 'Audit catalog mapping.',
      href: '/business',
      metric: `${unknownAsinCount} unknown`,
    });
  }

  // ── sort + 2C volume cap: ≤3 critical, ≤5 warning, ≤5 watch, ≤2 info ─────
  const SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, watch: 2, info: 3 };
  rawAlerts.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));

  const capped: Alert[] = [
    ...rawAlerts.filter(a => a.severity === 'critical').slice(0, 3),
    ...rawAlerts.filter(a => a.severity === 'warning').slice(0, 5),
    ...rawAlerts.filter(a => a.severity === 'watch').slice(0, 5),
    ...rawAlerts.filter(a => a.severity === 'info').slice(0, 2),
  ].slice(0, 15);

  const summary: AlertSummary = {
    total:    capped.length,
    critical: capped.filter(a => a.severity === 'critical').length,
    warning:  capped.filter(a => a.severity === 'warning').length,
    watch:    capped.filter(a => a.severity === 'watch' || a.severity === 'info').length,
  };

  return { alerts: capped, summary };
}

/* -------------------------------------------------------------------------- */
/* Business Health                                                            */
/* -------------------------------------------------------------------------- */

async function loadBusinessHealth(period: ResolvedPeriod): Promise<BusinessHealthData> {
  const endDate   = period.end;
  const startDate = period.start;

  // ── 5E: 90-day bundle window ───────────────────────────────────────────────
  const bundleEndMs    = new Date(endDate + 'T00:00:00Z').getTime();
  const bundleStartMs  = bundleEndMs - 90 * 86_400_000;
  const bundleStartStr = new Date(bundleStartMs).toISOString().slice(0, 10);

  // Prior 90-day for shareOfTotalChange
  const prior90EndStr   = new Date(bundleStartMs - 86_400_000).toISOString().slice(0, 10);
  const prior90StartStr = new Date(bundleStartMs - 91 * 86_400_000).toISOString().slice(0, 10);

  // WoW: last 7 days (within 90-day window) vs prior 7 days before that
  const lastWeekStartStr  = new Date(bundleEndMs - 7 * 86_400_000).toISOString().slice(0, 10);
  const priorWeekStartStr = new Date(bundleEndMs - 14 * 86_400_000).toISOString().slice(0, 10);
  const priorWeekEndStr   = new Date(bundleEndMs - 8 * 86_400_000).toISOString().slice(0, 10);

  // ── 5D: prior month range ──────────────────────────────────────────────────
  const periodYear  = Number(startDate.slice(0, 4));
  const periodMonth = Number(startDate.slice(5, 7));
  const priorYear   = periodMonth === 1 ? periodYear - 1 : periodYear;
  const priorMonth  = periodMonth === 1 ? 12 : periodMonth - 1;
  const priorMonthStart = `${priorYear}-${String(priorMonth).padStart(2, '0')}-01`;
  const priorMonthEnd   = new Date(Date.UTC(periodYear, periodMonth - 1, 0)).toISOString().slice(0, 10);

  const [
    scProductsRes,
    scBrandsRes,
    asinPerf,
    priorAsinPerf,
    ssCurrentRes,
    ssPriorRes,
    bundleCurrentRes,
    bundlePriorWeekRes,
    bundlePrior90Res,
    br90Res,
    brPrior90Res,
    dmdRes,
    dmdPriorRes,
    bundleLatestDateRes,
  ] = await Promise.all([

    // 5A: Dirty Labs products only
    supabaseAdmin
      .from('smartscout_subcategory_products')
      .select('asin, subcategory, primary_subcategory_rank, est_monthly_revenue, snapshot_date')
      .eq('brand_id', BRAND_ID)
      .ilike('brand_name', '%dirty labs%')
      .order('snapshot_date', { ascending: false }),

    // 5B: All brands at latest snapshot
    supabaseAdmin
      .from('smartscout_subcategory_brands')
      .select('brand_name, market_share, market_share_change, snapshot_date')
      .eq('brand_id', BRAND_ID)
      .order('snapshot_date', { ascending: false })
      .limit(200),

    // 5C: CVR/Buy Box — current and prior period (same-length window)
    getASINPerformance(BRAND_ID, startDate, endDate),
    getASINPerformance(BRAND_ID, priorMonthStart, priorMonthEnd),

    // 5D: S&S current month
    supabaseAdmin
      .from('subscribe_and_save')
      .select('active_subscriptions, ss_revenue')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', startDate)
      .lte('report_date', endDate),

    // 5D: S&S prior month (for MoM)
    supabaseAdmin
      .from('subscribe_and_save')
      .select('active_subscriptions, ss_revenue')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', priorMonthStart)
      .lte('report_date', priorMonthEnd),

    // 5E: Bundles 90-day window (includes sale_date for WoW split)
    supabaseAdmin
      .from('virtual_bundle_sales')
      .select('bundles_sold, total_sales_usd, sale_date')
      .eq('brand_id', BRAND_ID)
      .gte('sale_date', bundleStartStr)
      .lte('sale_date', endDate),

    // 5E: Bundles prior week (WoW comparison)
    supabaseAdmin
      .from('virtual_bundle_sales')
      .select('bundles_sold, total_sales_usd')
      .eq('brand_id', BRAND_ID)
      .gte('sale_date', priorWeekStartStr)
      .lte('sale_date', priorWeekEndStr),

    // 5E: Bundles prior 90-day (shareOfTotalChange)
    supabaseAdmin
      .from('virtual_bundle_sales')
      .select('bundles_sold, total_sales_usd')
      .eq('brand_id', BRAND_ID)
      .gte('sale_date', prior90StartStr)
      .lte('sale_date', prior90EndStr),

    // 5E: Business report total for 90-day (shareOfTotal denominator)
    supabaseAdmin
      .from('business_report_daily')
      .select('ordered_product_sales')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', bundleStartStr)
      .lte('report_date', endDate),

    // 5E: Business report prior 90-day (shareOfTotalChange denominator)
    supabaseAdmin
      .from('business_report_daily')
      .select('ordered_product_sales')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', prior90StartStr)
      .lte('report_date', prior90EndStr),

    // 5D: DMD total_revenue for penetration
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_revenue')
      .eq('brand_id', BRAND_ID)
      .gte('metric_date', startDate)
      .lte('metric_date', endDate),

    // 5D: DMD prior month (penetration MoM denominator)
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_revenue')
      .eq('brand_id', BRAND_ID)
      .gte('metric_date', priorMonthStart)
      .lte('metric_date', priorMonthEnd),

    // 4D: latest sale_date in virtual_bundle_sales (for empty-state message)
    supabaseAdmin
      .from('virtual_bundle_sales')
      .select('sale_date')
      .eq('brand_id', BRAND_ID)
      .order('sale_date', { ascending: false })
      .limit(1),
  ]);

  // ── 5A: Subcategory Rank ────────────────────────────────────────────────────
  function toSubcatKey(sc: string): SubcategoryRankRow['key'] | null {
    const lower = sc.toLowerCase();
    if (lower.includes('dishwasher')) return 'dishwasher';
    if (lower.includes('stain'))      return 'stain_remover';
    if (lower.includes('laundry'))    return 'laundry';
    if (lower.includes('toilet'))     return 'toilet';
    return null;
  }

  type ScProdRow = {
    asin: string; subcategory: string;
    primary_subcategory_rank: number | null;
    est_monthly_revenue: number | null;
    snapshot_date: string;
  };
  const scProds = (scProductsRes.data ?? []) as unknown as ScProdRow[];

  const scByKey = new Map<SubcategoryRankRow['key'], ScProdRow[]>();
  for (const row of scProds) {
    const key = toSubcatKey(row.subcategory);
    if (!key) continue;
    if (!scByKey.has(key)) scByKey.set(key, []);
    scByKey.get(key)!.push(row);
  }

  const SC_DEFS: Array<{ key: SubcategoryRankRow['key']; label: string }> = [
    { key: 'dishwasher',    label: 'Dishwasher Detergent'  },
    { key: 'laundry',       label: 'Laundry Detergent'     },
    { key: 'stain_remover', label: 'Laundry Stain Remover' },
    { key: 'toilet',        label: 'Toilet Bowl Cleaner'   },
  ];

  const subcategoryRanks: SubcategoryRankRow[] = SC_DEFS.map(({ key, label }) => {
    const rows = scByKey.get(key) ?? [];
    if (rows.length === 0) return { key, label, rank: null, revenuePerMonth: null, topAsins: [], snapshotDate: endDate };

    const latestDate = rows[0].snapshot_date;
    const latest = rows.filter(r => r.snapshot_date === latestDate);

    const rank = latest.reduce((best: number | null, r) => {
      const rk = r.primary_subcategory_rank;
      if (rk == null) return best;
      return best == null ? rk : Math.min(best, rk);
    }, null);

    const revenuePerMonth = latest.reduce((s, r) => s + (Number(r.est_monthly_revenue) || 0), 0);

    const topAsins = latest
      .sort((a, b) => (Number(b.est_monthly_revenue) || 0) - (Number(a.est_monthly_revenue) || 0))
      .slice(0, 3)
      .map(r => shortName(r.asin));

    return { key, label, rank, revenuePerMonth, topAsins, snapshotDate: latestDate };
  });

  // ── 5B: Market Share ────────────────────────────────────────────────────────
  // Note: smartscout_subcategory_brands has no subcategory column — all ingested
  // data is for Dishwasher Detergent. Laundry and Stain Remover views are empty
  // until those subcategories are exported from SmartScout.
  type ScBrandRow = {
    brand_name: string;
    market_share: number | null;
    market_share_change: number | null;
    snapshot_date: string;
  };
  const scBrands = (scBrandsRes.data ?? []) as unknown as ScBrandRow[];

  const latestBrandSnap = scBrands[0]?.snapshot_date ?? endDate;
  const latestBrandsAll = scBrands
    .filter(r => r.snapshot_date === latestBrandSnap)
    .sort((a, b) => (Number(b.market_share) || 0) - (Number(a.market_share) || 0));
  const top5       = latestBrandsAll.slice(0, 5);
  const dlRow      = latestBrandsAll.find(r => r.brand_name.toLowerCase().includes('dirty labs'));
  const dlInTop5   = top5.some(r => r.brand_name.toLowerCase().includes('dirty labs'));
  // Always show Dirty Labs — append as 6th row if not already in top 5
  const dishwasherBrands = [...top5, ...(dlInTop5 || !dlRow ? [] : [dlRow])].map(r => ({
    brand: r.brand_name,
    share: Number(r.market_share) || 0,
    mom: r.market_share_change !== null ? Number(r.market_share_change) : null,
    isOurs: r.brand_name.toLowerCase().includes('dirty labs'),
  }));

  const marketShare: MarketShareView[] = [
    { subcategory: 'dishwasher',    label: 'Dishwasher',    rows: dishwasherBrands, snapshotDate: latestBrandSnap },
    { subcategory: 'laundry',       label: 'Laundry',       rows: [],               snapshotDate: endDate },
    { subcategory: 'stain_remover', label: 'Stain Remover', rows: [],               snapshotDate: endDate },
  ];

  // ── 5C: CVR / Buy Box ───────────────────────────────────────────────────────
  const knownPerf = asinPerf.filter(r => r.asin in ASIN_NAMES).slice(0, 6);

  // Prior-period CVR map (ASIN → cvr) for period-over-period comparison
  const priorCvrMap = new Map<string, number>();
  for (const r of priorAsinPerf) {
    if ((r.asin in ASIN_NAMES) && r.cvr !== null) priorCvrMap.set(r.asin, r.cvr);
  }

  // Brand avg CVR (fallback when no prior-period data for an ASIN)
  const brandTotalSessions = knownPerf.reduce((s, r) => s + r.sessions, 0);
  const brandTotalOrders   = knownPerf.reduce((s, r) => s + r.units_ordered, 0);
  const brandAvgCvr        = brandTotalSessions > 0 ? brandTotalOrders / brandTotalSessions : null;

  const cvrBuyBox: CVRBuyBoxRow[] = knownPerf.map(r => {
    const cvr = r.cvr ?? 0;
    let cvrTrend: CVRBuyBoxRow['cvrTrend'] = 'average';
    const priorCvr = priorCvrMap.get(r.asin);
    if (priorCvr != null && priorCvr > 0) {
      // Period-over-period: ±5% threshold
      const delta = (cvr - priorCvr) / priorCvr;
      cvrTrend = delta > 0.05 ? 'above' : delta < -0.05 ? 'below' : 'average';
    } else if (brandAvgCvr !== null && brandAvgCvr > 0) {
      // Fallback: compare to brand average for the period
      cvrTrend = cvr > brandAvgCvr * 1.2 ? 'above' : cvr < brandAvgCvr * 0.8 ? 'below' : 'average';
    }
    // buy_box_pct stored as percentage (99.18), component expects decimal (0..1)
    return { asinShortName: shortName(r.asin), asin: r.asin, cvr, cvrTrend, buyBox: (r.buy_box_pct ?? 0) / 100 };
  });

  // ── 5D: Subscribe & Save ────────────────────────────────────────────────────
  type SsAggRow = { active_subscriptions: number | null; ss_revenue: number | null };
  const ssCurRows   = (ssCurrentRes.data ?? []) as unknown as SsAggRow[];
  const ssPriorRows = (ssPriorRes.data   ?? []) as unknown as SsAggRow[];

  const activeSubs  = ssCurRows.reduce((s, r) => s + (Number(r.active_subscriptions) || 0), 0);
  const ssRevenue   = ssCurRows.reduce((s, r) => s + (Number(r.ss_revenue) || 0), 0);
  const priorSubs   = ssPriorRows.reduce((s, r) => s + (Number(r.active_subscriptions) || 0), 0);
  const priorSsRev  = ssPriorRows.reduce((s, r) => s + (Number(r.ss_revenue) || 0), 0);

  const hasPriorSs    = ssPriorRows.length > 0;
  const activeSubsMoM = hasPriorSs && priorSubs > 0 ? (activeSubs - priorSubs) / priorSubs : null;
  const ssRevenueMoM  = hasPriorSs && priorSsRev > 0 ? (ssRevenue - priorSsRev) / priorSsRev : null;

  type DmdRevRow = { total_revenue: number | null };
  const totalRevenue  = ((dmdRes.data   ?? []) as unknown as DmdRevRow[]).reduce((s, r) => s + (Number(r.total_revenue) || 0), 0);
  const priorTotalRev = ((dmdPriorRes.data ?? []) as unknown as DmdRevRow[]).reduce((s, r) => s + (Number(r.total_revenue) || 0), 0);

  const penetration     = totalRevenue > 0 ? ssRevenue / totalRevenue : null;
  const priorPenetration = priorTotalRev > 0 && priorSsRev > 0 ? priorSsRev / priorTotalRev : null;
  const penetrationMoM  = penetration !== null && priorPenetration !== null
    ? penetration - priorPenetration : null;

  const ss: SSCards = { activeSubs, activeSubsMoM, ssRevenue, ssRevenueMoM, penetration, penetrationMoM };

  // ── 5E: Bundle Performance ──────────────────────────────────────────────────
  // virtual_bundle_sales data currently ends 2024-01-29; 90-day window
  // ending period.end is empty for 2026 periods until new data is ingested.
  type BundleCurRow = { bundles_sold: number | null; total_sales_usd: number | null; sale_date: string };
  type BundleSumRow = { bundles_sold: number | null; total_sales_usd: number | null };

  const bundleCur     = (bundleCurrentRes.data  ?? []) as unknown as BundleCurRow[];
  const bundlePriorWk = (bundlePriorWeekRes.data ?? []) as unknown as BundleSumRow[];
  const bundlePrior90 = (bundlePrior90Res.data  ?? []) as unknown as BundleSumRow[];

  const bundleRevenue = bundleCur.reduce((s, r) => s + (Number(r.total_sales_usd) || 0), 0);
  const bundleUnits   = bundleCur.reduce((s, r) => s + (Number(r.bundles_sold) || 0), 0);

  const lastWkRev = bundleCur
    .filter(r => r.sale_date >= lastWeekStartStr)
    .reduce((s, r) => s + (Number(r.total_sales_usd) || 0), 0);
  const priorWkRev = bundlePriorWk.reduce((s, r) => s + (Number(r.total_sales_usd) || 0), 0);
  const lastWkUnits = bundleCur
    .filter(r => r.sale_date >= lastWeekStartStr)
    .reduce((s, r) => s + (Number(r.bundles_sold) || 0), 0);
  const priorWkUnits = bundlePriorWk.reduce((s, r) => s + (Number(r.bundles_sold) || 0), 0);

  const revenueWoW = priorWkRev  > 0 ? (lastWkRev   - priorWkRev)   / priorWkRev   : null;
  const unitsWoW   = priorWkUnits > 0 ? (lastWkUnits - priorWkUnits) / priorWkUnits : null;

  type BrSumRow = { ordered_product_sales: number | null };
  const br90Total      = ((br90Res.data      ?? []) as unknown as BrSumRow[]).reduce((s, r) => s + (Number(r.ordered_product_sales) || 0), 0);
  const brPrior90Total = ((brPrior90Res.data ?? []) as unknown as BrSumRow[]).reduce((s, r) => s + (Number(r.ordered_product_sales) || 0), 0);

  const shareOfTotal      = br90Total > 0 ? bundleRevenue / br90Total : null;
  const prior90Revenue    = bundlePrior90.reduce((s, r) => s + (Number(r.total_sales_usd) || 0), 0);
  const priorShareOfTotal = brPrior90Total > 0 ? prior90Revenue / brPrior90Total : null;
  const shareOfTotalChange = shareOfTotal !== null && priorShareOfTotal !== null
    ? shareOfTotal - priorShareOfTotal : null;

  // UTC date formatting to avoid timezone day-shift on DST boundaries
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const bsd = new Date(bundleStartMs);
  const bed = new Date(bundleEndMs);
  const windowLabel = `${MONTHS[bsd.getUTCMonth()]} ${bsd.getUTCDate()}–${MONTHS[bed.getUTCMonth()]} ${bed.getUTCDate()}`;

  // Format latest upload date as "Jan 29, 2024" for empty-state copy
  const rawLatestBundleDate = (bundleLatestDateRes.data?.[0] as { sale_date?: string } | undefined)?.sale_date ?? null;
  const lastUploadDate: string | null = rawLatestBundleDate
    ? (() => {
        const [y, m, d] = rawLatestBundleDate.split('-').map(Number);
        return `${MONTHS[m - 1]} ${d}, ${y}`;
      })()
    : null;

  const bundles: BundleCards = {
    revenue: bundleRevenue,
    revenueWoW,
    shareOfTotal,
    shareOfTotalChange,
    units: bundleUnits,
    unitsWoW,
    windowLabel,
    lastUploadDate,
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

  // 14-day cutoff for 'new' campaign tag: campaigns.launch_date >= this date.
  const cutoff14dDate = new Date(endDate.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);

  const [byType, harvest, acct, sbFromRes] = await Promise.all([
    getCampaignsByAdType(BRAND_ID, period.start, period.end),
    getHarvestCandidates(BRAND_ID, period.start, period.end),
    getAccountSummary(BRAND_ID, period.start, period.end),
    // Earliest SB/SBV row — determines whether this period has full PPC coverage.
    supabaseAdmin
      .from('sp_campaign_performance')
      .select('report_date')
      .eq('brand_id', BRAND_ID)
      .in('ad_type', ['SB', 'SBV'])
      .order('report_date', { ascending: true })
      .limit(1),
  ]);

  const sbAvailableFrom = (!sbFromRes.error && (sbFromRes.data?.[0]?.report_date as string | undefined)) || null;
  const sbIsComplete    = sbAvailableFrom !== null && period.start >= sbAvailableFrom;

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
      id: 'paid_sales',
      label: 'Paid sales',
      primary: totalSales > 0 ? fmtUSDCompact(totalSales) : '—',
      secondary: acct.total_revenue > 0 ? `${fmtPct(totalSales / acct.total_revenue, 1)} of total` : '— of total',
      tone: 'neutral',
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
  function toAdType(raw: string | null): 'SP' | 'SB' | 'SBV' {
    if (raw === 'SBV') return 'SBV';
    if (raw === 'SB')  return 'SB';
    return 'SP';
  }

  function toStatus(
    roas: number | null,
    spend: number,
    impressions: number,
    launchDate: string | null,
  ): CampaignRow['status'] {
    if (launchDate && launchDate >= cutoff14dDate && impressions < 100) return 'new';
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
        status:      toStatus(c.roas, c.spend, c.impressions, c.launch_date),
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 200);

  return {
    stats,
    campaigns: watchlist,
    ppcDataCompleteness: { sbAvailableFrom, isComplete: sbIsComplete },
  };
}

/* -------------------------------------------------------------------------- */
/* Search Intelligence                                                        */
/* -------------------------------------------------------------------------- */

async function loadSearchIntel(period: ResolvedPeriod): Promise<SearchIntelData> {
  type SqpRaw = {
    search_query: string;
    purchases_brand_share: number | null;
    search_query_volume: number | null;
    impressions_total: number | null;
  };

  const toSQPRow = (r: SqpRaw): SQPRow => ({
    query: r.search_query,
    // purchases_brand_share stored as 0–100 percentage; fmtPct expects 0..1 decimal
    purchaseShare: (Number(r.purchases_brand_share) || 0) / 100,
    searchVolume: Number(r.search_query_volume ?? r.impressions_total) || 0,
  });

  // 3A: top brand queries — each section isolated so one failure doesn't block others
  let brandQueries: SQPRow[] = [];
  try {
    const res = await supabaseAdmin
      .from('search_query_performance')
      .select('search_query, purchases_brand_share, search_query_volume, impressions_total, purchases_brand')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', period.start)
      .lte('report_date', period.end)
      .or('search_query.ilike.%dirty labs%,search_query.ilike.%dirtylabs%')
      .order('purchases_brand', { ascending: false, nullsFirst: false })
      .limit(5);
    if (res.error) throw res.error;
    brandQueries = ((res.data ?? []) as unknown as SqpRaw[]).map(toSQPRow);
  } catch (err) {
    console.error('loadSearchIntel: brand queries failed:', err);
  }

  // 3B: share gaps — high-volume queries where Dirty Labs has low purchase share
  let shareGaps: SQPRow[] = [];
  try {
    const res = await supabaseAdmin
      .from('search_query_performance')
      .select('search_query, purchases_brand_share, search_query_volume, impressions_total, purchases_total, purchases_brand')
      .eq('brand_id', BRAND_ID)
      .gte('report_date', period.start)
      .lte('report_date', period.end)
      .gt('purchases_total', 100)
      .gte('purchases_brand', 10)
      .lt('purchases_brand_share', 10)
      .not('search_query', 'ilike', '%dirty%')
      .order('purchases_total', { ascending: false, nullsFirst: false })
      .limit(5);
    if (res.error) throw res.error;
    shareGaps = ((res.data ?? []) as unknown as SqpRaw[]).map(toSQPRow);
  } catch (err) {
    console.error('loadSearchIntel: share gaps failed:', err);
  }

  // 3C: keyword rank movers (|delta| >= 5)
  // rank_value_delta = start − end (positive = improved); component uses delta < 0 = improved — negate.
  let rankMovers: RankMover[] = [];
  try {
    const rawMovers = await getRankMovers(BRAND_ID, period.start, period.end, 5);
    rankMovers = rawMovers
      .map(r => {
        if (!(r.asin in ASIN_NAMES)) return null;
        const rank  = r.rank_value_end ?? 0;
        const delta = -(r.rank_value_delta ?? 0);
        return { rank, keyword: r.keyword, asinShortName: shortName(r.asin), asin: r.asin, delta };
      })
      .filter((r): r is RankMover => r !== null)
      .slice(0, 5);
  } catch (err) {
    console.error('loadSearchIntel: rank movers failed:', err);
  }

  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt  = (d: string) => { const [,m,day] = d.split('-').map(Number); return `${MONS[m-1]} ${day}`; };

  return {
    brandQueries,
    shareGaps,
    sqpReportPeriod: period.label,
    rankMovers,
    rankWindowLabel: `${fmt(period.start)} → ${fmt(period.end)}`,
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
