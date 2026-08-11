// INB-168 — rebuild-path intersection resolution for AND-paired discriminators.
//
// get_coverage_dates unions dates across a report's discriminator values. For reports whose
// discriminator values are CO-EMITTED metrics that must ALL be present (the sns_dashboard_daily
// pairs — flagged `pairedDiscriminator` in COVERAGE_CONFIG), the union OVERSTATES coverage when one
// metric goes stale while its sibling keeps landing: the tile goes green over a half-dead report
// (the frozen reorder_share canary that had to be manually undone during INB-166's G2). This resolves
// such a report to the INTERSECTION-style answer instead:
//
//     data_through = min( max(date) ) over the discriminator values
//
// i.e. the report is only current through the date by which its LAGGING half last had data.
// Under-reporting is the correct error direction — a report whose half is dead is not current.
//
// REBUILD PATH ONLY (scripts/inb146-backfill.mjs). The post-upload path (lib/coverage/maintain.ts) is
// unchanged: it writes coverage from the dates a single upload actually carried, which cannot diverge
// (both paired metrics arrive in the same file). This only re-derives history from the fact tables.
//
// NOT applied to the SB/SBV ad_type pairs: those sub-types are alternatives rolled into one report and
// legitimately arrive on different dates, so union is correct there (intersection would falsely
// under-report a day that had only one sub-type). Only sns_dashboard_daily carries the flag.

export type PairedDivergence = {
  level: 'none' | 'info' | 'warn'
  gapDays: number            // max(perValueMax) − min(perValueMax); Infinity if a value has no data
  laggingValues: string[]    // discriminator values whose max date is behind the newest (or empty)
}

export type PairedResolution = {
  dates: string[]                          // union dates, capped at min(max per value)
  capDate: string | null                   // min over values of that value's max date; null if any value empty
  perValueMax: Record<string, string | null>
  divergence: PairedDivergence
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

// perValueDates: discriminator value → its distinct 'YYYY-MM-DD' dates (any order; the RPC returns
// them sorted, but this does not assume it). intervalDays: one pull interval for the report's cadence
// (7 for weekly). Divergence emits `info` at ANY non-zero gap and `warn` above one pull interval, so a
// week-one 6-day gap surfaces rather than passing silently until it exceeds the threshold.
export function resolvePairedCoverage(
  perValueDates: Record<string, string[]>,
  intervalDays: number,
): PairedResolution {
  const values = Object.keys(perValueDates)
  const perValueMax: Record<string, string | null> = {}
  for (const v of values) {
    const ds = perValueDates[v]
    perValueMax[v] = ds.length ? [...ds].sort()[ds.length - 1] : null
  }

  // Any value with no data at all → the report is not fully covered through any date.
  const emptyValues = values.filter(v => perValueMax[v] == null)
  if (emptyValues.length > 0) {
    return {
      dates: [],
      capDate: null,
      perValueMax,
      divergence: { level: 'warn', gapDays: Infinity, laggingValues: emptyValues },
    }
  }

  const maxes = values.map(v => perValueMax[v] as string).sort()
  const capDate = maxes[0]                        // min(max) — the earliest "last date"
  const newest = maxes[maxes.length - 1]
  const gapDays = daysBetween(capDate, newest)
  const laggingValues = values.filter(v => (perValueMax[v] as string) < newest)

  const union = [...new Set(values.flatMap(v => perValueDates[v]))].sort()
  const dates = union.filter(d => d <= capDate)  // truncate the union at the lagging half's last date

  const level: PairedDivergence['level'] = gapDays > intervalDays ? 'warn' : gapDays > 0 ? 'info' : 'none'
  return { dates, capDate, perValueMax, divergence: { level, gapDays, laggingValues } }
}

// One pull interval in days for a coverage mode (drives the warn/info divergence threshold).
export function pullIntervalDays(mode: string): number {
  return mode === 'monthly' ? 31 : mode === 'weekly' ? 7 : 1
}
