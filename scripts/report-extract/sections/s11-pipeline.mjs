// INB-178 Phase 2 §11 — What's next (pipeline, not performance).
// Five new ASINs: first-seen + sessions only — NO performance claims (they are ~two weeks old; any figure
// is noise). Plus a bundle-sales sidebar (virtual_bundle_sales_daily) for the canister-switchover story,
// NEVER additive to §1 or §6 (Amazon attributes bundle revenue to the component ASINs).
import { BRAND_ID, dayKey, monthKey, sumBy } from '../conventions.mjs'

const NEW_ASINS = ['B0GWPMKF2J', 'B0GWPK14QL', 'B0GWPKMJGQ', 'B0HF6F4QXB', 'B0HF6FC28C']

export default {
  key: 's11_pipeline',
  async extract({ db }) {
    const asins = await db.selectAll('asins', 'id,asin,product_line,title,created_at', {
      filter: q => q.eq('brand_id', BRAND_ID).in('asin', NEW_ASINS), order: [{ column: 'asin' }],
    })
    const ids = asins.map(a => a.id)
    const br = ids.length ? await db.selectAll('business_report', 'asin_id,report_date,sessions_total', {
      filter: q => q.eq('brand_id', BRAND_ID).in('asin_id', ids), order: [{ column: 'report_date' }],
    }) : []

    const newAsins = asins.map(a => {
      const rows = br.filter(r => r.asin_id === a.id)
      const dates = rows.map(r => dayKey(r.report_date)).sort()
      return {
        asin: a.asin, product_line: a.product_line, title: a.title,
        asin_created: dayKey(a.created_at),
        first_business_report_window: dates[0] ?? null,
        sessions_to_date: sumBy(rows, 'sessions_total'), // first-signal only — NOT a performance claim
      }
    })

    const bundles = await db.selectAll('virtual_bundle_sales_daily', 'bundle_asin,sale_date,bundles_sold,total_sales_usd', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('sale_date', '2026-01-01'), order: [{ column: 'sale_date' }],
    })
    const monthly = {}
    for (const r of bundles) {
      const m = monthKey(r.sale_date)
      const g = monthly[m] ?? { month: m, bundles_sold: 0, total_sales_usd: 0 }
      g.bundles_sold += Number(r.bundles_sold ?? 0); g.total_sales_usd += Number(r.total_sales_usd ?? 0)
      monthly[m] = g
    }

    return {
      meta: {
        note: 'Pipeline, not performance. The five new ASINs are ~two weeks old; any performance figure is noise. Sessions are reported as a first-signal only — NO performance claims. Bundle sales are a virtual_bundle_sales_daily sidebar for the canister-switchover story and are NEVER additive to §1 or §6 (Amazon attributes bundle revenue to component ASINs).',
      },
      new_asins: { note: 'No performance claims — first-seen + sessions only.', asins: newAsins },
      bundle_sidebar: {
        note: 'virtual_bundle_sales_daily, monthly. Frames the 2-pack canister S&S switchover. NEVER additive to account or category totals.',
        monthly: Object.values(monthly).sort((a, b) => (a.month < b.month ? -1 : 1)),
      },
    }
  },
}
