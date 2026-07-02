import type { PublicFactoryFarmer } from './factoryProgressTypes';
import type { IndustrialYieldFarmer } from './industrialYieldTypes';
import { mapPublicFarmerBaseConfig } from './mapFactoryFarmers';
import {
  findIndustrialFarmerMatch,
  mergePublicFarmerWithIndustrialYield,
} from './mapIndustrialYield';
import type { FarmerProgressConfig } from './progressData';

function dedupePublicFarmers(farmers: PublicFactoryFarmer[]): PublicFactoryFarmer[] {
  const seen = new Set<string>();
  const unique: PublicFactoryFarmer[] = [];

  for (const farmer of farmers) {
    const key = String(farmer.id);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(farmer);
  }

  return unique;
}

/**
 * Full factory roster from public-factory-farmers, with industrial SEF yields
 * attached when matched. Farmers missing from the snapshot still appear
 * (plantation-based progress, no yield dot).
 */
export function mergePublicAndIndustrialFarmerConfigs(
  publicFarmers: PublicFactoryFarmer[],
  industrialFarmers: IndustrialYieldFarmer[],
): FarmerProgressConfig[] {
  const roster = dedupePublicFarmers(publicFarmers);

  return roster.map((pub) => {
    const industrial = findIndustrialFarmerMatch(pub, industrialFarmers);
    const base = mapPublicFarmerBaseConfig(pub);
    return mergePublicFarmerWithIndustrialYield(base, industrial);
  });
}
