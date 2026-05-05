/**
 * Period parsing for the dashboard URL searchParam.
 *
 *   ?period=last_7d | last_30d | mtd | qtd | ytd
 *   ?period=2026-03                 (calendar month)
 *   ?period=2026-03-01:2026-03-31   (custom range)
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

export const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: 'last_7d', label: 'Last 7d' },
  { key: 'last_30d', label: 'Last 30d' },
  { key: 'mtd', label: 'MTD' },
  { key: '2026-01', label: 'Jan 2026' },
  { key: '2026-02', label: 'Feb 2026' },
  { key: '2026-03', label: 'Mar 2026' },
];
