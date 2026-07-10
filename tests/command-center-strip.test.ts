// INB-147 — 8-cell coverage strip assembly (pure).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStrip } from '../lib/command-center/status.ts'

const TODAY = '2026-07-10' // most recent completed Saturday = 2026-07-04
// Expected 8 weekly cells end at 2026-07-04 back to 2026-05-16.
const EIGHT_SATURDAYS = ['2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04']

function weeklyEnds(sats: string[]) {
  return sats.map(periodEnd => ({ periodEnd, periodType: 'weekly' as const }))
}

test('weekly contiguous → 8 filled cells, oldest→newest', () => {
  const strip = buildStrip({ mode: 'weekly', eventDriven: false, coverageEnds: weeklyEnds(EIGHT_SATURDAYS), today: TODAY })
  assert.equal(strip.length, 8)
  assert.deepEqual(strip.map(c => c.periodEnd), EIGHT_SATURDAYS)
  assert.ok(strip.every(c => c.state === 'filled'))
})

test('weekly non-event with an interior miss → that cell is a gap (red)', () => {
  const present = EIGHT_SATURDAYS.filter(s => s !== '2026-06-20')
  const strip = buildStrip({ mode: 'weekly', eventDriven: false, coverageEnds: weeklyEnds(present), today: TODAY })
  const gapCell = strip.find(c => c.periodEnd === '2026-06-20')
  assert.equal(gapCell?.state, 'gap')
  assert.equal(strip.filter(c => c.state === 'filled').length, 7)
})

test('event-driven with a missing week → neutral, never a gap', () => {
  const present = EIGHT_SATURDAYS.filter(s => s !== '2026-06-20')
  const strip = buildStrip({ mode: 'weekly', eventDriven: true, coverageEnds: weeklyEnds(present), today: TODAY })
  const cell = strip.find(c => c.periodEnd === '2026-06-20')
  assert.equal(cell?.state, 'neutral')
  assert.equal(strip.filter(c => c.state === 'gap').length, 0)
})

test('snapshot_weekly: snapshots bucket into their week; missing weeks neutral', () => {
  // snapshots on 2026-07-01 (→ week ending 07-04) and 2026-06-24 (→ 06-27); others missing → neutral
  const coverageEnds = [
    { periodEnd: '2026-07-01', periodType: 'snapshot' as const },
    { periodEnd: '2026-06-24', periodType: 'snapshot' as const },
  ]
  const strip = buildStrip({ mode: 'snapshot', eventDriven: false, coverageEnds, today: TODAY })
  assert.equal(strip.find(c => c.periodEnd === '2026-07-04')?.state, 'filled')
  assert.equal(strip.find(c => c.periodEnd === '2026-06-27')?.state, 'filled')
  assert.equal(strip.find(c => c.periodEnd === '2026-05-16')?.state, 'neutral')
  assert.equal(strip.filter(c => c.state === 'gap').length, 0)
})
