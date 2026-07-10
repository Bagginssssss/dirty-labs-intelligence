// INB-147 — coverage-driven status + strip + section assembly (pure, testable).
//
// Reads nothing; operates on registry cadence + report_coverage ends (never source
// tables). Weekly periods are Saturday-ending (Sun–Sat) — same convention as
// lib/coverage/buckets.ts. Event-driven reports key off upload recency, not coverage
// continuity, and never escalate on gaps (their quiet weeks are normal).

import { addDays, daysBetween } from '@/lib/upload-tracker/gaps'
import type { CoverageMode } from '@/lib/coverage/buckets'
import type { CommandCenterVM, CoverageEnd, SectionVM, StripCell, StripCellState, TileStatus, TileVM } from './types'

// Canonical status palette — matches the app's existing status colors
// (components/upload-tracker/TrackerTable.tsx). Single source for the tile UI.
export const STATUS_COLORS: Record<TileStatus, string> = {
  current: '#10b981',
  due: '#f59e0b',
  overdue: '#ef4444',
  ad_hoc: '#475569',
  planned: '#334155',
}
export const STATUS_LABELS: Record<TileStatus, string> = {
  current: 'CURRENT',
  due: 'DUE',
  overdue: 'OVERDUE',
  ad_hoc: 'AD-HOC',
  planned: 'PLANNED',
}

// Tunable thresholds (one place — reviewed/tuned during QC). Days measured from the
// expected period's end (weekly Saturday / month end) or from the latest activity.
// The status algorithm is chosen by COVERAGE MODE (how the data is actually stored),
// not the registry cadence string — e.g. rule_assignments has cadence 'weekly' but
// snapshot-grade coverage, so it uses snapshot recency, not weekly-Saturday membership.
export const STATUS_CONFIG = {
  weekly: { dueMaxDaysPast: 3 }, // overdue once ≥4 days past the completed Saturday (≈Wed)
  monthly: { dueMaxDaysPast: 6 },
  snapshotWeekly: { freshDays: 8, dueMaxDaysPast: 4 }, // weekly/snapshot_weekly cadence snapshots
  snapshotMonthly: { freshDays: 35, dueMaxDaysPast: 10 }, // monthly-cadence snapshots (e.g. S&S)
  eventDriven: { freshDays: 8, dueMaxDaysPast: 4 },
} as const

export const SECTION_ORDER = [
  'Sponsored Ads', 'Brand Analytics', 'Business Reports', 'Subscribe & Save',
  'Virtual Bundles', 'SmartScout', 'ScaleInsights',
]

// ── date helpers ─────────────────────────────────────────────────────────────
function utcDay(d: string): number {
  return new Date(d + 'T00:00:00Z').getUTCDay() // Sun=0 … Sat=6
}
// Most recent Saturday ≤ today (the completed Sun–Sat week end; itself if today is Sat).
function mostRecentSaturday(today: string): string {
  return addDays(today, -((utcDay(today) + 1) % 7))
}
// The Saturday ENDING the week containing d (itself when d is a Saturday).
function weekEndSaturday(d: string): string {
  return addDays(d, (6 - utcDay(d) + 7) % 7)
}
function prevMonthYM(today: string): string {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString().slice(0, 7)
}
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
function latestCoverageEnd(ends: CoverageEnd[]): string | null {
  return ends.reduce<string | null>((max, e) => (max === null || e.periodEnd > max ? e.periodEnd : max), null)
}
function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

// ── status ───────────────────────────────────────────────────────────────────
function recencyStatus(recency: string | null, today: string, cfg: { freshDays: number; dueMaxDaysPast: number }): TileStatus {
  if (!recency) return 'overdue'
  const daysSince = daysBetween(recency, today) // today − recency (negative if recency in the in-progress week)
  if (daysSince <= cfg.freshDays) return 'current'
  if (daysSince <= cfg.freshDays + cfg.dueMaxDaysPast) return 'due'
  return 'overdue'
}

// A missing Saturday interior to the covered range within the last n weeks.
function hasRecentHole(sats: Set<string>, expected: string, n: number): boolean {
  let seen = false
  const d = new Date(expected + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7 * (n - 1))
  for (let i = 0; i < n; i++) {
    const s = d.toISOString().slice(0, 10)
    if (sats.has(s)) seen = true
    else if (seen) return true
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return false
}

export function deriveStatus(p: {
  mode: CoverageMode | undefined // coverage data grain (COVERAGE_CONFIG); undefined for planned rows
  cadence: string // intended pull cadence — ad_hoc detection + snapshot freshness tuning
  isActive: boolean
  eventDriven: boolean
  coverageEnds: CoverageEnd[]
  lastUploadAt: string | null
  today: string
}): TileStatus {
  if (!p.isActive) return 'planned'
  if (p.cadence === 'ad_hoc') return 'ad_hoc'

  const latestEnd = latestCoverageEnd(p.coverageEnds)

  // Event-driven: recency only, gaps ignored (quiet weeks are normal).
  if (p.eventDriven) {
    const recency = maxIso(p.lastUploadAt ? p.lastUploadAt.slice(0, 10) : null, latestEnd)
    return recencyStatus(recency, p.today, STATUS_CONFIG.eventDriven)
  }

  if (p.mode === 'monthly') {
    const ym = prevMonthYM(p.today)
    if (p.coverageEnds.some(e => e.periodEnd.slice(0, 7) === ym)) return 'current'
    const daysPast = daysBetween(lastDayOfMonth(ym), p.today)
    return daysPast <= STATUS_CONFIG.monthly.dueMaxDaysPast ? 'due' : 'overdue'
  }

  if (p.mode === 'snapshot') {
    // Snapshots don't land on fixed anchors — freshness of the latest snapshot vs the
    // intended cadence (monthly-cadence snapshots like S&S tolerate a longer gap).
    const cfg = p.cadence === 'monthly' ? STATUS_CONFIG.snapshotMonthly : STATUS_CONFIG.snapshotWeekly
    return recencyStatus(latestEnd, p.today, cfg)
  }

  // weekly mode (default): the completed Saturday must be covered, no interior hole.
  const expected = mostRecentSaturday(p.today)
  const sats = new Set(p.coverageEnds.filter(e => e.periodType === 'weekly').map(e => e.periodEnd))
  if (!sats.has(expected)) {
    const daysPast = daysBetween(expected, p.today)
    return daysPast <= STATUS_CONFIG.weekly.dueMaxDaysPast ? 'due' : 'overdue'
  }
  if (hasRecentHole(sats, expected, 8)) return 'overdue'
  return 'current'
}

// ── strip ────────────────────────────────────────────────────────────────────
function monthlyStrip(coverageEnds: CoverageEnd[], eventDriven: boolean, today: string, n: number): StripCell[] {
  const months = new Set(coverageEnds.map(e => e.periodEnd.slice(0, 7)))
  const missing: StripCellState = eventDriven ? 'neutral' : 'gap'
  const [y, m] = prevMonthYM(today).split('-').map(Number)
  const cells: StripCell[] = []
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1))
    const ym = dt.toISOString().slice(0, 7)
    const end = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    cells.push({ periodEnd: end, label: ym, state: months.has(ym) ? 'filled' : missing })
  }
  return cells
}

export function buildStrip(p: {
  mode: CoverageMode
  eventDriven: boolean
  coverageEnds: CoverageEnd[]
  today: string
  n?: number
}): StripCell[] {
  const n = p.n ?? 8
  if (p.mode === 'monthly') return monthlyStrip(p.coverageEnds, p.eventDriven, p.today, n)

  // week-based (weekly / snapshot / event-driven weekly)
  const covered = new Set<string>()
  for (const e of p.coverageEnds) {
    covered.add(e.periodType === 'weekly' ? e.periodEnd : weekEndSaturday(e.periodEnd))
  }
  const missing: StripCellState = p.eventDriven || p.mode === 'snapshot' ? 'neutral' : 'gap'
  const cells: StripCell[] = []
  const d = new Date(mostRecentSaturday(p.today) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7 * (n - 1))
  for (let i = 0; i < n; i++) {
    const s = d.toISOString().slice(0, 10)
    cells.push({ periodEnd: s, label: `W/E ${s}`, state: covered.has(s) ? 'filled' : missing })
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return cells
}

// ── sections ─────────────────────────────────────────────────────────────────
function sectionRank(g: string): number {
  const i = SECTION_ORDER.indexOf(g)
  return i < 0 ? SECTION_ORDER.length : i
}

export function assembleCommandCenter(tiles: TileVM[], today: string): CommandCenterVM {
  const planned = tiles.filter(t => t.status === 'planned')
  const active = tiles.filter(t => t.status !== 'planned')

  const byGroup = new Map<string, TileVM[]>()
  for (const t of active) {
    const list = byGroup.get(t.sourceGroup)
    if (list) list.push(t)
    else byGroup.set(t.sourceGroup, [t])
  }

  const sections: SectionVM[] = [...byGroup.keys()]
    .sort((a, b) => sectionRank(a) - sectionRank(b))
    .map(g => {
      const ts = byGroup.get(g)!.slice().sort((a, b) => a.sortOrder - b.sortOrder)
      return { sourceGroup: g, tiles: ts, current: ts.filter(t => t.status === 'current').length, total: ts.length }
    })

  return {
    sections,
    planned,
    header: {
      current: active.filter(t => t.status === 'current').length,
      due: active.filter(t => t.status === 'due').length,
      overdue: active.filter(t => t.status === 'overdue').length,
      total: active.length,
      weekLabel: `W/E ${mostRecentSaturday(today)}`,
    },
  }
}
