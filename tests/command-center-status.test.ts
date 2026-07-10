// INB-147 — coverage-driven tile status derivation (pure).
//
// Status is computed from registry cadence + report_coverage (never source tables).
// Event-driven reports (bid log + rule change logs) key off UPLOAD RECENCY, not
// coverage continuity — their quiet weeks are normal, so gaps never escalate them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStatus } from '../lib/command-center/status.ts'

const TODAY = '2026-07-10' // Friday; most recent completed Saturday = 2026-07-04

// contiguous weekly Saturdays ending at `end`, `n` of them, as weekly coverage ends
function weeklyEnds(end: string, n: number): { periodEnd: string; periodType: 'weekly' }[] {
  const out: { periodEnd: string; periodType: 'weekly' }[] = []
  const d = new Date(end + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    out.push({ periodEnd: d.toISOString().slice(0, 10), periodType: 'weekly' })
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}

const base = { mode: 'weekly' as const, isActive: true, eventDriven: false, lastUploadAt: null as string | null, today: TODAY }

test('weekly current: expected Saturday covered, no hole', () => {
  assert.equal(
    deriveStatus({ ...base, cadence: 'weekly', coverageEnds: weeklyEnds('2026-07-04', 10) }),
    'current',
  )
})

test('weekly due: expected uncovered but within grace (Monday)', () => {
  // today Monday 2026-07-06 → expected 2026-07-04, daysPast 2 ≤ 3
  assert.equal(
    deriveStatus({ ...base, today: '2026-07-06', cadence: 'weekly', coverageEnds: weeklyEnds('2026-06-27', 6) }),
    'due',
  )
})

test('weekly overdue: expected uncovered beyond grace', () => {
  // today Friday 2026-07-10 → expected 07-04 missing (latest 06-27), daysPast 6 > 3
  assert.equal(
    deriveStatus({ ...base, cadence: 'weekly', coverageEnds: weeklyEnds('2026-06-27', 6) }),
    'overdue',
  )
})

test('weekly overdue: latest covered but a hole in the last 8 weeks', () => {
  const ends = weeklyEnds('2026-07-04', 8).filter(e => e.periodEnd !== '2026-06-20') // interior hole
  assert.equal(deriveStatus({ ...base, cadence: 'weekly', coverageEnds: ends }), 'overdue')
})

test('monthly current: last completed month covered', () => {
  assert.equal(
    deriveStatus({ ...base, mode: 'monthly', cadence: 'monthly', coverageEnds: [{ periodEnd: '2026-06-30', periodType: 'monthly' }] }),
    'current',
  )
})

test('monthly overdue: last completed month missing beyond grace', () => {
  assert.equal(
    deriveStatus({ ...base, mode: 'monthly', cadence: 'monthly', coverageEnds: [{ periodEnd: '2026-05-31', periodType: 'monthly' }] }),
    'overdue',
  )
})

test('snapshot current: latest snapshot within freshness (weekly-cadence snapshot)', () => {
  assert.equal(
    deriveStatus({ ...base, mode: 'snapshot', cadence: 'snapshot_weekly', coverageEnds: [{ periodEnd: '2026-07-06', periodType: 'snapshot' }] }),
    'current',
  )
})

test('snapshot overdue: latest snapshot stale', () => {
  assert.equal(
    deriveStatus({ ...base, mode: 'snapshot', cadence: 'snapshot_weekly', coverageEnds: [{ periodEnd: '2026-06-10', periodType: 'snapshot' }] }),
    'overdue',
  )
})

test('snapshot with monthly cadence (S&S) tolerates a longer gap → current', () => {
  // latest 2026-06-20, today 2026-07-10 → 20 days; monthly-cadence snapshot freshDays 35
  assert.equal(
    deriveStatus({ ...base, mode: 'snapshot', cadence: 'monthly', coverageEnds: [{ periodEnd: '2026-06-20', periodType: 'snapshot' }] }),
    'current',
  )
})

test('snapshot-grade coverage under a weekly-cadence report keys off recency, not Saturday membership', () => {
  // rule_assignments shape: cadence 'weekly', but a single fresh snapshot (uploaded yesterday).
  assert.equal(
    deriveStatus({ ...base, mode: 'snapshot', cadence: 'weekly', coverageEnds: [{ periodEnd: '2026-07-09', periodType: 'snapshot' }] }),
    'current',
  )
})

test('event-driven current: recent activity, historical gaps IGNORED', () => {
  // Sparse coverage with a big hole, but latest period_end is this week → current.
  const ends = [
    { periodEnd: '2026-07-11', periodType: 'weekly' as const },
    { periodEnd: '2026-05-30', periodType: 'weekly' as const }, // 6-week hole before it — must NOT matter
  ]
  assert.equal(
    deriveStatus({ ...base, cadence: 'weekly', eventDriven: true, coverageEnds: ends }),
    'current',
  )
})

test('event-driven overdue: no recent upload or coverage', () => {
  assert.equal(
    deriveStatus({ ...base, cadence: 'weekly', eventDriven: true, coverageEnds: [{ periodEnd: '2026-06-01', periodType: 'weekly' }] }),
    'overdue',
  )
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
