import type { PublicFactoryFarmer } from './factoryProgressTypes';
import type { FarmerProgressConfig } from './progressData';
import { YIELD_TARGET_TON } from './progressData';
import { WEEKS_PER_SECTION } from './progressConstants';

function normalizeYieldTons(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(Number(value))) {
    return 0;
  }
  return Math.min(100, Math.max(0, Number(value)));
}

export function farmerHasYieldData(farmer: PublicFactoryFarmer): boolean {
  return farmer.yield != null && Number.isFinite(Number(farmer.yield));
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

  const weeksElapsed = Math.floor(
    (Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  const capped = Math.min(Math.max(weeksElapsed, 0), WEEKS_PER_SECTION * 4);
  return [
    Math.min(capped, WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION * 2, 0), WEEKS_PER_SECTION),
    Math.min(Math.max(capped - WEEKS_PER_SECTION * 3, 0), WEEKS_PER_SECTION),
  ];
}

export function mapApiFarmerToProgressConfig(
  farmer: PublicFactoryFarmer,
): FarmerProgressConfig {
  const tons = normalizeYieldTons(farmer.yield);
  const yieldReadings =
    farmerHasYieldData(farmer) && farmer.date
      ? [{ yield: Number(farmer.yield), date: farmer.date }]
      : undefined;

  return {
    farmerId: String(farmer.id),
    farmerName: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    tons,
    hasYieldData: farmerHasYieldData(farmer),
    baseYield: Math.max(2, tons * 0.025),
    weeksDonePerSection: yieldReadings
      ? weeksDoneFromYieldReadings(yieldReadings)
      : weeksDoneFromPlantation(farmer.plantation_date),
    plantationDate: farmer.plantation_date,
    yieldReadings,
    yieldDate: farmer.date ?? null,
    phoneNumber: farmer.phone_number ?? null,
  };
}

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
