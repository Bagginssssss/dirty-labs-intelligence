// INB-178 Phase 2 §7 — Media mix and efficiency.
//   7a ceiling break — SP-only monthly spend/ROAS, 2025-05 → 2026-08 (YoY), each month tagged pre/post audit
//   7b monthly 2026 — all-types + SP-only spend/ROAS; June = Prime Day, post-event throttle noted
//   7c ad-type mix — SP/SB/SBV spend share by month, March 2026 onward (pre-March absence is coverage)
//   7d target-level — six buckets (auto_category reported split → seven fields), monthly, competitor tier split
//
// DATA-INTEGRITY BOUNDARY (verified at G2, per-day targeting↔campaign reconciliation): sp_targeting_report
// is reliable ONLY from 2026-04-18. A backfill (~04-18) dumped bulk loads onto 2026-03-01 (+$154,672) and
// 2026-04-01 (+$113,084) and under-reported every other pre-04-18 day; from 04-18 it ties to
// sp_campaign_performance to the cent (7 later days differ by ≤$9.46 — immaterial attribution noise). §7d
// therefore starts 2026-04-18. §7a/7b/7c source sp_campaign_performance (clean throughout) and stay full
// range. Batch A §2's zero-order-target figure ($12,317.03, March) came from sp_targeting_report and is
// INVALID — not used here. Brand matching normalises separators first (broad-match-modifier keywords like
// "+dirty +labs +laundry" have no contiguous "dirty labs"; a raw-string match silently misfiles ~$2,600
// of August spend) — see conventions.normalizeBrandText. Full precision — no rounding here.
import {
  BRAND_ID, AD_TYPES, roas, sumBy, dayKey, monthKey, calendarDaysInMonth,
  classifyTarget, S7D_BUCKETS,
} from '../conventions.mjs'

const CAMPAIGN_START = '2025-05-01', CAMPAIGN_END = '2026-08-31'
const S7D_START = '2026-04-18', S7D_END = '2026-08-29'
const PRIME_DAY_MONTH = '2026-06'
const TIERS = ['peer', 'giant', 'other']
// The audit ran in phases March → early August, not a binary pre/post (Darren, G3). Dated markers for the
// §7a series so the ROAS trajectory can be annotated with what actually changed when.
const AUDIT_PHASE_MARKERS = [
  { date: '2026-02', marker: 'ceiling event' },
  { date: '2026-03', marker: 'triage — ineffective campaigns and targets stopped' },
  { date: '2026-05', marker: 'restructure + rule-layer rework (through 2026-06)' },
  { date: '2026-06', marker: 'Prime Day, then deliberate throttle' },
  { date: '2026-08-04', marker: 'rule coverage completes (~90% → 100% of spend by 2026-08-10)' },
]

export default {
  key: 's7_media',
  async extract({ db }) {
    const cmp = await db.selectAll('sp_campaign_performance', 'report_date,ad_type,spend,sales_7d', {
      filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', CAMPAIGN_START).lte('report_date', CAMPAIGN_END),
      order: [{ column: 'report_date' }],
    })
    // sp_targeting_report is ~500k rows over this window; a single paged read drives OFFSET past 400k,
    // which scans hundreds of thousands of rows per page and times out. Pull in 7-day chunks so each
    // query's offset stays shallow (~30-40k rows / chunk). Read-only; row order within a chunk is
    // irrelevant to the aggregation.
    const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
    const tgt = []
    for (let ws = S7D_START; ws <= S7D_END; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6) < S7D_END ? addDays(ws, 6) : S7D_END
      const chunk = await db.selectAll('sp_targeting_report', 'report_date,ad_type,targeting,spend,sales_7d', {
        filter: q => q.eq('brand_id', BRAND_ID).gte('report_date', ws).lte('report_date', we),
        order: [{ column: 'report_date' }],
      })
      tgt.push(...chunk)
    }
    const asins = await db.selectAll('asins', 'asin', { filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'asin' }] })
    const ownAsinSet = new Set(asins.map(a => String(a.asin).toUpperCase()))
    const rules = await db.selectAll('scale_insights_rule_assignments', 'snapshot_date,bidding_rules,last_30d_spend', {
      filter: q => q.eq('brand_id', BRAND_ID), order: [{ column: 'snapshot_date' }],
    })

    const monthsOf = rows => [...new Set(rows.map(r => monthKey(r.report_date)))].sort()
    const cmpM = m => cmp.filter(r => monthKey(r.report_date) === m)
    const days = rows => new Set(rows.map(r => dayKey(r.report_date))).size

    // ── §7a ceiling break: SP-only monthly, full range ────────────────────────────────────────────
    const sevenA = monthsOf(cmp).map(m => {
      const sp = cmpM(m).filter(r => r.ad_type === 'SP')
      const [y, mm] = m.split('-').map(Number)
      const spend = sumBy(sp, 'spend'), sales = sumBy(sp, 'sales_7d')
      return {
        month: m, days_observed: days(sp), calendar_days: calendarDaysInMonth(y, mm),
        sp_spend: spend, sp_sales: sales, sp_roas: roas(sales, spend),
      }
    })
    const augAnchor = yr => sevenA.find(x => x.month === yr)

    // ── §7b monthly 2026: all-types + SP-only ─────────────────────────────────────────────────────
    const sevenB = monthsOf(cmp).filter(m => m.startsWith('2026')).map(m => {
      const rows = cmpM(m), sp = rows.filter(r => r.ad_type === 'SP')
      const [y, mm] = m.split('-').map(Number)
      const allSpend = sumBy(rows, 'spend'), allSales = sumBy(rows, 'sales_7d')
      const spSpend = sumBy(sp, 'spend'), spSales = sumBy(sp, 'sales_7d')
      return {
        month: m, days_observed: days(rows), calendar_days: calendarDaysInMonth(y, mm),
        all_spend: allSpend, all_sales: allSales, all_roas: roas(allSales, allSpend),
        sp_spend: spSpend, sp_sales: spSales, sp_roas: roas(spSales, spSpend),
        prime_day: m === PRIME_DAY_MONTH,
        note: m === PRIME_DAY_MONTH ? 'June peak is Prime Day; post-event budget was deliberately throttled — August is a throttle, not a retreat.' : null,
      }
    })

    // ── §7c ad-type mix: March 2026 onward ────────────────────────────────────────────────────────
    const sevenC = monthsOf(cmp).filter(m => m >= '2026-03').map(m => {
      const rows = cmpM(m), total = sumBy(rows, 'spend')
      return {
        month: m, total_spend: total,
        by_type: Object.fromEntries(AD_TYPES.map(t => {
          const s = sumBy(rows.filter(r => r.ad_type === t), 'spend')
          return [t, { spend: s, share: total > 0 ? s / total : null }]
        })),
      }
    })

    // ── §7d target-level six/seven buckets, from 2026-04-18 ────────────────────────────────────────
    const classified = tgt.map(r => ({ ...r, bucket: classifyTarget(r.targeting, ownAsinSet) }))
    const bucketAgg = rows => {
      const total = sumBy(rows, 'spend')
      const buckets = Object.fromEntries(S7D_BUCKETS.map(b => {
        const br = rows.filter(r => r.bucket.bucket === b)
        const spend = sumBy(br, 'spend'), sales = sumBy(br, 'sales_7d')
        return [b, { spend, sales_7d: sales, roas: roas(sales, spend), share_of_spend: total > 0 ? spend / total : null }]
      }))
      const ck = rows.filter(r => r.bucket.bucket === 'competitor_keyword')
      const tierSplit = Object.fromEntries(TIERS.map(t => {
        const tr = ck.filter(r => r.bucket.tier === t)
        return [t, { spend: sumBy(tr, 'spend'), sales_7d: sumBy(tr, 'sales_7d') }]
      }))
      return { total_spend: total, buckets, competitor_keyword_by_tier: tierSplit, competitor_directed_spend: buckets.competitor_asin.spend + buckets.competitor_keyword.spend }
    }
    const tgtMonths = monthsOf(tgt)
    const sevenD_monthly = tgtMonths.map(m => {
      const rows = classified.filter(r => monthKey(r.report_date) === m)
      const ds = [...new Set(rows.map(r => dayKey(r.report_date)))].sort()
      const start = ds[0], end = ds.at(-1)
      const cmpRange = sumBy(cmp.filter(r => dayKey(r.report_date) >= start && dayKey(r.report_date) <= end), 'spend')
      const agg = bucketAgg(rows)
      return {
        month: m, window: { start, end, days: ds.length }, partial: m === tgtMonths[0],
        ...agg,
        reconciliation: { targeting_spend: agg.total_spend, campaign_spend_same_range: cmpRange, difference: agg.total_spend - cmpRange },
      }
    })
    const sevenD_period = bucketAgg(classified)

    // bidding-rule share SERIES — every snapshot, last_30d_spend basis. TWO coverage measures: campaign
    // COUNT coverage vs SPEND share. Count-coverage lags spend-share because uncovered campaigns are
    // near-zero spenders. The trajectory is the finding: 20 campaigns gained rules in the week of Aug 4–10,
    // taking spend-share from ~90% to complete.
    const hasRule = r => Array.isArray(r.bidding_rules) && r.bidding_rules.length > 0
    const snapDates = [...new Set(rules.map(r => dayKey(r.snapshot_date)))].sort()
    const biddingRuleSeries = snapDates.map(d => {
      const rs = rules.filter(r => dayKey(r.snapshot_date) === d)
      const withRule = rs.filter(hasRule)
      const total30 = sumBy(rs, 'last_30d_spend'), rule30 = sumBy(withRule, 'last_30d_spend')
      return {
        snapshot_date: d, campaigns: rs.length, campaigns_with_rule: withRule.length,
        campaign_count_coverage: rs.length > 0 ? withRule.length / rs.length : null,
        total_30d_spend: total30, under_bidding_rule_30d_spend: rule30,
        spend_share: total30 > 0 ? rule30 / total30 : null,
      }
    })

    return {
      meta: {
        sources: '§7a/7b/7c: sp_campaign_performance (spend source of record). §7d: sp_targeting_report classified by classifyTarget (six buckets; auto_category split → auto + category).',
        data_integrity: {
          finding: 'sp_targeting_report is reliable ONLY from 2026-04-18. A backfill (~04-18) dumped bulk loads onto 2026-03-01 (+$154,672.39) and 2026-04-01 (+$113,084.37) and under-reported every other pre-04-18 day. From 04-18 it reconciles to sp_campaign_performance to the cent (7 later days differ by ≤$9.46 — immaterial attribution noise). Verified by per-day reconciliation, G2.',
          sp_targeting_reliable_from: S7D_START,
          consequence: 'Nothing before 2026-04-18 may be used for spend analysis from sp_targeting_report. §7d starts here; §7a/7b/7c use sp_campaign_performance and are unaffected.',
          invalidated: 'Batch A §2 zero-order-target figure ($12,317.03 SP, March 2026) is sourced from sp_targeting_report March and is INVALID — must be removed from §2. §2\'s February argument (spend +47%, ad sales +0.9%, revenue/day flat) is unaffected as it is sourced from business_report_daily + sp_campaign_performance.',
        },
        brand_matching_note: 'Broad-match-modifier keyword forms (e.g. "+dirty +labs +laundry +detergent") exist in sp_targeting_report and have no contiguous brand string. Any brand matching MUST normalize separators first (conventions.normalizeBrandText strips non-alphanumerics before matching) — a raw-string match silently misfiles them; they are ~$2,600 of August spend alone.',
      },
      s7a_ceiling_break: {
        note: 'SP-only monthly spend vs ROAS, 2025-05 → 2026-08. The audit ran in phases (see phase_markers), not a binary pre/post.',
        phase_markers: AUDIT_PHASE_MARKERS,
        yoy_anchor: {
          note: 'SP-only August→August. Aug 2026 is 29 observed days vs 31 in 2025 — normalise on days when quoting the spend increase (raw +77.6%; ~+90% per-day).',
          aug_2025: augAnchor('2025-08'), aug_2026: augAnchor('2026-08'),
        },
        months: sevenA,
      },
      s7b_monthly_2026: {
        note: 'All-types and SP-only spend + ROAS by month, 2026. June is Prime Day; the post-event throttle is flagged so August does not read as retreat.',
        months: sevenB,
      },
      s7c_ad_type_mix: {
        note: 'SP/SB/SBV spend share by month, March 2026 onward. The pre-March absence of SB/SBV is a COVERAGE limitation (sp_campaign_performance carries SB/SBV only from 2026-03-01), not a budget decision.',
        sbsbv_absence_is_coverage_not_budget: true,
        months: sevenC,
      },
      s7d_target_class: {
        note: 'Target-level six buckets (auto_category reported split → auto + category = seven fields). Windowed 2026-04-18 → 2026-08-29 per the data-integrity boundary; April is a partial 13-day window (04-18–30), labelled. competitor-directed spend = competitor_asin + competitor_keyword (the account runs conquest on BOTH the ASIN-placement rail and the keyword rail).',
        non_branded_acos_headline: 'non_branded_keyword ROAS 1.56 → ACOS ~64% is the HEADLINE for the "gap to close" framing: it is target-level and complete — what non-branded BIDDING actually costs. §8a\'s search-term non-branded ACOS is much lower (mapped 47.3%, unmapped 33.4%) because BRANDED TARGETS broad-match onto NON-BRANDED SEARCHES and those cheap conversions FLATTER the search-term view. Use §7d\'s 64% for the gap; do NOT reconcile the two by picking one — they measure bids vs searches (classifier-stability shares: targeting 44.6% branded / 46.7% non-branded vs search-term 28.5% / 64.0%).',
        window: { start: S7D_START, end: S7D_END },
        bucket_order: S7D_BUCKETS,
        monthly: sevenD_monthly,
        period_totals: sevenD_period,
        bidding_rule_share: {
          basis: 'scale_insights_rule_assignments, last_30d_spend per snapshot — NOT aligned to the §7d monthly windows. TWO coverage measures per snapshot: campaign_count_coverage (campaigns_with_rule / campaigns) and spend_share (rule spend / total). At the latest snapshot 563 of 700 campaigns (80%) carry a rule but they are 99.94% of spend — the uncovered 137 are near-zero spenders.',
          note: 'Trajectory is the finding: spend_share ~90% through Jul → early Aug, then 20 campaigns gained rules in the week of Aug 4–10, taking coverage to complete (100% Aug 10–17, 99.94% Aug 31).',
          series: biddingRuleSeries,
        },
      },
    }
  },
}
