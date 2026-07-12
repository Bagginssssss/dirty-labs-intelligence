// INB-146 — one-time historical coverage backfill.
//
// Derives report_coverage from the data tables for every ACTIVE report_registry row:
//   discriminator → get_coverage_dates (bounded) → datesToPeriods → upsert.
// Idempotent: re-run writes nothing (prints new/changed/unchanged per report). Fails
// LOUDLY per report on a discriminator/RPC/upsert error (never silent-skip). Only
// writes report_coverage — no source-table writes (the lighter gate, run by Darren):
//
//   npm run backfill:coverage
//
// Exit codes: 0 = every active report upserted cleanly; 1 = one or more reports failed.
// EMPTY (0 periods) is surfaced as a WARN line for human check — a report with known
// data and 0 periods is a discriminator bug (confirm against the source span).

import { supabaseAdmin } from '../lib/supabase-admin.ts'
import { REPORT_REGISTRY_SEED } from '../lib/report-registry.ts'
import { coverageFilterValues } from '../lib/coverage/discriminator.ts'
import { COVERAGE_CONFIG } from '../lib/coverage/config.ts'
import { datesToPeriods } from '../lib/coverage/buckets.ts'

const BRAND = process.env.INB146_BRAND_ID ?? '47a96175-ed58-4104-a2ff-c925d6143309'

const active = REPORT_REGISTRY_SEED.filter(r => r.is_active)
let failed = 0
let totNew = 0, totChanged = 0, totUnchanged = 0, totEmpty = 0

console.log(`INB-146 coverage backfill — brand ${BRAND}, ${active.length} active reports\n`)

for (const r of active) {
  const cfg = COVERAGE_CONFIG[r.target_table]
  if (!cfg) {
    console.error(`FAIL  ${r.report_key} — no COVERAGE_CONFIG for target_table ${r.target_table}`)
    failed++
    continue
  }

  // 1. distinct source dates through the discriminator (bounded RPC).
  let dates
  try {
    const filterValues = coverageFilterValues(r.discriminator) // throws on is_null shape
    const { data, error } = await supabaseAdmin.rpc('get_coverage_dates', {
      p_brand_id: BRAND,
      p_source_table: r.target_table,
      p_filter_values: filterValues,
    })
    if (error) throw new Error(error.message)
    dates = (data ?? []).map(x => String(x.d).slice(0, 10))
  } catch (e) {
    console.error(`FAIL  ${r.report_key} (${r.target_table}) — read: ${e.message}`)
    failed++
    continue
  }

  const periods = datesToPeriods(dates, cfg.mode)
  if (periods.length === 0) {
    console.warn(`WARN  ${r.report_key.padEnd(34)} 0 periods from ${dates.length} dates — verify source is genuinely empty`)
    totEmpty++
    continue
  }

  // 2. diff against existing rows so a re-run reports 0 changes (idempotent).
  let existing
  try {
    const { data, error } = await supabaseAdmin
      .from('report_coverage')
      .select('period_start,period_end,period_label,period_type,data_through,event_driven')
      .eq('report_key', r.report_key)
    if (error) throw new Error(error.message)
    existing = new Map((data ?? []).map(e => [String(e.period_start).slice(0, 10), e]))
  } catch (e) {
    console.error(`FAIL  ${r.report_key} — read existing coverage: ${e.message}`)
    failed++
    continue
  }

  const toWrite = []
  let nNew = 0, nChanged = 0, nUnchanged = 0
  for (const p of periods) {
    const desired = {
      report_key: r.report_key,
      period_start: p.period_start,
      period_end: p.period_end,
      period_label: p.period_label,
      period_type: p.period_type,
      data_through: p.data_through,
      event_driven: cfg.eventDriven,
      source: 'derived',
    }
    const e = existing.get(p.period_start)
    if (!e) { nNew++; toWrite.push(desired) }
    else if (
      String(e.period_end).slice(0, 10) !== p.period_end ||
      e.period_label !== p.period_label ||
      e.period_type !== p.period_type ||
      (e.data_through === null ? null : String(e.data_through).slice(0, 10)) !== p.data_through ||
      e.event_driven !== cfg.eventDriven
    ) { nChanged++; toWrite.push(desired) }
    else nUnchanged++
  }

  if (toWrite.length > 0) {
    const { error } = await supabaseAdmin
      .from('report_coverage')
      .upsert(toWrite, { onConflict: 'report_key,period_start' })
    if (error) {
      console.error(`FAIL  ${r.report_key} — upsert: ${error.message}`)
      failed++
      continue
    }
  }

  totNew += nNew; totChanged += nChanged; totUnchanged += nUnchanged
  console.log(
    `OK    ${r.report_key.padEnd(34)} ${cfg.mode.padEnd(8)} ${String(periods.length).padStart(3)} periods  ` +
    `(new ${nNew}, changed ${nChanged}, unchanged ${nUnchanged})`,
  )
}

console.log(
  `\nTotals: new ${totNew}, changed ${totChanged}, unchanged ${totUnchanged}, empty ${totEmpty}, failed ${failed}`,
)
if (failed > 0) {
  console.error(`\n✗ ${failed} report(s) failed — see FAIL lines above.`)
  process.exit(1)
}
console.log('\n✓ backfill complete.')
