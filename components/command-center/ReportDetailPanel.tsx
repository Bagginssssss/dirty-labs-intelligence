'use client'

import { useEffect, useState } from 'react'
import type { ReportDetail, TileVM } from '@/lib/command-center/types'
import { fetchReportDetail } from '@/app/upload/actions'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/command-center/status'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] tracking-[0.1em] text-[#3b82f6] mt-5 mb-2 border-b border-[#1e1e2e] pb-1.5">
      {children}
    </div>
  )
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-[10px] text-[#64748b] shrink-0">{label}</span>
      <span className="text-[10px] text-[#e2e8f0] text-right">{value}</span>
    </div>
  )
}
function eventColor(s: string | null): string {
  if (s === 'success' || s === 'ok') return '#10b981'
  if (s === 'partial') return '#f59e0b'
  return '#ef4444'
}

export function ReportDetailPanel({ tile, onClose }: { tile: TileVM | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!tile) {
      setDetail(null)
      return
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    let alive = true
    setLoading(true)
    setDetail(null)
    fetchReportDetail(tile.reportKey)
      .then(d => alive && (setDetail(d), setLoading(false)))
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
      document.removeEventListener('keydown', handler)
    }
  }, [tile, onClose])

  if (!tile) return null

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute right-0 top-0 bottom-0 w-[480px] bg-[#16161a] border-l border-[#1e1e2e] overflow-y-auto z-50 font-mono">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#1e1e2e]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] text-[#e2e8f0] font-medium">{tile.displayName}</span>
              <span
                className="text-[8px] tracking-[0.06em] px-1.5 py-0.5 rounded-sm font-medium"
                style={{ color: '#0f0f0f', backgroundColor: STATUS_COLORS[tile.status] }}
              >
                {STATUS_LABELS[tile.status]}
              </span>
            </div>
            <div className="text-[10px] text-[#64748b]">
              {tile.sourceGroup} · {tile.cadence}
              {tile.pullPeriod ? ` · ${tile.pullPeriod}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#64748b] hover:text-[#94a3b8] transition-colors text-[18px] leading-none ml-4 mt-0.5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {/* Configuration */}
          <SectionLabel>CONFIGURATION</SectionLabel>
          <div className="space-y-0.5">
            <Field label="Report key" value={tile.reportKey} />
            <Field label="Source group" value={tile.sourceGroup} />
            <Field label="Cadence" value={tile.cadence} />
            <Field label="Pull period" value={tile.pullPeriod ?? '—'} />
            <Field label="Target table" value={tile.targetTable} />
            <Field label="Latest covered" value={tile.latestPeriodLabel ?? '—'} />
            <Field label="Last upload" value={tile.lastUploadAt ? tile.lastUploadAt.slice(0, 10) : '—'} />
            {tile.eventDriven && <Field label="Event-driven" value="yes — gaps are normal" />}
          </div>
          {tile.notes && <p className="text-[9px] text-[#475569] mt-2 leading-relaxed">{tile.notes}</p>}

          {/* Coverage timeline */}
          <SectionLabel>COVERAGE TIMELINE</SectionLabel>
          {loading && <p className="text-[10px] text-[#475569]">Loading…</p>}
          {!loading && detail && detail.coverage.length > 0 ? (
            <div className="space-y-0.5">
              {detail.coverage.map((c, i) => (
                <div key={`${c.periodStart}-${i}`} className="flex justify-between gap-4 text-[10px]">
                  <span className="text-[#94a3b8]">{c.periodLabel}</span>
                  <span className="text-[#475569]">
                    {c.periodStart} → {c.periodEnd} · {c.periodType}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            !loading && <p className="text-[10px] text-[#475569]">No coverage recorded</p>
          )}

          {/* Upload events */}
          <SectionLabel>UPLOAD EVENTS</SectionLabel>
          {!loading && detail && detail.events.length > 0 ? (
            <div className="space-y-1.5">
              {detail.events.map((e, i) => (
                <div key={i} className="text-[10px] text-[#64748b]">
                  <span className="text-[#94a3b8]">{e.ingestedAt.slice(0, 10)}</span>
                  {' · '}
                  {e.dateRangeStart && e.dateRangeEnd ? `${e.dateRangeStart} → ${e.dateRangeEnd}` : '—'}
                  {' · '}
                  {e.rowsStored !== null ? `${e.rowsStored}r` : '—'}
                  {' · '}
                  <span style={{ color: eventColor(e.status) }}>{e.status ?? '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            !loading && (
              <p className="text-[10px] text-[#475569]">
                No tagged upload events (per-report tagging began INB-145; earlier uploads are untagged).
              </p>
            )
          )}

          <p className="text-[9px] text-[#334155] mt-4">Upload new data from the panel at the bottom of the page.</p>
        </div>
      </div>
    </div>
  )
}
