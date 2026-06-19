import type { DistrictId } from './districts';
import type { MonthSectionLabel } from './progressConstants';

export interface ProgressNavTarget {
  districtId: DistrictId;
  monthSection: MonthSectionLabel;
  farmerId?: string;
  searchQuery?: string;
}

const STORAGE_KEY = 'cropeye_progress_nav';

export const setProgressNavTarget = (target: ProgressNavTarget): void => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
};

export const peekProgressNavTarget = (): ProgressNavTarget | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProgressNavTarget;
  } catch {
    return null;
  }
};

export const consumeProgressNavTarget = (): ProgressNavTarget | null => {
  const target = peekProgressNavTarget();
  if (target) sessionStorage.removeItem(STORAGE_KEY);
  return target;
};

export const PROGRESS_NAV_EVENT = 'cropeye:navigate-progress-dashboard';

export const requestProgressDashboardNav = (target: ProgressNavTarget): void => {
  setProgressNavTarget(target);
  window.dispatchEvent(new CustomEvent(PROGRESS_NAV_EVENT));
};
