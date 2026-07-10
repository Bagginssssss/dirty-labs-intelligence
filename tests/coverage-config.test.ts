// INB-146 — COVERAGE_CONFIG completeness + event-driven flags.
// A new active registry row on a new table without a config entry must fail loudly here
// (the backfill / maintenance would otherwise silently skip its coverage).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COVERAGE_CONFIG } from '../lib/coverage/config.ts'
import { REPORT_REGISTRY_SEED } from '../lib/report-registry.ts'

test('every active target_table has exactly one COVERAGE_CONFIG entry (and no extras)', () => {
  const activeTables = [...new Set(
    REPORT_REGISTRY_SEED.filter(r => r.is_active).map(r => r.target_table),
  )].sort()
  assert.deepEqual(Object.keys(COVERAGE_CONFIG).sort(), activeTables)
})

test('modes are valid; event_driven true only for the bid log + rule change logs', () => {
  const eventTables = Object.entries(COVERAGE_CONFIG)
    .filter(([, c]) => c.eventDriven)
    .map(([t]) => t)
    .sort()
  assert.deepEqual(eventTables, ['scale_insights_bid_log', 'scale_insights_rule_change_log'])
  for (const c of Object.values(COVERAGE_CONFIG)) {
    assert.ok(['weekly', 'monthly', 'snapshot'].includes(c.mode))
    assert.ok(typeof c.periodColumn === 'string' && c.periodColumn.length > 0)
  }
})
