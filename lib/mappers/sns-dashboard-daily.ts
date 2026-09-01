import type { MappedRow, RawRow, MapperContext } from './types'
import { parseNumeric } from './types'

// INB-144 — S&S Dashboard daily exports (5 files) → long format. Each file shares col 1
// `calc_date_granularity` and carries two value columns (a CY metric + its LY twin). The mapper
// unpivots each present metric column into one {metric, value} row.
//
// INB-167 — the per-column slug lookup used to key on norm(header), which COLLAPSES whitespace and
// `&`. Amazon shipped the Share export's "Subscribe  &  Save (CUSTOM)" (DOUBLED spaces) column, which
// normalized onto the Sales export's "Subscribe & Save (CUSTOM)" → both mapped to `sns_sales`, so the
// Share %-of-sales fraction was written into the sns_sales dollars metric. The normalization WAS the
// bug. This module is now STRICTER and PER-REPORT:
//   • Exact-header matching (BOM-strip + outer-trim only; internal whitespace + case preserved).
//   • Column→slug maps are SCOPED PER REPORT (identified by a signature column), so the same header
//     string means `sns_sales` under the Sales report and `sns_sales_share` under the Share report —
//     which survives Amazon normalizing the S&S columns to byte-identical strings (the reports stay
//     distinguishable by Reorder (CUSTOM) vs Reorder Rate (CUSTOM)).
// Header strings below are pinned by tests/fixtures/sns-daily-*.csv, built from the real export bytes.

export interface SnsDailyReport {
  reportKey: string
  // An exact header UNIQUE to this report — identifies which of the 5 daily files this is.
  signature: string
  // Exact header → metric slug, for THIS report only. Several header forms may map to one slug
  // (Amazon whitespace/word variants of the same column).
  columns: Record<string, string>
}

export const SNS_DAILY_REPORTS: SnsDailyReport[] = [
  {
    reportKey: 'sns_dashboard_sales',
    signature: 'Reorder (CUSTOM)',
    columns: {
      'Reorder (CUSTOM)': 'reorder_sales',
      'Subscribe & Save (CUSTOM)': 'sns_sales', // dollars
    },
  },
  {
    reportKey: 'sns_dashboard_reorder_share',
    signature: 'Reorder Rate (CUSTOM)',
    columns: {
      'Reorder Rate (CUSTOM)': 'reorder_rate',
      // The S&S %-of-sales column. Amazon has shipped it three ways; ALL mean sns_sales_share UNDER
      // this report (the SAME string means sns_sales under the Sales report — per-report scoping):
      'Subscribe and Save (CUSTOM)': 'sns_sales_share', // historical (word "and"); INB-144-era, not byte-confirmed (no pre-07-27 CSV on disk) — kept per the INB-167 fossil analysis
      'Subscribe  &  Save (CUSTOM)': 'sns_sales_share', // current (& with DOUBLED spaces) — the INB-167 break; byte-pinned by the fixture
      'Subscribe & Save (CUSTOM)': 'sns_sales_share',   // future-proof: if Amazon normalizes the whitespace to the single-space form
    },
  },
  {
    reportKey: 'sns_dashboard_subscription_count',
    signature: 'Active Subscriptions (CUSTOM)',
    columns: {
      'Active Subscriptions (CUSTOM)': 'active_subscriptions',
      'Last Year Active Subscriptions (CUSTOM)': 'active_subscriptions_ly',
    },
  },
  {
    reportKey: 'sns_dashboard_coupon_sales',
    signature: 'Coupon Sales Share (CUSTOM)',
    columns: {
      'Coupon Sales Share (CUSTOM)': 'coupon_sales_share',
      'Last Year Coupon Sales Share (CUSTOM)': 'coupon_sales_share_ly',
    },
  },
  {
    reportKey: 'sns_dashboard_coupon_subs',
    signature: 'Share of Coupon Subscriptions (CUSTOM)',
    columns: {
      'Share of Coupon Subscriptions (CUSTOM)': 'coupon_subs_share',
      'Last Year Share of Coupon Subscriptions  (CUSTOM)': 'coupon_subs_share_ly', // DOUBLED space before (CUSTOM)
    },
  },
  {
    // INB-173 — Coupon Driven Sales (replaces the deprecated Coupon Sales Share). Coupon-driven sales
    // dollars by coupon type. Exact-header signature "Subscribe & Save Coupon (SUM)" — byte-distinct
    // from the Sales file's "Subscribe & Save (CUSTOM)" and the Share file's doubled-space variant, so
    // no collision under exact-header matching. Reorder Coupon + Standard Coupon are 0 on every row
    // (confirmed across the 08-17/08-25/08-31 pulls) but the mapper emits a row for EVERY mapped column
    // regardless of value (see mapSnsDashboardDaily), so all three metrics get a row per date — the
    // INB-168 paired-discriminator coverage needs all three present or it intersects to a NULL cap date.
    reportKey: 'sns_dashboard_coupon_driven',
    signature: 'Subscribe & Save Coupon (SUM)',
    columns: {
      'Subscribe & Save Coupon (SUM)': 'coupon_sales_sns',
      'Reorder Coupon (SUM)': 'coupon_sales_reorder',   // 0 on every row to date — still stored
      'Standard Coupon (SUM)': 'coupon_sales_standard', // 0 on every row to date — still stored
    },
  },
]

const DATE_COL = 'calc_date_granularity'

// BOM-strip + outer-trim ONLY. Internal whitespace + case are PRESERVED — collapsing them was the
// INB-167 bug. (parseCSV already trims + BOM-strips headers, so row keys arrive in this form.)
export function snsHeaderKey(h: string): string {
  return h.replace(/^﻿/, '').trim()
}

// Which of the 5 daily reports a header set belongs to (by signature column). null if none or ≥2
// match (ambiguous) — the route then rejects the upload rather than guessing.
export function identifySnsDailyReport(headers: string[]): SnsDailyReport | null {
  const keys = new Set(headers.map(snsHeaderKey))
  const matches = SNS_DAILY_REPORTS.filter(r => keys.has(r.signature))
  return matches.length === 1 ? matches[0] : null
}

// Non-date columns not accounted for by the identified report's column map (or ALL non-date columns
// when the file can't be identified). [] = every column mapped. Detection is greedy (any file with
// calc_date_granularity is sns_dashboard_daily), so the route REJECTS on a non-empty result.
export function unmappedSnsDailyColumns(headers: string[]): string[] {
  const report = identifySnsDailyReport(headers)
  const nonDate = headers.map(snsHeaderKey).filter(h => h !== DATE_COL)
  if (!report) return nonDate
  return nonDate.filter(h => !(h in report.columns))
}

export function mapSnsDashboardDaily(row: RawRow, brandId: string, _context?: MapperContext): MappedRow[] {
  const report = identifySnsDailyReport(Object.keys(row))
  if (!report) return [] // unidentifiable → no rows; the route's unmapped/guard checks reject it

  // calc_date_granularity = "YYYY-MM-DD 00:00:00" — slice to date deterministically.
  let metricDate: string | null = null
  for (const [k, v] of Object.entries(row)) {
    if (snsHeaderKey(k) === DATE_COL) {
      const d = String(v ?? '').trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) metricDate = d
      break
    }
  }
  if (!metricDate) return []

  const out: MappedRow[] = []
  for (const [k, v] of Object.entries(row)) {
    const slug = report.columns[snsHeaderKey(k)]
    if (!slug) continue
    out.push({ brand_id: brandId, metric_date: metricDate, metric: slug, value: parseNumeric(String(v ?? '')) })
  }
  return out
}

// INB-167 value-range guard: sns_sales is dollars (≥ 1); sns_sales_share is a fraction (≤ 1). A
// violation means a column was mis-routed (the exact class of the doubled-space collapse). Fail
// loudly at upload — same posture as the INB-166 item-4 null-key guard. Nulls are ignored.
export function snsDailyRangeViolations(mappedRows: MappedRow[]): string[] {
  const bad: string[] = []
  for (const r of mappedRows) {
    const v = r.value as number | null
    if (v == null) continue
    if (r.metric === 'sns_sales' && v < 1) {
      bad.push(`sns_sales=${v} on ${r.metric_date} (< 1 — expected dollars; a %-share column may be mis-routed here)`)
    }
    if (r.metric === 'sns_sales_share' && v > 1) {
      bad.push(`sns_sales_share=${v} on ${r.metric_date} (> 1 — expected a fraction; a dollar column may be mis-routed here)`)
    }
  }
  return bad
}
