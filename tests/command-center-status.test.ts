// INB-147 — coverage-driven tile status derivation (pure).
//
// Status is computed from registry cadence + report_coverage (never source tables).
// A weekly report is CURRENT only when the expected week is present AND fully pulled
// (data_through ≥ its Saturday − tolerance); a partial week falls to due/overdue.
// Event-driven reports (bid log + rule change logs) key off UPLOAD RECENCY, not
// coverage continuity — their quiet weeks are normal, so gaps never escalate them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStatus, relTimeLabel, freshnessLine, COVERAGE_WINDOW_DAYS } from '../lib/command-center/status.ts'
import { addDays } from '../lib/upload-tracker/gaps.ts'
import type { CoverageEnd } from '../lib/command-center/types.ts'

const TODAY = '2026-07-10' // Friday; most recent completed Saturday = 2026-07-04

// contiguous weekly Saturdays ending at `end`, `n` of them, each FULLY pulled
// (data_through = its Saturday).
function weeklyEnds(end: string, n: number): CoverageEnd[] {
  const out: CoverageEnd[] = []
  const d = new Date(end + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    const iso = d.toISOString().slice(0, 10)
    out.push({ periodEnd: iso, periodType: 'weekly', dataThrough: iso })
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}
const snap = (periodEnd: string): CoverageEnd => ({ periodEnd, periodType: 'snapshot', dataThrough: periodEnd })
const month = (periodEnd: string): CoverageEnd => ({ periodEnd, periodType: 'monthly', dataThrough: periodEnd })
const week = (periodEnd: string): CoverageEnd => ({ periodEnd, periodType: 'weekly', dataThrough: periodEnd })

const base = { mode: 'weekly' as const, isActive: true, eventDriven: false, lastUploadAt: null as string | null, today: TODAY }

test('weekly current: expected Saturday covered & fully pulled, no hole', () => {
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', coverageEnds: weeklyEnds('2026-07-04', 10) }), 'current')
})

test('weekly partial: expected week present but data_through short → due (within grace)', () => {
  // today Monday 2026-07-06 → expected 2026-07-04 present but only pulled through 07-01.
  const ends: CoverageEnd[] = [
    ...weeklyEnds('2026-06-27', 6),
    { periodEnd: '2026-07-04', periodType: 'weekly', dataThrough: '2026-07-01' },
  ]
  assert.equal(deriveStatus({ ...base, today: '2026-07-06', cadence: 'weekly', coverageEnds: ends }), 'due')
})

test('weekly partial beyond grace → overdue', () => {
  const ends: CoverageEnd[] = [
    ...weeklyEnds('2026-06-27', 6),
    { periodEnd: '2026-07-04', periodType: 'weekly', dataThrough: '2026-07-01' },
  ]
  assert.equal(deriveStatus({ ...base, today: TODAY, cadence: 'weekly', coverageEnds: ends }), 'overdue')
})

test('weekly tolerance: data_through = Saturday − 1 (Friday) still counts as current', () => {
  const ends: CoverageEnd[] = [
    ...weeklyEnds('2026-06-27', 6),
    { periodEnd: '2026-07-04', periodType: 'weekly', dataThrough: '2026-07-03' }, // Friday
  ]
  assert.equal(deriveStatus({ ...base, today: '2026-07-06', cadence: 'weekly', coverageEnds: ends }), 'current')
})

test('weekly due: expected uncovered but within grace (Monday)', () => {
  assert.equal(
    deriveStatus({ ...base, today: '2026-07-06', cadence: 'weekly', coverageEnds: weeklyEnds('2026-06-27', 6) }),
    'due',
  )
})

test('weekly overdue: expected uncovered beyond grace', () => {
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', coverageEnds: weeklyEnds('2026-06-27', 6) }), 'overdue')
})

test('weekly behind: an older owed week reads overdue even if the newest expected week is only 1d past', () => {
  // customer_loyalty shape at 2026-07-12: fully covered only through 06-27; 07-04 AND 07-11
  // both missing. Newest expected (07-11) is 1d past, but 07-04 has been owed 8d → overdue.
  assert.equal(
    deriveStatus({ ...base, today: '2026-07-12', cadence: 'weekly', coverageEnds: weeklyEnds('2026-06-27', 6) }),
    'overdue',
  )
})

test('weekly overdue: latest covered but a hole in the last 8 weeks', () => {
  const ends = weeklyEnds('2026-07-04', 8).filter(e => e.periodEnd !== '2026-06-20') // interior hole
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', coverageEnds: ends }), 'overdue')
})

test('monthly current: last completed month covered', () => {
  assert.equal(deriveStatus({ ...base, mode: 'monthly', cadence: 'monthly', coverageEnds: [month('2026-06-30')] }), 'current')
})

test('monthly overdue: last completed month missing beyond grace', () => {
  assert.equal(deriveStatus({ ...base, mode: 'monthly', cadence: 'monthly', coverageEnds: [month('2026-05-31')] }), 'overdue')
})

test('snapshot current: latest snapshot within freshness (weekly-cadence snapshot)', () => {
  assert.equal(deriveStatus({ ...base, mode: 'snapshot', cadence: 'snapshot_weekly', coverageEnds: [snap('2026-07-06')] }), 'current')
})

test('snapshot overdue: latest snapshot stale', () => {
  assert.equal(deriveStatus({ ...base, mode: 'snapshot', cadence: 'snapshot_weekly', coverageEnds: [snap('2026-06-10')] }), 'overdue')
})

test('snapshot with monthly cadence (S&S) tolerates a longer gap → current', () => {
  assert.equal(deriveStatus({ ...base, mode: 'snapshot', cadence: 'monthly', coverageEnds: [snap('2026-06-20')] }), 'current')
})

test('snapshot-grade coverage under a weekly-cadence report keys off recency, not Saturday membership', () => {
  assert.equal(deriveStatus({ ...base, mode: 'snapshot', cadence: 'weekly', coverageEnds: [snap('2026-07-09')] }), 'current')
})

test('event-driven current: recent activity, historical gaps IGNORED', () => {
  const ends = [week('2026-07-11'), week('2026-05-30')] // 6-week hole must NOT matter
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', eventDriven: true, coverageEnds: ends }), 'current')
})

test('event-driven overdue: no recent upload or coverage', () => {
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', eventDriven: true, coverageEnds: [week('2026-06-01')] }), 'overdue')
})

test('ad_hoc cadence → ad_hoc', () => {
  assert.equal(deriveStatus({ ...base, cadence: 'ad_hoc', coverageEnds: [] }), 'ad_hoc')
})

test('inactive report → planned (regardless of coverage)', () => {
  assert.equal(
    deriveStatus({ ...base, isActive: false, cadence: 'weekly', coverageEnds: weeklyEnds('2026-07-04', 8) }),
    'planned',
  )
})

test('freshnessLine: data_through / month / covering-window / empty', () => {
  // weekly & snapshot → "Data through {data_through}"
  assert.equal(
    freshnessLine({ mode: 'weekly', coveringWindowDays: null, latestPeriodEnd: '2026-07-11', latestPeriodLabel: 'W/E 2026-07-11', latestDataThrough: '2026-07-05' }),
    'Data through 2026-07-05',
  )
  assert.equal(
    freshnessLine({ mode: 'snapshot', coveringWindowDays: null, latestPeriodEnd: '2026-06-29', latestPeriodLabel: '2026-06-29', latestDataThrough: '2026-06-29' }),
    'Data through 2026-06-29',
  )
  // monthly → the month label (raw max-source-date is misleading for an aggregate)
  assert.equal(
    freshnessLine({ mode: 'monthly', coveringWindowDays: null, latestPeriodEnd: '2026-06-30', latestPeriodLabel: '2026-06', latestDataThrough: '2026-06-08' }),
    'Data through 2026-06',
  )
  // covering-window (S&S, 30d) → the window range
  assert.equal(
    freshnessLine({ mode: 'snapshot', coveringWindowDays: 30, latestPeriodEnd: '2026-06-03', latestPeriodLabel: '2026-06-03', latestDataThrough: '2026-06-03' }),
    'Window 2026-06-03 → 2026-07-03',
  )
  // no coverage → dash
  assert.equal(
    freshnessLine({ mode: 'weekly', coveringWindowDays: null, latestPeriodEnd: null, latestPeriodLabel: null, latestDataThrough: null }),
    '—',
  )
})

test('COVERAGE_WINDOW_DAYS reaches back far enough for an 8-month monthly strip', () => {
  // today 2026-07-12 → an 8-month strip spans Nov 2025 … Jun 2026; the bounded grid load
  // must include Nov 2025 (period_end 2025-11-30), i.e. cutoff ≤ 2025-11-01.
  const cutoff = addDays('2026-07-12', -COVERAGE_WINDOW_DAYS)
  assert.ok(cutoff <= '2025-11-01', `cutoff ${cutoff} must be ≤ 2025-11-01`)
})

test('relTimeLabel: calendar-day difference on UTC date parts (not elapsed ms)', () => {
  // The reported bug: a 2026-07-09 20:42 UTC upload must read 3d ago on 2026-07-12.
  assert.equal(relTimeLabel('2026-07-09T20:42:00.000Z', '2026-07-12'), '3d ago')
  assert.equal(relTimeLabel(null, '2026-07-12'), '—')
  assert.equal(relTimeLabel('2026-07-12T01:00:00.000Z', '2026-07-12'), 'today')
  assert.equal(relTimeLabel('2026-07-11T23:59:00.000Z', '2026-07-12'), '1d ago')
  assert.equal(relTimeLabel('2026-07-04T00:00:00.000Z', '2026-07-12'), '1w ago')
})
