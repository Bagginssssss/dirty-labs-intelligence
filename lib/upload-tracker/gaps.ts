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

type GapGranularity = 'daily' | 'weekly' | 'monthly';

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function generateExpected(start: string, end: string, granularity: GapGranularity): string[] {
  const result: string[] = [];
  const endMs = new Date(end + 'T00:00:00Z').getTime();

  if (granularity === 'daily') {
    let cur = new Date(start + 'T00:00:00Z');
    while (cur.getTime() <= endMs) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (granularity === 'weekly') {
    // Anchor to min(sourceDates) day-of-week; step 7 days
    let cur = new Date(start + 'T00:00:00Z');
    while (cur.getTime() <= endMs) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } else {
    // monthly: first of every month; use year-month iteration, not 30d stepping
    const startD = new Date(start + 'T00:00:00Z');
    const endD = new Date(end + 'T00:00:00Z');
    let year = startD.getUTCFullYear();
    let month = startD.getUTCMonth();
    const endYear = endD.getUTCFullYear();
    const endMonth = endD.getUTCMonth();
    while (year < endYear || (year === endYear && month <= endMonth)) {
      result.push(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
  }

  return result;
}

function isConsecutive(prev: string, curr: string, granularity: GapGranularity): boolean {
  if (granularity === 'daily') {
    return new Date(curr + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime() === 86_400_000;
  }
  if (granularity === 'weekly') {
    return new Date(curr + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime() === 7 * 86_400_000;
  }
  // monthly: exactly one month apart
  const prevD = new Date(prev + 'T00:00:00Z');
  const currD = new Date(curr + 'T00:00:00Z');
  return (currD.getUTCFullYear() * 12 + currD.getUTCMonth()) - (prevD.getUTCFullYear() * 12 + prevD.getUTCMonth()) === 1;
}

function groupIntoRanges(missing: string[], granularity: GapGranularity): GapRange[] {
  if (missing.length === 0) return [];

  const ranges: GapRange[] = [];
  let rangeStart = missing[0];
  let rangeEnd = missing[0];

  for (let i = 1; i < missing.length; i++) {
    if (isConsecutive(missing[i - 1], missing[i], granularity)) {
      rangeEnd = missing[i];
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd, days: inclusiveDays(rangeStart, rangeEnd) });
      rangeStart = missing[i];
      rangeEnd = missing[i];
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd, days: inclusiveDays(rangeStart, rangeEnd) });
  return ranges;
}

export function detectGaps(
  entry: ReportRegistryEntry,
  sourceDates: string[],
): GapAnalysis {
  // Skip gap detection for:
  // - 'pending': not yet formalized, no expected cadence
  // - 'snapshot' / 'per_order': point-in-time or sparse by design
  // - pull_window_days === 'snapshot': no deterministic anchor (e.g. SmartScout monthly)
  // - 'weekly' granularity: source rows use period-end anchors (e.g. last day of the week)
  //   that vary by upload batch; the min(sourceDates) anchor strategy produces false positives
  //   (e.g. SQP and customer_loyalty historical monthly-aggregated uploads show mixed anchors)
  const skip =
    entry.cadence === 'pending' ||
    entry.granularity === 'snapshot' ||
    entry.granularity === 'per_order' ||
    entry.pull_window_days === 'snapshot' ||
    entry.granularity === 'weekly';

  if (sourceDates.length === 0) {
    return { withinWindow: [], historical: [], coverageStart: null, coverageEnd: null };
  }

  const sorted = [...sourceDates].sort();
  const coverageStart = sorted[0];
  const coverageEnd = sorted[sorted.length - 1];

  if (skip) {
    return { withinWindow: [], historical: [], coverageStart, coverageEnd };
  }

  const granularity = entry.granularity as GapGranularity;
  const expected = generateExpected(coverageStart, coverageEnd, granularity);
  const actualSet = new Set(sorted);
  const missing = expected.filter(d => !actualSet.has(d));
  const ranges = groupIntoRanges(missing, granularity);

  // Cutoff: gaps ending on or after (maxDate - pull_window_days) are withinWindow
  const cutoff = entry.pull_window_days === 'snapshot'
    ? null
    : addDays(coverageEnd, -(entry.pull_window_days as number));

  const withinWindow: GapRange[] = [];
  const historical: GapRange[] = [];

  for (const range of ranges) {
    if (cutoff !== null && range.end >= cutoff) {
      withinWindow.push(range);
    } else {
      historical.push(range);
    }
  }

  return { withinWindow, historical, coverageStart, coverageEnd };
}
