// INB-178 Phase 2 §6a — Toilet: a problem being managed.
//
// This section's claim goes to the client, so every number is census-based and the guards are explicit:
//   • Returns are from fba_customer_returns (a census, not a sample). Product-fault = EXACTLY the three
//     reason codes the brief names (NOT_AS_DESCRIBED, DEFECTIVE, QUALITY_UNACCEPTABLE). That is NARROWER
//     than return_reason_map's product_fault class (which also buckets MISSING_PARTS + RECALL); the check
//     block lists every other reason present for toilet so nothing is silently bucketed.
//   • Return share and revenue share come from ONE code path here (return share from the returns census,
//     revenue share from the §6 P3 window), because the whole claim rests on the gap between them.
//   • The toilet performance series is reported on DAILY RATES (like §6) AND with the raw-total change
//     alongside, so the −39%/day decline is not silently a −35% raw artefact of the 30-vs-32-day windows.
//   • SAMPLING GUARD: amazon_reviews over-samples low ratings by design. NO star-distribution percentage
//     and NO count-by-rating is derived from it — anywhere. Reception evidence is the listing rating
//     (amazon_rating_snapshots, Amazon's own figure) and the returns census only. Verbatims illustrate,
//     never quantify. Full precision — no rounding here.
import {
  BRAND_ID, CATEGORY_SLUGS, S6_WINDOWS, S6_COVERAGE_REPORT_KEY,
  conversion, dailyRate, daysInclusive, sumBy, dayKey,
} from '../conventions.mjs'

const FAULT_REASONS = ['NOT_AS_DESCRIBED', 'DEFECTIVE', 'QUALITY_UNACCEPTABLE']
const RETURNS_SINCE = '2026-01-01'
const P3_KEY = 'p3' // Jul 30 window — the revenue-share basis (matches §6a's revenue column)

export default {
  key: 's6a_toilet',
  async extract({ db }) {
    // ── reference maps ────────────────────────────────────────────────────────────────────────────
    const asins = await db.selectAll('asins', 'id,asin,product_line', {
      filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'asin' }],
    })
    const bundleRows = await db.selectAll('virtual_bundle_sales_daily', 'bundle_asin', {
      filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'bundle_asin' }],
    })
    const bundleSet = new Set(bundleRows.map(r => r.bundle_asin))
    const byId = new Map(asins.map(a => [a.id, a]))
    const catByAsin = new Map(asins.map(a => [a.asin, a.product_line]))
    const toiletAsins = asins.filter(a => a.product_line === 'toilet').map(a => a.asin)

    // ── returns census (2026 to date) ─────────────────────────────────────────────────────────────
    const returns = await db.selectAll('fba_customer_returns', 'asin,reason,fault_class,return_date', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('return_date', RETURNS_SINCE),
      order: [{ column: 'return_date' }],
    })
    const totalReturns = returns.length

    // ── business_report windows (self-contained: toilet series + all-category P3 revenue share) ─────
    const coverage = await db.selectAll('report_coverage', 'report_key,period_start,period_end', {
      filter: q => q.eq('report_key', S6_COVERAGE_REPORT_KEY).in('period_start', S6_WINDOWS.map(w => w.period_start)),
      order: [{ column: 'period_start' }],
    })
    const covByStart = new Map(coverage.map(r => [dayKey(r.period_start), r]))
    const windowMeta = S6_WINDOWS.map(w => {
      const c = covByStart.get(w.period_start)
      if (!c) throw new Error(`s6a: no report_coverage row for ${S6_COVERAGE_REPORT_KEY} period_start=${w.period_start}. Refusing to assume window length.`)
      const period_end = dayKey(c.period_end)
      const days = daysInclusive(w.period_start, period_end)
      if (days < 28 || days > 35) throw new Error(`s6a: window ${w.key} (${w.period_start}→${period_end}) is ${days} days, outside 28–35. Stopping.`)
      return { key: w.key, period_start: w.period_start, period_end, days }
    })
    const br = await db.selectAll('business_report', 'asin_id,report_date,ordered_product_sales,units_ordered,sessions_total', {
      filter: q => q.eq('brand_id', BRAND_ID).in('report_date', S6_WINDOWS.map(w => w.period_start)),
      order: [{ column: 'report_date' }],
    })
    const rowsForWindow = wm => br.filter(r => dayKey(r.report_date) === wm.period_start)
    const catRevenue = (rows, slug) => sumBy(rows.filter(r => byId.get(r.asin_id)?.product_line === slug), 'ordered_product_sales')

    // ── returns composition, per category ─────────────────────────────────────────────────────────
    const p3meta = windowMeta.find(w => w.key === P3_KEY)
    const p3rows = rowsForWindow(p3meta)
    const p3windowRevenue = sumBy(p3rows, 'ordered_product_sales')
    const byCategory = {}
    for (const slug of CATEGORY_SLUGS) {
      const cr = returns.filter(r => catByAsin.get(r.asin) === slug)
      const faultN = cr.filter(r => FAULT_REASONS.includes(r.reason)).length
      byCategory[slug] = {
        total_returns: cr.length,
        product_fault_returns: faultN,
        product_fault_share: cr.length > 0 ? faultN / cr.length : null,
        return_share_of_all: totalReturns > 0 ? cr.length / totalReturns : null,
        revenue_share_p3: p3windowRevenue > 0 ? catRevenue(p3rows, slug) / p3windowRevenue : null,
      }
    }

    // toilet reason breakdown — EVERY reason present, so nothing is silently bucketed (check 1)
    const toiletReturns = returns.filter(r => catByAsin.get(r.asin) === 'toilet')
    const reasonCounts = new Map()
    for (const r of toiletReturns) reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1)
    const toiletReasonBreakdown = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        reason, count,
        share_of_toilet_returns: toiletReturns.length > 0 ? count / toiletReturns.length : null,
        is_product_fault: FAULT_REASONS.includes(reason),
      }))

    // ── toilet performance series (daily rates + raw-total change) ──────────────────────────────────
    const toiletWindows = {}
    for (const wm of windowMeta) {
      const tr = rowsForWindow(wm).filter(r => byId.get(r.asin_id)?.product_line === 'toilet')
      const revenue = sumBy(tr, 'ordered_product_sales')
      const units = sumBy(tr, 'units_ordered')
      const sessions = sumBy(tr, 'sessions_total')
      toiletWindows[wm.key] = {
        period_start: wm.period_start, period_end: wm.period_end, days: wm.days,
        ordered_revenue: revenue, units, sessions,
        daily_revenue_rate: dailyRate(revenue, wm.days),
        conversion: conversion(units, sessions),
      }
    }
    const base = toiletWindows.baseline, p3 = toiletWindows[P3_KEY]
    const pct = (a, b) => (b > 0 ? (a - b) / b : null)
    const changeBaselineToP3 = {
      // revenue reported BOTH ways per the G2 addition: the raw-total change flatters the decline
      // (windows are 30 vs 32 days), the daily rate is the true comparison.
      revenue: {
        raw_total_pct: pct(p3.ordered_revenue, base.ordered_revenue),
        daily_rate_pct: pct(p3.daily_revenue_rate, base.daily_revenue_rate),
        baseline_daily_revenue_rate: base.daily_revenue_rate,
        p3_daily_revenue_rate: p3.daily_revenue_rate,
      },
      units: { raw_total_pct: pct(p3.units, base.units) },
      sessions: { raw_total_pct: pct(p3.sessions, base.sessions) },
      conversion: { baseline: base.conversion, p3: p3.conversion },
    }

    // ── toilet ad spend by month (the pull-back) ───────────────────────────────────────────────────
    const campaigns = await db.selectAll('campaigns', 'id,campaign_name', {
      filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'campaign_name' }],
    })
    const toiletCampaigns = campaigns.filter(c => /toilet/i.test(c.campaign_name ?? ''))
    const toiletCampaignIds = toiletCampaigns.map(c => c.id)
    const scp = await db.selectAll('sp_campaign_performance', 'campaign_id,report_date,spend,sales_7d,clicks,orders_7d', {
      filter: q => q.eq('brand_id', BRAND_ID).in('campaign_id', toiletCampaignIds)
        .gte('report_date', '2026-01-01').lte('report_date', '2026-08-31'),
      order: [{ column: 'report_date' }],
    })
    const byMonth = new Map()
    for (const r of scp) {
      const m = dayKey(r.report_date).slice(0, 7)
      const g = byMonth.get(m) ?? { month: m, spend: 0, sales_7d: 0, clicks: 0, orders_7d: 0, campaign_ids: new Set() }
      g.spend += Number(r.spend ?? 0); g.sales_7d += Number(r.sales_7d ?? 0)
      g.clicks += Number(r.clicks ?? 0); g.orders_7d += Number(r.orders_7d ?? 0)
      g.campaign_ids.add(r.campaign_id)
      byMonth.set(m, g)
    }
    const adSpendByMonth = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
      .map(g => ({ month: g.month, spend: g.spend, sales_7d: g.sales_7d, clicks: g.clicks, orders_7d: g.orders_7d, active_campaigns: g.campaign_ids.size }))

    // ── reviews (listing rating + coverage ONLY — no star distribution) ─────────────────────────────
    const ratingSnaps = await db.selectAll('amazon_rating_snapshots', 'asin,snapshot_date,product_rating,count_ratings', {
      filter: q => q.eq('brand_id', BRAND_ID).in('asin', toiletAsins),
      order: [{ column: 'snapshot_date' }],
    })
    const latestSnap = ratingSnaps.at(-1) ?? null
    const reviewRows = await db.selectAll('amazon_reviews', 'asin,review_date,scraped_at', {
      filter: q => q.eq('brand_id', BRAND_ID).in('asin', toiletAsins),
      order: [{ column: 'review_date' }],
    })
    const reviewDates = reviewRows.map(r => dayKey(r.review_date)).sort()
    const scrapes = reviewRows.map(r => r.scraped_at).filter(Boolean).sort()

    // ── G2 checks ──────────────────────────────────────────────────────────────────────────────────
    const returnAsinsMissingCategory = [...new Set(returns.filter(r => catByAsin.get(r.asin) == null).map(r => r.asin))]
    const returnAsinsBundle = [...new Set(returns.filter(r => bundleSet.has(r.asin)).map(r => r.asin))]
    // reasons that return_reason_map snapshots as product_fault but the brief's 3-reason rule excludes
    const toiletFaultClassNotInThree = [...new Set(toiletReturns.filter(r => r.fault_class === 'product_fault' && !FAULT_REASONS.includes(r.reason)).map(r => r.reason))]

    return {
      returns_composition: {
        source: 'fba_customer_returns (census, not sampled), 2026-01-01 onward, joined to asins.product_line on ASIN',
        total_returns: totalReturns,
        fault_definition: {
          product_fault_reasons: FAULT_REASONS,
          note: 'Product-fault = exactly these three reason codes (brief definition). This is NARROWER than return_reason_map fault_class=product_fault, which also buckets MISSING_PARTS and RECALL. Toilet has zero such rows (see checks.fault_reason_codes), so the two definitions coincide FOR TOILET; the difference only bites at account level.',
        },
        revenue_share_basis: 'business_report Jul 30 window (§6 P3): category ordered revenue / window total. Same window as §6a\'s revenue column.',
        by_category: byCategory,
        toilet_reason_breakdown: toiletReasonBreakdown,
      },
      toilet_performance: {
        note: 'Reported on daily rates (window length from report_coverage, 30/32/31/32) AND with raw-total change alongside — the toilet decline is a client-facing headline, so the normalisation is visible, not assumed.',
        windows: toiletWindows,
        change_baseline_to_p3: changeBaselineToP3,
        ad_spend: {
          attribution: 'sp_campaign_performance → campaigns.id, campaign_name matched /toilet/i',
          campaigns_matched: toiletCampaigns.map(c => c.campaign_name).sort(),
          note: 'The deliberate advertising pull-back. Spend by month makes it visible rather than asserted (peaks in April, declines through August).',
          by_month: adSpendByMonth,
        },
      },
      reviews: {
        listing_rating: latestSnap && {
          asin: latestSnap.asin,
          product_rating: Number(latestSnap.product_rating),
          count_ratings: latestSnap.count_ratings,
          snapshot_date: dayKey(latestSnap.snapshot_date),
          source: 'amazon_rating_snapshots — Amazon\'s own listing rating, NOT computed from review rows. count_ratings is the listing\'s total rating count, not a per-star breakdown.',
        },
        coverage: {
          asins: toiletAsins,
          review_rows: reviewRows.length,
          earliest_review_date: reviewDates[0] ?? null,
          latest_review_date: reviewDates.at(-1) ?? null,
          last_scraped_at: scrapes.at(-1) ?? null,
        },
        sampling_warning: 'amazon_reviews is NOT a representative sample — the backfill deliberately over-sampled 1★ and 2★ to capture critical history, so its star distribution is skewed negative by construction. NO star-distribution percentage and NO count-by-rating may be computed from it. Reception evidence here is the listing rating and the returns census only; verbatims may illustrate but never quantify.',
        staleness_note: 'Review data is refreshed ad hoc (~monthly) and is currently stale — see latest_review_date. More current reviews would reinforce these points rather than change them.',
        star_distribution: null, // never computed — see sampling_warning
      },
      checks: {
        fault_reason_codes: {
          used: FAULT_REASONS,
          other_reason_codes_present_for_toilet: toiletReasonBreakdown.filter(r => !r.is_product_fault).map(r => ({ reason: r.reason, count: r.count })),
          map_product_fault_reasons_excluded_by_brief: ['MISSING_PARTS', 'RECALL'],
          toilet_has_excluded_product_fault_rows: toiletFaultClassNotInThree.length > 0,
          toilet_excluded_product_fault_reasons: toiletFaultClassNotInThree,
        },
        returns_join: {
          total_returns: totalReturns,
          mapped_to_category: returns.filter(r => CATEGORY_SLUGS.includes(catByAsin.get(r.asin))).length,
          unmapped_asins: returnAsinsMissingCategory,
          bundle_asins_in_returns: returnAsinsBundle,
          all_returns_mapped: returnAsinsMissingCategory.length === 0 && returnAsinsBundle.length === 0,
        },
        no_review_percentage: {
          star_distribution_emitted: false,
          rating_counts_emitted: false,
          note: 'No percentage or count-by-rating is derived from amazon_reviews anywhere in this section. product_rating/count_ratings come from amazon_rating_snapshots (Amazon listing figures), not from review rows.',
        },
      },
    }
  },
}
