import type { DistrictId } from './districts';

export const YIELD_TARGET_TON = 75;
export const TOTAL_WEEKS = 13;

export type WeekCallStatus = 'yes' | 'no' | 'pending';

export interface FarmerProgressConfig {
  farmerId: string;
  farmerName: string;
  tons: number;
  /** 0-based index of the last completed growth week */
  completedUpTo: number;
  baseYield: number;
  /** 0-based week indices where the farmer reached the week but call was not taken */
  missedCallWeeks?: number[];
}

export const DISTRICT_PROGRESS: Record<DistrictId, FarmerProgressConfig[]> = {
  kalburagi: [
    { farmerId: 'k1', farmerName: 'Farmer 1', tons: 100, completedUpTo: 12, baseYield: 2.5 },
    { farmerId: 'k2', farmerName: 'Farmer 2', tons: 85, completedUpTo: 5, baseYield: 2.2, missedCallWeeks: [4] },
    { farmerId: 'k3', farmerName: 'Farmer 3', tons: 75, completedUpTo: 8, baseYield: 2.4, missedCallWeeks: [6] },
  ],
  vijayapura: [
    { farmerId: 'v1', farmerName: 'Farmer 1', tons: 95, completedUpTo: 10, baseYield: 2.3 },
    { farmerId: 'v2', farmerName: 'Farmer 2', tons: 80, completedUpTo: 7, baseYield: 2.6, missedCallWeeks: [5] },
    { farmerId: 'v3', farmerName: 'Farmer 3', tons: 70, completedUpTo: 4, baseYield: 2.1 },
  ],
  bagalkot: [
    { farmerId: 'b1', farmerName: 'Farmer 1', tons: 105, completedUpTo: 11, baseYield: 2.7 },
    { farmerId: 'b2', farmerName: 'Farmer 2', tons: 88, completedUpTo: 6, baseYield: 2.4, missedCallWeeks: [3] },
    { farmerId: 'b3', farmerName: 'Farmer 3', tons: 78, completedUpTo: 9, baseYield: 2.5 },
  ],
  mandya: [
    { farmerId: 'm1', farmerName: 'Farmer 1', tons: 98, completedUpTo: 9, baseYield: 2.8 },
    { farmerId: 'm2', farmerName: 'Farmer 2', tons: 72, completedUpTo: 3, baseYield: 2.0, missedCallWeeks: [2] },
    { farmerId: 'm3', farmerName: 'Farmer 3', tons: 82, completedUpTo: 12, baseYield: 2.9 },
  ],
};

export const buildWeeklyCallStatus = (config: FarmerProgressConfig): WeekCallStatus[] =>
  Array.from({ length: TOTAL_WEEKS }, (_, weekIndex) => {
    if (weekIndex > config.completedUpTo) return 'pending';
    if (config.missedCallWeeks?.includes(weekIndex)) return 'no';
    return 'yes';
  });

export const countCallsTaken = (statuses: WeekCallStatus[]): number =>
  statuses.filter((status) => status === 'yes').length;

export const getWeeksCompleted = (config: FarmerProgressConfig): number =>
  config.completedUpTo + 1;

export const getProgressShare = (config: FarmerProgressConfig): number =>
  Math.round((getWeeksCompleted(config) / TOTAL_WEEKS) * 100);

export const getYieldGap = (tons: number): number => tons - YIELD_TARGET_TON;

export const isAboveTarget = (tons: number): boolean => tons >= YIELD_TARGET_TON;
