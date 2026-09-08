// INB-178 Phase 2 §0 — weekly account ordered revenue, Jan 1 → Aug 30 2026, from business_report_daily.
// Weeks are Monday-anchored (ISO). Batch 4a: the range ends 2026-08-30, NOT 08-31 — August 30 is a Sunday,
// so the final week (Mon Aug 24 → Sun Aug 30) is COMPLETE and the series ends on a full week (extending to
// Mon Aug 31 would re-introduce a 1-day partial week, the exact caveat this refresh removes). A week is
// still `partial` when fewer than 7 of its days fall in the range — that now flags ONLY the opening week
// (Jan 1 is a Thursday). final_week_partial should be false. Full precision — no rounding here.
import { BRAND_ID } from '../conventions.mjs'

const RANGE_START = '2026-01-01'
const RANGE_END = '2026-08-30' // complete final week (Aug 24–30); Aug 30 is a Sunday
const ymd = d => String(d).slice(0, 10)

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default {
  key: 's0_account_weekly',
  async extract({ db }) {
    const brd = await db.selectAll(
      'business_report_daily',
      'report_date,ordered_product_sales',
      {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', RANGE_START).lte('report_date', RANGE_END),
        order: [{ column: 'report_date' }],
      },
    )

    const byWeek = new Map()
    for (const r of brd) {
      const d = ymd(r.report_date)
      const wk = mondayOf(d)
      let g = byWeek.get(wk)
      if (!g) { g = { monday: wk, dates: new Set(), revenue: 0 }; byWeek.set(wk, g) }
      g.dates.add(d)
      g.revenue += Number(r.ordered_product_sales ?? 0)
    }

    const weeks = [...byWeek.values()]
      .sort((a, b) => (a.monday < b.monday ? -1 : 1))
      .map(g => {
        const days = [...g.dates].sort()
        return {
          week_start_monday: g.monday,
          week_end_sunday: addDays(g.monday, 6),
          observed_start: days[0],
          observed_end: days[days.length - 1],
          days_observed: days.length,
          partial: days.length < 7,
          ordered_revenue: g.revenue,
        }
      })

    const last = weeks[weeks.length - 1] ?? null
    return {
      range: { start: RANGE_START, end: RANGE_END, week_anchor: 'monday' },
      final_week_partial: last ? last.partial : false,
      final_week: last && last.partial
        ? { week_start_monday: last.week_start_monday, observed_start: last.observed_start, observed_end: last.observed_end, days_observed: last.days_observed }
        : null,
      weeks,
    }
  },
}
