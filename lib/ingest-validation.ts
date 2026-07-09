// Pre-insert row validation for the ingest path (INB-117),
// plus the upload-time period-date gate (INB-109).
//
// Some report rows are unusable because a database NOT NULL column maps to null
// (e.g. Amazon's Brand Analytics SQP export legitimately emits the occasional row
// with an empty Search Query). If such a row reaches a multi-row upsert it raises a
// NOT NULL violation and Postgres fails the ENTIRE statement — so one bad row
// discards every other (~500) good row in its batch. Dropping these rows up front,
// and counting each as exactly one reject, keeps the rest of the batch intact.
//
// This module has no Supabase/Next dependencies (REPORT_REGISTRY is pure data),
// so everything here can be unit-tested in isolation.

import { typeRequiresPeriodDates, gateLabelFor } from './report-registry'

// Columns that must be non-null/non-empty, keyed by destination table name.
// (For search_query_performance the table name and report type are identical.)
export const REQUIRED_NOT_NULL: Record<string, string[]> = {
  search_query_performance: ['search_query'],
  // INB-148: log_type null = unknown Action (e.g. a bidding-rule log mis-fed
  // here) — reject rather than violate the CHECK. created_date null = malformed
  // Created. campaign/rule_name are '' -normalized in the mapper, so an empty
  // value here means a genuinely blank audit row worth rejecting.
  scale_insights_rule_change_log: ['created_date', 'log_type', 'campaign', 'rule_name'],
  scale_insights_rule_assignments: ['snapshot_date', 'sponsored_type', 'campaign'],
}

export interface RejectedRow {
  row: Record<string, unknown>
  reason: string
}

export interface PartitionResult {
  kept: Record<string, unknown>[]
  rejected: RejectedRow[]
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

// Splits rows into those safe to insert (`kept`) and those dropped because a
// required field is empty (`rejected`). Each rejected row carries a human-readable
// reason and counts as exactly one reject. Tables with no REQUIRED_NOT_NULL entry
// pass through untouched.
export function partitionRequiredNotNull(
  rows: Record<string, unknown>[],
  tableName: string,
): PartitionResult {
  const required = REQUIRED_NOT_NULL[tableName]
  if (!required || required.length === 0) {
    return { kept: rows, rejected: [] }
  }

  const kept: Record<string, unknown>[] = []
  const rejected: RejectedRow[] = []

  for (const row of rows) {
    const missing = required.find(field => isEmpty(row[field]))
    if (missing !== undefined) {
      rejected.push({ row, reason: `empty required field: ${missing}` })
    } else {
      kept.push(row)
    }
  }

  return { kept, rejected }
}

// ---------------------------------------------------------------------------
// Upload-wide dedup (INB-68)
//
// Collapses rows sharing the same upsert natural key across the ENTIRE upload,
// last occurrence wins — identical to what the DB's upsert overwrite would
// produce, but counted honestly. (The predecessor, the route's per-500-row-batch
// deduplicateBatch from INB-108, missed duplicates straddling batch boundaries:
// both copies upserted, the later overwrote the earlier, and rows_stored
// double-counted the key.) No conflict key → passthrough with zero collapsed.
// ---------------------------------------------------------------------------

export interface DedupResult {
  rows: Record<string, unknown>[]
  collapsed: number
}

export function dedupeByConflictKey(
  rows: Record<string, unknown>[],
  conflictKey: string | undefined,
): DedupResult {
  if (!conflictKey) return { rows, collapsed: 0 }
  const cols = conflictKey.split(',').map(c => c.trim())
  const seen = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = cols.map(c => String(row[c] ?? '')).join('::')
    seen.set(key, row)
  }
  const deduped = Array.from(seen.values())
  return { rows: deduped, collapsed: rows.length - deduped.length }
}

// ---------------------------------------------------------------------------
// Period-date gate (INB-109)
//
// Period-aggregate report types carry no usable per-row date in their CSV — the
// mapper stamps every row from the upload form's date_range_start. With the form
// fields blank, business_report maps report_date = null (the NOT NULL constraint
// then kills the entire upload) and the SmartScout snapshot types silently stamp
// a wrong date. Which types this applies to is declared on the report registry
// via requires_period_dates (INB-145) — register the flag there, never in a
// hardcoded list. The detector key equals the gated rows' target_table.
// ---------------------------------------------------------------------------

// True when reportType's row dates come from the upload form. reportType is the
// detector key (pre __sp/__sb split), which equals target_table for gated types.
export function requiresPeriodDates(reportType: string): boolean {
  return typeRequiresPeriodDates(reportType)
}

// Returns an actionable error string when reportType needs the form's date range
// and either field is blank; null otherwise. Pure — used by both the /api/ingest
// gate and the /upload client for the required-field UX.
export function periodDatesError(
  reportType: string,
  dateRangeStart: string,
  dateRangeEnd: string,
): string | null {
  if (!typeRequiresPeriodDates(reportType)) return null
  if (dateRangeStart.trim() && dateRangeEnd.trim()) return null
  const label = gateLabelFor(reportType) ?? reportType
  return (
    `This report type (${label}) is period-aggregate — its rows carry no date, ` +
    `so the row date comes from the upload form. Enter the Date Range Start and End matching ` +
    `the period you selected in the source UI, then re-upload.`
  )
}
