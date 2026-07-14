// INB-141 — detection for BA Repeat Purchase Behavior (brand + ASIN views → one reportType).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectReportType } from '../lib/report-detector.ts'
import { parseCSV } from '../lib/csv-parser.ts'

const METRIC_COLS = [
  'Number of Orders', 'Unique Customer Count',
  'Repeat Ordered Product Sales: Sales', 'Repeat Ordered Product Sales: Change vs. Prior Period', 'Repeat Ordered Product Sales: % Share of Total Sales',
  'Repeat Ordered Units: Units', 'Repeat Ordered Units: Change vs. Prior Period', 'Repeat Ordered Units: % Share of Total Units',
  'Repeat Customer Count: Count', 'Repeat Customer Count: Change vs. Prior Period',
  'Repeat Customer Share: % Share of Total Customers', 'Repeat Customer Share: Change vs. Prior Period',
]
const BRAND_HEADERS = ['Brand Name', ...METRIC_COLS, 'Reporting Date']
const ASIN_HEADERS = ['ASIN', 'Product Title', 'Brand Name', 'Category Name', ...METRIC_COLS, 'Reporting Date']

test('detect: brand view → brand_analytics_repeat_purchase', () => {
  const det = detectReportType(BRAND_HEADERS)
  assert.equal(det.reportType, 'brand_analytics_repeat_purchase')
  assert.equal(det.tableName, 'brand_analytics_repeat_purchase')
})

test('detect: ASIN view → brand_analytics_repeat_purchase', () => {
  const det = detectReportType(ASIN_HEADERS)
  assert.equal(det.reportType, 'brand_analytics_repeat_purchase')
  assert.equal(det.tableName, 'brand_analytics_repeat_purchase')
})

test('preamble: parseCSV skips the metadata line; the real header is used; then detects', () => {
  const raw = [
    'Reporting Range=["Weekly"],Select week=["Week 28 | 2026-07-05 - 2026-07-11 2026"]',
    '"Brand Name","Number of Orders","Unique Customer Count","Repeat Ordered Product Sales: Sales","Repeat Ordered Product Sales: Change vs. Prior Period","Repeat Ordered Product Sales: % Share of Total Sales","Repeat Ordered Units: Units","Repeat Ordered Units: Change vs. Prior Period","Repeat Ordered Units: % Share of Total Units","Repeat Customer Count: Count","Repeat Customer Count: Change vs. Prior Period","Repeat Customer Share: % Share of Total Customers","Repeat Customer Share: Change vs. Prior Period","Reporting Date"',
    '"Dirty Labs","17890","16475","39871.99","13.87","8.07","1672","15.31","8.13","1219","10.12","7.4","0.13","2026-07-11"',
  ].join('\n')
  const parsed = parseCSV(raw)
  assert.ok(parsed.headers.includes('Brand Name'), 'real header used')
  assert.ok(parsed.headers.includes('Reporting Date'))
  assert.ok(!parsed.headers.some(h => h.includes('Reporting Range')), 'preamble not treated as header')
  assert.equal(parsed.rowCount, 1)
  assert.equal(detectReportType(parsed.headers).reportType, 'brand_analytics_repeat_purchase')
})

test('no collision: a Customer Loyalty header set still → customer_loyalty', () => {
  const loyalty = ['Total Customers', 'New-To-Brand Customers', 'Repeat Purchase Rate', 'Potential New Customers', 'Reporting Date']
  assert.equal(detectReportType(loyalty).reportType, 'brand_analytics_customer_loyalty')
})

test('no collision: repeat-purchase headers do NOT match customer_loyalty', () => {
  assert.notEqual(detectReportType(BRAND_HEADERS).reportType, 'brand_analytics_customer_loyalty')
})
