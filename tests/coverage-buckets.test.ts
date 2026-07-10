// INB-146 — datesToPeriods: present-period bucketing per cadence.
//
// Weekly periods are Saturday-ending (Sun–Sat, start = end − 6); the monthly→weekly
// mixed-cadence split reuses the tracker's findWeeklyCutover so SQP's monthly-era rows
// become `monthly` records and the weekly era becomes `weekly` records — never
// fabricated weekly coverage. Snapshot = one record per date. Monthly = per year-month.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datesToPeriods } from '../lib/coverage/buckets.ts'

test('snapshot: one record per distinct date; dedupes; future stripped', () => {
  const out = datesToPeriods(['2026-07-06', '2026-07-06', '2026-06-29', '2099-01-01'], 'snapshot')
  assert.deepEqual(out, [
    { period_start: '2026-06-29', period_end: '2026-06-29', period_label: '2026-06-29', period_type: 'snapshot' },
    { period_start: '2026-07-06', period_end: '2026-07-06', period_label: '2026-07-06', period_type: 'snapshot' },
  ])
})

test('monthly: one record per year-month spanning the full month', () => {
  const out = datesToPeriods(['2025-05-31', '2025-05-01', '2026-02-01'], 'monthly')
  assert.deepEqual(out, [
    { period_start: '2025-05-01', period_end: '2025-05-31', period_label: '2025-05', period_type: 'monthly' },
    { period_start: '2026-02-01', period_end: '2026-02-28', period_label: '2026-02', period_type: 'monthly' },
  ])
})

test('weekly anchors (already Saturdays) → each its own week, start = end−6', () => {
  const out = datesToPeriods(['2026-02-21', '2026-02-28', '2026-03-07'], 'weekly')
  assert.deepEqual(out, [
    { period_start: '2026-02-15', period_end: '2026-02-21', period_label: 'W/E 2026-02-21', period_type: 'weekly' },
    { period_start: '2026-02-22', period_end: '2026-02-28', period_label: 'W/E 2026-02-28', period_type: 'weekly' },
    { period_start: '2026-03-01', period_end: '2026-03-07', period_label: 'W/E 2026-03-07', period_type: 'weekly' },
  ])
})

test('weekly daily rows: 7 contiguous days (Sun–Sat) collapse into one week', () => {
  const days = ['2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27']
  const out = datesToPeriods(days, 'weekly')
  assert.deepEqual(out, [
    { period_start: '2026-06-21', period_end: '2026-06-27', period_label: 'W/E 2026-06-27', period_type: 'weekly' },
  ])
})

test('weekly daily rows spanning a Saturday boundary → two weeks', () => {
  const out = datesToPeriods(['2026-06-26', '2026-06-27', '2026-06-28'], 'weekly')
  assert.deepEqual(out.map(p => p.period_end), ['2026-06-27', '2026-07-04'])
  assert.equal(out.length, 2)
})

test('weekly mixed-cadence (SQP): monthly-era → monthly, weekly-era → weekly', () => {
  // 3 month-ends, then the 2-day transition into weekly Saturdays. The 04-30 month-end
  // must stay monthly (12→ here 3 monthly), weekly starts at the first Saturday.
  const out = datesToPeriods(
    ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-02', '2026-05-09'],
    'weekly',
  )
  assert.deepEqual(
    out.filter(p => p.period_type === 'monthly').map(p => p.period_label),
    ['2026-02', '2026-03', '2026-04'],
  )
  assert.deepEqual(
    out.filter(p => p.period_type === 'weekly').map(p => p.period_end),
    ['2026-05-02', '2026-05-09'],
  )
})

test('weekly single date → ONE weekly period, never a month (forward-maintenance case)', () => {
  // A one-week upload gives one anchor date. findWeeklyCutover returns "all monthly"
  // (no small gap) — but a lone weekly date must bucket weekly, not become 2026-06.
  const out = datesToPeriods(['2026-06-14'], 'weekly') // Sunday → week ending Sat 2026-06-20
  assert.deepEqual(out, [
    { period_start: '2026-06-14', period_end: '2026-06-20', period_label: 'W/E 2026-06-20', period_type: 'weekly' },
  ])
})

test('weekly two anchors 14 days apart (a missing week) → two weeks, not monthly', () => {
  const out = datesToPeriods(['2026-06-06', '2026-06-20'], 'weekly') // both Saturdays, 14d gap
  assert.deepEqual(out.map(p => [p.period_type, p.period_end]), [
    ['weekly', '2026-06-06'],
    ['weekly', '2026-06-20'],
  ])
})

test('empty / all-future input → no periods', () => {
  assert.deepEqual(datesToPeriods([], 'weekly'), [])
  assert.deepEqual(datesToPeriods(['2099-06-01'], 'snapshot'), [])
})
