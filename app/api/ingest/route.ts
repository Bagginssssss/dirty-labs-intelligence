import { parseCSV, decodeFileContent } from '@/lib/csv-parser'
import { partitionRequiredNotNull, periodDatesError, periodDateRangeError, dedupeByConflictKey } from '@/lib/ingest-validation'
import { detectReportType, REPORT_TYPE_TO_TABLE } from '@/lib/report-detector'
import { deriveReportKey } from '@/lib/report-registry'
import { getMapper, getBatchMapper } from '@/lib/mappers'
import { unmappedSnsDailyColumns, snsDailyRangeViolations } from '@/lib/mappers/sns-dashboard-daily'
import { subscribeAndSaveMixedWindowViolation, subscribeAndSaveNullRevenueViolation, subscribeAndSaveZeroBalanceWarning } from '@/lib/mappers/subscribe-and-save'
import { backdatedSnapshotViolation } from '@/lib/mappers/sns-dashboard-snapshots'
import type { MappedRow } from '@/lib/mappers/types'
import { buildSkuEconomicsFees, skuEconomicsWarnings } from '@/lib/mappers/sku-economics'
import { fbaReturnsWarnings } from '@/lib/mappers/fba-customer-returns'
import { handleCogsUpload } from '@/lib/cogs-ingest'
import { handleReviewsUpload, validateReviewsPayload } from '@/lib/reviews-ingest'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REPORT_REGISTRY } from '@/lib/upload-tracker/registry'
import { periodStart } from '@/lib/upload-tracker/gaps'
import { UPSERT_CONFLICT_KEYS } from '@/lib/upsert-config'
import { calculateDerivedMetricsRange, recalcPlanForUpload } from '@/lib/derived-metrics'
import { upsertCoverageForUpload } from '@/lib/coverage/maintain'
import { snapshotNameOverlap, SMARTSCOUT_SNAPSHOT_OVERLAP_MIN } from '@/lib/smartscout/snapshot-overlap'

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
  let zeroBalanceNulled = false // INB-174 item 3: a broken-balance S&S upload → store, NULL the column, log partial

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

    // INB-160 — the Axesso reviews export is JSON (a flat array), not CSV: the header detector +
    // RawRow=Record<string,string> mapper contract can't ingest it. Sniff a leading '['/'{' and
    // hand off to the bespoke JSON handler (two tables from one file), mirroring the COGS
    // early-return. The CSV path below is untouched for every other report type.
    if (content.trimStart().startsWith('[') || content.trimStart().startsWith('{')) {
      // Reuse the plausibility guard so a garbage run date can't stamp snapshot_date.
      const jsonDateError = periodDateRangeError(dateRangeStart, dateRangeEnd)
      if (jsonDateError) return Response.json({ error: jsonDateError }, { status: 400 })

      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (e) {
        return Response.json({ error: `File looks like JSON but failed to parse: ${(e as Error).message}` }, { status: 400 })
      }
      const check = validateReviewsPayload(parsed)
      if (check.error || !check.items) {
        return Response.json({ error: check.error ?? 'Unrecognized JSON payload.' }, { status: 400 })
      }
      const todayIso = new Date().toISOString().slice(0, 10)
      return await handleReviewsUpload({
        brandId,
        items: check.items,
        rowsReceived: check.items.length,
        runDate: dateRangeStart || todayIso,   // rating-snapshot snapshot_date (form date, else today)
        filename: file.name,
        parseErrors: ingestErrors,
      })
    }

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

    // COGS (INB-162): SCD-2 write (close-changed / no-op-unchanged / insert-new) — unlike the
    // generic upsert path — handled by a dedicated early-return handler. The effective date
    // (valid_from) is the form's date_range_start; the period-date gate above already required it.
    if (reportType === 'cogs') {
      return await handleCogsUpload({
        brandId,
        rows: parseResult.rows,
        rowsReceived,
        effectiveDate: dateRangeStart,
        parseErrors: ingestErrors,
      })
    }

    // INB-144: S&S Dashboard daily detection is greedy (any file with calc_date_granularity),
    // so a metric column absent from the header->slug map must be REJECTED — never silently
    // dropped (guards against Amazon renaming/adding a column). Runs before any mapping/write.
    if (reportType === 'sns_dashboard_daily') {
      const unmapped = unmappedSnsDailyColumns(parseResult.headers)
      if (unmapped.length > 0) {
        return Response.json(
          { error: `S&S Daily file has unmapped metric column(s): ${unmapped.join(', ')} — update the header→slug map.` },
          { status: 400 },
        )
      }
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

    // INB-160 — FBA Customer Returns: surface any reason code not in return_reason_map (stored as
    // fault_class='unmapped'). Non-fatal — a new Amazon code is flagged at QC, never dropped.
    if (reportType === 'fba_customer_returns') {
      for (const w of fbaReturnsWarnings(parseResult.rows)) ingestErrors.push(w)
    }

    // INB-167 — S&S Dashboard daily value-range guard: sns_sales is dollars (≥1), sns_sales_share is
    // a fraction (≤1). A violation means a column was mis-routed (the doubled-space collapse class) —
    // FAIL LOUDLY before any write, so a mis-mapped file can never corrupt the metric (the guard
    // that would have caught the original 2026-07-27 break). Same posture as the item-4 null-key guard.
    if (reportType === 'sns_dashboard_daily') {
      const violations = snsDailyRangeViolations(mappedRows as MappedRow[])
      if (violations.length > 0) {
        return Response.json(
          { error: `Upload blocked: S&S Dashboard daily value out of range — a column is mis-routed. No rows stored. ${violations.slice(0, 5).join(' | ')}` },
          { status: 400 },
        )
      }
    }

    // INB-174 (item 2) — backdated-snapshot guard. Snapshot exports carry no date column, so a
    // populated upload date-range stamps today's values onto an old snapshot_date (the 2026-07-01
    // 54-day + 2026-07-30 32-day phantoms). Reject when date_range_start is >14 days back or in the
    // future. 400 naming the report + both dates; snapshot_date is NOT forced to today (1-day is legit).
    if (reportType === 'sns_dashboard_snapshots') {
      const violation = backdatedSnapshotViolation(dateRangeStart, new Date().toISOString().slice(0, 10))
      if (violation) {
        return Response.json({ error: `Upload blocked: S&S Dashboard snapshot — ${violation} No rows were stored.` }, { status: 400 })
      }
    }

    // INB-170 + INB-174 — S&S Performance upload guards. Two REJECT modes (nothing worth keeping) and
    // one REPAIR mode (mostly-good file). (A) MIXED WINDOW — a file spanning >1 reporting window for one
    // report_date (the 2026-06-22 bundled fragment: 20 rows at 06-19 + a 3-row tail at 06-20) → 400.
    // (B) NULL-REVENUE — an all-null / >50%-null file (a standalone malformed/partial export) → 400.
    // (C) ZEROED BALANCE (INB-174 item 3) — >50% of rows at active_subscriptions 0/null (Period End
    // Subscription Balance broken). The rest of the file is good (revenue/units/penetration intact) and
    // it has broken two weeks running, so this is NOT a 400: STORE the file, NULL active_subscriptions on
    // every row (NULL = an honest gap; 0 = a false cliff), warn, and log partial. A/B block the whole
    // upload; C keeps the good columns.
    if (reportType === 'subscribe_and_save') {
      const rows = mappedRows as MappedRow[]
      const mixed = subscribeAndSaveMixedWindowViolation(rows)
      if (mixed) {
        return Response.json({ error: `Upload blocked: S&S Performance — ${mixed} No rows were stored.` }, { status: 400 })
      }
      const nullRev = subscribeAndSaveNullRevenueViolation(rows)
      if (nullRev) {
        return Response.json({ error: `Upload blocked: S&S Performance — ${nullRev} No rows were stored.` }, { status: 400 })
      }
      const zeroBal = subscribeAndSaveZeroBalanceWarning(rows)
      if (zeroBal) {
        for (const r of rows) (r as Record<string, unknown>).active_subscriptions = null
        zeroBalanceNulled = true
        ingestErrors.push(`[warning] S&S Performance zeroed-balance repair: ${zeroBal} active_subscriptions was NULLED on all ${rows.length} rows (revenue/units/penetration kept) — Period End Subscription Balance was not stored.`)
      }
    }

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

    // INB-166 (item 4) — a KNOWN report_type (we already resolved tableName) that yields NO report_key
    // must FAIL LOUDLY here, before any rows are stored. Otherwise rows land but report_coverage is
    // silently skipped — the frozen-tile class (e.g. the sns Share export writing into sns_sales while
    // its tile quietly stops advancing). The 400 names the report_type + the header signature so an
    // unregistered-but-valid report can be registered rather than just failing. This also (by design)
    // rejects genuinely ambiguous files (mixed ad_type in one CSV) that previously stored with a NULL
    // key, and blocks the INB-167 Share export until that ticket ships.
    if (reportKey === null) {
      const headerSig = parseResult.headers.map(h => h.replace(/^﻿/, '').trim()).filter(Boolean).join(' | ');
      return Response.json(
        {
          error:
            `Upload blocked: report_type '${effectiveReportType}' resolved to NO report_key ` +
            `(${derivedKey.warning ?? 'ambiguous or unregistered'}). No rows were stored. ` +
            `Header signature: ${headerSig}. Register this report or upload a single-report file.`,
        },
        { status: 400 },
      );
    }

    // 3b. Cross-snapshot sanity check (INB-152). A sticky subcategory dropdown ingested a
    // Toilet Cleaners brands file under Stain Removers (~10% brand overlap). Before storing,
    // compare this file's brand set to the SELECTED subcategory's most recent prior snapshot;
    // reject a near-disjoint file. Brands-only: the products report derives its subcategory from
    // file content (self-labeling), so it has no dropdown to mismatch. Skips cleanly when there
    // is no prior snapshot (first-ever upload) or the file has no readable brand names.
    if (reportType === 'smartscout_subcategory_brands' && mappedRows.length > 0) {
      const first = mappedRows[0] as Record<string, unknown>
      const subcat = first.subcategory as string | null | undefined
      const incomingDate = first.snapshot_date as string | null | undefined
      const fileNames = (mappedRows as Record<string, unknown>[])
        .map(r => r.brand_name)
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')

      if (subcat && incomingDate && fileNames.length > 0) {
        // Most recent prior snapshot date for this subcategory (bounded: one row).
        const { data: priorDateRows, error: priorDateErr } = await supabaseAdmin
          .from('smartscout_subcategory_brands')
          .select('snapshot_date')
          .eq('brand_id', brandId)
          .eq('subcategory', subcat)
          .lt('snapshot_date', incomingDate)
          .order('snapshot_date', { ascending: false })
          .limit(1)
        if (priorDateErr) throw new Error(`prior-snapshot lookup failed: ${priorDateErr.message}`)

        const priorDate = priorDateRows?.[0]?.snapshot_date as string | undefined
        if (priorDate) {
          // That snapshot's brand names (bounded: one snapshot ≈ 100–200 rows).
          const { data: priorNameRows, error: priorNameErr } = await supabaseAdmin
            .from('smartscout_subcategory_brands')
            .select('brand_name')
            .eq('brand_id', brandId)
            .eq('subcategory', subcat)
            .eq('snapshot_date', priorDate)
          if (priorNameErr) throw new Error(`prior-snapshot names read failed: ${priorNameErr.message}`)

          const priorNames = (priorNameRows ?? [])
            .map(r => r.brand_name)
            .filter((n): n is string => typeof n === 'string')

          if (priorNames.length > 0) {
            const overlap = snapshotNameOverlap(fileNames, priorNames)
            if (overlap < SMARTSCOUT_SNAPSHOT_OVERLAP_MIN) {
              return Response.json(
                { error: `This file's brands don't match previous ${subcat} snapshots — check the dropdown.` },
                { status: 400 },
              )
            }
          }
        }
      }
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
      sns_dashboard_daily:              ['metric_date'],
      sns_dashboard_snapshots:          ['snapshot_date'],
      brand_analytics_repeat_purchase:  ['reporting_date'],
      sku_economics_weekly:             ['week_start'],
      fba_customer_returns:             ['return_date'],
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

    // 5b. SKU Economics (INB-162): one file → two tables. The weekly parent rode the
    // generic upsert above; write the long fee child (sku_economics_fees) by
    // delete-and-reinsert per (week_start, marketplace) so a corrected file that drops a
    // fee type never leaves orphans. Also surface the non-fatal net-proceeds / COGS-
    // populated warnings. A fee-write failure downgrades status but never throws.
    let feeRowsStored = 0
    let feeWriteFailed = false
    if (reportType === 'sku_economics_weekly') {
      for (const w of skuEconomicsWarnings(parseResult.rows)) ingestErrors.push(w)

      if (rowsStored > 0) {
        const feeRows = buildSkuEconomicsFees(parseResult.rows, brandId)
        // Distinct (week_start, marketplace) pairs to clear — normally one per file.
        const pairs = new Map<string, { week_start: string; marketplace: string }>()
        for (const r of feeRows) {
          if (r.week_start) pairs.set(`${r.week_start}::${r.marketplace}`, { week_start: r.week_start, marketplace: r.marketplace })
        }
        for (const p of pairs.values()) {
          const { error } = await supabaseAdmin
            .from('sku_economics_fees')
            .delete()
            .eq('brand_id', brandId)
            .eq('week_start', p.week_start)
            .eq('marketplace', p.marketplace)
          if (error) {
            feeWriteFailed = true
            ingestErrors.push(`Fee delete failed for ${p.week_start}/${p.marketplace}: ${error.message}`)
          }
        }
        for (let i = 0; i < feeRows.length; i += BATCH_SIZE) {
          const batch = feeRows.slice(i, i + BATCH_SIZE)
          const { error } = await supabaseAdmin.from('sku_economics_fees').insert(batch)
          if (error) {
            feeWriteFailed = true
            ingestErrors.push(`Fee insert batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`)
          } else {
            feeRowsStored += batch.length
          }
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
      status: (rowsRejected === 0 && !feeWriteFailed && !zeroBalanceNulled) ? 'success' : rowsStored > 0 ? 'partial' : 'failed',
      error_message: ingestErrors.length ? ingestErrors.join(' | ') : null,
      ingestion_method: 'csv_upload',
    })

    // 6b. Maintain report_coverage for the periods this upload touched (INB-146).
    // Derived metadata — a coverage failure must NEVER fail an ingest that already
    // stored + logged. Awaited but non-fatal: log loudly and move on.
    try {
      // INB-166: pass the ingest's date range so window-per-pull reports whose fact table has no end
      // column (business_report) can set data_through = the window END (date_range_end), not the start.
      await upsertCoverageForUpload({ reportKey, tableName, rows: uniqueRows, dateRangeStart, dateRangeEnd })
    } catch (e) {
      console.error(`[ingest] report_coverage maintenance failed for ${reportKey ?? '(null key)'}: ${(e as Error).message}`)
    }

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
      ...(reportType === 'sku_economics_weekly' ? { fee_rows_stored: feeRowsStored, fee_write_status: feeWriteFailed ? 'failed' : 'ok' } : {}),
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
