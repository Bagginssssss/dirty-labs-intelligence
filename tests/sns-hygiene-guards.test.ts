// INB-174 — S&S data-hygiene guards (two independent failure modes):
//   Item 2 (backdated snapshot): a sns_dashboard_snapshots upload with date_range_start >14 days back
//     or in the future — snapshots have no date column, so backdating stamps today's values on an old date.
//   Item 3 (zeroed balance): a subscribe_and_save upload with >50% of rows at active_subscriptions 0/null
//     is REPAIRED (stored, balance column nulled, warned) — not rejected, since the rest is good.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { backdatedSnapshotViolation } from '../lib/mappers/sns-dashboard-snapshots.ts'
import { subscribeAndSaveZeroBalanceWarning } from '../lib/mappers/subscribe-and-save.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')
const daysAgo = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

// ── Item 2 helper: backdated-snapshot ────────────────────────────────────────────
test('backdated: >14 days back is flagged, naming both dates; the two real phantoms (54d, 32d) trip', () => {
  assert.match(backdatedSnapshotViolation('2026-07-01', '2026-08-24'), /54 days before the upload date 2026-08-24/)
  assert.match(backdatedSnapshotViolation('2026-07-30', '2026-08-31'), /32 days/)
})
test('backdated: same-day and 1-day back pass (1-day is legitimate + in active use)', () => {
  assert.equal(backdatedSnapshotViolation('2026-08-31', '2026-08-31'), null) // 0
  assert.equal(backdatedSnapshotViolation('2026-08-30', '2026-08-31'), null) // 1
})
test('backdated: 14 days passes, 15 days fails (threshold boundary)', () => {
  assert.equal(backdatedSnapshotViolation('2026-08-17', '2026-08-31'), null)      // exactly 14
  assert.match(backdatedSnapshotViolation('2026-08-16', '2026-08-31'), /15 days/) // 15
})
test('backdated: any future date is flagged; a missing form date passes (defaults to upload day)', () => {
  assert.match(backdatedSnapshotViolation('2026-09-05', '2026-08-31'), /future/)
  assert.equal(backdatedSnapshotViolation('', '2026-08-31'), null)
  assert.equal(backdatedSnapshotViolation(null, '2026-08-31'), null)
})

// ── Item 3 helper: zeroed balance (detector — the route repairs, does not reject) ─────
const mkSubs = (zeros: number, nonzeros: number) => [
  ...Array.from({ length: zeros }, () => ({ active_subscriptions: 0 })),
  ...Array.from({ length: nonzeros }, () => ({ active_subscriptions: 500 })),
]
test('zeroed balance: 17 of 22 zero (77%) flagged; 1 of 18 (5.6%) passes', () => {
  assert.match(subscribeAndSaveZeroBalanceWarning(mkSubs(17, 5)), /17\/22 rows \(77%\)/)
  assert.equal(subscribeAndSaveZeroBalanceWarning(mkSubs(1, 17)), null)
})
test('zeroed balance: >50% flagged, exactly 50% not; all-zero flagged; empty passes', () => {
  assert.ok(subscribeAndSaveZeroBalanceWarning(mkSubs(12, 10)))       // 54.5% → flag
  assert.equal(subscribeAndSaveZeroBalanceWarning(mkSubs(11, 11)), null) // 50% → pass
  assert.ok(subscribeAndSaveZeroBalanceWarning(mkSubs(3, 0)))          // 100% → flag
  assert.equal(subscribeAndSaveZeroBalanceWarning([]), null)
})
test('zeroed balance: nulls count as zero (a future blank-balance export must not slip past === 0)', () => {
  const rows = [
    ...Array.from({ length: 10 }, () => ({ active_subscriptions: null })),
    ...Array.from({ length: 3 }, () => ({ active_subscriptions: 0 })),
    ...Array.from({ length: 5 }, () => ({ active_subscriptions: 500 })),
  ]
  assert.match(subscribeAndSaveZeroBalanceWarning(rows), /13\/18/) // 10 null + 3 zero = 13 of 18 (72%)
})

// ── e2e through the real route + fixtures (capture subscribe_and_save inserts + the audit log) ──
const snsInserts: Record<string, unknown>[] = []
const logInserts: Record<string, unknown>[] = []
const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') return send(200, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : [])
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/subscribe_and_save')) {
      try { const b = JSON.parse(raw); if (Array.isArray(b)) snsInserts.push(...b) } catch { /* ignore */ }
    }
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/report_ingestion_log')) {
      try { const b = JSON.parse(raw); logInserts.push(Array.isArray(b) ? b[0] : b) } catch { /* ignore */ }
    }
    send(wantsObject ? 200 : 201, wantsObject ? { id: '00000000-0000-4000-8000-000000000001' } : [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

function upload(csv: string, name: string, dateStart?: string): FormData {
  const body = new FormData()
  body.append('file', new File([csv], name, { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  if (dateStart != null) { body.append('date_range_start', dateStart); body.append('date_range_end', dateStart) }
  return body
}
const post = (csv: string, name: string, dateStart?: string) =>
  POST(new Request('http://localhost/api/ingest', { method: 'POST', body: upload(csv, name, dateStart) }))

test('e2e item 2: a snapshot upload backdated 54 days → 400 naming the report + both dates', async () => {
  const res = await post(fixture('sns-snap-ltv.csv'), 'SubscriberLifetime.csv', daysAgo(54))
  assert.equal(res.status, 400)
  const json = await res.json() as Record<string, unknown>
  assert.match(String(json.error), /snapshot/i)
  assert.match(String(json.error), /54 days/)
})
test('e2e item 2: a future-dated snapshot → 400', async () => {
  const res = await post(fixture('sns-snap-ltv.csv'), 'SubscriberLifetime.csv', daysAgo(-5))
  assert.equal(res.status, 400)
  assert.match(String((await res.json() as Record<string, unknown>).error), /future/)
})
test('e2e item 2: a snapshot backdated 1 day → NOT 400 (legitimate)', async () => {
  const res = await post(fixture('sns-snap-ltv.csv'), 'SubscriberLifetime.csv', daysAgo(1))
  assert.notEqual(res.status, 400)
})

test('e2e item 3: a 17-of-22 zeroed-balance S&S upload → 200, balance NULLED, revenue/units kept, warned, logged partial', async () => {
  snsInserts.length = 0; logInserts.length = 0
  const res = await post(fixture('subscribe-and-save-zeroed.csv'), 'SubscribeSave.csv')
  assert.equal(res.status, 200, 'stored, not rejected')
  const json = await res.json() as Record<string, unknown>
  // stored rows: active_subscriptions NULLED on every row; per-SKU revenue + units survive
  assert.ok(snsInserts.length >= 22, `rows stored (${snsInserts.length})`)
  assert.ok(snsInserts.every(r => r.active_subscriptions === null), 'active_subscriptions NULLED on every stored row')
  assert.ok(snsInserts.some(r => r.ss_revenue != null && Number(r.ss_revenue) > 0), 'per-SKU revenue survives')
  assert.ok(snsInserts.some(r => r.ss_units_shipped != null), 'units survive')
  // prominent, auditable warning naming the report + proportion; independent of item 2
  const warn = String((json.parse_errors as string[] | undefined)?.join(' | ') ?? '')
  assert.match(warn, /zeroed-balance/)
  assert.match(warn, /17\/22/)
  assert.doesNotMatch(warn, /snapshot date/)
  // audit trail: report_ingestion_log records it as partial with the warning in error_message
  assert.equal(logInserts.at(-1)?.status, 'partial')
  assert.match(String(logInserts.at(-1)?.error_message ?? ''), /zeroed-balance/)
})
test('e2e item 3: a legitimate S&S pull (1 of 18 zero) → 200, untouched (no warning, balance kept, logged success)', async () => {
  snsInserts.length = 0; logInserts.length = 0
  const res = await post(fixture('subscribe-and-save-legit.csv'), 'SubscribeSave.csv')
  assert.equal(res.status, 200)
  const json = await res.json() as Record<string, unknown>
  const warn = String((json.parse_errors as string[] | undefined)?.join(' | ') ?? '')
  assert.doesNotMatch(warn, /zeroed-balance/, 'a legit pull is not repaired')
  assert.ok(snsInserts.some(r => r.active_subscriptions != null && Number(r.active_subscriptions) > 0), 'balance kept intact')
  assert.equal(logInserts.at(-1)?.status, 'success')
})
