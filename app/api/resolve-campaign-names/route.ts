import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { BRAND_ID } from '@/lib/dashboard/data'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { campaign_ids } = body as { campaign_ids?: unknown }

  if (!Array.isArray(campaign_ids) || campaign_ids.length === 0) {
    return NextResponse.json({ names: {} })
  }

  const ids = campaign_ids.filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return NextResponse.json({ names: {} })

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, campaign_name')
    .eq('brand_id', BRAND_ID)
    .in('id', ids)

  if (error) {
    return NextResponse.json({ names: {} }, { status: 500 })
  }

  const names: Record<string, string> = {}
  const found = new Set<string>()

  for (const row of data ?? []) {
    names[row.id] = (row.campaign_name as string | null) ?? '[unnamed campaign]'
    found.add(row.id)
  }

  // IDs in localStorage but absent from the campaigns table (deleted/orphaned)
  for (const id of ids) {
    if (!found.has(id)) names[id] = '[campaign not found]'
  }

  return NextResponse.json({ names })
}
