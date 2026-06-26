import type {
  PublicFactory,
  PublicFactoryByNameResponse,
  PublicFactoryFarmersListResponse,
} from './factoryProgressTypes';

export function parseFactoryListResponse(data: unknown): PublicFactory[] {
  const payload = data as PublicFactoryFarmersListResponse;
  if (!Array.isArray(payload?.factories)) return [];

  return payload.factories
    .filter((factory) => factory?.factory_id != null && factory?.factory_name)
    .map((factory) => ({
      factory_id: factory.factory_id,
      factory_name: String(factory.factory_name).trim(),
      farmers_count: Number(factory.farmers_count) || factory.farmers?.length || 0,
      farmers: Array.isArray(factory.farmers) ? factory.farmers : [],
    }));
}

export function parseFactoryByNameResponse(data: unknown): PublicFactory | null {
  const payload = data as PublicFactoryByNameResponse &
    PublicFactoryFarmersListResponse;

  if (
    payload?.factory_id != null &&
    payload?.factory_name &&
    Array.isArray(payload.farmers)
  ) {
    return {
      factory_id: payload.factory_id,
      factory_name: String(payload.factory_name).trim(),
      farmers_count: Number(payload.farmers_count) || payload.farmers.length,
      farmers: payload.farmers,
    };
  }

  const fromList = parseFactoryListResponse(payload);
  return fromList.length === 1 ? fromList[0] : null;
}
