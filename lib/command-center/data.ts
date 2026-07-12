// INB-147 — Report Command Center data load.
//
// Reads ONLY report_registry + report_coverage + report_ingestion_log (never source
// tables — that is what INB-146 built the coverage layer for). One bounded server load
// assembles every tile; the detail panel lazy-loads per-report history (loadReportDetail).
// Cached under the existing 'tracker-data' tag so UploadArea's refreshTrackerCache()
// invalidates it after an upload.

import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { addDays } from '@/lib/upload-tracker/gaps'
import { COVERAGE_CONFIG } from '@/lib/coverage/config'
import { COVERAGE_WINDOW_DAYS, assembleCommandCenter, buildStrip, deriveStatus, freshnessLine } from './status'
import type { CommandCenterVM, CoverageEnd, ReportDetail, TileVM } from './types'

type RegistryRowDb = {
  report_key: string
  display_name: string
  source_group: string
  cadence: string
  pull_period: string | null
  target_table: string
  is_active: boolean
  sort_order: number | null
  notes: string | null
}
type CoverageRowDb = { report_key: string; period_end: string; period_label: string; period_type: 'weekly' | 'monthly' | 'snapshot'; data_through: string | null }

async function _load(brandId: string, today: string): Promise<CommandCenterVM> {
  const cutoff = addDays(today, -COVERAGE_WINDOW_DAYS)

  const [registryRes, coverageRes, logRes] = await Promise.all([
    supabaseAdmin
      .from('report_registry')
      .select('report_key,display_name,source_group,cadence,pull_period,target_table,is_active,sort_order,notes')
      .order('source_group')
      .order('sort_order'),
    supabaseAdmin
      .from('report_coverage')
      .select('report_key,period_end,period_label,period_type,data_through')
      .gte('period_end', cutoff),
    supabaseAdmin
      .from('report_ingestion_log')
      .select('report_key,ingested_at')
      .eq('brand_id', brandId)
      .not('report_key', 'is', null)
      .order('ingested_at', { ascending: false }),
  ])
  if (registryRes.error) throw new Error(`report_registry read failed: ${registryRes.error.message}`)
  if (coverageRes.error) throw new Error(`report_coverage read failed: ${coverageRes.error.message}`)
  if (logRes.error) throw new Error(`report_ingestion_log read failed: ${logRes.error.message}`)

  const registry = (registryRes.data ?? []) as RegistryRowDb[]
  const coverage = (coverageRes.data ?? []) as CoverageRowDb[]

  // coverage rows grouped by report_key
  const coverageByKey = new Map<string, CoverageRowDb[]>()
  for (const c of coverage) {
    const list = coverageByKey.get(c.report_key)
    if (list) list.push(c)
    else coverageByKey.set(c.report_key, [c])
  }
  // latest tagged upload timestamp per report_key (log is pre-ordered desc)
  const lastUploadByKey = new Map<string, string>()
  for (const row of (logRes.data ?? []) as { report_key: string; ingested_at: string }[]) {
    if (!lastUploadByKey.has(row.report_key)) lastUploadByKey.set(row.report_key, row.ingested_at)
  }

  const tiles: TileVM[] = registry.map(r => {
    const cfg = COVERAGE_CONFIG[r.target_table]
    const eventDriven = cfg?.eventDriven ?? false
    const mode = cfg?.mode
    const rows = coverageByKey.get(r.report_key) ?? []
    const coverageEnds: CoverageEnd[] = rows.map(c => ({ periodEnd: c.period_end, periodType: c.period_type, dataThrough: c.data_through }))
    const lastUploadAt = lastUploadByKey.get(r.report_key) ?? null

    const latest = rows.reduce<CoverageRowDb | null>((m, c) => (m === null || c.period_end > m.period_end ? c : m), null)

    const status = deriveStatus({
      mode, cadence: r.cadence, isActive: r.is_active, eventDriven, coverageEnds, lastUploadAt, today,
    })

    return {
      reportKey: r.report_key,
      displayName: r.display_name,
      sourceGroup: r.source_group,
      cadence: r.cadence,
      pullPeriod: r.pull_period,
      targetTable: r.target_table,
      sortOrder: r.sort_order ?? 0,
      isActive: r.is_active,
      eventDriven,
      notes: r.notes,
      status,
      latestPeriodLabel: latest?.period_label ?? null,
      latestPeriodEnd: latest?.period_end ?? null,
      latestDataThrough: latest?.data_through ?? null,
      periodLine: freshnessLine({
        mode,
        coveringWindowDays: cfg?.coveringWindowDays ?? null,
        latestPeriodEnd: latest?.period_end ?? null,
        latestPeriodLabel: latest?.period_label ?? null,
        latestDataThrough: latest?.data_through ?? null,
      }),
      lastUploadAt,
      strip: r.is_active && mode ? buildStrip({ mode, eventDriven, coverageEnds, today }) : [],
    }
  })

  return assembleCommandCenter(tiles, today)
}

export async function loadCommandCenter(brandId: string, today: string): Promise<CommandCenterVM> {
  return unstable_cache(() => _load(brandId, today), ['command-center', brandId, today], {
    revalidate: 60,
    tags: ['tracker-data'],
  })()
}

// Lazy per-report detail: full coverage history + recent tagged upload events. Bounded
// to one report_key — cheap even for the full si_bid_log timeline (back to Jan 2025).
export async function loadReportDetail(brandId: string, reportKey: string): Promise<ReportDetail> {
  const [coverageRes, eventsRes] = await Promise.all([
    supabaseAdmin
      .from('report_coverage')
      .select('period_start,period_end,period_label,period_type,data_through')
      .eq('report_key', reportKey)
      .order('period_end', { ascending: false }),
    supabaseAdmin
      .from('report_ingestion_log')
      .select('ingested_at,status,rows_stored,date_range_start,date_range_end')
      .eq('brand_id', brandId)
      .eq('report_key', reportKey)
      .order('ingested_at', { ascending: false })
      .limit(10),
  ])
  if (coverageRes.error) throw new Error(`coverage detail read failed: ${coverageRes.error.message}`)
  if (eventsRes.error) throw new Error(`event detail read failed: ${eventsRes.error.message}`)

  return {
    coverage: (coverageRes.data ?? []).map(c => ({
      periodStart: c.period_start, periodEnd: c.period_end, periodLabel: c.period_label, periodType: c.period_type, dataThrough: c.data_through,
    })),
    events: (eventsRes.data ?? []).map(e => ({
      ingestedAt: e.ingested_at, status: e.status, rowsStored: e.rows_stored,
      dateRangeStart: e.date_range_start, dateRangeEnd: e.date_range_end,
    })),
  }
}
