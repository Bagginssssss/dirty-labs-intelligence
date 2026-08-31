import type { MappedRow, MapperContext, RawRow } from './types'
import { makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface SubscribeAndSaveRow extends MappedRow {
  _asin: string
  report_date: string | null
  date_range_end: string | null
  sku: string | null
  fulfilled_by: string | null
  category: string | null
  seller_funding_pct: number | null
  active_subscriptions: number | null
  new_subscriptions: number | null
  cancelled_subscriptions: number | null
  ss_units_shipped: number | null
  ss_revenue: number | null
  ss_discount_amount: number | null
  reorder_rate: number | null
  sns_sales_penetration: number | null
  oos_rate: number | null
  lost_sales_oos: number | null
  coupon_subscription_share: number | null
  coupon_sales_penetration: number | null
}

// INB-170 — partial/malformed S&S Performance upload guards (two independent failure modes).
// Accepts the mapped rows (report_date / date_range_end / ss_revenue read positionally).
type SnsGuardRow = Record<string, unknown>

// Guard A — MIXED WINDOW: an S&S Performance file is one reporting window; a single report_date must
// carry exactly one date_range_end. The 2026-06-22 upload (the only one in 27 pulls) bundled 20 rows
// at 2026-06-19 with a malformed 3-row tail at 2026-06-20 → the fragment INB-170 removes. Reject any
// upload where a report_date spans >1 window, naming both windows and their row counts. Zero historical
// false positives (it has happened once). Returns a message, or null if clean.
export function subscribeAndSaveMixedWindowViolation(rows: readonly SnsGuardRow[]): string | null {
  const byDate = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const rd = (r.report_date as string | null) ?? '(null)'
    const de = (r.date_range_end as string | null) ?? '(null)'
    let ends = byDate.get(rd)
    if (!ends) { ends = new Map(); byDate.set(rd, ends) }
    ends.set(de, (ends.get(de) ?? 0) + 1)
  }
  const label = (de: string) => (de === '(null)' ? 'missing reporting window' : de) // INB-170: readable sentinel
  for (const [rd, ends] of byDate) {
    if (ends.size > 1) {
      const parts = [...ends.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([de, n]) => `${label(de)} (${n} rows)`).join(', ')
      return `report_date ${rd} carries ${ends.size} reporting windows — one file = one window: ${parts}.`
    }
  }
  return null
}

// Guard B — NULL-REVENUE: a standalone all-null / predominantly-null file is a malformed or partial
// export (the fragment as its own file, or a truncated pull). Reject when EVERY row has null ss_revenue,
// or when null-revenue rows exceed 50% of the file. NOT a row-count rule (a small legit pull is valid):
// worst legitimate case is 3 of 18 = 16.7% null; the fragment is 3 of 3 = 100% — 50% sits cleanly
// between. Returns a message, or null if clean.
export function subscribeAndSaveNullRevenueViolation(rows: readonly SnsGuardRow[]): string | null {
  const total = rows.length
  if (total === 0) return null
  const nullRev = rows.filter(r => r.ss_revenue == null).length
  if (nullRev === total || nullRev / total > 0.5) {
    const pct = Math.round((100 * nullRev) / total)
    return `${nullRev}/${total} rows (${pct}%) have null ss_revenue — a file this empty of revenue is a malformed or partial export.`
  }
  return null
}

// Guard C (INB-174) — ZEROED BALANCE detector. "Period End Subscription Balance" broke two weeks
// running, landing rows with active_subscriptions = 0. When >50% of rows are zero (or null) the balance
// column is broken — but UNLIKE the reject guards A/B, the rest of the file is good (per-SKU
// revenue/units/penetration intact) and it has broken two consecutive weeks and may continue. So this is
// NOT a 400: the route STORES the file, NULLs active_subscriptions on every row (NULL renders as a gap;
// 0 renders as a false cliff — the actual harm), warns, and logs it partial. NOT an all-zero rule — the
// 2026-08-28 pull is 5 of 22 non-zero (77% zero) and an all-zero rule would pass it. Worst legitimate is
// 3 of 23 = 13% (the 2026-05-07 low-subs anomaly); the two broken pulls are 77% and 100%, so 50%
// separates cleanly. Nulls count as zero — the column is nullable, so a future blank-balance export
// would be null and slip past a `=== 0` test. Returns a warning message, or null if the balance is fine.
export function subscribeAndSaveZeroBalanceWarning(rows: readonly SnsGuardRow[]): string | null {
  const total = rows.length
  if (total === 0) return null
  const zero = rows.filter(r => r.active_subscriptions === 0 || r.active_subscriptions == null).length
  if (zero / total > 0.5) {
    const pct = Math.round((100 * zero) / total)
    return `${zero}/${total} rows (${pct}%) have active_subscriptions = 0 or null — Period End Subscription Balance appears broken.`
  }
  return null
}

export function mapSubscribeAndSave(row: RawRow, brandId: string, context?: MapperContext): SubscribeAndSaveRow {
  const get = makeGetter(row)

  return {
    brand_id: brandId,
    _asin: get('', 'ASIN', 'asin'),

    report_date:    parseDate(get('', 'Reporting Period Start', 'Date', 'date', 'report_date', 'month')),
    date_range_end: parseDate(get('', 'Reporting Period End',   'date_range_end')),

    sku:          get('', 'SKU',          'sku'),  // INB-151: key column, NOT NULL DEFAULT ''
    fulfilled_by: get(null as unknown as string, 'Fulfilled by', 'fulfilled_by') || null,
    category:     get(null as unknown as string, 'Category',     'category')     || null,

    seller_funding_pct: parseNumeric(get('', 'Seller Funding %', 'seller_funding_pct')),

    // "Period End Subscription Balance" is a decimal in the file (e.g. 13638.0) — round to integer.
    active_subscriptions: parseInteger(get('', 'Period End Subscription Balance', 'Active Subscriptions', 'active_subscriptions', 'active_subscribers')),

    // Not present in the Amazon S&S export — kept in schema for other data sources.
    new_subscriptions:      null,
    cancelled_subscriptions: null,
    ss_discount_amount:     null,
    reorder_rate:           null,

    // "SnS shipped units" is a decimal in the file (e.g. 6495.5) — round to integer.
    ss_units_shipped: parseInteger(get('', 'SnS shipped units', 'Units Shipped', 'ss_units_shipped')),
    ss_revenue:       parseNumeric(get('', 'SnS Sales',         'Revenue',       'ss_revenue')),

    // Decimal format (0–1 range): 0.4035 = 40.35%. parseFloat handles scientific notation (e.g. 2.0E-4).
    sns_sales_penetration:    parseNumeric(get('', 'SnS Sales Penetration %',               'sns_sales_penetration')),
    oos_rate:                 parseNumeric(get('', 'Not delivered due to OOS %',             'oos_rate')),
    lost_sales_oos:           parseNumeric(get('', 'Lost Sales due to OOS',                  'lost_sales_oos')),
    coupon_subscription_share: parseNumeric(get('', 'Share of coupon driven Subscriptions', 'coupon_subscription_share')),
    coupon_sales_penetration:  parseNumeric(get('', 'Coupon Sales Penetration',              'coupon_sales_penetration')),
  }
}
