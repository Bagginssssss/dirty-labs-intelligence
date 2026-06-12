import type { MappedRow, MapperContext, RawRow } from './types'
import { makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface BusinessReportRow extends MappedRow {
  _asin: string
  _title: string
  report_date: string | null
  sessions_total: number | null
  sessions_mobile: number | null
  sessions_browser: number | null
  session_pct: number | null
  page_views_total: number | null
  page_views_pct: number | null
  buy_box_pct: number | null
  units_ordered: number | null
  unit_session_pct: number | null
  ordered_product_sales: number | null
  total_order_items: number | null
  units_refunded: number | null
  refund_rate: number | null
  shipped_product_sales: number | null
  units_shipped: number | null
}

export function mapBusinessReport(
  row: RawRow,
  brandId: string,
  context?: MapperContext
): BusinessReportRow {
  const get = makeGetter(row)

  // No date column in Amazon business reports — use the upload form's date_range_start.
  const report_date = context?.date_range_start
    ? parseDate(context.date_range_start)
    : null

  return {
    brand_id: brandId,
    // (Child) ASIN is the leaf ASIN; fall back to (Parent) ASIN if absent.
    _asin: get('', '(Child) ASIN', 'child_asin', '(Parent) ASIN', 'parent_asin', 'ASIN', 'asin'),
    _title: get('', 'Title', 'title'),
    report_date,
    sessions_total: parseInteger(get('', 'Sessions - Total', 'Sessions – Total', 'sessions_total')),
    sessions_mobile: parseInteger(get('', 'Sessions - Mobile App', 'Sessions – Mobile App', 'sessions_mobile_app', 'sessions_mobile')),
    sessions_browser: parseInteger(get('', 'Sessions - Browser', 'Sessions – Browser', 'sessions_browser')),
    // session_pct not present in the confirmed file; will be null until Amazon adds it.
    session_pct: parseNumeric(get('', 'Session Percentage - Total', 'Session Percentage – Total', 'session_percentage_total', 'session_pct')),
    page_views_total: parseInteger(get('', 'Page Views - Total', 'Page Views – Total', 'page_views_total')),
    page_views_pct: parseNumeric(get('', 'Page Views Percentage - Total', 'Page Views Percentage – Total', 'page_views_pct')),
    buy_box_pct: parseNumeric(get('', 'Featured Offer (Buy Box) Percentage', 'Buy Box Percentage', 'buy_box_pct')),
    units_ordered: parseInteger(get('', 'Units Ordered', 'units_ordered')),
    unit_session_pct: parseNumeric(get('', 'Unit Session Percentage', 'unit_session_percentage', 'unit_session_pct')),
    ordered_product_sales: parseNumeric(get('', 'Ordered Product Sales', 'ordered_product_sales')),
    total_order_items: parseInteger(get('', 'Total Order Items', 'total_order_items')),
    units_refunded: parseInteger(get('', 'Units Refunded', 'units_refunded')),
    refund_rate: parseNumeric(get('', 'Refund Rate', 'refund_rate')),
    shipped_product_sales: parseNumeric(get('', 'Shipped Product Sales', 'shipped_product_sales')),
    units_shipped: parseInteger(get('', 'Units Shipped', 'units_shipped')),
  }
}

// ─── Batch aggregation (INB-108) ──────────────────────────────────────────────
//
// Amazon's "Detail Page Sales and Traffic by Child ASIN" report can emit TWO rows
// for one child ASIN when a product has multiple fulfillment SKUs (e.g. an FBA SKU
// row with the real volume and a non-FBA/merchant SKU row with tiny volume). The
// mapper keys on child ASIN only, so both rows resolve to the same asin_id; the
// downstream dedup (conflict key brand_id,asin_id,report_date) keeps the LAST one,
// letting the tiny non-FBA numbers overwrite the correct FBA numbers.
//
// Grouping all rows that share a child ASIN (within a brand_id + report_date) and
// emitting ONE aggregated row per child ASIN fixes this at the source. A group of a
// single row passes through completely unchanged (no-op for one-row-per-ASIN files).

// Per-SKU volume columns — SUM across the grouped rows.
const SUM_KEYS = [
  'units_ordered',
  'ordered_product_sales',
  'total_order_items',
  'units_refunded',
  'units_shipped',
  'shipped_product_sales',
] as const

// Currency sums are rounded to cents to avoid floating-point drift (e.g. so
// 338609.34 + 203.00 lands on exactly 338812.34).
const CURRENCY_SUM_KEYS = new Set<string>(['ordered_product_sales', 'shipped_product_sales'])

// ASIN-level columns Amazon reports identically on every SKU row — carry a single
// value (first non-null) rather than summing. unit_session_pct and refund_rate are
// handled separately: both are rates recomputed from the summed counts.
const SINGLE_KEYS = [
  'sessions_total',
  'sessions_mobile',
  'sessions_browser',
  'session_pct',
  'page_views_total',
  'page_views_pct',
  'buy_box_pct',
] as const

function firstNonNull(group: BusinessReportRow[], key: keyof BusinessReportRow): number | null {
  for (const r of group) {
    const v = r[key]
    if (v !== null && v !== undefined) return v as number
  }
  return null
}

// Collapses a set of rows that share a child ASIN into one aggregated row.
// A single-row group is returned untouched so existing one-row-per-ASIN files are
// byte-for-byte unchanged.
function aggregateGroup(group: BusinessReportRow[]): BusinessReportRow {
  if (group.length === 1) return group[0]

  const out: BusinessReportRow = { ...group[0] }

  // SUM volume columns. Null only when every row is null (preserve "no data");
  // otherwise nulls count as 0.
  for (const key of SUM_KEYS) {
    let sum = 0
    let anyValue = false
    for (const r of group) {
      const v = r[key] as number | null
      if (v !== null && v !== undefined) {
        sum += v
        anyValue = true
      }
    }
    out[key] = anyValue ? (CURRENCY_SUM_KEYS.has(key) ? Math.round(sum * 100) / 100 : sum) : null
  }

  // Carry ASIN-level single-value columns.
  for (const key of SINGLE_KEYS) {
    out[key] = firstNonNull(group, key)
  }

  // RECOMPUTE the rate columns off the summed counts — each source row's value is
  // computed against its own partial counts, so carrying one would be wrong.
  const units = out.units_ordered
  const sessions = out.sessions_total
  out.unit_session_pct =
    units !== null && sessions !== null && sessions > 0
      ? (units / sessions) * 100
      : null

  const refunded = out.units_refunded
  out.refund_rate =
    refunded !== null && units !== null && units > 0
      ? (refunded / units) * 100
      : null

  return out
}

// Batch mapper: maps every raw row with the per-row mapper, then groups by
// (report_date, child ASIN) and aggregates each group. brand_id is constant per
// upload so it need not be part of the key. Group order follows first appearance,
// keeping output deterministic.
export function mapBusinessReportBatch(
  rows: RawRow[],
  brandId: string,
  context?: MapperContext
): BusinessReportRow[] {
  const mapped = rows.map(r => mapBusinessReport(r, brandId, context))

  const groups = new Map<string, BusinessReportRow[]>()
  for (const row of mapped) {
    const key = `${row.report_date ?? ''}::${row._asin ?? ''}`
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }

  return Array.from(groups.values()).map(aggregateGroup)
}
