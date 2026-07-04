// Thin DB wrapper for the upsert-constraint detector (INB-88): fetches the real
// unique constraints via the read-only get_unique_constraint_columns() RPC
// (migration 034, service_role only) and runs the pure detector over them.
// Server only — imports the service-role client.

import { supabaseAdmin } from './supabase-admin'
import { ALL_UPSERT_CONFLICT_KEYS } from './upsert-config'
import {
  findUpsertConstraintViolations,
  type UniqueIndexInfo,
  type UpsertConstraintViolation,
} from './upsert-constraint-check'

export interface UpsertConstraintCheckResult {
  status: 'ok' | 'violations' | 'unavailable'
  violations: UpsertConstraintViolation[]
  tables_checked: number
  message?: string
}

// Never throws: an unreachable DB or missing RPC reports 'unavailable' rather
// than failing the caller (the health route must not gain a brittle dependency).
export async function checkUpsertConstraintsLive(): Promise<UpsertConstraintCheckResult> {
  const tablesChecked = Object.keys(ALL_UPSERT_CONFLICT_KEYS).length
  try {
    const { data, error } = await supabaseAdmin.rpc('get_unique_constraint_columns')
    if (error || !data) {
      return {
        status: 'unavailable',
        violations: [],
        tables_checked: tablesChecked,
        message: `constraint introspection unavailable: ${error?.message ?? 'no data returned'}`,
      }
    }
    const violations = findUpsertConstraintViolations(
      ALL_UPSERT_CONFLICT_KEYS,
      data as UniqueIndexInfo[],
    )
    if (violations.length) {
      return {
        status: 'violations',
        violations,
        tables_checked: tablesChecked,
        message: `${violations.length} configured upsert conflict key(s) have no matching UNIQUE constraint — upserts on these tables will silently duplicate rows or fail`,
      }
    }
    return { status: 'ok', violations: [], tables_checked: tablesChecked }
  } catch (err) {
    return {
      status: 'unavailable',
      violations: [],
      tables_checked: tablesChecked,
      message: `constraint introspection unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
