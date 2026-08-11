// INB-168 — rebuild-path intersection resolution for AND-paired discriminators.
// The union overstates coverage when one paired metric goes stale while its sibling keeps landing
// (the frozen reorder_share canary in INB-166). resolvePairedCoverage caps data_through at min(max).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePairedCoverage, pullIntervalDays } from '../lib/coverage/paired.ts'

test('paired healthy: both values reach the same max → union dates, no divergence', () => {
  const per = {
    reorder_sales: ['2026-08-04', '2026-08-05', '2026-08-06'],
    sns_sales:     ['2026-08-04', '2026-08-05', '2026-08-06'],
  }
  const r = resolvePairedCoverage(per, 7)
  assert.equal(r.capDate, '2026-08-06')
  assert.deepEqual(r.dates, ['2026-08-04', '2026-08-05', '2026-08-06'])
  assert.equal(r.divergence.level, 'none')
  assert.equal(r.divergence.gapDays, 0)
})

// THE bug it prevents: one half froze weeks ago while the sibling kept landing. The union would
// report 08-06 (overstating a half-dead report); the rebuild must report the EARLIER 07-18 + warn.
test('paired divergence (simulated INB-166 reorder_share): capped at the lagging max, warn', () => {
  const per = {
    reorder_rate:    ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-25', '2026-08-06'], // kept landing
    sns_sales_share: ['2026-07-16', '2026-07-17', '2026-07-18'],                              // froze 07-18
  }
  const unionMax = [...new Set(Object.values(per).flat())].sort().at(-1)
  assert.equal(unionMax, '2026-08-06', 'union would overstate to 08-06')
  const r = resolvePairedCoverage(per, 7)
  assert.equal(r.capDate, '2026-07-18', 'data_through capped at the frozen half')
  assert.ok(r.capDate < unionMax, 'rebuild is strictly more conservative than the union')
  assert.equal(r.dates.at(-1), '2026-07-18')
  assert.ok(!r.dates.includes('2026-08-06'), 'phantom later date dropped')
  assert.equal(r.divergence.level, 'warn')                  // 19d gap > 7d interval
  assert.deepEqual(r.divergence.laggingValues, ['sns_sales_share'])
})

// week-one catch: a 6-day gap is below the 7-day interval → INFO (surfaced, not silent), not WARN.
test('paired small divergence: 6-day gap emits info (silent at a warn-only threshold)', () => {
  const per = { a: ['2026-08-01', '2026-08-07'], b: ['2026-08-01'] }
  const r = resolvePairedCoverage(per, 7)
  assert.equal(r.capDate, '2026-08-01')
  assert.equal(r.divergence.gapDays, 6)
  assert.equal(r.divergence.level, 'info')
  assert.deepEqual(r.divergence.laggingValues, ['b'])
})

test('paired empty half: no data for one value → zero dates, warn', () => {
  const r = resolvePairedCoverage({ a: ['2026-08-06'], b: [] }, 7)
  assert.deepEqual(r.dates, [])
  assert.equal(r.capDate, null)
  assert.equal(r.divergence.level, 'warn')
  assert.deepEqual(r.divergence.laggingValues, ['b'])
})

test('pullIntervalDays: weekly 7, monthly 31, snapshot 1', () => {
  assert.equal(pullIntervalDays('weekly'), 7)
  assert.equal(pullIntervalDays('monthly'), 31)
  assert.equal(pullIntervalDays('snapshot'), 1)
})
