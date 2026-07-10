'use client'

import type { TileVM } from '@/lib/command-center/types'
import { STATUS_COLORS } from '@/lib/command-center/status'
import { CoverageStrip } from './CoverageStrip'
import { StatusBadge } from './StatusBadge'

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  const w = Math.floor(days / 7)
  return w === 1 ? '1w ago' : `${w}w ago`
}

export function ReportTile({ tile, onClick }: { tile: TileVM; onClick: () => void }) {
  const planned = tile.status === 'planned'
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
            <span className="text-[#64748b]">{tile.latestPeriodLabel ?? '—'}</span>
            <span className="text-[#475569]">{relTime(tile.lastUploadAt)}</span>
          </div>
          {tile.notes && (
            <div className="text-[8px] text-[#475569] mt-1.5 leading-snug line-clamp-2">{tile.notes}</div>
          )}
          <CoverageStrip cells={tile.strip} />
        </>
      )}
    </button>
  )
}
