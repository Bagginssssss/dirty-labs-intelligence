// INB-178 Phase 2 — global conventions (query plan v1.2 §A). Defined ONCE, imported by every section.
//
// The whole point of this module: ROAS (and every other base) is defined here and NOWHERE else, so no
// section can quietly redefine a base mid-report. Most reconciliation failures come from mixing bases.

export const BRAND_ID = '47a96175-ed58-4104-a2ff-c925d6143309'

// Revenue basis — ordered_product_sales, never shipped_product_sales.
export const REVENUE_COLUMN = 'ordered_product_sales'
// Ad attribution — sales_7d, never sales_click (null on all SP rows; SB/SBV only from March 2026).
export const AD_SALES_COLUMN = 'sales_7d'
// Ad types — SP, SB, SBV only. No Sponsored Display exists in the data.
export const AD_TYPES = ['SP', 'SB', 'SBV']

// Coverage windows (query plan §C, corrected). August end dates differ BY SOURCE — every August figure
// is labeled with its own end date; do not let one August column imply another's completeness.
//
// sp_targeting_report and sp_search_term_report are DIFFERENT tables with DIFFERENT SB/SBV coverage —
// do NOT collapse them: targeting has SP+SB+SBV from 2026-03-01; the search-term report has SP from
// 2026-03-01 but SB/SBV only from 2026-05-01. (The query plan originally carried the 2026-05-01 date on
// the targeting row by mistake; verified against prod — targeting has 1,411 SB + 4,891 SBV rows in
// March 2026.)
export const COVERAGE = {
  business_report_daily: { start: '2025-05-01', end: '2026-08-29' },
  sp_campaign: { sp_start: '2025-05-01', sbsbv_start: '2026-03-01', end: '2026-08-29' },
  sp_targeting: { start: '2026-03-01', sbsbv_start: '2026-03-01', end: '2026-08-29' },
  sp_search_term: { start: '2026-03-01', sbsbv_start: '2026-05-01', end: '2026-08-29' },
}
// SB/SBV coverage begins here for the campaign table (sp_campaign_performance) — before this date,
// all-types spend == SP-only spend by construction. (Same date for sp_targeting; NOT sp_search_term.)
export const SBSBV_START = '2026-03-01'

// ── Metric definitions — SUM over the period, THEN divide. NEVER the average of daily ratios. ──
// Each takes pre-summed inputs, so "sum first" is structural rather than a rule to remember. Guarded
// denominators return null (not 0, not NaN) so an absent period is distinguishable from a real zero.
export function roas(salesSum, spendSum) { return spendSum > 0 ? salesSum / spendSum : null }
export function acos(spendSum, salesSum) { return salesSum > 0 ? spendSum / salesSum : null }
export function tacos(spendSum, revenueSum) { return revenueSum > 0 ? spendSum / revenueSum : null }
export function conversion(unitsSum, sessionsSum) { return sessionsSum > 0 ? unitsSum / sessionsSum : null }
export function dailyRate(total, days) { return days > 0 ? total / days : null }

// Calendar length of a month, for the day-count audit (calendar vs the DISTINCT report_date count the
// section actually observes). The daily rate uses observed days, never this — Aug is 29 observed days.
export function calendarDaysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

// Sum a numeric column across rows, coercing null → 0. Full precision (no rounding — display concern).
export function sumBy(rows, key) {
  let s = 0
  for (const r of rows) s += Number(r[key] ?? 0)
  return s
}

// ── Reconciliation tolerance ──────────────────────────────────────────────────────────────────────
// ordered_product_sales and spend are Postgres numeric; JS Number accumulation over tens of thousands
// of rows drifts by fractions of a cent. Currency comparisons allow $0.01 of float noise. Unit / order /
// session counts are integers and must match EXACTLY. A difference above tolerance is a real
// disagreement — stop and report, never adjust a query toward the expected number.
export const TOLERANCE = { currency: 0.01, count: 0 }

// Compare two numbers against the tolerance for `kind` ('currency' | 'count'). Returns
// { pass, diff, tol }. `count` uses exact equality (tol 0).
export function reconcile(actual, expected, kind) {
  const tol = kind === 'count' ? TOLERANCE.count : TOLERANCE.currency
  const diff = actual - expected
  return { pass: Math.abs(diff) <= tol, diff, tol }
}
