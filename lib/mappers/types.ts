import { parseDate, parseInteger, parseNumeric } from '@/lib/csv-parser'

export type RawRow = Record<string, string>

// Fields prefixed with _ are resolved by the ingest route into UUID FK columns.
export interface MappedRow extends Record<string, unknown> {
  brand_id: string
}

// Optional context passed from the ingest route to every mapper.
export interface MapperContext {
  date_range_start?: string
  date_range_end?: string
  hint?: string            // detection hint, e.g. 'SB' for Sponsored Brands rows
}

// Normalises a header string to lowercase_underscores for flexible matching.
// Strips BOM (﻿) as a defence-in-depth measure alongside the csv-parser fix.
export function norm(s: string): string {
  return s
    .replace(/^﻿/, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Builds a normalised lookup of the raw row once, then retrieves values by
// any of the supplied candidate keys (first match wins).
export function makeGetter(row: RawRow) {
  const normRow: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) normRow[norm(k)] = v

  return function get(defaultVal: string, ...keys: string[]): string {
    for (const k of keys) {
      const v = normRow[norm(k)]
      if (v !== undefined) return v
    }
    return defaultVal
  }
}

export { parseDate, parseInteger, parseNumeric }
