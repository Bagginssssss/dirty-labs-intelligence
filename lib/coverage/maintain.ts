// Post-upload report_coverage maintenance (INB-146).
//
// After a successful ingest, upsert coverage rows for the periods THIS upload touched.
// The upload is already homogeneous (deriveReportKey resolved a single report_key), so
// no discriminator is needed — just bucket the uploaded rows' period column and upsert.
// No source rescan. Called non-fatally by /api/ingest: a coverage failure must NEVER
// fail an ingest (coverage is derived metadata), so this throws and the route logs it.
//
// INB-166 — window-per-pull reports (business_report_child_asin, subscribe_and_save): a pull is one
// ~30-day period-aggregate labeled at its START, so coverage is ONE row per pull spanning
// [window_start, window_end] with data_through = window_end (the covered-window END, not the start).
// The end comes from the row's windowEndColumn (S&S: Reporting Period End) or, when the fact table
// has no end column (business_report), from the ingest's date_range_end. period_type stays 'snapshot'
// but is a multi-day span (period_start ≠ period_end).

import { supabaseAdmin } from '@/lib/supabase-admin'
import { COVERAGE_CONFIG, type CoverageTableConfig } from './config'
import { datesToPeriods } from './buckets'

type CoverageRow = {
  report_key: string
  period_start: string
  period_end: string
  period_label: string
  period_type: 'weekly' | 'monthly' | 'snapshot'
  data_through: string
  event_driven: boolean
  source: string
  updated_at: string
}

const d10 = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null)

// One coverage row per distinct pull window. The end is on the row (windowEndColumn) or, absent a
// column, from the ingest's date_range_start/end payload.
function windowPeriods(
  cfg: CoverageTableConfig,
  reportKey: string,
  rows: Record<string, unknown>[],
  dateRangeStart: string | undefined,
  dateRangeEnd: string | undefined,
  now: string,
): CoverageRow[] {
  const windows = new Map<string, { start: string; end: string }>()
  if (cfg.windowEndColumn) {
    // The window end is a column on each row (e.g. S&S Reporting Period End).
    for (const r of rows) {
      const start = d10(r[cfg.periodColumn])
      const end = d10(r[cfg.windowEndColumn])
      if (start && end) windows.set(`${start}::${end}`, { start, end })
    }
  } else {
    // No end column (business_report): the pull window is the ingest's date range.
    const start = d10(dateRangeStart)
    const end = d10(dateRangeEnd)
    if (start && end) windows.set(`${start}::${end}`, { start, end })
  }
  return [...windows.values()].map(({ start, end }) => ({
    report_key: reportKey,
    period_start: start,
    period_end: end,
    period_label: `Window ${start} → ${end}`,
    period_type: 'snapshot',
    data_through: end,
    event_driven: cfg.eventDriven,
    source: 'upload',
    updated_at: now,
  }))
}

export async function upsertCoverageForUpload(args: {
  reportKey: string | null
  tableName: string
  rows: Record<string, unknown>[]
  // INB-166: the ingest's date range — the window end for window-per-pull reports whose fact table
  // has no end column (business_report). Ignored by every other report type.
  dateRangeStart?: string
  dateRangeEnd?: string
}): Promise<void> {
  const { reportKey, tableName, rows, dateRangeStart, dateRangeEnd } = args

  // Ambiguous upload (report_key logged NULL) — no coverage row to attribute.
  if (!reportKey) return

  const cfg = COVERAGE_CONFIG[tableName]
  if (!cfg) return // table carries no coverage config (non-covered target)

  const now = new Date().toISOString()

  let coverageRows: CoverageRow[]
  if (cfg.windowPerPull) {
    coverageRows = windowPeriods(cfg, reportKey, rows, dateRangeStart, dateRangeEnd, now)
  } else {
    const dates = rows
      .map(r => r[cfg.periodColumn])
      .filter((d): d is string => typeof d === 'string')
      .map(d => d.slice(0, 10)) // timestamps (bid log change_timestamp) → date
    const periods = datesToPeriods(dates, cfg.mode)
    coverageRows = periods.map(p => ({
      report_key: reportKey,
      period_start: p.period_start,
      period_end: p.period_end,
      period_label: p.period_label,
      period_type: p.period_type,
      data_through: p.data_through,
      event_driven: cfg.eventDriven,
      source: 'upload',
      updated_at: now,
    }))
  }

  if (coverageRows.length === 0) return

  const { error } = await supabaseAdmin
    .from('report_coverage')
    .upsert(coverageRows, { onConflict: 'report_key,period_start' })
  if (error) {
    throw new Error(`report_coverage upsert failed for ${reportKey}: ${error.message}`)
  }
}
