import type { StripCell } from '@/lib/command-center/types'

// filled = covered (green), gap = missing expected period (red), pending = most-recent
// week awaiting publication within grace (amber), neutral = quiet week for event-driven /
// irregular snapshot reports (faint slate — not "missing data").
const CELL_COLOR: Record<StripCell['state'], string> = {
  filled: '#10b981',
  gap: '#ef4444',
  pending: '#f59e0b',
  neutral: '#334155',
}

export function CoverageStrip({ cells }: { cells: StripCell[] }) {
  if (cells.length === 0) return null
  return (
    <div className="flex gap-[2px] mt-[8px]">
      {cells.map(c => (
        <div
          key={c.periodEnd}
          title={`${c.label} — ${c.state}`}
          className="h-[6px] flex-1 rounded-[1px]"
          style={{ backgroundColor: CELL_COLOR[c.state], opacity: c.state === 'neutral' ? 0.55 : c.state === 'pending' ? 0.6 : 1 }}
        />
      ))}
    </div>
  )
}
