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
  // INB-149: the subset of `columns` that are NULLABLE (attnotnull = false).
  // Absent/empty means the constraint is NULL-proof.
  nullable_columns?: string[] | null
}

export interface UpsertConstraintViolation {
  table: string
  configuredKey: string
  reason: string
}

export interface NullableKeyViolation {
  table: string
  indexName?: string
  nullableColumns: string[]
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

// INB-149 — flags unique constraints that contain a NULLABLE column. Postgres
// treats NULLs as distinct, so a NULL in a unique key lets overlapping upserts
// duplicate silently (the SB Attributed Purchases defect; also INB-82). Any table
// with a nullable key column that is NOT in `allowlist` is a violation. Pure.
export function findNullableUniqueKeyColumns(
  uniqueIndexes: UniqueIndexInfo[],
  allowlist: Record<string, string>,
): NullableKeyViolation[] {
  const violations: NullableKeyViolation[] = []
  for (const ix of uniqueIndexes) {
    const nullable = ix.nullable_columns ?? []
    if (nullable.length === 0) continue
    if (Object.prototype.hasOwnProperty.call(allowlist, ix.table_name)) continue
    violations.push({
      table: ix.table_name,
      indexName: ix.index_name,
      nullableColumns: nullable,
      reason: `unique constraint ${ix.index_name ?? '(unnamed)'} includes nullable column(s) (${nullable.join(',')}) — NULLs are distinct, so overlapping upserts can duplicate silently. Make them NOT NULL DEFAULT '' or allowlist the table.`,
    })
  }
  return violations
}
