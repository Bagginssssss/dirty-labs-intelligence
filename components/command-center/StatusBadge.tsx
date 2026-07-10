import { STATUS_COLORS, STATUS_LABELS } from '@/lib/command-center/status'
import type { TileStatus } from '@/lib/command-center/types'

// Solid pill, dark text on the status color — matches the app's existing status badge
// (components/upload-tracker/TrackerTable.tsx).
export function StatusBadge({ status }: { status: TileStatus }) {
  return (
    <span
      className="text-[8px] tracking-[0.06em] px-1.5 py-0.5 rounded-sm font-medium shrink-0"
      style={{ color: '#0f0f0f', backgroundColor: STATUS_COLORS[status] }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
