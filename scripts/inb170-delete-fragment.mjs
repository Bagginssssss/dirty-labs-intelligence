// INB-170 G3 — remove the malformed subscribe_and_save fragment (report_date 2026-05-21,
// date_range_end 2026-06-20; 3 all-null-revenue rows bundled into the 2026-06-22 upload).
//
// The delete is scoped to BOTH report_date AND date_range_end — report_date alone would take the
// legitimate 20-row 2026-06-19 pull with it. Values are not modified; only these 3 rows are removed.
//
// SAFETY:
//  • Dumps the 3 rows in full to a durable recovery file BEFORE deleting; aborts if it already exists.
//  • Asserts the SELECT returns exactly 3 rows before deleting, and that exactly 3 are deleted.
//  • Verifies the table drops 549 → 546.
//  • Idempotent: a re-run finds 0 rows at the fragment key and exits without touching anything.
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-admin.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const RD = '2026-05-21'
const DE = '2026-06-20'
const path = join(homedir(), 'Downloads', 'inb170-sns-fragment-baseline-2026-08-11.csv')

const COLS = 'asin_id,sku,report_date,date_range_end,active_subscriptions,new_subscriptions,cancelled_subscriptions,' +
  'ss_units_shipped,ss_revenue,ss_discount_amount,reorder_rate,fulfilled_by,category,seller_funding_pct,' +
  'sns_sales_penetration,oos_rate,lost_sales_oos,coupon_subscription_share,coupon_sales_penetration,ingested_at'

// ── 1. Read the fragment rows ──────────────────────────────────────────────────────
const { data: rows, error: readErr } = await supabaseAdmin
  .from('subscribe_and_save').select(COLS)
  .eq('brand_id', BRAND).eq('report_date', RD).eq('date_range_end', DE)
  .order('sku', { ascending: true })
if (readErr) { console.error('read failed:', readErr.message); process.exit(1) }

if ((rows?.length ?? 0) === 0) {
  console.log('no fragment rows at', RD, '/', DE, '— nothing to do (already clean).')
  process.exit(0)
}
if (rows.length !== 3) {
  console.error(`ABORT: expected exactly 3 fragment rows, found ${rows.length} — investigate before deleting.`)
  process.exit(1)
}

// ── 2. Recovery dump (restore point) ───────────────────────────────────────────────
if (existsSync(path)) {
  console.error('ABORT: recovery file already exists — not overwriting the restore point:', path)
  process.exit(1)
}
const header = COLS
const csv = header + '\n' + rows.map(r => COLS.split(',').map(c => {
  const v = r[c]
  return v == null ? '' : (String(v).includes(',') ? `"${v}"` : String(v))
}).join(',')).join('\n') + '\n'
writeFileSync(path, csv)
console.log('DUMPED', rows.length, 'fragment rows →', path)

// ── 3. Scoped delete (BOTH report_date AND date_range_end) ──────────────────────────
const { data: deleted, error: delErr } = await supabaseAdmin
  .from('subscribe_and_save').delete()
  .eq('brand_id', BRAND).eq('report_date', RD).eq('date_range_end', DE)
  .select('sku')
if (delErr) { console.error('delete failed:', delErr.message); process.exit(1) }
console.log('DELETED', deleted?.length, 'rows:', (deleted ?? []).map(r => r.sku).join(', '))
if (deleted?.length !== 3) { console.error('POST-CHECK FAILED: expected 3 deleted'); process.exit(1) }

// ── 4. Verify table count ───────────────────────────────────────────────────────────
const { count, error: cErr } = await supabaseAdmin
  .from('subscribe_and_save').select('*', { count: 'exact', head: true }).eq('brand_id', BRAND)
if (cErr) { console.error('count failed:', cErr.message); process.exit(1) }
console.log('subscribe_and_save total:', count, '(expected 546)')
if (count !== 546) { console.error('POST-CHECK FAILED: expected 546 rows'); process.exit(1) }
console.log('OK — fragment removed, 546 rows remain.')
