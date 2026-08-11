import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, norm, parseNumeric } from './types'

// INB-144 — S&S Dashboard trailing-window snapshots → one shared table.
// No date column: snapshot_date comes from the upload form (context.date_range_start),
// today-fallback (SmartScout pattern). Each file is discriminated by its distinctive first
// column and stored as {report, dim1, dim2, value}:
//   subscriber_ltv        — dim1 = customer segment, dim2 = purchase type
//   avg_reorders          — dim1 = is_subscriber
//   subscriber_retention  — dim1 = metric name (30 Days / 90 Days)
//   deliveries_breakdown  — dim1 = delivery-count segment (INB-164; shipped revenue, absolute dollars)

// INB-164 — Amazon permanently relabeled the avg_reorders buckets Subscribers/Non-subscribers →
// Subscriber/Non-subscriber (between the 07-27 and 08-04 snapshots). Canonicalize so a re-upload
// upserts onto ONE label instead of splitting the report across two variants.
// SCOPED to avg_reorders ONLY — a flat global canon would rewrite subscriber_ltv's 'Non-Subscriber'
// (capital S) to 'Non-subscriber', changing its uq key so every future LTV upload INSERTs (40→42→44).
const AVG_REORDERS_LABEL_CANON: Record<string, string> = {
  'subscribers': 'Subscriber', 'subscriber': 'Subscriber',
  'non-subscribers': 'Non-subscriber', 'non-subscriber': 'Non-subscriber',
}

// INB-164 — Sales by Number of Deliveries. The bucket list is OPEN (Amazon has widened it before),
// so labels are stored VERBATIM and never enum-validated. This set only drives a non-blocking
// warning on an unseen label — it never drops a row (a fixed list would silently lose a new bucket).
const KNOWN_DELIVERY_SEGMENTS = new Set([
  'Cancelled subscriptions after 1 delivery',
  'Active subscriptions with 1 delivery',
  'Subscriptions with 2 deliveries',
  'Subscriptions with 3 deliveries',
  'Subscriptions with 4 deliveries',
  'Subscriptions with 5+ deliveries',
])

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
    dim1 = get('', 'calc_customer_segment').trim()
    // INB-172 — dim2 is part of uq_sns_dashboard_snapshots; trim it (like dim1) so a padded
    // purchase-type can't form a different uq key and silently INSERT a duplicate. No current
    // export has padded values → byte-identical output today; this is defensive.
    dim2 = get('', 'calc_purchase_type').trim()
    value = parseNumeric(get('', 'avg_gms (AVG)', 'avg_gms'))
  } else if (present('calc_is_subscriber')) {
    report = 'avg_reorders'
    // INB-164 — canonicalize the relabeled bucket (Subscribers→Subscriber, Non-subscribers→
    // Non-subscriber). SCOPED here: applying it globally would rewrite subscriber_ltv's
    // 'Non-Subscriber' (capital S) and fracture that report's uq key on every future upload.
    const raw = get('', 'calc_is_subscriber').trim()
    dim1 = AVG_REORDERS_LABEL_CANON[raw.toLowerCase()] ?? raw
    value = parseNumeric(get('', 'calc_avg_reorder (CUSTOM)', 'calc_avg_reorder'))
  } else if (present('calc_metric_name')) {
    report = 'subscriber_retention'
    dim1 = get('', 'calc_metric_name').trim()
    value = parseNumeric(get('', 'calc_retention (CUSTOM)', 'calc_retention'))
  } else if (present('subs_state_delivery_segment')) {
    report = 'deliveries_breakdown'
    dim1 = get('', 'subs_state_delivery_segment').trim()
    value = parseNumeric(get('', 'shipped_revenue (SUM)', 'shipped_revenue'))
    if (dim1 && !KNOWN_DELIVERY_SEGMENTS.has(dim1)) {
      console.warn(`[sns deliveries] unseen delivery segment '${dim1}' — stored verbatim (open bucket list)`)
    }
  } else {
    return [] // unrecognized snapshot shape (detector shouldn't route here)
  }

  if (!dim1) return [] // blank dimension row → drop
  return [{ brand_id: brandId, snapshot_date: snapshotDate, report, dim1, dim2, value }]
}
