/**
 * Factory owner dashboard rollup.
 * GET /factories/dashboard?owner_id=&end_date=
 * GET /factories/{factory_id}/dashboard?owner_id=&end_date=
 * Host: https://events-cropeye.up.railway.app (days_to_harvest, cci_avg)
 */
const FACTORY_OWNER_DASH_DEFAULT = "https://events-cropeye.up.railway.app";

function resolveFactoryDashBase(): string {
  const fromEnv = String(import.meta.env.VITE_FACTORY_OWNER_DASH_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return FACTORY_OWNER_DASH_DEFAULT;
}

function factoryDashBases(): string[] {
  const primary = resolveFactoryDashBase();
  const proxy = import.meta.env.DEV ? "/api/factory-owner-dashboard" : "";
  // Dev: prefer Vite proxy first (avoids CORS / browser timeout).
  if (import.meta.env.DEV && proxy) {
    return Array.from(new Set([proxy, primary]));
  }
  return Array.from(new Set([primary]));
}

export function parseDaysToHarvest(raw: unknown): FactoryDaysToHarvest | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const within_15_days = asFiniteNumber(d.within_15_days);
  const within_1_month = asFiniteNumber(d.within_1_month);
  const within_45_days = asFiniteNumber(d.within_45_days);
  const within_90_days = asFiniteNumber(d.within_90_days);
  const within_120_days = asFiniteNumber(d.within_120_days);
  const plots_with_days_to_harvest = asFiniteNumber(
    d.plots_with_days_to_harvest,
  );
  if (
    within_15_days == null &&
    within_1_month == null &&
    within_45_days == null &&
    within_90_days == null &&
    within_120_days == null &&
    plots_with_days_to_harvest == null
  ) {
    return null;
  }
  return {
    within_15_days: within_15_days ?? undefined,
    within_1_month: within_1_month ?? undefined,
    within_45_days: within_45_days ?? undefined,
    within_90_days: within_90_days ?? undefined,
    within_120_days: within_120_days ?? undefined,
    plots_with_days_to_harvest: plots_with_days_to_harvest ?? undefined,
    note: d.note != null ? String(d.note) : undefined,
  };
}

/** Sum cumulative day-to-harvest buckets across factories. */
export function sumDaysToHarvest(
  items: Array<FactoryDaysToHarvest | null | undefined>,
): FactoryDaysToHarvest | null {
  let any = false;
  const out: FactoryDaysToHarvest = {
    within_15_days: 0,
    within_1_month: 0,
    within_45_days: 0,
    within_90_days: 0,
    within_120_days: 0,
    plots_with_days_to_harvest: 0,
  };
  for (const item of items) {
    if (!item) continue;
    any = true;
    out.within_15_days =
      (out.within_15_days || 0) + (Number(item.within_15_days) || 0);
    out.within_1_month =
      (out.within_1_month || 0) + (Number(item.within_1_month) || 0);
    out.within_45_days =
      (out.within_45_days || 0) + (Number(item.within_45_days) || 0);
    out.within_90_days =
      (out.within_90_days || 0) + (Number(item.within_90_days) || 0);
    out.within_120_days =
      (out.within_120_days || 0) + (Number(item.within_120_days) || 0);
    out.plots_with_days_to_harvest =
      (out.plots_with_days_to_harvest || 0) +
      (Number(item.plots_with_days_to_harvest) || 0);
  }
  return any ? out : null;
}

export function parseFieldScoreDistribution(
  raw: unknown,
): FactoryFieldScoreDistribution | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const above_80 = asFiniteNumber(d.above_80);
  const between_60_80 = asFiniteNumber(d.between_60_80);
  const between_40_60 = asFiniteNumber(d.between_40_60);
  const below_40 = asFiniteNumber(d.below_40);
  const plots_with_field_score = asFiniteNumber(d.plots_with_field_score);
  if (
    above_80 == null &&
    between_60_80 == null &&
    between_40_60 == null &&
    below_40 == null &&
    plots_with_field_score == null
  ) {
    return null;
  }
  return {
    above_80: above_80 ?? undefined,
    between_60_80: between_60_80 ?? undefined,
    between_40_60: between_40_60 ?? undefined,
    below_40: below_40 ?? undefined,
    plots_with_field_score: plots_with_field_score ?? undefined,
  };
}

export function parseExpectedYieldDistribution(
  raw: unknown,
): FactoryExpectedYieldDistribution | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const above_100 = asFiniteNumber(d.above_100);
  const between_75_100 = asFiniteNumber(d.between_75_100);
  const between_50_75 = asFiniteNumber(d.between_50_75);
  const below_50 = asFiniteNumber(d.below_50);
  const plots_with_yield = asFiniteNumber(d.plots_with_yield);
  if (
    above_100 == null &&
    between_75_100 == null &&
    between_50_75 == null &&
    below_50 == null &&
    plots_with_yield == null
  ) {
    return null;
  }
  return {
    above_100: above_100 ?? undefined,
    between_75_100: between_75_100 ?? undefined,
    between_50_75: between_50_75 ?? undefined,
    below_50: below_50 ?? undefined,
    plots_with_yield: plots_with_yield ?? undefined,
    note: d.note != null ? String(d.note) : undefined,
  };
}

export function sumFieldScoreDistribution(
  items: Array<FactoryFieldScoreDistribution | null | undefined>,
): FactoryFieldScoreDistribution | null {
  let any = false;
  const out: FactoryFieldScoreDistribution = {
    above_80: 0,
    between_60_80: 0,
    between_40_60: 0,
    below_40: 0,
    plots_with_field_score: 0,
  };
  for (const item of items) {
    if (!item) continue;
    any = true;
    out.above_80 = (out.above_80 || 0) + (Number(item.above_80) || 0);
    out.between_60_80 =
      (out.between_60_80 || 0) + (Number(item.between_60_80) || 0);
    out.between_40_60 =
      (out.between_40_60 || 0) + (Number(item.between_40_60) || 0);
    out.below_40 = (out.below_40 || 0) + (Number(item.below_40) || 0);
    out.plots_with_field_score =
      (out.plots_with_field_score || 0) +
      (Number(item.plots_with_field_score) || 0);
  }
  return any ? out : null;
}

export function sumExpectedYieldDistribution(
  items: Array<FactoryExpectedYieldDistribution | null | undefined>,
): FactoryExpectedYieldDistribution | null {
  let any = false;
  const out: FactoryExpectedYieldDistribution = {
    above_100: 0,
    between_75_100: 0,
    between_50_75: 0,
    below_50: 0,
    plots_with_yield: 0,
  };
  for (const item of items) {
    if (!item) continue;
    any = true;
    out.above_100 = (out.above_100 || 0) + (Number(item.above_100) || 0);
    out.between_75_100 =
      (out.between_75_100 || 0) + (Number(item.between_75_100) || 0);
    out.between_50_75 =
      (out.between_50_75 || 0) + (Number(item.between_50_75) || 0);
    out.below_50 = (out.below_50 || 0) + (Number(item.below_50) || 0);
    out.plots_with_yield =
      (out.plots_with_yield || 0) + (Number(item.plots_with_yield) || 0);
  }
  return any ? out : null;
}

function normalizeFactoriesPayload(
  json: unknown,
): FactoryDashboardResponse | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : null;
  const factories = Array.isArray(root.factories)
    ? root.factories
    : Array.isArray(nested?.factories)
      ? nested.factories
      : null;
  if (!factories) return null;
  const normalizedFactories = factories
    .map((row) => parseFactoryDashboardFactory(row))
    .filter((row): row is FactoryDashboardFactory => row != null);

  const daysToHarvest =
    parseDaysToHarvest(root.days_to_harvest) ??
    parseDaysToHarvest(nested?.days_to_harvest);
  const cciAvg =
    asFiniteNumber(root.cci_avg) ?? asFiniteNumber(nested?.cci_avg);
  const fieldScoreDist =
    parseFieldScoreDistribution(root.field_score_distribution) ??
    parseFieldScoreDistribution(nested?.field_score_distribution);
  const yieldDist =
    parseExpectedYieldDistribution(root.expected_yield_distribution) ??
    parseExpectedYieldDistribution(nested?.expected_yield_distribution);

  return {
    ...(nested ? { ...nested, ...root } : root),
    factories: normalizedFactories,
    days_to_harvest: daysToHarvest,
    cci_avg: cciAvg,
    field_score_distribution: fieldScoreDist,
    expected_yield_distribution: yieldDist,
  } as FactoryDashboardResponse;
}

const inFlight = new Map<string, Promise<FactoryDashboardResponse | null>>();
const resultCache = new Map<
  string,
  { at: number; data: FactoryDashboardResponse }
>();
const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
/** Heavy owner rollup; Cloudflare 524 ≈ 100s. */
const FACTORY_DASH_TIMEOUT_MS = 120_000;
/** Proxy TLS drops (ECONNRESET) are common on long Railway responses. */
const FACTORY_DASH_RETRIES = 2;

export type FactoryDaysToHarvest = {
  within_15_days?: number;
  within_1_month?: number;
  within_45_days?: number;
  within_90_days?: number;
  within_120_days?: number;
  plots_with_days_to_harvest?: number;
  note?: string;
};

export type FactoryFieldScoreDistribution = {
  above_80?: number;
  between_60_80?: number;
  between_40_60?: number;
  below_40?: number;
  plots_with_field_score?: number;
};

export type FactoryExpectedYieldDistribution = {
  above_100?: number;
  between_75_100?: number;
  between_50_75?: number;
  below_50?: number;
  plots_with_yield?: number;
  note?: string;
};

export type FactoryTop25Farmer = {
  farmer_id: number;
  farmer_name: string;
  recovery_avg_pct: number;
  plot_count: number;
};

export type FactoryDashboardFactory = {
  owner_id?: number;
  factory_id?: number;
  factory_name?: string;
  field_officer_ids?: number[];
  data_end_dates_by_field_officer?: Record<string, string>;
  plot_count?: number;
  total_field_area_acres?: number | null;
  average_yield_t_per_acre?: number | null;
  expected_yield_t_per_acre?: number | null;
  expected_yield_min_t_per_acre?: number | null;
  expected_yield_max_t_per_acre?: number | null;
  biomass_avg_t_per_acre?: number | null;
  biomass_min_t_per_acre?: number | null;
  biomass_max_t_per_acre?: number | null;
  brix_avg?: number | null;
  brix_min?: number | null;
  brix_max?: number | null;
  field_score_avg?: number | null;
  /** Factory/owner Crop Condition Index average (0–100 from dashboard API). */
  cci_avg?: number | null;
  days_to_harvest?: FactoryDaysToHarvest | null;
  field_score_distribution?: FactoryFieldScoreDistribution | null;
  expected_yield_distribution?: FactoryExpectedYieldDistribution | null;
  crop_status?: {
    tillering_pct?: number;
    grand_growth_pct?: number;
    harvest_maturity_pct?: number;
    other_or_unknown_pct?: number;
    counts?: {
      tillering?: number;
      grand_growth?: number;
      harvest_maturity?: number;
      other_or_unknown?: number;
      total_plots?: number;
    };
  };
  recovery?: {
    factory_avg_pct?: number | null;
    plots_with_recovery?: number;
    top_25_farmers?: {
      count?: number;
      average_recovery_pct?: number | null;
      farmers?: FactoryTop25Farmer[];
    };
    similar_plots?: {
      tolerance_pct_points?: number;
      matching_plots?: number;
      plots_compared?: number;
      percent?: number | null;
      note?: string;
    };
  };
};

export type FactoryDashboardResponse = {
  owner_id?: number;
  requested_end_date?: string;
  factories_count?: number;
  factories?: FactoryDashboardFactory[];
  /** Present on owner rollup `/factories/dashboard` root. */
  days_to_harvest?: FactoryDaysToHarvest | null;
  cci_avg?: number | null;
  field_score_distribution?: FactoryFieldScoreDistribution | null;
  expected_yield_distribution?: FactoryExpectedYieldDistribution | null;
  errors?: unknown;
  backend?: string;
};

export function clearFactoryDashboardInFlight(): void {
  inFlight.clear();
  resultCache.clear();
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** True when factory row has no usable metric fields (list endpoint often returns shells). */
export function isSparseFactoryDashboard(
  factory: FactoryDashboardFactory | null | undefined,
): boolean {
  if (!factory) return true;
  const area = asFiniteNumber(factory.total_field_area_acres);
  const yieldAvg = asFiniteNumber(
    factory.expected_yield_t_per_acre ?? factory.average_yield_t_per_acre,
  );
  const totalPlots = Number(factory.crop_status?.counts?.total_plots ?? 0) || 0;
  const brix = asFiniteNumber(factory.brix_avg);
  const biomass = asFiniteNumber(factory.biomass_avg_t_per_acre);
  const recovery = asFiniteNumber(factory.recovery?.factory_avg_pct);
  const hasDays = !!factory.days_to_harvest;
  const hasScoreDist = !!factory.field_score_distribution;
  const hasYieldDist = !!factory.expected_yield_distribution;
  const hasCci = asFiniteNumber(factory.cci_avg) != null;
  return (
    area == null &&
    yieldAvg == null &&
    brix == null &&
    biomass == null &&
    recovery == null &&
    totalPlots <= 0 &&
    !hasDays &&
    !hasScoreDist &&
    !hasYieldDist &&
    !hasCci
  );
}

export function isSparseFactoriesPayload(
  payload: FactoryDashboardResponse | null | undefined,
): boolean {
  const factories = payload?.factories ?? [];
  if (!factories.length) return true;
  return factories.every(isSparseFactoryDashboard);
}

function pickMinMax(
  data: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const n = asFiniteNumber(data[key]);
    if (n != null) return n;
  }
  return null;
}

function nestedStat(
  data: Record<string, unknown>,
  groupKeys: string[],
  field: "min" | "max" | "avg" | "mean" | "average",
): number | null {
  for (const g of groupKeys) {
    const obj = data[g];
    if (!obj || typeof obj !== "object") continue;
    const rec = obj as Record<string, unknown>;
    const n = asFiniteNumber(rec[field] ?? rec[`${field}_value`]);
    if (n != null) return n;
  }
  return null;
}

/** Normalize a single-factory dashboard payload into FactoryDashboardFactory. */
export function parseFactoryDashboardFactory(
  raw: unknown,
): FactoryDashboardFactory | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (
    data.factory_id == null &&
    data.total_field_area_acres == null &&
    Array.isArray((data as FactoryDashboardResponse).factories)
  ) {
    return null;
  }

  const factory = { ...(data as FactoryDashboardFactory) };

  factory.brix_min =
    asFiniteNumber(factory.brix_min) ??
    pickMinMax(data, ["brix_min", "brixMin", "min_brix"]) ??
    nestedStat(data, ["brix", "brix_sugar", "sugar_content"], "min");

  factory.brix_max =
    asFiniteNumber(factory.brix_max) ??
    pickMinMax(data, ["brix_max", "brixMax", "max_brix"]) ??
    nestedStat(data, ["brix", "brix_sugar", "sugar_content"], "max");

  factory.expected_yield_min_t_per_acre =
    asFiniteNumber(factory.expected_yield_min_t_per_acre) ??
    pickMinMax(data, [
      "expected_yield_min_t_per_acre",
      "expected_yield_min",
      "yield_min_t_per_acre",
      "yield_min",
      "min_expected_yield",
    ]) ??
    nestedStat(data, ["expected_yield", "yield", "sugar_yield"], "min");

  factory.expected_yield_max_t_per_acre =
    asFiniteNumber(factory.expected_yield_max_t_per_acre) ??
    pickMinMax(data, [
      "expected_yield_max_t_per_acre",
      "expected_yield_max",
      "yield_max_t_per_acre",
      "yield_max",
      "max_expected_yield",
    ]) ??
    nestedStat(data, ["expected_yield", "yield", "sugar_yield"], "max");

  factory.biomass_min_t_per_acre =
    asFiniteNumber(factory.biomass_min_t_per_acre) ??
    pickMinMax(data, [
      "biomass_min_t_per_acre",
      "biomass_min",
      "min_biomass",
    ]) ??
    nestedStat(data, ["biomass", "avg_biomass"], "min");

  factory.biomass_max_t_per_acre =
    asFiniteNumber(factory.biomass_max_t_per_acre) ??
    pickMinMax(data, [
      "biomass_max_t_per_acre",
      "biomass_max",
      "max_biomass",
    ]) ??
    nestedStat(data, ["biomass", "avg_biomass"], "max");

  factory.cci_avg =
    asFiniteNumber(factory.cci_avg) ?? asFiniteNumber(data.cci_avg);
  factory.days_to_harvest =
    parseDaysToHarvest(factory.days_to_harvest) ??
    parseDaysToHarvest(data.days_to_harvest);
  factory.field_score_distribution =
    parseFieldScoreDistribution(factory.field_score_distribution) ??
    parseFieldScoreDistribution(data.field_score_distribution);
  factory.expected_yield_distribution =
    parseExpectedYieldDistribution(factory.expected_yield_distribution) ??
    parseExpectedYieldDistribution(data.expected_yield_distribution);

  return factory;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs = FACTORY_DASH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isGatewayOrTimeoutStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 524;
}

export async function fetchFactoriesOwnerDashboard(
  ownerId: string | number,
  endDate?: string,
): Promise<FactoryDashboardResponse | null> {
  const oid = String(ownerId ?? "").trim();
  if (!oid) return null;

  const qs = new URLSearchParams({ owner_id: oid });
  if (endDate?.trim()) qs.set("end_date", endDate.trim());
  const cacheKey = qs.toString();

  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return cached.data;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const bases = factoryDashBases();

    try {
      for (const base of bases) {
        const url = `${base}/factories/dashboard?${cacheKey}`;
        for (let attempt = 0; attempt <= FACTORY_DASH_RETRIES; attempt += 1) {
          try {
            const resp = await fetchJsonWithTimeout(url);
            if (isGatewayOrTimeoutStatus(resp.status)) {
              // Tunnel/origin overload (Cloudflare 502/524) — brief backoff then retry.
              if (attempt < FACTORY_DASH_RETRIES) {
                await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                continue;
              }
              break;
            }
            if (!resp.ok) break;
            const json = normalizeFactoriesPayload(await resp.json());
            if (!json?.factories?.length) break;
            if (!isSparseFactoriesPayload(json)) {
              resultCache.set(cacheKey, { at: Date.now(), data: json });
            }
            return json;
          } catch {
            if (attempt < FACTORY_DASH_RETRIES) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }
          }
        }
      }
      return null;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, pending);
  return pending;
}

/** GET /factories/{factory_id}/dashboard?owner_id= */
export async function fetchFactoryOwnerDashboardById(
  factoryId: string | number,
  ownerId: string | number,
  endDate?: string,
): Promise<FactoryDashboardFactory | null> {
  const fid = String(factoryId ?? "").trim();
  const oid = String(ownerId ?? "").trim();
  if (!fid || !oid) return null;

  const qs = new URLSearchParams({ owner_id: oid });
  if (endDate?.trim()) qs.set("end_date", endDate.trim());
  const cacheKey = `one|${fid}|${qs}`;

  const cached = resultCache.get(cacheKey);
  if (cached?.data?.factories?.[0] && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return cached.data.factories[0];
  }

  try {
    for (const base of factoryDashBases()) {
      const url = `${base}/factories/${encodeURIComponent(fid)}/dashboard?${qs}`;
      for (let attempt = 0; attempt <= FACTORY_DASH_RETRIES; attempt += 1) {
        try {
          const resp = await fetchJsonWithTimeout(url);
          if (isGatewayOrTimeoutStatus(resp.status)) {
            if (attempt < FACTORY_DASH_RETRIES) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }
            break;
          }
          if (!resp.ok) break;
          const parsed = parseFactoryDashboardFactory(await resp.json());
          if (!parsed || isSparseFactoryDashboard(parsed)) break;
          resultCache.set(cacheKey, {
            at: Date.now(),
            data: { owner_id: Number(oid) || undefined, factories: [parsed] },
          });
          return parsed;
        } catch {
          if (attempt < FACTORY_DASH_RETRIES) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Owner totals with no manager/FO selected.
 * List `/factories/dashboard` is often metric-empty shells; hydrate each
 * `/factories/{id}/dashboard` then aggregate (same fields as FO factory view).
 */
export async function fetchOwnerFactoriesDetailedDashboard(
  ownerId: string | number,
  endDate?: string,
): Promise<FactoryDashboardFactory | null> {
  const oid = String(ownerId ?? "").trim();
  if (!oid) return null;

  const list = await fetchFactoriesOwnerDashboard(oid, endDate);
  const factories = list?.factories ?? [];
  if (
    !factories.length &&
    !list?.days_to_harvest &&
    list?.cci_avg == null &&
    !list?.field_score_distribution &&
    !list?.expected_yield_distribution
  ) {
    return null;
  }

  // Events list endpoint: metrics live on the root; factories are often shells.
  if (list) {
    const rootRollup = parseFactoryDashboardFactory({
      ...(list as Record<string, unknown>),
      factories: undefined,
      factory_id: undefined,
      factory_name: "All factories",
    });
    if (rootRollup && !isSparseFactoryDashboard(rootRollup)) {
      if (list.days_to_harvest) rootRollup.days_to_harvest = list.days_to_harvest;
      if (list.cci_avg != null) rootRollup.cci_avg = asFiniteNumber(list.cci_avg);
      if (list.field_score_distribution) {
        rootRollup.field_score_distribution = list.field_score_distribution;
      }
      if (list.expected_yield_distribution) {
        rootRollup.expected_yield_distribution =
          list.expected_yield_distribution;
      }
      return rootRollup;
    }
  }

  if (!factories.length) return null;

  if (!isSparseFactoriesPayload(list)) {
    const agg = aggregateOwnerFactoriesDashboard(list);
    if (!agg) return null;
    // Owner list root often carries rollup days_to_harvest / cci_avg.
    if (list?.days_to_harvest) agg.days_to_harvest = list.days_to_harvest;
    if (list?.cci_avg != null) agg.cci_avg = asFiniteNumber(list.cci_avg);
    if (list?.field_score_distribution) {
      agg.field_score_distribution = list.field_score_distribution;
    }
    if (list?.expected_yield_distribution) {
      agg.expected_yield_distribution = list.expected_yield_distribution;
    }
    return agg;
  }

  const ids = factories
    .map((f) => f.factory_id)
    .filter((id): id is number => id != null && Number.isFinite(Number(id)));

  if (!ids.length) return null;

  const detailed = await Promise.all(
    ids.map((id) => fetchFactoryOwnerDashboardById(id, oid, endDate)),
  );
  const rich = detailed.filter(
    (f): f is FactoryDashboardFactory => !!f && !isSparseFactoryDashboard(f),
  );
  if (!rich.length) return null;

  const agg = aggregateOwnerFactoriesDashboard({
    owner_id: Number(oid) || undefined,
    factories: rich,
    days_to_harvest: list?.days_to_harvest,
    cci_avg: list?.cci_avg,
    field_score_distribution: list?.field_score_distribution,
    expected_yield_distribution: list?.expected_yield_distribution,
  });
  if (!agg) return null;
  if (!agg.days_to_harvest && list?.days_to_harvest) {
    agg.days_to_harvest = list.days_to_harvest;
  }
  if (agg.cci_avg == null && list?.cci_avg != null) {
    agg.cci_avg = asFiniteNumber(list.cci_avg);
  }
  if (!agg.field_score_distribution && list?.field_score_distribution) {
    agg.field_score_distribution = list.field_score_distribution;
  }
  if (!agg.expected_yield_distribution && list?.expected_yield_distribution) {
    agg.expected_yield_distribution = list.expected_yield_distribution;
  }
  return agg;
}

/** Pick the factory rollup that lists this field officer. */
export function findFactoryForFieldOfficer(
  payload: FactoryDashboardResponse | null | undefined,
  fieldOfficerId: string | number,
): FactoryDashboardFactory | null {
  const fo = String(fieldOfficerId ?? "").trim();
  if (!payload?.factories?.length || !fo) return null;

  for (const factory of payload.factories) {
    const ids = factory.field_officer_ids ?? [];
    if (ids.some((id) => String(id) === fo)) return factory;

    const byDate = factory.data_end_dates_by_field_officer;
    if (byDate && Object.prototype.hasOwnProperty.call(byDate, fo)) {
      return factory;
    }
  }
  return null;
}

export function knownFactoryIds(
  payload: FactoryDashboardResponse | null | undefined,
): Set<string> {
  return new Set(
    (payload?.factories ?? [])
      .map((f) => String(f.factory_id ?? "").trim())
      .filter(Boolean),
  );
}

export function findFactoryById(
  payload: FactoryDashboardResponse | null | undefined,
  factoryId: string | number,
): FactoryDashboardFactory | null {
  const id = String(factoryId ?? "").trim();
  if (!payload?.factories?.length || !id) return null;
  return (
    payload.factories.find((f) => String(f.factory_id ?? "") === id) ?? null
  );
}

/**
 * Accept industry/factory ids only when they appear on GET /factories/dashboard.
 * Django often stores owner_id (e.g. 2476) as industry_id — that 404s on
 * GET /factories/{id}/dashboard. Prefer FO → factory mapping instead.
 */
export function resolveEventsFactoryId(opts: {
  list: FactoryDashboardResponse | null | undefined;
  candidateIds?: Array<string | number | null | undefined>;
  fieldOfficerIds?: Array<string | number | null | undefined>;
}): string {
  const known = knownFactoryIds(opts.list);

  for (const raw of opts.candidateIds ?? []) {
    const id = String(raw ?? "").trim();
    if (id && known.has(id)) return id;
  }

  for (const raw of opts.fieldOfficerIds ?? []) {
    const fo = String(raw ?? "").trim();
    if (!fo) continue;
    const found = findFactoryForFieldOfficer(opts.list, fo);
    if (found?.factory_id != null) {
      const id = String(found.factory_id).trim();
      if (id && known.has(id)) return id;
    }
  }

  return "";
}

/** Local calendar date as YYYY-MM-DD for factories/dashboard?end_date= */
export function factoryDashboardEndDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Owner-level totals when nothing / no FO is selected:
 * sum areas & crop counts across factories; weight yield/biomass/brix/recovery by plots.
 */
export function aggregateOwnerFactoriesDashboard(
  payload: FactoryDashboardResponse | null | undefined,
): FactoryDashboardFactory | null {
  const factories = payload?.factories ?? [];
  if (!factories.length) return null;

  let totalArea = 0;
  let plotCount = 0;
  let tillering = 0;
  let grandGrowth = 0;
  let harvestMaturity = 0;
  let otherOrUnknown = 0;

  let yieldWeighted = 0;
  let yieldWeight = 0;
  let biomassWeighted = 0;
  let biomassWeight = 0;
  let brixWeighted = 0;
  let brixWeight = 0;
  let fieldScoreWeighted = 0;
  let fieldScoreWeight = 0;
  let recoveryWeighted = 0;
  let recoveryWeight = 0;
  let plotsWithRecovery = 0;
  let similarMatching = 0;
  let similarCompared = 0;

  let brixMin: number | null = null;
  let brixMax: number | null = null;
  let yieldMin: number | null = null;
  let yieldMax: number | null = null;
  let biomassMin: number | null = null;
  let biomassMax: number | null = null;

  const allTopFarmers: FactoryTop25Farmer[] = [];
  const foIds = new Set<number>();

  let cciWeighted = 0;
  let cciWeight = 0;
  const daysBuckets: FactoryDaysToHarvest[] = [];
  const fieldScoreBuckets: FactoryFieldScoreDistribution[] = [];
  const yieldBuckets: FactoryExpectedYieldDistribution[] = [];

  for (const f of factories) {
    const plots = Number(f.plot_count ?? 0) || 0;
    const area = asFiniteNumber(f.total_field_area_acres) ?? 0;
    totalArea += area;
    plotCount += plots;

    if (f.days_to_harvest) daysBuckets.push(f.days_to_harvest);
    if (f.field_score_distribution) {
      fieldScoreBuckets.push(f.field_score_distribution);
    }
    if (f.expected_yield_distribution) {
      yieldBuckets.push(f.expected_yield_distribution);
    }
    const cci = asFiniteNumber(f.cci_avg);
    if (cci != null) {
      const cw = plots > 0 ? plots : 1;
      cciWeighted += cci * cw;
      cciWeight += cw;
    }

    const counts = f.crop_status?.counts;
    if (counts) {
      tillering += Number(counts.tillering ?? 0) || 0;
      grandGrowth += Number(counts.grand_growth ?? 0) || 0;
      harvestMaturity += Number(counts.harvest_maturity ?? 0) || 0;
      otherOrUnknown += Number(counts.other_or_unknown ?? 0) || 0;
    } else if (f.crop_status && plots > 0) {
      // Derive counts from stage % when API omits counts
      const cs = f.crop_status;
      tillering += Math.round(((Number(cs.tillering_pct) || 0) / 100) * plots);
      grandGrowth += Math.round(
        ((Number(cs.grand_growth_pct) || 0) / 100) * plots,
      );
      harvestMaturity += Math.round(
        ((Number(cs.harvest_maturity_pct) || 0) / 100) * plots,
      );
      otherOrUnknown += Math.round(
        ((Number(cs.other_or_unknown_pct) || 0) / 100) * plots,
      );
    }

    const w = plots > 0 ? plots : area > 0 ? area : 1;
    const y = asFiniteNumber(
      f.expected_yield_t_per_acre ?? f.average_yield_t_per_acre,
    );
    if (y != null) {
      yieldWeighted += y * w;
      yieldWeight += w;
    }
    const yMin = asFiniteNumber(f.expected_yield_min_t_per_acre);
    const yMax = asFiniteNumber(f.expected_yield_max_t_per_acre);
    if (yMin != null) yieldMin = yieldMin == null ? yMin : Math.min(yieldMin, yMin);
    if (yMax != null) yieldMax = yieldMax == null ? yMax : Math.max(yieldMax, yMax);

    const bio = asFiniteNumber(f.biomass_avg_t_per_acre);
    if (bio != null) {
      biomassWeighted += bio * w;
      biomassWeight += w;
    }
    const bioMin = asFiniteNumber(f.biomass_min_t_per_acre);
    const bioMax = asFiniteNumber(f.biomass_max_t_per_acre);
    if (bioMin != null) {
      biomassMin = biomassMin == null ? bioMin : Math.min(biomassMin, bioMin);
    }
    if (bioMax != null) {
      biomassMax = biomassMax == null ? bioMax : Math.max(biomassMax, bioMax);
    }

    const brix = asFiniteNumber(f.brix_avg);
    if (brix != null) {
      const bw = Number((f as { brix_plots?: number }).brix_plots ?? plots) || w;
      brixWeighted += brix * bw;
      brixWeight += bw;
    }
    const bxMin = asFiniteNumber(f.brix_min);
    const bxMax = asFiniteNumber(f.brix_max);
    if (bxMin != null) brixMin = brixMin == null ? bxMin : Math.min(brixMin, bxMin);
    if (bxMax != null) brixMax = brixMax == null ? bxMax : Math.max(brixMax, bxMax);
    const fs = asFiniteNumber(f.field_score_avg);
    if (fs != null) {
      fieldScoreWeighted += fs * w;
      fieldScoreWeight += w;
    }

    const recPlots = Number(f.recovery?.plots_with_recovery ?? 0) || 0;
    const recAvg = asFiniteNumber(f.recovery?.factory_avg_pct);
    if (recAvg != null && recPlots > 0) {
      recoveryWeighted += recAvg * recPlots;
      recoveryWeight += recPlots;
      plotsWithRecovery += recPlots;
    } else if (recAvg != null) {
      recoveryWeighted += recAvg * w;
      recoveryWeight += w;
    }

    similarMatching += Number(f.recovery?.similar_plots?.matching_plots ?? 0) || 0;
    similarCompared += Number(f.recovery?.similar_plots?.plots_compared ?? 0) || 0;

    for (const farmer of f.recovery?.top_25_farmers?.farmers ?? []) {
      if (farmer?.farmer_id == null) continue;
      allTopFarmers.push({
        farmer_id: Number(farmer.farmer_id),
        farmer_name: String(farmer.farmer_name ?? ""),
        recovery_avg_pct: Number(farmer.recovery_avg_pct) || 0,
        plot_count: Number(farmer.plot_count) || 0,
      });
    }

    for (const id of f.field_officer_ids ?? []) {
      const n = Number(id);
      if (Number.isFinite(n)) foIds.add(n);
    }
  }

  const stageTotal =
    tillering + grandGrowth + harvestMaturity + otherOrUnknown || plotCount;
  const pct = (n: number) =>
    stageTotal > 0 ? Math.round((n / stageTotal) * 10000) / 100 : 0;

  const topFarmers = [...allTopFarmers]
    .sort((a, b) => b.recovery_avg_pct - a.recovery_avg_pct)
    .slice(0, 25);
  const top25Avg =
    topFarmers.length > 0
      ? Math.round(
          (topFarmers.reduce((s, f) => s + f.recovery_avg_pct, 0) /
            topFarmers.length) *
            100,
        ) / 100
      : null;

  const similarPercent =
    similarCompared > 0
      ? Math.round((similarMatching / similarCompared) * 10000) / 100
      : null;

  return {
    owner_id: payload?.owner_id,
    factory_id: undefined,
    factory_name: "All factories",
    field_officer_ids: Array.from(foIds),
    plot_count: plotCount,
    total_field_area_acres:
      Math.round(totalArea * 100) / 100 || null,
    average_yield_t_per_acre:
      yieldWeight > 0
        ? Math.round((yieldWeighted / yieldWeight) * 100) / 100
        : null,
    expected_yield_t_per_acre:
      yieldWeight > 0
        ? Math.round((yieldWeighted / yieldWeight) * 100) / 100
        : null,
    expected_yield_min_t_per_acre: yieldMin,
    expected_yield_max_t_per_acre: yieldMax,
    biomass_avg_t_per_acre:
      biomassWeight > 0
        ? Math.round((biomassWeighted / biomassWeight) * 100) / 100
        : null,
    biomass_min_t_per_acre: biomassMin,
    biomass_max_t_per_acre: biomassMax,
    brix_avg:
      brixWeight > 0
        ? Math.round((brixWeighted / brixWeight) * 100) / 100
        : null,
    brix_min: brixMin,
    brix_max: brixMax,
    field_score_avg:
      fieldScoreWeight > 0
        ? Math.round((fieldScoreWeighted / fieldScoreWeight) * 100) / 100
        : null,
    cci_avg:
      asFiniteNumber(payload?.cci_avg) ??
      (cciWeight > 0
        ? Math.round((cciWeighted / cciWeight) * 100) / 100
        : null),
    days_to_harvest:
      parseDaysToHarvest(payload?.days_to_harvest) ??
      sumDaysToHarvest(daysBuckets),
    field_score_distribution:
      parseFieldScoreDistribution(payload?.field_score_distribution) ??
      sumFieldScoreDistribution(fieldScoreBuckets),
    expected_yield_distribution:
      parseExpectedYieldDistribution(payload?.expected_yield_distribution) ??
      sumExpectedYieldDistribution(yieldBuckets),
    crop_status: {
      tillering_pct: pct(tillering),
      grand_growth_pct: pct(grandGrowth),
      harvest_maturity_pct: pct(harvestMaturity),
      other_or_unknown_pct: pct(otherOrUnknown),
      counts: {
        tillering,
        grand_growth: grandGrowth,
        harvest_maturity: harvestMaturity,
        other_or_unknown: otherOrUnknown,
        total_plots: stageTotal || plotCount,
      },
    },
    recovery: {
      factory_avg_pct:
        recoveryWeight > 0
          ? Math.round((recoveryWeighted / recoveryWeight) * 100) / 100
          : null,
      plots_with_recovery: plotsWithRecovery,
      top_25_farmers: {
        count: topFarmers.length,
        average_recovery_pct: top25Avg,
        farmers: topFarmers,
      },
      similar_plots: {
        tolerance_pct_points: 0.5,
        matching_plots: similarMatching,
        plots_compared: similarCompared,
        percent: similarPercent,
      },
    },
  };
}

/** Apply factory rollup into recovery peer chart state. */
export function factoryRecoveryPeersFromRollup(
  factory: FactoryDashboardFactory | null | undefined,
): {
  factoryAvg: number | null;
  top25Avg: number | null;
  similarPct: number | null;
  topFarmerAvg: number | null;
  topFarmers: FactoryTop25Farmer[];
} {
  const topBlock = factory?.recovery?.top_25_farmers;
  const topFarmers = Array.isArray(topBlock?.farmers) ? topBlock.farmers : [];
  return {
    factoryAvg: asFiniteNumber(factory?.recovery?.factory_avg_pct),
    top25Avg: asFiniteNumber(topBlock?.average_recovery_pct),
    similarPct: asFiniteNumber(factory?.recovery?.similar_plots?.percent),
    topFarmerAvg:
      topFarmers.length > 0
        ? asFiniteNumber(topFarmers[0]?.recovery_avg_pct)
        : null,
    topFarmers,
  };
}

/**
 * Crop Status: show all three industry stages with counts from crop_status.counts
 * e.g. "Harvest Maturity: 456 · Grand Growth: 55 · Tillering: 2"
 */
export function formatFactoryCropStatusLabel(
  factory: FactoryDashboardFactory | null | undefined,
): string | null {
  const counts = factory?.crop_status?.counts;
  if (!counts) return null;

  const stages: Array<{ key: keyof typeof counts; label: string }> = [
    { key: "harvest_maturity", label: "Harvest Maturity" },
    { key: "grand_growth", label: "Grand Growth" },
    { key: "tillering", label: "Tillering" },
  ];

  const parts = stages.map((stage) => {
    const n = Number(counts[stage.key] ?? 0) || 0;
    return `${stage.label}: ${n}`;
  });

  const total = Number(counts.total_plots ?? 0) || 0;
  if (parts.every((p) => p.endsWith(": 0")) && total <= 0) return null;
  return parts.join(" · ");
}

/** Recovery chart bars: only recovery-% peers (Regional + Top 25).
 *  Do NOT plot `similar_plots.percent` here — that is a share of matching plots,
 *  not a recovery rate, and skews the comparison axis.
 */
export function factoryRecoveryComparisonBars(
  factory: FactoryDashboardFactory | null | undefined,
): Array<{ name: string; value: number; fill: string; label: string }> {
  if (!factory?.recovery) return [];

  const regional = asFiniteNumber(factory.recovery.factory_avg_pct);
  const top25 = asFiniteNumber(
    factory.recovery.top_25_farmers?.average_recovery_pct,
  );

  const bars: Array<{
    name: string;
    value: number;
    fill: string;
    label: string;
  }> = [];
  if (regional != null) {
    bars.push({
      name: "Regional",
      value: regional,
      fill: "#3b82f6",
      label: "Regional (factory avg recovery)",
    });
  }
  if (top25 != null) {
    bars.push({
      name: "Top 25",
      value: top25,
      fill: "#22c55e",
      label: "Top 25 farmers avg recovery",
    });
  }
  return bars;
}

export type FoMapPlot = {
  plotId: string;
  positions: [number, number][];
  status?: string | null;
  areaAcres?: number | null;
  /** Factory / industry id when known (for manager filter). */
  factoryId?: string | null;
};

/** Keep only plots whose field_officer_id is in `officerIds` (null/empty = keep all). */
export function filterAgroStatsByOfficerIds(
  agroStats: Record<string, unknown> | null | undefined,
  officerIds: Set<string> | null | undefined,
): Record<string, unknown> | null {
  if (!agroStats || typeof agroStats !== "object") return null;
  if (!officerIds || officerIds.size === 0) return agroStats;

  const out: Record<string, unknown> = {};
  for (const [plotId, raw] of Object.entries(agroStats)) {
    if (!raw || typeof raw !== "object") continue;
    const foId = (raw as Record<string, unknown>).field_officer_id;
    if (foId != null && officerIds.has(String(foId))) {
      out[plotId] = raw;
    }
  }
  // If metadata was missing, don't hide the whole map.
  return Object.keys(out).length > 0 ? out : agroStats;
}

function ringToLatLng(coords: unknown): [number, number][] {
  if (!Array.isArray(coords)) return [];
  const positions: [number, number][] = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const a = Number(pt[0]);
    const b = Number(pt[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    // GeoJSON [lng, lat]
    const lng = Math.abs(a) <= 180 && Math.abs(b) <= 90 ? a : b;
    const lat = Math.abs(a) <= 180 && Math.abs(b) <= 90 ? b : a;
    if (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5) continue;
    positions.push([lat, lng]);
  }
  return positions;
}

/** Flatten FO agroStats whether plots are top-level or nested under plots/data. */
export function flattenAgroStatsPlots(
  agroStats: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!agroStats || typeof agroStats !== "object") return {};

  const nested =
    (agroStats.plots && typeof agroStats.plots === "object"
      ? (agroStats.plots as Record<string, unknown>)
      : null) ||
    (agroStats.data && typeof agroStats.data === "object"
      ? (agroStats.data as Record<string, unknown>)
      : null) ||
    (agroStats.results && typeof agroStats.results === "object"
      ? (agroStats.results as Record<string, unknown>)
      : null);

  const source = nested ?? agroStats;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== "object") continue;
    const plot = raw as Record<string, unknown>;
    // Skip non-plot metadata bags
    if (
      plot.factories != null ||
      plot.field_officers != null ||
      Array.isArray(plot)
    ) {
      continue;
    }
    out[key] = raw;
  }
  return out;
}

function extractPlotRing(plot: Record<string, any>): [number, number][] {
  const candidates = [
    plot.geometry?.coordinates?.[0],
    plot.geometry?.coordinates,
    plot.boundary?.coordinates?.[0],
    plot.boundary?.coordinates,
    plot.coordinates?.boundary?.coordinates?.[0],
    plot.coordinates?.boundary?.coordinates,
    plot.polygon?.coordinates?.[0],
  ];
  for (const ring of candidates) {
    const positions = ringToLatLng(ring);
    if (positions.length >= 3) return positions;
  }
  return [];
}

/** Leaflet [lat, lng] rings from FO agroStats plot geometries (all industries when unfiltered). */
export function buildFoMapPlotsFromAgroStats(
  agroStats: Record<string, unknown> | null | undefined,
): FoMapPlot[] {
  const flat = flattenAgroStatsPlots(agroStats);
  const plots: FoMapPlot[] = [];

  for (const [plotId, raw] of Object.entries(flat)) {
    if (!raw || typeof raw !== "object") continue;
    const plot = raw as Record<string, any>;
    const positions = extractPlotRing(plot);
    if (positions.length < 3) continue;

    const area = Number(plot.area_acres ?? plot.soil?.area_acres) || null;
    const fastapi =
      plot.fastapi_plot_id != null && String(plot.fastapi_plot_id).trim()
        ? String(plot.fastapi_plot_id).trim()
        : "";
    const gat = plot.gat_number != null ? String(plot.gat_number).trim() : "";
    const num = plot.plot_number != null ? String(plot.plot_number).trim() : "";
    const gatPlot = gat && num ? `${gat}/${num}` : "";
    const resolvedId =
      fastapi ||
      gatPlot ||
      String(plotId).replace(/^"|"$/g, "").replace(/_/g, "/");

    plots.push({
      plotId: resolvedId,
      positions,
      status: plot.Sugarcane_Status ?? plot.sugarcane_status ?? null,
      areaAcres: area != null && Number.isFinite(area) ? area : null,
      factoryId:
        plot.factory_id != null
          ? String(plot.factory_id)
          : plot.industry_id != null
            ? String(plot.industry_id)
            : null,
    });
  }
  return plots;
}

/** Map polygons from GET /plots/owner-factory-boundaries/ (all owner industries). */
export function buildFoMapPlotsFromOwnerBoundaries(
  boundaryPlots: Array<Record<string, any>> | null | undefined,
): FoMapPlot[] {
  if (!Array.isArray(boundaryPlots) || boundaryPlots.length === 0) return [];

  const byId = new Map<string, FoMapPlot>();

  for (const plot of boundaryPlots) {
    if (!plot || typeof plot !== "object") continue;
    const positions = extractPlotRing(plot);
    if (positions.length < 3) continue;

    const fastapi =
      plot.fastapi_plot_id != null && String(plot.fastapi_plot_id).trim()
        ? String(plot.fastapi_plot_id).trim()
        : "";
    const gat = plot.gat_number != null ? String(plot.gat_number).trim() : "";
    const num = plot.plot_number != null ? String(plot.plot_number).trim() : "";
    const gatSlash = gat && num ? `${gat}/${num}` : "";
    const gatUnder = gat && num ? `${gat}_${num}` : "";
    const rawId =
      plot.plot_id != null && String(plot.plot_id).trim()
        ? String(plot.plot_id).trim()
        : "";
    const plotId = fastapi || gatSlash || gatUnder || rawId;
    if (!plotId) continue;

    const area = Number(plot.area_acres ?? plot.area_size) || null;
    const factoryId =
      plot.factory_id != null
        ? String(plot.factory_id)
        : plot.industry_id != null
          ? String(plot.industry_id)
          : plot.factory?.id != null
            ? String(plot.factory.id)
            : null;

    // Prefer slash form as canonical map id (matches floss / tile APIs).
    const canonical = plotId.includes("_") && !plotId.includes("/")
      ? plotId.replace(/_/g, "/")
      : plotId;

    if (!byId.has(canonical)) {
      byId.set(canonical, {
        plotId: canonical,
        positions,
        status: plot.Sugarcane_Status ?? plot.sugarcane_status ?? null,
        areaAcres: area != null && Number.isFinite(area) ? area : null,
        factoryId,
      });
    }
  }

  return Array.from(byId.values());
}

/** Merge map plots; keep first geometry, fill missing factory/status from later. */
export function mergeFoMapPlots(
  primary: FoMapPlot[],
  secondary: FoMapPlot[],
): FoMapPlot[] {
  const byKey = new Map<string, FoMapPlot>();
  const keyOf = (id: string) =>
    id.trim().toLowerCase().replace(/\//g, "_");

  for (const p of [...primary, ...secondary]) {
    const k = keyOf(p.plotId);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, p);
      continue;
    }
    byKey.set(k, {
      ...prev,
      status: prev.status ?? p.status,
      areaAcres: prev.areaAcres ?? p.areaAcres,
      factoryId: prev.factoryId ?? p.factoryId,
      positions:
        prev.positions.length >= p.positions.length
          ? prev.positions
          : p.positions,
    });
  }
  return Array.from(byKey.values());
}

/** Filter owner map plots to one factory / industry (manager selection). */
export function filterFoMapPlotsByFactoryId(
  plots: FoMapPlot[],
  factoryId: string | number | null | undefined,
): FoMapPlot[] {
  const fid = factoryId != null ? String(factoryId).trim() : "";
  if (!fid) return plots;
  const matched = plots.filter(
    (p) => p.factoryId != null && String(p.factoryId) === fid,
  );
  // If factory metadata missing on polygons, keep all rather than blank map.
  return matched.length > 0 ? matched : plots;
}
