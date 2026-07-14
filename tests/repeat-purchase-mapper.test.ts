// INB-141 — BA Repeat Purchase mapper (one mapper, both views; branch on ASIN presence).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRepeatPurchase } from '../lib/mappers/repeat-purchase.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

const METRICS = {
  'Number of Orders': '17890',
  'Unique Customer Count': '16475',
  'Repeat Ordered Product Sales: Sales': '39871.99',
  'Repeat Ordered Product Sales: Change vs. Prior Period': '13.87',
  'Repeat Ordered Product Sales: % Share of Total Sales': '8.07',
  'Repeat Ordered Units: Units': '1672',
  'Repeat Ordered Units: Change vs. Prior Period': '15.31',
  'Repeat Ordered Units: % Share of Total Units': '8.13',
  'Repeat Customer Count: Count': '1219',
  'Repeat Customer Count: Change vs. Prior Period': '10.12',
  'Repeat Customer Share: % Share of Total Customers': '7.4',
  'Repeat Customer Share: Change vs. Prior Period': '0.13',
}

test('brand row → level brand, asin empty, dims null, all 12 metrics', () => {
  const row = { 'Brand Name': 'Dirty Labs', ...METRICS, 'Reporting Date': '2026-07-11' }
  const out = mapRepeatPurchase(row, BRAND)
  assert.deepEqual(out, [{
    brand_id: BRAND, reporting_date: '2026-07-11', level: 'brand', asin: '', product_title: null, category: null,
    orders: 17890, unique_customers: 16475,
    repeat_sales: 39871.99, repeat_sales_change: 13.87, repeat_sales_share: 8.07,
    repeat_units: 1672, repeat_units_change: 15.31, repeat_units_share: 8.13,
    repeat_customers: 1219, repeat_customers_change: 10.12,
    repeat_customer_share: 7.4, repeat_customer_share_change: 0.13,
  }])
})

test('ASIN row → level asin, asin/title/category set, negatives preserved', () => {
  const row = {
    'ASIN': 'B09B7WLWW3', 'Product Title': 'Dirty Labs | Dishwasher Detergent', 'Brand Name': 'Dirty Labs', 'Category Name': 'Health & Personal Care',
    'Number of Orders': '2362', 'Unique Customer Count': '2323',
    'Repeat Ordered Product Sales: Sales': '836.54', 'Repeat Ordered Product Sales: Change vs. Prior Period': '-19.68', 'Repeat Ordered Product Sales: % Share of Total Sales': '1.54',
    'Repeat Ordered Units: Units': '42', 'Repeat Ordered Units: Change vs. Prior Period': '-14.29', 'Repeat Ordered Units: % Share of Total Units': '1.67',
    'Repeat Customer Count: Count': '38', 'Repeat Customer Count: Change vs. Prior Period': '-17.39',
    'Repeat Customer Share: % Share of Total Customers': '1.64', 'Repeat Customer Share: Change vs. Prior Period': '-0.48',
    'Reporting Date': '2026-07-11',
  }
  const out = mapRepeatPurchase(row, BRAND)
  assert.equal(out.length, 1)
  const r = out[0]
  assert.equal(r.level, 'asin')
  assert.equal(r.asin, 'B09B7WLWW3')
  assert.equal(r.product_title, 'Dirty Labs | Dishwasher Detergent')
  assert.equal(r.category, 'Health & Personal Care')
  assert.equal(r.repeat_sales_change, -19.68)
  assert.equal(r.repeat_customers_change, -17.39)
  assert.equal(r.repeat_customer_share_change, -0.48)
})

test('row without a Reporting Date yields no rows (never a null key)', () => {
  const row = { 'Brand Name': 'Dirty Labs', ...METRICS, 'Reporting Date': '' }
  assert.deepEqual(mapRepeatPurchase(row, BRAND), [])
})
