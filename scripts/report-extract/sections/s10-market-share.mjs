// INB-178 Phase 2 §10 — Market share (SmartScout, modeled estimates).
// DL brand share + rank per weekly snapshot across four subcategories, plus product-level share. Rank is
// derived by ordering all brands in a subcategory+snapshot by market_share. MODELED ESTIMATES — directional
// for movement, never quotable as revenue. Full precision — no rounding here.
import { BRAND_ID, dayKey } from '../conventions.mjs'

const SUBCATEGORIES = ['dishwasher_detergent', 'laundry_detergent', 'laundry_stain_remover', 'toilet_bowl_cleaner']
const DL = 'Dirty Labs'

export default {
  key: 's10_market_share',
  async extract({ db }) {
    const brands = await db.selectAll('smartscout_subcategory_brands', 'snapshot_date,subcategory,brand_name,market_share,market_share_change,est_monthly_revenue', {
      filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'snapshot_date' }],
    })
    const snaps = [...new Set(brands.map(r => dayKey(r.snapshot_date)))].sort()
    const latestSnap = snaps.at(-1)

    const bySubcategory = {}
    for (const sc of SUBCATEGORIES) {
      const series = snaps.map(snap => {
        const rows = brands.filter(r => r.subcategory === sc && dayKey(r.snapshot_date) === snap)
          .sort((a, b) => Number(b.market_share) - Number(a.market_share))
        const idx = rows.findIndex(r => r.brand_name === DL)
        if (idx < 0) return null
        return { snapshot: snap, market_share: Number(rows[idx].market_share), rank: idx + 1, brands_ranked: rows.length, est_monthly_revenue: Number(rows[idx].est_monthly_revenue) }
      }).filter(Boolean)
      bySubcategory[sc] = { series, latest: series.at(-1) ?? null }
    }

    const products = await db.selectAll('smartscout_subcategory_products', 'snapshot_date,subcategory,asin,title,brand_name,category_revenue_pct,primary_subcategory_rank,est_monthly_revenue', {
      filter: q => q.eq('brand_id', BRAND_ID).ilike('brand_name', '%dirty labs%'), order: [{ column: 'snapshot_date' }],
    })
    const dlProductsLatest = products.filter(p => dayKey(p.snapshot_date) === latestSnap)
      .map(p => ({ subcategory: p.subcategory, asin: p.asin, title: p.title, category_revenue_pct: Number(p.category_revenue_pct), subcategory_rank: p.primary_subcategory_rank, est_monthly_revenue: Number(p.est_monthly_revenue) }))
      .sort((a, b) => (b.category_revenue_pct ?? 0) - (a.category_revenue_pct ?? 0))

    return {
      meta: {
        caveat: 'SmartScout figures are MODELED ESTIMATES from weekly pulls, not reported Amazon data. Directional for share movement; NOT quotable as revenue.',
        subcategories: SUBCATEGORIES,
        snapshots: snaps.length,
        snapshot_range: { first: snaps[0], last: latestSnap },
        coverage: '§10 is a ~4-month view: ' + snaps.length + ' weekly snapshots from ' + snaps[0] + ' to ' + latestSnap + ' (SmartScout data begins 2026-05-07, not 2026-03-01). State the window as ~4 months, not 6.',
        brand_name_flag: 'A separate "Dirtyl" row (0% share, deep rank) also appears in dishwasher_detergent — a SmartScout naming artifact, excluded. DL matched on exact "Dirty Labs".',
        rank_method: 'rank = position of Dirty Labs when all brands in the subcategory+snapshot are ordered by market_share descending.',
      },
      latest_snapshot: latestSnap,
      by_subcategory: bySubcategory,
      toilet_absence: 'Dirty Labs is in toilet_bowl_cleaner at only ' + (bySubcategory.toilet_bowl_cleaner.latest ? (bySubcategory.toilet_bowl_cleaner.latest.market_share * 100).toFixed(2) + '% / rank ' + bySubcategory.toilet_bowl_cleaner.latest.rank : 'n/a') + ' at the latest snapshot — outside the top 15, corroborating §6a (toilet is ~0.8% of revenue and declining).',
      dl_products_latest: dlProductsLatest,
    }
  },
}
