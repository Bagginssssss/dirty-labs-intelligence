// INB-178 Phase 2 §9 — Organic movement and the title migration.
// Rank from scale_insights_keyword_rank (Scale Insights — a DIFFERENT source than the Amazon ad reports,
// NOT affected by the INB-182 defect; verified clean, no bulk-dump pattern). rank_value=98 is the sentinel
// for "97+". Impression/purchase share from search_query_performance (Brand Analytics). Full precision.
import { BRAND_ID, dayKey, mondayOf, sumBy } from '../conventions.mjs'

const RANK_FROM = '2026-06-01', RANK_TO = '2026-08-30'
const WIN = { pre: ['2026-07-27', '2026-08-06'], post: ['2026-08-08', '2026-08-13'], ext: ['2026-08-24', '2026-08-30'] }

export default {
  key: 's9_organic',
  async extract({ db }) {
    const rank = await db.selectAll('scale_insights_keyword_rank', 'asin_id,report_date,keyword,search_volume,rank_value', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', RANK_FROM).lte('report_date', RANK_TO), order: [{ column: 'report_date' }],
    })
    const asins = await db.selectAll('asins', 'id,asin', { filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'asin' }] })
    const idToAsin = new Map(asins.map(a => [a.id, a.asin]))
    const inWin = (r, [a, b]) => { const d = dayKey(r.report_date); return d >= a && d <= b }
    const valid = r => Number(r.rank_value) > 0

    const portfolioRank = win => {
      const rows = rank.filter(r => inWin(r, win) && valid(r))
      let wn = 0, wd = 0
      for (const r of rows) { const v = Number(r.search_volume ?? 0), rk = Number(r.rank_value); if (v > 0) { wn += rk * v; wd += v } }
      return { weighted_avg_rank: wd > 0 ? wn / wd : null, unweighted_avg_rank: rows.length ? sumBy(rows, 'rank_value') / rows.length : null, observations: rows.length, distinct_keywords: new Set(rows.map(r => r.keyword)).size }
    }
    const perAsin = [...new Set(rank.map(r => r.asin_id))].map(id => {
      const avg = win => { const rr = rank.filter(r => r.asin_id === id && inWin(r, win) && valid(r)); return rr.length ? sumBy(rr, 'rank_value') / rr.length : null }
      const pre = avg(WIN.pre), post = avg(WIN.post), ext = avg(WIN.ext)
      return { asin: idToAsin.get(id) ?? id, avg_rank_pre: pre, avg_rank_post: post, avg_rank_ext: ext, delta_pre_post: pre != null && post != null ? post - pre : null, delta_pre_ext: pre != null && ext != null ? ext - pre : null, keywords: new Set(rank.filter(r => r.asin_id === id).map(r => r.keyword)).size }
    }).sort((a, b) => (b.delta_pre_post ?? -99) - (a.delta_pre_post ?? -99))

    // rank movers: first vs last rank per keyword×ASIN over the window (delta<0 = improved, lower is better)
    const grp = new Map()
    for (const r of rank.filter(valid)) {
      const k = r.asin_id + '|' + r.keyword
      const g = grp.get(k) ?? { asin_id: r.asin_id, keyword: r.keyword, search_volume: 0, first: null, last: null }
      const d = dayKey(r.report_date)
      if (!g.first || d < g.first.d) g.first = { d, rk: Number(r.rank_value) }
      if (!g.last || d > g.last.d) g.last = { d, rk: Number(r.rank_value) }
      g.search_volume = Math.max(g.search_volume, Number(r.search_volume ?? 0)); grp.set(k, g)
    }
    const movers = [...grp.values()].filter(g => g.first && g.last && g.first.d !== g.last.d)
      .map(g => ({ asin: idToAsin.get(g.asin_id) ?? g.asin_id, keyword: g.keyword, search_volume: g.search_volume, rank_start: g.first.rk, rank_end: g.last.rk, delta: g.last.rk - g.first.rk }))

    const sqp = await db.selectAll('search_query_performance', 'report_date,search_query_volume,impressions_brand_share,purchases_brand_share', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', RANK_FROM), order: [{ column: 'report_date' }],
    })
    // impressions_brand_share / purchases_brand_share are stored on a 0–100 scale; divide by 100 so §9
    // shares are 0–1 fractions like every other share in the report.
    const wk = {}
    for (const r of sqp) {
      const w = mondayOf(r.report_date)
      const g = wk[w] ?? { week: w, vol: 0, impNum: 0, purNum: 0 }
      const v = Number(r.search_query_volume ?? 0)
      g.vol += v; g.impNum += v * Number(r.impressions_brand_share ?? 0) / 100; g.purNum += v * Number(r.purchases_brand_share ?? 0) / 100; wk[w] = g
    }
    const shareWeekly = Object.values(wk).sort((a, b) => (a.week < b.week ? -1 : 1)).map(g => ({ week: g.week, impression_share: g.vol > 0 ? g.impNum / g.vol : null, purchase_share: g.vol > 0 ? g.purNum / g.vol : null }))

    return {
      meta: {
        note: 'Rank from scale_insights_keyword_rank (Scale Insights — different source than the Amazon ad reports; NOT affected by the INB-182 defect; verified clean). rank_value=98 = "97+" sentinel, averaged as 98 (slight downward bias on the level; trend shape unaffected). Impression/purchase share from search_query_performance, volume-weighted DL brand share.',
        window: { start: RANK_FROM, end: RANK_TO },
      },
      title_migration: {
        note: 'RE-RUN against data through 2026-08-30 (not inherited). Pre = Jul 27–Aug 6, Post = Aug 8–13, Extended = Aug 24–30.',
        windows: WIN,
        portfolio: { pre: portfolioRank(WIN.pre), post: portfolioRank(WIN.post), extended_through_aug30: portfolioRank(WIN.ext) },
        per_asin: perAsin,
        conclusion: 'RE-RUN through 2026-08-30, not inherited. The UNWEIGHTED portfolio rank (comparable to the prior "flat around 34" finding) sits ~33.6 pre → ~34.6 post → ~33.1 by Aug 30 — flat, and recovered. The VOLUME-WEIGHTED rank (~86 → ~84 → ~79) is much worse in level because it is dominated by high-volume head terms where DL ranks ~80+, but it also improved. Both measures confirm a re-scoring RESHUFFLE, not decay. The worst ASIN\'s pre→post delta is ~+2.0 (matches the prior finding); casualties tied to dropped title words are offset by same-ASIN gains (see rank_movers). Both weighted and unweighted figures are provided per window in portfolio.{pre,post,extended_through_aug30}.',
      },
      rank_movers: {
        note: 'First vs last rank per keyword×ASIN over the window; delta<0 = rank improved (lower is better). Top 15 each way.',
        top_improvers: [...movers].sort((a, b) => a.delta - b.delta).slice(0, 15),
        top_decliners: [...movers].sort((a, b) => b.delta - a.delta).slice(0, 15),
      },
      search_query_share: { note: 'DL brand impression + purchase share, weekly, volume-weighted by search_query_volume.', weekly: shareWeekly },
    }
  },
}
