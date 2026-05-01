import { supabaseAdmin } from '@/lib/supabase-admin'
import { GoalProgressRow } from './types'

// 2026 monthly targets (index 0 = January)
const SALES_TARGETS  = [1971947, 1838184, 2044145, 2066521, 2136627, 2176608, 2498316, 2301749, 2303883, 2374265, 2427553, 2489095]
const SPEND_TARGETS  = [167227,  155521,  166408,  169736,  176525,  185352,  213155,  191839,  192798,  196654,  202554,  208630]
const ROAS_TARGETS   = [3.30, 3.20, 3.40, 3.40, 3.40, 3.30, 3.30, 3.40, 3.40, 3.40, 3.40, 3.40]
const NTB_TARGETS    = [20071, 18812, 19848, 20198, 20863, 21713, 24970, 22361, 22498, 23097, 23686, 24291]

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// month: 'YYYY-MM'
export async function getGoalProgress(
  brandId: string,
  month: string
): Promise<GoalProgressRow[]> {
  const [year, mon] = month.split('-').map(Number)
  const idx = mon - 1

  const salesTarget = SALES_TARGETS[idx]
  const spendTarget = SPEND_TARGETS[idx]
  const roasTarget  = ROAS_TARGETS[idx]
  const ntbTarget   = NTB_TARGETS[idx]

  if (salesTarget === undefined) {
    throw new Error(`No targets defined for month: ${month}`)
  }

  const monthStart = `${month}-01`
  const lastDay    = String(daysInMonth(year, mon)).padStart(2, '0')
  const monthEnd   = `${month}-${lastDay}`

  const { data, error } = await supabaseAdmin
    .from('derived_metrics_daily')
    .select('total_revenue, total_ppc_spend, total_ppc_sales, total_orders, ntb_orders, metric_date')
    .eq('brand_id', brandId)
    .gte('metric_date', monthStart)
    .lte('metric_date', monthEnd)
    .order('metric_date')

  if (error) throw new Error(`getGoalProgress failed: ${error.message}`)

  const rows       = data ?? []
  const daysData   = rows.length
  const totalDays  = daysInMonth(year, mon)

  type Row = Record<string, unknown>
  const typedRows = rows as unknown as Row[]
  const sumField = (f: string): number =>
    typedRows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0)

  const actualRevenue = sumField('total_revenue')
  const actualSpend   = sumField('total_ppc_spend')
  const actualSales   = sumField('total_ppc_sales')
  const actualOrders  = sumField('total_orders')
  const actualNtb     = sumField('ntb_orders')
  const actualRoas    = actualSpend > 0 ? actualSales / actualSpend : null

  // Prorated targets based on days with data in month
  const pace = daysData / totalDays

  function makeRow(
    metric: string,
    target: number,
    actual: number,
    isRate = false
  ): GoalProgressRow {
    const pct = target > 0 ? actual / target : null
    const proratedTarget = isRate ? target : target * pace
    const on_track = isRate
      ? (actual >= target * 0.95)
      : (proratedTarget > 0 ? actual >= proratedTarget * 0.95 : false)
    return {
      metric,
      period:       month,
      target,
      actual,
      pct_of_target: pct,
      on_track,
      gap:          target - actual,
    }
  }

  const results: GoalProgressRow[] = [
    makeRow('total_revenue', salesTarget, actualRevenue),
    makeRow('ppc_spend',     spendTarget, actualSpend),
    makeRow('ntb_orders',    ntbTarget,   actualNtb),
  ]

  // ROAS is a rate metric — compare directly to target (not prorated)
  if (actualRoas !== null) {
    results.push(makeRow('blended_roas', roasTarget, actualRoas, true))
  } else {
    results.push({
      metric:        'blended_roas',
      period:        month,
      target:        roasTarget,
      actual:        0,
      pct_of_target: null,
      on_track:      false,
      gap:           roasTarget,
    })
  }

  return results
}
