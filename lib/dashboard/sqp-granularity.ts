// INB-143 — derive the SQP volume unit from report_date spacing.
//
// search_query_performance carries no granularity column: monthly periods
// (May 2025 – Apr 2026) then weekly from May 2026, distinguishable only by
// report_date spacing. The Search Intelligence header must label volume
// figures with the cadence of the rows actually averaged into them — and must
// omit the unit entirely (null) rather than claim a cadence the data can't
// prove (mixed monthly+weekly window, undeterminable spacing, no data).

export type SqpVolumeUnit = 'wk' | 'mo'

const DAY_MS = 86_400_000
// Weekly spacing is 7d, monthly 28–31d: ≤13d classifies as weekly.
const WEEKLY_MAX_GAP_DAYS = 13

function gapDays(a: string, b: string): number {
  return Math.abs(Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS
}

/**
 * Classify the cadence of the SQP report_dates inside [windowStart, windowEnd].
 *
 * @param allDates ALL distinct SQP report_dates for the brand, ascending
 *                 (the get_report_date_coverage RPC output) — the full
 *                 sequence, so a single-date window still resolves via the
 *                 gap to its nearest neighbor outside the window.
 * @returns 'wk' | 'mo' when every in-window date classifies the same way
 *          (min gap to a full-sequence neighbor: ≤13d → wk, ≥14d → mo);
 *          null when the window is empty, mixed, or has no measurable gap.
 */
export function deriveSqpVolumeUnit(
  allDates: string[],
  windowStart: string,
  windowEnd: string,
): SqpVolumeUnit | null {
  const units = new Set<SqpVolumeUnit>()
  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i]
    if (d < windowStart || d > windowEnd) continue
    const prevGap = i > 0 ? gapDays(allDates[i - 1], d) : Infinity
    const nextGap = i < allDates.length - 1 ? gapDays(d, allDates[i + 1]) : Infinity
    const minGap = Math.min(prevGap, nextGap)
    if (!Number.isFinite(minGap)) continue // lone date in the table — unmeasurable
    units.add(minGap <= WEEKLY_MAX_GAP_DAYS ? 'wk' : 'mo')
  }
  return units.size === 1 ? units.values().next().value! : null
}
