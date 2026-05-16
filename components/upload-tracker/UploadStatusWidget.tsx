import { BRAND_ID } from '@/lib/dashboard/data';
import { loadTrackerData } from '@/lib/upload-tracker/data';
import { UploadStatusCard } from './UploadStatusCard';

export async function UploadStatusWidget() {
  const rows = await loadTrackerData(BRAND_ID);

  const counts = {
    total: rows.length,
    current: 0,
    due_soon: 0,
    overdue: 0,
    never_uploaded: 0,
    pending: 0,
  };
  for (const row of rows) counts[row.reportStatus]++;

  const overdueItems = rows
    .filter(r => r.reportStatus === 'overdue')
    .sort((a, b) => (b.daysSinceLastUpload ?? 0) - (a.daysSinceLastUpload ?? 0))
    .slice(0, 3)
    .map(r => ({
      internal_id: r.entry.internal_id,
      display_name: r.entry.display_name,
      daysSinceLastUpload: r.daysSinceLastUpload,
    }));

  return <UploadStatusCard counts={counts} overdueItems={overdueItems} />;
}
