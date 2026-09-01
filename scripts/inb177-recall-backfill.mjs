// INB-177 G3 — reclassify the 1 stored fba_customer_returns row with reason='RECALL' from the
// ingest-time snapshot fault_class='unmapped' to 'product_fault' (migration 060 added the map entry;
// adding the map row alone does NOT touch already-stored snapshots).
//
// SAFETY:
//  • Asserts EXACTLY 1 matching row (reason='RECALL' AND fault_class='unmapped') before writing —
//    aborts otherwise (guards against a wider match if new RECALL rows landed since G1).
//  • Dumps the row(s) to a durable recovery file BEFORE the UPDATE; aborts if the file exists.
//  • Scoped UPDATE (reason='RECALL' AND fault_class='unmapped'); asserts exactly 1 updated.
//  • Verifies post-state: 0 rows at fault_class='unmapped', product_fault 3574→3575, total unchanged.
//  • Idempotent: a re-run finds 0 unmapped RECALL rows and exits cleanly.
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-admin.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const path = join(homedir(), 'Downloads', 'inb177-recall-baseline-2026-09-01.csv')
const COLS = ['return_ts', 'return_date', 'order_id', 'sku', 'lpn', 'occurrence', 'reason', 'fault_class']

// ── 1. Read the unmapped RECALL row(s) ──────────────────────────────────────────────
const { data: rows, error: readErr } = await supabaseAdmin
  .from('fba_customer_returns').select(COLS.join(','))
  .eq('brand_id', BRAND).eq('reason', 'RECALL').eq('fault_class', 'unmapped')
  .order('return_ts', { ascending: true }).order('order_id', { ascending: true })
if (readErr) { console.error('read failed:', readErr.message); process.exit(1) }
if ((rows?.length ?? 0) === 0) { console.log('no unmapped RECALL rows — nothing to do (already backfilled).'); process.exit(0) }
if (rows.length !== 1) { console.error(`ABORT: expected exactly 1 unmapped RECALL row, found ${rows.length}.`); process.exit(1) }

// ── 2. Recovery dump (restore point) ────────────────────────────────────────────────
if (existsSync(path)) { console.error('ABORT: recovery file already exists — not overwriting:', path); process.exit(1) }
const csv = COLS.join(',') + '\n' + rows.map(r => COLS.map(c => {
  const v = r[c]; return v == null ? '' : (String(v).includes(',') ? `"${v}"` : String(v))
}).join(',')).join('\n') + '\n'
writeFileSync(path, csv)
console.log('DUMPED', rows.length, 'row →', path)

// ── 3. Scoped UPDATE ────────────────────────────────────────────────────────────────
const { data: updated, error: updErr } = await supabaseAdmin
  .from('fba_customer_returns').update({ fault_class: 'product_fault' })
  .eq('brand_id', BRAND).eq('reason', 'RECALL').eq('fault_class', 'unmapped')
  .select('order_id')
if (updErr) { console.error('update failed:', updErr.message); process.exit(1) }
console.log('UPDATED', updated?.length, 'row → fault_class=product_fault')
if (updated?.length !== 1) { console.error('POST-CHECK FAILED: expected exactly 1 updated'); process.exit(1) }

// ── 4. Verify post-state ────────────────────────────────────────────────────────────
const count = async (extra) => {
  let q = supabaseAdmin.from('fba_customer_returns').select('*', { count: 'exact', head: true }).eq('brand_id', BRAND)
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v)
  const { count: c, error } = await q
  if (error) { console.error('count failed:', error.message); process.exit(1) }
  return c
}
const unmapped = await count({ fault_class: 'unmapped' })
const productFault = await count({ fault_class: 'product_fault' })
const total = await count({})
console.log(`post-state: unmapped=${unmapped} (expect 0), product_fault=${productFault} (expect 3575), total=${total} (expect 15998)`)
if (unmapped !== 0 || productFault !== 3575 || total !== 15998) { console.error('POST-CHECK FAILED'); process.exit(1) }
console.log('OK — RECALL reclassified to product_fault; 0 unmapped remain.')
