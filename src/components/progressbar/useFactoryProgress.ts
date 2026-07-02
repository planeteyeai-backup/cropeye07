import { useEffect, useMemo, useState } from 'react';
import { fetchIndustrialYieldByOwner, fetchPublicFactoryFarmers } from '../../api';
import { getUserData, getUserRole, isPlanetEyeDemoUser } from '../../utils/auth';
import type { FactoryId, PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';
import type { IndustrialYieldByOwnerResponse, IndustrialYieldFactory, IndustrialYieldFarmer } from './industrialYieldTypes';
import { loadPublicFactoryFarmersForFactory } from './loadPublicFactoryFarmersForFactory';
import { parseFactoryListResponse } from './parseFactoryApiResponse';
import { mergePublicAndIndustrialFarmerConfigs } from './mergeFactoryFarmerConfigs';
import {
  industrialFactoryToPublicFactory,
  mapIndustrialFarmerToProgressConfig,
} from './mapIndustrialYield';
import { mapPublicFarmerBaseConfig, pickFarmersForIndustrialChart } from './mapFactoryFarmers';
import type { FarmerProgressConfig } from './progressData';

/** Owner used when .env is not set on deploy. */
const FALLBACK_PROGRESS_OWNER_ID = 2476;

const DEFAULT_OWNER_ID =
  parseOwnerId(import.meta.env.VITE_PROGRESS_OWNER_ID) ?? FALLBACK_PROGRESS_OWNER_ID;

function parseOwnerId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveProgressOwnerId(): number {
  const envOwner = parseOwnerId(import.meta.env.VITE_PROGRESS_OWNER_ID);
  if (envOwner) return envOwner;

  if (isPlanetEyeDemoUser() || getUserRole()?.toLowerCase() === 'planeteye') {
    return FALLBACK_PROGRESS_OWNER_ID;
  }

  const user = getUserData();
  const role = getUserRole()?.toLowerCase().replace(/\s+/g, '');

  // Sugar owner_id — never use auth user.id (Django user pk) for SEF snapshot.
  const linkedOwner = parseOwnerId(
    user?.owner_id ?? user?.owner?.id ?? user?.ownerId,
  );
  if (linkedOwner) return linkedOwner;

  if (role === 'owner' || role === 'manager' || role === 'fieldofficer') {
    return FALLBACK_PROGRESS_OWNER_ID;
  }

  return DEFAULT_OWNER_ID;
}

function extractFetchError(err: unknown): string {
  const axiosErr = err as {
    response?: { status?: number; data?: { error?: string; detail?: string } };
    message?: string;
  };
  const apiMsg =
    axiosErr.response?.data?.error ??
    axiosErr.response?.data?.detail ??
    null;
  if (apiMsg) return String(apiMsg);
  if (axiosErr.response?.status === 404) {
    return 'Owner not found for this account. Set VITE_PROGRESS_OWNER_ID=2476 in .env';
  }
  return axiosErr.message ?? 'Failed to load industrial yield snapshot';
}

async function fetchIndustrialYieldFactories(
  ownerId: number,
): Promise<{ factories: IndustrialYieldFactory[] | null; error: string | null }> {
  try {
    const { ok, data } = await fetchIndustrialYieldByOwner(ownerId);
    if (!ok) {
      const err = (data as { error?: string })?.error ?? "SEF snapshot failed";
      return { factories: null, error: String(err) };
    }
    const payload = data as IndustrialYieldByOwnerResponse;
    if (!Array.isArray(payload?.factories) || payload.factories.length === 0) {
      return { factories: null, error: "Industrial yield snapshot returned no factories" };
    }
    return { factories: payload.factories, error: null };
  } catch (err) {
    return {
      factories: null,
      error: err instanceof Error ? err.message : "Failed to load industrial yield snapshot",
    };
  }
}

/** Factory dropdown from Django public-factory-farmers when SEF snapshot is down. */
async function loadPublicSugarFactories(ownerId: number): Promise<PublicFactory[]> {
  try {
    const { ok, data } = await fetchPublicFactoryFarmers(ownerId);
    if (!ok) return [];
    return parseFactoryListResponse(data).map((factory) => ({
      factory_id: factory.factory_id,
      factory_name: factory.factory_name,
      farmers_count: factory.farmers_count,
      farmers: [],
    }));
  } catch {
    return [];
  }
}

async function loadSugarFactories(ownerId: number): Promise<{
  factories: PublicFactory[];
  industrialFactories: IndustrialYieldFactory[] | null;
  industrialLoadError: string | null;
}> {
  const [industrialResult, publicFactories] = await Promise.all([
    fetchIndustrialYieldFactories(ownerId),
    loadPublicSugarFactories(ownerId),
  ]);
  const industrialFactories = industrialResult.factories;

  if (industrialFactories) {
    return {
      factories: industrialFactories.map(industrialFactoryToPublicFactory),
      industrialFactories,
      industrialLoadError: null,
    };
  }

  if (publicFactories.length > 0) {
    return {
      factories: publicFactories,
      industrialFactories: null,
      industrialLoadError:
        industrialResult.error ??
        'SEF yield snapshot is unavailable. Industries loaded from public API — yield dots need industrial_yield_by_owner_snapshot.',
    };
  }

  return {
    factories: [],
    industrialFactories: null,
    industrialLoadError:
      industrialResult.error ??
      'Could not load factories from SEF or public-factory-farmers. Check network or set VITE_PROGRESS_OWNER_ID=2476 on deploy.',
  };
}

function findIndustrialFactory(
  industrialFactories: IndustrialYieldFactory[],
  selectedFactoryId: string,
  selectedFactory: PublicFactory | null,
): IndustrialYieldFactory | undefined {
  const byId = industrialFactories.find(
    (item) => String(item.factory_id) === selectedFactoryId,
  );
  if (byId) return byId;

  if (!selectedFactory?.factory_name) return undefined;

  const name = selectedFactory.factory_name.trim().toLowerCase();
  return industrialFactories.find(
    (item) => item.factory_name?.trim().toLowerCase() === name,
  );
}

function resolveIndustrialFarmersForFactory(
  industrialFactories: IndustrialYieldFactory[] | null,
  selectedFactoryId: string,
  selectedFactory: PublicFactory | null,
): IndustrialYieldFarmer[] {
  if (!industrialFactories?.length || !selectedFactoryId) return [];

  const byId = industrialFactories.find(
    (factory) => String(factory.factory_id) === selectedFactoryId,
  );
  if (byId?.farmers?.length) return byId.farmers;

  const byName = findIndustrialFactory(
    industrialFactories,
    selectedFactoryId,
    selectedFactory,
  );
  return byName?.farmers ?? byId?.farmers ?? [];
}

export function useFactoryProgress(initialFactoryId?: FactoryId) {
  const ownerId = resolveProgressOwnerId();
  const [factories, setFactories] = useState<PublicFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState<FactoryId>(
    initialFactoryId ?? '',
  );
  const [ownerIdUsed, setOwnerIdUsed] = useState<number>(ownerId);
  const [industrialFactories, setIndustrialFactories] = useState<
    IndustrialYieldFactory[] | null
  >(null);
  const [industrialLoadError, setIndustrialLoadError] = useState<string | null>(
    null,
  );
  const [publicFarmers, setPublicFarmers] = useState<PublicFactoryFarmer[]>([]);
  const [publicFarmersFactoryId, setPublicFarmersFactoryId] = useState<FactoryId>(
    '',
  );
  const [farmersLoading, setFarmersLoading] = useState(false);
  const [industrialYieldLoading, setIndustrialYieldLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadFactories = async () => {
      setLoading(true);
      setIndustrialYieldLoading(true);
      setError(null);

      const tryOwner = async (id: number) => {
        const result = await loadSugarFactories(id);
        return { ...result, ownerIdUsed: id };
      };

      try {
        let result = await tryOwner(ownerId);

        if (
          result.factories.length === 0 &&
          result.ownerIdUsed !== FALLBACK_PROGRESS_OWNER_ID
        ) {
          try {
            result = await tryOwner(FALLBACK_PROGRESS_OWNER_ID);
          } catch {
            // keep first attempt
          }
        }

        if (cancelled) return;

        setOwnerIdUsed(result.ownerIdUsed);
        setFactories(result.factories);
        setIndustrialFactories(result.industrialFactories);
        setIndustrialLoadError(result.industrialLoadError);

        if (result.factories.length === 0) {
          setError(
            result.industrialLoadError ??
              'No sugar factories found in industrial yield snapshot.',
          );
          setSelectedFactoryId('');
          return;
        }

        const nextId = (() => {
          if (
            selectedFactoryId &&
            result.factories.some((f) => String(f.factory_id) === selectedFactoryId)
          ) {
            return selectedFactoryId;
          }
          if (
            initialFactoryId &&
            result.factories.some((f) => String(f.factory_id) === initialFactoryId)
          ) {
            return initialFactoryId;
          }
          return String(result.factories[0].factory_id);
        })();

        setSelectedFactoryId(nextId);
      } catch (err) {
        if (cancelled) return;

        if (!cancelled) {
          setError(extractFetchError(err));
          setFactories([]);
          setIndustrialFactories(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIndustrialYieldLoading(false);
        }
      }
    };

    void loadFactories();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when owner changes
  }, [ownerId, initialFactoryId]);

  const selectedFactory = useMemo(
    () =>
      factories.find((factory) => String(factory.factory_id) === selectedFactoryId) ??
      null,
    [factories, selectedFactoryId],
  );

  useEffect(() => {
    if (!selectedFactoryId || !selectedFactory) {
      setPublicFarmers([]);
      setPublicFarmersFactoryId('');
      setFarmersLoading(false);
      return;
    }

    let cancelled = false;
    const factoryIdForLoad = selectedFactoryId;
    setPublicFarmers([]);
    setPublicFarmersFactoryId('');
    setFarmersLoading(true);

    void loadPublicFactoryFarmersForFactory(ownerIdUsed, selectedFactory)
      .then((farmers) => {
        if (!cancelled) {
          setPublicFarmers(farmers);
          setPublicFarmersFactoryId(factoryIdForLoad);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPublicFarmers([]);
          setPublicFarmersFactoryId('');
        }
      })
      .finally(() => {
        if (!cancelled) setFarmersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerIdUsed, selectedFactoryId, selectedFactory]);

  const farmerConfigs = useMemo<FarmerProgressConfig[]>(() => {
    if (!selectedFactoryId) return [];

    const industrialFarmers = resolveIndustrialFarmersForFactory(
      industrialFactories,
      selectedFactoryId,
      selectedFactory,
    );

    const publicRoster =
      publicFarmersFactoryId === selectedFactoryId ? publicFarmers : [];

    if (publicRoster.length > 0 && industrialFarmers.length > 0) {
      return mergePublicAndIndustrialFarmerConfigs(
        publicRoster,
        industrialFarmers,
      );
    }

    if (industrialFarmers.length > 0) {
      return industrialFarmers.map(mapIndustrialFarmerToProgressConfig);
    }

    if (publicRoster.length > 0) {
      return publicRoster.map(mapPublicFarmerBaseConfig);
    }

    return [];
  }, [
    industrialFactories,
    selectedFactoryId,
    selectedFactory,
    publicFarmers,
    publicFarmersFactoryId,
  ]);

  const chartFarmerConfigs = useMemo(
    () => pickFarmersForIndustrialChart(farmerConfigs),
    [farmerConfigs],
  );

  return {
    ownerId: ownerIdUsed,
    factories,
    loading,
    factoriesLoading: loading,
    farmersLoading,
    industrialYieldLoading,
    error,
    selectedFactoryId,
    setSelectedFactoryId,
    selectedFactory,
    farmerConfigs,
    chartFarmerConfigs,
    industrialLoadError,
    hasIndustrialYield: industrialFactories != null,
  };
}
