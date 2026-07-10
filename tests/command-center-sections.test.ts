// INB-147 — section grouping + progress math + planned split (pure).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleCommandCenter } from '../lib/command-center/status.ts'
import type { TileVM } from '../lib/command-center/types.ts'

function tile(o: Partial<TileVM> & Pick<TileVM, 'reportKey' | 'sourceGroup' | 'status'>): TileVM {
  return {
    displayName: o.reportKey, cadence: 'weekly', pullPeriod: null, targetTable: 't',
    isActive: o.status !== 'planned', eventDriven: false, notes: null,
    latestPeriodLabel: null, latestPeriodEnd: null, lastUploadAt: null, strip: [],
    sortOrder: 1, ...o,
  } as TileVM
}

test('sections ordered by workflow, tiles by sort_order, per-section progress', () => {
  const tiles: TileVM[] = [
    tile({ reportKey: 'sqp_weekly', sourceGroup: 'Brand Analytics', status: 'current', sortOrder: 1 }),
    tile({ reportKey: 'sp_search_term', sourceGroup: 'Sponsored Ads', status: 'current', sortOrder: 2 }),
    tile({ reportKey: 'sp_campaign', sourceGroup: 'Sponsored Ads', status: 'overdue', sortOrder: 1 }),
    tile({ reportKey: 'planned_x', sourceGroup: 'Brand Analytics', status: 'planned' }),
  ]
  const vm = assembleCommandCenter(tiles, '2026-07-10')

  // Sponsored Ads before Brand Analytics (workflow order)
  assert.deepEqual(vm.sections.map(s => s.sourceGroup), ['Sponsored Ads', 'Brand Analytics'])
  // within Sponsored Ads, sort_order 1 before 2
  assert.deepEqual(vm.sections[0].tiles.map(t => t.reportKey), ['sp_campaign', 'sp_search_term'])
  // per-section progress: Sponsored Ads 1/2 current
  assert.equal(vm.sections[0].current, 1)
  assert.equal(vm.sections[0].total, 2)
  // planned split out of sections
  assert.deepEqual(vm.planned.map(t => t.reportKey), ['planned_x'])
  assert.ok(vm.sections.every(s => s.tiles.every(t => t.status !== 'planned')))
})

test('header totals across active tiles only', () => {
  const tiles: TileVM[] = [
    tile({ reportKey: 'a', sourceGroup: 'Sponsored Ads', status: 'current' }),
    tile({ reportKey: 'b', sourceGroup: 'Sponsored Ads', status: 'due' }),
    tile({ reportKey: 'c', sourceGroup: 'SmartScout', status: 'overdue' }),
    tile({ reportKey: 'p', sourceGroup: 'Brand Analytics', status: 'planned' }),
  ]
  const vm = assembleCommandCenter(tiles, '2026-07-10')
  assert.deepEqual(
    { current: vm.header.current, due: vm.header.due, overdue: vm.header.overdue, total: vm.header.total },
    { current: 1, due: 1, overdue: 1, total: 3 },
  )
})
