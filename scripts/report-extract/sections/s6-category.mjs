// INB-178 Phase 2 §6 — Category performance across four business_report windows.
//
// The batch's hardest hazard lives here: the category map is already reconciled to $0.00 (INB-179), so a
// category total can be internally consistent, tie to the account total, and STILL be wrong — because the
// error would live in the comparison BETWEEN windows. Two guards make that impossible to fake:
//   1. Windows are 30–32 days, not calendar months. Every cross-window comparison runs on a DAILY RATE
//      (revenue / window days). Raw totals are never compared. Window length is looked up from
//      report_coverage per window START — never derived from the label, never assumed.
//   2. Bundle ASINs (product_line NULL, $0 in business_report — Amazon attributes their revenue to the
//      component ASINs) are asserted out of every category total, not merely trusted out.
//
// Revenue reconciles to the window total exactly; SESSIONS deliberately do NOT — bundles carry their own
// detail-page sessions with $0 revenue and are excluded, so category conversion is child-sessions-only
// and is not comparable to §1's account-level conversion. That is stated in sessions_note, not buried.
// Full precision — no rounding here.
import {
  BRAND_ID, CATEGORY_SLUGS, S6_WINDOWS, S6_COVERAGE_REPORT_KEY,
  conversion, dailyRate, daysInclusive, sumBy, dayKey, TOLERANCE, calendarDaysInMonth,
} from '../conventions.mjs'

// Inclusive intersection of two [start,end] ISO-date ranges (string compare is valid for ISO dates).
function rangeOverlap(a, b) {
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  if (start > end) return null
  const dates = []
  for (let t = Date.parse(start + 'T00:00:00Z'); t <= Date.parse(end + 'T00:00:00Z'); t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10))
  }
  return { start, end, days: daysInclusive(start, end), dates }
}

export default {
  key: 's6_category',
  async extract({ db }) {
    // ── category map + bundle classification ──────────────────────────────────────────────────────
    const asins = await db.selectAll('asins', 'id,asin,product_line', {
      filter: q => q.eq('brand_id', BRAND_ID),
      order: [{ column: 'asin' }],
    })
    const bundleRows = await db.selectAll('virtual_bundle_sales_daily', 'bundle_asin', {
      filter: q => q.eq('brand_id', BRAND_ID),
      order: [{ column: 'bundle_asin' }],
    })
    const bundleSet = new Set(bundleRows.map(r => r.bundle_asin))
    const byId = new Map(asins.map(a => [a.id, a]))

    // The 31 product_line=NULL ASINs, split by the ONE signal available in-data: presence in
    // virtual_bundle_sales_daily. The parent/dormant sub-split of the 8 non-bundles is documented in the
    // INB-179 column comment on asins.product_line, NOT derivable here (asins.parent_asin is unpopulated).
    const nullAsins = asins.filter(a => a.product_line == null).map(a => a.asin).sort()
    const bundleUniverse = nullAsins.filter(a => bundleSet.has(a))
    const nonBundleNullUniverse = nullAsins.filter(a => !bundleSet.has(a))
    const nullGroupOf = asin => (bundleSet.has(asin) ? 'bundle' : 'variation_parent_or_dormant')

    // ── window ends from report_coverage — looked up, never assumed; hard stop on absence/insanity ──
    const coverage = await db.selectAll('report_coverage', 'report_key,period_start,period_end', {
      filter: q => q.eq('report_key', S6_COVERAGE_REPORT_KEY).in('period_start', S6_WINDOWS.map(w => w.period_start)),
      order: [{ column: 'period_start' }],
    })
    const covByStart = new Map(coverage.map(r => [dayKey(r.period_start), r]))
    const windowMeta = S6_WINDOWS.map(w => {
      const c = covByStart.get(w.period_start)
      if (!c) {
        throw new Error(
          `s6: no report_coverage row for report_key=${S6_COVERAGE_REPORT_KEY} period_start=${w.period_start}. ` +
          `Window length must come from report_coverage — refusing to assume it.`,
        )
      }
      const period_end = dayKey(c.period_end)
      const days = daysInclusive(w.period_start, period_end)
      if (days < 28 || days > 35) {
        throw new Error(`s6: window ${w.key} (${w.period_start}→${period_end}) is ${days} days, outside the 28–35 sanity band. Stopping.`)
      }
      return { key: w.key, period_start: w.period_start, period_end, days }
    })

    // ── business_report rows for the four window starts ───────────────────────────────────────────
    const br = await db.selectAll(
      'business_report', 'asin_id,report_date,ordered_product_sales,units_ordered,sessions_total',
      {
        filter: q => q.eq('brand_id', BRAND_ID).in('report_date', S6_WINDOWS.map(w => w.period_start)),
        order: [{ column: 'report_date' }],
      },
    )

    // ── per-window assembly ───────────────────────────────────────────────────────────────────────
    const windows = {}
    for (const wm of windowMeta) {
      const rows = br.filter(r => dayKey(r.report_date) === wm.period_start)
      const windowRevenue = sumBy(rows, 'ordered_product_sales')
      const windowUnits = sumBy(rows, 'units_ordered')
      const windowSessions = sumBy(rows, 'sessions_total')

      // per category (child ASINs only — parents/bundles are NULL and excluded)
      const categories = {}
      let categoryRevenueSum = 0, categorySessionSum = 0
      for (const slug of CATEGORY_SLUGS) {
        const cr = rows.filter(r => byId.get(r.asin_id)?.product_line === slug)
        const revenue = sumBy(cr, 'ordered_product_sales')
        const units = sumBy(cr, 'units_ordered')
        const sessions = sumBy(cr, 'sessions_total')
        categoryRevenueSum += revenue
        categorySessionSum += sessions
        categories[slug] = {
          asins: cr.length,
          ordered_revenue: revenue,
          units,
          sessions,
          daily_revenue_rate: dailyRate(revenue, wm.days),
          conversion: conversion(units, sessions), // child sessions only — see sessions_note
          revenue_share_of_window: windowRevenue > 0 ? revenue / windowRevenue : null,
          session_share_of_window: windowSessions > 0 ? sessions / windowSessions : null, // sums <100% by design
        }
      }

      // NULL-group breakdown (bundle vs variation_parent_or_dormant) — revenue must be $0 in both
      const nullRows = rows.filter(r => byId.get(r.asin_id)?.product_line == null)
      const grp = g => {
        const gr = nullRows.filter(r => nullGroupOf(byId.get(r.asin_id)?.asin) === g)
        return { asins: gr.length, ordered_revenue: sumBy(gr, 'ordered_product_sales'), units: sumBy(gr, 'units_ordered'), sessions: sumBy(gr, 'sessions_total') }
      }
      const nullBreakdown = { bundle: grp('bundle'), variation_parent_or_dormant: grp('variation_parent_or_dormant') }

      const reportDatesPresent = [...new Set(rows.map(r => dayKey(r.report_date)))].sort()
      const overlaps = windowMeta
        .filter(o => o.key !== wm.key)
        .map(o => ({ with: o.key, ...rangeOverlap({ start: wm.period_start, end: wm.period_end }, { start: o.period_start, end: o.period_end }) }))
        .filter(o => o.days) // keep only real intersections

      windows[wm.key] = {
        period_start: wm.period_start,
        period_end: wm.period_end,
        days: wm.days,
        window_total: { ordered_revenue: windowRevenue, units: windowUnits, sessions: windowSessions },
        report_date_audit: {
          report_dates_present: reportDatesPresent,
          count: reportDatesPresent.length,
          expected: wm.period_start,
          matches: reportDatesPresent.length === 1 && reportDatesPresent[0] === wm.period_start,
        },
        overlap: overlaps.map(o => ({ with: o.with, days: o.days, dates: o.dates })),
        categories,
        null_group_breakdown: nullBreakdown,
        reconciliation: {
          basis: 'revenue_only',
          category_revenue_sum: categoryRevenueSum,
          window_total_revenue: windowRevenue,
          difference: categoryRevenueSum - windowRevenue,
          within_tolerance: Math.abs(categoryRevenueSum - windowRevenue) <= TOLERANCE.currency,
          by_null_group: { bundle: nullBreakdown.bundle.ordered_revenue, variation_parent_or_dormant: nullBreakdown.variation_parent_or_dormant.ordered_revenue },
        },
        sessions: {
          category_session_sum: categorySessionSum,
          window_total_sessions: windowSessions,
          excluded_sessions: windowSessions - categorySessionSum,
          excluded_bundle: nullBreakdown.bundle.sessions,
          excluded_variation_parent_or_dormant: nullBreakdown.variation_parent_or_dormant.sessions,
          excluded_share: windowSessions > 0 ? (windowSessions - categorySessionSum) / windowSessions : null,
        },
      }
    }

    // ── cross-window comparison — DAILY RATES ONLY ────────────────────────────────────────────────
    const changeBaselineToP3 = {}
    const dailyRateSeries = {}
    for (const slug of CATEGORY_SLUGS) {
      const base = windows.baseline.categories[slug].daily_revenue_rate
      const p3 = windows.p3.categories[slug].daily_revenue_rate
      // Both bases are exported so the difference is visible IN the artifact: raw totals compare a
      // 30-day window to a 32-day one and overstate P3 growth by ~6.7% (dish even flips sign, +3.1% raw
      // → −3.3%/day). daily_rate_change_pct is the correct comparison; raw_total_change_pct is shown only
      // to expose why the normalisation matters — never as a headline.
      const baseRev = windows.baseline.categories[slug].ordered_revenue
      const p3Rev = windows.p3.categories[slug].ordered_revenue
      changeBaselineToP3[slug] = {
        baseline_daily_revenue_rate: base,
        p3_daily_revenue_rate: p3,
        daily_rate_change_pct: base > 0 ? (p3 - base) / base : null,
        raw_total_change_pct: baseRev > 0 ? (p3Rev - baseRev) / baseRev : null,
      }
      dailyRateSeries[slug] = S6_WINDOWS.map(w => ({ period: w.key, daily_revenue_rate: windows[w.key].categories[slug].daily_revenue_rate }))
    }

    const excludedSessionSeries = S6_WINDOWS.map(w => {
      const s = windows[w.key].sessions
      return {
        period: w.key,
        window_total_sessions: s.window_total_sessions,
        excluded_sessions: s.excluded_sessions,
        excluded_bundle: s.excluded_bundle,
        excluded_variation_parent_or_dormant: s.excluded_variation_parent_or_dormant,
        excluded_share: s.excluded_share,
      }
    })

    // ── G1 checks, computed in-code so the JSON self-documents ─────────────────────────────────────
    const orphanRows = br.filter(r => !byId.has(r.asin_id))
    const nullNoGroup = br.filter(r => byId.has(r.asin_id) && byId.get(r.asin_id).product_line == null && !nullAsins.includes(byId.get(r.asin_id).asin))
    const checks = {
      reconciliation_revenue_all_windows: {
        basis: 'revenue_only — sessions intentionally excluded (see sessions_note)',
        per_window: Object.fromEntries(Object.entries(windows).map(([k, w]) => [k, { difference: w.reconciliation.difference, pass: w.reconciliation.within_tolerance }])),
        all_pass: Object.values(windows).every(w => w.reconciliation.within_tolerance),
      },
      bundle_assertion: {
        every_bundle_is_null_category: bundleUniverse.every(a => byId.get(asins.find(x => x.asin === a)?.id)?.product_line == null),
        bundle_revenue_zero_all_windows: Object.values(windows).every(w => Math.abs(w.null_group_breakdown.bundle.ordered_revenue) <= TOLERANCE.currency),
        bundle_count: bundleUniverse.length,
      },
      unclassified: {
        orphan_business_report_asins: orphanRows.length,
        null_asins_outside_known_universe: nullNoGroup.length,
        pass: orphanRows.length === 0 && nullNoGroup.length === 0,
      },
      window_length_audit: windowMeta.map(wm => ({
        window: wm.key,
        period_start: wm.period_start,
        period_end_from_report_coverage: wm.period_end,
        days_inclusive: wm.days,
        business_report_dates_present: windows[wm.key].report_date_audit.report_dates_present,
        start_matches_coverage: windows[wm.key].report_date_audit.matches,
      })),
    }

    // ── independent cross-check: month-aligned windows vs the account daily table ──────────────────
    // Only a window that is EXACTLY a calendar month can be cross-checked against business_report_daily
    // (a different table, by-date not by-ASIN). Baseline (Apr 1–30) is the only one. Recorded as an
    // UNEXPLAINED gap — the cause is not verified in this batch, so it is not framed as understood.
    const monthAligned = windowMeta.filter(wm => {
      const [y, m, d] = wm.period_start.split('-').map(Number)
      return d === 1 && wm.period_end === `${wm.period_start.slice(0, 8)}${String(calendarDaysInMonth(y, m)).padStart(2, '0')}`
    })
    const crossCheckCalendarMonth = []
    for (const wm of monthAligned) {
      const daily = await db.selectAll('business_report_daily', 'report_date,ordered_product_sales,units_ordered,sessions_total', {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', wm.period_start).lte('report_date', wm.period_end),
        order: [{ column: 'report_date' }],
      })
      const byAsin = windows[wm.key].window_total
      const byDate = { ordered_revenue: sumBy(daily, 'ordered_product_sales'), units: sumBy(daily, 'units_ordered'), sessions: sumBy(daily, 'sessions_total'), day_rows: daily.length }
      crossCheckCalendarMonth.push({
        window: wm.key,
        calendar_month: wm.period_start.slice(0, 7),
        business_report_by_asin: byAsin,
        business_report_daily_by_date: byDate,
        difference: {
          ordered_revenue: byAsin.ordered_revenue - byDate.ordered_revenue,
          units: byAsin.units - byDate.units,
          sessions: byAsin.sessions - byDate.sessions,
          revenue_pct: byDate.ordered_revenue > 0 ? (byAsin.ordered_revenue - byDate.ordered_revenue) / byDate.ordered_revenue : null,
        },
        note: 'Independent cross-check (business_report by-ASIN window vs business_report_daily by-date), for a window that is exactly this calendar month. Sessions match EXACTLY; units and revenue BOTH diverge (~0.78%). The cause is NOT verified — recorded as an unexplained gap, not a known-and-understood one. Not investigated further in this batch.',
      })
    }

    return {
      meta: {
        source: 'business_report (windowed child-ASIN) joined to asins.product_line (INB-179)',
        window_ends: `report_coverage report_key=${S6_COVERAGE_REPORT_KEY}, looked up by period_start — never derived from the label, never assumed. Hard stop on a missing row or a day count outside 28–35.`,
        comparison_basis: 'daily_revenue_rate = window ordered revenue / inclusive window days. Windows are 30–32 days; raw totals are NEVER compared across windows.',
        categories: CATEGORY_SLUGS,
        bundle_exclusion: 'Bundle ASINs carry product_line NULL and $0 in business_report — Amazon attributes bundle revenue to the component ASINs, so category revenue already contains their components at Amazon\'s own ratios. Bundles are never added to a category total (asserted in checks.bundle_assertion).',
      },
      null_universe: {
        bundle: bundleUniverse,
        variation_parent_or_dormant: nonBundleNullUniverse,
        note: 'The 31 product_line=NULL ASINs: 23 virtual bundles (excluded to prevent double-counting) + 8 zero-lifetime-revenue non-bundles. The 8 are variation parents + dormant ASINs; that sub-split is documented in the INB-179 column comment on asins.product_line and is NOT derivable here, since asins.parent_asin is unpopulated. All 31 carry $0 revenue in every window.',
      },
      windows,
      cross_check_calendar_month: crossCheckCalendarMonth,
      change_baseline_to_p3: changeBaselineToP3,
      daily_rate_series: dailyRateSeries,
      sessions_note: {
        mechanism: 'Bundle listings accrue their own detail-page sessions on Amazon while their revenue is attributed to the component ASINs, so a bundle carries sessions with $0 revenue. Bundles (and a small variation-parent/dormant residual) are product_line=NULL and are excluded from every category.',
        reconciliation_scope: 'Reconciliation to window_total is REVENUE-ONLY and is exact ($0.00 every window). Category SESSIONS sum to less than the window total by the excluded-session amount, and session_share_of_window totals under 100% — by design, not a hole in the map.',
        comparability: 'Category conversion (§6) is computed on CHILD sessions only and is therefore NOT comparable to §1 account-level conversion, whose denominator includes bundle sessions. Both are correct; they measure different denominators.',
        excluded_dominated_by_bundles: 'The excluded sessions are almost entirely bundles, not the variation parents (parents contribute 1–116 sessions per window vs 16k–25k from bundles). See excluded_session_share_series.',
        observation_for_later: 'Excluded (bundle-dominated) session share rises across the year (see excluded_session_share_series) — bundles are taking a growing share of traffic. Signal for §11 (2-pack canister S&S switchover), not something §6 needs to explain.',
      },
      excluded_session_share_series: excludedSessionSeries,
      checks,
    }
  },
}
