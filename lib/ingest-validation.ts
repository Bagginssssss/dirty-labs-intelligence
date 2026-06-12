// Pre-insert row validation for the ingest path (INB-117).
//
// Some report rows are unusable because a database NOT NULL column maps to null
// (e.g. Amazon's Brand Analytics SQP export legitimately emits the occasional row
// with an empty Search Query). If such a row reaches a multi-row upsert it raises a
// NOT NULL violation and Postgres fails the ENTIRE statement — so one bad row
// discards every other (~500) good row in its batch. Dropping these rows up front,
// and counting each as exactly one reject, keeps the rest of the batch intact.
//
// This module is intentionally dependency-free so it can be unit-tested in isolation.

// Columns that must be non-null/non-empty, keyed by destination table name.
// (For search_query_performance the table name and report type are identical.)
export const REQUIRED_NOT_NULL: Record<string, string[]> = {
  search_query_performance: ['search_query'],
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
