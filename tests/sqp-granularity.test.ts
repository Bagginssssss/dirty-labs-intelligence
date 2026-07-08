// INB-143 — the SQP volume unit label must match the cadence of the data shown.
//
// search_query_performance has no granularity column: 12 monthly periods
// (May 2025 – Apr 2026) then weekly Saturday-ending periods from May 2026 —
// distinguishable only by report_date spacing. deriveSqpVolumeUnit classifies
// each in-window report_date by its min gap to a neighbor in the FULL date
// sequence (≤13d → weekly, ≥14d → monthly): clean weekly window → 'wk', clean
// monthly → 'mo', mixed or undeterminable → null (the header omits the unit —
// it must never claim a cadence the data can't prove).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSqpVolumeUnit } from '../lib/dashboard/sqp-granularity.ts'

// Realistic full-sequence fixture: monthly first-of-month dates through Apr
// 2026, then weekly Saturday-ending dates from May 2026 (7-day spacing).
const MONTHLY = [
  '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01',
  '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01',
  '2026-03-01', '2026-04-01',
]
const WEEKLY = [
  '2026-05-02', '2026-05-09', '2026-05-16', '2026-05-23', '2026-05-30',
  '2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04',
]
const ALL = [...MONTHLY, ...WEEKLY]

test('INB-143 fail-first: clean weekly window → wk (current code labels it /mo)', () => {
  // Default dashboard view today: last_30d ≈ Jun 7 – Jul 7, four weekly dates.
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-06-07', '2026-07-07'), 'wk')
})

test('clean monthly-era window → mo', () => {
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-03-01', '2026-03-31'), 'mo')
})

test('single weekly date in window resolves via neighbor gap → wk', () => {
  // Early-MTD July window: only 2026-07-04 in window; predecessor 2026-06-27 is 7d back.
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-07-01', '2026-07-07'), 'wk')
})

test('single monthly date in window resolves via neighbor gap → mo', () => {
  // Feb 2026 window: only 2026-02-01 in window; neighbors ±~30d.
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-02-01', '2026-02-28'), 'mo')
})

test('May 2026 transition month: weekly dates, monthly predecessor → wk', () => {
  // First weekly date's predecessor gap is ~31d but its successor gap is 7d —
  // min-of-both-neighbors keeps the transition month honestly weekly.
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-05-01', '2026-05-31'), 'wk')
})

test('mixed window spanning the cadence switch (QTD) → null (no unit claim)', () => {
  // Q2 2026: Apr 1 monthly row + May/Jun weekly rows in one window.
  assert.equal(deriveSqpVolumeUnit(ALL, '2026-04-01', '2026-06-30'), null)
})

test('no SQP dates in window → null', () => {
  assert.equal(deriveSqpVolumeUnit(ALL, '2024-01-01', '2024-12-31'), null)
})

test('degenerate one-date table (no neighbors to measure) → null', () => {
  assert.equal(deriveSqpVolumeUnit(['2025-05-01'], '2025-05-01', '2025-05-31'), null)
})

test('empty date list → null', () => {
  assert.equal(deriveSqpVolumeUnit([], '2026-06-01', '2026-06-30'), null)
})
