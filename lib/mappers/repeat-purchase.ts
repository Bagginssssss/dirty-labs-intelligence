import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, norm, parseDate, parseNumeric } from './types'

// INB-141 — BA Repeat Purchase Behavior (brand + ASIN views) → one shared table.
// Both views share the repeat-metric columns; the ASIN view is prefixed by ASIN/Product Title/
// Brand Name/Category Name. One mapper handles both: `level` is derived from the presence of an
// ASIN column, `asin`='' for brand rows (039 pattern), dims NULL for brand rows. reporting_date is
// the week-ending Saturday from the file's "Reporting Date" column. Amazon's "Change vs. Prior
// Period" columns are kept as-is and can be negative (parseNumeric only strips $ % , whitespace).

export function mapRepeatPurchase(row: RawRow, brandId: string, _context?: MapperContext): MappedRow[] {
  const get = makeGetter(row)
  const reporting_date = parseDate(get('', 'Reporting Date'))
  if (!reporting_date) return []

  const isAsin = Object.keys(row).some(k => norm(k) === 'asin')

  return [{
    brand_id: brandId,
    reporting_date,
    level: isAsin ? 'asin' : 'brand',
    asin: isAsin ? (get('', 'ASIN') || '') : '',
    product_title: get('', 'Product Title') || null,
    category: get('', 'Category Name') || null,
    orders:                       parseNumeric(get('', 'Number of Orders')),
    unique_customers:             parseNumeric(get('', 'Unique Customer Count')),
    repeat_sales:                 parseNumeric(get('', 'Repeat Ordered Product Sales: Sales')),
    repeat_sales_change:          parseNumeric(get('', 'Repeat Ordered Product Sales: Change vs. Prior Period')),
    repeat_sales_share:           parseNumeric(get('', 'Repeat Ordered Product Sales: % Share of Total Sales')),
    repeat_units:                 parseNumeric(get('', 'Repeat Ordered Units: Units')),
    repeat_units_change:          parseNumeric(get('', 'Repeat Ordered Units: Change vs. Prior Period')),
    repeat_units_share:           parseNumeric(get('', 'Repeat Ordered Units: % Share of Total Units')),
    repeat_customers:             parseNumeric(get('', 'Repeat Customer Count: Count')),
    repeat_customers_change:      parseNumeric(get('', 'Repeat Customer Count: Change vs. Prior Period')),
    repeat_customer_share:        parseNumeric(get('', 'Repeat Customer Share: % Share of Total Customers')),
    repeat_customer_share_change: parseNumeric(get('', 'Repeat Customer Share: Change vs. Prior Period')),
  }]
}
