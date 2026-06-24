/** Earth-toned palette for Crop Growth Progress UI */
export const PROGRESS_THEME = {
  active: '#166534',
  activeLight: '#DCFCE7',
  activeRing: '#166534',
  taskDone: '#22C55E',
  taskDoneRing: '#22C55E',
  taskNotDone: '#D97706',
  taskNotDoneRing: '#D97706',
  /** Past week — action not recorded yet (light professional blue) */
  pastNotRecorded: '#38BDF8',
  pastNotRecordedRing: '#7DD3FC',
  text: '#1E293B',
  textMuted: '#64748B',
  trackBg: '#E0F2FE',
  /** Green fill when action saved as Yes */
  trackFillFrom: '#166534',
  trackFillTo: '#22C55E',
} as const;

/** Bubble chart palette */
export const CHART_THEME = {
  grid: '#1E293B',
  gridMinor: '#475569',
  axis: '#0F172A',
  underTarget: '#166534',
  aboveTarget: '#64748B',
  zone75: '#D97706',
  zone85: '#2563EB',
  zone100: '#166534',
  text: '#1E293B',
  textMuted: '#64748B',
} as const;
