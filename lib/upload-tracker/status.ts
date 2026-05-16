import { ReportRegistryEntry } from './registry';

export type ReportStatus =
  | 'current'
  | 'due_soon'
  | 'overdue'
  | 'never_uploaded'
  | 'pending';

/**
 * Both dates are treated as UTC. Callers should construct dates from ISO date strings
 * (YYYY-MM-DD) to avoid local-timezone ambiguity at day boundaries.
 */
export function calculateStatus(
  entry: ReportRegistryEntry,
  lastUpload: Date | null,
  today: Date
): ReportStatus {
  if (entry.cadence === 'pending') return 'pending';
  if (lastUpload === null) return 'never_uploaded';

  const daysSince = Math.floor((today.getTime() - lastUpload.getTime()) / 86_400_000);

  if (entry.cadence === 'weekly') {
    if (daysSince <= 6) return 'current';
    if (daysSince <= 9) return 'due_soon';
    return 'overdue';
  }

  if (entry.cadence === 'monthly') {
    if (daysSince <= 28) return 'current';
    if (daysSince <= 37) return 'due_soon';
    return 'overdue';
  }

  // ad_hoc: no automatic overdue flag; manual flagging is a Phase 2 enhancement
  return 'current';
}
