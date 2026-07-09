import type { MappedRow, RawRow } from './types'
import { makeGetter, parseDate, parseInteger, parseNumeric } from './types'

// SB Attributed Purchases export (INB-149) — the only purchase-level New-to-Brand
// source for Sponsored Brands. The file has NO row-level natural key: multiple rows
// share (date, campaign, purchased_asin, attribution_type), differing only by whether
// the purchase was new-to-brand. So this is a BATCH mapper: it AGGREGATES (sums the
// absolute metrics) per that grain and recomputes the NTB percentages from the
// aggregates. Promoted vs Brand Halo stay distinct rows. ad_type is derived from the
// campaign prefix (SBV. → SBV, else SB); SB rows carry no Advertised ASIN (→ '').

export interface SbAttributedPurchasesRow extends MappedRow {
  _campaign_amazon_id: string
  _campaign_name: string
  report_date: string | null
  ad_type: 'SB' | 'SBV'
  advertised_asin: string
  purchased_asin: string
  attribution_type: string
  cost_type: string | null
  sales_14d: number
  orders_14d: number
  units_14d: number
  ntb_sales_14d: number
  ntb_orders_14d: number
  ntb_units_14d: number
  ntb_sales_pct: number | null
  ntb_orders_pct: number | null
  ntb_units_pct: number | null
  sales_click: number
  orders_click: number
  units_click: number
}

// Explicit accumulator (not derived from the Row type, whose MappedRow index
// signature would widen these to `unknown`).
interface Acc {
  brand_id: string
  _campaign_amazon_id: string
  _campaign_name: string
  report_date: string
  ad_type: 'SB' | 'SBV'
  advertised_asin: string
  purchased_asin: string
  attribution_type: string
  cost_type: string | null
  sales_14d: number
  orders_14d: number
  units_14d: number
  ntb_sales_14d: number
  ntb_orders_14d: number
  ntb_units_14d: number
  sales_click: number
  orders_click: number
  units_click: number
}

const num = (v: string) => parseNumeric(v) ?? 0
const int = (v: string) => parseInteger(v) ?? 0
// Percent-as-number (matches parseNumeric of "58.34%" → 58.34); null when no base.
const pct = (part: number, total: number) => (total > 0 ? (100 * part) / total : null)

export function mapSbAttributedPurchases(rows: RawRow[], brandId: string): SbAttributedPurchasesRow[] {
  const groups = new Map<string, Acc>()

  for (const row of rows) {
    const get = makeGetter(row)
    const campaignName = get('', 'Campaign Name', 'campaign_name')
    const reportDate = parseDate(get('', 'Date', 'date', 'report_date'))
    const purchasedAsin = get('', 'Purchased ASIN', 'purchased_asin')
    // Rows with no usable key are unmappable — skip (defensive; the real file has none).
    if (!campaignName || !reportDate || !purchasedAsin) continue

    const attributionType = get('', 'Attribution type', 'attribution_type')
    const adType: 'SB' | 'SBV' = campaignName.toUpperCase().startsWith('SBV') ? 'SBV' : 'SB'
    const key = `${campaignName}::${reportDate}::${purchasedAsin}::${attributionType}`

    let acc = groups.get(key)
    if (!acc) {
      acc = {
        brand_id: brandId,
        _campaign_amazon_id: campaignName,
        _campaign_name: campaignName,
        report_date: reportDate,
        ad_type: adType,
        advertised_asin: '',
        purchased_asin: purchasedAsin,
        attribution_type: attributionType,
        cost_type: get(null as unknown as string, 'Cost type', 'cost_type') || null,
        sales_14d: 0, orders_14d: 0, units_14d: 0,
        ntb_sales_14d: 0, ntb_orders_14d: 0, ntb_units_14d: 0,
        sales_click: 0, orders_click: 0, units_click: 0,
      }
      groups.set(key, acc)
    }

    acc.sales_14d      += num(get('', '14 Day Total Sales', 'sales_14d'))
    acc.orders_14d     += int(get('', '14 Day Total Orders (#)', 'orders_14d'))
    acc.units_14d      += int(get('', '14 Day Total Units (#)', 'units_14d'))
    acc.ntb_sales_14d  += num(get('', '14 Day New-to-brand Sales', 'ntb_sales_14d'))
    acc.ntb_orders_14d += int(get('', '14 Day New-to-brand Orders (#)', 'ntb_orders_14d'))
    acc.ntb_units_14d  += int(get('', '14 Day New-to-brand Units (#)', 'ntb_units_14d'))
    acc.sales_click    += num(get('', '14 Day Total Sales - (Click)', 'sales_click'))
    acc.orders_click   += int(get('', '14 Day Total Orders (#) - (Click)', 'orders_click'))
    acc.units_click    += int(get('', '14 Day Total Units (#) - (Click)', 'units_click'))
  }

  return Array.from(groups.values()).map(acc => ({
    ...acc,
    // Round summed currency to cents to avoid float drift (e.g. 15.71+22.0).
    sales_14d:     Math.round(acc.sales_14d * 100) / 100,
    ntb_sales_14d: Math.round(acc.ntb_sales_14d * 100) / 100,
    sales_click:   Math.round(acc.sales_click * 100) / 100,
    ntb_sales_pct:  pct(acc.ntb_sales_14d, acc.sales_14d),
    ntb_orders_pct: pct(acc.ntb_orders_14d, acc.orders_14d),
    ntb_units_pct:  pct(acc.ntb_units_14d, acc.units_14d),
  }))
}
