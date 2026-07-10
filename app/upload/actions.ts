'use server';

import { updateTag } from 'next/cache';
import { BRAND_ID } from '@/lib/dashboard/data';
import { loadReportDetail } from '@/lib/command-center/data';
import type { ReportDetail } from '@/lib/command-center/types';

export async function refreshTrackerCache() {
  updateTag('tracker-data');
}

// INB-147 — lazy per-report detail for the tile detail panel (full coverage history +
// recent tagged upload events). Bounded to one report_key.
export async function fetchReportDetail(reportKey: string): Promise<ReportDetail> {
  return loadReportDetail(BRAND_ID, reportKey);
}
