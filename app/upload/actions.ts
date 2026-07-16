'use server';

import { updateTag, revalidatePath } from 'next/cache';
import { BRAND_ID } from '@/lib/dashboard/data';
import { loadReportDetail } from '@/lib/command-center/data';
import type { ReportDetail } from '@/lib/command-center/types';

// Called on ingest success. updateTag purges the server data cache (read-your-own-writes), but
// per the Next 16 docs it does NOT refresh dynamic data cached on the client — the cause of the
// repeated stale post-upload renders. revalidatePath('/upload') purges the whole path so the
// command center never serves a pre-upload view once the row is stored.
export async function refreshTrackerCache() {
  updateTag('tracker-data');
  revalidatePath('/upload');
}

// INB-147 — lazy per-report detail for the tile detail panel (full coverage history +
// recent tagged upload events). Bounded to one report_key.
export async function fetchReportDetail(reportKey: string): Promise<ReportDetail> {
  return loadReportDetail(BRAND_ID, reportKey);
}
