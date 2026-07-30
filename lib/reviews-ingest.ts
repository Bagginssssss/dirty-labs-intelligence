import { supabaseAdmin } from '@/lib/supabase-admin'
import { partitionRequiredNotNull, dedupeByConflictKey } from '@/lib/ingest-validation'
import { UPSERT_CONFLICT_KEYS } from '@/lib/upsert-config'
import { upsertCoverageForUpload } from '@/lib/coverage/maintain'
import {
  mapAmazonReviews,
  buildRatingSnapshots,
  amazonReviewsWarnings,
  isUnfilteredRun,
  type ReviewItem,
} from '@/lib/mappers/amazon-reviews'

// INB-160 — dedicated Amazon-reviews upload handler. The Axesso export is JSON (a flat array),
// which the CSV pipeline (header detector + RawRow=Record<string,string> mappers) cannot ingest, so
// /api/ingest sniffs a leading '['/'{' and early-returns here — mirroring the COGS handler. One
// upload feeds TWO tables (reviews + rating snapshots), like SKU Economics. Reviews upsert on
// (brand_id, review_id) (shared across a parent's child ASINs); rating snapshots are written ONLY
// from unfiltered items and upsert on (brand_id, asin, snapshot_date).

const BATCH_SIZE = 500

export interface ReviewsPayloadCheck { items?: ReviewItem[]; error?: string }

// Pure — decides whether a parsed JSON body is an Axesso reviews export (array whose items carry a
// reviewId). Called by the route before handing off; unit-testable without a DB.
export function validateReviewsPayload(parsed: unknown): ReviewsPayloadCheck {
  if (!Array.isArray(parsed)) return { error: 'Expected a JSON array of Axesso review items.' }
  if (parsed.length === 0) return { error: 'Reviews JSON array is empty.' }
  const first = parsed[0]
  if (first === null || typeof first !== 'object' || Array.isArray(first) || !('reviewId' in first)) {
    return { error: 'JSON does not look like an Axesso reviews export (items have no reviewId).' }
  }
  return { items: parsed as ReviewItem[] }
}

export async function handleReviewsUpload(opts: {
  brandId: string
  items: ReviewItem[]
  rowsReceived: number
  runDate: string       // rating-snapshot snapshot_date (form date_range_start, else the ingest date)
  filename: string
  parseErrors: string[]
}): Promise<Response> {
  const { brandId, items, rowsReceived, runDate, filename, parseErrors } = opts
  const errors = [...parseErrors]

  try {
    const scrapedAt = new Date().toISOString()
    const reviewKey = UPSERT_CONFLICT_KEYS['amazon_reviews']
    const snapshotKey = UPSERT_CONFLICT_KEYS['amazon_rating_snapshots']

    // 1. Reviews → drop empty review_id (partition) → upload-wide dedupe on (brand_id, review_id).
    const mapped = mapAmazonReviews(items, brandId, { sourceRun: filename, scrapedAt })
    const { kept, rejected } = partitionRequiredNotNull(mapped as unknown as Record<string, unknown>[], 'amazon_reviews')
    for (const r of rejected.slice(0, 20)) errors.push(`Row rejected: ${r.reason}`)
    const { rows: uniqueReviews, collapsed } = dedupeByConflictKey(kept, reviewKey)

    let reviewsStored = 0
    let rowsRejected = rejected.length
    for (let i = 0; i < uniqueReviews.length; i += BATCH_SIZE) {
      const batch = uniqueReviews.slice(i, i + BATCH_SIZE)
      const { error } = await supabaseAdmin.from('amazon_reviews').upsert(batch, { onConflict: reviewKey })
      if (!error) { reviewsStored += batch.length; continue }
      // Batch failed — retry row-by-row so one bad row can't discard the rest.
      errors.push(`Reviews batch ${Math.floor(i / BATCH_SIZE) + 1} failed, retrying row-by-row: ${error.message}`)
      for (const row of batch) {
        const { error: rowErr } = await supabaseAdmin.from('amazon_reviews').upsert([row], { onConflict: reviewKey })
        if (rowErr) { rowsRejected++; if (errors.length < 25) errors.push(`Review rejected: ${rowErr.message}`) }
        else reviewsStored++
      }
    }

    // 2. Rating snapshots — ONLY from unfiltered items (per-item filterByStar absent).
    const snapshots = buildRatingSnapshots(items, brandId, runDate)
    const runFiltered = !items.some(isUnfilteredRun)
    let snapshotsStored = 0
    if (snapshots.length > 0) {
      const { error } = await supabaseAdmin.from('amazon_rating_snapshots').upsert(snapshots, { onConflict: snapshotKey })
      if (error) errors.push(`Rating-snapshot upsert failed: ${error.message}`)
      else snapshotsStored = snapshots.length
    }

    for (const w of amazonReviewsWarnings(items)) errors.push(w)

    const status = rowsRejected === 0 ? 'success' : reviewsStored > 0 ? 'partial' : 'failed'

    // 3. Ingestion log — one row per upload (SKU-Economics precedent: two tables, one log row).
    await supabaseAdmin.from('report_ingestion_log').insert({
      brand_id: brandId,
      report_type: 'amazon_reviews',
      report_key: 'amazon_reviews',
      source_platform: 'apify_json',
      date_range_start: runDate || null,
      date_range_end: runDate || null,
      rows_received: rowsReceived,
      rows_mapped: mapped.length,
      rows_deduplicated: collapsed,
      rows_stored: reviewsStored,
      rows_rejected: rowsRejected,
      status,
      error_message: errors.length ? errors.join(' | ') : null,
      ingestion_method: 'json_upload',
    })

    // 4. Coverage (non-fatal) for BOTH tables/report_keys this upload touched.
    try {
      await upsertCoverageForUpload({ reportKey: 'amazon_reviews', tableName: 'amazon_reviews', rows: uniqueReviews })
    } catch (e) {
      console.error(`[ingest] amazon_reviews coverage maintenance failed: ${(e as Error).message}`)
    }
    if (snapshotsStored > 0) {
      try {
        await upsertCoverageForUpload({
          reportKey: 'amazon_rating_snapshots',
          tableName: 'amazon_rating_snapshots',
          rows: snapshots as unknown as Record<string, unknown>[],
        })
      } catch (e) {
        console.error(`[ingest] amazon_rating_snapshots coverage maintenance failed: ${(e as Error).message}`)
      }
    }

    return Response.json({
      status: 'ok',
      report_type: 'amazon_reviews',
      table: 'amazon_reviews',
      rows_received: rowsReceived,
      rows_mapped: mapped.length,
      rows_deduplicated: collapsed,
      rows_stored: reviewsStored,
      rows_rejected: rowsRejected,
      snapshots_written: snapshotsStored,
      run_filtered: runFiltered,
      secondary_table: 'amazon_rating_snapshots',
      parse_errors: errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await supabaseAdmin.from('report_ingestion_log').insert({
        brand_id: brandId,
        report_type: 'amazon_reviews',
        report_key: 'amazon_reviews',
        source_platform: 'apify_json',
        date_range_start: runDate || null,
        date_range_end: runDate || null,
        rows_received: rowsReceived,
        rows_stored: 0,
        rows_rejected: 0,
        status: 'failed',
        error_message: message,
        ingestion_method: 'json_upload',
      })
    } catch { /* non-critical */ }
    return Response.json({ error: message }, { status: 500 })
  }
}
