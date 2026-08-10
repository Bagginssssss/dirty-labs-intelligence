// INB-166 — window-per-pull coverage rebuild for business_report_child_asin + subscribe_and_save.
// Coverage-layer ONLY (no fact-table writes). Each PULL becomes ONE report_coverage row spanning
// [window_start, window_end] with data_through = window_end (the covered-window END, not the start).
// Idempotent: both window sets are computed BEFORE any DELETE; then DELETE the key's rows + insert.
// NOTE: DELETE→INSERT is not transactional — coverage is fully derived and the script is idempotent,
// but do not run it unattended (a mid-run insert failure leaves that key empty until re-run).
//
// TIE-BREAK (SAME rule in both functions): the FULLEST pull wins — max fact rows, then the later
// end / latest ingest only as a tiebreak. A malformed 3-row fragment never beats the real pull.
//
//   business_report_child_asin — fact report_date is the window START; there is no end column, so the
//     end comes from report_ingestion_log (report_type='business_report', date_range_start=report_date,
//     non-null ranges, rows_stored>0): max rows_stored, latest ingested_at as tiebreak. FAIL LOUDLY
//     (exit 1, no writes) on any unresolvable start — never approximate with report_date+30.
//   subscribe_and_save — count fact rows per (report_date, date_range_end); per report_date pick the
//     window with the most rows (later end as tiebreak).
//
//   node --import ./scripts/test-register.mjs --env-file-if-exists=.env.local scripts/inb166-window-coverage.mjs

import { supabaseAdmin } from '../lib/supabase-admin.ts'

const BRAND = process.env.INB166_BRAND_ID ?? '47a96175-ed58-4104-a2ff-c925d6143309'
const CAP = 1000 // PostgREST default max rows — assert we never silently truncate a read.
const d10 = v => String(v).slice(0, 10)

function windowRow(reportKey, start, end) {
  return {
    report_key: reportKey,
    period_start: start,
    period_end: end,
    period_label: `Window ${start} → ${end}`,
    period_type: 'snapshot',   // windowPerPull: a multi-day span, so period_start ≠ period_end
    data_through: end,
    event_driven: false,
    source: 'derived',
  }
}

// Fullest pull wins: max rows, then a later end + later ingest as deterministic tiebreaks.
function pickFullest(cands) {
  return cands.slice().sort((a, b) =>
    (b.rows - a.rows) || b.end.localeCompare(a.end) || String(b.ing ?? '').localeCompare(String(a.ing ?? '')),
  )[0]
}
function logChoice(reportKey, start, cands, best) {
  if (cands.length > 1) {
    const others = cands.filter(c => c !== best).map(c => `${c.end}/${c.rows}r`).join(', ')
    console.log(`  note ${reportKey} ${start}: ${cands.length} candidates → chose ${best.end} (${best.rows}r); others ${others}`)
  }
}

async function businessReportWindows() {
  const { data: dd, error: e0 } = await supabaseAdmin.rpc('get_coverage_dates', {
    p_brand_id: BRAND, p_source_table: 'business_report', p_filter_values: null,
  })
  if (e0) throw new Error(`business_report get_coverage_dates: ${e0.message}`)
  const starts = [...new Set((dd ?? []).map(x => d10(x.d)))].sort()

  const { data: logs, error: e1 } = await supabaseAdmin
    .from('report_ingestion_log')
    .select('date_range_start,date_range_end,rows_stored,ingested_at')
    .eq('brand_id', BRAND).eq('report_type', 'business_report')
    .not('date_range_start', 'is', null).not('date_range_end', 'is', null)
  if (e1) throw new Error(`ingestion_log read: ${e1.message}`)
  if ((logs ?? []).length >= CAP) throw new Error('ingestion_log read hit the row cap — add pagination')

  const byStart = new Map() // start -> [{end, rows, ing}]
  for (const l of (logs ?? [])) {
    if ((l.rows_stored ?? 0) <= 0) continue
    const s = d10(l.date_range_start)
    if (!byStart.has(s)) byStart.set(s, [])
    byStart.get(s).push({ end: d10(l.date_range_end), rows: l.rows_stored ?? 0, ing: String(l.ingested_at) })
  }

  const rows = [], unresolved = []
  for (const s of starts) {
    const cands = byStart.get(s)
    if (!cands || cands.length === 0) { unresolved.push(s); continue }
    const best = pickFullest(cands)
    logChoice('business_report_child_asin', s, cands, best)
    rows.push(windowRow('business_report_child_asin', s, best.end))
  }
  if (unresolved.length) {
    throw new Error(
      `business_report: ${unresolved.length} report_date(s) with no resolvable ingest window ` +
      `[${unresolved.join(', ')}] — resolve the ingestion log before backfilling (no approximation).`)
  }
  return rows
}

async function snsWindows() {
  const { data, error } = await supabaseAdmin
    .from('subscribe_and_save').select('report_date,date_range_end').eq('brand_id', BRAND)
  if (error) throw new Error(`subscribe_and_save read: ${error.message}`)
  if ((data ?? []).length >= CAP) throw new Error('subscribe_and_save read hit the row cap — add pagination')

  // count fact rows per (report_date, date_range_end)
  const counts = new Map() // `${s}::${e}` -> rows
  for (const r of (data ?? [])) {
    if (!r.report_date || !r.date_range_end) continue
    const k = `${d10(r.report_date)}::${d10(r.date_range_end)}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const byStart = new Map() // start -> [{end, rows}]
  for (const [k, rows] of counts) {
    const [s, end] = k.split('::')
    if (!byStart.has(s)) byStart.set(s, [])
    byStart.get(s).push({ end, rows })
  }

  const out = []
  for (const s of [...byStart.keys()].sort()) {
    const cands = byStart.get(s)
    const best = pickFullest(cands)  // most rows wins → 2026-05-21 picks 06-19 (20r), not 06-20 (3r)
    logChoice('subscribe_and_save', s, cands, best)
    out.push(windowRow('subscribe_and_save', s, best.end))
  }
  return out
}

async function rebuild(reportKey, rows) {
  const { error: delErr } = await supabaseAdmin.from('report_coverage').delete().eq('report_key', reportKey)
  if (delErr) throw new Error(`delete ${reportKey}: ${delErr.message}`)
  if (rows.length) {
    const { error: insErr } = await supabaseAdmin.from('report_coverage').insert(rows)
    if (insErr) throw new Error(`insert ${reportKey}: ${insErr.message}`)
  }
  console.log(`OK  ${reportKey.padEnd(28)} ${String(rows.length).padStart(3)} windows  through ${rows.at(-1)?.period_end ?? '—'}`)
}

try {
  const br = await businessReportWindows()   // both computed BEFORE any delete
  const sns = await snsWindows()
  await rebuild('business_report_child_asin', br)
  await rebuild('subscribe_and_save', sns)
  console.log('\n✓ window-per-pull coverage rebuilt (coverage-layer only; no fact-table writes).')
} catch (e) {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
}
