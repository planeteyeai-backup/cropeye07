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
