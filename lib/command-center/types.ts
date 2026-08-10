// INB-147 — view-model types for the Report Command Center.

export type TileStatus = 'current' | 'due' | 'overdue' | 'ad_hoc' | 'planned'

export type StripCellState = 'filled' | 'gap' | 'neutral' | 'pending'
export type StripCell = { periodEnd: string; label: string; state: StripCellState }

// A coverage period reduced to what status/strip need.
export type CoverageEnd = {
  periodStart?: string // INB-166 — window-per-pull spans [periodStart, periodEnd]; the strip fills every
                       // week-cell the span intersects. Absent for point/weekly/monthly periods.
  periodEnd: string
  periodType: 'weekly' | 'monthly' | 'snapshot'
  dataThrough: string | null // max source date within the period (INB-147); null until backfilled
}

export type TileVM = {
  reportKey: string
  displayName: string
  sourceGroup: string
  cadence: string
  pullPeriod: string | null
  targetTable: string
  sortOrder: number
  isActive: boolean
  eventDriven: boolean
  notes: string | null
  status: TileStatus
  latestPeriodLabel: string | null
  latestPeriodEnd: string | null
  latestDataThrough: string | null
  periodLine: string // rendered freshness/window line for the tile face (INB-147 QC2)
  lastUploadAt: string | null // ISO timestamp of latest tagged ingestion-log event, else null
  strip: StripCell[]
}

export type SectionVM = {
  sourceGroup: string
  tiles: TileVM[]
  current: number
  total: number
}

export type CommandCenterVM = {
  sections: SectionVM[]
  planned: TileVM[]
  header: { current: number; due: number; overdue: number; total: number; weekLabel: string }
}

// Detail-panel payload (lazy-loaded per report_key).
export type ReportDetail = {
  coverage: { periodStart: string; periodEnd: string; periodLabel: string; periodType: string; dataThrough: string | null }[]
  events: {
    ingestedAt: string
    status: string | null
    rowsStored: number | null
    dateRangeStart: string | null
    dateRangeEnd: string | null
  }[]
}
