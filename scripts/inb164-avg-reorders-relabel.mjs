// INB-164 G3 — backfill-correct the 6 legacy avg_reorders rows whose labels Amazon relabeled.
//
// Amazon permanently relabeled Subscribers/Non-subscribers → Subscriber/Non-subscriber between the
// 07-27 and 08-04 snapshots. The loader now canonicalizes on ingest (lib/mappers/sns-dashboard-
// snapshots.ts), so this one-time repair aligns the 6 legacy rows (2026-07-14 / 07-20 / 07-27) that
// were stored BEFORE that change. Values are untouched — only dim1.
//
// ORDER: this runs AFTER the loader change ships. Backfilling first, then re-uploading through an
// un-normalized loader, would re-split the labels.
//
// SAFETY:
//  • Dumps ALL avg_reorders rows to a durable recovery file BEFORE any write; aborts if the file
//    already exists (never overwrite the restore point on a re-run).
//  • Scoped to report='avg_reorders' — never touches subscriber_ltv 'Non-Subscriber' (capital S),
//    subscriber_retention, or deliveries_breakdown.
//  • No uq collision: the 3 affected dates hold ONLY the plural rows, so no singular twin exists to
//    collide with on the (brand_id, snapshot_date, report, dim1, dim2) key (unlike the INB-150 case).
//  • Idempotent: a second run finds 0 plural rows → 0 updates.
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-admin.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const RELABEL = [
  ['Subscribers', 'Subscriber'],
  ['Non-subscribers', 'Non-subscriber'],
]

// ── 1. Recovery dump (restore point) ─────────────────────────────────────────────
const path = join(homedir(), 'Downloads', 'inb164-avg_reorders-baseline-2026-08-11.csv')
if (existsSync(path)) {
  console.error('ABORT: baseline already exists — not overwriting the restore point:', path)
  process.exit(1)
}
const { data: before, error: readErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots')
  .select('snapshot_date,report,dim1,dim2,value')
  .eq('brand_id', BRAND).eq('report', 'avg_reorders')
  .order('snapshot_date', { ascending: true }).order('dim1', { ascending: true })
if (readErr) { console.error('read failed:', readErr.message); process.exit(1) }
const rows = before ?? []
const csv = 'snapshot_date,report,dim1,dim2,value\n' +
  rows.map(r => `${String(r.snapshot_date).slice(0, 10)},${r.report},"${r.dim1}","${r.dim2}",${r.value}`).join('\n') + '\n'
writeFileSync(path, csv)
console.log('DUMPED', rows.length, 'avg_reorders rows →', path)

// ── 2. Relabel the legacy plural rows (values untouched; dim1 only) ───────────────
let totalUpdated = 0
for (const [from, to] of RELABEL) {
  const { data, error } = await supabaseAdmin
    .from('sns_dashboard_snapshots')
    .update({ dim1: to })
    .eq('brand_id', BRAND).eq('report', 'avg_reorders').eq('dim1', from)
    .select('snapshot_date')
  if (error) { console.error(`UPDATE ${from}→${to} failed:`, error.message); process.exit(1) }
  const n = data?.length ?? 0
  totalUpdated += n
  console.log(`relabel '${from}' → '${to}': ${n} rows (${(data ?? []).map(r => String(r.snapshot_date).slice(0, 10)).join(', ')})`)
}
console.log('TOTAL relabeled:', totalUpdated, '(expected 6 on a first run)')

// ── 3. Verify final state ─────────────────────────────────────────────────────────
const { data: after, error: afterErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots')
  .select('dim1')
  .eq('brand_id', BRAND).eq('report', 'avg_reorders')
if (afterErr) { console.error('verify read failed:', afterErr.message); process.exit(1) }
const distinct = [...new Set((after ?? []).map(r => r.dim1))].sort()
console.log('avg_reorders rows:', after?.length, '| distinct dim1:', JSON.stringify(distinct))
if (after?.length !== 10 || distinct.length !== 2 || !distinct.includes('Subscriber') || !distinct.includes('Non-subscriber')) {
  console.error('POST-CHECK FAILED: expected 10 rows / exactly [Non-subscriber, Subscriber]')
  process.exit(1)
}
console.log('OK — 10 rows, exactly 2 canonical labels.')
