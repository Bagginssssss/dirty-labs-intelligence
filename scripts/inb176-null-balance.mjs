// INB-176 G3 — null out the broken Period End Subscription Balance for the two 2026-08 S&S pulls that
// came through with active_subscriptions=0 before the INB-174 zeroed-balance guard existed. NULL (an
// honest gap), NOT the brand-level ~68,000 figure — we have no per-SKU truth, only the daily brand total.
//
// FACT-TABLE WRITE, scoped to report_date IN ('2026-07-24','2026-07-29') (44 rows). Touches only
// active_subscriptions; revenue / units / every other column and every OTHER report_date is untouched.
//
// ALL 44 ROWS, including the 5 non-zero balances in the 2026-07-29 pull (1,730 brand-wide against a
// true ~68,000): a pull reporting 1,730 is broken WHOLESALE, so those 5 are no more trustworthy than
// the 17 zeros — do NOT "fix" this to preserve the non-zeros. This also matches the live INB-174 guard,
// which nulls the column on EVERY row once the zero-proportion trips.
//
// SAFETY:
//  • Asserts EXACTLY 44 target rows before writing; aborts otherwise.
//  • Dumps all 44 rows (key + the columns that must survive) to a durable recovery file BEFORE the
//    UPDATE; aborts if the file exists.
//  • Scoped UPDATE; asserts exactly 44 updated and all 44 now NULL.
//  • Asserts revenue + units per report_date are byte-unchanged (the repair must touch only the balance).
//  • The REST-of-table byte-identical check (the INB-170 mis-scoped-WHERE lesson) + the target-checksum-
//    changed check are verified OUT-OF-BAND via SQL around this run — md5(string_agg(...)) is computed
//    in Postgres, not reimplemented here, so the hash is authoritative. PINNED FORMULA (same expression
//    for target and rest — only the WHERE differs):
//      md5(string_agg(
//        report_date::text||'|'||coalesce(sku,'')||'|'||
//        coalesce(active_subscriptions::text,'NULL')||'|'||coalesce(ss_revenue::text,'NULL'),
//        '~' order by report_date, sku))
//    G1 baselines under this formula:
//      target (report_date IN  the two dates, n=44)  = 677610e234c593e4b6eba6ce28a134d5  (MUST change)
//      rest   (report_date NOT IN the two dates, n=590) = 71ead1b88cb6d430598e37c0e82f4833  (MUST stay)
//  • Idempotent: a re-run finds the 44 rows already NULL and exits without re-dumping.
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-admin.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const DATES = ['2026-07-24', '2026-07-29']
const path = join(homedir(), 'Downloads', 'inb176-sns-balance-baseline-2026-09-01.csv')
const COLS = ['report_date', 'asin_id', 'sku', 'date_range_end', 'active_subscriptions', 'ss_revenue', 'ss_units_shipped']

// ── 1. Read the 44 target rows ──────────────────────────────────────────────────────
const { data: rows, error: readErr } = await supabaseAdmin
  .from('subscribe_and_save').select(COLS.join(','))
  .eq('brand_id', BRAND).in('report_date', DATES)
  .order('report_date', { ascending: true }).order('asin_id', { ascending: true }).order('sku', { ascending: true })
if (readErr) { console.error('read failed:', readErr.message); process.exit(1) }
if (rows.length !== 44) { console.error(`ABORT: expected exactly 44 target rows, found ${rows.length}.`); process.exit(1) }

const alreadyNull = rows.every(r => r.active_subscriptions == null)
if (alreadyNull) { console.log('all 44 target rows already have active_subscriptions=NULL — nothing to do (idempotent).'); process.exit(0) }

// Pre-state sums (must survive the repair unchanged).
const sumBy = (rs, col) => rs.reduce((s, r) => s + Number(r[col] ?? 0), 0)
const preRev = Object.fromEntries(DATES.map(d => [d, sumBy(rows.filter(r => String(r.report_date).slice(0, 10) === d), 'ss_revenue')]))
const preUnits = Object.fromEntries(DATES.map(d => [d, sumBy(rows.filter(r => String(r.report_date).slice(0, 10) === d), 'ss_units_shipped')]))
console.log('pre-state revenue:', preRev, 'units:', preUnits)

// ── 2. Recovery dump (restore point — carries the old active_subscriptions values) ──
if (existsSync(path)) { console.error('ABORT: recovery file already exists — not overwriting:', path); process.exit(1) }
const csv = COLS.join(',') + '\n' + rows.map(r => COLS.map(c => {
  const v = c === 'report_date' ? String(r[c]).slice(0, 10) : r[c]
  return v == null ? '' : (String(v).includes(',') ? `"${v}"` : String(v))
}).join(',')).join('\n') + '\n'
writeFileSync(path, csv)
console.log('DUMPED 44 rows →', path)

// ── 3. Scoped UPDATE (only active_subscriptions, only the two report_dates) ──────────
const { data: updated, error: updErr } = await supabaseAdmin
  .from('subscribe_and_save').update({ active_subscriptions: null })
  .eq('brand_id', BRAND).in('report_date', DATES).select('report_date')
if (updErr) { console.error('update failed:', updErr.message); process.exit(1) }
console.log('UPDATED', updated?.length, 'rows → active_subscriptions=NULL')
if (updated?.length !== 44) { console.error('POST-CHECK FAILED: expected 44 updated'); process.exit(1) }

// ── 4. Verify: all 44 NULL, revenue + units byte-unchanged, table row count steady ──
const { data: after, error: aErr } = await supabaseAdmin
  .from('subscribe_and_save').select(COLS.join(','))
  .eq('brand_id', BRAND).in('report_date', DATES)
if (aErr) { console.error('re-read failed:', aErr.message); process.exit(1) }
if (!after.every(r => r.active_subscriptions == null)) { console.error('POST-CHECK FAILED: not all 44 are NULL'); process.exit(1) }
for (const d of DATES) {
  const rs = after.filter(r => String(r.report_date).slice(0, 10) === d)
  const rev = sumBy(rs, 'ss_revenue'), units = sumBy(rs, 'ss_units_shipped')
  if (Math.abs(rev - preRev[d]) > 1e-6 || units !== preUnits[d]) {
    console.error(`POST-CHECK FAILED: ${d} revenue/units moved (rev ${preRev[d]}→${rev}, units ${preUnits[d]}→${units})`); process.exit(1)
  }
}
const { count: total, error: cErr } = await supabaseAdmin
  .from('subscribe_and_save').select('*', { count: 'exact', head: true }).eq('brand_id', BRAND)
if (cErr) { console.error('count failed:', cErr.message); process.exit(1) }
console.log(`post-state: 44 NULL, revenue+units unchanged, total=${total} (expect 634)`)
if (total !== 634) { console.error('POST-CHECK FAILED: total row count moved'); process.exit(1) }
console.log('OK — balance nulled for the two pulls. Now confirm out-of-band with the PINNED formula:')
console.log('  target (n=44)  MUST change from 677610e234c593e4b6eba6ce28a134d5')
console.log('  rest   (n=590) MUST stay      71ead1b88cb6d430598e37c0e82f4833')
