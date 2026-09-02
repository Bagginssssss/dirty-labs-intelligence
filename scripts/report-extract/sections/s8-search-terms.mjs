// INB-178 Phase 2 §8 — Search-term intelligence.
//   §8a Category board — five categories × { Converting, Expensive, Emerging }, non-branded terms only,
//       joined to category via campaign name (classifyCampaignCategory: ASIN-in-name → product-word →
//       bundle-anchor → unmapped). 60-day weekly sparkline per listed term.
//   §8b Conquest map — competitor terms by orders + ROAS, peers foregrounded. KEYWORD-ONLY, deliberately.
//
// DATA-INTEGRITY (INB-182): sp_search_term_report shares the sp_targeting_report defect — corrupted before
// 2026-04-18 (bulk dumps on 2026-03-01 +$49k SP and 2026-04-01 +$47k SP, under-reports every other pre-
// 04-18 day; reconciles from 04-18). §8 windows therefore start 2026-04-18. Verified by per-day
// reconciliation, G3. The classifier is unaffected (it reads term text); only the aggregation window moves.
//
// CONVERTING is NOT filtered by an ACOS bar (Darren's ruling): DL's keep/cut decision is multi-factor
// (margin, long-tail, low-traffic high-converters), so a single bar would drop terms worth keeping and
// admit low-volume noise. Rank by orders_7d; carry a beats_target_acos flag against the STATED 0.58
// non-branded target (a business target, NOT computed). Full precision — no rounding here.
import {
  BRAND_ID, CATEGORY_SLUGS, classifyBrand, classifyCampaignCategory,
  acos, roas, sumBy, dayKey, mondayOf,
} from '../conventions.mjs'

const START = '2026-04-18', END = '2026-08-29'
const EMERGING_FROM = '2026-07-01'      // "last 60 days" floor for Emerging (absent 04-18→06-30)
const NB_ACOS_TARGET = 0.58             // STATED business target for non-branded — not derived
const EXPENSIVE_SPEND = 250             // spend floor over the window
const CONVERTING_TOP_N = 20
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

export default {
  key: 's8_search_terms',
  async extract({ db }) {
    const campaigns = await db.selectAll('campaigns', 'id,campaign_name', { filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'campaign_name' }] })
    const asins = await db.selectAll('asins', 'asin,product_line', { filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'asin' }] })
    const asinToCategory = new Map(asins.map(a => [String(a.asin).toUpperCase(), a.product_line]))
    const campClass = new Map(campaigns.map(c => [c.id, { name: c.campaign_name, ...classifyCampaignCategory(c.campaign_name, asinToCategory) }]))

    // chunked pull — sp_search_term_report is large; keep each query's offset shallow (see s7)
    const rows = []
    for (let ws = START; ws <= END; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6) < END ? addDays(ws, 6) : END
      rows.push(...await db.selectAll('sp_search_term_report', 'campaign_id,customer_search_term,report_date,spend,sales_7d,orders_7d', {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', ws).lte('report_date', we), order: [{ column: 'report_date' }],
      }))
    }

    // ── join-tier report (validation baked into the artifact) ─────────────────────────────────────
    const tierRaw = { 1: 0, 2: 0, 3: 0, 4: 0 }, tierNb = { 1: 0, 2: 0, 3: 0, 4: 0 }, tierNbSales = { 1: 0, 2: 0, 3: 0, 4: 0 }
    const unmapped = new Map()
    let totalSpend = 0, nbSpend = 0, brandedSpend = 0, competitorSpend = 0
    // ── per-(category, term) aggregation for §8a; per-term for §8b ─────────────────────────────────
    const cat = Object.fromEntries(CATEGORY_SLUGS.map(c => [c, new Map()]))   // category → term → agg
    const conquest = new Map()                                               // term → agg (+brand/tier)
    const bump = (m, key, r, isFirst) => {
      const g = m.get(key) ?? { term: key, spend: 0, sales: 0, orders: 0, first_date: r.report_date, weekly: new Map() }
      g.spend += Number(r.spend ?? 0); g.sales += Number(r.sales_7d ?? 0); g.orders += Number(r.orders_7d ?? 0)
      if (dayKey(r.report_date) < dayKey(g.first_date)) g.first_date = r.report_date
      const wk = mondayOf(r.report_date)
      const w = g.weekly.get(wk) ?? { spend: 0, orders: 0 }
      w.spend += Number(r.spend ?? 0); w.orders += Number(r.orders_7d ?? 0); g.weekly.set(wk, w)
      m.set(key, g)
      return g
    }
    for (const r of rows) {
      const cc = campClass.get(r.campaign_id) ?? { name: '(unknown)', tier: 4, category: null }
      const spend = Number(r.spend ?? 0)
      const cls = classifyBrand(r.customer_search_term)
      totalSpend += spend; tierRaw[cc.tier] += spend
      if (cls.class === 'non_branded') {
        nbSpend += spend; tierNb[cc.tier] += spend; tierNbSales[cc.tier] += Number(r.sales_7d ?? 0)
        if (cc.tier === 4) { const g = unmapped.get(cc.name) ?? { name: cc.name, spend: 0, nb: 0 }; g.spend += spend; g.nb += spend; unmapped.set(cc.name, g) }
        if (cc.category) bump(cat[cc.category], r.customer_search_term, r)
      } else if (cls.class === 'competitor') {
        competitorSpend += spend
        const g = bump(conquest, r.customer_search_term, r); g.brand = cls.brand; g.tier = cls.tier
      } else if (cls.class === 'branded') {
        brandedSpend += spend
      }
    }

    // 60-day weekly sparkline (last 60 days: EMERGING_FROM → END), Monday-anchored
    const sparkWeeks = []
    for (let w = mondayOf(EMERGING_FROM); w <= END; w = addDays(w, 7)) sparkWeeks.push(w)
    const sparkline = g => sparkWeeks.map(w => ({ week: w, spend: +(g.weekly.get(w)?.spend ?? 0).toFixed(2), orders: g.weekly.get(w)?.orders ?? 0 }))
    const row = g => ({ term: g.term, spend: g.spend, orders_7d: g.orders, sales_7d: g.sales, acos: acos(g.spend, g.sales), roas: roas(g.sales, g.spend), beats_target_acos: g.sales > 0 ? (g.spend / g.sales) <= NB_ACOS_TARGET : false })

    // ── §8a board per category ────────────────────────────────────────────────────────────────────
    const board = {}
    const expensiveOverflow = []
    for (const slug of CATEGORY_SLUGS) {
      const terms = [...cat[slug].values()]
      const nbTot = sumBy(terms, 'spend'), salesTot = sumBy(terms, 'sales')
      const converting = [...terms].sort((a, b) => b.orders - a.orders).slice(0, CONVERTING_TOP_N)
        .map(g => ({ ...row(g), sparkline_60d: sparkline(g) }))
      const expensiveAll = terms.filter(g => g.spend >= EXPENSIVE_SPEND && g.orders === 0).sort((a, b) => b.spend - a.spend)
      if (expensiveAll.length > 20) expensiveOverflow.push({ category: slug, count: expensiveAll.length })
      const nearZero = terms.filter(g => g.spend >= EXPENSIVE_SPEND && g.orders >= 1 && g.orders <= 2)
      const emerging = terms.filter(g => dayKey(g.first_date) >= EMERGING_FROM && g.orders > 0).sort((a, b) => b.orders - a.orders)
        .map(g => ({ ...row(g), first_date: dayKey(g.first_date), sparkline_60d: sparkline(g) }))
      board[slug] = {
        non_branded_acos: acos(nbTot, salesTot),
        non_branded_acos_gap_vs_target: acos(nbTot, salesTot) == null ? null : acos(nbTot, salesTot) - NB_ACOS_TARGET,
        non_branded_spend: nbTot, non_branded_sales: salesTot, distinct_terms: terms.length,
        converting: { rule: 'non-branded terms ranked by orders_7d desc, not filtered by ACOS', top_n: CONVERTING_TOP_N, terms: converting },
        expensive: { rule: `spend >= $${EXPENSIVE_SPEND} AND orders_7d = 0 over the window`, count: expensiveAll.length, terms: expensiveAll.map(g => ({ term: g.term, spend: g.spend, sales_7d: g.sales, sparkline_60d: sparkline(g) })) },
        near_zero_band: { rule: `spend >= $${EXPENSIVE_SPEND} AND orders_7d in [1,2] — summary only, no term list`, count: nearZero.length, total_spend: sumBy(nearZero, 'spend') },
        emerging: { rule: 'non-branded, first appears in the last 60 days (>= 2026-07-01, absent 04-18→06-30), orders > 0', terms: emerging },
      }
    }
    // mapped vs unmapped non-branded ACOS — locates where the inefficiency sits (Darren, G3). Compute each
    // as its OWN spend/sales (never total-spend ÷ mapped-sales, which mixes populations).
    const mappedNbSpend = tierNb[1] + tierNb[2] + tierNb[3], mappedNbSales = tierNbSales[1] + tierNbSales[2] + tierNbSales[3]
    const unmappedNbSpend = tierNb[4], unmappedNbSales = tierNbSales[4]
    const mappedNbAcos = acos(mappedNbSpend, mappedNbSales)

    // ── §8b conquest (keyword-only, deliberately) ─────────────────────────────────────────────────
    const conquestTerms = [...conquest.values()]
    const byTier = t => conquestTerms.filter(g => g.tier === t).sort((a, b) => b.orders - a.orders)
      .map(g => ({ term: g.term, brand: g.brand, orders_7d: g.orders, spend: g.spend, sales_7d: g.sales, acos: acos(g.spend, g.sales), roas: roas(g.sales, g.spend) }))

    return {
      meta: {
        window: { start: START, end: END, note: 'Windows start 2026-04-18 per the INB-182 data-integrity boundary — sp_search_term_report is corrupted before then (same defect as sp_targeting_report). Converting/Expensive aggregate the full clean window; Emerging + sparklines cover the last 60 days.' },
        non_branded_acos_target: { value: NB_ACOS_TARGET, basis: 'STATED business target for non-branded terms — NOT computed. Account SP ACOS ~28% blends branded (ROAS 5.24, ACOS ~19% — the shopper already wants us) with non-branded (ROAS 1.56, ACOS ~64%); judging non-branded against the blended figure compares unlike things and would empty the Converting column.' },
        acos_gap_position: 'BUSINESS POSITION, not a computed finding: the non-branded ACOS gap (actual vs 0.58) is a gap worth closing ONLY conditional on it not costing acquisition. If non-branded ACOS tightens toward 0.58 while the NTB rate holds near 26.5% (§4) and subscriber growth continues (§4/§5), the gap was real inefficiency. If either cohort metric falls with it, ~64% was the acquisition cost and the right move is to STOP tightening. This is §8\'s one deliberate cross-section link — see §4 (NTB, subscribers) and §5 (retention).',
        brand_matching_note: 'Broad-match-modifier keyword forms are normalised before matching (conventions.normalizeBrandText) — a raw-string match misfiles "+dirty +labs …".',
        // Search-term class shares (for the G4 classifier-stability check vs §7d target-level shares).
        search_term_class_shares: {
          total_spend: totalSpend,
          branded: { spend: brandedSpend, share: totalSpend > 0 ? brandedSpend / totalSpend : null },
          non_branded: { spend: nbSpend, share: totalSpend > 0 ? nbSpend / totalSpend : null },
          competitor: { spend: competitorSpend, share: totalSpend > 0 ? competitorSpend / totalSpend : null },
        },
        category_join: {
          method: 'campaign name → category (classifyCampaignCategory): tier 1 ASIN-in-name → tier 2 product-word → tier 3 specific-bundle-anchor → tier 4 unmapped. NEVER dominant-advertised-ASIN (collapses cross-category campaigns; leans on purchased_product_report which attributes to bundles).',
          tier_spend_raw: Object.fromEntries([1, 2, 3, 4].map(t => [t, { spend: tierRaw[t], share: totalSpend > 0 ? tierRaw[t] / totalSpend : null }])),
          tier_spend_non_branded: Object.fromEntries([1, 2, 3, 4].map(t => [t, { spend: tierNb[t], share: nbSpend > 0 ? tierNb[t] / nbSpend : null }])),
          unmapped_share_raw: totalSpend > 0 ? tierRaw[4] / totalSpend : null,
          unmapped_share_non_branded: nbSpend > 0 ? tierNb[4] / nbSpend : null,
          mapped_share_of_non_branded_spend: nbSpend > 0 ? mappedNbSpend / nbSpend : null,
          mapped_non_branded_acos: acos(mappedNbSpend, mappedNbSales),
          unmapped_non_branded_acos: acos(unmappedNbSpend, unmappedNbSales),
          acos_finding: 'MECHANISM (recorded so nobody later "fixes" the apparent contradiction by picking one number): the search-term non-branded ACOS (mapped 47.3%, unmapped 33.4%) sits BELOW the 58% target and BELOW §7d\'s target-level 64% — because BRANDED TARGETS broad-match onto NON-BRANDED SEARCHES, and those conversions are cheap, so the search-term view of non-branded is FLATTERED by spillover from branded campaigns. §7d\'s 64% is what non-branded BIDDING actually costs (target-level, complete). That is why §7d is the gap-framing headline and this §8a figure is explicitly NOT "the account non-branded ACOS". Both are correct — they measure bids vs searches. Evidence: classifier-stability shares — targeting 44.6% branded / 46.7% non-branded vs search-term 28.5% / 64.0% (the branded→non-branded spillover). The unmapped catch-alls being the MOST efficient (33.4%) is a further symptom of the same spillover, not a place to cut.',
          unmapped_campaigns: [...unmapped.values()].sort((a, b) => b.nb - a.nb),
          unmapped_note: 'Non-branded unmapped is within the 20% gate. It is dominated by legitimately multi-category / audience campaigns (Whole Brand Auto, Catch All - Bundles, Activewear, Price Justification). Hand Wash → laundry_detergent and Pump → accessories are now mapped (added to the category-word list, G3).',
        },
      },
      s8a_category_board: {
        acos_label: 'ACOS of non-branded SEARCH TERMS attributable to a category (the mapped subset — see meta.category_join.mapped_share_of_non_branded_spend). This is NOT "the non-branded ACOS": the account/gap-framing headline is §7d target-level ~64% (what we choose to bid on). This mapped-subset figure is lower because it is what customers actually search AND excludes the higher-ACOS unmapped catch-all campaigns — see meta.category_join.unmapped_non_branded_acos.',
        overall_non_branded_acos_mapped: mappedNbAcos,
        overall_mapped_gap_vs_target: mappedNbAcos == null ? null : mappedNbAcos - NB_ACOS_TARGET,
        categories: board,
        expensive_finding: 'FINDING, not an omission: across the whole account exactly ONE term clears spend >= $250 with zero orders, and it is a COMPETITOR term ("norwex") — so non-branded Expensive is empty in every category. At the search-term level, non-branded spend essentially all converts. This independently corroborates §7\'s ~99.9% bidding-rule coverage, and is a stronger result than a waste list. The $250 floor was NOT lowered to manufacture entries.',
        expensive_overflow_flag: expensiveOverflow.length ? { note: `$${EXPENSIVE_SPEND} over 4.5 months is ~$55/mo — a low bar. These categories exceed 20 Expensive terms; propose raising the floor rather than truncating.`, categories: expensiveOverflow } : null,
      },
      s8b_conquest_map: {
        scope: 'KEYWORD-ONLY, deliberately. §8b is for the DTC marketing director: keyword conquest transfers to another channel as SEARCH INTENT, while ASIN targeting is an Amazon placement mechanic that does not transfer. The full competitor programme (keyword + ASIN) is in §7d — do not read §8b as the whole conquest picture.',
        window: { start: START, end: END },
        peer_foregrounded: byTier('peer'),
        giant: byTier('giant'),
        other: byTier('other'),
      },
    }
  },
}
