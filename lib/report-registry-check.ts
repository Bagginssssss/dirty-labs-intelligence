// INB-145 — pure DB↔TS mirror diff for the report registry.
//
// lib/report-registry.ts (REPORT_REGISTRY_SEED) must mirror the live
// report_registry table exactly. This detector compares the two row sets
// field-by-field and returns one entry per divergence. Pure — no DB access —
// so it is unit-testable; the live wrapper (report-registry-check-db.ts) feeds
// it real rows. Run via `npm run check:registry`.

import type { RegistryRow } from './report-registry'

export interface RegistryDiff {
  report_key: string
  reason: string
}

// The columns compared. created_at/updated_at are DB-managed and excluded.
const FIELDS: (keyof RegistryRow)[] = [
  'display_name', 'source_group', 'cadence', 'pull_period', 'target_table',
  'discriminator', 'requires_period_dates', 'is_active', 'sort_order', 'notes',
  'retired_at', // INB-175 — absent in the seed (undefined) equals DB NULL; canonical() coalesces them.
]

// Canonical JSON with object keys sorted, so discriminator jsonb compares
// independent of key order (PostgREST may return a different key order). INB-175: null and undefined
// canonicalize identically ('null') so an optional seed field left absent matches a DB NULL column.
function canonical(v: unknown): string {
  if (v == null) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const obj = v as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

export function diffRegistrySeed(
  tsRows: RegistryRow[],
  dbRows: RegistryRow[],
): RegistryDiff[] {
  const diffs: RegistryDiff[] = []
  const dbByKey = new Map(dbRows.map(r => [r.report_key, r]))
  const tsByKey = new Map(tsRows.map(r => [r.report_key, r]))

  for (const ts of tsRows) {
    const db = dbByKey.get(ts.report_key)
    if (!db) {
      diffs.push({ report_key: ts.report_key, reason: 'missing in DB (present in TS seed)' })
      continue
    }
    for (const f of FIELDS) {
      if (canonical(ts[f]) !== canonical(db[f])) {
        diffs.push({
          report_key: ts.report_key,
          reason: `${f} differs: TS ${canonical(ts[f])} vs DB ${canonical(db[f])}`,
        })
      }
    }
  }
  for (const db of dbRows) {
    if (!tsByKey.has(db.report_key)) {
      diffs.push({ report_key: db.report_key, reason: 'present in DB but missing from TS seed' })
    }
  }
  return diffs
}
