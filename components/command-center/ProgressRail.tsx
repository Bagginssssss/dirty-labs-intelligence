import type { CommandCenterVM } from '@/lib/command-center/types'

// Header week-progress rail — multi-segment fill (current / due / overdue), extends the
// app's GoalRail progress-bar idiom (track #1e1e2e + status-colored fill).
export function ProgressRail({ header }: { header: CommandCenterVM['header'] }) {
  const { current, due, overdue, total, weekLabel } = header
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  return (
    <div>
      <div className="flex items-center justify-between mb-[6px]">
        <span className="text-[10px] text-[#94a3b8]">
          <span className="text-[#e2e8f0] font-medium">{current}</span> of {total} current
          <span className="text-[#475569]"> · week ending {weekLabel.replace('W/E ', '')}</span>
        </span>
        <span className="text-[9px]">
          <span style={{ color: '#10b981' }}>{current} current</span>
          <span className="text-[#334155]"> · </span>
          <span style={{ color: '#f59e0b' }}>{due} due</span>
          <span className="text-[#334155]"> · </span>
          <span style={{ color: '#ef4444' }}>{overdue} overdue</span>
        </span>
      </div>
      <div className="h-[3px] bg-[#1e1e2e] rounded-[1px] overflow-hidden flex">
        <div className="h-[3px]" style={{ width: pct(current), backgroundColor: '#10b981' }} />
        <div className="h-[3px]" style={{ width: pct(due), backgroundColor: '#f59e0b' }} />
        <div className="h-[3px]" style={{ width: pct(overdue), backgroundColor: '#ef4444' }} />
      </div>
    </div>
  )
}
