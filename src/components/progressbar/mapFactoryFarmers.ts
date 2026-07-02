import type { PublicFactoryFarmer } from './factoryProgressTypes';
import type { FarmerProgressConfig } from './progressData';
import { YIELD_TARGET_TON } from './progressData';
import { WEEKS_PER_SECTION } from './progressConstants';
import {
  pickChartYieldReading,
  YIELD_TON_MAX,
} from './yieldReadingUtils';

function parseYieldNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeYieldTons(value: number | null | undefined): number {
  const parsed = parseYieldNumber(value);
  if (parsed == null) return 0;
  return Math.min(100, Math.max(0, parsed));
}

export function farmerHasYieldData(farmer: PublicFactoryFarmer): boolean {
  return parseYieldNumber(farmer.yield) != null;
}

export function weeksDoneFromYieldReadings(
  readings: { date: string }[],
): [number, number, number, number] {
  const total = Math.min(readings.length, WEEKS_PER_SECTION * 4);
  return [
    Math.min(total, WEEKS_PER_SECTION),
    Math.min(Math.max(total - WEEKS_PER_SECTION, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(total - WEEKS_PER_SECTION * 2, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(total - WEEKS_PER_SECTION * 3, 0), WEEKS_PER_SECTION),
  ];
}

export function weeksDoneFromPlantation(
  plantationDate: string | null | undefined,
): [number, number, number, number] {
  if (!plantationDate) return [0, 0, 0, 0];
  const start = new Date(plantationDate);
  if (Number.isNaN(start.getTime())) return [0, 0, 0, 0];

  const weeksElapsed = weeksElapsedFromPlantation(plantationDate);
  const capped = Math.min(Math.max(weeksElapsed, 0), WEEKS_PER_SECTION * 4);
  return [
    Math.min(capped, WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION * 2, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION * 3, 0), WEEKS_PER_SECTION),
  ];
}

export function weeksElapsedFromPlantation(
  plantationDate: string | null | undefined,
): number {
  if (!plantationDate) return 0;
  const start = new Date(plantationDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)),
  );
}

/** Same growth curve as the progress timeline when API yield is missing. */
export function estimatedTonsFromPlantation(
  plantationDate: string | null | undefined,
  baseYield = 2,
): number {
  const weeks = weeksElapsedFromPlantation(plantationDate);
  return Math.min(100, Math.max(0, baseYield + weeks * 0.08));
}

/** Roster row from public-factory-farmers — yield comes from industrial snapshot only. */
export function mapPublicFarmerBaseConfig(
  farmer: PublicFactoryFarmer,
): FarmerProgressConfig {
  return {
    farmerId: String(farmer.id),
    farmerName: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    tons: 0,
    hasYieldData: false,
    baseYield: 2,
    weeksDonePerSection: weeksDoneFromPlantation(farmer.plantation_date),
    plantationDate: farmer.plantation_date,
    yieldReadings: undefined,
    yieldDate: null,
    phoneNumber: farmer.phone_number ?? null,
  };
}

export function mapApiFarmerToProgressConfig(
  farmer: PublicFactoryFarmer,
): FarmerProgressConfig {
  const hasApi = farmerHasYieldData(farmer);
  const apiTons = hasApi ? normalizeYieldTons(farmer.yield) : 0;
  const baseYield = Math.max(2, apiTons > 0 ? apiTons * 0.025 : 2);
  const tons = apiTons;
  const readingDate =
    farmer.date ??
    (hasApi ? farmer.plantation_date : farmer.plantation_date);
  const yieldReadings =
    hasApi && readingDate
      ? [{ yield: Number(farmer.yield), date: readingDate }]
      : undefined;

  return {
    farmerId: String(farmer.id),
    farmerName: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    tons,
    hasYieldData: hasApi,
    baseYield,
    weeksDonePerSection: yieldReadings
      ? weeksDoneFromYieldReadings(yieldReadings)
      : weeksDoneFromPlantation(farmer.plantation_date),
    plantationDate: farmer.plantation_date,
    yieldReadings,
    yieldDate: farmer.date ?? farmer.plantation_date ?? null,
    phoneNumber: farmer.phone_number ?? null,
  };
}

/** Chart farmers — only when API (or merged industrial) returned a yield reading. */
export function pickFarmersForChart(
  configs: FarmerProgressConfig[],
): FarmerProgressConfig[] {
  return configs.filter(
    (cfg) => cfg.hasYieldData !== false && cfg.tons > 0,
  );
}

/**
 * Bubble chart — only farmers with weekly industrial SEF readings.
 * Re-resolves tons from the newest industrial value (not public single-yield).
 */
export function pickFarmersForIndustrialChart(
  configs: FarmerProgressConfig[],
): FarmerProgressConfig[] {
  const chartFarmers: FarmerProgressConfig[] = [];

  for (const cfg of configs) {
    const readings = cfg.yieldReadings;
    if (!readings?.length) continue;

    const latest = pickChartYieldReading(readings);
    if (!latest || latest.yield <= 0) continue;

    chartFarmers.push({
      ...cfg,
      tons: Math.min(latest.yield, YIELD_TON_MAX),
      yieldDate: latest.date,
      hasYieldData: true,
    });
  }

  return chartFarmers;
}

export function countFarmersWithApiYield(
  configs: FarmerProgressConfig[],
): number {
  return configs.filter((cfg) => cfg.hasYieldData !== false && cfg.tons > 0)
    .length;
}

/** @deprecated use pickFarmersForChart */
export const pickFarmersWithApiYield = pickFarmersForChart;

/** Bubble chart — all farmers with yield below the 75 ton target. */
export function pickUnderTargetChartFarmers(
  configs: FarmerProgressConfig[],
): FarmerProgressConfig[] {
  return [...configs]
    .filter((cfg) => cfg.tons < YIELD_TARGET_TON)
    .sort((a, b) => b.tons - a.tons);
}

/** Bubble chart shows up to 3 farmers with highest yield. */
export function pickChartFarmers(
  configs: FarmerProgressConfig[],
  limit = 3,
): FarmerProgressConfig[] {
  if (configs.length <= limit) return configs;
  return [...configs]
    .sort((a, b) => b.tons - a.tons)
    .slice(0, limit);
}
