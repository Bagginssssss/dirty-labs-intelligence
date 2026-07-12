'use client'

import type { TileVM } from '@/lib/command-center/types'
import { STATUS_COLORS, relTimeLabel } from '@/lib/command-center/status'
import { CoverageStrip } from './CoverageStrip'
import { StatusBadge } from './StatusBadge'

export function ReportTile({ tile, onClick }: { tile: TileVM; onClick: () => void }) {
  const planned = tile.status === 'planned'
  const today = new Date().toISOString().slice(0, 10)
  return (
    <button
      onClick={onClick}
      className={`text-left bg-[#16161a] border border-[#1e1e2e] rounded-[4px] p-[10px] transition-colors hover:border-[#334155] ${planned ? 'opacity-60' : ''}`}
      style={{ borderLeft: `2px solid ${STATUS_COLORS[tile.status]}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-[#e2e8f0] font-medium leading-tight">{tile.displayName}</span>
        <StatusBadge status={tile.status} />
      </div>

      {planned ? (
        <div className="text-[9px] text-[#475569] mt-2 leading-relaxed">{tile.notes ?? 'Planned'}</div>
      ) : (
        <>
          <div className="flex items-center justify-between mt-2 text-[9px]">
            <span className="text-[#64748b]">{tile.periodLine}</span>
            <span className="text-[#475569]">Last upload: {relTimeLabel(tile.lastUploadAt, today)}</span>
          </div>
          {tile.eventDriven && (
            <div className="text-[8px] text-[#f59e0b] mt-1.5 leading-snug">⚠ Rolling export — don&apos;t skip weeks</div>
          )}
          <CoverageStrip cells={tile.strip} />
        </>
      )}
    </button>
  )
}
