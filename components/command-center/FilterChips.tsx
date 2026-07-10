'use client'

export type FilterKey = 'all' | 'due' | 'overdue' | 'ad_hoc' | 'planned'

const CHIPS: { key: FilterKey; label: string; color: string }[] = [
  { key: 'all', label: 'ALL', color: '#94a3b8' },
  { key: 'due', label: 'DUE', color: '#f59e0b' },
  { key: 'overdue', label: 'OVERDUE', color: '#ef4444' },
  { key: 'ad_hoc', label: 'AD-HOC', color: '#475569' },
  { key: 'planned', label: 'PLANNED', color: '#334155' },
]

// Status filter — mirrors components/upload-tracker/FilterBar.tsx pill idiom.
export function FilterChips({
  active,
  counts,
  onChange,
}: {
  active: FilterKey
  counts: Record<FilterKey, number>
  onChange: (k: FilterKey) => void
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {CHIPS.map(c => {
        const on = active === c.key
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            className="text-[9px] tracking-[0.08em] px-2 py-0.5 rounded-sm border transition-colors"
            style={{
              borderColor: on ? c.color : '#1e1e2e',
              color: on ? c.color : '#64748b',
              backgroundColor: on ? `${c.color}1a` : 'transparent',
            }}
          >
            {c.label} {counts[c.key]}
          </button>
        )
      })}
    </div>
  )
}
