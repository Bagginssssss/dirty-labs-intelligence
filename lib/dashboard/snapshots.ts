// Latest-covered-day snapshot selection for stock metrics (INB-138).
//
// derived_metrics_daily.ss_active_subscriptions is a point-in-time balance
// carried from the covering S&S period (INB-136). A day with 0 is simply not
// covered by any period yet (e.g. the day after the latest window ends), so
// "latest" must mean the latest day WITH a value — naive max(metric_date) would
// read the trailing uncovered zero. Never sum this column: it is a stock, not a
// flow.

export interface ActiveSubsRow {
  metric_date: string
  ss_active_subscriptions: number | null
}

// MoM between two snapshots. Defined only when BOTH are present: a window with
// no covered day yields snapshot 0, and (0 − prior)/prior would render a fake
// "−100%" next to a '—' value (the July-MTD defect). Null = "first snapshot",
// matching the sibling S&S cards.
export function snapshotMoM(current: number, prior: number): number | null {
  return current > 0 && prior > 0 ? (current - prior) / prior : null
}

export function latestCoveredActiveSubs(rows: ActiveSubsRow[]): number {
  let bestDate = ''
  let bestValue = 0
  for (const r of rows) {
    const value = Number(r.ss_active_subscriptions) || 0
    if (value > 0 && r.metric_date > bestDate) {
      bestDate = r.metric_date
      bestValue = value
    }
  }
  return bestValue
}
