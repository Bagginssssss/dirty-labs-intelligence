'use client'

import { useState } from 'react'
import type { TrackerRow } from '@/lib/upload-tracker/data'
import type { ReportStatus } from '@/lib/upload-tracker/status'
import type { ReportRegistryEntry } from '@/lib/upload-tracker/registry'

type Filter = ReportStatus | 'all'
type SortKey = 'display_name' | 'source_platform' | 'cadence' | 'lastUpload' | 'daysSince' | 'status'
type SortDir = 'asc' | 'desc'
type SortState = { key: SortKey; dir: SortDir } | null

const STATUS_PRIORITY: Record<ReportStatus, number> = {
  overdue: 0,
  due_soon: 1,
  current: 2,
  never_uploaded: 3,
  pending: 4,
}

const STATUS_COLORS: Record<ReportStatus, string> = {
  current: '#10b981',
  due_soon: '#f59e0b',
  overdue: '#ef4444',
  never_uploaded: '#475569',
  pending: '#334155',
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  current: 'CURRENT',
  due_soon: 'DUE SOON',
  overdue: 'OVERDUE',
  never_uploaded: 'NEVER UPLOADED',
  pending: 'PENDING',
}

const CADENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  ad_hoc: 'Ad Hoc',
  pending: 'Pending',
}

function nullLast<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return cmp(a, b)
}

function defaultSort(a: TrackerRow, b: TrackerRow): number {
  const pa = STATUS_PRIORITY[a.reportStatus]
  const pb = STATUS_PRIORITY[b.reportStatus]
  if (pa !== pb) return pa - pb
  return a.entry.display_order - b.entry.display_order
}

function applySort(rows: TrackerRow[], sort: SortState): TrackerRow[] {
  if (!sort) return [...rows].sort(defaultSort)
  const { key, dir } = sort
  const mul = dir === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'display_name':
        cmp = a.entry.display_name.localeCompare(b.entry.display_name)
        break
      case 'source_platform':
        cmp = a.entry.source_platform.localeCompare(b.entry.source_platform)
        break
      case 'cadence':
        cmp = a.entry.cadence.localeCompare(b.entry.cadence)
        break
      case 'lastUpload':
        cmp = nullLast(
          a.lastUpload ? a.lastUpload.toISOString() : null,
          b.lastUpload ? b.lastUpload.toISOString() : null,
          (x, y) => x.localeCompare(y),
        )
        break
      case 'daysSince':
        cmp = nullLast(
          a.daysSinceLastUpload,
          b.daysSinceLastUpload,
          (x, y) => x - y,
        )
        break
      case 'status':
        cmp = STATUS_PRIORITY[a.reportStatus] - STATUS_PRIORITY[b.reportStatus]
        break
    }
    return cmp * mul
  })
}

function SortCaret({ sortKey, sort }: { sortKey: SortKey; sort: SortState }) {
  if (!sort || sort.key !== sortKey) {
    return <span className="text-[#475569] ml-1">⇅</span>
  }
  return (
    <span className="text-[#94a3b8] ml-1">
      {sort.dir === 'asc' ? '▲' : '▼'}
    </span>
  )
}

export function TrackerTable({
  rows,
  activeFilter,
  onRowSelect,
}: {
  rows: TrackerRow[]
  activeFilter: Filter
  onRowSelect: (entry: ReportRegistryEntry) => void
}) {
  const [sort, setSort] = useState<SortState>(null)

  function handleColumnClick(key: SortKey) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const sorted = applySort(rows, sort)

  const thClass = 'text-left text-[9px] tracking-[0.08em] text-[#64748b] py-2 pr-4 border-b border-[#1e1e2e] cursor-pointer hover:text-[#94a3b8] select-none whitespace-nowrap'
  const thNoSort = 'text-left text-[9px] tracking-[0.08em] text-[#64748b] py-2 pr-4 border-b border-[#1e1e2e] whitespace-nowrap'

  return (
    <div className="overflow-x-auto mb-6">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass} onClick={() => handleColumnClick('display_name')}>
              REPORT <SortCaret sortKey="display_name" sort={sort} />
            </th>
            <th className={thClass} onClick={() => handleColumnClick('source_platform')}>
              SOURCE <SortCaret sortKey="source_platform" sort={sort} />
            </th>
            <th className={thClass} onClick={() => handleColumnClick('cadence')}>
              CADENCE <SortCaret sortKey="cadence" sort={sort} />
            </th>
            <th className={thClass} onClick={() => handleColumnClick('lastUpload')}>
              LAST UPLOAD <SortCaret sortKey="lastUpload" sort={sort} />
            </th>
            <th className={thClass} onClick={() => handleColumnClick('daysSince')}>
              DAYS <SortCaret sortKey="daysSince" sort={sort} />
            </th>
            <th className={thClass} onClick={() => handleColumnClick('status')}>
              STATUS <SortCaret sortKey="status" sort={sort} />
            </th>
            <th className={thNoSort}>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <TableRow key={row.entry.internal_id} row={row} onRowSelect={onRowSelect} />
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="text-[10px] text-[#475569] py-6 text-center">
                No reports match this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TableRow({
  row,
  onRowSelect,
}: {
  row: TrackerRow
  onRowSelect: (entry: ReportRegistryEntry) => void
}) {
  const isPending = row.entry.cadence === 'pending'
  const statusColor = STATUS_COLORS[row.reportStatus]

  const lastUploadStr = row.lastUpload
    ? row.lastUpload.toISOString().slice(0, 10)
    : '—'

  const daysStr = row.daysSinceLastUpload !== null && !isPending
    ? `${row.daysSinceLastUpload}d`
    : '—'

  return (
    <tr
      onClick={() => onRowSelect(row.entry)}
      className="border-b border-[#1e1e2e]/50 hover:bg-[#16161a] cursor-pointer transition-colors"
    >
      <td className="text-[11px] text-[#e2e8f0] py-2 pr-4 whitespace-nowrap">
        {row.entry.display_name}
      </td>
      <td className="text-[10px] text-[#94a3b8] py-2 pr-4 whitespace-nowrap">
        {row.entry.source_platform}
      </td>
      <td className="text-[10px] text-[#94a3b8] py-2 pr-4 whitespace-nowrap">
        {CADENCE_LABELS[row.entry.cadence] ?? row.entry.cadence}
      </td>
      <td className="text-[10px] text-[#94a3b8] py-2 pr-4 whitespace-nowrap">
        {lastUploadStr}
      </td>
      <td className="text-[10px] text-[#94a3b8] py-2 pr-4 whitespace-nowrap">
        {daysStr}
      </td>
      <td className="py-2 pr-4 whitespace-nowrap">
        <span
          className="text-[9px] tracking-[0.06em] px-1.5 py-0.5 rounded-sm font-medium"
          style={{
            color: '#0f0f0f',
            backgroundColor: statusColor,
          }}
        >
          {STATUS_LABELS[row.reportStatus]}
        </span>
      </td>
      <td className="py-2 whitespace-nowrap">
        {isPending ? (
          <span className="text-[9px] text-[#334155] tracking-[0.06em] border border-[#334155]/40 px-1.5 py-0.5 rounded-sm opacity-50">
            [UPLOAD]
          </span>
        ) : (
          <a
            href="#upload-area"
            onClick={e => e.stopPropagation()}
            className="text-[9px] text-[#64748b] tracking-[0.06em] border border-[#1e1e2e] px-1.5 py-0.5 rounded-sm hover:text-[#94a3b8] hover:border-[#475569] transition-colors"
          >
            [UPLOAD]
          </a>
        )}
      </td>
    </tr>
  )
}
