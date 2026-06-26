import {
  WEEKS_PER_SECTION,
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

function sectionDateWindow(
  plantationDate: string | null | undefined,
  sectionStartWeek: number,
  sectionWeekCount: number,
): { start: Date; end: Date } {
  const base = parsePlantationDate(plantationDate);
  const start = new Date(base);
  start.setDate(base.getDate() + sectionStartWeek * 7);
  const end = new Date(base);
  end.setDate(base.getDate() + (sectionStartWeek + sectionWeekCount) * 7 - 1);
  end.setHours(23, 59, 59, 999);
  return { start, end };
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

/**
 * One dot per API yield reading in the selected month slot.
 * If the slot is empty but the farmer has API readings, show the latest reading
 * when it is the farmer's newest yield (so today's / latest yield is always visible).
 */
export function buildSectionTimelineNodes(
  farmerId: string,
  sectionStartWeek: number,
  sectionWeekCount: number,
  options: {
    plantationDate?: string | null;
    yieldReadings?: YieldReading[];
  } = {},
): SectionTimelineNode[] {
  const { plantationDate, yieldReadings = [] } = options;
  const plantation = parsePlantationDate(plantationDate);
  const { start: windowStart, end: windowEnd } = sectionDateWindow(
    plantationDate,
    sectionStartWeek,
    sectionWeekCount,
  );

  const sortedAll = [...yieldReadings]
    .filter((reading) => reading?.date && Number.isFinite(Number(reading.yield)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sortedAll.length === 0) return [];

  const latestReading = sortedAll[sortedAll.length - 1];
  const latestDate = new Date(latestReading.date);
  const latestInWindow =
    !Number.isNaN(latestDate.getTime()) &&
    latestDate >= windowStart &&
    latestDate <= windowEnd;

  const inSection = sortedAll.filter((reading) => {
    const readingDate = new Date(reading.date);
    if (Number.isNaN(readingDate.getTime())) return false;
    return readingDate >= windowStart && readingDate <= windowEnd;
  });

  if (inSection.length > 0) {
    const readings = inSection.slice(-WEEKS_PER_SECTION);
    return readings.map((reading, index) =>
      readingToNode(
        farmerId,
        sectionStartWeek,
        reading,
        index,
        plantation,
        latestReading != null &&
          reading.date === latestReading.date &&
          Number(reading.yield) === Number(latestReading.yield),
      ),
    );
  }

  // Farmer has yield data but none in this slot — show latest yield dot if it
  // belongs to this slot (user navigated to the right month range).
  if (latestInWindow) {
    return [
      readingToNode(
        farmerId,
        sectionStartWeek,
        latestReading,
        0,
        plantation,
        true,
      ),
    ];
  }

  return [];
}

export function sectionUsesApiReadings(nodes: SectionTimelineNode[]): boolean {
  return nodes.length > 0;
}

/**
 * Live view: one dot per farmer — newest API yield only.
 */
export function buildLiveTimelineNode(
  farmerId: string,
  options: {
    plantationDate?: string | null;
    yieldReadings?: YieldReading[];
  } = {},
): SectionTimelineNode[] {
  const { plantationDate, yieldReadings = [] } = options;
  const sortedAll = [...yieldReadings]
    .filter((reading) => reading?.date && Number.isFinite(Number(reading.yield)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sortedAll.length === 0) return [];

  const latestReading = sortedAll[sortedAll.length - 1];
  const plantation = parsePlantationDate(plantationDate);

  return [
    readingToNode(farmerId, 0, latestReading, 0, plantation, true),
  ];
}
