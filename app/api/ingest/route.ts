import { parseCSV, decodeFileContent } from '@/lib/csv-parser'
import { partitionRequiredNotNull, periodDatesError, periodDateRangeError, dedupeByConflictKey } from '@/lib/ingest-validation'
import { detectReportType, REPORT_TYPE_TO_TABLE } from '@/lib/report-detector'
import { deriveReportKey } from '@/lib/report-registry'
import { getMapper, getBatchMapper } from '@/lib/mappers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REPORT_REGISTRY } from '@/lib/upload-tracker/registry'
import { periodStart } from '@/lib/upload-tracker/gaps'
import { UPSERT_CONFLICT_KEYS } from '@/lib/upsert-config'
import { calculateDerivedMetricsRange, recalcPlanForUpload } from '@/lib/derived-metrics'

const BATCH_SIZE = 500

// ─── FK resolution helpers ────────────────────────────────────────────────────

// Resolves (or creates) a campaign row and returns its UUID.
// When reportDate is provided (sp_campaign_performance ingests), maintains
// campaigns.launch_date as MIN(report_date) seen so far — "earlier date wins".
// When targetingType is provided (perf rows carry 'Automatic targeting' /
// 'Manual targeting'; SB/SBV rows carry null), maintains campaigns.targeting_type
// fill-if-null — a stored non-null value is never overwritten (INB-36).
// Results are cached in campaignCache to avoid redundant DB round-trips per file.
async function resolveCampaignId(
  brandId: string,
  amazonId: string,
  name: string,
  campaignCache: Map<string, string>,
  reportDate?: string,
  targetingType?: string,
): Promise<string | null> {
  const cacheKey = `${brandId}::${amazonId}`
  if (campaignCache.has(cacheKey)) return campaignCache.get(cacheKey)!

  const { data: existing } = await supabaseAdmin
    .from('campaigns')
    .select('id, launch_date, targeting_type')
    .eq('brand_id', brandId)
    .eq('campaign_id', amazonId)
    .maybeSingle()

  if (existing) {
    campaignCache.set(cacheKey, existing.id)
    const patch: Record<string, string> = {}
    // Update launch_date only when this file's date is strictly earlier than stored.
    if (reportDate) {
      const stored = existing.launch_date as string | null
      if (!stored || reportDate < stored) patch.launch_date = reportDate
    }
    if (targetingType && !existing.targeting_type) patch.targeting_type = targetingType
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin
        .from('campaigns')
        .update(patch)
        .eq('id', existing.id)
      // Non-throwing: a failure here only means launch_date/targeting_type lag; data is not lost.
    }
    return existing.id
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('campaigns')
    .insert({
      brand_id: brandId,
      campaign_id: amazonId,
      campaign_name: name,
      launch_date: reportDate ?? null,
      targeting_type: targetingType ?? null,
    })
    .select('id')
    .single()

  if (error || !inserted) return null
  campaignCache.set(cacheKey, inserted.id)
  return inserted.id
}

async function resolveAdGroupId(
  campaignUuid: string,
  amazonId: string,
  name: string,
  adGroupCache: Map<string, string>
): Promise<string | null> {
  const cacheKey = `${campaignUuid}::${amazonId}`
  if (adGroupCache.has(cacheKey)) return adGroupCache.get(cacheKey)!

  const { data: existing } = await supabaseAdmin
    .from('ad_groups')
    .select('id')
    .eq('campaign_id', campaignUuid)
    .eq('ad_group_id', amazonId)
    .maybeSingle()

  if (existing) {
    adGroupCache.set(cacheKey, existing.id)
    return existing.id
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('ad_groups')
    .insert({ campaign_id: campaignUuid, ad_group_id: amazonId, ad_group_name: name })
    .select('id')
    .single()

  if (error || !inserted) return null
  adGroupCache.set(cacheKey, inserted.id)
  return inserted.id
}

async function resolveAsinId(
  brandId: string,
  asin: string,
  title: string,
  asinCache: Map<string, string>
): Promise<string | null> {
  if (!asin) return null
  const cacheKey = `${brandId}::${asin}`
  if (asinCache.has(cacheKey)) return asinCache.get(cacheKey)!

  const { data: existing } = await supabaseAdmin
    .from('asins')
    .select('id')
    .eq('brand_id', brandId)
    .eq('asin', asin)
    .maybeSingle()

  if (existing) {
    asinCache.set(cacheKey, existing.id)
    return existing.id
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('asins')
    .insert({ brand_id: brandId, asin, title: title || null })
    .select('id')
    .single()

  if (error || !inserted) return null
  asinCache.set(cacheKey, inserted.id)
  return inserted.id
}

// ─── Row resolution: strip _ fields and inject UUID FKs ──────────────────────

const CAMPAIGN_AD_GROUP_TABLES = new Set([
  'sp_search_term_report',
  'sp_targeting_report',
  'scale_insights_bid_log',
])
const CAMPAIGN_ONLY_TABLES = new Set([
  'sp_campaign_performance',
  'purchased_product_report',
  'sb_attributed_purchases',
])
const ASIN_TABLES = new Set([
  'business_report',
  'subscribe_and_save',
  'scale_insights_keyword_rank',
])

async function resolveRows(
  mappedRows: Record<string, unknown>[],
  reportType: string,
  brandId: string
): Promise<{ resolved: Record<string, unknown>[]; rejected: number }> {
  const campaignCache = new Map<string, string>()
  const adGroupCache = new Map<string, string>()
  const asinCache = new Map<string, string>()
  const resolved: Record<string, unknown>[] = []
  let rejected = 0

  for (const row of mappedRows) {
    // Strip all _ metadata fields from the final row
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (!k.startsWith('_')) clean[k] = v
    }

    if (CAMPAIGN_AD_GROUP_TABLES.has(reportType)) {
      const campaignUuid = await resolveCampaignId(
        brandId,
        row._campaign_amazon_id as string,
        row._campaign_name as string,
        campaignCache,
        row.report_date as string | undefined,
        (row.targeting_type as string | undefined) ?? undefined,
      )
      if (!campaignUuid) { rejected++; continue }

      const adGroupUuid = await resolveAdGroupId(
        campaignUuid,
        row._ad_group_amazon_id as string,
        row._ad_group_name as string,
        adGroupCache
      )
      if (!adGroupUuid) { rejected++; continue }

      clean.campaign_id = campaignUuid
      clean.ad_group_id = adGroupUuid

    } else if (CAMPAIGN_ONLY_TABLES.has(reportType)) {
      const campaignUuid = await resolveCampaignId(
        brandId,
        row._campaign_amazon_id as string,
        row._campaign_name as string,
        campaignCache,
        row.report_date as string | undefined,
        (row.targeting_type as string | undefined) ?? undefined,
      )
      if (!campaignUuid) { rejected++; continue }
      clean.campaign_id = campaignUuid

    } else if (ASIN_TABLES.has(reportType)) {
      const asinUuid = await resolveAsinId(
        brandId,
        row._asin as string,
        row._title as string ?? '',
        asinCache
      )
      if (!asinUuid) { rejected++; continue }
      clean.asin_id = asinUuid
    }

    resolved.push(clean)
  }

  return { resolved, rejected }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let brandId = ''
  let reportType = 'unknown'
  let effectiveReportType = 'unknown'
  let tableName = ''
  let detectionHint: string | undefined
  let rowsReceived = 0
  let rowsStored = 0
  let rowsRejected = 0
  // Per-stage counters (INB-68): null until their stage runs, so an error-path
  // log entry records NULL ("not recorded") rather than a fabricated 0.
  let rowsMapped: number | null = null
  let rowsDeduplicated: number | null = null
  let dateRangeStart = ''
  let dateRangeEnd = ''
  let actualDateStart: string | null = null
  let actualDateEnd: string | null = null
  let reportKey: string | null = null
  const ingestErrors: string[] = []

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    brandId = (formData.get('brand_id') as string) ?? ''
    const reportTypeOverride = (formData.get('report_type') as string) ?? ''
    dateRangeStart = (formData.get('date_range_start') as string) ?? ''
    dateRangeEnd = (formData.get('date_range_end') as string) ?? ''
    const subcategoryField = (formData.get('subcategory') as string) || undefined

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (!brandId) return Response.json({ error: 'brand_id is required' }, { status: 400 })

    // 1. Parse — full file, no truncation.
    // decodeFileContent handles UTF-8 BOM (today's exports) and guards against a
    // future UTF-16 export; plain UTF-8 falls through to file.text().
    const content = await decodeFileContent(file)
    const parseResult = parseCSV(content)
    rowsReceived = parseResult.rowCount
    if (parseResult.errors.length) ingestErrors.push(...parseResult.errors.slice(0, 10))

    if (rowsReceived === 0) {
      return Response.json({ error: 'CSV is empty or could not be parsed' }, { status: 400 })
    }

    // 2. Detect report type
    if (reportTypeOverride && REPORT_TYPE_TO_TABLE[reportTypeOverride]) {
      reportType = reportTypeOverride
      tableName = REPORT_TYPE_TO_TABLE[reportTypeOverride]
    } else {
      // Pass the first data row so content-gated signatures (INB-148: the
      // ScaleInsights rule change logs, which share a header with the bidding-rule
      // log) can discriminate on a column value, not just the header shape.
      const detection = detectReportType(parseResult.headers, parseResult.rows[0])
      reportType = detection.reportType
      tableName = detection.tableName
      detectionHint = detection.hint
    }

    if (!tableName) {
      return Response.json(
        { error: `Could not detect report type. Headers: ${parseResult.headers.slice(0, 8).join(', ')}` },
        { status: 400 }
      )
    }

    if (reportType === 'smartscout_subcategory_brands' && !subcategoryField) {
      return Response.json(
        { error: 'Subcategory required for Subcategory Brands reports. Select one before uploading.' },
        { status: 400 }
      )
    }

    // INB-109: period-aggregate types stamp every row's date from the form's date
    // range. Without it, business_report maps report_date = null (the NOT NULL
    // constraint then rejects the entire upload) and the SmartScout snapshot types
    // silently stamp a wrong date — so reject up front, before any DB access.
    const periodError = periodDatesError(reportType, dateRangeStart, dateRangeEnd)
    if (periodError) {
      return Response.json({ error: periodError }, { status: 400 })
    }

    // Plausibility guard (INB-145 follow-up): a provided date must be a real
    // calendar date within [2020-01-01, 2035-12-31] and start ≤ end — for ALL
    // report types. Stops a typed garbage year (275760) before it stamps rows.
    const dateRangeError = periodDateRangeError(dateRangeStart, dateRangeEnd)
    if (dateRangeError) {
      return Response.json({ error: dateRangeError }, { status: 400 })
    }

    // 3. Map rows
    // Batch mappers receive all rows at once (e.g. for cross-row deduplication).
    // Row-by-row mappers are applied via flatMap (handles single or array returns).
    const batchMapper = getBatchMapper(reportType)
    const mapper = batchMapper ? null : getMapper(reportType)
    if (!batchMapper && !mapper) {
      return Response.json({ error: `No mapper for report type: ${reportType}` }, { status: 400 })
    }

    const mapperContext = { date_range_start: dateRangeStart, date_range_end: dateRangeEnd, hint: detectionHint, subcategory: subcategoryField, filename: file.name }
    const mappedRows = batchMapper
      ? batchMapper(parseResult.rows, brandId, mapperContext)
      : parseResult.rows
          .flatMap(row => {
            const result = mapper!(row, brandId, mapperContext)
            return Array.isArray(result) ? result : [result]
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)

    // INB-68: post-mapper count. Differs from rowsReceived when the mapper
    // reshapes rows — collapse (SmartScout variation rollup) or expansion
    // (keyword-rank date-column unpivot). The three outcomes (deduplicated,
    // rejected, stored) partition THIS number, not rowsReceived.
    rowsMapped = mappedRows.length

    // Derive effective report type for sp_campaign_performance.
    // SP uploads include "Program Type" = "Sponsored Products"; SB uploads omit the column (null).
    // The mapper stores it as program_type. First row wins.
    effectiveReportType = reportType;
    if (tableName === 'sp_campaign_performance' && mappedRows.length > 0) {
      const programType = (mappedRows[0] as Record<string, unknown>).program_type as string | null | undefined;
      effectiveReportType = (programType != null && programType !== '')
        ? 'sp_campaign_performance__sp'
        : 'sp_campaign_performance__sb';
    }

    // Tag this upload at the true-report level (INB-145). Ambiguous files
    // (mixed ad_type, multiple subcategories/ASINs, non-weekly loyalty, unmapped
    // type) derive null + a warning — logged NULL, never guessed.
    const derivedKey = deriveReportKey(effectiveReportType, parseResult.headers, mappedRows as Record<string, unknown>[]);
    reportKey = derivedKey.reportKey;
    if (derivedKey.warning) {
      console.warn(`[ingest] report_key not derived for ${effectiveReportType}: ${derivedKey.warning}`);
    }

    // 4. Resolve FK references (campaigns, ad_groups, asins)
    const { resolved, rejected: fkRejected } = await resolveRows(mappedRows, reportType, brandId)
    rowsRejected += fkRejected

    // 4b. Drop rows whose required NOT NULL columns are empty BEFORE they reach the
    // database, counting each as exactly one reject (INB-117). Without this, a single
    // SQP row with an empty Search Query maps to null, violates the NOT NULL constraint,
    // and fails its whole ~500-row upsert batch — losing every good row alongside it.
    const { kept, rejected: requiredRejects } = partitionRequiredNotNull(resolved, tableName)
    rowsRejected += requiredRejects.length
    for (const rej of requiredRejects.slice(0, 10)) ingestErrors.push(rej.reason)

    // 4c. Upload-wide dedup (INB-68): collapse duplicate natural keys across the
    // WHOLE upload, last occurrence wins — the same final rows the DB's upsert
    // overwrite produced before, but counted honestly (the per-batch dedup this
    // replaces missed duplicates straddling batch boundaries and double-counted
    // them as stored). Runs after FK/validation because conflict keys reference
    // resolved columns (asin_id, campaign_id). No conflict key → passthrough.
    const conflictKey = UPSERT_CONFLICT_KEYS[tableName]
    const { rows: uniqueRows, collapsed } = dedupeByConflictKey(kept, conflictKey)
    rowsDeduplicated = collapsed

    // Derive actual date coverage from stored rows so the log entry is accurate
    // even when the operator leaves the date range form fields blank.
    //
    // date_range_end  = max of the primary date column(s) — always the latest period-end.
    // date_range_start = cadence-aware: weekly reports store period-end anchors, so the
    //   start is anchor - 6 days; monthly reports store any day in the month, so the start
    //   is the first of that month. Delegates to periodStart() from gaps.ts so the same
    //   period-bounds primitive is used here and in gap detection.
    const DATE_COL_OVERRIDES: Record<string, string[]> = {
      brand_analytics_customer_loyalty: ['period_end_date'],
      smartscout_subcategory_brands:    ['snapshot_date'],
      smartscout_subcategory_products:  ['snapshot_date'],
      virtual_bundle_sales_snapshots:   ['snapshot_date'],
      virtual_bundle_sales_daily:       ['sale_date'],
      subscribe_and_save:               ['report_date', 'date_range_end'],
      scale_insights_rule_change_log:   ['created_date'],
      scale_insights_rule_assignments:  ['snapshot_date'],
    }
    const dateCols = DATE_COL_OVERRIDES[tableName] ?? ['report_date']
    const allDates = uniqueRows
      .flatMap(r => dateCols.map(col => r[col]))
      .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
    if (allDates.length > 0) {
      const registryEntry = REPORT_REGISTRY.find(e => e.internal_id === effectiveReportType)
      const granularity = registryEntry?.granularity ?? 'daily'
      actualDateStart = periodStart(allDates[0], granularity)
      actualDateEnd   = allDates[allDates.length - 1]
    }

    // 5. Insert in batches of 500 — never truncates.
    // Tables in UPSERT_CONFLICT_KEYS use upsert so re-uploads overwrite stale rows.
    // Rows are already unique per natural key (step 4c), so no within-batch
    // conflict errors are possible. If a batch statement fails (e.g. one
    // unexpected constraint violation), we fall back to inserting that batch
    // row-by-row so a single bad row can never discard the rest of the batch
    // (INB-117). Defence-in-depth alongside the step-4b filter: that catches the
    // known empty-required-field case up front; this catches anything else the
    // database rejects.
    const writeRows = (rows: Record<string, unknown>[]) =>
      conflictKey
        ? supabaseAdmin.from(tableName).upsert(rows, { onConflict: conflictKey })
        : supabaseAdmin.from(tableName).insert(rows)

    for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + BATCH_SIZE)
      const { error } = await writeRows(batch)
      if (!error) {
        rowsStored += batch.length
        continue
      }

      // Batch failed — retry each row individually so good rows still land.
      ingestErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed, retrying row-by-row: ${error.message}`)
      for (const row of batch) {
        const { error: rowError } = await writeRows([row])
        if (rowError) {
          rowsRejected++
          if (ingestErrors.length < 20) ingestErrors.push(`Row rejected: ${rowError.message}`)
        } else {
          rowsStored++
        }
      }
    }

    // 6. Log ingestion
    await supabaseAdmin.from('report_ingestion_log').insert({
      brand_id: brandId,
      report_type: effectiveReportType,
      report_key: reportKey,
      source_platform: 'csv_upload',
      date_range_start: dateRangeStart || actualDateStart || null,
      date_range_end:   dateRangeEnd   || actualDateEnd   || null,
      rows_received: rowsReceived,
      rows_mapped: rowsMapped,
      rows_deduplicated: rowsDeduplicated,
      rows_stored: rowsStored,
      rows_rejected: rowsRejected,
      status: rowsRejected === 0 ? 'success' : rowsStored > 0 ? 'partial' : 'failed',
      error_message: ingestErrors.length ? ingestErrors.join(' | ') : null,
      ingestion_method: 'csv_upload',
    })

    // 7. Auto-recalc derived metrics for the covered window (INB-86). Feeder
    // tables only; fully-rejected uploads changed nothing, so skip those too.
    // Awaited but NON-FATAL: the upload has already succeeded and been logged —
    // a recalc failure is surfaced via recalc_status, never a failed upload.
    let recalcStatus: 'ok' | 'failed' | 'skipped' = 'skipped'
    const recalcPlan = rowsStored > 0
      ? recalcPlanForUpload(tableName, dateRangeStart || actualDateStart, dateRangeEnd || actualDateEnd)
      : null
    if (recalcPlan) {
      try {
        await calculateDerivedMetricsRange(brandId, recalcPlan.start, recalcPlan.end)
        recalcStatus = 'ok'
      } catch (err) {
        recalcStatus = 'failed'
        console.error(`[ingest] derived-metrics recalc failed after ${tableName} upload (${recalcPlan.start}..${recalcPlan.end}):`, err)
      }
    }

    // Surface detected granularity for BA Customer Loyalty uploads so operator can verify.
    const granularityDetected = (reportType === 'brand_analytics_customer_loyalty' && mappedRows.length > 0)
      ? (mappedRows[0] as Record<string, unknown>).granularity as string
      : undefined

    return Response.json({
      status: 'ok',
      report_type: reportType,
      table: tableName,
      rows_received: rowsReceived,
      rows_mapped: rowsMapped,
      rows_stored: rowsStored,
      rows_rejected: rowsRejected,
      rows_deduplicated: rowsDeduplicated,
      recalc_status: recalcStatus,
      ...(recalcPlan ? { recalc_window: recalcPlan } : {}),
      parse_errors: ingestErrors,
      ...(granularityDetected ? { granularity_detected: granularityDetected } : {}),
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Best-effort ingestion log on unexpected error
    if (brandId) {
      try {
        await supabaseAdmin.from('report_ingestion_log').insert({
          brand_id: brandId,
          report_type: effectiveReportType,
          report_key: reportKey,
          source_platform: 'csv_upload',
          date_range_start: dateRangeStart || actualDateStart || null,
          date_range_end:   dateRangeEnd   || actualDateEnd   || null,
          rows_received: rowsReceived,
          rows_mapped: rowsMapped,
          rows_deduplicated: rowsDeduplicated,
          rows_stored: rowsStored,
          rows_rejected: rowsRejected,
          status: 'failed',
          error_message: message,
          ingestion_method: 'csv_upload',
        })
      } catch { /* non-critical */ }
    }

    return Response.json({ error: message }, { status: 500 })
  }
}
