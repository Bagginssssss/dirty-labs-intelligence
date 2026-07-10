// INB-150 — scale_insights_bid_log NULL-proof key on change_value.
//
// The old key held nullable numeric bid_before/bid_after (NULL on 7,429 pause rows),
// so overlapping uploads duplicated silently. The fix: a NULL-proof text change_value
// (canonical "<before> -> <after>" at 2dp, '' for pauses) replaces the bids in the
// key; bids stay nullable numeric payload. change_value is produced identically by the
// mapper (formatBidChange) and the repair/migration backfill (to_char) so re-uploads
// are idempotent.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { detectReportType } from '../lib/report-detector.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// ---------------------------------------------------------------------------
// formatBidChange — canonical, format-parity with the SQL backfill
// ---------------------------------------------------------------------------

test('formatBidChange: canonical 2dp matches the to_char backfill for representative values', async () => {
  const { formatBidChange } = await import('../lib/mappers/scale-insights-bid-log.ts')
  // Each expected string equals to_char(x,'FM999999990.00') for the same value —
  // integers, .5 cases, max (9.96), min (0.02), and >=1000 (no thousands separator).
  assert.equal(formatBidChange(1.77, 2.04), '1.77 -> 2.04')
  assert.equal(formatBidChange(2, 3), '2.00 -> 3.00')
  assert.equal(formatBidChange(1.5, 2.0), '1.50 -> 2.00')
  assert.equal(formatBidChange(9.96, 0.02), '9.96 -> 0.02')
  assert.equal(formatBidChange(1234.5, 5.5), '1234.50 -> 5.50')
})

test('formatBidChange: both-null → empty; one-sided is encoded, never dropped', async () => {
  const { formatBidChange } = await import('../lib/mappers/scale-insights-bid-log.ts')
  assert.equal(formatBidChange(null, null), '')
  assert.equal(formatBidChange(1.77, null), '1.77 -> ')
  assert.equal(formatBidChange(null, 2.04), ' -> 2.04')
})

// ---------------------------------------------------------------------------
// Mapper: emits change_value; ''-normalizes target/rule_name
// ---------------------------------------------------------------------------

function bidRow(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Created: '2026-06-14', Campaign: 'SP.CO.PT - Booster', AdGroup: 'SP.CO.PT - Booster',
    Keyword: 'B00I8YAT42', Action: 'Bidding Rule', Rule: 'Increase Bid - No Clicks',
    Criteria: 'No Clicks', Change: '1.77 -> 2.04', Code: '', Details: '', ...o,
  }
}

test('mapper: bid row → change_value + parsed bids + normalized target/rule_name', async () => {
  const { mapScaleInsightsBidLog } = await import('../lib/mappers/scale-insights-bid-log.ts')
  const r = mapScaleInsightsBidLog(bidRow({}), BRAND) as Record<string, unknown>
  assert.equal(r.change_value, '1.77 -> 2.04')
  assert.equal(r.bid_before, 1.77)
  assert.equal(r.bid_after, 2.04)
  assert.equal(r.target, 'B00I8YAT42')
  assert.equal(r.rule_name, 'Increase Bid - No Clicks')
})

test('mapper: pause row (Change "enabled -> paused") → change_value empty, bids null', async () => {
  const { mapScaleInsightsBidLog } = await import('../lib/mappers/scale-insights-bid-log.ts')
  const r = mapScaleInsightsBidLog(bidRow({ Change: 'enabled -> paused', Rule: 'No Sales 4d LB', Criteria: 'No Sales' }), BRAND) as Record<string, unknown>
  assert.equal(r.change_value, '')
  assert.equal(r.bid_before, null)
  assert.equal(r.bid_after, null)
})

test('mapper: empty Keyword / Rule → \'\'-normalized (NOT NULL key cols)', async () => {
  const { mapScaleInsightsBidLog } = await import('../lib/mappers/scale-insights-bid-log.ts')
  const r = mapScaleInsightsBidLog(bidRow({ Keyword: '', Rule: '' }), BRAND) as Record<string, unknown>
  assert.equal(r.target, '')
  assert.equal(r.rule_name, '')
})

// ---------------------------------------------------------------------------
// Config: new key, allowlist removal
// ---------------------------------------------------------------------------

test('upsert-config: bid_log key is the NULL-proof 7-col key; no longer allowlisted', async () => {
  const { UPSERT_CONFLICT_KEYS, NULLABLE_KEY_ALLOWLIST } = await import('../lib/upsert-config.ts')
  assert.equal(
    UPSERT_CONFLICT_KEYS.scale_insights_bid_log,
    'brand_id,campaign_id,ad_group_id,change_timestamp,target,rule_name,change_value',
  )
  assert.ok(!('scale_insights_bid_log' in NULLABLE_KEY_ALLOWLIST), 'bid_log removed from allowlist')
})

test('nullable-key checker: enforced bid_log with an empty nullable set → no violation', async () => {
  const { findNullableUniqueKeyColumns } = await import('../lib/upsert-constraint-check.ts')
  const { NULLABLE_KEY_ALLOWLIST } = await import('../lib/upsert-config.ts')
  assert.deepEqual(
    findNullableUniqueKeyColumns(
      [{ table_name: 'scale_insights_bid_log', index_name: 'uq_bid_log', columns: ['brand_id', 'change_value'], nullable_columns: [] }],
      NULLABLE_KEY_ALLOWLIST,
    ),
    [],
  )
})

// ---------------------------------------------------------------------------
// Dedup on the new key
// ---------------------------------------------------------------------------

test('dedup: identical rows collapse on the new key; different bids (change_value) stay distinct', async () => {
  const { dedupeByConflictKey } = await import('../lib/ingest-validation.ts')
  const { UPSERT_CONFLICT_KEYS } = await import('../lib/upsert-config.ts')
  const key = UPSERT_CONFLICT_KEYS.scale_insights_bid_log
  const base = {
    brand_id: BRAND, campaign_id: 'c1', ad_group_id: 'a1', change_timestamp: '2026-06-14T00:00:00.000Z',
    target: 'kw', rule_name: 'R', change_value: '1.77 -> 2.04',
  }
  const dup = dedupeByConflictKey([{ ...base }, { ...base }], key)
  assert.equal(dup.collapsed, 1)
  const distinct = dedupeByConflictKey([{ ...base }, { ...base, change_value: '1.77 -> 2.10' }], key)
  assert.equal(distinct.collapsed, 0, 'a second same-day adjustment (different change_value) is a distinct row')
})

// ---------------------------------------------------------------------------
// Companion: detection + bid parsing unchanged
// ---------------------------------------------------------------------------

const BID_HEADERS = ['Created', 'ASIN', 'SKU', 'ShortName', 'Campaign', 'AdGroup', 'Keyword', 'Action', 'Rule', 'Criteria', 'Change', 'Code', 'Details']

test('companion: a Bidding Rule row still detects as scale_insights_bid_log', () => {
  const sample = { Created: '2026-06-14', Action: 'Bidding Rule', Rule: 'Increase Bid', Criteria: 'No Clicks', Change: '1.77 -> 2.04', Campaign: 'C', AdGroup: 'A', Keyword: 'k' }
  assert.equal(detectReportType(BID_HEADERS, sample).reportType, 'scale_insights_bid_log')
})

// ---------------------------------------------------------------------------
// e2e: bid-log upload upserts with the new 7-col onConflict
// ---------------------------------------------------------------------------

const bidUpserts: { onConflict: string | null }[] = []
const dbDouble = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) }
  if (req.method === 'GET') {
    if (wantsObject) return send(406, { code: 'PGRST116', message: 'zero rows' })
    return send(200, [])
  }
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname.endsWith('/rest/v1/scale_insights_bid_log')) {
      bidUpserts.push({ onConflict: url.searchParams.get('on_conflict') })
    }
    if (wantsObject) return send(201, { id: '11111111-0000-4000-8000-000000000001' })
    return send(201, [])
  })
})
await new Promise<void>(resolve => dbDouble.listen(0, '127.0.0.1', resolve))
dbDouble.unref()
after(() => dbDouble.close())
const port = (dbDouble.address() as { port: number }).port
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-dummy-key'
const { POST } = await import('../app/api/ingest/route.ts')

const BID_CSV = [
  BID_HEADERS.join(','),
  '2026-06-14,B09MSP7M5Y,112101-FBA,,SD.CO.PT - Booster,SD.CO.PT - Booster,B00I8YAT42,Bidding Rule,Increase Bid - No Clicks,No Clicks,1.77 -> 2.04,,',
].join('\n')

test('e2e: bid-log CSV upserts with the new 7-col onConflict', async () => {
  bidUpserts.length = 0
  const body = new FormData()
  body.append('file', new File([BID_CSV], 'BiddingRule_ChangeLogs.csv', { type: 'text/csv' }))
  body.append('brand_id', BRAND)
  body.append('date_range_start', '')
  body.append('date_range_end', '')
  const res = await POST(new Request('http://localhost/api/ingest', { method: 'POST', body }))
  const json = await res.json() as Record<string, unknown>
  assert.equal(json.table, 'scale_insights_bid_log')
  assert.ok(bidUpserts.length >= 1)
  assert.equal(bidUpserts[0].onConflict, 'brand_id,campaign_id,ad_group_id,change_timestamp,target,rule_name,change_value')
})
