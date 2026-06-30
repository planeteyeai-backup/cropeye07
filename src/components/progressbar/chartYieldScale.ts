/** Piecewise yield → chart Y: 0→0%, 75→50%, 85→75%, 100→100%. */
export const YIELD_CHART_ANCHORS = [
  { tons: 0, chartY: 0 },
  { tons: 75, chartY: 0.5 },
  { tons: 85, chartY: 0.75 },
  { tons: 100, chartY: 1 },
] as const;

export const YIELD_TICK_MAP: Record<number, string> = {
  0: '0',
  0.5: '75',
  0.75: '85',
  1: '100',
};

export const CHART_Y_TICKS = [0, 0.5, 0.75, 1] as const;
export const CHART_Y_DOMAIN: [number, number] = [0, 1];

/** Keep range bubbles inside plot — ~28px radius on a ~400px plot. */
export const RANGE_BUBBLE_Y_PAD = 0.08;

export function clampRangeBubbleChartY(chartY: number, avgTons?: number): number {
  if (avgTons != null && avgTons > 0 && avgTons < 75) {
    return Math.max(chartY, 0.01);
  }
  return Math.max(RANGE_BUBBLE_Y_PAD, Math.min(1 - RANGE_BUBBLE_Y_PAD, chartY));
}

export const YIELD_ZONE_BANDS = [
  { label: '0 – 75 ton', y1: 0, y2: 0.5, fill: '#FEF3C7' },
  { label: '75 – 85 ton', y1: 0.5, y2: 0.75, fill: '#DBEAFE' },
  { label: '85 – 100 ton', y1: 0.75, y2: 1, fill: '#D1FAE5' },
] as const;

export type YieldZoneBand = (typeof YIELD_ZONE_BANDS)[number];

export const YIELD_ZONE_BOUNDARIES = new Set([75, 85, 100]);

export function tonsToChartY(tons: number): number {
  if (tons <= 0) return 0;
  if (tons >= 100) return 1;

  for (let i = 1; i < YIELD_CHART_ANCHORS.length; i += 1) {
    const prev = YIELD_CHART_ANCHORS[i - 1];
    const next = YIELD_CHART_ANCHORS[i];
    if (tons <= next.tons) {
      const span = next.tons - prev.tons;
      if (span === 0) return next.chartY;
      const ratio = (tons - prev.tons) / span;
      return prev.chartY + ratio * (next.chartY - prev.chartY);
    }
  }

  return 1;
}

/** Grid + axis labels (ton values mapped to piecewise chart Y). */
export const YIELD_GRID_LINES = [0, 25, 50, 75, 80, 85, 90, 95, 100].map((tons) => ({
  tons,
  chartY: tonsToChartY(tons),
}));

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
