import type { MappedRow, RawRow, MapperContext } from './types'
import { norm, parseNumeric } from './types'

// INB-144 — S&S Dashboard daily exports (5 files) → long format.
// Each file shares col 1 `calc_date_granularity` and carries two value columns (a CY metric
// and its LY twin). The mapper unpivots each present metric column into one {metric, value}
// row, so five files never contend over a wide row.
//
// SNS_DAILY_SLUG_MAP (normalized-header → slug) is the SINGLE SOURCE OF TRUTH for both the
// unpivot here AND the route's strict-mapping guard: detection is greedy (any file with
// calc_date_granularity), so a column absent from this map is REJECTED upstream rather than
// silently dropped (guards against Amazon renaming/adding a dashboard column).

export const SNS_DAILY_SLUG_MAP: Record<string, string> = {
  reorder_custom:                                 'reorder_sales',
  subscribe_save_custom:                          'sns_sales',
  reorder_rate_custom:                            'reorder_rate',
  subscribe_and_save_custom:                      'sns_sales_share',
  active_subscriptions_custom:                    'active_subscriptions',
  last_year_active_subscriptions_custom:          'active_subscriptions_ly',
  coupon_sales_share_custom:                      'coupon_sales_share',
  last_year_coupon_sales_share_custom:            'coupon_sales_share_ly',
  share_of_coupon_subscriptions_custom:           'coupon_subs_share',
  last_year_share_of_coupon_subscriptions_custom: 'coupon_subs_share_ly',
}

const DATE_COL = 'calc_date_granularity'

// Original names of any non-date column absent from the slug map. [] = every column mapped.
export function unmappedSnsDailyColumns(headers: string[]): string[] {
  return headers.filter(h => {
    const n = norm(h)
    return n !== DATE_COL && !(n in SNS_DAILY_SLUG_MAP)
  })
}

export function mapSnsDashboardDaily(row: RawRow, brandId: string, _context?: MapperContext): MappedRow[] {
  // calc_date_granularity = "YYYY-MM-DD 00:00:00" — slice to date deterministically
  // (avoids parseDate's timezone-dependent last resort on the timestamp form).
  let metricDate: string | null = null
  for (const [k, v] of Object.entries(row)) {
    if (norm(k) === DATE_COL) {
      const d = String(v ?? '').trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) metricDate = d
      break
    }
  }
  if (!metricDate) return []

  const out: MappedRow[] = []
  for (const [k, v] of Object.entries(row)) {
    const slug = SNS_DAILY_SLUG_MAP[norm(k)]
    if (!slug) continue
    out.push({ brand_id: brandId, metric_date: metricDate, metric: slug, value: parseNumeric(String(v ?? '')) })
  }
  return out
}
