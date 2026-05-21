import { ReportRegistryEntry } from './registry';

export type GapRange = {
  start: string;
  end: string;
  days: number;
};

export type GapAnalysis = {
  withinWindow: GapRange[];
  historical: GapRange[];
  coverageStart: string | null;
  coverageEnd: string | null;
};

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000,
  );
}

// ─── Daily gap detection ───────────────────────────────────────────────────────

function detectDailyGaps(sorted: string[]): GapRange[] {
  const actualSet = new Set(sorted);
  const endMs = new Date(sorted[sorted.length - 1] + 'T00:00:00Z').getTime();
  const missing: string[] = [];
  let cur = new Date(sorted[0] + 'T00:00:00Z');
  while (cur.getTime() <= endMs) {
    const d = cur.toISOString().slice(0, 10);
    if (!actualSet.has(d)) missing.push(d);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  if (missing.length === 0) return [];

  const ranges: GapRange[] = [];
  let start = missing[0];
  let end = missing[0];
  for (let i = 1; i < missing.length; i++) {
    if (daysBetween(missing[i - 1], missing[i]) === 1) {
      end = missing[i];
    } else {
      ranges.push({ start, end, days: inclusiveDays(start, end) });
      start = missing[i];
      end = missing[i];
    }
  }
  ranges.push({ start, end, days: inclusiveDays(start, end) });
  return ranges;
}

// ─── Monthly gap detection ─────────────────────────────────────────────────────
//
// Uses year-month matching rather than exact date comparison, so anchors at
// the start, middle, or end of the month all count as "that month present."
// Missing months are returned as full-month GapRanges (YYYY-MM-01 → last day).

function detectMissingMonthlyRanges(sorted: string[]): GapRange[] {
  if (sorted.length === 0) return [];

  const presentYMs = new Set(sorted.map(d => d.slice(0, 7)));
  const [sy, sm] = sorted[0].slice(0, 7).split('-').map(Number);
  const [ey, em] = sorted[sorted.length - 1].slice(0, 7).split('-').map(Number);

  const allYMs: string[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    allYMs.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }

  const missingYMs = allYMs.filter(ym => !presentYMs.has(ym));
  if (missingYMs.length === 0) return [];

  const ranges: GapRange[] = [];
  let blockStart = missingYMs[0];
  let blockEnd = missingYMs[0];

  for (let i = 1; i < missingYMs.length; i++) {
    const [py, pm] = missingYMs[i - 1].split('-').map(Number);
    const [cy, cm] = missingYMs[i].split('-').map(Number);
    if (py * 12 + pm + 1 === cy * 12 + cm) {
      blockEnd = missingYMs[i];
    } else {
      ranges.push(monthRangeFromYMs(blockStart, blockEnd));
      blockStart = missingYMs[i];
      blockEnd = missingYMs[i];
    }
  }
  ranges.push(monthRangeFromYMs(blockStart, blockEnd));
  return ranges;
}

function monthRangeFromYMs(startYM: string, endYM: string): GapRange {
  const [ey, em] = endYM.split('-').map(Number);
  const start = `${startYM}-01`;
  // Date.UTC(year, month, 0) = last day of the previous month (month is 0-based + 1 = em)
  const end = new Date(Date.UTC(ey, em, 0)).toISOString().slice(0, 10);
  return { start, end, days: inclusiveDays(start, end) };
}

// ─── Weekly gap detection (with mixed-cadence support) ─────────────────────────
//
// SQP (and potentially future BA reports) have a mixed cadence: monthly
// historical rows (large inter-date gaps) followed by weekly rows (7-day gaps).
// The detector splits at the cutover and applies monthly detection to the
// historical section and weekly detection to the recent section.
//
// Cutover heuristic: the first date after the last inter-date gap > 14 days.
// All-weekly data (customer_loyalty, etc.) has cutover = 0 → pure weekly path.

function findWeeklyCutover(sorted: string[]): number {
  const MONTHLY_THRESHOLD = 14;
  let lastLargeGapEnd = -1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) > MONTHLY_THRESHOLD) {
      lastLargeGapEnd = i;
    }
  }
  return lastLargeGapEnd + 1; // 0 if all weekly; first weekly date's index otherwise
}

// Returns the week-end anchor dates that are MISSING from a pure-weekly sequence.
// Generates expected anchors at 7-day intervals from the first to the last date.
function missingWeekAnchors(sorted: string[]): string[] {
  if (sorted.length === 0) return [];
  const actualSet = new Set(sorted);
  const endMs = new Date(sorted[sorted.length - 1] + 'T00:00:00Z').getTime();
  const missing: string[] = [];
  let cur = new Date(sorted[0] + 'T00:00:00Z');
  while (cur.getTime() <= endMs) {
    const d = cur.toISOString().slice(0, 10);
    if (!actualSet.has(d)) missing.push(d);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return missing;
}

// Converts missing week-end anchors into GapRanges covering the full 7-day period.
// Each anchor is the LAST day of its period; the period starts anchor - 6 days.
// Consecutive missing anchors (7 days apart) are merged into a single range.
function groupWeeklyAnchorsIntoRanges(anchors: string[]): GapRange[] {
  if (anchors.length === 0) return [];
  const ranges: GapRange[] = [];
  let blockStart = anchors[0];
  let blockEnd = anchors[0];
  for (let i = 1; i < anchors.length; i++) {
    if (daysBetween(anchors[i - 1], anchors[i]) === 7) {
      blockEnd = anchors[i];
    } else {
      const start = addDays(blockStart, -6);
      ranges.push({ start, end: blockEnd, days: inclusiveDays(start, blockEnd) });
      blockStart = anchors[i];
      blockEnd = anchors[i];
    }
  }
  const start = addDays(blockStart, -6);
  ranges.push({ start, end: blockEnd, days: inclusiveDays(start, blockEnd) });
  return ranges;
}

function detectWeeklyGaps(sorted: string[]): GapRange[] {
  if (sorted.length < 2) return [];

  const cutoverIdx = findWeeklyCutover(sorted);
  const gaps: GapRange[] = [];

  // Monthly section: anything before the first weekly date
  if (cutoverIdx > 0) {
    const monthlySection = sorted.slice(0, cutoverIdx);
    gaps.push(...detectMissingMonthlyRanges(monthlySection));
  }

  // Weekly section: from the cutover date onward
  const weeklySection = sorted.slice(cutoverIdx);
  if (weeklySection.length >= 2) {
    const missing = missingWeekAnchors(weeklySection);
    gaps.push(...groupWeeklyAnchorsIntoRanges(missing));
  }

  return gaps;
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export function detectGaps(
  entry: ReportRegistryEntry,
  sourceDates: string[],
): GapAnalysis {
  // Skip gap detection for non-deterministic or point-in-time data:
  // - 'pending': no formalized cadence
  // - 'snapshot' / 'per_order': point-in-time or inherently sparse
  // - 'period_aggregate': each row covers a date range (e.g. S&S), not a single period
  // - pull_window_days === 'snapshot': no repeating pull cadence (e.g. SmartScout)
  const skip =
    entry.cadence === 'pending' ||
    entry.granularity === 'snapshot' ||
    entry.granularity === 'per_order' ||
    entry.granularity === 'period_aggregate' ||
    entry.pull_window_days === 'snapshot';

  if (sourceDates.length === 0) {
    return { withinWindow: [], historical: [], coverageStart: null, coverageEnd: null };
  }

  const sorted = [...sourceDates].sort();
  const coverageStart = sorted[0];
  const coverageEnd = sorted[sorted.length - 1];

  if (skip) {
    return { withinWindow: [], historical: [], coverageStart, coverageEnd };
  }

  let ranges: GapRange[] = [];
  if (entry.granularity === 'weekly') {
    ranges = detectWeeklyGaps(sorted);
  } else if (entry.granularity === 'monthly') {
    ranges = detectMissingMonthlyRanges(sorted);
  } else {
    // daily
    ranges = detectDailyGaps(sorted);
  }

  // Classify gaps as withinWindow (re-pull recommended) vs historical (backfill candidate).
  // Gaps whose end date falls within the last pull_window_days of coverage are withinWindow.
  const cutoff = addDays(coverageEnd, -(entry.pull_window_days as number));

  const withinWindow: GapRange[] = [];
  const historical: GapRange[] = [];

  for (const range of ranges) {
    if (range.end >= cutoff) {
      withinWindow.push(range);
    } else {
      historical.push(range);
    }
  }

  return { withinWindow, historical, coverageStart, coverageEnd };
}
