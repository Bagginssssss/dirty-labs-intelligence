import { supabaseAdmin } from '@/lib/supabase-admin'

export type InsightType = 'anomaly' | 'opportunity' | 'recommendation' | 'decision' | 'weekly_briefing'
export type Severity    = 'critical' | 'warning' | 'info'

export interface Insight {
  id:              string
  insight_type:    string
  severity:        string
  title:           string
  content:         string
  supporting_data: Record<string, unknown> | null
  actioned:        boolean
  created_at:      string
}

export async function saveInsight(
  brandId:        string,
  type:           InsightType,
  title:          string,
  content:        string,
  severity?:      Severity,
  supportingData?: Record<string, unknown>
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('platform_insights')
    .insert({
      brand_id:        brandId,
      insight_type:    type,
      severity:        severity ?? 'info',
      title,
      content,
      supporting_data: supportingData ?? null,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`saveInsight failed: ${error?.message}`)
  return data.id as string
}

export async function getRecentInsights(
  brandId: string,
  days    = 30,
  limit   = 20
): Promise<Insight[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('platform_insights')
    .select('id, insight_type, severity, title, content, supporting_data, actioned, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`getRecentInsights failed: ${error.message}`)
  return (data ?? []) as Insight[]
}

export async function markActioned(
  insightId:        string,
  notes?:           string,
  outcomePositive?: boolean
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_insights')
    .update({
      actioned:         true,
      actioned_at:      new Date().toISOString(),
      actioned_notes:   notes ?? null,
      outcome_notes:    notes ?? null,
      outcome_positive: outcomePositive ?? null,
    })
    .eq('id', insightId)

  if (error) throw new Error(`markActioned failed: ${error.message}`)
}

export function formatInsightsForPrompt(insights: Insight[]): string {
  if (insights.length === 0) return ''

  const lines = insights.map(i => {
    const date = i.created_at.slice(0, 10)
    const tag  = i.actioned ? ' [ACTIONED]' : ''
    return `- [${date}] [${i.severity.toUpperCase()}] ${i.title}: ${i.content}${tag}`
  })

  return `RECENT INSIGHTS (last 30 days):\n${lines.join('\n')}`
}
