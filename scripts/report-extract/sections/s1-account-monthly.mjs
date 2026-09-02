// INB-178 Phase 2 §1 — account monthly series, Jan → Aug 2026.
// business_report_daily (revenue/units/orders/sessions/conversion) + sp_campaign_performance
// (ad spend + ad sales, all-types and SP-only). Every ratio is sum-then-divide via conventions.mjs.
// Full precision — no rounding here.
import {
  BRAND_ID, AD_TYPES, roas, tacos, conversion, dailyRate, sumBy, calendarDaysInMonth,
} from '../conventions.mjs'

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
const ym = d => String(d).slice(0, 7)
const ymd = d => String(d).slice(0, 10)

export default {
  key: 's1_account_monthly',
  async extract({ db }) {
    const brd = await db.selectAll(
      'business_report_daily',
      'report_date,ordered_product_sales,units_ordered,total_order_items,sessions_total',
      {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', '2026-01-01').lte('report_date', '2026-08-31'),
        order: [{ column: 'report_date' }],
      },
    )
    const spc = await db.selectAll(
      'sp_campaign_performance',
      'report_date,ad_type,spend,sales_7d',
      {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', '2026-01-01').lte('report_date', '2026-08-31'),
        order: [{ column: 'report_date' }],
      },
    )

    const months = MONTHS.map(m => {
      const [year, mm] = m.split('-').map(Number)
      const b = brd.filter(r => ym(r.report_date) === m)
      const s = spc.filter(r => ym(r.report_date) === m)
      const sp = s.filter(r => r.ad_type === 'SP')

      const daysObserved = new Set(b.map(r => ymd(r.report_date))).size
      const revenue = sumBy(b, 'ordered_product_sales')
      const units = sumBy(b, 'units_ordered')
      // total_order_items counts ORDER ITEMS, not orders (Jan: 73,886 units vs 69,272 order items). The
      // business report exposes no true order count, so this is exported as `order_items` — do NOT
      // rename it back to `orders`, which reads plausibly but is an inaccuracy in a client-facing report.
      const orderItems = sumBy(b, 'total_order_items')
      const sessions = sumBy(b, 'sessions_total')

      const spendAll = sumBy(s, 'spend')
      const spendSp = sumBy(sp, 'spend')
      const salesAll = sumBy(s, 'sales_7d')
      const salesSp = sumBy(sp, 'sales_7d')
      const spendByType = Object.fromEntries(AD_TYPES.map(t => [t, sumBy(s.filter(r => r.ad_type === t), 'spend')]))

      return {
        month: m,
        days_observed: daysObserved,
        days_calendar: calendarDaysInMonth(year, mm),
        ordered_revenue: revenue,
        units,
        order_items: orderItems, // NOT "orders" — total_order_items counts order items (see above)
        sessions,
        conversion: conversion(units, sessions),
        daily_revenue_rate: dailyRate(revenue, daysObserved),
        ad_spend_all: spendAll,
        ad_spend_sp: spendSp,
        ad_spend_by_type: spendByType, // SP/SB/SBV — makes the March SB/SBV coverage step-up visible
        ad_sales_all: salesAll,
        ad_sales_sp: salesSp,
        roas_all: roas(salesAll, spendAll),
        roas_sp: roas(salesSp, spendSp),
        tacos: tacos(spendAll, revenue),
      }
    })

    return { months }
  },
}
