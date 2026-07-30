import type { RawRow } from './types'
import { makeGetter, parseNumeric } from './types'

// INB-162 — COGS loader (internal-cost sheet → cogs table). Pure functions only:
//   parseAndValidateCogs — map + reject (non-Amazon Class, empty SKU, unparseable cost, in-file dup)
//   planCogsWrite        — SCD-2 plan (close-changed / no-op-unchanged / insert-new) vs open rows
// The DB orchestration lives in lib/cogs-ingest.ts (needs supabaseAdmin).
//
// Source sheet ("Amazon Avg Cost as of ...") columns: Class | Tags Level 1 |
// Internal DL SKU (Primary) | Product Description | Avg/Cost. Ingest is CSV-only
// (the pipeline decodes text, not xlsx) — export the sheet to CSV before upload.

export interface CogsIncoming {
  internal_sku: string
  unit_cost: number
  notes: string | null
}

export interface CogsRejected {
  reason: string
}

// Maps + validates. internal_sku ← "Internal DL SKU (Primary)"; unit_cost ← "Avg/Cost"
// (full precision); notes ← "Product Description". Class/Tags are ignored EXCEPT a present,
// non-Amazon Class is rejected. Duplicate internal SKUs within the file are rejected.
export function parseAndValidateCogs(rows: RawRow[]): { valid: CogsIncoming[]; rejected: CogsRejected[] } {
  const valid: CogsIncoming[] = []
  const rejected: CogsRejected[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const get = makeGetter(row)
    const cls = get('', 'Class', 'class').trim()
    const internal_sku = get('', 'Internal DL SKU (Primary)', 'internal_dl_sku_primary', 'internal_sku').trim()
    const costRaw = get('', 'Avg/Cost', 'avg_cost', 'unit_cost')
    const notes = get('', 'Product Description', 'product_description', 'notes').trim() || null

    // A present Class must be 'Amazon' (case-insensitive). A blank/absent Class column is
    // allowed (can't enforce what isn't there) — the sheet always carries Class='Amazon'.
    if (cls !== '' && cls.toLowerCase() !== 'amazon') {
      rejected.push({ reason: `non-Amazon Class '${cls}' for SKU ${internal_sku || '(blank)'}` })
      continue
    }
    if (internal_sku === '') { rejected.push({ reason: 'empty Internal DL SKU (Primary)' }); continue }
    const unit_cost = parseNumeric(costRaw)
    if (unit_cost === null) { rejected.push({ reason: `unparseable Avg/Cost for SKU ${internal_sku}` }); continue }
    if (seen.has(internal_sku)) { rejected.push({ reason: `duplicate Internal DL SKU in file: ${internal_sku}` }); continue }

    seen.add(internal_sku)
    valid.push({ internal_sku, unit_cost, notes })
  }

  return { valid, rejected }
}

export interface CogsExistingOpen {
  id: string
  internal_sku: string
  unit_cost: number
  valid_from: string
}

export interface CogsInsertRow {
  brand_id: string
  internal_sku: string
  msku: string
  unit_cost: number
  valid_from: string
  valid_to: null
  notes: string | null
}

export interface CogsCloseOp {
  id: string
  valid_to: string
}

export interface CogsPlan {
  toInsert: CogsInsertRow[]
  toClose: CogsCloseOp[]
  unchanged: number
  dateConflicts: string[]  // internal_skus whose change couldn't be dated forward
}

// Compare unit costs as numbers with a tiny epsilon (both come from numeric columns).
function sameCost(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

// SCD-2 planner. For each incoming SKU vs the current OPEN general cost row (msku=''):
//   - no current row        → insert new (valid_from = effectiveDate, valid_to NULL)
//   - same cost             → no-op (unchanged++)
//   - changed cost          → close current at effectiveDate + insert the new version
//   - changed but effectiveDate is not AFTER the current valid_from → dateConflict (skip; a
//     cost change needs a forward-dated effective date, else the closed range would invert)
export function planCogsWrite(
  brandId: string,
  existingOpen: CogsExistingOpen[],
  incoming: CogsIncoming[],
  effectiveDate: string,
): CogsPlan {
  const byKey = new Map<string, CogsExistingOpen>()
  for (const e of existingOpen) byKey.set(e.internal_sku, e)

  const toInsert: CogsInsertRow[] = []
  const toClose: CogsCloseOp[] = []
  const dateConflicts: string[] = []
  let unchanged = 0

  const mkInsert = (inc: CogsIncoming): CogsInsertRow => ({
    brand_id: brandId,
    internal_sku: inc.internal_sku,
    msku: '',
    unit_cost: inc.unit_cost,
    valid_from: effectiveDate,
    valid_to: null,
    notes: inc.notes,
  })

  for (const inc of incoming) {
    const cur = byKey.get(inc.internal_sku)
    if (!cur) { toInsert.push(mkInsert(inc)); continue }
    if (sameCost(Number(cur.unit_cost), inc.unit_cost)) { unchanged++; continue }
    if (effectiveDate <= cur.valid_from) { dateConflicts.push(inc.internal_sku); continue }
    toClose.push({ id: cur.id, valid_to: effectiveDate })
    toInsert.push(mkInsert(inc))
  }

  return { toInsert, toClose, unchanged, dateConflicts }
}
