export const WEEKS_PER_SECTION = 10;
export const TOTAL_WEEKS = 40;

export const MONTH_SECTIONS = [
  { label: '1–3 months', start: 0, end: 9, count: WEEKS_PER_SECTION },
  { label: '4–6 months', start: 10, end: 19, count: WEEKS_PER_SECTION },
  { label: '7–9 months', start: 20, end: 29, count: WEEKS_PER_SECTION },
  { label: '10–12 months', start: 30, end: 39, count: WEEKS_PER_SECTION },
] as const;

export type MonthSectionLabel = (typeof MONTH_SECTIONS)[number]['label'];

export const DEFAULT_MONTH_SECTION: MonthSectionLabel = '1–3 months';

export const getMonthRangeForWeek = (weekIndex: number): MonthSectionLabel => {
  if (weekIndex < 10) return '1–3 months';
  if (weekIndex < 20) return '4–6 months';
  if (weekIndex < 30) return '7–9 months';
  return '10–12 months';
};

export const getSectionIndex = (label: MonthSectionLabel): number =>
  MONTH_SECTIONS.findIndex((s) => s.label === label);

export const getLocalWeekNumber = (globalWeekIndex: number): number =>
  (globalWeekIndex % WEEKS_PER_SECTION) + 1;

const DEFAULT_PLANTATION = '2025-01-15';

/** Open the month slot that contains the newest API yield reading. */
export function resolveLatestMonthSectionFromConfigs(
  configs: {
    plantationDate?: string | null;
    yieldReadings?: { date: string }[];
  }[],
): MonthSectionLabel {
  let latestMs = -1;
  let latestWeekIndex = 0;

  for (const cfg of configs) {
    const plantation = cfg.plantationDate
      ? new Date(cfg.plantationDate)
      : new Date(DEFAULT_PLANTATION);
    plantation.setHours(0, 0, 0, 0);

    for (const reading of cfg.yieldReadings ?? []) {
      const d = new Date(reading.date);
      if (Number.isNaN(d.getTime())) continue;
      const t = d.getTime();
      if (t > latestMs) {
        latestMs = t;
        latestWeekIndex = Math.max(
          0,
          Math.floor((t - plantation.getTime()) / (7 * 24 * 60 * 60 * 1000)),
        );
      }
    }
  }

  if (latestMs < 0) return DEFAULT_MONTH_SECTION;
  return getMonthRangeForWeek(latestWeekIndex);
}

export function resolveMonthSectionForOpen(
  configs: {
    farmerId: string;
    plantationDate?: string | null;
    yieldReadings?: { date: string }[];
  }[],
  options: {
    highlightFarmerId?: string;
    initialMonthSection?: MonthSectionLabel;
  } = {},
): MonthSectionLabel {
  const { highlightFarmerId, initialMonthSection = DEFAULT_MONTH_SECTION } =
    options;

  if (highlightFarmerId) {
    const cfg = configs.find((c) => c.farmerId === highlightFarmerId);
    if (cfg) {
      return resolveLatestMonthSectionFromConfigs([cfg]);
    }
  }

  if (
    initialMonthSection !== DEFAULT_MONTH_SECTION &&
    MONTH_SECTIONS.some((s) => s.label === initialMonthSection)
  ) {
    return initialMonthSection;
  }

  if (configs.length > 0) {
    return resolveLatestMonthSectionFromConfigs(configs);
  }

  return DEFAULT_MONTH_SECTION;
}
