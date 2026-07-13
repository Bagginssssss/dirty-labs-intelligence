// INB-152 — cross-snapshot brand-name overlap for SmartScout Subcategory Brands uploads.
//
// A sticky subcategory dropdown ingested a Toilet Cleaners file under Stain Removers (~10% brand
// overlap with the prior Stain Removers snapshot). Before storing a brands upload, the ingest
// route compares the file's brand set to the selected subcategory's most recent prior snapshot
// and rejects when they are near-disjoint. Overlap = Jaccard on case-folded/trimmed name sets.
//
// Threshold rationale: within a subcategory, week-over-week brand lists are ranked top-N by
// revenue and largely stable — Jaccard typically 0.7–0.9. A wrong-subcategory file is
// near-disjoint (the incident ≈ 0.10). 0.5 sits in the wide empty gap: it rejects true
// mismatches while never false-rejecting legitimate tail churn (which would block the routine).
export const SMARTSCOUT_SNAPSHOT_OVERLAP_MIN = 0.5

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

function nameSet(names: string[]): Set<string> {
  const s = new Set<string>()
  for (const n of names) {
    if (typeof n !== 'string') continue
    const norm = normalize(n)
    if (norm) s.add(norm)
  }
  return s
}

// Jaccard similarity |A ∩ B| / |A ∪ B| on normalized name sets. Two empty inputs → 1 (vacuously
// identical); the caller skips the guard entirely when either input is empty, so that edge never
// gates an upload.
export function snapshotNameOverlap(a: string[], b: string[]): number {
  const setA = nameSet(a)
  const setB = nameSet(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const n of setA) if (setB.has(n)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 1 : intersection / union
}
