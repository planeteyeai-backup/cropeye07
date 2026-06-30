import {
  MONTH_SECTIONS,
  getLocalWeekNumber,
  getMonthRangeForWeek,
  type MonthSectionLabel,
} from './progressConstants';
import {
  isValidYieldTon,
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

export function formatTimelineDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function parsePlantationDate(plantationDate?: string | null): Date {
  const base = plantationDate ? new Date(plantationDate) : new Date(DEFAULT_PLANTATION);
  base.setHours(0, 0, 0, 0);
  return base;
}

function globalWeekIndexFromReading(plantation: Date, readingDate: Date): number {
  const diffMs = readingDate.getTime() - plantation.getTime();
  return Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
}

function readingToNode(
  farmerId: string,
  sectionStartWeek: number,
  reading: YieldReading,
  index: number,
  plantation: Date,
  isLatest: boolean,
  isExpectedYield = false,
): SectionTimelineNode {
  const readingDate = new Date(reading.date);
  const globalWeek = globalWeekIndexFromReading(plantation, readingDate);

  return {
    id: `${farmerId}-api-${sectionStartWeek}-${reading.date}-${index}`,
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
 * History view: always 10 weekly dots for the selected month slot.
 * API readings are placed on the matching week only — no "latest yield" highlight
 * (that belongs in Live view).
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
  const plantation = parsePlantationDate(plantationDate);

  const sortedAll = sanitizeYieldReadings(yieldReadings);

  return Array.from({ length: sectionWeekCount }, (_, localIndex) => {
    const globalWeek = sectionStartWeek + localIndex;
    const weekStart = new Date(plantation);
    weekStart.setDate(plantation.getDate() + globalWeek * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const readingInWeek = sortedAll.find((reading) => {
      const readingDate = new Date(reading.date);
      if (Number.isNaN(readingDate.getTime())) return false;
      return readingDate >= weekStart && readingDate <= weekEnd;
    });

    if (readingInWeek) {
      return readingToNode(
        farmerId,
        sectionStartWeek,
        readingInWeek,
        localIndex,
        plantation,
        false,
      );
    }

    // No API reading for this week — keep the slot on the timeline but do not invent yield.
    return {
      id: `${farmerId}-w${globalWeek + 1}`,
      day: getLocalWeekNumber(globalWeek),
      date: formatTimelineDate(weekStart),
      monthRange: getMonthRangeForWeek(globalWeek),
      yield: '',
      callStatus: 'pending' as const,
      note: '',
      isFromApi: false,
      isLatest: false,
    };
  });
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

  const plantation = parsePlantationDate(plantationDate);

  const latestIndustrial = pickLatestYieldReading(yieldReadings);
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
      id: `${farmerId}-live-latest`,
      isLatest: true,
    },
  ];
}
