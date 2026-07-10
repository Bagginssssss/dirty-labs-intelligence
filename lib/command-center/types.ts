// INB-147 — view-model types for the Report Command Center.

export type TileStatus = 'current' | 'due' | 'overdue' | 'ad_hoc' | 'planned'

export type StripCellState = 'filled' | 'gap' | 'neutral'
export type StripCell = { periodEnd: string; label: string; state: StripCellState }

// A coverage period reduced to what status/strip need.
export type CoverageEnd = { periodEnd: string; periodType: 'weekly' | 'monthly' | 'snapshot' }

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
  coverage: { periodStart: string; periodEnd: string; periodLabel: string; periodType: string }[]
  events: {
    ingestedAt: string
    status: string | null
    rowsStored: number | null
    dateRangeStart: string | null
    dateRangeEnd: string | null
  }[]
}
