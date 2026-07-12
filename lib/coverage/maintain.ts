// Post-upload report_coverage maintenance (INB-146).
//
// After a successful ingest, upsert coverage rows for the periods THIS upload touched.
// The upload is already homogeneous (deriveReportKey resolved a single report_key), so
// no discriminator is needed — just bucket the uploaded rows' period column and upsert.
// No source rescan. Called non-fatally by /api/ingest: a coverage failure must NEVER
// fail an ingest (coverage is derived metadata), so this throws and the route logs it.

import { supabaseAdmin } from '@/lib/supabase-admin'
import { COVERAGE_CONFIG } from './config'
import { datesToPeriods } from './buckets'

export async function upsertCoverageForUpload(args: {
  reportKey: string | null
  tableName: string
  rows: Record<string, unknown>[]
}): Promise<void> {
  const { reportKey, tableName, rows } = args

  // Ambiguous upload (report_key logged NULL) — no coverage row to attribute.
  if (!reportKey) return

  const cfg = COVERAGE_CONFIG[tableName]
  if (!cfg) return // table carries no coverage config (non-covered target)

  const dates = rows
    .map(r => r[cfg.periodColumn])
    .filter((d): d is string => typeof d === 'string')
    .map(d => d.slice(0, 10)) // timestamps (bid log change_timestamp) → date

  const periods = datesToPeriods(dates, cfg.mode)
  if (periods.length === 0) return

  const now = new Date().toISOString()
  const coverageRows = periods.map(p => ({
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

  const { error } = await supabaseAdmin
    .from('report_coverage')
    .upsert(coverageRows, { onConflict: 'report_key,period_start' })
  if (error) {
    throw new Error(`report_coverage upsert failed for ${reportKey}: ${error.message}`)
  }
}
