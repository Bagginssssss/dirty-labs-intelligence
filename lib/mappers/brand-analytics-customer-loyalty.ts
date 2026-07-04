import type { MappedRow, RawRow, MapperContext } from './types'
import { makeGetter, parseDate, parseInteger, parseNumeric } from './types'

export interface BrandAnalyticsCustomerLoyaltyRow extends MappedRow {
  period_end_date: string | null
  granularity: 'weekly' | 'monthly'
  total_customers: number | null
  total_sales: number | null
  total_orders: number | null
  ntb_customers: number | null
  ntb_sales: number | null
  ntb_orders: number | null
  repeat_customers: number | null
  repeat_sales: number | null
  repeat_orders: number | null
  repeat_purchase_rate: number | null
  avg_repeat_purchase_interval: number | null
  potential_new_customers: number | null
}

function isLastDayOfMonth(isoDate: string): boolean {
  const d = new Date(isoDate + 'T00:00:00Z')
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
  return d.getUTCMonth() !== next.getUTCMonth()
}

function detectGranularity(rows: RawRow[], filename?: string): 'weekly' | 'monthly' {
  // Signal 1 (strongest): filename keyword
  if (filename) {
    const lower = filename.toLowerCase()
    if (lower.includes('weekly')) return 'weekly'
    if (lower.includes('monthly')) return 'monthly'
  }

  // Signal 2: date spacing between first two rows
  if (rows.length >= 2) {
    const get0 = makeGetter(rows[0])
    const get1 = makeGetter(rows[1])
    const d1 = parseDate(get0('', 'Date'))
    const d2 = parseDate(get1('', 'Date'))
    if (d1 && d2) {
      const daysDiff = Math.abs(
        (new Date(d2 + 'T00:00:00Z').getTime() - new Date(d1 + 'T00:00:00Z').getTime())
        / 86_400_000
      )
      if (daysDiff <= 10) return 'weekly'
      if (daysDiff >= 25) return 'monthly'
    }
  }

  // Signal 3: single-row file — last day of month → monthly
  if (rows.length >= 1) {
    const get0 = makeGetter(rows[0])
    const d = parseDate(get0('', 'Date'))
    if (d && isLastDayOfMonth(d)) return 'monthly'
  }

  return 'monthly'
}

export function mapBrandAnalyticsCustomerLoyalty(
  rows: RawRow[],
  brandId: string,
  context?: MapperContext
): MappedRow[] {
  if (rows.length === 0) return []

  const granularity = detectGranularity(rows, context?.filename)

  return rows.map(row => {
    const get = makeGetter(row)
    return {
      brand_id:                     brandId,
      period_end_date:              parseDate(get('', 'Date')),
      granularity,
      total_customers:              parseInteger(get('', 'Total Customers')),
      total_sales:                  parseNumeric(get('', 'Total Sales')),
      total_orders:                 parseInteger(get('', 'Total Orders')),
      ntb_customers:                parseInteger(get('', 'New to Brand Customers')),
      ntb_sales:                    parseNumeric(get('', 'New to Brand Customer Sales')),
      ntb_orders:                   parseInteger(get('', 'New to Brand Customer Orders')),
      repeat_customers:             parseInteger(get('', 'Repeat Customers')),
      repeat_sales:                 parseNumeric(get('', 'Repeat Sales')),
      repeat_orders:                parseInteger(get('', 'Repeat Orders')),
      repeat_purchase_rate:         parseNumeric(get('', 'Repeat Purchase Rate')),
      avg_repeat_purchase_interval: parseNumeric(get('', 'Average Repeat Purchase Interval')),
      potential_new_customers:      parseInteger(get('', 'Potential New Customers')),
    } satisfies BrandAnalyticsCustomerLoyaltyRow
  })
}
