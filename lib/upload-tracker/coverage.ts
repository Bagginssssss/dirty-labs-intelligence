// Bounded date-coverage fetch for the upload tracker (INB-139).
//
// Fetches a report type's distinct data dates via the get_report_date_coverage
// RPC (migration 036) — one call, ~hundreds of rows at most — replacing the old
// unbounded fetchAll that pulled EVERY source row for the brand (448K rows on
// sp_targeting_report, ~449 sequential 1000-row pages) and deduped in JS, which
// exceeded Postgres's statement timeout on every tracker cache miss.
//
// Server only — imports the service-role client (the RPC's EXECUTE is granted
// to service_role exclusively).

import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ReportRegistryEntry } from './registry'

export async function fetchDistinctDates(
  entry: ReportRegistryEntry,
  brandId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc('get_report_date_coverage', {
    p_brand_id: brandId,
    p_source_table: entry.source_table,
    p_ad_types: entry.source_filter?.values ?? null,
  })
  if (error) {
    throw new Error(`date coverage query failed for ${entry.source_table}: ${error.message}`)
  }
  // RETURNS TABLE (d date), already ordered ascending by the RPC.
  return ((data ?? []) as { d: string }[]).map(r => String(r.d).slice(0, 10))
}
