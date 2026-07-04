// Upsert-config vs DB-unique-constraint mismatch detector (INB-88).
//
// PostgreSQL's ON CONFLICT (col, ...) needs a non-partial unique index whose
// column SET equals the conflict target (order-insensitive). When code upserts
// with a conflict key that has no such constraint, re-uploads either silently
// duplicate rows (when the call falls back to plain insert semantics — the INB-82
// failure, 1,031 dupes in purchased_product_report) or hard-error. This detector
// compares the code's configured keys against the DB's actual unique indexes and
// returns every mismatch.
//
// Pure function over plain inputs — no DB access. The live wrapper is in
// lib/upsert-constraint-check-db.ts.

export interface UniqueIndexInfo {
  table_name: string
  index_name?: string
  columns: string[]
}

export interface UpsertConstraintViolation {
  table: string
  configuredKey: string
  reason: string
}

export function findUpsertConstraintViolations(
  conflictKeys: Record<string, string>,
  uniqueIndexes: UniqueIndexInfo[],
): UpsertConstraintViolation[] {
  const byTable = new Map<string, UniqueIndexInfo[]>()
  for (const ix of uniqueIndexes) {
    const list = byTable.get(ix.table_name)
    if (list) list.push(ix)
    else byTable.set(ix.table_name, [ix])
  }

  const violations: UpsertConstraintViolation[] = []
  for (const [table, key] of Object.entries(conflictKeys)) {
    const wanted = key.split(',').map(c => c.trim()).filter(Boolean).sort()
    const indexes = byTable.get(table) ?? []
    const matched = indexes.some(ix => {
      const have = [...ix.columns].sort()
      return have.length === wanted.length && have.every((col, i) => col === wanted[i])
    })
    if (matched) continue

    violations.push({
      table,
      configuredKey: key,
      reason: indexes.length
        ? `no UNIQUE constraint on (${wanted.join(',')}); table has: ${indexes.map(ix => `(${ix.columns.join(',')})`).join(', ')}`
        : 'table has no unique indexes at all (or does not exist)',
    })
  }
  return violations
}
