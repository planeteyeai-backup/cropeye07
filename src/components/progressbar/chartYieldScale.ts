/** Grid ton marks — equal visual spacing between each line on the chart. */
export const YIELD_GRID_TON_MARKS = [
  0, 25, 50, 75, 80, 85, 90, 95, 100,
] as const;

/** @deprecated Equal-spacing grid replaces piecewise anchors. */
export const YIELD_CHART_ANCHORS = YIELD_GRID_TON_MARKS.map((tons, index) => ({
  tons,
  chartY: index / (YIELD_GRID_TON_MARKS.length - 1),
}));

export const CHART_Y_DOMAIN: [number, number] = [0, 1];

/** Keep range bubbles inside plot — ~28px radius on a ~400px plot. */
export const RANGE_BUBBLE_Y_PAD = 0.04;

export function clampRangeBubbleChartY(chartY: number, avgTons?: number): number {
  if (avgTons != null && avgTons > 0 && avgTons < 75) {
    return Math.max(chartY, 0.01);
  }
  return Math.max(RANGE_BUBBLE_Y_PAD, Math.min(1 - RANGE_BUBBLE_Y_PAD, chartY));
}

/** Map yield tons → chart Y with equal height between each grid line. */
export function tonsToChartY(tons: number): number {
  const marks = YIELD_GRID_TON_MARKS;
  if (tons <= 0) return 0;
  if (tons >= marks[marks.length - 1]) return 1;

  for (let i = 1; i < marks.length; i += 1) {
    const prevT = marks[i - 1];
    const nextT = marks[i];
    if (tons <= nextT) {
      const prevY = (i - 1) / (marks.length - 1);
      const nextY = i / (marks.length - 1);
      const span = nextT - prevT;
      const ratio = span === 0 ? 0 : (tons - prevT) / span;
      return prevY + ratio * (nextY - prevY);
    }
  }

  return 1;
}

export const YIELD_ZONE_BANDS = [
  {
    label: '0 – 75 ton',
    y1: tonsToChartY(0),
    y2: tonsToChartY(75),
    fill: '#FEF3C7',
  },
  {
    label: '75 – 85 ton',
    y1: tonsToChartY(75),
    y2: tonsToChartY(85),
    fill: '#DBEAFE',
  },
  {
    label: '85 – 100 ton',
    y1: tonsToChartY(85),
    y2: tonsToChartY(100),
    fill: '#D1FAE5',
  },
] as const;

export type YieldZoneBand = (typeof YIELD_ZONE_BANDS)[number];

export const YIELD_ZONE_BOUNDARIES = new Set([60, 70, 75, 85, 100]);

/** Lighter grid between major marks — helps read 50, 60, 70 ton bands. */
export const YIELD_MINOR_GRID_LINES = [10, 20, 30, 40, 60, 70].map((tons) => ({
  tons,
  chartY: tonsToChartY(tons),
}));

/** Extra-visible guides for common check points. */
export const YIELD_HIGHLIGHT_GRID_LINES = [60, 70].map((tons) => ({
  tons,
  chartY: tonsToChartY(tons),
}));

/** Quick filters — farmer list without changing 0–100 chart scale. */
export const YIELD_QUICK_FILTERS = [
  { id: 'under-75', label: 'Under 75 ton', min: 0, max: 75 },
  { id: '50-60', label: '50 – 60 ton', min: 50, max: 60 },
  { id: '60-70', label: '60 – 70 ton', min: 60, max: 70 },
  { id: '70-75', label: '70 – 75 ton', min: 70, max: 75 },
] as const;

export type YieldQuickFilter = (typeof YIELD_QUICK_FILTERS)[number];

/** Grid + axis labels (equal visual spacing per ton mark). */
export const YIELD_GRID_LINES = YIELD_GRID_TON_MARKS.map((tons, index) => ({
  tons,
  chartY: index / (YIELD_GRID_TON_MARKS.length - 1),
}));

export const CHART_Y_TICKS = YIELD_GRID_LINES.map((line) => line.chartY);

const CHART_DOMAIN_PAD = 0.035;

/** Zoom Y-axis to data so the 0–75 zone is not half-empty when all farmers are under target. */
export function getChartYDomainForData(maxTons: number): [number, number] {
  if (maxTons <= 0) return [0, tonsToChartY(75) + CHART_DOMAIN_PAD];
  if (maxTons <= 75) return [0, tonsToChartY(75) + CHART_DOMAIN_PAD];
  if (maxTons <= 85) return [0, tonsToChartY(85) + CHART_DOMAIN_PAD];
  if (maxTons <= 95) return [0, tonsToChartY(95) + CHART_DOMAIN_PAD];
  return [0, 1];
}

/** Denser grid in 0–75 when chart is zoomed to that band. */
export function getChartGridLinesForData(maxTons: number) {
  const tonMarks =
    maxTons <= 75
      ? [0, 10, 20, 25, 30, 40, 50, 60, 70, 75]
      : maxTons <= 85
        ? [0, 25, 50, 75, 80, 85]
        : [...YIELD_GRID_TON_MARKS];

  return tonMarks.map((tons) => ({
    tons,
    chartY: tonsToChartY(tons),
  }));
}

export function getChartZoneBandsForData(
  maxTons: number,
  domain: [number, number],
): Array<{ label: string; y1: number; y2: number; fill: string }> {
  if (maxTons <= 75) {
    return [{ label: '0 – 75 ton', y1: domain[0], y2: domain[1], fill: '#FEF3C7' }];
  }

  return YIELD_ZONE_BANDS.filter(
    (zone) => zone.y2 > domain[0] && zone.y1 < domain[1],
  ).map((zone) => ({
    ...zone,
    y1: Math.max(zone.y1, domain[0]),
    y2: Math.min(zone.y2, domain[1]),
  }));
}

/** Tighter horizontal padding when only a few yield-range columns are shown. */
export function getChartXDomain(rangeCount: number): [number, number] {
  if (rangeCount <= 1) return [-0.12, 0.12];
  if (rangeCount === 2) return [-0.18, 1.18];
  if (rangeCount === 3) return [-0.28, 2.28];
  return [-0.35, Math.max(0, rangeCount - 1) + 0.35];
}

export const YIELD_RANGES = [
  { id: '0-25', label: '0–25', min: 0, max: 25 },
  { id: '25-50', label: '25–50', min: 25, max: 50 },
  { id: '50-75', label: '50–75', min: 50, max: 75 },
  { id: '75-80', label: '75–80', min: 75, max: 80 },
  { id: '80-85', label: '80–85', min: 80, max: 85 },
  { id: '85-90', label: '85–90', min: 85, max: 90 },
  { id: '90-95', label: '90–95', min: 90, max: 95 },
  { id: '95-100', label: '95–100', min: 95, max: 100 },
] as const;

/** Fixed top labels on the progress bubble chart (always shown, clickable). */
export const CHART_TOP_RANGES = [
  { id: '0-25', label: '0-25', min: 0, max: 25 },
  { id: '25-50', label: '25-50', min: 25, max: 50 },
  { id: '50-75', label: '50-75', min: 50, max: 75 },
  { id: '75-85', label: '75-85', min: 75, max: 85 },
  { id: '85-100', label: '85-100', min: 85, max: 100 },
] as const;

export type ChartTopRange = (typeof CHART_TOP_RANGES)[number];

export type YieldRange = (typeof YIELD_RANGES)[number];

export function getYieldRangeIndex(tons: number): number {
  if (tons <= 25) return 0;
  if (tons <= 50) return 1;
  if (tons <= 75) return 2;
  if (tons <= 80) return 3;
  if (tons <= 85) return 4;
  if (tons <= 90) return 5;
  if (tons <= 95) return 6;
  return 7;
}

export interface YieldRangeGroup {
  rangeIndex: number;
  label: string;
  min: number;
  max: number;
  farmers: ChartBubbleLayoutInput[];
  count: number;
  avgTons: number;
  chartY: number;
  xPos: number;
}

export function groupFarmersByYieldRange(
  farmers: ChartBubbleLayoutInput[],
): YieldRangeGroup[] {
  return YIELD_RANGES.map((range, rangeIndex) => {
    const inRange = farmers.filter((farmer) => {
      const tons = farmer.tons;
      if (rangeIndex === 0) return tons >= 0 && tons <= range.max;
      return tons > range.min && tons <= range.max;
    });
    const avgTons =
      inRange.length > 0
        ? inRange.reduce((sum, f) => sum + f.tons, 0) / inRange.length
        : (range.min + range.max) / 2;

    return {
      rangeIndex,
      label: range.label,
      min: range.min,
      max: range.max,
      farmers: inRange,
      count: inRange.length,
      avgTons,
      chartY: clampRangeBubbleChartY(tonsToChartY(avgTons), avgTons),
      xPos: rangeIndex,
    };
  });
}

/** Group farmers into the five fixed chart columns (0-25 … 85-100). */
export function groupFarmersByChartTopRanges(
  farmers: ChartBubbleLayoutInput[],
): YieldRangeGroup[] {
  return CHART_TOP_RANGES.map((range, rangeIndex) => {
    const inRange = farmers.filter((farmer) => {
      const tons = farmer.tons;
      if (!farmer.hasYieldData || tons <= 0) return false;
      if (rangeIndex === 0) return tons > 0 && tons <= range.max;
      if (rangeIndex === CHART_TOP_RANGES.length - 1) {
        return tons > range.min && tons <= range.max;
      }
      return tons > range.min && tons <= range.max;
    });
    const avgTons =
      inRange.length > 0
        ? inRange.reduce((sum, farmer) => sum + farmer.tons, 0) / inRange.length
        : (range.min + range.max) / 2;

    return {
      rangeIndex,
      label: range.label,
      min: range.min,
      max: range.max,
      farmers: inRange,
      count: inRange.length,
      avgTons,
      chartY: clampRangeBubbleChartY(tonsToChartY(avgTons), avgTons),
      xPos: rangeIndex,
    };
  });
}

/** Normalize API date strings to YYYY-MM-DD for snapshot keys. */
export function normalizeYieldDateKey(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }
  const y = parsed.getFullYear();
  const mo = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * Latest yield on or before `asOfDate` (YYYY-MM-DD).
 * Returns null when the farmer had no reading by that date.
 */
export function yieldAsOfDate(
  readings: { yield: number; date: string }[] | null | undefined,
  asOfDate: string,
): { yield: number; date: string } | null {
  if (!readings?.length) return null;
  const asOf = normalizeYieldDateKey(asOfDate);
  if (!asOf) return null;

  let best: { yield: number; date: string; key: string } | null = null;
  for (const reading of readings) {
    const key = normalizeYieldDateKey(reading.date);
    if (!key || key > asOf) continue;
    const tons = Number(reading.yield);
    if (!Number.isFinite(tons) || tons <= 0) continue;
    if (!best || key > best.key) {
      best = { yield: tons, date: reading.date, key };
    }
  }
  return best ? { yield: best.yield, date: best.date } : null;
}

/** Unique yield reading dates across farmers, newest first (for Past dropdown). */
export function collectYieldSnapshotDates(
  farmers: Array<{ yieldReadings?: { yield: number; date: string }[] | null }>,
): string[] {
  const keys = new Set<string>();
  for (const farmer of farmers) {
    for (const reading of farmer.yieldReadings ?? []) {
      const key = normalizeYieldDateKey(reading.date);
      if (key) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}

export function formatYieldSnapshotLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Wider bins for few farmers; finer bins when API returns many records. */
export function pickDynamicBinSize(farmerCount: number): number {
  if (farmerCount <= 25) return 25;
  if (farmerCount <= 60) return 10;
  if (farmerCount <= 120) return 5;
  return 5;
}

function formatRangeLabel(min: number, max: number): string {
  if (max >= 100 && min >= 95) return '95–100';
  if (min === 0) return `0–${max}`;
  return `${min}–${max}`;
}

/** Only non-empty yield bins; x positions are consecutive (dynamic dot count). */
export function buildDynamicYieldRangeGroups(
  farmers: ChartBubbleLayoutInput[],
): YieldRangeGroup[] {
  const withYield = farmers.filter((farmer) => farmer.tons > 0);
  if (withYield.length === 0) return [];

  const binSize = pickDynamicBinSize(withYield.length);
  const maxYield = Math.min(
    100,
    Math.max(...withYield.map((farmer) => farmer.tons), 0),
  );
  const lastEdge = Math.min(100, Math.max(binSize, Math.ceil(maxYield / binSize) * binSize));

  const groups: YieldRangeGroup[] = [];
  let rangeIndex = 0;

  for (let min = 0; min < lastEdge; min += binSize) {
    const max = Math.min(min + binSize, 100);
    const inRange = withYield.filter((farmer) => {
      const tons = farmer.tons;
      if (min === 0) return tons > 0 && tons <= max;
      return tons > min && tons <= max;
    });

    if (inRange.length === 0) continue;

    const avgTons =
      inRange.reduce((sum, farmer) => sum + farmer.tons, 0) / inRange.length;

    groups.push({
      rangeIndex,
      label: formatRangeLabel(min, max),
      min,
      max,
      farmers: inRange,
      count: inRange.length,
      avgTons,
      chartY: clampRangeBubbleChartY(tonsToChartY(avgTons), avgTons),
      xPos: rangeIndex,
    });
    rangeIndex += 1;
  }

  return groups;
}

/** Fan out individual farmers horizontally around a range column on hover. */
export function layoutFarmersInRange(
  farmers: ChartBubbleLayoutInput[],
  rangeX: number,
): ChartBubbleLayoutPoint[] {
  const sorted = [...farmers].sort(
    (a, b) => a.tons - b.tons || a.farmerName.localeCompare(b.farmerName),
  );
  const span = Math.min(0.75, 0.12 + sorted.length * 0.035);

  return sorted.map((farmer, index) => {
    const xOffset =
      sorted.length === 1 ? 0 : (index / (sorted.length - 1) - 0.5) * span;
    return {
      ...farmer,
      chartY: tonsToChartY(farmer.tons),
      xPos: rangeX + xOffset,
    };
  });
}

function yieldBucketKey(tons: number): string {
  return (Math.round(tons * 2) / 2).toFixed(1);
}

export interface ChartBubbleLayoutInput {
  farmerId: string;
  farmerName: string;
  tons: number;
  hasYieldData: boolean;
}

export interface ChartBubbleLayoutPoint extends ChartBubbleLayoutInput {
  chartY: number;
  xPos: number;
}

/** Spread farmers with the same yield horizontally so dots stay visible. */
export function layoutChartBubbles(
  farmers: ChartBubbleLayoutInput[],
): ChartBubbleLayoutPoint[] {
  const sorted = [...farmers].sort(
    (a, b) => a.tons - b.tons || a.farmerName.localeCompare(b.farmerName),
  );

  const buckets = new Map<string, ChartBubbleLayoutInput[]>();
  for (const farmer of sorted) {
    const key = yieldBucketKey(farmer.tons);
    const group = buckets.get(key) ?? [];
    group.push(farmer);
    buckets.set(key, group);
  }

  const rows: ChartBubbleLayoutPoint[] = [];
  let xCursor = 0;
  const bucketGap = 3;

  for (const [key, group] of [...buckets.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const tons = Number(key);
    const baseChartY = tonsToChartY(tons);
    const jitterStep = group.length > 12 ? 0.004 : group.length > 4 ? 0.006 : 0;

    group.forEach((farmer, index) => {
      const jitterY = (index - (group.length - 1) / 2) * jitterStep;
      rows.push({
        ...farmer,
        chartY: Math.max(0, Math.min(1, baseChartY + jitterY)),
        xPos: xCursor + index,
      });
    });

    xCursor += group.length + bucketGap;
  }

  return rows;
}

export function chartWidthForBubbleCount(count: number): number {
  return Math.max(800, Math.min(3600, count * 18 + 140));
}
