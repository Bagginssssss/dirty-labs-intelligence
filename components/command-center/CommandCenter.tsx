'use client'

import { useMemo, useState } from 'react'
import type { CommandCenterVM, TileVM } from '@/lib/command-center/types'
import { ProgressRail } from './ProgressRail'
import { FilterChips, type FilterKey } from './FilterChips'
import { ReportTile } from './ReportTile'
import { ReportDetailPanel } from './ReportDetailPanel'

const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[9px]'

export function CommandCenter({ data }: { data: CommandCenterVM }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [openTile, setOpenTile] = useState<TileVM | null>(null)

  const counts = useMemo<Record<FilterKey, number>>(() => {
    const active = data.sections.flatMap(s => s.tiles)
    return {
      all: active.length + data.planned.length,
      due: active.filter(t => t.status === 'due').length,
      overdue: active.filter(t => t.status === 'overdue').length,
      ad_hoc: active.filter(t => t.status === 'ad_hoc').length,
      planned: data.planned.length,
    }
  }, [data])

  const match = (t: TileVM) => filter === 'all' || t.status === filter
  const showPlanned = filter === 'all' || filter === 'planned'

  return (
    <div>
      <div className="mb-4">
        <ProgressRail header={data.header} />
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

      <ReportDetailPanel tile={openTile} onClose={() => setOpenTile(null)} />
    </div>
  )
}
