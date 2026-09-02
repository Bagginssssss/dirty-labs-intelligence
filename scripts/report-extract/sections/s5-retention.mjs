// INB-178 Phase 2 §5 — Retention: does the coupon-driven intake damage reorder rate?
//
// The report's central claim lives here. The argument is about the SHAPE of the trend — a trough at the
// week of 2026-07-13 and a recovery in most weeks after, under continued heavy coupon intake — not the
// absolute level. reorder_rate and coupon_subs_share are Amazon daily scalars, aggregated as
// mean-of-daily-rates (the deliberate exception; every such figure is labelled). subscriber_retention
// has too few distinct values to chart and is flagged as such so no series is built from it by accident.
// Full precision — no rounding here.
import { BRAND_ID, meanOfDailyRates, dailyRate, mondayOf, monthKey, dayKey } from '../conventions.mjs'

function group(points, keyFn) {
  const m = new Map()
  for (const p of points) { const k = keyFn(p.date); (m.get(k) ?? m.set(k, []).get(k)).push(p) }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}
const rateAgg = pts => ({ mean_of_daily_rates: meanOfDailyRates(pts.map(p => p.value)), days_observed: pts.length, aggregation: 'mean_of_daily_rates' })

export default {
  key: 's5_retention',
  async extract({ db }) {
    const daily = await db.selectAll('sns_dashboard_daily', 'metric,metric_date,value', {
      filter: q => q.eq('brand_id', BRAND_ID).in('metric', ['reorder_rate', 'coupon_subs_share', 'reorder_sales'])
        .gte('metric_date', '2026-01-01').lte('metric_date', '2026-08-31'),
      order: [{ column: 'metric_date' }],
    })
    const retention = await db.selectAll('sns_dashboard_snapshots', 'snapshot_date,dim1,value', {
      filter: q => q.eq('brand_id', BRAND_ID).eq('report', 'subscriber_retention'),
      order: [{ column: 'snapshot_date' }],
    })
    const rp = await db.selectAll('brand_analytics_repeat_purchase', 'reporting_date,level,repeat_customer_share,repeat_sales_share', {
      filter: q => q.eq('brand_id', BRAND_ID).eq('level', 'brand'),
      order: [{ column: 'reporting_date' }],
    })
    const loyalty = await db.selectAll('brand_analytics_customer_loyalty', 'period_end_date,repeat_purchase_rate,avg_repeat_purchase_interval', {
      filter: q => q.eq('brand_id', BRAND_ID).eq('granularity', 'weekly'),
      order: [{ column: 'period_end_date' }],
    })

    const pts = m => daily.filter(r => r.metric === m).map(r => ({ date: dayKey(r.metric_date), value: Number(r.value) }))
    const rr = pts('reorder_rate'); const cs = pts('coupon_subs_share'); const rs = pts('reorder_sales')

    // ── primary exhibit: weekly reorder_rate + coupon_subs_share, 2026-06-01 → 2026-08-28 (Monday-anchored) ──
    const inExhibit = d => d >= '2026-06-01' && d <= '2026-08-28'
    const rrW = new Map(group(rr.filter(p => inExhibit(p.date)), mondayOf))
    const csW = new Map(group(cs.filter(p => inExhibit(p.date)), mondayOf))
    const weeks = [...new Set([...rrW.keys(), ...csW.keys()])].sort().map(wk => ({
      week_start_monday: wk,
      reorder_rate: rrW.has(wk) ? rateAgg(rrW.get(wk)) : null,
      coupon_subs_share: csW.has(wk) ? rateAgg(csW.get(wk)) : null,
    }))

    // ── monthly reorder_rate (full year Jan–Aug: the band that makes the dip legible) + reorder_sales daily avg ──
    const reorderRateMonthly = group(rr, monthKey).map(([m, ps]) => ({ month: m, ...rateAgg(ps) }))
    const reorderSalesMonthly = group(rs, monthKey).map(([m, ps]) => ({
      month: m, aggregation: 'daily_average', days_observed: ps.length,
      daily_average: dailyRate(ps.reduce((a, p) => a + p.value, 0), ps.length),
    }))

    // ── subscriber_retention distinctness → flag unsuitable for a series ──
    const retByDim = {}
    for (const r of retention) (retByDim[r.dim1] ??= []).push({ snapshot_date: dayKey(r.snapshot_date), value: Number(r.value) })
    const retMetrics = Object.fromEntries(Object.entries(retByDim).map(([dim, rows]) => {
      const distinct = [...new Set(rows.map(r => r.value))].sort((a, b) => a - b)
      return [dim, { captures: rows.length, distinct_values: distinct, series: rows }]
    }))
    const maxDistinct = Math.max(0, ...Object.values(retMetrics).map(m => m.distinct_values.length))
    const captures = Math.max(0, ...Object.values(retMetrics).map(m => m.captures))

    return {
      primary_exhibit: {
        window: { start: '2026-06-01', end: '2026-08-28', week_anchor: 'monday' },
        note: 'reorder_rate and coupon_subs_share on one weekly series so the dilution and the recovery are visible together. Both are mean-of-daily-rates; days_observed per metric exposes the Aug 20–22 coupon_subs_share gap (reorder_rate has no gap in that week).',
        trough_week_start_monday: '2026-07-13',
        weeks,
      },
      reorder_rate_monthly: reorderRateMonthly,
      reorder_sales_monthly: reorderSalesMonthly,
      subscriber_retention: {
        source: 'sns_dashboard_snapshots report=subscriber_retention (30 Days / 90 Days)',
        unsuitable_for_series: maxDistinct <= 3,
        reason: `Across ${captures} captures, each retention metric shows at most ${maxDistinct} distinct value(s) — too few (<=3) to chart as a weekly or monthly series. Report the readings only; do not build a trend from them.`,
        metrics: retMetrics,
      },
      repeat_purchase: {
        brand_analytics_repeat_purchase: { level: 'brand', cadence: 'weekly', series: rp.map(r => ({ week_ending: dayKey(r.reporting_date), repeat_customer_share: Number(r.repeat_customer_share), repeat_sales_share: Number(r.repeat_sales_share) })) },
        brand_analytics_customer_loyalty: { scope: 'account-level', cadence: 'weekly', series: loyalty.map(r => ({ week_ending: dayKey(r.period_end_date), repeat_purchase_rate: Number(r.repeat_purchase_rate), avg_repeat_purchase_interval: Number(r.avg_repeat_purchase_interval) })) },
      },
    }
  },
}
