// INB-138 — the BusinessHealth "Active subs" rail must show the latest-COVERED-day
// ss_active_subscriptions snapshot from derived_metrics_daily, never a sum.
//
// active_subscriptions is a point-in-time period-END balance (a stock). The old
// rail SUMMED it across ~20-23 (asin,sku) rows per period and across overlapping
// rolling periods — a meaningless inflated number. And "latest" must skip trailing
// uncovered days: 2026-06-27 legitimately holds 0 (no S&S period covers it), so
// naive max(metric_date) reads zero.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const row = (metric_date: string, ss_active_subscriptions: number | null) =>
  ({ metric_date, ss_active_subscriptions })

test('active subs: latest COVERED day wins — not the sum, not the trailing zero', async () => {
  const mod = await import('../lib/dashboard/snapshots.ts')
  assert.equal(typeof mod.latestCoveredActiveSubs, 'function', 'latestCoveredActiveSubs is exported')
  const series = [
    row('2026-06-25', 63500),
    row('2026-06-26', 63807),
    row('2026-06-27', 0), // legitimately uncovered day — must not win
  ]
  const value = mod.latestCoveredActiveSubs(series)
  assert.equal(value, 63807, 'latest covered day (06-26)')
  assert.notEqual(value, 63500 + 63807, 'never a cross-day sum')
  assert.notEqual(value, 0, 'never the trailing uncovered zero')
})

test('active subs: input order must not matter (max-compared, not last-row)', async () => {
  const mod = await import('../lib/dashboard/snapshots.ts')
  const shuffled = [
    row('2026-06-27', 0),
    row('2026-06-10', 61000),
    row('2026-06-26', 63807),
    row('2026-06-01', 60500),
  ]
  assert.equal(mod.latestCoveredActiveSubs(shuffled), 63807)
})

test('active subs MoM: null unless BOTH snapshots are present — no fake −100% on uncovered windows', async () => {
  const mod = await import('../lib/dashboard/snapshots.ts')
  assert.equal(typeof mod.snapshotMoM, 'function', 'snapshotMoM is exported')
  // July-MTD defect: current window uncovered (0) with a real prior → must be
  // null ("first snapshot"), NOT (0 − 63807)/63807 = −100%.
  assert.equal(mod.snapshotMoM(0, 63807), null, 'missing CURRENT snapshot → null')
  assert.equal(mod.snapshotMoM(63807, 0), null, 'missing prior snapshot → null')
  assert.equal(mod.snapshotMoM(0, 0), null, 'neither → null')
  // Guardrail: real MoM unchanged when both are present (63,807 vs 61,059 ≈ +4.5%).
  const mom = mod.snapshotMoM(63807, 61059)
  assert.ok(mom !== null && Math.abs(mom - (63807 - 61059) / 61059) < 1e-12, 'both present → real MoM')
})

test('active subs: empty, all-zero, and null series resolve to 0 (nulls never win)', async () => {
  const mod = await import('../lib/dashboard/snapshots.ts')
  assert.equal(mod.latestCoveredActiveSubs([]), 0, 'empty window')
  assert.equal(mod.latestCoveredActiveSubs([row('2026-06-01', 0), row('2026-06-02', 0)]), 0, 'all uncovered')
  assert.equal(
    mod.latestCoveredActiveSubs([row('2026-06-01', 61000), row('2026-06-02', null)]),
    61000,
    'a null row never wins over an older covered day'
  )
})
