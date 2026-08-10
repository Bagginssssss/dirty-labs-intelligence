// INB-147 — 8-cell coverage strip assembly (pure).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStrip } from '../lib/command-center/status.ts'

const TODAY = '2026-07-10' // most recent completed Saturday = 2026-07-04
// Expected 8 weekly cells end at 2026-07-04 back to 2026-05-16.
const EIGHT_SATURDAYS = ['2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04']

function weeklyEnds(sats: string[]) {
  return sats.map(periodEnd => ({ periodEnd, periodType: 'weekly' as const, dataThrough: periodEnd }))
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

test('pending: most-recent expected cell uncovered but within grace → pending, not gap', () => {
  // today Monday 2026-07-06 → expected 07-04 uncovered (data only through 06-27), daysPast 2 ≤ 3
  const strip = buildStrip({ mode: 'weekly', eventDriven: false, coverageEnds: weeklyEnds(['2026-06-13', '2026-06-20', '2026-06-27']), today: '2026-07-06' })
  const last = strip[strip.length - 1]
  assert.equal(last.periodEnd, '2026-07-04')
  assert.equal(last.state, 'pending')
})

test('pending: most-recent expected cell uncovered beyond grace → gap (red)', () => {
  // today 2026-07-10 → expected 07-04 uncovered, daysPast 6 > 3
  const strip = buildStrip({ mode: 'weekly', eventDriven: false, coverageEnds: weeklyEnds(['2026-06-13', '2026-06-20', '2026-06-27']), today: TODAY })
  const last = strip[strip.length - 1]
  assert.equal(last.periodEnd, '2026-07-04')
  assert.equal(last.state, 'gap')
})

test('monthly: 8 months of coverage → 8 filled cells (no false gaps)', () => {
  // business_report shape: today 2026-07-12 → strip spans Nov 2025 … Jun 2026 (last completed).
  const monthEnds = ['2025-11-30', '2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']
  const coverageEnds = monthEnds.map(periodEnd => ({ periodEnd, periodType: 'monthly' as const, dataThrough: periodEnd }))
  const strip = buildStrip({ mode: 'monthly', eventDriven: false, coverageEnds, today: '2026-07-12' })
  assert.equal(strip.length, 8)
  assert.deepEqual(strip.map(c => c.label), ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
  assert.ok(strip.every(c => c.state === 'filled'), 'all 8 months present → all filled')
})

test('monthly pull-date strip: three cell states — filled (pull month), neutral (before first coverage), gap (interior miss)', () => {
  // INB-160 tile addendum 2. TODAY 2026-07-10, pull-date-shaped → strip anchors at the CURRENT
  // month (July). Coverage in May + July (June missing, interior). Result: months before the
  // earliest coverage (May) are NEUTRAL (no expectation), May+July FILLED, June a red GAP.
  const coverageEnds = [
    { periodEnd: '2026-05-31', periodType: 'monthly' as const, dataThrough: '2026-05-20' },
    { periodEnd: '2026-07-31', periodType: 'monthly' as const, dataThrough: '2026-07-10' },
  ]
  const strip = buildStrip({ mode: 'monthly', eventDriven: false, coverageEnds, today: TODAY, monthlyPullDate: true })
  assert.deepEqual(strip.map(c => c.label), ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
  assert.equal(strip.find(c => c.label === '2026-07')?.state, 'filled', 'current-month pull → filled (was red)')
  assert.equal(strip.find(c => c.label === '2026-05')?.state, 'filled')
  assert.equal(strip.find(c => c.label === '2026-06')?.state, 'gap', 'interior miss after first coverage → red')
  // Every month before the earliest coverage (May) is neutral, not red.
  for (const ym of ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04']) {
    assert.equal(strip.find(c => c.label === ym)?.state, 'neutral', `${ym} before first coverage → neutral`)
  }
  assert.equal(strip.filter(c => c.state === 'gap').length, 1, 'only the interior miss is a gap')
})

test('first-coverage-boundary generalizes to weekly strips: pre-first-coverage weeks are neutral, not red', () => {
  // Weekly report whose earliest coverage is 2026-06-13 → the 4 older strip weeks carry no
  // expectation and read neutral; the covered weeks stay filled.
  const present = ['2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04']
  const strip = buildStrip({ mode: 'weekly', eventDriven: false, coverageEnds: weeklyEnds(present), today: TODAY })
  for (const sat of ['2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06']) {
    assert.equal(strip.find(c => c.periodEnd === sat)?.state, 'neutral', `${sat} before first coverage → neutral`)
  }
  assert.equal(strip.filter(c => c.state === 'filled').length, 4)
  assert.equal(strip.filter(c => c.state === 'gap').length, 0, 'no red before the report ever had data')
})

test('snapshot_weekly: snapshots bucket into their week; missing weeks neutral', () => {
  // snapshots on 2026-07-01 (→ week ending 07-04) and 2026-06-24 (→ 06-27); others missing → neutral.
  // TODAY 2026-07-10 (Fri) → snapshot strips now anchor the rightmost cell at weekEndSaturday(today)
  // = 2026-07-11 (the in-progress week), so the 8 cells span 2026-05-23 … 2026-07-11 (05-16 falls off).
  const coverageEnds = [
    { periodEnd: '2026-07-01', periodType: 'snapshot' as const, dataThrough: '2026-07-01' },
    { periodEnd: '2026-06-24', periodType: 'snapshot' as const, dataThrough: '2026-06-24' },
  ]
  const strip = buildStrip({ mode: 'snapshot', eventDriven: false, coverageEnds, today: TODAY })
  assert.equal(strip[strip.length - 1].periodEnd, '2026-07-11', 'rightmost = in-progress week')
  assert.equal(strip.find(c => c.periodEnd === '2026-07-04')?.state, 'filled')
  assert.equal(strip.find(c => c.periodEnd === '2026-06-27')?.state, 'filled')
  assert.equal(strip.find(c => c.periodEnd === '2026-05-23')?.state, 'neutral')
  assert.equal(strip.filter(c => c.state === 'gap').length, 0)
})

test('snapshot strip includes the in-progress week — a Monday-captured snapshot fills the rightmost cell', () => {
  // today Monday 2026-07-13 → weekEndSaturday = 2026-07-18 (upcoming Sat), mostRecentSaturday = 07-11.
  // A same-day snapshot buckets into week ending 07-18; the strip must show that cell (rightmost) filled,
  // not read empty every week forever (the bug: strip edge stuck at 07-11).
  const strip = buildStrip({
    mode: 'snapshot',
    eventDriven: false,
    coverageEnds: [{ periodEnd: '2026-07-13', periodType: 'snapshot', dataThrough: '2026-07-13' }],
    today: '2026-07-13',
  })
  assert.equal(strip[strip.length - 1].periodEnd, '2026-07-18', 'rightmost cell = upcoming Saturday')
  assert.equal(strip[strip.length - 1].state, 'filled', 'same-day snapshot fills the in-progress week')
})

test('INB-166 window-per-pull: consecutive weekly 30-day windows overlap → CONTIGUOUS filled strip (no false gap)', () => {
  // Two pulls a week apart, each a ~30-day window ([start, end] stored on the coverage row) →
  // they overlap by ~23 days. Interval-fill must fill every week-cell EITHER window intersects, with
  // no un-filled cell between them (the old point-fill filled only each window's end-week → gaps).
  const coverageEnds = [
    { periodStart: '2026-06-12', periodEnd: '2026-07-12', periodType: 'snapshot' as const, dataThrough: '2026-07-12' },
    { periodStart: '2026-06-19', periodEnd: '2026-07-19', periodType: 'snapshot' as const, dataThrough: '2026-07-19' },
  ]
  const strip = buildStrip({ mode: 'snapshot', eventDriven: false, coverageEnds, today: '2026-07-20', windowPerPull: true })
  const states = strip.map(c => c.state)
  const firstFilled = states.indexOf('filled')
  const lastFilled = states.lastIndexOf('filled')
  assert.ok(lastFilled - firstFilled + 1 >= 5, 'the overlapping windows fill a run of ≥5 week-cells')
  for (let i = firstFilled; i <= lastFilled; i++) {
    assert.equal(strip[i].state, 'filled', `contiguous fill between pulls — no gap/neutral at ${strip[i].periodEnd}`)
  }
})

test('covering-window (S&S): a snapshot fills every week-cell its 30-day window intersects', () => {
  // S&S labels a snapshot at its window START and it covers [date, date+30]. today 2026-07-13.
  // A snapshot dated 2026-06-20 covers 06-20…07-20 → must fill every week-cell in that span, not just one.
  const strip = buildStrip({
    mode: 'snapshot',
    eventDriven: false,
    coverageEnds: [{ periodEnd: '2026-06-20', periodType: 'snapshot', dataThrough: '2026-06-20' }],
    today: '2026-07-13',
    coveringWindowDays: 30,
  })
  // Weeks whose [Sat-6, Sat] span intersects [2026-06-20, 2026-07-20]: 06-20, 06-27, 07-04, 07-11, 07-18.
  for (const sat of ['2026-06-20', '2026-06-27', '2026-07-04', '2026-07-11', '2026-07-18']) {
    assert.equal(strip.find(c => c.periodEnd === sat)?.state, 'filled', `${sat} covered by the window`)
  }
  // A week fully before the window start (06-13, span 06-07…06-13) does not intersect → neutral.
  assert.equal(strip.find(c => c.periodEnd === '2026-06-13')?.state, 'neutral', 'pre-window week not filled')
  assert.equal(strip.filter(c => c.state === 'gap').length, 0)
})
