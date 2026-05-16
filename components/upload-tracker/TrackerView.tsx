'use client'

import { useState, useMemo } from 'react'
import type { TrackerRow } from '@/lib/upload-tracker/data'
import type { ReportStatus } from '@/lib/upload-tracker/status'
import type { ReportRegistryEntry } from '@/lib/upload-tracker/registry'
import { FilterBar } from './FilterBar'
import { TrackerTable } from './TrackerTable'
import { DetailPanel } from './DetailPanel'

type Filter = ReportStatus | 'all'

export function TrackerView({ rows }: { rows: TrackerRow[] }) {
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [selectedEntry, setSelectedEntry] = useState<ReportRegistryEntry | null>(null)

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: rows.length,
      current: 0,
      due_soon: 0,
      overdue: 0,
      never_uploaded: 0,
      pending: 0,
    }
    for (const row of rows) {
      result[row.reportStatus]++
    }
    return result
  }, [rows])

  const filteredRows =
    activeFilter === 'all' ? rows : rows.filter(r => r.reportStatus === activeFilter)

  const selectedRow = selectedEntry
    ? rows.find(r => r.entry.internal_id === selectedEntry.internal_id) ?? null
    : null

  return (
    <>
      <FilterBar counts={counts} activeFilter={activeFilter} onChange={setActiveFilter} />
      <TrackerTable
        rows={filteredRows}
        activeFilter={activeFilter}
        onRowSelect={setSelectedEntry}
      />
      <DetailPanel row={selectedRow} onClose={() => setSelectedEntry(null)} />
    </>
  )
}
