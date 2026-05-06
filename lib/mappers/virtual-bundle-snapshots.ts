import { MappedRow, RawRow, MapperContext, parseNumeric } from './types'

// Matches: "Week 83 Report (2025-04-29 through 2025-07-28)"
const SECTION_RE = /^Week (\d+) Report \((\d{4}-\d{2}-\d{2}) through (\d{4}-\d{2}-\d{2})\)/i

// Amazon's VB snapshot export is a non-standard multi-section CSV.  Each section
// starts with a "Week N Report (start through end)" header and contains 5 columns:
// ASIN, BUNDLE, 90 DAY SALES, APRX. MARGIN, APRX. PROFIT.
//
// PapaParse uses the first section header line as the column-key row, so:
//   - Object.keys(rows[0])[0]  → "Week 83 Report (…)" (first section context)
//   - Subsequent section headers appear as vals[0] in regular data rows.
//   - Column-header rows ("ASIN, BUNDLE, …") and summary rows (empty ASIN) are skipped.
export function mapVirtualBundleSnapshots(
  rows: RawRow[],
  brandId: string,
  _context?: MapperContext
): MappedRow[] {
  if (rows.length === 0) return []

  let weekNumber: number | null = null
  let windowStart: string | null = null
  let snapshotDate: string | null = null

  // The first section header was consumed by PapaParse as the column-key row.
  // Recover it from the first key of any row.
  const firstKey = Object.keys(rows[0])[0] ?? ''
  const initMatch = SECTION_RE.exec(firstKey)
  if (initMatch) {
    weekNumber  = parseInt(initMatch[1], 10)
    windowStart = initMatch[2]
    snapshotDate = initMatch[3]
  }

  const out: MappedRow[] = []

  for (const row of rows) {
    const vals = Object.values(row) as string[]
    const col0 = (vals[0] ?? '').trim()

    // New section header embedded as a data row (Week 85+)
    const sectionMatch = SECTION_RE.exec(col0)
    if (sectionMatch) {
      weekNumber   = parseInt(sectionMatch[1], 10)
      windowStart  = sectionMatch[2]
      snapshotDate = sectionMatch[3]
      continue
    }

    // Skip column-header rows ("ASIN") and summary / empty rows
    if (col0 === '' || col0.toUpperCase() === 'ASIN') continue
    if (snapshotDate === null) continue

    // Only accept rows whose first cell looks like an ASIN (starts with B0)
    if (!/^B0[A-Z0-9]/i.test(col0)) continue

    const marginRaw = parseNumeric((vals[3] ?? '').replace('%', ''))
    const marginPct = marginRaw !== null ? marginRaw / 100 : null

    out.push({
      brand_id:     brandId,
      bundle_asin:  col0,
      bundle_name:  (vals[1] ?? '').trim() || null,
      snapshot_date: snapshotDate,
      window_start: windowStart,
      week_number:  weekNumber,
      sales_90d:    parseNumeric(vals[2] ?? ''),
      margin_pct:   marginPct,
      profit_90d:   parseNumeric(vals[4] ?? ''),
    })
  }

  return out
}
