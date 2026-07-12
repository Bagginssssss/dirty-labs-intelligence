// Cadence bucketing for report coverage (INB-146).
//
// Turns a report's distinct data dates into the PRESENT period records INB-147's
// tiles render. Reuses the period conventions already proven in the upload tracker
// (lib/upload-tracker/gaps.ts): weekly periods are Saturday-ending (Sun–Sat, start =
// end − 6), the platform's period-END convention (SQP + customer_loyalty anchors are
// native Saturdays); the monthly→weekly mixed-cadence split reuses findWeeklyCutover
// so a report with monthly-era history (SQP: 12 month-end rows before it went weekly)
// yields `monthly` records for the era and `weekly` records after — never fabricated
// weekly coverage.

import { addDays, daysBetween, findWeeklyCutover } from '@/lib/upload-tracker/gaps'

export type CoverageMode = 'weekly' | 'monthly' | 'snapshot'

export type CoveragePeriod = {
  period_start: string
  period_end: string
  period_label: string
  period_type: 'weekly' | 'monthly' | 'snapshot'
  data_through: string // max source date within the period (INB-147)
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

// The Saturday that ENDS the Sun–Sat week containing `d` (itself when d is a Saturday).
function weekEndSaturday(d: string): string {
  const dow = new Date(d + 'T00:00:00Z').getUTCDay() // Sun=0 … Sat=6
  return addDays(d, (6 - dow + 7) % 7)
}

// Last calendar day of the month `ym` ("YYYY-MM").
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) // day 0 of next month
}

// section is sorted ascending, so the last date written per bucket is its max
// (data_through = how far the source data reaches inside the period).
function monthlyPeriods(section: string[]): CoveragePeriod[] {
  const maxByYm = new Map<string, string>()
  for (const d of section) maxByYm.set(d.slice(0, 7), d)
  return [...maxByYm.keys()].sort().map(ym => ({
    period_start: `${ym}-01`,
    period_end: monthEnd(ym),
    period_label: ym,
    period_type: 'monthly' as const,
    data_through: maxByYm.get(ym)!,
  }))
}

function weeklyPeriods(section: string[]): CoveragePeriod[] {
  const maxByEnd = new Map<string, string>()
  for (const d of section) maxByEnd.set(weekEndSaturday(d), d)
  return [...maxByEnd.keys()].sort().map(end => ({
    period_start: addDays(end, -6),
    period_end: end,
    period_label: `W/E ${end}`,
    period_type: 'weekly' as const,
    data_through: maxByEnd.get(end)!,
  }))
}

// True only when `section` is a genuine monthly ERA: ≥2 dates, each ~a month apart
// (≥20d). findWeeklyCutover returns sorted.length ("all monthly") whenever there is no
// sub-14-day gap anywhere — which is ALSO the case for a single weekly anchor or a
// dense daily prefix after a >14d outage. Requiring ≥2 genuinely month-spaced dates
// keeps those in the weekly section (a lone weekly upload must not become a month).
function isMonthlyEra(section: string[]): boolean {
  if (section.length < 2) return false
  for (let i = 1; i < section.length; i++) {
    if (daysBetween(section[i - 1], section[i]) < 20) return false
  }
  return true
}

// Distinct present periods for `dates` at the given grain. Input dates are 'YYYY-MM-DD'
// (callers slice timestamps to date first). Future dates are stripped (Amazon stores a
// projected period-end for an incomplete period), matching the tracker.
export function datesToPeriods(dates: string[], mode: CoverageMode): CoveragePeriod[] {
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...new Set(dates.filter(d => ISO.test(d) && d <= today))].sort()
  if (sorted.length === 0) return []

  if (mode === 'snapshot') {
    return sorted.map(d => ({
      period_start: d,
      period_end: d,
      period_label: d,
      period_type: 'snapshot' as const,
      data_through: d,
    }))
  }

  if (mode === 'monthly') return monthlyPeriods(sorted)

  // weekly (mixed-cadence aware)
  let cutover = findWeeklyCutover(sorted)
  if (!isMonthlyEra(sorted.slice(0, cutover))) cutover = 0
  return [...monthlyPeriods(sorted.slice(0, cutover)), ...weeklyPeriods(sorted.slice(cutover))]
}
