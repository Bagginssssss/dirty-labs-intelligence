// Shared discriminator interpreter for report coverage (INB-146; reused by INB-147).
//
// A registry row's `discriminator` (report_registry.discriminator, mirrored in
// lib/report-registry.ts) selects which rows of a shared target_table belong to a
// report_key. Three jsonb shapes exist:
//   { column, values[] }              — value match (the only live shape; the optional
//                                        `asin` echo on SI-rank rows is ignored here)
//   { column, op: is_null|is_not_null} — null-ness match (type-legal but currently
//                                        unused — migration 042 flipped the purchased-
//                                        product pair to ad_type values; supported +
//                                        tested anyway)
//   null                              — whole table

import type { Discriminator } from '@/lib/report-registry'

export type DiscriminatorFilter =
  | { kind: 'all' }
  | { kind: 'in'; column: string; values: string[] }
  | { kind: 'null'; column: string; isNull: boolean }

export function interpretDiscriminator(d: Discriminator): DiscriminatorFilter {
  if (d == null) return { kind: 'all' }
  if ('op' in d) return { kind: 'null', column: d.column, isNull: d.op === 'is_null' }
  return { kind: 'in', column: d.column, values: d.values }
}

// A row predicate for all three shapes (INB-147 reuse).
export function discriminatorPredicate(
  d: Discriminator,
): (row: Record<string, unknown>) => boolean {
  const f = interpretDiscriminator(d)
  if (f.kind === 'all') return () => true
  if (f.kind === 'in') return row => f.values.includes(String(row[f.column]))
  return row => (row[f.column] == null) === f.isNull
}

// The p_filter_values argument for get_coverage_dates: the discriminator's values, or
// null for a whole-table read. The RPC has no branch for the null-ness shape (no live
// report uses it), so a discriminator of that shape throws — a loud signal rather than
// a silent whole-table read.
export function coverageFilterValues(d: Discriminator): string[] | null {
  const f = interpretDiscriminator(d)
  if (f.kind === 'all') return null
  if (f.kind === 'in') return f.values
  throw new Error(
    `coverageFilterValues: is_null/is_not_null discriminator on "${f.column}" is not supported by get_coverage_dates`,
  )
}
