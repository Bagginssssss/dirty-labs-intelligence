import { calculateDerivedMetrics, calculateDerivedMetricsRange } from '@/lib/derived-metrics'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { brand_id, date, start_date, end_date } = body

    if (!brand_id) {
      return Response.json({ error: 'brand_id is required' }, { status: 400 })
    }

    if (start_date && end_date) {
      const results = await calculateDerivedMetricsRange(brand_id, start_date, end_date)
      const ok    = results.filter(r => r.status === 'ok').length
      const empty = results.filter(r => r.status === 'no_data').length
      return Response.json({ status: 'ok', dates_processed: results.length, dates_with_data: ok, dates_empty: empty, results })
    }

    if (!date) {
      return Response.json({ error: 'date or start_date + end_date is required' }, { status: 400 })
    }

    const result = await calculateDerivedMetrics(brand_id, date)
    return Response.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
