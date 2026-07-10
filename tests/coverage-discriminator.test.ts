// INB-146 — shared discriminator interpreter (all three jsonb shapes).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  interpretDiscriminator,
  discriminatorPredicate,
  coverageFilterValues,
} from '../lib/coverage/discriminator.ts'

test('interpret: null → whole table', () => {
  assert.deepEqual(interpretDiscriminator(null), { kind: 'all' })
})

test('interpret: value shape → in-filter; ignores the optional asin echo', () => {
  assert.deepEqual(interpretDiscriminator({ column: 'ad_type', values: ['SB', 'SBV'] }), {
    kind: 'in', column: 'ad_type', values: ['SB', 'SBV'],
  })
  assert.deepEqual(
    interpretDiscriminator({ column: 'asin_id', values: ['04a2dc1b-6fe1-4043-9004-04d97ee3eb4e'], asin: 'B09B7YS1VK' }),
    { kind: 'in', column: 'asin_id', values: ['04a2dc1b-6fe1-4043-9004-04d97ee3eb4e'] },
  )
})

test('interpret: op shape → null-check (is_null / is_not_null)', () => {
  assert.deepEqual(interpretDiscriminator({ column: 'advertised_asin', op: 'is_null' }), {
    kind: 'null', column: 'advertised_asin', isNull: true,
  })
  assert.deepEqual(interpretDiscriminator({ column: 'advertised_asin', op: 'is_not_null' }), {
    kind: 'null', column: 'advertised_asin', isNull: false,
  })
})

test('predicate: all three shapes select the right rows', () => {
  const all = discriminatorPredicate(null)
  assert.equal(all({ anything: 1 }), true)

  const sp = discriminatorPredicate({ column: 'ad_type', values: ['SP'] })
  assert.equal(sp({ ad_type: 'SP' }), true)
  assert.equal(sp({ ad_type: 'SB' }), false)

  const missing = discriminatorPredicate({ column: 'advertised_asin', op: 'is_null' })
  assert.equal(missing({ advertised_asin: null }), true)
  assert.equal(missing({ advertised_asin: 'B00X' }), false)
})

test('coverageFilterValues: null→whole table, values→array, op-shape throws (RPC unsupported)', () => {
  assert.equal(coverageFilterValues(null), null)
  assert.deepEqual(coverageFilterValues({ column: 'log_type', values: ['import'] }), ['import'])
  assert.throws(() => coverageFilterValues({ column: 'advertised_asin', op: 'is_null' }), /not supported/)
})
