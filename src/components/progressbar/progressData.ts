// import type { DistrictId } from './districts';
import { TOTAL_WEEKS, WEEKS_PER_SECTION } from './progressConstants';

export const YIELD_TARGET_TON = 75;

export type WeekCallStatus = 'yes' | 'no' | 'pending';

export interface FarmerProgressConfig {
  farmerId: string;
  farmerName: string;
  tons: number;
  baseYield: number;
  plantationDate?: string | null;
  /** Weekly yield readings from SEF industrial_yield_by_owner_snapshot API. */
  yieldReadings?: { yield: number; date: string }[];
  /** Latest yield date from API (public-factory-farmers or industrial yield). */
  yieldDate?: string | null;
  /** False when API has no yield reading (shown at 0 on chart). */
  hasYieldData?: boolean;
  phoneNumber?: string | null;
  /** Action-recorded weeks per month section (max 10 each). */
  weeksDonePerSection: [number, number, number, number];
  /** Global 0-based week indices where action was "no". */
  missedCallWeeks?: number[];
}

// export const DISTRICT_PROGRESS: Record<DistrictId, FarmerProgressConfig[]> = {
//   kalburagi: [
//     {
//       farmerId: 'k1',
//       farmerName: 'Farmer 1',
//       tons: 100,
//       baseYield: 2.5,
//       weeksDonePerSection: [6, 0, 0, 0],
//     },
//     {
//       farmerId: 'k2',
//       farmerName: 'Farmer 2',
//       tons: 85,
//       baseYield: 2.2,
//       weeksDonePerSection: [4, 0, 0, 0],
//       missedCallWeeks: [3],
//     },
//     {
//       farmerId: 'k3',
//       farmerName: 'Farmer 3',
//       tons: 75,
//       baseYield: 2.4,
//       weeksDonePerSection: [5, 0, 0, 0],
//       missedCallWeeks: [4],
//     },
//   ],
//   vijayapura: [
//     {
//       farmerId: 'v1',
//       farmerName: 'Farmer 1',
//       tons: 95,
//       baseYield: 2.3,
//       weeksDonePerSection: [7, 0, 0, 0],
//     },
//     {
//       farmerId: 'v2',
//       farmerName: 'Farmer 2',
//       tons: 80,
//       baseYield: 2.6,
//       weeksDonePerSection: [5, 0, 0, 0],
//       missedCallWeeks: [4],
//     },
//     {
//       farmerId: 'v3',
//       farmerName: 'Farmer 3',
//       tons: 70,
//       baseYield: 2.1,
//       weeksDonePerSection: [3, 0, 0, 0],
//     },
//   ],
//   bagalkot: [
//     {
//       farmerId: 'b1',
//       farmerName: 'Farmer 1',
//       tons: 105,
//       baseYield: 2.7,
//       weeksDonePerSection: [8, 0, 0, 0],
//     },
//     {
//       farmerId: 'b2',
//       farmerName: 'Farmer 2',
//       tons: 88,
//       baseYield: 2.4,
//       weeksDonePerSection: [4, 0, 0, 0],
//       missedCallWeeks: [3],
//     },
//     {
//       farmerId: 'b3',
//       farmerName: 'Farmer 3',
//       tons: 78,
//       baseYield: 2.5,
//       weeksDonePerSection: [5, 0, 0, 0],
//     },
//   ],
//   mandya: [
//     {
//       farmerId: 'm1',
//       farmerName: 'Farmer 1',
//       tons: 98,
//       baseYield: 2.8,
//       weeksDonePerSection: [6, 0, 0, 0],
//     },
//     {
//       farmerId: 'm2',
//       farmerName: 'Farmer 2',
//       tons: 72,
//       baseYield: 2.0,
//       weeksDonePerSection: [2, 0, 0, 0],
//       missedCallWeeks: [1],
//     },
//     {
//       farmerId: 'm3',
//       farmerName: 'Farmer 3',
//       tons: 82,
//       baseYield: 2.9,
//       weeksDonePerSection: [7, 0, 0, 0],
//     },
//   ],
// };

export const buildWeeklyCallStatus = (config: FarmerProgressConfig): WeekCallStatus[] =>
  Array.from({ length: TOTAL_WEEKS }, (_, weekIndex) => {
    const sectionIdx = Math.floor(weekIndex / WEEKS_PER_SECTION);
    const localWeek = weekIndex % WEEKS_PER_SECTION;
    const doneInSection = config.weeksDonePerSection[sectionIdx] ?? 0;
    if (localWeek >= doneInSection) return 'pending';
    if (config.missedCallWeeks?.includes(weekIndex)) return 'no';
    return 'yes';
  });

export const getWeeksDoneInSection = (
  config: FarmerProgressConfig,
  sectionIndex: number,
): number => config.weeksDonePerSection[sectionIndex] ?? 0;

export const countCallsTaken = (statuses: WeekCallStatus[]): number =>
  statuses.filter((status) => status === 'yes').length;

export const getProgressShare = (config: FarmerProgressConfig, sectionIndex: number): number =>
  Math.round((getWeeksDoneInSection(config, sectionIndex) / WEEKS_PER_SECTION) * 100);

export const getYieldGap = (tons: number): number => tons - YIELD_TARGET_TON;

export const isAboveTarget = (tons: number): boolean => tons >= YIELD_TARGET_TON;
