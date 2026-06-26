import {
  MONTH_SECTIONS,
  getLocalWeekNumber,
  getMonthRangeForWeek,
  type MonthSectionLabel,
} from './progressConstants';

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
  const { plantationDate, yieldReadings = [], baseYield = 2 } = options;
  const plantation = parsePlantationDate(plantationDate);

  const sortedAll = [...yieldReadings]
    .filter((reading) => reading?.date && Number.isFinite(Number(reading.yield)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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

    const fallbackYield = baseYield + globalWeek * 0.08;

    return {
      id: `${farmerId}-w${globalWeek + 1}`,
      day: getLocalWeekNumber(globalWeek),
      date: formatTimelineDate(weekStart),
      monthRange: getMonthRangeForWeek(globalWeek),
      yield: `${Number(fallbackYield).toFixed(1)} T/acre`,
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

  const sortedAll = [...yieldReadings]
    .filter((reading) => reading?.date && Number.isFinite(Number(reading.yield)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const plantation = parsePlantationDate(plantationDate);

  if (sortedAll.length > 0) {
    const latestReading = sortedAll[sortedAll.length - 1];
    return [
      readingToNode(farmerId, 0, latestReading, 0, plantation, true),
    ];
  }

  if (hasYieldData !== false && tons != null && Number.isFinite(tons) && tons > 0) {
    const fallbackDate = yieldDate ?? plantationDate;
    if (fallbackDate) {
      return [
        readingToNode(
          farmerId,
          0,
          { yield: tons, date: fallbackDate },
          0,
          plantation,
          true,
        ),
      ];
    }
  }

  // Same weekly timeline as History — show the latest past week (e.g. 4.8 T/acre).
  const weeklyNodes = buildAllWeeklyTimelineNodes(farmerId, {
    plantationDate,
    yieldReadings,
    baseYield,
  });
  const pastNodes = weeklyNodes.filter((node) => isPastTimelineDate(node.date));
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
