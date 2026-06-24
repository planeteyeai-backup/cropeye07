import type { PublicFactory, PublicFactoryFarmer } from './factoryProgressTypes';

const REGION_PARENT_NAMES = new Set(['karnataka', 'india']);

export function buildConfiguredFactoryOptions(): PublicFactory[] {
  const names = parseEnvFactoryNames();
  const defaultIds = [12, 13, 14, 15];

  return names.map((name, index) => ({
    factory_id: defaultIds[index] ?? 100 + index,
    factory_name: name,
    farmers_count: 0,
    farmers: [],
  }));
}

export function isManagerLikeFactoryName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  if (/@/.test(value)) return true;
  if (/^manager\b/i.test(value)) return true;
  if (/^manager\s*\d*$/i.test(value)) return true;
  if (/tea\s*manager/i.test(value)) return true;
  return false;
}

export function isSugarIndustryFactoryName(name: string): boolean {
  const value = name.trim();
  if (!value || isManagerLikeFactoryName(value)) return false;
  return /sugar|factory|sugars|icpl|nsl|chamundeshwari/i.test(value);
}

export function preferSugarIndustryFactories(
  factories: PublicFactory[],
): PublicFactory[] {
  const sugarOnly = factories.filter((factory) =>
    isSugarIndustryFactoryName(factory.factory_name),
  );
  if (sugarOnly.length > 0) return sugarOnly;

  const configured = buildConfiguredFactoryOptions();
  if (configured.length > 0) return configured;

  return factories.filter(
    (factory) => !isManagerLikeFactoryName(factory.factory_name),
  );
}

export function parseEnvFactoryNames(): string[] {
  const raw = import.meta.env.VITE_PROGRESS_FACTORY_NAMES;
  if (!raw || typeof raw !== 'string') return [];

  return raw
    .split('|')
    .map((name) => name.trim())
    .filter(Boolean);
}

function extractIndustryName(row: Record<string, unknown>): string {
  return String(
    row.name ??
      row.industry_name ??
      row.factory_name ??
      row.title ??
      row.label ??
      '',
  ).trim();
}

function isRegionParentName(name: string): boolean {
  return REGION_PARENT_NAMES.has(name.trim().toLowerCase());
}

function dedupeFactories(factories: PublicFactory[]): PublicFactory[] {
  const byName = new Map<string, PublicFactory>();

  for (const factory of factories) {
    const key = factory.factory_name.trim().toLowerCase();
    if (!key) continue;

    const existing = byName.get(key);
    const nextScore =
      (factory.farmers?.length ?? 0) * 10 + (factory.farmers_count ?? 0);
    const existingScore =
      (existing?.farmers?.length ?? 0) * 10 + (existing?.farmers_count ?? 0);

    if (!existing || nextScore >= existingScore) {
      byName.set(key, factory);
    }
  }

  return Array.from(byName.values());
}

/** Flatten nested Industry tree (e.g. Karnataka → sugar factories). */
export function flattenIndustryNodes(data: unknown): Record<string, unknown>[] {
  const payload = data as Record<string, unknown>;

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keyedLists = Object.values(payload).filter(Array.isArray) as unknown[][];
    if (keyedLists.length > 0 && !Array.isArray(payload.results)) {
      return keyedLists.flatMap((list) => flattenIndustryNodes(list));
    }
  }

  const topLevel = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.industries)
        ? payload.industries
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

  const rows: Record<string, unknown>[] = [];
  const childKeys = [
    'children',
    'sub_industries',
    'industries',
    'child_industries',
    'factories',
    'nested',
  ];

  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const row = node as Record<string, unknown>;
      const name = extractIndustryName(row);

      let childNodes: unknown[] = [];
      for (const key of childKeys) {
        if (Array.isArray(row[key])) {
          childNodes = childNodes.concat(row[key] as unknown[]);
        }
      }

      if (childNodes.length > 0) {
        walk(childNodes);
      }

      if (name && !isRegionParentName(name)) {
        rows.push(row);
      }
    }
  };

  walk(topLevel);
  return rows;
}

export function parseIndustriesResponse(data: unknown): PublicFactory[] {
  const rows = flattenIndustryNodes(data);
  const seen = new Set<string>();

  return rows
    .map((row, index) => {
      const factoryId = Number(
        row.id ?? row.industry_id ?? row.factory_id ?? row.pk,
      );
      const factoryName = extractIndustryName(row);
      if (!factoryName || seen.has(factoryName.toLowerCase())) return null;
      seen.add(factoryName.toLowerCase());

      return {
        factory_id: Number.isFinite(factoryId) ? factoryId : index + 1,
        factory_name: factoryName,
        farmers_count: Number(row.farmers_count ?? row.farmer_count ?? 0) || 0,
        farmers: [] as PublicFactoryFarmer[],
      };
    })
    .filter((factory): factory is PublicFactory => factory !== null);
}

export function parseUserIndustries(user: unknown): PublicFactory[] {
  const payload = user as Record<string, unknown>;
  if (!payload || typeof payload !== 'object') return [];

  const industry = payload.industry as Record<string, unknown> | undefined;
  if (industry && typeof industry === 'object') {
    const factoryName = extractIndustryName(industry);
    if (factoryName && !isRegionParentName(factoryName)) {
      const factoryId = Number(
        industry.id ??
          industry.industry_id ??
          payload.industry_id ??
          payload.industryId,
      );
      return [
        {
          factory_id: Number.isFinite(factoryId) ? factoryId : 12,
          factory_name: factoryName,
          farmers_count: 0,
          farmers: [],
        },
      ];
    }
  }

  const candidates = [
    payload.industries,
    payload.accessible_industries,
    payload.industry_list,
    (payload.industry as Record<string, unknown> | undefined)?.children,
    (payload.industry as Record<string, unknown> | undefined)?.sub_industries,
    payload.industry ? [payload.industry] : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = parseIndustriesResponse(candidate);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

export function mergeFactoryLists(
  ...lists: PublicFactory[][]
): PublicFactory[] {
  return preferSugarIndustryFactories(dedupeFactories(lists.flat()));
}
