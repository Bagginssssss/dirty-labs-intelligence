/**
 * Display formatters used across the V4 dashboard.
 * All numeric output is intended to be rendered in a monospace font.
 */

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtUSD(n: number, decimals: 0 | 2 = 0): string {
  return (decimals === 2 ? usd2 : usd0).format(n);
}

/** Compact USD: $1.95M, $186K, $24.26 */
export function fmtUSDCompact(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(decimals)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return usd0.format(n);
}

export function fmtInt(n: number): string {
  return int0.format(n);
}

export function fmtIntCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return int0.format(n);
}

/** -0.047 → "-4.7%". Always signed. */
export function fmtPctSigned(p: number, decimals = 1): string {
  const v = (p * 100).toFixed(decimals);
  return p > 0 ? `+${v}%` : `${v}%`;
}

/** 0.213 → "21.3%" */
export function fmtPct(p: number, decimals = 1): string {
  return `${(p * 100).toFixed(decimals)}%`;
}

export function fmtRoas(r: number | null): string {
  if (r === null || !isFinite(r)) return '—';
  return `${dec2.format(r)}x`;
}

/** Rank sentinel: 98 → "97+", per platform convention. */
export function fmtRank(r: number | null): string {
  if (r === null) return '—';
  if (r >= 98) return '97+';
  return `#${r}`;
}

/** Rank delta arrow: -6 (improved) → "↑6", +5 (worse) → "↓5", 0 → "→" */
export function fmtRankDelta(d: number): { text: string; tone: 'positive' | 'critical' | 'neutral' } {
  if (d === 0) return { text: '→', tone: 'neutral' };
  if (d < 0) return { text: `↑${Math.abs(d)}`, tone: 'positive' };
  return { text: `↓${d}`, tone: 'critical' };
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateLongFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function fmtDate(d: string | Date): string {
  return dateFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export function fmtDateLong(d: string | Date): string {
  return dateLongFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export function fmtAsOf(d: string | Date): string {
  return `as of ${fmtDate(d)}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
