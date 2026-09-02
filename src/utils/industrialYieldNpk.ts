import type { YieldReading } from "../components/progressbar/industrialYieldTypes";
import { sanitizeYieldReadings } from "../components/progressbar/yieldReadingUtils";

/** Nutrient demand per tonne of yield growth (kg nutrient / tonne cane). */
export const NPK_KG_PER_TONNE = {
  N: 2.5,
  P: 1,
  K: 3.5,
} as const;

export type IndustrialNpkResult = {
  N: number;
  P: number;
  K: number;
  /** Highest − lowest industrial yield spread used for NPK (T/acre). */
  yieldDiffTonPerAcre: number;
  monthlyMinYield: number;
  monthlyMaxYield: number;
  readingCount: number;
  /** Month label used for the spread, e.g. "Sep 2026". */
  periodLabel: string;
};

function parseDateOnly(iso: string): Date | null {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Industrial readings in the current calendar month. */
export function filterReadingsInMonth(
  readings: YieldReading[],
  refDate = new Date(),
): YieldReading[] {
  const sorted = sanitizeYieldReadings(readings);
  const month = refDate.getMonth();
  const year = refDate.getFullYear();
  return sorted.filter((r) => {
    const d = parseDateOnly(r.date);
    return d && d.getMonth() === month && d.getFullYear() === year;
  });
}

/**
 * Monthly yield spread for NPK: highest − lowest industrial yield in the month.
 */
export function computeMonthlyYieldDiff(
  readings: YieldReading[],
  refDate = new Date(),
): { diff: number; min: number; max: number; count: number } {
  const inMonth = filterReadingsInMonth(readings, refDate);
  if (!inMonth.length) {
    return { diff: 0, min: 0, max: 0, count: 0 };
  }
  const yields = inMonth.map((r) => r.yield);
  const min = Math.min(...yields);
  const max = Math.max(...yields);
  return {
    diff: Math.max(0, max - min),
    min,
    max,
    count: inMonth.length,
  };
}

/**
 * Last 7 days: growth from earliest to latest reading (≥ ~4 day span when enough points).
 */
export function computeWeeklyYieldGrowth(readings: YieldReading[]): number {
  const sorted = sanitizeYieldReadings(readings);
  if (sorted.length < 2) return 0;

  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  const inWeek = sorted.filter((r) => {
    const d = parseDateOnly(r.date);
    return d && d >= weekAgo && d <= now;
  });
  if (inWeek.length < 2) return 0;

  const first = inWeek[0].yield;
  const last = inWeek[inWeek.length - 1].yield;
  return Math.max(0, last - first);
}

export function computeNpkFromYieldDiffTon(diffTonPerAcre: number): {
  N: number;
  P: number;
  K: number;
} {
  const d = Math.max(0, Number(diffTonPerAcre) || 0);
  return {
    N: NPK_KG_PER_TONNE.N * d,
    P: NPK_KG_PER_TONNE.P * d,
    K: NPK_KG_PER_TONNE.K * d,
  };
}

function formatMonthLabel(refDate: Date): string {
  return refDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Most recent calendar month (up to refDate) with ≥2 readings and positive spread. */
export function computeMostRecentMonthYieldDiff(
  readings: YieldReading[],
  refDate = new Date(),
): { diff: number; min: number; max: number; count: number; periodLabel: string } | null {
  const sorted = sanitizeYieldReadings(readings);
  if (sorted.length < 2) return null;

  const byMonth = new Map<string, YieldReading[]>();
  for (const reading of sorted) {
    const d = parseDateOnly(reading.date);
    if (!d || d > refDate) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byMonth.get(key) ?? [];
    bucket.push(reading);
    byMonth.set(key, bucket);
  }

  const monthKeys = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  for (const key of monthKeys) {
    const inMonth = byMonth.get(key) ?? [];
    if (inMonth.length < 2) continue;
    const yields = inMonth.map((r) => r.yield);
    const min = Math.min(...yields);
    const max = Math.max(...yields);
    const diff = Math.max(0, max - min);
    if (!(diff > 0)) continue;
    const [year, month] = key.split("-").map(Number);
    return {
      diff,
      min,
      max,
      count: inMonth.length,
      periodLabel: formatMonthLabel(new Date(year, month - 1, 1)),
    };
  }

  return null;
}

/** Prefer current-month max−min; then weekly growth; then latest month with enough readings. */
export function resolveYieldDiffForNpk(
  readings: YieldReading[],
  refDate = new Date(),
): { diff: number; min: number; max: number; count: number; periodLabel: string } {
  const monthly = computeMonthlyYieldDiff(readings, refDate);
  if (monthly.count >= 2 && monthly.diff > 0) {
    return { ...monthly, periodLabel: formatMonthLabel(refDate) };
  }

  const weekly = computeWeeklyYieldGrowth(readings);
  if (weekly > 0) {
    return {
      diff: weekly,
      min: 0,
      max: weekly,
      count: 1,
      periodLabel: "last 7 days",
    };
  }

  const recentMonth = computeMostRecentMonthYieldDiff(readings, refDate);
  if (recentMonth) return recentMonth;

  return { ...monthly, periodLabel: formatMonthLabel(refDate) };
}

export function computeIndustrialNpkFromReadings(
  readings: YieldReading[],
  refDate = new Date(),
): IndustrialNpkResult | null {
  const { diff, min, max, count, periodLabel } = resolveYieldDiffForNpk(
    readings,
    refDate,
  );
  if (!(diff > 0)) return null;
  const npk = computeNpkFromYieldDiffTon(diff);
  return {
    ...npk,
    yieldDiffTonPerAcre: diff,
    monthlyMinYield: min,
    monthlyMaxYield: max,
    readingCount: count,
    periodLabel,
  };
}
