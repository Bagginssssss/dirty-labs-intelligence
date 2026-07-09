// INB-145 — live wrapper for the report-registry mirror diff. Fetches the real
// report_registry rows and diffs them against REPORT_REGISTRY_SEED. Server only
// (service-role client). Never throws: an unreachable/absent table reports
// 'unavailable' rather than failing the caller (same contract as
// upsert-constraint-check-db.ts, so /api/health stays robust).

import { supabaseAdmin } from './supabase-admin'
import { REPORT_REGISTRY_SEED, type RegistryRow } from './report-registry'
import { diffRegistrySeed, type RegistryDiff } from './report-registry-check'

export interface RegistryMirrorResult {
  status: 'ok' | 'drift' | 'unavailable'
  diffs: RegistryDiff[]
  rows_checked: number
  message?: string
}

const COLUMNS =
  'report_key, display_name, source_group, cadence, pull_period, target_table, ' +
  'discriminator, requires_period_dates, is_active, sort_order, notes'

export async function checkRegistryMirrorLive(): Promise<RegistryMirrorResult> {
  try {
    const { data, error } = await supabaseAdmin.from('report_registry').select(COLUMNS)
    if (error || !data) {
      return {
        status: 'unavailable',
        diffs: [],
        rows_checked: 0,
        message: `report_registry unavailable: ${error?.message ?? 'no data returned'}`,
      }
    }
    const diffs = diffRegistrySeed(REPORT_REGISTRY_SEED, data as unknown as RegistryRow[])
    if (diffs.length) {
      return {
        status: 'drift',
        diffs,
        rows_checked: data.length,
        message: `${diffs.length} registry mirror difference(s) — lib/report-registry.ts and the report_registry table have drifted`,
      }
    }
    return { status: 'ok', diffs: [], rows_checked: data.length }
  } catch (err) {
    return {
      status: 'unavailable',
      diffs: [],
      rows_checked: 0,
      message: `report_registry unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
