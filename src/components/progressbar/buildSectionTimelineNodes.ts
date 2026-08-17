import {
  MONTH_SECTIONS,
  getLocalWeekNumber,
  getMonthRangeForWeek,
  type MonthSectionLabel,
} from './progressConstants';
import {
  isValidYieldTon,
  pickChartYieldReading,
  pickLatestYieldReading,
  sanitizeYieldReadings,
  YIELD_TON_MAX,
} from './yieldReadingUtils';

export interface YieldReading {
  yield: number;
  date: string;
}

export interface SectionTimelineNode {
  id: string;
  day: number;
  date: string;
  monthRange: MonthSectionLabel;
  yield: string;
  callStatus: 'pending';
  note: string;
  isFromApi: boolean;
  isLatest: boolean;
  isExpectedYield?: boolean;
}

const DEFAULT_PLANTATION = '2025-01-15';

function resolvePlantationDate(
  plantationDate?: string | null,
  yieldReadings: YieldReading[] = [],
): Date {
  if (plantationDate) {
    const parsed = new Date(plantationDate);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }

  const sorted = sanitizeYieldReadings(yieldReadings);
  if (sorted.length > 0) {
    const fromYield = new Date(sorted[0].date);
    fromYield.setHours(0, 0, 0, 0);
    return fromYield;
  }

  const base = new Date(DEFAULT_PLANTATION);
  base.setHours(0, 0, 0, 0);
  return base;
}

export function formatTimelineDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function parsePlantationDate(
  plantationDate?: string | null,
  yieldReadings: YieldReading[] = [],
): Date {
  return resolvePlantationDate(plantationDate, yieldReadings);
}

function globalWeekIndexFromReading(plantation: Date, readingDate: Date): number {
  const diffMs = readingDate.getTime() - plantation.getTime();
  return Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
}

function readingToNode(
  _farmerId: string,
  _sectionStartWeek: number,
  reading: YieldReading,
  readingIndex: number,
  plantation: Date,
  isLatest: boolean,
  isExpectedYield = false,
): SectionTimelineNode {
  const readingDate = new Date(reading.date);
  const globalWeek = globalWeekIndexFromReading(plantation, readingDate);
  // Stable ids so Yes/No + notes survive live/history data refresh.
  // Farmer id is added later as nodeKey (`${farmerId}-${id}`).
  const id = isLatest
    ? `live-latest`
    : readingIndex > 0
      ? `w${globalWeek}-r${readingIndex}`
      : `w${globalWeek}`;

  return {
    id,
    day: getLocalWeekNumber(globalWeek),
    date: formatTimelineDate(readingDate),
    monthRange: getMonthRangeForWeek(globalWeek),
    yield: `${Number(reading.yield).toFixed(1)} T/acre`,
    callStatus: 'pending',
    note: '',
    isFromApi: true,
    isLatest,
    isExpectedYield,
  };
}

function isPastTimelineDate(dateLabel: string): boolean {
  const parsed = new Date(dateLabel);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  parsed.setHours(0, 0, 0, 0);
  return parsed <= today;
}

function buildAllWeeklyTimelineNodes(
  farmerId: string,
  options: {
    plantationDate?: string | null;
    yieldReadings?: YieldReading[];
    baseYield?: number;
  },
): SectionTimelineNode[] {
  return MONTH_SECTIONS.flatMap((section) =>
    buildSectionTimelineNodes(
      farmerId,
      section.start,
      section.count,
      options,
    ),
  );
}

/**
 * History view: only weeks that have a real API yield reading get a circle.
 * Empty weeks are omitted — no grey placeholder dots.
 * (Latest-yield highlight belongs in Live view.)
 */
export function buildSectionTimelineNodes(
  farmerId: string,
  sectionStartWeek: number,
  sectionWeekCount: number,
  options: {
    plantationDate?: string | null;
    yieldReadings?: YieldReading[];
    baseYield?: number;
  } = {},
): SectionTimelineNode[] {
  const { plantationDate, yieldReadings = [] } = options;
  const plantation = parsePlantationDate(plantationDate, yieldReadings);

  const sortedAll = sanitizeYieldReadings(yieldReadings);
  const nodes: SectionTimelineNode[] = [];

  for (let localIndex = 0; localIndex < sectionWeekCount; localIndex++) {
    const globalWeek = sectionStartWeek + localIndex;
    const weekStart = new Date(plantation);
    weekStart.setDate(plantation.getDate() + globalWeek * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // All readings that fall in this week (not just the first).
    const readingsInWeek = sortedAll.filter((reading) => {
      const readingDate = new Date(reading.date);
      if (Number.isNaN(readingDate.getTime())) return false;
      return readingDate >= weekStart && readingDate <= weekEnd;
    });

    readingsInWeek.forEach((reading, readingIndex) => {
      nodes.push(
        readingToNode(
          farmerId,
          sectionStartWeek,
          reading,
          readingIndex,
          plantation,
          false,
        ),
      );
    });
  }

  return nodes;
}

export function sectionUsesApiReadings(nodes: SectionTimelineNode[]): boolean {
  return nodes.length > 0;
}

/**
 * Live view: one dot per farmer — the newest yield (API reading or latest past week).
 */
export function buildLiveTimelineNode(
  farmerId: string,
  options: {
    plantationDate?: string | null;
    yieldReadings?: YieldReading[];
    baseYield?: number;
    tons?: number;
    yieldDate?: string | null;
    hasYieldData?: boolean;
  } = {},
): SectionTimelineNode[] {
  const {
    plantationDate,
    yieldReadings = [],
    baseYield = 2,
    tons,
    yieldDate,
    hasYieldData,
  } = options;

  const plantation = parsePlantationDate(plantationDate, yieldReadings);

  const latestIndustrial =
    pickLatestYieldReading(yieldReadings) ??
    pickChartYieldReading(yieldReadings);
  if (latestIndustrial) {
    return [
      readingToNode(
        farmerId,
        0,
        latestIndustrial,
        0,
        plantation,
        true,
        false,
      ),
    ];
  }

  if (
    hasYieldData !== false &&
    tons != null &&
    isValidYieldTon(tons)
  ) {
    const fallbackDate = yieldDate ?? plantationDate;
    if (fallbackDate) {
      return [
        readingToNode(
          farmerId,
          0,
          { yield: Math.min(tons, YIELD_TON_MAX), date: fallbackDate },
          0,
          plantation,
          true,
          false,
        ),
      ];
    }
  }

  // History-style weekly slots — only use weeks that have a real API reading.
  const weeklyNodes = buildAllWeeklyTimelineNodes(farmerId, {
    plantationDate,
    yieldReadings,
    baseYield,
  });
  const pastNodes = weeklyNodes.filter(
    (node) => isPastTimelineDate(node.date) && node.isFromApi,
  );
  if (pastNodes.length === 0) return [];

  const latestPast = pastNodes[pastNodes.length - 1];
  return [
    {
      ...latestPast,
      id: `live-latest`,
      isLatest: true,
    },
  ];
}
