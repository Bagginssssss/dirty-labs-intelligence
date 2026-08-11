// INB-168 — coverage reconciliation REPORT (not a pass/fail gate, per the G1 amendment).
//
// For every active report, re-derive coverage from the fact tables the same way the rebuild path does
// (paired → intersection, else union → datesToPeriods) and compare its max data_through against what
// the LIVE report_coverage holds (written by the post-upload path). Triage each report three ways:
//
//   EQUAL         rebuild == stored                        → fine
//   CONSERVATIVE  rebuild < stored (rebuild reports EARLIER)→ fine (correct error direction)
//   OPTIMISTIC    rebuild > stored (rebuild reports LATER)  → DEFECT — investigate before trusting
//
// The upload path and the rebuild legitimately differ in a few places (SKU Economics week-anchored,
// COGS effective-from, amazon_reviews from scraped_at), so this is a REPORT to triage, not an
// assertion — CONSERVATIVE/EQUAL are expected; only OPTIMISTIC is a real problem. Exit is always 0;
// OPTIMISTIC rows are marked ✗ for the human to act on. (Convert to a hard assertion once the expected
// set is known.)
//
// windowPerPull reports (business_report_child_asin, subscribe_and_save) are EXCLUDED — they are
// rebuilt by scripts/inb166-window-coverage.mjs and skipped by the inb146 rebuild, so re-deriving them
// here with the source-date-only path would be a false mismatch.

import { supabaseAdmin } from '../lib/supabase-admin.ts'
import { REPORT_REGISTRY_SEED } from '../lib/report-registry.ts'
import { coverageFilterValues } from '../lib/coverage/discriminator.ts'
import { COVERAGE_CONFIG } from '../lib/coverage/config.ts'
import { datesToPeriods } from '../lib/coverage/buckets.ts'
import { resolvePairedCoverage, pullIntervalDays } from '../lib/coverage/paired.ts'

const BRAND = process.env.INB146_BRAND_ID ?? '47a96175-ed58-4104-a2ff-c925d6143309'
const active = REPORT_REGISTRY_SEED.filter(r => r.is_active)

async function rpcDates(table, fv) {
  const { data, error } = await supabaseAdmin.rpc('get_coverage_dates', {
    p_brand_id: BRAND, p_source_table: table, p_filter_values: fv,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map(x => String(x.d).slice(0, 10))
}

const rows = []
let optimistic = 0, skipped = 0

for (const r of active) {
  const cfg = COVERAGE_CONFIG[r.target_table]
  if (!cfg) { rows.push([r.report_key, 'NO-CONFIG', '', '', '']); continue }
  if (cfg.windowPerPull) { skipped++; continue } // rebuilt by inb166-window-coverage.mjs

  let rebuiltThrough = null
  try {
    const fv = coverageFilterValues(r.discriminator)
    let dates
    if (cfg.pairedDiscriminator && Array.isArray(fv) && fv.length > 1) {
      const per = {}
      for (const v of fv) per[v] = await rpcDates(r.target_table, [v])
      dates = resolvePairedCoverage(per, pullIntervalDays(cfg.mode)).dates
    } else {
      dates = await rpcDates(r.target_table, fv)
    }
    const periods = datesToPeriods(dates, cfg.mode)
    rebuiltThrough = periods.length ? periods.map(p => p.data_through).sort().at(-1) : null
  } catch (e) {
    rows.push([r.report_key, 'REBUILD-ERR', '', '', e.message.slice(0, 40)])
    continue
  }

  const { data } = await supabaseAdmin
    .from('report_coverage').select('data_through').eq('report_key', r.report_key)
  const stored = (data ?? []).map(x => x.data_through).filter(Boolean).map(d => String(d).slice(0, 10)).sort().at(-1) ?? null

  let verdict
  if (rebuiltThrough === stored) verdict = 'EQUAL'
  else if (stored == null) verdict = 'STORED-EMPTY'
  else if (rebuiltThrough == null) verdict = 'CONSERVATIVE' // rebuild has nothing → strictly ≤
  else if (rebuiltThrough < stored) verdict = 'CONSERVATIVE'
  else { verdict = 'OPTIMISTIC ✗'; optimistic++ }

  rows.push([r.report_key, verdict, rebuiltThrough ?? '∅', stored ?? '∅', ''])
}

console.log(`INB-168 coverage reconciliation report — ${active.length} active, ${skipped} windowPerPull excluded\n`)
console.log('report_key'.padEnd(34), 'verdict'.padEnd(14), 'rebuild→'.padEnd(12), 'stored→'.padEnd(12), 'note')
for (const [k, v, rb, st, note] of rows) {
  console.log(k.padEnd(34), v.padEnd(14), String(rb).padEnd(12), String(st).padEnd(12), note)
}
console.log(`\nOPTIMISTIC (rebuild overstates — DEFECT): ${optimistic}`)
if (optimistic > 0) console.log('  → investigate each ✗ before trusting the rebuild. (Report only; exit 0.)')
