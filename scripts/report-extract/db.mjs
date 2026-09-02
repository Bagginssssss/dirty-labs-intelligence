// INB-178 Phase 2 — read-only Supabase connection for the report extractor.
//
// Uses the repo's EXISTING service-role credential pattern (mirrors lib/supabase-admin.ts): the same
// two env vars, no new secret, no new env-var name. READ-ONLY BY DISCIPLINE — this module exposes only
// a SELECT helper (selectAll); it never inserts, updates, or deletes, and every query in the extractor
// is a SELECT. (The repo has no separate read-only credential; the anon key would be RLS-blocked on
// these tables. Flagged at G1 in case a different posture is wanted.)
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
    'Run with: node --env-file-if-exists=.env.local scripts/report-extract/run.mjs',
  )
}

const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Read every row of a SELECT, paging past PostgREST's 1000-row default cap. Read-only — only .select()
// is ever issued. Throws on any error (a partial read must never look like a full one).
//
// STABLE TOTAL ORDER IS ENFORCED, not merely documented: paging with .range() is only correct if the
// server-side sort is total. A sort on tied columns (e.g. sp_campaign_performance has 82,164 rows over
// 486 report_date values — every date ties) leaves row order UNDEFINED within a tie group, so rows can
// duplicate or drop across page boundaries → a silently wrong sum, the exact failure this batch exists
// to catch. So: `order` is REQUIRED (throws if absent), and a unique tiebreaker (`id` by default,
// overridable via `tiebreaker`) is appended automatically unless the caller already ordered on it.
//
//   selectAll('business_report_daily', 'report_date,ordered_product_sales', {
//     filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', '2026-01-01').lte('report_date', '2026-08-29'),
//     order:  [{ column: 'report_date' }],   // `id` appended automatically → total order
//   })
export async function selectAll(table, columns, { filter, order, tiebreaker = 'id' } = {}) {
  if (!order || order.length === 0) {
    throw new Error(
      `selectAll(${table}): an explicit \`order\` is required — a stable total order is what keeps rows ` +
      `from duplicating or dropping across page boundaries.`,
    )
  }
  // Append the unique tiebreaker so ties on the caller's columns can't leave order undefined.
  const fullOrder = order.some(o => o.column === tiebreaker) ? order : [...order, { column: tiebreaker }]
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    let q = client.from(table).select(columns).range(from, from + pageSize - 1)
    if (filter) q = filter(q)
    for (const o of fullOrder) q = q.order(o.column, { ascending: o.ascending ?? true })
    const { data, error } = await q
    if (error) throw new Error(`select ${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

export const db = { selectAll }
