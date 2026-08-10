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

test('INB-166 window-per-pull: business_report + subscribe_and_save; S&S end-column; no fixed covering-window remains', () => {
  const windowed = Object.entries(COVERAGE_CONFIG).filter(([, c]) => c.windowPerPull).map(([t]) => t).sort()
  assert.deepEqual(windowed, ['business_report', 'subscribe_and_save'])
  // Both are snapshot-mode multi-day spans (period_start ≠ period_end).
  assert.equal(COVERAGE_CONFIG.business_report.mode, 'snapshot')
  assert.equal(COVERAGE_CONFIG.subscribe_and_save.mode, 'snapshot')
  // S&S window end is a row column (Reporting Period End); business_report has none → the ingest
  // payload's date_range_end supplies it at write time.
  assert.equal(COVERAGE_CONFIG.subscribe_and_save.windowEndColumn, 'date_range_end')
  assert.equal(COVERAGE_CONFIG.business_report.windowEndColumn, undefined)
  // The legacy fixed covering-window (coveringWindowDays) is fully removed.
  assert.deepEqual(Object.entries(COVERAGE_CONFIG).filter(([, c]) => c.coveringWindowDays != null).map(([t]) => t), [])
})
