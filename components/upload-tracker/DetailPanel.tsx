'use client'

import { useEffect } from 'react'
import type { TrackerRow } from '@/lib/upload-tracker/data'

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

function statusEventColor(s: string): string {
  if (s === 'ok' || s === 'success') return '#10b981'
  if (s === 'partial') return '#f59e0b'
  return '#ef4444'
}

export function DetailPanel({
  row,
  onClose,
}: {
  row: TrackerRow | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!row) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [row, onClose])

  if (!row) return null

  const entry = row.entry
  const pullWindowStr =
    typeof entry.pull_window_days === 'number'
      ? `${entry.pull_window_days}d pull`
      : 'snapshot'

  const { withinWindow, historical, coverageStart, coverageEnd } = row.gapAnalysis
  const allGaps = [...withinWindow, ...historical]
  const totalGaps = allGaps.length
  const totalDays = allGaps.reduce((acc, g) => acc + g.days, 0)

  const { dataMaxDate, attributionWindowDays, effectiveDate } = row.effectiveFreshness

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-[480px] bg-[#16161a] border-l border-[#1e1e2e] overflow-y-auto z-50 font-mono">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#1e1e2e]">
          <div>
            <div className="text-[13px] text-[#e2e8f0] font-medium mb-1">{entry.display_name}</div>
            <div className="text-[10px] text-[#64748b]">
              {entry.source_platform} · {entry.cadence} · {pullWindowStr}
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
          {/* Last upload event */}
          <SectionLabel>LAST UPLOAD EVENT</SectionLabel>
          {row.lastUploadEvent ? (
            <div className="space-y-0.5">
              <Field label="Uploaded at" value={row.lastUploadEvent.ingested_at} />
              <Field
                label="Date range covered"
                value={
                  row.lastUploadEvent.date_range_start && row.lastUploadEvent.date_range_end
                    ? `${row.lastUploadEvent.date_range_start} → ${row.lastUploadEvent.date_range_end}`
                    : row.lastUploadEvent.date_range_start
                    ? `${row.lastUploadEvent.date_range_start} → —`
                    : '—'
                }
              />
              <Field
                label="Rows"
                value={`${row.lastUploadEvent.rows_received ?? '—'} received / ${row.lastUploadEvent.rows_stored ?? '—'} stored / ${row.lastUploadEvent.rows_rejected ?? '—'} rejected`}
              />
              <div className="flex justify-between gap-4 py-0.5">
                <span className="text-[10px] text-[#64748b] shrink-0">Status</span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: statusEventColor(row.lastUploadEvent.status) }}
                >
                  {row.lastUploadEvent.status}
                </span>
              </div>
              {row.lastUploadEvent.error_message && (
                <div className="mt-2">
                  <span className="text-[9px] text-[#64748b]">Error: </span>
                  <span className="text-[9px] text-[#ef4444]">{row.lastUploadEvent.error_message}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-[#475569]">No upload events recorded</p>
          )}

          {/* Data freshness */}
          <SectionLabel>DATA FRESHNESS</SectionLabel>
          {dataMaxDate ? (
            <div className="space-y-0.5">
              <Field label="Data through" value={dataMaxDate} />
              <Field
                label="Effective freshness"
                value={
                  effectiveDate
                    ? attributionWindowDays > 0
                      ? `${effectiveDate} (minus ${attributionWindowDays}d attribution window)`
                      : effectiveDate
                    : '—'
                }
              />
            </div>
          ) : (
            <p className="text-[10px] text-[#475569]">—</p>
          )}

          {/* Coverage analysis */}
          <SectionLabel>COVERAGE ANALYSIS</SectionLabel>
          {coverageStart && coverageEnd ? (
            <div>
              <div className="text-[10px] text-[#94a3b8] mb-2">
                Data covered: {coverageStart} → {coverageEnd}
                {totalGaps > 0 ? (
                  <span className="text-[#64748b]">
                    {' '}· {totalGaps} gap{totalGaps !== 1 ? 's' : ''} totaling {totalDays}d
                  </span>
                ) : (
                  <span className="text-[#10b981]"> · Continuous</span>
                )}
              </div>
              {withinWindow.length > 0 && (
                <div className="space-y-0.5 mb-2">
                  {withinWindow.map((g, i) => (
                    <div key={i} className="text-[10px]" style={{ color: '#ef4444' }}>
                      Re-pull recommended: {g.start} → {g.end} ({g.days}d)
                    </div>
                  ))}
                </div>
              )}
              {historical.length > 0 && (
                <div className="space-y-0.5">
                  {historical.map((g, i) => (
                    <div key={i} className="text-[10px]" style={{ color: '#f59e0b' }}>
                      Backfill candidate: {g.start} → {g.end} ({g.days}d)
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-[#475569]">—</p>
          )}

          {/* Upload history */}
          <SectionLabel>UPLOAD HISTORY</SectionLabel>
          {row.uploadHistory.length > 0 ? (
            <div className="space-y-1.5">
              {row.uploadHistory.map((ev, i) => {
                const dateStr = ev.ingested_at.slice(0, 10)
                const rangeStr =
                  ev.date_range_start && ev.date_range_end
                    ? `${ev.date_range_start} → ${ev.date_range_end}`
                    : ev.date_range_start
                    ? `${ev.date_range_start} → —`
                    : '—'
                const rowsStr = ev.rows_stored !== null ? `${ev.rows_stored}r` : '—'
                return (
                  <div key={i} className="text-[10px] text-[#64748b]">
                    <span className="text-[#94a3b8]">{dateStr}</span>
                    {' · '}
                    {rangeStr}
                    {' · '}
                    {rowsStr}
                    {' · '}
                    <span style={{ color: statusEventColor(ev.status) }}>{ev.status}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[10px] text-[#475569]">No history</p>
          )}

          {/* Configuration */}
          <SectionLabel>CONFIGURATION</SectionLabel>
          <div className="space-y-0.5">
            <Field label="Cadence" value={entry.cadence} />
            <Field
              label="Pull window"
              value={
                typeof entry.pull_window_days === 'number'
                  ? `${entry.pull_window_days}d`
                  : 'snapshot'
              }
            />
            <Field label="Granularity" value={entry.granularity} />
            <Field label="Source table" value={entry.source_table} />
            <Field label="Date column" value={entry.date_column} />
            <Field label="Display order" value={String(entry.display_order)} />
          </div>
          {entry.notes && (
            <p className="text-[9px] text-[#475569] mt-2 leading-relaxed">{entry.notes}</p>
          )}
          <p className="text-[9px] text-[#334155] mt-3">
            Configuration is read-only in Phase 1; admin editing planned for Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}
