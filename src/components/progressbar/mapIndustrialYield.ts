import type { IndustrialYieldFarmer, IndustrialYieldFactory } from './industrialYieldTypes';
import type { PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';
import type { FarmerProgressConfig } from './progressData';
import { weeksDoneFromPlantation, weeksDoneFromYieldReadings, pickChartFarmers } from './mapFactoryFarmers';
import {
  pickChartYieldReading,
  pickLatestYieldReading,
  sanitizeYieldReadings,
  YIELD_TON_MAX,
} from './yieldReadingUtils';

const DEFAULT_YIELD_TON = 0;

export function mapIndustrialFarmerToProgressConfig(
  farmer: IndustrialYieldFarmer,
): FarmerProgressConfig {
  const sortedYields = sanitizeYieldReadings(farmer.yields);
  const latest = pickChartYieldReading(farmer.yields);
  const tons = latest?.yield ?? DEFAULT_YIELD_TON;

  return {
    farmerId: String(farmer.id),
    farmerName: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    tons: Math.min(tons, YIELD_TON_MAX),
    baseYield: 2,
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
  const sortedYields = sanitizeYieldReadings(industrial?.yields);
  const latest = pickChartYieldReading(industrial?.yields);
  if (!latest || sortedYields.length === 0) return config;

  return {
    ...config,
    tons: Math.min(latest.yield, YIELD_TON_MAX),
    baseYield: config.baseYield,
    plantationDate: config.plantationDate ?? industrial?.plantation_date,
    yieldReadings: sortedYields,
    yieldDate: latest.date,
    hasYieldData: true,
    phoneNumber: config.phoneNumber ?? industrial?.phone_number ?? null,
    weeksDonePerSection: weeksDoneFromYieldReadings(sortedYields),
  };
}

export function industrialFarmerToPublicFarmer(
  farmer: IndustrialYieldFarmer,
): PublicFactoryFarmer {
  const latest = pickLatestYieldReading(farmer.yields);

  return {
    id: farmer.id,
    farmer_name: farmer.farmer_name,
    phone_number: farmer.phone_number,
    plantation_date: farmer.plantation_date,
    yield: latest?.yield ?? null,
    date: latest?.date ?? null,
  };
}

export function industrialFactoryToPublicFactory(
  factory: IndustrialYieldFactory,
): PublicFactory {
  return {
    factory_id: factory.factory_id,
    factory_name: factory.factory_name,
    farmers_count: factory.farmers_count,
    farmers: (factory.farmers ?? []).map(industrialFarmerToPublicFarmer),
  };
}

export { pickChartFarmers };
