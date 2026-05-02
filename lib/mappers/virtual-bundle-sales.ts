import { MappedRow, MapperContext, RawRow, makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface VirtualBundleSalesRow extends MappedRow {
  bundle_asin:          string
  title:                string | null
  sale_date:            string | null
  bundles_sold:         number | null
  total_sales_usd:      number | null
  report_week:          string | null
  is_virtual_multipack: boolean
}

export function mapVirtualBundleSales(
  row: RawRow,
  brandId: string,
  context?: MapperContext
): VirtualBundleSalesRow[] {
  const get = makeGetter(row)

  const bundleAsin = get('', 'BUNDLE_ASIN', 'bundle_asin', 'Bundle ASIN', 'Bundle_ASIN')
  if (!bundleAsin) return []

  const isMultipack = get('', 'IS_VIRTUAL_MULTIPACK', 'is_virtual_multipack') === 'Y'

  return [
    {
      brand_id:             brandId,
      bundle_asin:          bundleAsin,
      title:                get('', 'TITLE', 'title') || null,
      sale_date:            parseDate(get('', 'DATE', 'date', 'sale_date')),
      bundles_sold:         parseInteger(get('', 'BUNDLES_SOLD', 'bundles_sold')),
      total_sales_usd:      parseNumeric(get('', 'TOTAL_SALES', 'total_sales', 'total_sales_usd')),
      report_week:          context?.date_range_start ? parseDate(context.date_range_start) : null,
      is_virtual_multipack: isMultipack,
    },
  ]
}
