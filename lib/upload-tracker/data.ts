import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { REPORT_REGISTRY, ReportRegistryEntry } from './registry';
import { fetchDistinctDates } from './coverage';
import { ReportStatus, calculateStatus } from './status';
import { GapAnalysis, detectGaps } from './gaps';

export type UploadEvent = {
  ingested_at: string;
  date_range_start: string | null;
  date_range_end: string | null;
  rows_received: number | null;
  rows_stored: number | null;
  rows_rejected: number | null;
  status: string;
  error_message: string | null;
  ingestion_method: string | null;
};

export type EffectiveFreshness = {
  dataMaxDate: string | null;
  attributionWindowDays: number;
  effectiveDate: string | null;
};

export type TrackerRow = {
  entry: ReportRegistryEntry;
  lastUpload: string | null;
  lastUploadEvent: UploadEvent | null;
  daysSinceLastUpload: number | null;
  reportStatus: ReportStatus;
  coverageStart: string | null;
  coverageEnd: string | null;
  gapAnalysis: GapAnalysis;
  effectiveFreshness: EffectiveFreshness;
  uploadHistory: UploadEvent[];
};

// Phase 1: hardcoded; Phase 2 may move into registry
const ATTRIBUTION_WINDOW_DAYS: Record<string, number> = {
  'Amazon Ads': 14,      // conservative; covers SB/SBV (14d); SP is 7d but combining is acceptable for Phase 1
  'Seller Central': 0,   // reconciliation captured via pull_window_days, not attribution
  'Brand Analytics': 0,
  'SmartScout': 0,
  'Scale Insights': 0,
};

async function _loadTrackerData(brandId: string): Promise<TrackerRow[]> {
  const today = new Date();

  // Fetch all log events for this brand, newest first per report_type.
  // Total row count is <200; default 1000-row limit is sufficient.
  type LogRow = UploadEvent & { report_type: string };
  const { data: logData, error: logError } = await supabaseAdmin
    .from('report_ingestion_log')
    .select('report_type, ingested_at, date_range_start, date_range_end, rows_received, rows_stored, rows_rejected, status, error_message, ingestion_method')
    .eq('brand_id', brandId)
    .order('report_type', { ascending: true })
    .order('ingested_at', { ascending: false });

  if (logError) {
    console.warn('[loadTrackerData] report_ingestion_log query failed:', logError.message);
  }

  // Partition into map: report_type → newest-first events, max 5 per key
  const logMap = new Map<string, UploadEvent[]>();
  for (const row of (logData ?? []) as unknown as LogRow[]) {
    if (!logMap.has(row.report_type)) logMap.set(row.report_type, []);
    const events = logMap.get(row.report_type)!;
    if (events.length < 5) {
      events.push({
        ingested_at: row.ingested_at,
        date_range_start: row.date_range_start,
        date_range_end: row.date_range_end,
        rows_received: row.rows_received,
        rows_stored: row.rows_stored,
        rows_rejected: row.rows_rejected,
        status: row.status ?? 'unknown',
        error_message: row.error_message,
        ingestion_method: row.ingestion_method,
      });
    }
  }

  // Per-entry source-table queries fire in parallel via Promise.all
  const rows = await Promise.all(
    REPORT_REGISTRY.map(async (entry): Promise<TrackerRow> => {
      // Merge events from current internal_id and any legacy IDs (Option A: legacy_report_ids).
      // Re-sort by ingested_at desc after merging since each logMap bucket is independently sorted.
      const allIds = [entry.internal_id, ...(entry.legacy_report_ids ?? [])];
      const mergedEvents: UploadEvent[] = [];
      for (const id of allIds) {
        for (const ev of logMap.get(id) ?? []) mergedEvents.push(ev);
      }
      mergedEvents.sort((a, b) => b.ingested_at.localeCompare(a.ingested_at));
      const events          = mergedEvents.slice(0, 5);
      const lastUploadEvent = events[0] ?? null;
      const uploadHistory   = events;
      const lastUpload      = lastUploadEvent ? lastUploadEvent.ingested_at : null;
      const lastUploadDate  = lastUpload ? new Date(lastUpload) : null;
      const daysSinceLastUpload = lastUploadDate
        ? Math.floor((today.getTime() - lastUploadDate.getTime()) / 86_400_000)
        : null;
      const reportStatus          = calculateStatus(entry, lastUploadDate, today);
      const attributionWindowDays = ATTRIBUTION_WINDOW_DAYS[entry.source_platform] ?? 0;

      let coverageStart: string | null = null;
      let coverageEnd:   string | null = null;
      let distinctDates: string[]      = [];

      if (entry.cadence !== 'pending') {
        try {
          const needsDistinct =
            entry.granularity === 'daily' ||
            entry.granularity === 'weekly' ||
            entry.granularity === 'monthly';

          if (needsDistinct) {
            // INB-139: server-side SELECT DISTINCT via the coverage RPC. The old
            // fetchAll here pulled every source row for the brand (448K rows on
            // sp_targeting_report → statement timeout); the distinct-date list
            // is tiny (~127 dates) and comes back ordered in one call.
            distinctDates = await fetchDistinctDates(entry, brandId);
            coverageStart = distinctDates[0] ?? null;
            coverageEnd   = distinctDates[distinctDates.length - 1] ?? null;
          } else {
            // snapshot / per_order — two limit-1 queries for min and max
            type DateRow = Record<string, unknown>;
            const [minRes, maxRes] = await Promise.all([
              (() => {
                let q = supabaseAdmin
                  .from(entry.source_table)
                  .select(entry.date_column)
                  .eq('brand_id', brandId);
                if (entry.source_filter) {
                  q = q.in(entry.source_filter.column, entry.source_filter.values);
                }
                return q.order(entry.date_column, { ascending: true }).limit(1);
              })(),
              (() => {
                let q = supabaseAdmin
                  .from(entry.source_table)
                  .select(entry.date_column)
                  .eq('brand_id', brandId);
                if (entry.source_filter) {
                  q = q.in(entry.source_filter.column, entry.source_filter.values);
                }
                return q.order(entry.date_column, { ascending: false }).limit(1);
              })(),
            ]);
            const minRow = (minRes.data?.[0] as unknown as DateRow) ?? null;
            const maxRow = (maxRes.data?.[0] as unknown as DateRow) ?? null;
            coverageStart = minRow ? (String(minRow[entry.date_column] ?? '').slice(0, 10) || null) : null;
            coverageEnd   = maxRow ? (String(maxRow[entry.date_column] ?? '').slice(0, 10) || null) : null;
          }
        } catch (err) {
          console.warn(
            `[loadTrackerData] source query failed for ${entry.internal_id}:`,
            err instanceof Error ? err.message : String(err),
          );
          // Leave coverageStart/End as null, distinctDates as [] — loader continues
        }
      }

      const gapAnalysis = detectGaps(entry, distinctDates);

      // effectiveDate: subtract attribution window from coverageEnd (UTC math)
      let effectiveDate: string | null = coverageEnd;
      if (coverageEnd && attributionWindowDays > 0) {
        effectiveDate = new Date(
          new Date(coverageEnd + 'T00:00:00Z').getTime() - attributionWindowDays * 86_400_000,
        ).toISOString().slice(0, 10);
      }

      const effectiveFreshness: EffectiveFreshness = {
        dataMaxDate: coverageEnd,
        attributionWindowDays,
        effectiveDate,
      };

      return {
        entry,
        lastUpload,
        lastUploadEvent,
        daysSinceLastUpload,
        reportStatus,
        coverageStart,
        coverageEnd,
        gapAnalysis,
        effectiveFreshness,
        uploadHistory,
      };
    })
  );

  // REPORT_REGISTRY is already sorted by display_order — preserve input order
  return rows;
}

export const loadTrackerData = unstable_cache(
  _loadTrackerData,
  ['tracker-data'],
  { revalidate: 60, tags: ['tracker-data'] },
);
