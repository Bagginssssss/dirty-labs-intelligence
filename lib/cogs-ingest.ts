import { supabaseAdmin } from '@/lib/supabase-admin'
import type { RawRow } from '@/lib/mappers/types'
import { parseAndValidateCogs, planCogsWrite } from '@/lib/mappers/cogs'
import { upsertCoverageForUpload } from '@/lib/coverage/maintain'

// INB-162 — dedicated COGS upload handler. COGS uses SCD-2 semantics (close-changed /
// no-op-unchanged / insert-new), fundamentally unlike the generic upsert path, so /api/ingest
// early-returns here for reportType==='cogs' rather than threading it through the shared
// resolve/dedup/write pipeline. The single effective date comes from the upload form
// (date_range_start → valid_from); the report_registry row is requires_period_dates=true.
export async function handleCogsUpload(opts: {
  brandId: string
  rows: RawRow[]
  rowsReceived: number
  effectiveDate: string
  parseErrors: string[]
}): Promise<Response> {
  const { brandId, rows, rowsReceived, effectiveDate, parseErrors } = opts
  const errors = [...parseErrors]

  try {
    const { valid, rejected } = parseAndValidateCogs(rows)
    for (const r of rejected.slice(0, 20)) errors.push(`Row rejected: ${r.reason}`)

    // Current OPEN general cost rows (msku='', valid_to NULL) for this brand.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('cogs')
      .select('id, internal_sku, unit_cost, valid_from')
      .eq('brand_id', brandId)
      .eq('msku', '')
      .is('valid_to', null)
    if (readErr) throw new Error(`cogs open-row read failed: ${readErr.message}`)

    const plan = planCogsWrite(brandId, existing ?? [], valid, effectiveDate)
    for (const sku of plan.dateConflicts) {
      errors.push(
        `Skipped ${sku}: effective date ${effectiveDate} is not after the current cost's valid_from — ` +
        `a cost change needs a forward-dated effective date.`,
      )
    }

    // Close changed rows first (set valid_to), then insert the new versions — the '[)'
    // exclusion constraint then sees adjacent, non-overlapping ranges.
    let rowsClosed = 0
    for (const c of plan.toClose) {
      const { error } = await supabaseAdmin.from('cogs').update({ valid_to: c.valid_to }).eq('id', c.id)
      if (error) errors.push(`Close failed for id ${c.id}: ${error.message}`)
      else rowsClosed++
    }
    let rowsStored = 0
    for (let i = 0; i < plan.toInsert.length; i += 500) {
      const batch = plan.toInsert.slice(i, i + 500)
      const { error } = await supabaseAdmin.from('cogs').insert(batch)
      if (error) errors.push(`Insert batch failed: ${error.message}`)
      else rowsStored += batch.length
    }

    const rowsRejected = rejected.length + plan.dateConflicts.length
    const status = rowsRejected === 0 ? 'success' : (rowsStored > 0 || rowsClosed > 0) ? 'partial' : 'failed'

    await supabaseAdmin.from('report_ingestion_log').insert({
      brand_id: brandId,
      report_type: 'cogs',
      report_key: 'cogs',
      source_platform: 'csv_upload',
      date_range_start: effectiveDate || null,
      date_range_end: effectiveDate || null,
      rows_received: rowsReceived,
      rows_mapped: valid.length,
      rows_deduplicated: 0,
      rows_stored: rowsStored,
      rows_rejected: rowsRejected,
      status,
      error_message: errors.length ? errors.join(' | ') : null,
      ingestion_method: 'csv_upload',
    })

    // Coverage best-effort (non-fatal): reflect the effective dates just written.
    try {
      await upsertCoverageForUpload({ reportKey: 'cogs', tableName: 'cogs', rows: plan.toInsert as unknown as Record<string, unknown>[] })
    } catch (e) {
      console.error(`[ingest] cogs coverage maintenance failed: ${(e as Error).message}`)
    }

    return Response.json({
      status: 'ok',
      report_type: 'cogs',
      table: 'cogs',
      rows_received: rowsReceived,
      rows_mapped: valid.length,
      rows_stored: rowsStored,
      rows_closed: rowsClosed,
      rows_unchanged: plan.unchanged,
      rows_rejected: rowsRejected,
      parse_errors: errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await supabaseAdmin.from('report_ingestion_log').insert({
        brand_id: brandId,
        report_type: 'cogs',
        report_key: 'cogs',
        source_platform: 'csv_upload',
        date_range_start: effectiveDate || null,
        date_range_end: effectiveDate || null,
        rows_received: rowsReceived,
        rows_stored: 0,
        rows_rejected: 0,
        status: 'failed',
        error_message: message,
        ingestion_method: 'csv_upload',
      })
    } catch { /* non-critical */ }
    return Response.json({ error: message }, { status: 500 })
  }
}
