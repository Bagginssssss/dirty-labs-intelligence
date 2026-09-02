// INB-178 Phase 2 — section registry. The runner executes each entry in order and merges its output
// into report-data.json under `sections[<key>]`.
//
// Each section module exports a default object: { key, async extract({ db, conventions }) => data }.
// Batch A adds §0, §1, §2 at G2/G3. EMPTY at G1 — scaffold only, no section data, no report-table
// queries yet. Import and list section modules here as they are built:
//
//   import s1 from './s1-account-monthly.mjs'
//   export const SECTIONS = [s1, ...]
import s1 from './s1-account-monthly.mjs'
import s0 from './s0-account-weekly.mjs'
import s2 from './s2-february-diagnostic.mjs'

// Batch A: §1 (account monthly) + §0 (account weekly) + §2 (February diagnostic).
export const SECTIONS = [s1, s0, s2]
