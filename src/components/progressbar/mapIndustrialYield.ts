import type { IndustrialYieldFarmer, IndustrialYieldFactory } from './industrialYieldTypes';
import type { PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';
import type { FarmerProgressConfig } from './progressData';
import { weeksDoneFromPlantation, weeksDoneFromYieldReadings, pickChartFarmers } from './mapFactoryFarmers';

const DEFAULT_YIELD_TON = 75;

function latestYield(farmer: IndustrialYieldFarmer): number {
  const readings = farmer.yields ?? [];
  if (readings.length === 0) return DEFAULT_YIELD_TON;
  const sorted = [...readings].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  return sorted[sorted.length - 1]?.yield ?? DEFAULT_YIELD_TON;
}

export function mapIndustrialFarmerToProgressConfig(
  farmer: IndustrialYieldFarmer,
): FarmerProgressConfig {
  const sortedYields = [...(farmer.yields ?? [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const latest = sortedYields[sortedYields.length - 1];
  const tons = latest?.yield ?? DEFAULT_YIELD_TON;

  return {
    farmerId: String(farmer.id),
    farmerName: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    tons,
    baseYield: latest?.yield ?? 2,
    plantationDate: farmer.plantation_date,
    yieldReadings: sortedYields,
    yieldDate: latest?.date ?? null,
    hasYieldData: sortedYields.length > 0,
    phoneNumber: farmer.phone_number ?? null,
    weeksDonePerSection:
      sortedYields.length > 0
        ? weeksDoneFromYieldReadings(sortedYields)
        : weeksDoneFromPlantation(farmer.plantation_date),
  };
}

export function findIndustrialFarmerMatch(
  publicFarmer: Pick<PublicFactoryFarmer, 'id' | 'farmer_name'>,
  industrialFarmers: IndustrialYieldFarmer[],
): IndustrialYieldFarmer | undefined {
  const pubId = String(publicFarmer.id);
  const pubName = publicFarmer.farmer_name?.trim().toLowerCase() ?? '';
  return industrialFarmers.find((farmer) => {
    const sameId = String(farmer.id) === pubId;
    const sameName =
      pubName.length > 0 &&
      farmer.farmer_name?.trim().toLowerCase() === pubName;
    return sameId || sameName;
  });
}

/** Keep farmer list from main DB; attach weekly yields from industrial API when matched. */
export function mergePublicFarmerWithIndustrialYield(
  config: FarmerProgressConfig,
  industrial?: IndustrialYieldFarmer | null,
): FarmerProgressConfig {
  if (!industrial?.yields?.length) return config;

  const sortedYields = [...industrial.yields].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const latest = sortedYields[sortedYields.length - 1];

  return {
    ...config,
    tons: latest?.yield ?? config.tons,
    baseYield: latest?.yield ?? config.baseYield,
    plantationDate: config.plantationDate ?? industrial.plantation_date,
    yieldReadings: sortedYields,
    yieldDate: latest?.date ?? config.yieldDate,
    hasYieldData: true,
    phoneNumber: config.phoneNumber ?? industrial.phone_number ?? null,
    weeksDonePerSection: weeksDoneFromYieldReadings(sortedYields),
  };
}

export function industrialFactoryToPublicFactory(
  factory: IndustrialYieldFactory,
): PublicFactory {
  return {
    factory_id: factory.factory_id,
    factory_name: factory.factory_name,
    farmers_count: factory.farmers_count,
    farmers: [],
  };
}

export { pickChartFarmers };
