// INB-147 — Report Command Center data load (DB core, no next/cache — see data.ts for the
// unstable_cache wrapper). Reads ONLY report_registry + report_coverage + report_ingestion_log
// (never source tables). Kept free of next/cache so the core is unit-testable in node:test.
//
// Every read goes through fetchAll (lib/queries/fetch-all.ts): PostgREST silently caps responses
// at its max-rows default (1,000), and these tables grow without bound (coverage ~40 rows/week;
// the ingestion log one row per upload). A single un-paginated read is a truncation with a date
// on it — the 320-day coverage window crossed 1,000 rows and dropped ~21 rows/render, producing
// phantom strip gaps + false OVERDUE. Each factory applies a STABLE total order (a unique
// tiebreaker) so pages never overlap or skip a row.

import { supabaseAdmin } from '@/lib/supabase-admin'
import { addDays } from '@/lib/upload-tracker/gaps'
import { fetchAll } from '@/lib/queries/fetch-all'
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

export async function loadCommandCenterUncached(brandId: string, today: string): Promise<CommandCenterVM> {
  const cutoff = addDays(today, -COVERAGE_WINDOW_DAYS)

  const [registry, coverage, logRows] = await Promise.all([
    // report_key is the PK → a unique tiebreaker under the (non-unique) display order.
    fetchAll<RegistryRowDb>(() => supabaseAdmin
      .from('report_registry')
      .select('report_key,display_name,source_group,cadence,pull_period,target_table,is_active,sort_order,notes')
      .order('source_group').order('sort_order').order('report_key')),
    // (report_key, period_start) is the table's UNIQUE key → a stable total order.
    fetchAll<CoverageRowDb>(() => supabaseAdmin
      .from('report_coverage')
      .select('report_key,period_end,period_label,period_type,data_through')
      .gte('period_end', cutoff)
      .order('report_key').order('period_start')),
    // latest-first (for the per-key reduce below), id PK tiebreaker for stable paging.
    fetchAll<{ report_key: string; ingested_at: string }>(() => supabaseAdmin
      .from('report_ingestion_log')
      .select('report_key,ingested_at')
      .eq('brand_id', brandId)
      .not('report_key', 'is', null)
      .order('ingested_at', { ascending: false }).order('id')),
  ])

  // coverage rows grouped by report_key
  const coverageByKey = new Map<string, CoverageRowDb[]>()
  for (const c of coverage) {
    const list = coverageByKey.get(c.report_key)
    if (list) list.push(c)
    else coverageByKey.set(c.report_key, [c])
  }
  // latest tagged upload timestamp per report_key (log is ordered ingested_at desc)
  const lastUploadByKey = new Map<string, string>()
  for (const row of logRows) {
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

    const weekAnchoredAtStart = cfg?.weekAnchoredAtStart ?? false

    const status = deriveStatus({
      mode, cadence: r.cadence, isActive: r.is_active, eventDriven, coverageEnds, lastUploadAt, today, weekAnchoredAtStart,
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
        cadence: r.cadence,
        coveringWindowDays: cfg?.coveringWindowDays ?? null,
        weekAnchoredAtStart,
        latestPeriodEnd: latest?.period_end ?? null,
        latestPeriodLabel: latest?.period_label ?? null,
        latestDataThrough: latest?.data_through ?? null,
      }),
      lastUploadAt,
      // ad_hoc reports (COGS) aren't a periodic series — a strip of one effective date reads as a
      // broken empty grey bar, so suppress it (INB-162 addendum 2).
      strip: r.is_active && mode && r.cadence !== 'ad_hoc'
        ? buildStrip({ mode, eventDriven, coverageEnds, today, coveringWindowDays: cfg?.coveringWindowDays ?? null })
        : [],
    }
  })

  return assembleCommandCenter(tiles, today)
}

// Lazy per-report detail: full coverage history + recent tagged upload events. Bounded to one
// report_key, but its coverage grows weekly for years — page it too (period_start unique per key).
// The events list is intentionally capped at the 10 most recent uploads.
export async function loadReportDetail(brandId: string, reportKey: string): Promise<ReportDetail> {
  const [coverage, eventsRes] = await Promise.all([
    fetchAll<{ period_start: string; period_end: string; period_label: string; period_type: string; data_through: string | null }>(
      () => supabaseAdmin
        .from('report_coverage')
        .select('period_start,period_end,period_label,period_type,data_through')
        .eq('report_key', reportKey)
        .order('period_end', { ascending: false }).order('period_start', { ascending: false })),
    supabaseAdmin
      .from('report_ingestion_log')
      .select('ingested_at,status,rows_stored,date_range_start,date_range_end')
      .eq('brand_id', brandId)
      .eq('report_key', reportKey)
      .order('ingested_at', { ascending: false })
      .limit(10),
  ])
  if (eventsRes.error) throw new Error(`event detail read failed: ${eventsRes.error.message}`)

  return {
    coverage: coverage.map(c => ({
      periodStart: c.period_start, periodEnd: c.period_end, periodLabel: c.period_label, periodType: c.period_type, dataThrough: c.data_through,
    })),
    events: (eventsRes.data ?? []).map(e => ({
      ingestedAt: e.ingested_at, status: e.status, rowsStored: e.rows_stored,
      dateRangeStart: e.date_range_start, dateRangeEnd: e.date_range_end,
    })),
  }
}
