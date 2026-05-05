import { parseCSV } from '@/lib/csv-parser'
import { detectReportType, REPORT_TYPE_TO_TABLE } from '@/lib/report-detector'
import { getMapper, getBatchMapper } from '@/lib/mappers'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BATCH_SIZE = 500

// Removes within-batch duplicates by conflict key before an upsert.
// PostgreSQL raises "ON CONFLICT DO UPDATE command cannot affect row a second time"
// when two rows in the same statement share the same conflict key values.
// Last occurrence wins — consistent with upsert semantics.
function deduplicateBatch(
  rows: Record<string, unknown>[],
  conflictKey: string
): Record<string, unknown>[] {
  const cols = conflictKey.split(',').map(c => c.trim())
  const seen = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = cols.map(c => String(row[c] ?? '')).join('::')
    seen.set(key, row)
  }
  return Array.from(seen.values())
}

// Tables that use upsert instead of insert, keyed by their natural-key columns.
// When a conflict occurs the incoming row overwrites the stored one so re-uploads
// and overlapping date ranges always reflect the most recently ingested values.
const UPSERT_CONFLICT_KEYS: Record<string, string> = {
  scale_insights_keyword_rank: 'brand_id,asin_id,keyword,report_date',
  scale_insights_bid_log:      'brand_id,campaign_id,target,change_timestamp,bid_before,bid_after',
  business_report:             'brand_id,asin_id,report_date',
  business_report_daily:       'brand_id,report_date',
  sp_campaign_performance:     'brand_id,campaign_id,report_date,ad_type',
  derived_metrics_daily:       'brand_id,metric_date',
  derived_metrics_weekly:      'brand_id,week_start',
  subscribe_and_save:              'brand_id,asin_id,sku,report_date',
  search_query_performance:        'brand_id,search_query,report_date',
  smartscout_subcategory_products: 'brand_id,parent_asin,subcategory,snapshot_date',
  smartscout_subcategory_brands:   'brand_id,brand_name,snapshot_date',
  virtual_bundle_sales:            'brand_id,bundle_asin,sale_date',
}

// ─── FK resolution helpers ────────────────────────────────────────────────────

// Resolves (or creates) a campaign row and returns its UUID.
// Results are cached in campaignCache to avoid redundant DB round-trips.
async function resolveCampaignId(
  brandId: string,
  amazonId: string,
  name: string,
  campaignCache: Map<string, string>
): Promise<string | null> {
  const cacheKey = `${brandId}::${amazonId}`
  if (campaignCache.has(cacheKey)) return campaignCache.get(cacheKey)!

  const { data: existing } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brandId)
    .eq('campaign_id', amazonId)
    .maybeSingle()

  if (existing) {
    campaignCache.set(cacheKey, existing.id)
    return existing.id
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('campaigns')
    .insert({ brand_id: brandId, campaign_id: amazonId, campaign_name: name })
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
        campaignCache
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
        campaignCache
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
  let tableName = ''
  let detectionHint: string | undefined
  let rowsReceived = 0
  let rowsStored = 0
  let rowsRejected = 0
  const ingestErrors: string[] = []

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    brandId = (formData.get('brand_id') as string) ?? ''
    const reportTypeOverride = (formData.get('report_type') as string) ?? ''
    const dateRangeStart = (formData.get('date_range_start') as string) ?? ''
    const dateRangeEnd = (formData.get('date_range_end') as string) ?? ''

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (!brandId) return Response.json({ error: 'brand_id is required' }, { status: 400 })

    // 1. Parse — full file, no truncation
    const content = await file.text()
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
      const detection = detectReportType(parseResult.headers)
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

    // 3. Map rows
    // Batch mappers receive all rows at once (e.g. for cross-row deduplication).
    // Row-by-row mappers are applied via flatMap (handles single or array returns).
    const batchMapper = getBatchMapper(reportType)
    const mapper = batchMapper ? null : getMapper(reportType)
    if (!batchMapper && !mapper) {
      return Response.json({ error: `No mapper for report type: ${reportType}` }, { status: 400 })
    }

    const mapperContext = { date_range_start: dateRangeStart, date_range_end: dateRangeEnd, hint: detectionHint }
    const mappedRows = batchMapper
      ? batchMapper(parseResult.rows, brandId, mapperContext)
      : parseResult.rows
          .flatMap(row => {
            const result = mapper!(row, brandId, mapperContext)
            return Array.isArray(result) ? result : [result]
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)

    // 4. Resolve FK references (campaigns, ad_groups, asins)
    const { resolved, rejected: fkRejected } = await resolveRows(mappedRows, reportType, brandId)
    rowsRejected += fkRejected

    // 5. Insert in batches of 500 — never truncates.
    // Tables in UPSERT_CONFLICT_KEYS use upsert so re-uploads overwrite stale rows.
    // Each batch is deduplicated first to prevent within-batch conflict errors.
    const conflictKey = UPSERT_CONFLICT_KEYS[tableName]
    for (let i = 0; i < resolved.length; i += BATCH_SIZE) {
      const raw = resolved.slice(i, i + BATCH_SIZE)
      const batch = conflictKey ? deduplicateBatch(raw, conflictKey) : raw
      const { error } = conflictKey
        ? await supabaseAdmin.from(tableName).upsert(batch, { onConflict: conflictKey })
        : await supabaseAdmin.from(tableName).insert(batch)
      if (error) {
        rowsRejected += batch.length
        ingestErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
      } else {
        rowsStored += batch.length
      }
    }

    // 6. Log ingestion
    await supabaseAdmin.from('report_ingestion_log').insert({
      brand_id: brandId,
      report_type: reportType,
      source_platform: 'csv_upload',
      date_range_start: dateRangeStart || null,
      date_range_end: dateRangeEnd || null,
      rows_received: rowsReceived,
      rows_stored: rowsStored,
      rows_rejected: rowsRejected,
      status: rowsRejected === 0 ? 'success' : rowsStored > 0 ? 'partial' : 'failed',
      error_message: ingestErrors.length ? ingestErrors.join(' | ') : null,
      ingestion_method: 'csv_upload',
    })

    return Response.json({
      status: 'ok',
      report_type: reportType,
      table: tableName,
      rows_received: rowsReceived,
      rows_stored: rowsStored,
      rows_rejected: rowsRejected,
      parse_errors: ingestErrors,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Best-effort ingestion log on unexpected error
    if (brandId) {
      try {
        await supabaseAdmin.from('report_ingestion_log').insert({
          brand_id: brandId,
          report_type: reportType,
          source_platform: 'csv_upload',
          rows_received: rowsReceived,
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
