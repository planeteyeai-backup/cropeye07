import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchIndustrialYieldByOwner, fetchPublicFactoryFarmers, getCurrentUser, getIndustries } from '../../api';
import { getUserData, getUserRole, isAuthenticated, isPlanetEyeDemoUser } from '../../utils/auth';
import type { FactoryId, PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';
import {
  buildConfiguredFactoryOptions,
  mergeFactoryLists,
  parseEnvFactoryNames,
  parseIndustriesResponse,
  parseUserIndustries,
} from './factoryListLoader';
import type { IndustrialYieldByOwnerResponse, IndustrialYieldFactory } from './industrialYieldTypes';
import {
  industrialFactoryToPublicFactory,
  findIndustrialFarmerMatch,
  mergePublicFarmerWithIndustrialYield,
} from './mapIndustrialYield';
import {
  mapApiFarmerToProgressConfig,
  pickChartFarmers,
} from './mapFactoryFarmers';
import {
  parseFactoryByNameResponse,
  parseFactoryListResponse,
} from './parseFactoryApiResponse';
import type { FarmerProgressConfig } from './progressData';

/** Owner with ICPL / public-factory-farmers data (used when .env is not set on deploy). */
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

  if (role === 'owner') {
    const ownerFromUser = parseOwnerId(user?.id ?? user?.user_id);
    if (ownerFromUser) return ownerFromUser;
  }

  const linkedOwner = parseOwnerId(
    user?.owner_id ?? user?.owner?.id ?? user?.ownerId,
  );
  if (linkedOwner) return linkedOwner;

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
  return axiosErr.message ?? 'Failed to load sugar factories from server';
}

async function fetchFactoryList(ownerId: number): Promise<PublicFactory[]> {
  const { data } = await fetchPublicFactoryFarmers(ownerId);
  return parseFactoryListResponse(data);
}

async function fetchFactoryByName(
  ownerId: number,
  factoryName: string,
): Promise<PublicFactory | null> {
  const { ok, data } = await fetchPublicFactoryFarmers(ownerId, factoryName.trim());
  const payload = data as { error?: string };
  if (!ok || payload?.error) return null;
  return parseFactoryByNameResponse(data);
}

async function enrichFactoriesWithFarmers(
  ownerId: number,
  factories: PublicFactory[],
): Promise<PublicFactory[]> {
  const enriched = await Promise.all(
    factories.map(async (factory) => {
      try {
        const parsed = await fetchFactoryByName(ownerId, factory.factory_name);
        if (!parsed) return factory;

        return {
          ...factory,
          factory_id: parsed.factory_id,
          factory_name: parsed.factory_name,
          farmers_count: parsed.farmers_count,
          farmers: parsed.farmers,
        };
      } catch {
        return factory;
      }
    }),
  );

  return mergeFactoryLists(enriched);
}

async function probeFactoriesByName(
  ownerId: number,
  names: string[],
): Promise<PublicFactory[]> {
  const probes = await Promise.all(
    names.map(async (name) => {
      try {
        return await fetchFactoryByName(ownerId, name);
      } catch {
        return null;
      }
    }),
  );

  return probes.filter((factory): factory is PublicFactory => factory != null);
}

async function fetchIndustriesAsFactories(): Promise<PublicFactory[]> {
  const response = await getIndustries();
  return parseIndustriesResponse(response.data);
}

async function fetchUserProfileIndustries(): Promise<PublicFactory[]> {
  const response = await getCurrentUser();
  return parseUserIndustries(response.data);
}

async function fetchIndustrialYieldFactories(
  ownerId: number,
): Promise<IndustrialYieldFactory[] | null> {
  try {
    const { ok, data } = await fetchIndustrialYieldByOwner(ownerId);
    if (!ok) return null;
    const payload = data as IndustrialYieldByOwnerResponse;
    if (!Array.isArray(payload?.factories) || payload.factories.length === 0) {
      return null;
    }
    return payload.factories;
  } catch {
    return null;
  }
}

async function loadSugarFactories(ownerId: number): Promise<{
  factories: PublicFactory[];
  industrialFactories: IndustrialYieldFactory[] | null;
}> {
  const industrialFactories = await fetchIndustrialYieldFactories(ownerId);
  if (industrialFactories) {
    return {
      factories: industrialFactories.map(industrialFactoryToPublicFactory),
      industrialFactories,
    };
  }

  const collected: PublicFactory[][] = [];
  const configured = buildConfiguredFactoryOptions();
  const configuredNames =
    configured.length > 0
      ? configured.map((factory) => factory.factory_name)
      : parseEnvFactoryNames();

  if (isAuthenticated() && !isPlanetEyeDemoUser()) {
    try {
      collected.push(await fetchIndustriesAsFactories());
    } catch {
      // farmers may not have industries permission
    }

    try {
      collected.push(await fetchUserProfileIndustries());
    } catch {
      // optional profile industry
    }
  }

  const publicList = await fetchFactoryList(ownerId);
  collected.push(publicList);

  if (configuredNames.length > 0) {
    collected.push(await probeFactoriesByName(ownerId, configuredNames));
    collected.push(configured);
  }

  const merged = mergeFactoryLists(...collected);
  return {
    factories: await enrichFactoriesWithFarmers(ownerId, merged),
    industrialFactories: null,
  };
}

async function fetchFactoryFarmers(
  ownerId: number,
  factory: PublicFactory,
  publicList: PublicFactory[],
): Promise<PublicFactoryFarmer[]> {
  try {
    const parsed = await fetchFactoryByName(ownerId, factory.factory_name);
    if (parsed && Array.isArray(parsed.farmers)) {
      return parsed.farmers;
    }
  } catch {
    // fall back below
  }

  const fromPublicList = publicList.find(
    (item) => item.factory_id === factory.factory_id,
  );
  if (fromPublicList?.farmers?.length) return fromPublicList.farmers;

  return [];
}

export function useFactoryProgress(initialFactoryId?: FactoryId) {
  const ownerId = resolveProgressOwnerId();
  const [factories, setFactories] = useState<PublicFactory[]>([]);
  const [farmers, setFarmers] = useState<PublicFactoryFarmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [farmersLoading, setFarmersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [farmersError, setFarmersError] = useState<string | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState<FactoryId>(
    initialFactoryId ?? '',
  );
  const [ownerIdUsed, setOwnerIdUsed] = useState<number>(ownerId);
  const [publicFactoryList, setPublicFactoryList] = useState<PublicFactory[]>(
    [],
  );
  const [industrialFactories, setIndustrialFactories] = useState<
    IndustrialYieldFactory[] | null
  >(null);
  const factoriesRef = useRef<PublicFactory[]>([]);
  factoriesRef.current = factories;

  useEffect(() => {
    let cancelled = false;

    const loadFactories = async () => {
      setLoading(true);
      setError(null);

      const tryOwner = async (id: number) => {
        const result = await loadSugarFactories(id);
        return { ...result, ownerIdUsed: id };
      };

      try {
        let result = await tryOwner(ownerId);

        if (result.factories.length === 0 && ownerId !== DEFAULT_OWNER_ID) {
          try {
            result = await tryOwner(DEFAULT_OWNER_ID);
          } catch {
            // keep first attempt
          }
        }

        if (cancelled) return;

        setOwnerIdUsed(result.ownerIdUsed);
        setFactories(result.factories);
        setIndustrialFactories(result.industrialFactories);

        try {
          const rawPublicList = await fetchFactoryList(result.ownerIdUsed);
          if (!cancelled) setPublicFactoryList(rawPublicList);
        } catch {
          if (!cancelled) setPublicFactoryList([]);
        }

        if (result.factories.length === 0) {
          setError('No sugar factories found for this owner.');
          setSelectedFactoryId('');
          setFarmers([]);
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

        const status = (err as { response?: { status?: number } })?.response
          ?.status;

        if (status === 404 && ownerId !== DEFAULT_OWNER_ID) {
          try {
            const fallback = await tryOwner(DEFAULT_OWNER_ID);
            if (cancelled) return;
            setOwnerIdUsed(fallback.ownerIdUsed);
            setFactories(fallback.factories);
            setIndustrialFactories(fallback.industrialFactories);
            if (fallback.factories.length === 0) {
              setError('No sugar factories found for this owner.');
              setSelectedFactoryId('');
              setFarmers([]);
              return;
            }
            setError(null);
            setSelectedFactoryId(String(fallback.factories[0].factory_id));
            return;
          } catch (fallbackErr) {
            if (!cancelled) setError(extractFetchError(fallbackErr));
            setFactories([]);
            setFarmers([]);
            return;
          }
        }

        if (!cancelled) {
          setError(extractFetchError(err));
          setFactories([]);
          setFarmers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadFactories();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when owner changes
  }, [ownerId, initialFactoryId]);

  useEffect(() => {
    if (loading || !selectedFactoryId) return;

    const factory = factoriesRef.current.find(
      (item) => String(item.factory_id) === selectedFactoryId,
    );
    if (!factory) {
      setFarmers([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setFarmersLoading(true);
      setFarmersError(null);
      try {
        const list = await fetchFactoryFarmers(
          ownerIdUsed,
          factory,
          publicFactoryList,
        );
        if (cancelled) return;
        setFarmers(list);
        if (list.length === 0) {
          // setFarmersError(
          //   `No farmers found for "${factory.factory_name}".`,
          // );
        }
      } catch (err) {
        if (cancelled) return;
        setFarmers([]);
        setFarmersError(extractFetchError(err));
      } finally {
        if (!cancelled) setFarmersLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedFactoryId, ownerIdUsed, loading, publicFactoryList]);

  const selectedFactory = useMemo(
    () =>
      factories.find((factory) => String(factory.factory_id) === selectedFactoryId) ??
      null,
    [factories, selectedFactoryId],
  );

  const farmerConfigs = useMemo<FarmerProgressConfig[]>(() => {
    const industrialFactory = industrialFactories?.find(
      (item) => String(item.factory_id) === selectedFactoryId,
    );
    const industrialFarmers = industrialFactory?.farmers ?? [];

    return farmers.map((farmer) => {
      const config = mapApiFarmerToProgressConfig(farmer);
      const match = findIndustrialFarmerMatch(farmer, industrialFarmers);
      return mergePublicFarmerWithIndustrialYield(config, match);
    });
  }, [industrialFactories, selectedFactoryId, farmers]);

  const chartFarmerConfigs = useMemo(
    () => pickChartFarmers(farmerConfigs, 3),
    [farmerConfigs],
  );

  return {
    ownerId: ownerIdUsed,
    factories,
    loading: loading || farmersLoading,
    factoriesLoading: loading,
    farmersLoading,
    error: error ?? farmersError,
    selectedFactoryId,
    setSelectedFactoryId,
    selectedFactory,
    farmerConfigs,
    chartFarmerConfigs,
  };
}
