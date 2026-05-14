/**
 * Hardcoded monthly targets for FY2026.
 * Source of truth: INB-10 description ("Monthly targets hardcoded").
 *
 * Used by goal-rail variance/pacing computations. Update here when targets change.
 */

export type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const SALES_TARGETS_2026: Record<MonthIndex, number> = {
  0:  1_971_947, // Jan
  1:  1_838_184, // Feb
  2:  2_044_145, // Mar
  3:  2_066_521, // Apr
  4:  2_136_627, // May
  5:  2_176_608, // Jun
  6:  2_498_316, // Jul
  7:  2_301_749, // Aug
  8:  2_303_883, // Sep
  9:  2_374_265, // Oct
  10: 2_427_553, // Nov
  11: 2_489_095, // Dec
};

export const PPC_SPEND_TARGETS_2026: Record<MonthIndex, number> = {
  0:  167_227,
  1:  155_521,
  2:  166_408,
  3:  169_736,
  4:  176_525,
  5:  185_352,
  6:  213_155,
  7:  191_839,
  8:  192_798,
  9:  196_654,
  10: 202_554,
  11: 208_630,
};

/** ROAS target by month — the spec gives a 3.20–3.40 range; using midpoint where unspecified */
export const ROAS_TARGETS_2026: Record<MonthIndex, number> = {
  0: 3.20, 1: 3.20, 2: 3.40, 3: 3.30, 4: 3.30, 5: 3.30,
  6: 3.40, 7: 3.30, 8: 3.30, 9: 3.30, 10: 3.40, 11: 3.40,
};

export const NTB_TARGETS_2026: Record<MonthIndex, number> = {
  0:  20_071,
  1:  18_812,
  2:  19_848,
  3:  20_198,
  4:  20_863,
  5:  21_713,
  6:  24_970,
  7:  22_361,
  8:  22_498,
  9:  23_097,
  10: 23_686,
  11: 24_291,
};

/** Constant year-round targets per Architecture Reference doc */
export const AOV_TARGET = 25.00;
export const CAC_TARGET = 11.00;
export const MER_TARGET = 9.00; // midpoint of 8.88–9.36 range

/** Annual roll-ups */
export const ANNUAL_REVENUE_TARGET = 26_628_893;
export const ANNUAL_PPC_SPEND_TARGET = 2_226_399;
export const ANNUAL_NTB_TARGET = 262_408;

/**
 * Pull a monthly target by year + month index. Returns null when out-of-range
 * (i.e. not 2026), so callers can render "—" without crashing.
 */
export function getMonthlyTarget(
  metric: 'sales' | 'spend' | 'roas' | 'ntb',
  year: number,
  monthIndex: MonthIndex
): number | null {
  if (year !== 2026) return null;
  switch (metric) {
    case 'sales': return SALES_TARGETS_2026[monthIndex];
    case 'spend': return PPC_SPEND_TARGETS_2026[monthIndex];
    case 'roas':  return ROAS_TARGETS_2026[monthIndex];
    case 'ntb':   return NTB_TARGETS_2026[monthIndex];
  }
}

/** All calendar months (year+monthIndex pairs) whose first day falls within [start, end]. */
export function monthsInRange(
  start: string,
  end: string,
): Array<{ year: number; monthIndex: MonthIndex }> {
  const startD = new Date(start + 'T00:00:00Z');
  const endD   = new Date(end   + 'T00:00:00Z');
  const result: Array<{ year: number; monthIndex: MonthIndex }> = [];
  const cur = new Date(Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth(), 1));
  while (cur <= endD) {
    result.push({ year: cur.getUTCFullYear(), monthIndex: cur.getUTCMonth() as MonthIndex });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return result;
}

/**
 * Sum an additive target (sales, spend, ntb) across every month in the range.
 * Months with no target defined (e.g. 2025 months before targets were set)
 * are skipped; returns null only when no month has a target.
 */
export function sumMonthlyTargets(
  months: Array<{ year: number; monthIndex: MonthIndex }>,
  metric: 'sales' | 'spend' | 'ntb',
): number | null {
  let sum = 0;
  let found = false;
  for (const m of months) {
    const t = getMonthlyTarget(metric, m.year, m.monthIndex);
    if (t !== null) { sum += t; found = true; }
  }
  return found ? sum : null;
}

/**
 * Spend-weighted blended ROAS target across multiple months.
 * Equivalent to implied_ppc_sales_target_sum / spend_target_sum — the correct
 * way to blend ratio targets without distorting by averaging.
 */
export function blendedRoasTarget(
  months: Array<{ year: number; monthIndex: MonthIndex }>,
): number | null {
  let numer = 0;
  let denom = 0;
  for (const m of months) {
    const r = getMonthlyTarget('roas',  m.year, m.monthIndex);
    const s = getMonthlyTarget('spend', m.year, m.monthIndex);
    if (r !== null && s !== null) { numer += r * s; denom += s; }
  }
  return denom > 0 ? numer / denom : null;
}
