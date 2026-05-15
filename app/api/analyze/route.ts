import { NextResponse } from 'next/server'
import { DIRTY_LABS_SYSTEM_PROMPT, DATA_COMPLETENESS_NOTE, VIRTUAL_BUNDLE_NOTE, type VBContextInput } from '@/lib/analysis-context'
import { shortName } from '@/lib/dashboard/asin-names'
import { buildMemoryContext, saveInsight, seedInitialKnowledge, seedDefaultWatches } from '@/lib/memory/index'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getAccountSummary,
  getMonthlyAccountMetrics,
  getCampaignsByAdType,
  getWasteCampaigns,
  getTopPerformingCampaigns,
  getASINPerformance,
  getASINPerformanceByMonth,
  getSSPerformance,
  getGoalProgress,
  getHarvestCandidates,
  getTopSearchTerms,
  getWasteSearchTerms,
  getSearchQueryGaps,
  getCompetitiveLandscape,
  getMarketShareByBrand,
  getAnomalies,
  getRankMovers,
} from '@/lib/queries/index'
import type { AnomalyItem } from '@/lib/queries/types'

type AnalysisType = 'weekly_briefing' | 'anomaly_detection' | 'opportunity_analysis' | 'campaign_audit' | 'chat'

/** Adds a `name` field (short name) to any array of objects that have an `asin` string field. */
function withShortNames(data: unknown): unknown {
  if (!Array.isArray(data)) return data
  return data.map((item: unknown) => {
    if (typeof item === 'object' && item !== null && 'asin' in item) {
      const row = item as { asin: string }
      return { ...row, name: shortName(row.asin) }
    }
    return item
  })
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

async function ensureSeeded(brandId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('platform_knowledge')
    .select('id')
    .eq('brand_id', brandId)
    .limit(1)

  if (!data || data.length === 0) {
    await Promise.all([
      seedInitialKnowledge(brandId),
      seedDefaultWatches(brandId),
    ])
  }
}

function buildWeeklyBriefingPrompt(data: {
  accountSummary: unknown
  campaignsByAdType: unknown
  topCampaigns: unknown
  wasteCampaigns: unknown
  asinPerformance: unknown
  goalProgress: unknown
  harvestCandidates: unknown
  memoryContext: string
  startDate: string
  endDate: string
  sbAvailableFrom?: string | null
}): string {
  return `You are generating the weekly PPC briefing for Dirty Labs.

${DATA_COMPLETENESS_NOTE(1, 14, data.sbAvailableFrom)}

PERIOD: ${data.startDate} to ${data.endDate}

ACCOUNT SUMMARY:
${JSON.stringify(data.accountSummary, null, 2)}

CAMPAIGN PERFORMANCE BY AD TYPE:
${JSON.stringify(data.campaignsByAdType, null, 2)}

TOP PERFORMING CAMPAIGNS (ROAS > 5x):
${JSON.stringify(data.topCampaigns, null, 2)}

WASTE CAMPAIGNS (ROAS < 2.0, Spend > $10):
${JSON.stringify(data.wasteCampaigns, null, 2)}

ASIN PERFORMANCE:
${JSON.stringify(withShortNames(data.asinPerformance), null, 2)}

GOAL PROGRESS:
${JSON.stringify(data.goalProgress, null, 2)}

HARVEST CANDIDATES (auto campaign search terms ready for exact-match harvesting — ROAS ≥ 2.5, ≥ 2 orders, ≥ 10 clicks; Tier 1 ready-to-harvest is ROAS ≥ 3.33, Tier 2 investigation is ROAS 2.5–3.33):
${JSON.stringify(data.harvestCandidates, null, 2)}

${data.memoryContext}

Generate the weekly briefing following the output format defined in your system prompt. Be specific with numbers. Ground every finding in the data above.`
}

function buildAnomalyPrompt(data: {
  anomalies: unknown
  asinPerformance: unknown
  ssPerformance: unknown
  goalProgress: unknown
  memoryContext: string
  startDate: string
  endDate: string
  sbAvailableFrom?: string | null
}): string {
  return `You are running an anomaly detection scan for Dirty Labs.

${DATA_COMPLETENESS_NOTE(1, 14, data.sbAvailableFrom)}

PERIOD: ${data.startDate} to ${data.endDate}

DETECTED ANOMALIES:
${JSON.stringify(data.anomalies, null, 2)}

ASIN PERFORMANCE:
${JSON.stringify(withShortNames(data.asinPerformance), null, 2)}

SUBSCRIBE & SAVE PERFORMANCE:
${JSON.stringify(withShortNames(data.ssPerformance), null, 2)}

GOAL PROGRESS:
${JSON.stringify(data.goalProgress, null, 2)}

${data.memoryContext}

Analyse all detected anomalies. For each one explain why it matters, what likely caused it, and what specific action to take. Flag the highest-severity issues at the top. Be specific with numbers. Ground every finding in the data above.`
}

function buildOpportunityPrompt(data: {
  harvestCandidates: unknown
  searchQueryGaps: unknown
  competitiveLandscape: unknown
  marketShare: unknown
  topSearchTerms: unknown
  memoryContext: string
  startDate: string
  endDate: string
  sbAvailableFrom?: string | null
}): string {
  return `You are running an opportunity analysis for Dirty Labs.

${DATA_COMPLETENESS_NOTE(1, 14, data.sbAvailableFrom)}

PERIOD: ${data.startDate} to ${data.endDate}

HARVEST CANDIDATES (auto campaigns converting search terms not yet in exact match — Tier 1 ready: ROAS ≥ 3.33; Tier 2 investigation: ROAS 2.5–3.33; both require ≥ 2 orders and ≥ 10 clicks):
${JSON.stringify(data.harvestCandidates, null, 2)}

SEARCH QUERY GAPS (high-volume queries where brand share < 10%):
${JSON.stringify(data.searchQueryGaps, null, 2)}

COMPETITIVE LANDSCAPE (SmartScout brand data):
${JSON.stringify(data.competitiveLandscape, null, 2)}

MARKET SHARE BY BRAND:
${JSON.stringify(data.marketShare, null, 2)}

TOP SEARCH TERMS (by revenue, ROAS > 5x, min 2 orders):
${JSON.stringify(data.topSearchTerms, null, 2)}

${data.memoryContext}

Identify and prioritise the top NTB acquisition opportunities. Focus on: 1) terms to harvest from auto campaigns, 2) high-volume search gaps where competitors win and Dirty Labs should compete, 3) competitive threats needing defensive coverage. Be specific with numbers. Ground every finding in the data above.`
}

function buildChatPrompt(data: {
  accountSummary: unknown
  monthlyAccountMetrics: unknown
  campaignsByAdType: unknown
  topCampaigns: unknown
  wasteCampaigns: unknown
  asinPerformance: unknown
  asinPerformanceByMonth: unknown
  ssPerformance: unknown
  goalProgress: unknown
  harvestCandidates: unknown
  searchQueryGaps: unknown
  competitiveLandscape: unknown
  marketShare: unknown
  topSearchTerms: unknown
  wasteSearchTerms: unknown
  anomalies: unknown
  rankMovers: unknown
  memoryContext: string
  startDate: string
  endDate: string
  query: string
  sbAvailableFrom?: string | null
}): string {
  return `You are answering a specific question about Dirty Labs PPC performance.

${DATA_COMPLETENESS_NOTE(1, 14, data.sbAvailableFrom)}

DATA WINDOW: ${data.startDate} to ${data.endDate} (12-month rolling)
Note: Months absent from MONTHLY ACCOUNT METRICS below lack derived account-level data (calculate-metrics not yet run), but may still have ASIN-level data in ASIN PERFORMANCE BY MONTH.

ACCOUNT SUMMARY (aggregate across full window):
${JSON.stringify(data.accountSummary, null, 2)}

MONTHLY ACCOUNT METRICS (month-by-month from derived_metrics_daily — shows which months have account-level data):
${JSON.stringify(data.monthlyAccountMetrics, null, 2)}

ASIN PERFORMANCE BY MONTH (month-by-month from business_report — use this for month-specific ASIN questions):
${JSON.stringify(withShortNames(data.asinPerformanceByMonth), null, 2)}

CAMPAIGN PERFORMANCE BY AD TYPE:
${JSON.stringify(data.campaignsByAdType, null, 2)}

TOP PERFORMING CAMPAIGNS:
${JSON.stringify(data.topCampaigns, null, 2)}

WASTE CAMPAIGNS:
${JSON.stringify(data.wasteCampaigns, null, 2)}

ASIN PERFORMANCE (aggregated across full window):
${JSON.stringify(withShortNames(data.asinPerformance), null, 2)}

SUBSCRIBE & SAVE PERFORMANCE:
${JSON.stringify(withShortNames(data.ssPerformance), null, 2)}

GOAL PROGRESS:
${JSON.stringify(data.goalProgress, null, 2)}

HARVEST CANDIDATES (Tier 1 ready: ROAS ≥ 3.33 → take action now; Tier 2 investigation: ROAS 2.5–3.33 → human review; all require ≥ 2 orders, ≥ 10 clicks from auto campaigns):
${JSON.stringify(data.harvestCandidates, null, 2)}

SEARCH QUERY GAPS:
${JSON.stringify(data.searchQueryGaps, null, 2)}

COMPETITIVE LANDSCAPE:
${JSON.stringify(data.competitiveLandscape, null, 2)}

MARKET SHARE BY BRAND:
${JSON.stringify(data.marketShare, null, 2)}

TOP SEARCH TERMS:
${JSON.stringify(data.topSearchTerms, null, 2)}

WASTE SEARCH TERMS:
${JSON.stringify(data.wasteSearchTerms, null, 2)}

DETECTED ANOMALIES:
${JSON.stringify(data.anomalies, null, 2)}

KEYWORD RANK MOVERS:
${JSON.stringify(data.rankMovers, null, 2)}

${data.memoryContext}

USER QUESTION: ${data.query}

Answer the user's question directly using the data above. For month-specific questions, use ASIN PERFORMANCE BY MONTH and MONTHLY ACCOUNT METRICS. Be specific with numbers. If the data doesn't contain enough information to fully answer the question, say so clearly.`
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const {
      brand_id,
      analysis_type: rawAnalysisType,
      query,
      start_date,
      end_date,
      year,
      month,
    }: {
      brand_id: string
      analysis_type: string
      query?: string
      start_date?: string
      end_date?: string
      year?: number
      month?: number
    } = body

    // ChatPanel sends short forms ('briefing', 'anomaly', 'opportunity'); normalize to canonical names.
    const analysis_type = (
      rawAnalysisType === 'briefing'    ? 'weekly_briefing' :
      rawAnalysisType === 'anomaly'     ? 'anomaly_detection' :
      rawAnalysisType === 'opportunity' ? 'opportunity_analysis' :
      rawAnalysisType
    ) as AnalysisType

    if (!brand_id) {
      return NextResponse.json({ error: 'brand_id is required' }, { status: 400 })
    }
    if (!analysis_type) {
      return NextResponse.json({ error: 'analysis_type is required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const startDate = start_date ?? firstOfMonthISO()
    const endDate   = end_date   ?? todayISO()

    const now     = new Date()
    const goalYear  = year  ?? now.getFullYear()
    const goalMonth = month ?? (now.getMonth() + 1)
    const goalPeriod = `${goalYear}-${String(goalMonth).padStart(2, '0')}`

    // Seed knowledge and watchlist if first run for this brand
    await ensureSeeded(brand_id)

    // Earliest SB/SBV row — tells Claude which periods have full PPC coverage.
    const sbFromAnalyzeRes = await supabaseAdmin
      .from('sp_campaign_performance')
      .select('report_date')
      .eq('brand_id', brand_id)
      .in('ad_type', ['SB', 'SBV'])
      .order('report_date', { ascending: true })
      .limit(1)
    const sbAvailableFrom = (!sbFromAnalyzeRes.error && (sbFromAnalyzeRes.data?.[0]?.report_date as string | undefined)) || null

    // ── VB context: latest snapshot totals (lightweight — one row per bundle at max date) ──
    const vbLatestRes = await supabaseAdmin
      .from('virtual_bundle_sales_snapshots')
      .select('bundle_asin, bundle_name, snapshot_date, week_number, sales_90d, margin_pct, profit_90d')
      .eq('brand_id', brand_id)
      .order('snapshot_date', { ascending: false })
      .limit(50) // up to ~21 bundles + buffer for the latest snapshot

    let vbNote = ''
    if (!vbLatestRes.error && vbLatestRes.data && vbLatestRes.data.length > 0) {
      // Only keep rows from the single latest snapshot_date
      const latestDate = (vbLatestRes.data[0] as { snapshot_date: string }).snapshot_date
      const latestRows = vbLatestRes.data.filter((r: { snapshot_date: string }) => r.snapshot_date === latestDate)

      // Fetch prior week snapshot (one week before latestDate)
      const priorTarget = new Date(latestDate + 'T00:00:00Z').getTime() - 7 * 86_400_000
      const priorDateISO = new Date(priorTarget).toISOString().slice(0, 10)
      const priorRes = await supabaseAdmin
        .from('virtual_bundle_sales_snapshots')
        .select('snapshot_date, sales_90d')
        .eq('brand_id', brand_id)
        .lte('snapshot_date', priorDateISO)
        .order('snapshot_date', { ascending: false })
        .limit(30)

      const priorSnap = priorRes.data && priorRes.data.length > 0
        ? (priorRes.data[0] as { snapshot_date: string }).snapshot_date
        : null
      const priorRows = priorSnap
        ? (priorRes.data ?? []).filter((r: { snapshot_date: string }) => r.snapshot_date === priorSnap)
        : []
      const priorTotal = priorRows.reduce((s: number, r: { sales_90d: unknown }) => s + (Number(r.sales_90d) || 0), 0)

      // Fetch QoQ snapshot (~91 days back)
      const qoqTarget = new Date(latestDate + 'T00:00:00Z').getTime() - 91 * 86_400_000
      const qoqFromISO = new Date(qoqTarget - 10 * 86_400_000).toISOString().slice(0, 10)
      const qoqToISO   = new Date(qoqTarget + 10 * 86_400_000).toISOString().slice(0, 10)
      const qoqRes = await supabaseAdmin
        .from('virtual_bundle_sales_snapshots')
        .select('snapshot_date, sales_90d')
        .eq('brand_id', brand_id)
        .gte('snapshot_date', qoqFromISO)
        .lte('snapshot_date', qoqToISO)
        .order('snapshot_date', { ascending: false })
        .limit(30)
      const qoqSnap = qoqRes.data && qoqRes.data.length > 0
        ? (qoqRes.data[0] as { snapshot_date: string }).snapshot_date
        : null
      const qoqRows = qoqSnap
        ? (qoqRes.data ?? []).filter((r: { snapshot_date: string }) => r.snapshot_date === qoqSnap)
        : []
      const qoqTotal = qoqRows.reduce((s: number, r: { sales_90d: unknown }) => s + (Number(r.sales_90d) || 0), 0)

      type VBRow = { bundle_asin: string; bundle_name: string | null; sales_90d: unknown }
      const latestTotal = (latestRows as VBRow[]).reduce((s, r) => s + (Number(r.sales_90d) || 0), 0)
      const topBundle = (latestRows as VBRow[]).reduce<VBRow | null>((best, r) => {
        return !best || (Number(r.sales_90d) || 0) > (Number(best.sales_90d) || 0) ? r : best
      }, null)

      const ctx: VBContextInput = {
        latestTotal,
        latestDate,
        wowPct: priorTotal > 0 ? (latestTotal - priorTotal) / priorTotal : null,
        qoqPct: qoqTotal > 0 ? (latestTotal - qoqTotal) / qoqTotal : null,
        qoqPriorDate: qoqSnap,
        snapshotCount: 0, // not fetched here — use note text directly
        bundleCount: latestRows.length,
        topBundle: topBundle ? { name: topBundle.bundle_name, asin: topBundle.bundle_asin, sales: Number(topBundle.sales_90d) || 0 } : null,
      }
      vbNote = VIRTUAL_BUNDLE_NOTE(ctx)
    }

    // ── Step 1: Fetch data context ─────────────────────────────────────────
    let userPrompt: string
    let anomalies: AnomalyItem[] = []
    let accountSummary: unknown  = null
    let goalProgress: unknown    = null
    let memoryContextUsed        = false

    if (analysis_type === 'weekly_briefing' || analysis_type === 'campaign_audit') {
      const [
        accSum, byType, waste, top, asinPerf, goals, harvest, memory,
      ] = await Promise.all([
        getAccountSummary(brand_id, startDate, endDate),
        getCampaignsByAdType(brand_id, startDate, endDate),
        getWasteCampaigns(brand_id, startDate, endDate, 2.0, 10),
        getTopPerformingCampaigns(brand_id, startDate, endDate, 5.0, 15),
        getASINPerformance(brand_id, startDate, endDate),
        getGoalProgress(brand_id, goalPeriod),
        getHarvestCandidates(brand_id, startDate, endDate),
        buildMemoryContext(brand_id),
      ])

      accountSummary   = accSum
      goalProgress     = goals
      memoryContextUsed = memory.recentInsights.length > 0 || memory.accountKnowledge.length > 0

      const wasteLimited   = Array.isArray(waste) ? waste.slice(0, 15) : waste
      const harvestLimited = Array.isArray(harvest) ? harvest.slice(0, 10) : harvest

      userPrompt = buildWeeklyBriefingPrompt({
        accountSummary: accSum,
        campaignsByAdType: byType,
        topCampaigns: top,
        wasteCampaigns: wasteLimited,
        asinPerformance: asinPerf,
        goalProgress: goals,
        harvestCandidates: harvestLimited,
        memoryContext: memory.promptContext,
        startDate,
        endDate,
        sbAvailableFrom,
      })

    } else if (analysis_type === 'anomaly_detection') {
      const [detected, asinPerf, ssPerf, goals, memory] = await Promise.all([
        getAnomalies(brand_id, endDate),
        getASINPerformance(brand_id, startDate, endDate),
        getSSPerformance(brand_id, startDate, endDate),
        getGoalProgress(brand_id, goalPeriod),
        buildMemoryContext(brand_id),
      ])

      anomalies         = detected
      goalProgress      = goals
      memoryContextUsed = memory.recentInsights.length > 0 || memory.accountKnowledge.length > 0

      userPrompt = buildAnomalyPrompt({
        anomalies: detected,
        asinPerformance: asinPerf,
        ssPerformance: ssPerf,
        goalProgress: goals,
        memoryContext: memory.promptContext,
        startDate,
        endDate,
        sbAvailableFrom,
      })

    } else if (analysis_type === 'opportunity_analysis') {
      const [harvest, sqGaps, landscape, mShare, topTerms, memory] = await Promise.all([
        getHarvestCandidates(brand_id, startDate, endDate),
        getSearchQueryGaps(brand_id, startDate, endDate),
        getCompetitiveLandscape(brand_id),
        getMarketShareByBrand(brand_id),
        getTopSearchTerms(brand_id, startDate, endDate, 20),
        buildMemoryContext(brand_id),
      ])

      memoryContextUsed = memory.recentInsights.length > 0 || memory.accountKnowledge.length > 0

      userPrompt = buildOpportunityPrompt({
        harvestCandidates: harvest,
        searchQueryGaps: sqGaps,
        competitiveLandscape: landscape,
        marketShare: mShare,
        topSearchTerms: topTerms,
        memoryContext: memory.promptContext,
        startDate,
        endDate,
        sbAvailableFrom,
      })

    } else {
      // chat — full context, always 12-month rolling window regardless of period selector
      if (!query) {
        return NextResponse.json({ error: 'query is required for chat analysis_type' }, { status: 400 })
      }

      const chatEndDate   = todayISO()
      const chatStartDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const [
        accSum, monthlyMetrics, byType, waste, top,
        asinPerf, asinPerfByMonth, ssPerf, goals,
        harvest, sqGaps, landscape, mShare, topTerms, wasteTerms, detected, movers, memory,
      ] = await Promise.all([
        getAccountSummary(brand_id, chatStartDate, chatEndDate),
        getMonthlyAccountMetrics(brand_id, chatStartDate, chatEndDate),
        getCampaignsByAdType(brand_id, chatStartDate, chatEndDate),
        getWasteCampaigns(brand_id, chatStartDate, chatEndDate, 2.0, 10),
        getTopPerformingCampaigns(brand_id, chatStartDate, chatEndDate, 5.0, 15),
        getASINPerformance(brand_id, chatStartDate, chatEndDate),
        getASINPerformanceByMonth(brand_id, chatStartDate, chatEndDate),
        getSSPerformance(brand_id, chatStartDate, chatEndDate),
        getGoalProgress(brand_id, goalPeriod),
        getHarvestCandidates(brand_id, chatStartDate, chatEndDate),
        getSearchQueryGaps(brand_id, chatStartDate, chatEndDate),
        getCompetitiveLandscape(brand_id),
        getMarketShareByBrand(brand_id),
        getTopSearchTerms(brand_id, chatStartDate, chatEndDate, 20),
        getWasteSearchTerms(brand_id, chatStartDate, chatEndDate, 10, 0.5),
        getAnomalies(brand_id, chatEndDate),
        getRankMovers(brand_id, chatStartDate, chatEndDate, 5),
        buildMemoryContext(brand_id),
      ])

      accountSummary    = accSum
      anomalies         = detected
      goalProgress      = goals
      memoryContextUsed = memory.recentInsights.length > 0 || memory.accountKnowledge.length > 0

      userPrompt = buildChatPrompt({
        accountSummary: accSum,
        monthlyAccountMetrics: monthlyMetrics,
        campaignsByAdType: byType,
        topCampaigns: top,
        wasteCampaigns: waste,
        asinPerformance: asinPerf,
        asinPerformanceByMonth: asinPerfByMonth,
        ssPerformance: ssPerf,
        goalProgress: goals,
        harvestCandidates: harvest,
        searchQueryGaps: sqGaps,
        competitiveLandscape: landscape,
        marketShare: mShare,
        topSearchTerms: topTerms,
        wasteSearchTerms: wasteTerms,
        anomalies: detected,
        rankMovers: movers,
        memoryContext: memory.promptContext,
        startDate: chatStartDate,
        endDate: chatEndDate,
        query,
        sbAvailableFrom,
      })
    }

    // Append VB context if available (non-empty means data exists)
    if (vbNote) userPrompt += vbNote

    // ── Step 4: Call Anthropic API ─────────────────────────────────────────
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 16000,
        system:     DIRTY_LABS_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    })

    if (anthropicRes.status === 429) {
      const retryAfter = anthropicRes.headers.get('retry-after')
      const resetAt = retryAfter
        ? new Date(Date.now() + parseInt(retryAfter, 10) * 1000).toISOString()
        : null
      return NextResponse.json(
        { error: 'rate_limited', reset_at: resetAt },
        { status: 429 }
      )
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      return NextResponse.json(
        { error: `Anthropic API error ${anthropicRes.status}`, detail: errText },
        { status: 502 }
      )
    }

    const rlLimit     = anthropicRes.headers.get('anthropic-ratelimit-input-tokens-limit')
    const rlRemaining = anthropicRes.headers.get('anthropic-ratelimit-input-tokens-remaining')
    const rlReset     = anthropicRes.headers.get('anthropic-ratelimit-input-tokens-reset')

    const anthropicData = await anthropicRes.json() as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string | null
    }

    const analysisText = anthropicData.content[0]?.text ?? ''
    const usage        = anthropicData.usage
    const stopReason   = anthropicData.stop_reason

    // ── Step 5: Save to episodic memory ───────────────────────────────────
    // Chat responses are intentionally excluded: auto-persisting them creates
    // a feedback loop where any inaccuracy in one response gets reinforced into
    // all subsequent responses via buildMemoryContext. Only operator-intentional
    // analysis runs (briefings, anomaly scans, opportunity analyses) are saved.
    if (analysis_type !== 'chat') {
      const dateLabel = endDate
      const insightTitleMap: Record<Exclude<AnalysisType, 'chat'>, string> = {
        weekly_briefing:     `Weekly Briefing ${dateLabel}`,
        campaign_audit:      `Campaign Audit ${dateLabel}`,
        anomaly_detection:   `Anomaly Scan ${dateLabel}`,
        opportunity_analysis: `Opportunity Analysis ${dateLabel}`,
      }

      const insightSeverity = (() => {
        if (analysis_type === 'anomaly_detection') {
          if (anomalies.some(a => a.severity === 'critical')) return 'critical' as const
          if (anomalies.some(a => a.severity === 'warning'))  return 'warning'  as const
        }
        return 'info' as const
      })()

      await saveInsight(
        brand_id,
        analysis_type === 'weekly_briefing' || analysis_type === 'campaign_audit' ? 'weekly_briefing' :
        analysis_type === 'anomaly_detection' ? 'anomaly' : 'opportunity',
        insightTitleMap[analysis_type],
        analysisText.slice(0, 2000),
        insightSeverity,
        { analysis_type, period: { start: startDate, end: endDate }, token_usage: usage }
      )
    }

    // ── Step 6: Return response ────────────────────────────────────────────
    return NextResponse.json({
      status:         'ok',
      analysis_type,
      generated_at:   new Date().toISOString(),
      period:         { start: startDate, end: endDate },
      data_coverage:  '1 month — March 2026. Historical backfill in progress.',
      content:        analysisText,
      token_usage:    { input: usage.input_tokens, output: usage.output_tokens },
      memory_context_used: memoryContextUsed,
      stop_reason: stopReason,
      rate_limit: rlLimit && rlRemaining && rlReset ? {
        limit:     parseInt(rlLimit, 10),
        remaining: parseInt(rlRemaining, 10),
        reset_at:  rlReset,
      } : null,
      raw_data: {
        account_summary: accountSummary,
        anomalies,
        goal_progress:   goalProgress,
      },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
