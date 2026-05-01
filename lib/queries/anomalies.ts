import { supabaseAdmin } from '@/lib/supabase-admin'
import { AnomalyItem } from './types'

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null
  return (current - prior) / prior
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// Monthly targets (0-based: index 0 = January)
const MONTHLY_SPEND_TARGETS = [167227, 155521, 166408, 169736, 176525, 185352, 213155, 191839, 192798, 196654, 202554, 208630]

export async function getAnomalies(
  brandId: string,
  currentDate: string,
  lookbackDays = 7
): Promise<AnomalyItem[]> {
  const anomalies: AnomalyItem[] = []

  const windowEnd   = currentDate
  const windowStart = addDays(currentDate, -lookbackDays + 1)
  const priorEnd    = addDays(windowStart, -1)
  const priorStart  = addDays(priorEnd, -lookbackDays + 1)

  // ── 1. Fetch current and prior period derived metrics ─────────────────────
  const [curRes, priorRes, campaignRes, bizRes] = await Promise.all([
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_ppc_spend, total_ppc_sales, total_revenue, total_orders, ntb_orders, total_clicks, metric_date')
      .eq('brand_id', brandId)
      .gte('metric_date', windowStart)
      .lte('metric_date', windowEnd),
    supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_ppc_spend, total_ppc_sales, total_revenue, total_orders, ntb_orders, total_clicks')
      .eq('brand_id', brandId)
      .gte('metric_date', priorStart)
      .lte('metric_date', priorEnd),
    supabaseAdmin
      .from('sp_campaign_performance')
      .select('campaign_id, spend, sales_7d, orders_7d')
      .eq('brand_id', brandId)
      .gte('report_date', windowStart)
      .lte('report_date', windowEnd),
    supabaseAdmin
      .from('business_report')
      .select('asin_id, buy_box_pct, report_date')
      .eq('brand_id', brandId)
      .gte('report_date', windowStart)
      .lte('report_date', windowEnd),
  ])

  const cur   = curRes.data   ?? []
  const prior = priorRes.data ?? []

  const sumField = (rows: Record<string, unknown>[], f: string): number =>
    rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0)

  const curSpend    = sumField(cur, 'total_ppc_spend')
  const curSales    = sumField(cur, 'total_ppc_sales')
  const curRevenue  = sumField(cur, 'total_revenue')
  const curOrders   = sumField(cur, 'total_orders')
  const curNtb      = sumField(cur, 'ntb_orders')
  const curClicks   = sumField(cur, 'total_clicks')

  const priorSpend  = sumField(prior, 'total_ppc_spend')
  const priorSales  = sumField(prior, 'total_ppc_sales')
  const priorOrders = sumField(prior, 'total_orders')
  const priorNtb    = sumField(prior, 'ntb_orders')

  const curRoas  = ratio(curSales, curSpend)
  const priorRoas = ratio(priorSales, priorSpend)
  const curNtbRate  = ratio(curNtb, curOrders)
  const priorNtbRate = ratio(priorNtb, priorOrders)

  // ── Check 1: ROAS drop > 20% vs prior period ──────────────────────────────
  if (curRoas !== null && priorRoas !== null && priorRoas > 0) {
    const delta = pctDelta(curRoas, priorRoas)
    if (delta !== null && delta < -0.2) {
      anomalies.push({
        type:          'roas_drop',
        severity:      delta < -0.35 ? 'critical' : 'warning',
        entity:        'account',
        metric:        'blended_roas',
        current_value: curRoas,
        expected_value: priorRoas,
        delta_pct:     delta,
        note:          `Blended ROAS dropped ${Math.abs(delta * 100).toFixed(1)}% vs prior ${lookbackDays}-day period (${priorRoas.toFixed(2)}x → ${curRoas.toFixed(2)}x)`,
      })
    }
  }

  // ── Check 2: Spend pacing vs monthly target ───────────────────────────────
  const monthStr  = currentDate.slice(0, 7)
  const monthIdx  = parseInt(currentDate.slice(5, 7), 10) - 1
  const monthTarget = MONTHLY_SPEND_TARGETS[monthIdx]

  if (monthTarget !== undefined && cur.length > 0) {
    const monthStart = currentDate.slice(0, 8) + '01'
    const { data: monthSpendData } = await supabaseAdmin
      .from('derived_metrics_daily')
      .select('total_ppc_spend')
      .eq('brand_id', brandId)
      .gte('metric_date', monthStart)
      .lte('metric_date', currentDate)

    const monthSpend   = sumField(monthSpendData ?? [], 'total_ppc_spend')
    const daysElapsed  = (monthSpendData ?? []).length || 1
    const totalDays    = daysInMonth(monthStr)
    const proratedTarget = monthTarget * (daysElapsed / totalDays)
    const pacingPct    = proratedTarget > 0 ? monthSpend / proratedTarget : null

    if (pacingPct !== null && pacingPct < 0.85) {
      anomalies.push({
        type:          'spend_pacing',
        severity:      pacingPct < 0.7 ? 'critical' : 'warning',
        entity:        'account',
        metric:        'monthly_spend_pct',
        current_value: monthSpend,
        expected_value: proratedTarget,
        delta_pct:     pacingPct - 1,
        note:          `Month-to-date spend $${monthSpend.toFixed(0)} is ${(pacingPct * 100).toFixed(0)}% of prorated target $${proratedTarget.toFixed(0)} (day ${daysElapsed}/${totalDays} of month)`,
      })
    }
  }

  // ── Check 3: Buy box drops ────────────────────────────────────────────────
  if (!bizRes.error) {
    const asinLatestBb = new Map<string, number>()
    // bizRes rows are not sorted — find min buy_box_pct per asin across window
    for (const row of (bizRes.data ?? [])) {
      if (row.buy_box_pct === null) continue
      const id  = row.asin_id as string
      const val = Number(row.buy_box_pct)
      const cur = asinLatestBb.get(id)
      if (cur === undefined || val < cur) asinLatestBb.set(id, val)
    }

    const asinRes = await supabaseAdmin
      .from('asins')
      .select('id, asin, title')
      .eq('brand_id', brandId)
      .in('id', Array.from(asinLatestBb.keys()))

    const asinNameMap = new Map((asinRes.data ?? []).map(a => [a.id, { asin: a.asin, title: a.title }]))

    for (const [asinId, bbPct] of asinLatestBb.entries()) {
      if (bbPct < 90) {
        const info = asinNameMap.get(asinId)
        anomalies.push({
          type:          'buy_box_drop',
          severity:      bbPct < 80 ? 'critical' : 'warning',
          entity:        info?.asin ?? asinId,
          metric:        'buy_box_pct',
          current_value: bbPct,
          expected_value: 95,
          note:          `${info?.title ?? info?.asin ?? asinId} Buy Box at ${bbPct.toFixed(1)}% (below 90% threshold)`,
        })
      }
    }
  }

  // ── Check 4: High ACOS campaigns ─────────────────────────────────────────
  if (!campaignRes.error) {
    const campAcc = new Map<string, { spend: number; sales: number; orders: number }>()
    for (const row of (campaignRes.data ?? [])) {
      const id = row.campaign_id as string
      if (!campAcc.has(id)) campAcc.set(id, { spend: 0, sales: 0, orders: 0 })
      const a = campAcc.get(id)!
      a.spend  += Number(row.spend) || 0
      a.sales  += Number(row.sales_7d) || 0
      a.orders += Number(row.orders_7d) || 0
    }

    const campaignMeta = await supabaseAdmin
      .from('campaigns')
      .select('id, campaign_name')
      .eq('brand_id', brandId)
      .in('id', Array.from(campAcc.keys()))

    const nameMap = new Map((campaignMeta.data ?? []).map(c => [c.id, c.campaign_name]))

    for (const [id, agg] of campAcc.entries()) {
      // Check 4a: high ACOS (> 50%) with meaningful spend
      if (agg.spend >= 50 && agg.sales > 0) {
        const acos = agg.spend / agg.sales
        if (acos > 0.5) {
          anomalies.push({
            type:          'high_acos_campaign',
            severity:      acos > 1.0 ? 'critical' : 'warning',
            entity:        nameMap.get(id) ?? id,
            metric:        'acos',
            current_value: acos,
            expected_value: 0.3,
            note:          `Campaign ACOS ${(acos * 100).toFixed(1)}% on $${agg.spend.toFixed(0)} spend`,
          })
        }
      }

      // Check 5: zero-sales campaigns with spend
      if (agg.spend >= 50 && agg.orders === 0) {
        anomalies.push({
          type:          'zero_sales_campaign',
          severity:      agg.spend >= 200 ? 'critical' : 'warning',
          entity:        nameMap.get(id) ?? id,
          metric:        'orders',
          current_value: 0,
          note:          `Campaign spent $${agg.spend.toFixed(0)} with 0 orders in last ${lookbackDays} days`,
        })
      }
    }
  }

  // ── Check 6: NTB rate below target ───────────────────────────────────────
  const NTB_RATE_TARGET = 0.015 // 1.5% (SB/SBV paid NTB only)
  if (curNtbRate !== null && curOrders > 100) {
    const delta = pctDelta(curNtbRate, priorNtbRate ?? NTB_RATE_TARGET)
    if (curNtbRate < NTB_RATE_TARGET) {
      anomalies.push({
        type:          'low_ntb_rate',
        severity:      curNtbRate < NTB_RATE_TARGET * 0.5 ? 'critical' : 'warning',
        entity:        'account',
        metric:        'paid_ntb_rate',
        current_value: curNtbRate,
        expected_value: NTB_RATE_TARGET,
        delta_pct:     delta ?? undefined,
        note:          `Paid NTB rate ${(curNtbRate * 100).toFixed(2)}% below 1.5% target (SB/SBV only — true NTB is higher via Brand Analytics)`,
      })
    }
  }

  return anomalies.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 }
    return order[a.severity] - order[b.severity]
  })
}
