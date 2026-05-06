import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export function mapVirtualBundleDaily(
  row: RawRow,
  brandId: string,
  _context?: MapperContext
): MappedRow[] {
  const get = makeGetter(row)

  const bundleAsin = get('', 'bundle_asin', 'BUNDLE_ASIN', 'Bundle ASIN', 'Bundle_ASIN')
  if (!bundleAsin) return []

  const saleDate = parseDate(get('', 'date', 'DATE', 'sale_date'))
  if (!saleDate) return []

  return [
    {
      brand_id:       brandId,
      bundle_asin:    bundleAsin,
      title:          get('', 'title', 'TITLE') || null,
      sale_date:      saleDate,
      bundles_sold:   parseInteger(get('', 'bundles_sold', 'BUNDLES_SOLD')),
      total_sales_usd: parseNumeric(get('', 'total_sales', 'TOTAL_SALES', 'total_sales_usd')),
    },
  ]
}
