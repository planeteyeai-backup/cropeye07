/** Valid display range for sugar yield (T/acre). */
export const YIELD_TON_MIN = 0;
export const YIELD_TON_MAX = 100;

export function isValidYieldTon(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n >= YIELD_TON_MIN && n <= YIELD_TON_MAX;
}

function isPastOrTodayDate(dateStr: string): boolean {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  parsed.setHours(0, 0, 0, 0);
  return parsed <= today;
}

function sortReadingsByDate(
  readings: { yield: number; date: string }[],
): { yield: number; date: string }[] {
  return [...readings]
    .filter(
      (reading) =>
        reading?.date &&
        isPastOrTodayDate(reading.date) &&
        Number.isFinite(Number(reading.yield)) &&
        !Number.isNaN(new Date(reading.date).getTime()),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** History / chart — drop invalid ton values only. */
export function sanitizeYieldReadings(
  readings: { yield: number; date: string }[] | undefined,
): { yield: number; date: string }[] {
  if (!readings?.length) return [];
  return sortReadingsByDate(readings).filter((reading) =>
    isValidYieldTon(reading.yield),
  );
}

/**
 * Latest valid SEF reading for charts / summaries — no spike filter.
 * Crop growth can jump week-to-week; charts need the newest industrial value.
 */
export function pickChartYieldReading(
  readings: { yield: number; date: string }[] | undefined | null,
): { yield: number; date: string } | null {
  const sorted = sortReadingsByDate(readings ?? []);
  if (sorted.length === 0) return null;

  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const val = Number(sorted[i].yield);
    if (!Number.isFinite(val) || val < YIELD_TON_MIN) continue;
    if (val > YIELD_TON_MAX) continue;
    return { yield: val, date: sorted[i].date };
  }

  return null;
}

/**
 * Latest SEF industrial reading to show on Live.
 * Walks newest → oldest; skips bad spikes (>100 T/acre or >2.5× prior reading).
 * Example: Jun 22 = 219 → skipped, Jun 19 = 33.4 used (matches API intent).
 */
export function pickLatestYieldReading(
  readings: { yield: number; date: string }[] | undefined | null,
): { yield: number; date: string } | null {
  const sorted = sortReadingsByDate(readings ?? []);
  if (sorted.length === 0) return null;

  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const current = sorted[i];
    const val = Number(current.yield);
    if (!Number.isFinite(val) || val < YIELD_TON_MIN) continue;
    if (val > YIELD_TON_MAX) continue;

    if (i > 0) {
      const prevVal = Number(sorted[i - 1].yield);
      if (prevVal > 0 && val > prevVal * 2.5) continue;
    }

    return { yield: val, date: current.date };
  }

  return null;
}
