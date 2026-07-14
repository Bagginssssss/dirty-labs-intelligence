import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, norm, parseNumeric } from './types'

// INB-144 — S&S Dashboard trailing-window snapshots (3 files) → one shared table.
// No date column: snapshot_date comes from the upload form (context.date_range_start),
// today-fallback (SmartScout pattern). Each file is discriminated by its distinctive first
// column and stored as {report, dim1, dim2, value}:
//   subscriber_ltv        — dim1 = customer segment, dim2 = purchase type
//   avg_reorders          — dim1 = is_subscriber
//   subscriber_retention  — dim1 = metric name (30 Days / 90 Days)

export function mapSnsDashboardSnapshots(row: RawRow, brandId: string, context?: MapperContext): MappedRow[] {
  const get = makeGetter(row)
  const snapshotDate = context?.date_range_start || new Date().toISOString().slice(0, 10)
  const present = (normKey: string) => Object.keys(row).some(k => norm(k) === normKey)

  let report: string
  let dim1: string
  let dim2 = ''
  let value: number | null

  if (present('calc_customer_segment')) {
    report = 'subscriber_ltv'
    dim1 = get('', 'calc_customer_segment')
    dim2 = get('', 'calc_purchase_type')
    value = parseNumeric(get('', 'avg_gms (AVG)', 'avg_gms'))
  } else if (present('calc_is_subscriber')) {
    report = 'avg_reorders'
    dim1 = get('', 'calc_is_subscriber')
    value = parseNumeric(get('', 'calc_avg_reorder (CUSTOM)', 'calc_avg_reorder'))
  } else if (present('calc_metric_name')) {
    report = 'subscriber_retention'
    dim1 = get('', 'calc_metric_name')
    value = parseNumeric(get('', 'calc_retention (CUSTOM)', 'calc_retention'))
  } else {
    return [] // unrecognized snapshot shape (detector shouldn't route here)
  }

  if (!dim1) return [] // blank dimension row → drop
  return [{ brand_id: brandId, snapshot_date: snapshotDate, report, dim1, dim2, value }]
}
