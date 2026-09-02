// INB-178 Phase 2 §4 — Acquisition: subscribers, S&S revenue, coupon, NTB.
//
// PROVENANCE (rulings, INB-178 Batch B G1):
//  • sns_dashboard_daily is the SOLE source for subscriber counts. subscribe_and_save is a DIFFERENT,
//    windowed report and gives different figures for the same dates — do NOT reconcile the two.
//  • Rates stored by Amazon as daily scalars (sns_sales_share, coupon_subs_share, reorder_rate) can only
//    be aggregated as an unweighted mean of daily rates — the deliberate exception (see conventions.mjs).
//    Every such figure carries aggregation:"mean_of_daily_rates". sns_sales_share ALSO gets a true rate.
//  • NTB rate comes from brand_analytics_customer_loyalty (account-level, true sum-then-divide). The
//    sp_campaign_performance NTB *rate* columns are unusable (SB/SBV-only, percentage>100%, zero-denom),
//    so only the ABSOLUTE ntb_orders_14d is taken from there — and it is SB/SBV-only (SP rows are null),
//    a narrow slice, labelled as such in the JSON.
// Full precision — no rounding here.
import { BRAND_ID, meanOfDailyRates, dailyRate, mondayOf, monthKey, dayKey } from '../conventions.mjs'

const DAILY_START = '2026-01-01'
const METRIC_END = { // each metric's own coverage end (query plan §C / brief §4)
  active_subscriptions: '2026-08-30', active_subscriptions_ly: '2026-08-30',
  sns_sales: '2026-08-28', sns_sales_share: '2026-08-28',
  coupon_subs_share: '2026-08-30', coupon_sales_sns: '2026-08-28',
}

// ── period helpers ────────────────────────────────────────────────────────────────
function periods(points, keyFn) {
  const m = new Map()
  for (const p of points) { const k = keyFn(p.date); (m.get(k) ?? m.set(k, []).get(k)).push(p) }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, pts]) => [k, pts.sort((x, y) => (x.date < y.date ? -1 : 1))])
}
const pitPeriods = (points, keyFn, label) => periods(points, keyFn).map(([k, pts]) => ({
  [label]: k, days_observed: pts.length,
  first: { date: pts[0].date, value: pts[0].value },
  last: { date: pts.at(-1).date, value: pts.at(-1).value },
}))
const sumPeriods = (points, keyFn, label) => periods(points, keyFn).map(([k, pts]) => {
  const sum = pts.reduce((a, p) => a + p.value, 0)
  return { [label]: k, days_observed: pts.length, sum, daily_rate: dailyRate(sum, pts.length) }
})
const meanPeriods = (points, keyFn, label) => periods(points, keyFn).map(([k, pts]) => ({
  [label]: k, days_observed: pts.length, aggregation: 'mean_of_daily_rates',
  mean_of_daily_rates: meanOfDailyRates(pts.map(p => p.value)),
}))
function missingDays(points, start, end) {
  const present = new Set(points.map(p => p.date))
  const out = []
  for (const d = new Date(start + 'T00:00:00Z'); d <= new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10)
    if (!present.has(s)) out.push(s)
  }
  return out
}

export default {
  key: 's4_acquisition',
  async extract({ db }) {
    // ── fetch ──
    const snsDaily = await db.selectAll('sns_dashboard_daily', 'metric,metric_date,value', {
      filter: q => q.eq('brand_id', BRAND_ID).in('metric', Object.keys(METRIC_END))
        .gte('metric_date', DAILY_START).lte('metric_date', '2026-08-31'),
      order: [{ column: 'metric_date' }],
    })
    const brd = await db.selectAll('business_report_daily', 'report_date,ordered_product_sales', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', DAILY_START).lte('report_date', '2026-08-31'),
      order: [{ column: 'report_date' }],
    })
    const snaps = await db.selectAll('sns_dashboard_snapshots', 'report,snapshot_date,dim1,dim2,value', {
      filter: q => q.eq('brand_id', BRAND_ID).in('report', ['customer_ltv_by_segment', 'customer_share_by_segment', 'deliveries_breakdown']),
      order: [{ column: 'snapshot_date' }],
    })
    const spc = await db.selectAll('sp_campaign_performance', 'report_date,ad_type,ntb_orders_14d,orders_7d', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', DAILY_START).lte('report_date', '2026-08-31'),
      order: [{ column: 'report_date' }],
    })
    const loyalty = await db.selectAll('brand_analytics_customer_loyalty',
      'granularity,period_end_date,ntb_orders,total_orders,ntb_customers,total_customers,ntb_sales,total_sales', {
        filter: q => q.eq('brand_id', BRAND_ID).eq('granularity', 'weekly'),
        order: [{ column: 'period_end_date' }],
      })

    // daily points per metric: [{date, value}]
    const pts = m => snsDaily.filter(r => r.metric === m).map(r => ({ date: dayKey(r.metric_date), value: Number(r.value) }))

    // ── point-in-time: active_subscriptions & _ly (series + first/last + gaps) ──
    const pit = m => {
      const p = pts(m)
      return {
        end_date: METRIC_END[m], aggregation: 'point_in_time',
        first: { date: p[0].date, value: p[0].value },
        last: { date: p.at(-1).date, value: p.at(-1).value },
        days_observed: p.length,
        missing_days: missingDays(p, DAILY_START, p.at(-1).date),
        monthly: pitPeriods(p, monthKey, 'month'),
        weekly: pitPeriods(p, mondayOf, 'week_start_monday'),
        series: p, // full daily series; gaps are the dates absent from here + listed in missing_days
      }
    }

    // ── sum: sns_sales, coupon_sales_sns ──
    const sum = m => {
      const p = pts(m)
      return {
        end_date: METRIC_END[m], aggregation: 'sum',
        total: p.reduce((a, x) => a + x.value, 0), days_observed: p.length,
        monthly: sumPeriods(p, monthKey, 'month'), weekly: sumPeriods(p, mondayOf, 'week_start_monday'),
      }
    }

    // ── coupon_subs_share: mean-of-daily-rates (days_observed exposes the Aug 20–22 gap next to Aug) ──
    const couponSubsShare = (() => {
      const p = pts('coupon_subs_share')
      return {
        end_date: METRIC_END.coupon_subs_share, aggregation: 'mean_of_daily_rates',
        monthly: meanPeriods(p, monthKey, 'month'), weekly: meanPeriods(p, mondayOf, 'week_start_monday'),
      }
    })()

    // ── sns_sales_share: mean-of-daily AND the true rate sum(sns_sales)/sum(revenue) + difference ──
    // Validates the mean-of-daily family: a systematic gap means the other two rates are biased too.
    const snsSalesShareDual = (() => {
      const revByDate = new Map(brd.map(r => [dayKey(r.report_date), Number(r.ordered_product_sales)]))
      const salesByDate = new Map(pts('sns_sales').map(x => [x.date, x.value]))
      const share = pts('sns_sales_share')
      const build = keyFn => periods(share, keyFn).map(([k, ps]) => {
        const dates = ps.map(x => x.date).filter(d => salesByDate.has(d) && revByDate.has(d))
        const salesSum = dates.reduce((a, d) => a + salesByDate.get(d), 0)
        const revSum = dates.reduce((a, d) => a + revByDate.get(d), 0)
        const mean = meanOfDailyRates(ps.map(x => x.value))
        const trueRate = revSum > 0 ? salesSum / revSum : null
        return { period: k, days_observed: ps.length, mean_of_daily_rates: mean, true_rate: trueRate, difference: (mean != null && trueRate != null) ? mean - trueRate : null }
      })
      const monthly = build(monthKey)
      const diffs = monthly.map(x => x.difference).filter(x => x != null)
      return {
        end_date: METRIC_END.sns_sales_share,
        aggregation: 'mean_of_daily_rates',
        true_rate_aggregation: 'sum_then_divide',
        bias_note: 'The mean-of-daily-rates method overstates the true sum-then-divide rate systematically. Because reorder_rate and coupon_subs_share have no true-rate counterpart, they carry the same upward bias — level, not shape, is affected.',
        bias_max_overstatement: diffs.length ? Math.max(...diffs) : null, // e.g. ~+0.0161 (June)
        monthly: monthly.map(x => ({ ...x, month: x.period, period: undefined })),
        weekly: build(mondayOf).map(x => ({ ...x, week_start_monday: x.period, period: undefined })),
      }
    })()

    // ── snapshots ──
    const snapReport = r => snaps.filter(s => s.report === r)
    const snapRows = r => snapReport(r).map(s => ({ snapshot_date: dayKey(s.snapshot_date), segment: s.dim1, value: Number(s.value) }))
    // deliveries_breakdown: Aug-17 onward only (Aug-10 is a ~2.01x different basis — excluded, not averaged)
    const delAll = snapReport('deliveries_breakdown')
    const delDates = [...new Set(delAll.map(s => dayKey(s.snapshot_date)))].sort()
    const delIncluded = delDates.filter(d => d >= '2026-08-17')
    const delSnapshots = delIncluded.map(d => {
      const rows = delAll.filter(s => dayKey(s.snapshot_date) === d)
      return { snapshot_date: d, total: rows.reduce((a, s) => a + Number(s.value), 0), buckets: rows.map(s => ({ segment: s.dim1, value: Number(s.value) })) }
    })

    // ── NTB ──
    const spcMonth = new Map()
    for (const r of spc) {
      const k = monthKey(r.report_date)
      const g = spcMonth.get(k) ?? spcMonth.set(k, { ntb_sb_sbv: 0, orders_7d: 0 }).get(k)
      if (r.ad_type === 'SB' || r.ad_type === 'SBV') g.ntb_sb_sbv += Number(r.ntb_orders_14d ?? 0)
      g.orders_7d += Number(r.orders_7d ?? 0)
    }
    const ntbAdMonthly = [...spcMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([m, g]) => ({ month: m, ntb_orders_14d_sb_sbv: g.ntb_sb_sbv, orders_7d_context: g.orders_7d }))
    const loyaltyWeekly = loyalty.map(r => ({
      week_ending: dayKey(r.period_end_date),
      ntb_orders: Number(r.ntb_orders), total_orders: Number(r.total_orders),
      ntb_order_rate: Number(r.total_orders) > 0 ? Number(r.ntb_orders) / Number(r.total_orders) : null,
      ntb_customers: Number(r.ntb_customers), total_customers: Number(r.total_customers),
      ntb_customer_rate: Number(r.total_customers) > 0 ? Number(r.ntb_customers) / Number(r.total_customers) : null,
      ntb_sales: Number(r.ntb_sales),
    }))
    const lyOrders = loyalty.reduce((a, r) => a + Number(r.ntb_orders), 0)
    const lyTotOrders = loyalty.reduce((a, r) => a + Number(r.total_orders), 0)
    const lyCust = loyalty.reduce((a, r) => a + Number(r.ntb_customers), 0)
    const lyTotCust = loyalty.reduce((a, r) => a + Number(r.total_customers), 0)

    return {
      provenance: {
        subscriber_source: 'sns_dashboard_daily is the SOLE source for subscriber counts. subscribe_and_save.report_date is the window START while its active_subscriptions value is the period-END balance, so the row labelled 2026-01-01 carries the 2026-01-31 figure. The two sources agree EXACTLY once aligned on window end (verified: subscribe_and_save 2026-01-01 = sns_dashboard_daily 2026-01-31 = 60,714). sns_dashboard_daily remains the sole source here because it is a true daily series; the point is that the tables do NOT disagree, and neither should be "corrected" toward the other.',
        rate_aggregation: 'reorder_rate / sns_sales_share / coupon_subs_share are stored by Amazon as daily scalars with no numerator or denominator, so their monthly/weekly aggregates are an unweighted mean of daily rates (aggregation:"mean_of_daily_rates"). sns_sales_share additionally carries a true sum-then-divide rate for validation.',
      },
      active_subscriptions: pit('active_subscriptions'),
      active_subscriptions_ly: pit('active_subscriptions_ly'),
      sns_sales: sum('sns_sales'),
      sns_sales_share: snsSalesShareDual,
      coupon_subs_share: couponSubsShare,
      coupon_sales_sns: sum('coupon_sales_sns'),
      snapshots: {
        customer_ltv_by_segment: { note: 'Average GMS by customer segment (3 rows). Distinct from subscriber_ltv (8 rows) — that is a different report and was not read.', snapshot_date: snapRows('customer_ltv_by_segment')[0]?.snapshot_date ?? null, rows: snapRows('customer_ltv_by_segment') },
        customer_share_by_segment: { snapshot_date: snapRows('customer_share_by_segment')[0]?.snapshot_date ?? null, rows: snapRows('customer_share_by_segment') },
        deliveries_breakdown: {
          note: 'S&S-only shipped revenue by delivery count. Aug-17 snapshot onward only: the Aug-10 pull is a ~2.01x different basis (excluded, not averaged). This is the S&S-only ~$14.2M report, NOT total_deliveries_breakdown (~$42M, all sales) — a factor-of-three difference; the latter was not read.',
          excluded: [{ snapshot_date: '2026-08-10', reason: 'different basis (~2.009x vs Aug-17); pre-basis-change' }].filter(() => delDates.includes('2026-08-10')),
          snapshots: delSnapshots,
        },
      },
      ntb: {
        account_level: {
          scope: 'account-level (brand_analytics_customer_loyalty) — ALL orders/customers, not ad-attributed. This is the NTB rate §4 should lead with.',
          granularity_warning: 'brand_analytics_customer_loyalty holds TWO overlapping granularities that must NEVER be pooled: 13 monthly rows (2025-04-30 → 2026-04-30) and 28 weekly rows (2026-02-21 → 2026-08-29). §4 uses the WEEKLY rows ONLY; summing across grains double-counts most of 2026.',
          aggregation: 'sum_then_divide',
          ntb_order_rate: lyTotOrders > 0 ? lyOrders / lyTotOrders : null,
          ntb_customer_rate: lyTotCust > 0 ? lyCust / lyTotCust : null,
          totals: { ntb_orders: lyOrders, total_orders: lyTotOrders, ntb_customers: lyCust, total_customers: lyTotCust },
          weekly: loyaltyWeekly,
        },
        ad_attributed: {
          scope: 'ad-attributed (sp_campaign_performance), SB/SBV ONLY — ntb_orders_14d is null on every SP row, so SP (roughly 88% of spend) contributes nothing. This is a narrow slice and must NOT be read as an account NTB number.',
          note: 'No ad-attributed NTB RATE is reported: sp_campaign_performance has no valid denominator (orders_14d does not exist; ntb_order_rate/ntb_orders_pct are SB/SBV-only and percentage>100%). orders_7d below is a 7-day total-orders CONTEXT figure, NOT the denominator of any rate.',
          ntb_orders_14d_sb_sbv_total: ntbAdMonthly.reduce((a, m) => a + m.ntb_orders_14d_sb_sbv, 0),
          monthly: ntbAdMonthly,
        },
      },
    }
  },
}
