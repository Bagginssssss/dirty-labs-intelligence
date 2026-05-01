import { supabaseAdmin } from '@/lib/supabase-admin'

export type WatchType   = 'buy_box' | 'ntb_rate' | 'spend_pacing' | 'keyword_rank' | 'roas' | 'cvr' | 'custom'
export type Direction   = 'below' | 'above'
export type WatchStatus = 'active' | 'triggered' | 'resolved'

export interface WatchItem {
  id:           string
  watch_type:   string
  entity_id:    string | null
  entity_name:  string
  metric:       string
  threshold:    number | null
  direction:    string
  status:       string
  notes:        string | null
  triggered_at: string | null
}

export async function addWatch(
  brandId:    string,
  watchType:  WatchType,
  entityName: string,
  metric:     string,
  threshold:  number,
  direction:  Direction,
  notes?:     string,
  entityId?:  string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('platform_watchlist')
    .insert({
      brand_id:    brandId,
      watch_type:  watchType,
      entity_id:   entityId ?? null,
      entity_name: entityName,
      metric,
      threshold,
      direction,
      status:      'active',
      notes:       notes ?? null,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`addWatch failed: ${error?.message}`)
  return data.id as string
}

export async function getActiveWatches(brandId: string): Promise<WatchItem[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_watchlist')
    .select('id, watch_type, entity_id, entity_name, metric, threshold, direction, status, notes, triggered_at')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('watch_type')

  if (error) throw new Error(`getActiveWatches failed: ${error.message}`)
  return (data ?? []) as WatchItem[]
}

// currentMetrics keys: "entityName_metric" (e.g. "account_blended_roas", "B09B85NGBT_buy_box_pct")
export async function checkWatchlist(
  brandId:        string,
  currentMetrics: Record<string, number>
): Promise<WatchItem[]> {
  const watches  = await getActiveWatches(brandId)
  const triggered: WatchItem[] = []

  for (const watch of watches) {
    const key          = `${watch.entity_name}_${watch.metric}`
    const currentValue = currentMetrics[key]
    if (currentValue === undefined || watch.threshold === null) continue

    const isTriggered = watch.direction === 'below'
      ? currentValue < watch.threshold
      : currentValue > watch.threshold

    if (isTriggered) {
      await triggerAlert(watch.id)
      triggered.push(watch)
    }
  }

  return triggered
}

export async function triggerAlert(watchId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_watchlist')
    .update({ status: 'triggered', triggered_at: new Date().toISOString() })
    .eq('id', watchId)

  if (error) throw new Error(`triggerAlert failed: ${error.message}`)
}

export async function resolveAlert(watchId: string, notes?: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_watchlist')
    .update({
      status:       'active',
      resolved_at:  new Date().toISOString(),
      triggered_at: null,
      ...(notes ? { notes } : {}),
    })
    .eq('id', watchId)

  if (error) throw new Error(`resolveAlert failed: ${error.message}`)
}

export async function seedDefaultWatches(brandId: string): Promise<void> {
  const watches: Array<Parameters<typeof addWatch>> = [
    [brandId, 'buy_box', 'B09B85NGBT', 'buy_box_pct', 95, 'below',
      'Hero dish SKU — flag immediately if Buy Box drops', 'B09B85NGBT'],
    [brandId, 'buy_box', 'B09B7YS1VK', 'buy_box_pct', 95, 'below',
      'Hero laundry SKU — flag immediately if Buy Box drops', 'B09B7YS1VK'],
    [brandId, 'buy_box', 'B09B7WLWW3', 'buy_box_pct', 95, 'below',
      'Dish Aestival 48-load — monitor Buy Box', 'B09B7WLWW3'],
    [brandId, 'roas', 'account', 'blended_roas', 2.5, 'below',
      'Blended ROAS floor — investigate if sustained below 2.5x'],
    [brandId, 'spend_pacing', 'account', 'monthly_spend_pct', 85, 'below',
      'Flag if spend is below 85% of monthly target by mid-month'],
    [brandId, 'ntb_rate', 'account', 'paid_ntb_rate', 1.5, 'below',
      'SB/SBV paid NTB rate only — true NTB is higher'],
  ]

  for (const args of watches) {
    await addWatch(...args)
  }
}

export function formatWatchlistForPrompt(triggeredWatches: WatchItem[]): string {
  if (triggeredWatches.length === 0) return ''

  const lines = triggeredWatches.map(w => {
    const entity = w.entity_id && w.entity_id !== w.entity_name
      ? `${w.entity_name} (${w.entity_id})`
      : w.entity_name
    return `⚠️ CRITICAL [${w.watch_type.toUpperCase()}] - ${entity}: ${w.metric} threshold ${w.direction} ${w.threshold}`
  })

  return `ACTIVE ALERTS:\n${lines.join('\n')}`
}
