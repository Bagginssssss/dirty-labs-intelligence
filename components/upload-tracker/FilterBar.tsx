'use client'

import type { ReportStatus } from '@/lib/upload-tracker/status'

type Filter = ReportStatus | 'all'

type PillDef = {
  key: Filter
  label: string
  activeColor: string
}

const PILLS: PillDef[] = [
  { key: 'all',            label: 'ALL',            activeColor: '#3b82f6' },
  { key: 'overdue',        label: 'OVERDUE',        activeColor: '#ef4444' },
  { key: 'due_soon',       label: 'DUE SOON',       activeColor: '#f59e0b' },
  { key: 'current',        label: 'CURRENT',        activeColor: '#10b981' },
  { key: 'never_uploaded', label: 'STALE',          activeColor: '#475569' },
  { key: 'pending',        label: 'PENDING',        activeColor: '#334155' },
]

export function FilterBar({
  counts,
  activeFilter,
  onChange,
}: {
  counts: Record<Filter, number>
  activeFilter: Filter
  onChange: (f: Filter) => void
}) {
  return (
    <div className="flex items-center gap-0 flex-wrap mb-4">
      {PILLS.map((pill, i) => {
        const count = counts[pill.key]
        const isActive = activeFilter === pill.key
        const isEmpty = count === 0 && pill.key !== 'all'

        const activeStyle = {
          borderColor: pill.activeColor,
          color: pill.activeColor,
          backgroundColor: pill.activeColor + '1a',
        }
        const inactiveStyle = isEmpty
          ? { borderColor: '#1e1e2e', color: '#475569' }
          : { borderColor: '#1e1e2e', color: '#64748b' }

        return (
          <span key={pill.key} className="flex items-center">
            {i > 0 && (
              <span className="text-[#1e1e2e] text-[10px] mx-1.5">·</span>
            )}
            <button
              onClick={() => onChange(pill.key)}
              style={isActive ? activeStyle : inactiveStyle}
              className="text-[9px] tracking-[0.08em] px-2 py-0.5 rounded-sm border transition-colors hover:opacity-80"
            >
              {pill.label} ({count})
            </button>
          </span>
        )
      })}
    </div>
  )
}
