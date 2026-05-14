/**
 * Period parsing for the dashboard URL searchParam.
 *
 *   ?period=last_7d | last_30d | mtd | qtd | ytd
 *   ?period=2026-03                 (calendar month)
 *   ?period=2026-03-01:2026-03-31   (custom range)
 *   ?period=2026Q1                  (calendar quarter — ends at quarter-end or today)
 *
 * Defaults to last_30d when missing or unrecognized.
 */

export type PeriodKey =
  | 'last_7d'
  | 'last_30d'
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | string;

export type ResolvedPeriod = {
  key: PeriodKey;
  start: string;
  end: string;
  label: string;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
}

export function resolvePeriod(raw: string | undefined, today = new Date()): ResolvedPeriod {
  const key = (raw || 'last_30d').trim();

  if (key === 'last_7d') {
    const end = new Date(today);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    return { key, start: iso(start), end: iso(end), label: 'Last 7 days' };
  }

  if (key === 'last_30d') {
    const end = new Date(today);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    return { key, start: iso(start), end: iso(end), label: 'Last 30 days' };
  }

  if (key === 'mtd') {
    return {
      key,
      start: iso(startOfMonth(today)),
      end: iso(today),
      label: `${MONTHS[today.getUTCMonth()]} ${today.getUTCFullYear()} MTD`,
    };
  }

  if (key === 'qtd') {
    return {
      key,
      start: iso(startOfQuarter(today)),
      end: iso(today),
      label: `Q${Math.floor(today.getUTCMonth() / 3) + 1} ${today.getUTCFullYear()} QTD`,
    };
  }

  if (key === 'ytd') {
    return {
      key,
      start: `${today.getUTCFullYear()}-01-01`,
      end: iso(today),
      label: `${today.getUTCFullYear()} YTD`,
    };
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(key);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10) - 1;
    const startD = new Date(Date.UTC(year, month, 1));
    const endD = endOfMonth(startD);
    return { key, start: iso(startD), end: iso(endD), label: `${MONTHS[month]} ${year}` };
  }

  const quarterMatch = /^(\d{4})Q([1-4])$/.exec(key);
  if (quarterMatch) {
    const year  = parseInt(quarterMatch[1], 10);
    const q     = parseInt(quarterMatch[2], 10);
    const startMonth = (q - 1) * 3;
    const startD     = new Date(Date.UTC(year, startMonth, 1));
    const fullEndD   = new Date(Date.UTC(year, startMonth + 3, 0));
    const partial    = fullEndD > today;
    const endD       = partial ? new Date(today) : fullEndD;
    return {
      key,
      start: iso(startD),
      end:   iso(endD),
      label: `Q${q} ${year}${partial ? ' (so far)' : ''}`,
    };
  }

  const rangeMatch = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (rangeMatch) {
    return { key, start: rangeMatch[1], end: rangeMatch[2], label: `${rangeMatch[1]} → ${rangeMatch[2]}` };
  }

  // Fallback
  const end = new Date(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 29);
  return { key: 'last_30d', start: iso(start), end: iso(end), label: 'Last 30 days' };
}

export type PeriodPreset = {
  key: PeriodKey;
  label: string;
  /** 'quarter' presets are rendered in a separate section of the picker */
  group?: 'quarter';
  /** True when the period is in-progress and data is incomplete */
  partial?: boolean;
  /** Short warning shown next to the preset label in the picker */
  coverageWarning?: string;
};

/**
 * Compute the natural prior period for CVR/Buy Box comparison.
 *
 * business_report stores one row per ASIN per month (report_date = 1st of month),
 * so the prior window must align to month/quarter boundaries or the row falls
 * outside BETWEEN range queries.
 *
 * - Full calendar month  → previous calendar month  (Mar → Feb)
 * - Full calendar quarter → previous calendar quarter (Q1 → Q4)
 * - Anything else         → same-length window immediately preceding
 */
export function priorPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastOfMonth = (y: number, m: number) =>          // m = 1-indexed
    new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  // ── Calendar month ──────────────────────────────────────────────────────────
  // start = YYYY-MM-01 AND end = last day of that same month
  if (period.start.slice(8) === '01') {
    const y = parseInt(period.start.slice(0, 4), 10);
    const m = parseInt(period.start.slice(5, 7), 10); // 1-indexed
    if (period.end === lastOfMonth(y, m)) {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12    : m - 1;
      return {
        key:   `prior:${period.key}`,
        start: `${py}-${pad(pm)}-01`,
        end:   lastOfMonth(py, pm),
        label: `${MONTHS[pm - 1]} ${py}`,
      };
    }
  }

  // ── Calendar quarter ────────────────────────────────────────────────────────
  // start = first day of a quarter AND end = last day of the same quarter
  const Q_STARTS = ['01-01', '04-01', '07-01', '10-01'] as const;
  const Q_ENDS   = ['03-31', '06-30', '09-30', '12-31'] as const;
  const qi = Q_STARTS.indexOf(period.start.slice(5) as typeof Q_STARTS[number]);
  if (qi !== -1
    && period.end.slice(5)   === Q_ENDS[qi]
    && period.end.slice(0, 4) === period.start.slice(0, 4)
  ) {
    const y  = parseInt(period.start.slice(0, 4), 10);
    const q  = qi + 1; // 1-indexed
    const py = q === 1 ? y - 1 : y;
    const pq = q === 1 ? 4     : q - 1;
    const pStartMonth = (pq - 1) * 3 + 1;           // 1-indexed month
    return {
      key:   `prior:${period.key}`,
      start: `${py}-${pad(pStartMonth)}-01`,
      end:   lastOfMonth(py, pStartMonth + 2),       // last day of 3rd month of pq
      label: `Q${pq} ${py}`,
    };
  }

  // ── Arbitrary range: same-length window ────────────────────────────────────
  const startMs    = new Date(period.start + 'T00:00:00Z').getTime();
  const endMs      = new Date(period.end   + 'T00:00:00Z').getTime();
  const priorEndMs   = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (endMs - startMs);
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    key:   `prior:${period.key}`,
    start: toIso(priorStartMs),
    end:   toIso(priorEndMs),
    label: `Prior ${period.label}`,
  };
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  { key: 'last_7d',  label: 'Last 7d' },
  { key: 'last_30d', label: 'Last 30d' },
  { key: 'mtd',      label: 'MTD' },
  { key: '2026-01',  label: 'Jan 2026' },
  { key: '2026-02',  label: 'Feb 2026' },
  { key: '2026-03',  label: 'Mar 2026' },
  { key: '2026-04',  label: 'Apr 2026' },
  // Quarters
  { key: '2025Q4',  label: 'Q4 2025',         group: 'quarter', coverageWarning: 'SB/SBV limited; SQP partial' },
  { key: '2026Q1',  label: 'Q1 2026',         group: 'quarter' },
  { key: '2026Q2',  label: 'Q2 2026 (so far)', group: 'quarter', partial: true },
];
