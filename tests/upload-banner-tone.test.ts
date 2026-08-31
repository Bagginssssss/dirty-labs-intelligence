// INB-174 item 3 (the other half) — the upload card must not render green when a warning was surfaced.
// A zeroed-balance repair stores every row (rows_rejected = 0) but NULLs the balance column; keying the
// card tone on rows_rejected alone painted it green and buried the warning — the exact silence item 3's
// null-the-column design assumes the operator will notice. deriveBannerTone folds surfaced [warning]s
// into the amber 'partial' tone while keeping benign [info] notes green.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveBannerTone } from '../lib/upload/banner-tone.ts'

// The new S&S balance repair — the case that motivated the fix. Stores all rows, rejects none.
test('zeroed-balance repair (rows_rejected 0, [warning] in parse_errors) → partial', () => {
  assert.equal(deriveBannerTone({
    status: 'ok', rows_rejected: 0,
    parse_errors: ['[warning] S&S Performance zeroed-balance repair: 17/22 rows (77%) … active_subscriptions was NULLED'],
  }), 'partial')
})

// Pre-existing silence this also fixes: sku_economics net-proceeds failures (19 of 87 uploads) surfaced
// a [warning] on a rows_rejected=0 upload and still rendered green. Proof the fix is not S&S-only.
test('[warning] net-proceeds shape (rows_rejected 0) → partial (fixes the pre-existing silence)', () => {
  assert.equal(deriveBannerTone({
    status: 'ok', rows_rejected: 0,
    parse_errors: ['[warning] 12 row(s) failed the net-proceeds identity …'],
  }), 'partial')
})

// The honesty guard: an [info]-only note is purely explanatory and must stay green, or amber stops
// meaning anything (alarm fatigue). Without this case the natural next change is "amber for anything
// in parse_errors", which is the failure mode.
test('[info]-only star-filtered note (rows_rejected 0) → complete (no over-alerting)', () => {
  assert.equal(deriveBannerTone({
    status: 'ok', rows_rejected: 0,
    parse_errors: ['[info] 3 of 40 item(s) are from star-filtered runs — rating snapshots skipped'],
  }), 'complete')
})

// An [info] note alongside a [warning] still trips amber — the warning wins.
test('mixed [info] + [warning] → partial (a warning anywhere wins)', () => {
  assert.equal(deriveBannerTone({
    status: 'ok', rows_rejected: 0,
    parse_errors: ['[info] star-filtered run note', '[warning] unmapped return reason code'],
  }), 'partial')
})

// Untagged messages default to the warning side (safe direction).
test('untagged parse_error (rows_rejected 0) → partial (untagged defaults to warning)', () => {
  assert.equal(deriveBannerTone({
    status: 'ok', rows_rejected: 0, parse_errors: ['Row 4: could not parse quantity'],
  }), 'partial')
})

// Re-pins of the two existing tones — must not regress.
test('clean success (no rejects, no parse_errors) → complete', () => {
  assert.equal(deriveBannerTone({ status: 'ok', rows_rejected: 0, parse_errors: [] }), 'complete')
})
test('row rejections → partial (existing behaviour preserved)', () => {
  assert.equal(deriveBannerTone({ status: 'ok', rows_rejected: 3, parse_errors: ['Row rejected: …'] }), 'partial')
})
test('a 400 / thrown error (no status:ok, or error set) → failed', () => {
  assert.equal(deriveBannerTone({ error: 'Upload blocked: …' }), 'failed')
  assert.equal(deriveBannerTone({ status: 'error', error: 'network' }), 'failed')
})
