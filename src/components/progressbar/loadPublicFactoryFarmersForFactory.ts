import { fetchPublicFactoryFarmers } from '../../api';
import type { PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';
import {
  parseFactoryByNameResponse,
  parseFactoryListResponse,
} from './parseFactoryApiResponse';

/** Farmers for one factory — always from live public-factory-farmers API. */
export async function loadPublicFactoryFarmersForFactory(
  ownerId: number,
  factory: PublicFactory,
): Promise<PublicFactoryFarmer[]> {
  const byName = await fetchPublicFactoryFarmers(ownerId, factory.factory_name);
  if (byName.ok) {
    const parsed = parseFactoryByNameResponse(byName.data);
    if (parsed?.farmers?.length) return parsed.farmers;
  }

  const list = await fetchPublicFactoryFarmers(ownerId);
  if (list.ok) {
    const factories = parseFactoryListResponse(list.data);
    const match = factories.find(
      (item) =>
        String(item.factory_id) === String(factory.factory_id) ||
        item.factory_name === factory.factory_name,
    );
    return match?.farmers ?? [];
  }

  return [];
}
