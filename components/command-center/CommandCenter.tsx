'use client'

import { useMemo, useState } from 'react'
import type { CommandCenterVM, TileVM } from '@/lib/command-center/types'
import { ProgressRail } from './ProgressRail'
import { FilterChips, type FilterKey } from './FilterChips'
import { ReportTile } from './ReportTile'
import { ReportDetailPanel } from './ReportDetailPanel'

const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[9px]'

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-[8px] h-[6px] rounded-[1px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

export function CommandCenter({ data }: { data: CommandCenterVM }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [openTile, setOpenTile] = useState<TileVM | null>(null)

  const counts = useMemo<Record<FilterKey, number>>(() => {
    const active = data.sections.flatMap(s => s.tiles)
    return {
      all: active.length + data.planned.length + data.retired.length,
      due: active.filter(t => t.status === 'due').length,
      overdue: active.filter(t => t.status === 'overdue').length,
      ad_hoc: active.filter(t => t.status === 'ad_hoc').length,
      planned: data.planned.length,
      retired: data.retired.length, // INB-175
    }
  }, [data])

  const match = (t: TileVM) => filter === 'all' || t.status === filter
  const showPlanned = filter === 'all' || filter === 'planned'
  const showRetired = filter === 'all' || filter === 'retired' // INB-175

  return (
    <div>
      <div className="mb-3">
        <ProgressRail header={data.header} />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-4 text-[8px] text-[#475569]">
        <LegendSwatch color="#10b981" label="covered" />
        <LegendSwatch color="#f59e0b" label="pending" />
        <LegendSwatch color="#ef4444" label="gap" />
        <LegendSwatch color="#334155" label="quiet (event-driven)" />
        <span className="text-[#64748b]">W/E = week ending (Sat)</span>
      </div>

      <div className="mb-5">
        <FilterChips active={filter} counts={counts} onChange={setFilter} />
      </div>

      {data.sections.map(section => {
        const tiles = section.tiles.filter(match)
        if (tiles.length === 0) return null
        return (
          <section key={section.sourceGroup} className="mb-5">
            <div className="flex items-center justify-between border-b border-[#1e1e2e] pb-1.5 mb-2.5">
              <span className="text-[10px] tracking-[0.12em] text-[#3b82f6]">{section.sourceGroup}</span>
              <span className="text-[9px] text-[#475569]">
                {section.current}/{section.total} this week
              </span>
            </div>
            <div className={GRID}>
              {tiles.map(t => (
                <ReportTile key={t.reportKey} tile={t} onClick={() => setOpenTile(t)} />
              ))}
            </div>
          </section>
        )
      })}

      {showPlanned && data.planned.length > 0 && (
        <section className="mb-5">
          <div className="border-b border-[#1e1e2e] pb-1.5 mb-2.5">
            <span className="text-[10px] tracking-[0.12em] text-[#475569]">PLANNED</span>
          </div>
          <div className={GRID}>
            {data.planned.map(t => (
              <ReportTile key={t.reportKey} tile={t} onClick={() => setOpenTile(t)} />
            ))}
          </div>
        </section>
      )}

      {/* INB-175 — RETIRED: reports removed by the source. Distinct from PLANNED (not-yet-built). */}
      {showRetired && data.retired.length > 0 && (
        <section className="mb-5">
          <div className="border-b border-[#1e1e2e] pb-1.5 mb-2.5">
            <span className="text-[10px] tracking-[0.12em] text-[#7f1d1d]">RETIRED</span>
          </div>
          <div className={GRID}>
            {data.retired.map(t => (
              <ReportTile key={t.reportKey} tile={t} onClick={() => setOpenTile(t)} />
            ))}
          </div>
        </section>
      )}

      <ReportDetailPanel tile={openTile} onClose={() => setOpenTile(null)} />
    </div>
  )
}
