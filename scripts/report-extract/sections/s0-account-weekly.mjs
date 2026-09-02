// INB-178 Phase 2 §0 — weekly account ordered revenue, Jan 1 → Aug 29 2026, from business_report_daily.
// Weeks are Monday-anchored (ISO): this is the anchoring under which the final data week is Aug 24–29,
// as the query plan expects. A week is `partial` when fewer than 7 of its days fall in the data range —
// this flags BOTH the opening week (Jan 1 is a Thursday) and the final week (data ends Sat Aug 29). The
// final partial week is additionally surfaced at the top level so the consumer need not work it out.
// Full precision — no rounding here.
import { BRAND_ID } from '../conventions.mjs'

const RANGE_START = '2026-01-01'
const RANGE_END = '2026-08-29'
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
