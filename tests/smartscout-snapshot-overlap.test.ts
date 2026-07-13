// INB-152 — cross-snapshot brand-name overlap (pure).
//
// A wrong-subcategory SmartScout brands file is near-disjoint from the prior snapshot of the
// selected subcategory (this morning's incident: ~10% overlap, ingested as the wrong category).
// snapshotNameOverlap = Jaccard on case-folded/trimmed brand-name sets; the route rejects below
// SMARTSCOUT_SNAPSHOT_OVERLAP_MIN. Same-subcategory week-over-week lists overlap 0.7–0.9.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotNameOverlap, SMARTSCOUT_SNAPSHOT_OVERLAP_MIN } from '../lib/smartscout/snapshot-overlap.ts'

test('threshold constant is 0.5', () => {
  assert.equal(SMARTSCOUT_SNAPSHOT_OVERLAP_MIN, 0.5)
})

test('identical sets → 1', () => {
  assert.equal(snapshotNameOverlap(['Tide', 'Persil', 'Gain'], ['Tide', 'Persil', 'Gain']), 1)
})

test('disjoint sets → 0 (the wrong-subcategory case)', () => {
  assert.equal(snapshotNameOverlap(['Lysol', 'Clorox', 'Scrubbing Bubbles'], ['Tide', 'Persil', 'Gain']), 0)
})

test('partial overlap → Jaccard ratio (intersection / union)', () => {
  // A = {a,b,c,d}, B = {c,d,e,f}; ∩ = {c,d} = 2, ∪ = 6 → 1/3.
  const r = snapshotNameOverlap(['a', 'b', 'c', 'd'], ['c', 'd', 'e', 'f'])
  assert.ok(Math.abs(r - 1 / 3) < 1e-9, `expected 1/3, got ${r}`)
})

test('case- and whitespace-insensitive (no false low-overlap on formatting)', () => {
  assert.equal(snapshotNameOverlap([' Tide ', 'PERSIL', 'gain'], ['tide', 'Persil', 'GAIN']), 1)
})

test('duplicates within a list collapse (set semantics)', () => {
  assert.equal(snapshotNameOverlap(['Tide', 'Tide', 'Persil'], ['Tide', 'Persil']), 1)
})

test('near-disjoint (the ~10% incident) falls below the threshold', () => {
  // 1 shared brand out of a 10+10 union ≈ 0.05 → well under 0.5.
  const a = ['Tide', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']
  const b = ['Tide', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']
  assert.ok(snapshotNameOverlap(a, b) < SMARTSCOUT_SNAPSHOT_OVERLAP_MIN)
})

test('stable week-over-week list stays above the threshold', () => {
  // 8 of 10 shared, 2 churned each side → ∩ 8, ∪ 12 → 0.66 ≥ 0.5.
  const prior = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'old1', 'old2']
  const incoming = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'new1', 'new2']
  assert.ok(snapshotNameOverlap(incoming, prior) >= SMARTSCOUT_SNAPSHOT_OVERLAP_MIN)
})
