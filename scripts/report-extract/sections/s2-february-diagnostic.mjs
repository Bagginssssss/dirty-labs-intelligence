// INB-178 Phase 2 §2 — the February diagnostic. The load-bearing argument: spend rose ~47% while ad
// sales barely moved (+0.9%) and revenue per day stayed flat — a stronger claim than a revenue drop,
// which invites "demand softened." All from raw rows; every ratio is sum-then-divide via conventions.mjs.
//
// Efficiency is SP-only throughout (global convention). For Jan/Feb this is identical to all-types
// because SB/SBV do not exist in sp_campaign_performance before 2026-03-01 — asserted by bases_identical.
// Full precision — no rounding here.
import { BRAND_ID, roas, dailyRate, sumBy } from '../conventions.mjs'

const ym = d => String(d).slice(0, 7)
const ymd = d => String(d).slice(0, 10)

export default {
  key: 's2_february_diagnostic',
  async extract({ db }) {
    const spc = await db.selectAll(
      'sp_campaign_performance',
      'report_date,ad_type,spend,sales_7d',
      {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', '2026-01-01').lte('report_date', '2026-02-28'),
        order: [{ column: 'report_date' }],
      },
    )
    const brd = await db.selectAll(
      'business_report_daily',
      'report_date,ordered_product_sales',
      {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', '2026-01-01').lte('report_date', '2026-02-28'),
        order: [{ column: 'report_date' }],
      },
    )
    // NOTE (INB-182, Batch D G2): the March zero-order-target figure was REMOVED. It was sourced from
    // sp_targeting_report March, which the per-day reconciliation proved is corrupted before 2026-04-18
    // (a backfill dumped bulk loads onto 2026-03-01 and 2026-04-01 and under-reported every other pre-04-18
    // day). The figure ($12,317.03 SP) is therefore invalid and is not computed. §2's February argument is
    // unaffected — it is sourced from business_report_daily + sp_campaign_performance, both clean.

    const monthAd = m => {
      const s = spc.filter(r => ym(r.report_date) === m)
      const sp = s.filter(r => r.ad_type === 'SP')
      const spendAll = sumBy(s, 'spend'); const spendSp = sumBy(sp, 'spend')
      const salesAll = sumBy(s, 'sales_7d'); const salesSp = sumBy(sp, 'sales_7d')
      return { spendAll, spendSp, salesAll, salesSp, roasAll: roas(salesAll, spendAll), roasSp: roas(salesSp, spendSp) }
    }
    const monthRev = m => {
      const b = brd.filter(r => ym(r.report_date) === m)
      const days = new Set(b.map(r => ymd(r.report_date))).size
      const revenue = sumBy(b, 'ordered_product_sales')
      return { revenue, days, revenue_per_day: dailyRate(revenue, days) }
    }

    const jan = { ...monthAd('2026-01'), ...monthRev('2026-01') }
    const feb = { ...monthAd('2026-02'), ...monthRev('2026-02') }

    // Self-check: no SB/SBV before March, so SP-only MUST equal all-types for both months. If this is
    // ever false, the ad-type filter (or the coverage assumption) is wrong.
    const basesIdentical =
      jan.spendAll === jan.spendSp && jan.salesAll === jan.salesSp &&
      feb.spendAll === feb.spendSp && feb.salesAll === feb.salesSp

    const shape = (m, x) => ({
      month: m,
      ad_spend_sp: x.spendSp,
      ad_spend_all: x.spendAll,
      ad_sales_sp: x.salesSp,
      ad_sales_all: x.salesAll,
      roas_sp: x.roasSp,
      roas_all: x.roasAll,
      ordered_revenue: x.revenue,
      days_observed: x.days,
      revenue_per_day: x.revenue_per_day,
    })

    return {
      basis_note: 'Ad efficiency is SP-only per the global convention. Jan/Feb SP-only == all-types because SB/SBV do not exist in sp_campaign_performance before 2026-03-01 (asserted by bases_identical).',
      bases_identical: basesIdentical,
      jan: shape('2026-01', jan),
      feb: shape('2026-02', feb),
      marginal: {
        // SP-only (== all-types for these two months). The February exhibit: a large marginal spend
        // bought almost no marginal ad sales.
        additional_spend: feb.spendSp - jan.spendSp,
        additional_ad_sales: feb.salesSp - jan.salesSp,
        spend_pct_change: jan.spendSp > 0 ? (feb.spendSp - jan.spendSp) / jan.spendSp : null,
        ad_sales_pct_change: jan.salesSp > 0 ? (feb.salesSp - jan.salesSp) / jan.salesSp : null,
      },
      // zero_order_targets_march_2026 REMOVED — invalid, sourced from corrupted sp_targeting_report (INB-182).
    }
  },
}
