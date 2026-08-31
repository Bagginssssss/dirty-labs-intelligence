// INB-174 G3 — remove the two backdated-snapshot phantoms from sns_dashboard_snapshots:
//   2026-07-01 (10 rows: 8 subscriber_ltv + 2 avg_reorders; ingested 2026-08-24, 54 days back)
//   2026-07-30 ( 8 rows: subscriber_ltv;                     ingested 2026-08-31, 32 days back)
// Both are today's snapshot values stamped onto an old date via a populated upload date-range —
// the exact defect the item-2 guard now blocks. The delete is scoped to these two EXPLICIT dates
// (not a rule-based backdate sweep); values are not modified.
//
// SAFETY:
//  • Pre-delete assertion: 2026-07-01 and 2026-07-30 must be the ONLY snapshot dates whose backdate
//    (ingested_at::date − snapshot_date) exceeds 14 — the same 14-day threshold the item-2 guard uses.
//    Abort if a third appears (something landed between G1 and G3). The delete stays date-scoped.
//  • Dumps all 18 rows to a durable recovery file BEFORE deleting; aborts if it already exists.
//  • Asserts exactly 18 rows read and 18 deleted; verifies the table drops 146 → 128.
//  • Idempotent: a re-run finds 0 rows at those dates and exits.
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-admin.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const DATES = ['2026-07-01', '2026-07-30']
const path = join(homedir(), 'Downloads', 'inb174-sns-phantoms-baseline-2026-08-31.csv')
const d10 = v => String(v).slice(0, 10)
const gapDays = (ing, snap) => Math.round((Date.parse(d10(ing) + 'T00:00:00Z') - Date.parse(d10(snap) + 'T00:00:00Z')) / 86400000)

// ── 1. Pre-delete safety assertion: exactly these two dates exceed the 14-day backdate threshold ──
const { data: all, error: allErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots').select('snapshot_date,ingested_at').eq('brand_id', BRAND)
if (allErr) { console.error('read failed:', allErr.message); process.exit(1) }
const backdated = [...new Set((all ?? []).filter(r => gapDays(r.ingested_at, r.snapshot_date) > 14).map(r => d10(r.snapshot_date)))].sort()
if (JSON.stringify(backdated) !== JSON.stringify(DATES)) {
  console.error(`ABORT: snapshot dates with backdate > 14 are ${JSON.stringify(backdated)} — expected exactly ${JSON.stringify(DATES)}. A third phantom may have landed; investigate before deleting.`)
  process.exit(1)
}
console.log('SAFETY OK — backdate>14 snapshot dates are exactly', JSON.stringify(DATES))

// ── 2. Read the 18 phantom rows to dump ────────────────────────────────────────────
const { data: rows, error: readErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots').select('snapshot_date,report,dim1,dim2,value,ingested_at')
  .eq('brand_id', BRAND).in('snapshot_date', DATES)
  .order('snapshot_date', { ascending: true }).order('report', { ascending: true })
  .order('dim1', { ascending: true }).order('dim2', { ascending: true })
if (readErr) { console.error('read failed:', readErr.message); process.exit(1) }
if ((rows?.length ?? 0) === 0) { console.log('no phantom rows at', DATES, '— nothing to do (already clean).'); process.exit(0) }
if (rows.length !== 18) { console.error(`ABORT: expected exactly 18 phantom rows, found ${rows.length}.`); process.exit(1) }

// ── 3. Recovery dump (restore point) ───────────────────────────────────────────────
if (existsSync(path)) { console.error('ABORT: recovery file already exists — not overwriting:', path); process.exit(1) }
const COLS = ['snapshot_date', 'report', 'dim1', 'dim2', 'value', 'ingested_at']
const csv = COLS.join(',') + '\n' + rows.map(r => COLS.map(c => {
  const v = c === 'snapshot_date' ? d10(r[c]) : r[c]
  return v == null ? '' : (String(v).includes(',') ? `"${v}"` : String(v))
}).join(',')).join('\n') + '\n'
writeFileSync(path, csv)
console.log('DUMPED', rows.length, 'phantom rows →', path)

// ── 4. Scoped delete (the two EXPLICIT dates) ───────────────────────────────────────
const { data: deleted, error: delErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots').delete()
  .eq('brand_id', BRAND).in('snapshot_date', DATES).select('snapshot_date,report')
if (delErr) { console.error('delete failed:', delErr.message); process.exit(1) }
console.log('DELETED', deleted?.length, 'rows —',
  DATES.map(d => `${d}: ${(deleted ?? []).filter(r => d10(r.snapshot_date) === d).length}`).join(', '))
if (deleted?.length !== 18) { console.error('POST-CHECK FAILED: expected 18 deleted'); process.exit(1) }

// ── 5. Verify table count ───────────────────────────────────────────────────────────
const { count, error: cErr } = await supabaseAdmin
  .from('sns_dashboard_snapshots').select('*', { count: 'exact', head: true }).eq('brand_id', BRAND)
if (cErr) { console.error('count failed:', cErr.message); process.exit(1) }
console.log('sns_dashboard_snapshots total:', count, '(expected 128)')
if (count !== 128) { console.error('POST-CHECK FAILED: expected 128 rows'); process.exit(1) }
console.log('OK — both phantoms removed, 128 rows remain.')
