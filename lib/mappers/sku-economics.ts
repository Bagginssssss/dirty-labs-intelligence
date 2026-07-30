import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, norm, parseDate, parseNumeric } from './types'

// INB-162 — Amazon SKU Economics (weekly, MSKU-level) → weekly parent rows +
// long-format fee rows. Two exports feed the ingest route:
//   mapSkuEconomicsWeekly   — batch mapper → sku_economics_weekly (the detected table)
//   buildSkuEconomicsFees   — derives the sku_economics_fees child rows from the SAME
//                             raw rows (route writes them by delete-and-reinsert)
//   skuEconomicsWarnings    — per-row net-proceeds identity + COGS/Misc-populated guards
//
// The fee set VARIES week to week (storage fees only appear in the billed week), so fee
// columns are detected DYNAMICALLY as per-unit/quantity/total TRIPLETS — never hard-coded.
// The lone "Cost of goods sold per unit" / "Miscellaneous cost per unit" columns have no
// quantity/total sibling, so they are naturally excluded from triplet detection.

// The two fee types that are COMPONENTS of "FBA fulfillment fees" (Base fulfillment fee +
// Fuel and Logistics-related surcharge = FBA fulfillment fees, verified per-row). Any fee
// summation must exclude components to avoid double-counting. Unknown fees default
// non-component. Names are the exact Amazon header base (minus the triplet suffix).
export const COMPONENT_FEES = new Set<string>([
  'Base fulfillment fee',
  'Fuel and Logistics-related surcharge',
])

// One detected fee, with the exact display name and the NORMALIZED keys of its three cells.
export interface FeeTriplet {
  feeType: string    // original header base, e.g. "Referral fee", "FBA fulfillment fees"
  perUnit: string    // normalized header key for the "<base> per unit" column
  quantity: string   // normalized header key for the "<base> quantity" column
  total: string      // normalized header key for the "<base> total" column
}

const SUFFIXES = [' per unit', ' quantity', ' total'] as const

// A base name is a triplet iff all three of its "<base> per unit/quantity/total" columns
// are present in the header. Detection is order-independent and case-insensitive.
export function detectFeeTriplets(headers: string[]): FeeTriplet[] {
  const bases = new Map<string, { base: string; parts: Record<string, string> }>()
  for (const h of headers) {
    const t = h.replace(/^﻿/, '').trim()
    const lower = t.toLowerCase()
    for (const suf of SUFFIXES) {
      if (lower.endsWith(suf)) {
        const base = t.slice(0, t.length - suf.length).trim()
        const key = norm(base)
        if (!bases.has(key)) bases.set(key, { base, parts: {} })
        bases.get(key)!.parts[suf.trim()] = norm(t)
        break
      }
    }
  }
  const out: FeeTriplet[] = []
  for (const { base, parts } of bases.values()) {
    if (parts['per unit'] && parts['quantity'] && parts['total']) {
      out.push({ feeType: base, perUnit: parts['per unit'], quantity: parts['quantity'], total: parts['total'] })
    }
  }
  return out
}

function num(v: string): number { return parseNumeric(v) ?? 0 }

// Keep a row if it has ANY economic activity: units sold, net sales, or a non-empty fee
// cell. Only fully-inert rows (all three absent) are skipped. Reads fee cells by the
// triplet's reconstructed header (makeGetter normalizes, so "<base> total" resolves).
export function isActiveSkuEconRow(row: RawRow, triplets: FeeTriplet[]): boolean {
  const get = makeGetter(row)
  if (num(get('', 'Units sold', 'units_sold')) !== 0) return true
  if (num(get('', 'Net sales', 'net_sales')) !== 0) return true
  for (const t of triplets) {
    for (const suf of SUFFIXES) {
      const raw = get('', `${t.feeType}${suf}`)
      if (raw.trim() !== '' && num(raw) !== 0) return true
    }
  }
  return false
}

export interface SkuEconomicsWeeklyRow extends MappedRow {
  week_start: string | null
  week_end: string | null
  marketplace: string
  parent_asin: string | null
  asin: string | null
  fnsku: string | null
  msku: string
  currency: string | null
  avg_sales_price: number | null
  units_sold: number | null
  units_returned: number | null
  net_units_sold: number | null
  sales: number | null
  net_sales: number | null
  net_proceeds_total: number | null
  net_proceeds_per_net_unit: number | null
}

// Batch mapper: one weekly row per ACTIVE source row. Fees are built separately by
// buildSkuEconomicsFees (same active-check, so the two sets are consistent by construction).
export function mapSkuEconomicsWeekly(rows: RawRow[], brandId: string, _ctx?: MapperContext): SkuEconomicsWeeklyRow[] {
  if (rows.length === 0) return []
  const triplets = detectFeeTriplets(Object.keys(rows[0]))
  const out: SkuEconomicsWeeklyRow[] = []
  for (const row of rows) {
    if (!isActiveSkuEconRow(row, triplets)) continue
    const get = makeGetter(row)
    out.push({
      brand_id:                  brandId,
      week_start:                parseDate(get('', 'Start date', 'start_date')),
      week_end:                  parseDate(get('', 'End date', 'end_date')),
      marketplace:               get('', 'Amazon store', 'amazon_store') || '',
      parent_asin:               get('', 'Parent ASIN', 'parent_asin') || null,
      asin:                      get('', 'ASIN', 'asin') || null,
      fnsku:                     get('', 'FNSKU', 'fnsku') || null,
      msku:                      get('', 'MSKU', 'msku') || '',
      currency:                  get('', 'Currency code', 'currency_code', 'currency') || null,
      avg_sales_price:           parseNumeric(get('', 'Average sales price', 'average_sales_price')),
      units_sold:                parseNumeric(get('', 'Units sold', 'units_sold')),
      units_returned:            parseNumeric(get('', 'Units returned', 'units_returned')),
      net_units_sold:            parseNumeric(get('', 'Net units sold', 'net_units_sold')),
      sales:                     parseNumeric(get('', 'Sales', 'sales')),
      net_sales:                 parseNumeric(get('', 'Net sales', 'net_sales')),
      net_proceeds_total:        parseNumeric(get('', 'Net proceeds total', 'net_proceeds_total')),
      net_proceeds_per_net_unit: parseNumeric(get('', 'Net proceeds per net unit sold', 'net_proceeds_per_net_unit_sold')),
    })
  }
  return out
}

export interface SkuEconomicsFeeRow {
  brand_id: string
  week_start: string | null
  marketplace: string
  msku: string
  asin: string | null
  fee_type: string
  per_unit: number | null
  quantity: number | null
  total: number | null
  is_component: boolean
}

// Derives the long fee rows from the same raw rows. One row per (active weekly row × fee
// type that has any non-empty cell for that SKU) — so an SKU with no removal fee that week
// gets no removal-fee row. Deduped last-wins on the natural key for insert safety.
export function buildSkuEconomicsFees(rows: RawRow[], brandId: string): SkuEconomicsFeeRow[] {
  if (rows.length === 0) return []
  const triplets = detectFeeTriplets(Object.keys(rows[0]))
  const seen = new Map<string, SkuEconomicsFeeRow>()
  for (const row of rows) {
    if (!isActiveSkuEconRow(row, triplets)) continue
    const get = makeGetter(row)
    const week_start = parseDate(get('', 'Start date', 'start_date'))
    if (!week_start) continue  // no parseable week → would orphan; skip (weekly row is skipped too)
    const marketplace = get('', 'Amazon store', 'amazon_store') || ''
    const msku = get('', 'MSKU', 'msku') || ''
    const asin = get('', 'ASIN', 'asin') || null
    for (const t of triplets) {
      const perU = get('', `${t.feeType} per unit`)
      const qty  = get('', `${t.feeType} quantity`)
      const tot  = get('', `${t.feeType} total`)
      // Emit only when the fee has a value in the file for this SKU (any of the 3 cells present).
      if (perU.trim() === '' && qty.trim() === '' && tot.trim() === '') continue
      const key = `${week_start}::${marketplace}::${msku}::${t.feeType}`
      seen.set(key, {
        brand_id:     brandId,
        week_start,
        marketplace,
        msku,
        asin,
        fee_type:     t.feeType,
        per_unit:     parseNumeric(perU),
        quantity:     parseNumeric(qty),
        total:        parseNumeric(tot),
        is_component: COMPONENT_FEES.has(t.feeType),
      })
    }
  }
  return [...seen.values()]
}

// Non-fatal upload guards, surfaced in the response summary + ingestion log:
//   (a) net-proceeds identity: |net_sales − Σ(non-component fee totals) − net_proceeds| > $0.02
//       (Sponsored Products charge is a non-component fee, already inside the sum).
//   (b) COGS/Misc columns arriving populated — would mean net proceeds already deducts COGS,
//       so the profitability views would double-deduct. Loud by design.
export function skuEconomicsWarnings(rows: RawRow[]): string[] {
  if (rows.length === 0) return []
  const triplets = detectFeeTriplets(Object.keys(rows[0]))
  let npViolations = 0
  let cogsPopulated = 0
  for (const row of rows) {
    const get = makeGetter(row)
    const cogs = get('', 'Cost of goods sold per unit', 'cost_of_goods_sold_per_unit').trim()
    const misc = get('', 'Miscellaneous cost per unit', 'miscellaneous_cost_per_unit').trim()
    if (cogs !== '' || misc !== '') cogsPopulated++

    if (!isActiveSkuEconRow(row, triplets)) continue
    const netSales = num(get('', 'Net sales', 'net_sales'))
    let feeSum = 0
    for (const t of triplets) {
      if (COMPONENT_FEES.has(t.feeType)) continue
      feeSum += num(get('', `${t.feeType} total`))
    }
    const np = num(get('', 'Net proceeds total', 'net_proceeds_total'))
    if (Math.abs(netSales - feeSum - np) > 0.02) npViolations++
  }
  const warnings: string[] = []
  if (cogsPopulated > 0) {
    warnings.push(
      `[warning] ${cogsPopulated} row(s) have a populated "Cost of goods sold" / "Miscellaneous cost" column — ` +
      `net proceeds may already deduct COGS, so the profitability views would double-deduct. Investigate before trusting margins.`,
    )
  }
  if (npViolations > 0) {
    warnings.push(
      `[warning] ${npViolations} row(s) failed the net-proceeds identity ` +
      `(|net_sales − Σ non-component fees − net_proceeds| > $0.02) — the fee set may be incomplete or a new fee type appeared.`,
    )
  }
  return warnings
}
