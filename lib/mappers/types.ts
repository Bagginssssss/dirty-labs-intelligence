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
  subcategory?: string     // required for smartscout_subcategory_brands (no per-row column)
  filename?: string        // original upload filename; used for granularity detection
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

// Maps SmartScout "Primary Subcategory" display strings to storage codes.
// Simple snake_case doesn't produce correct codes for all values
// (e.g. "Laundry Stain Removers" → laundry_stain_removers ≠ laundry_stain_remover).
const SUBCATEGORY_MAP: Record<string, string> = {
  'dishwasher detergent':              'dishwasher_detergent',
  'laundry detergent pacs & tablets':  'laundry_detergent',
  'liquid laundry detergent':          'laundry_detergent',
  'laundry stain removers':            'laundry_stain_remover',
  'household toilet cleaners':         'toilet_bowl_cleaner',
  'household disinfectant wipes':      'toilet_bowl_cleaner',
}

export function normalizeSmartscoutSubcategory(raw: string | undefined | null): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  return SUBCATEGORY_MAP[key] ?? key.replace(/\s+/g, '_')
}
