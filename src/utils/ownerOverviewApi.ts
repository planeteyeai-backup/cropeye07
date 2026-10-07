/**
 * Data fetchers for the Owner Overview bird's-eye view.
 * Reuses the same endpoints + cache keys as OwnerFarmDash so data is shared.
 */
import axios from "axios";
import api, {
  encodePlotIdForEventsUrl,
  eventsApi,
  getFarmersByFieldOfficer,
  parseFarmersByFieldOfficerResponse,
} from "../api";
import { getCache, setCache } from "./cache";
import {
  factoryDashboardEndDate,
  fetchFactoriesOwnerDashboard,
  fetchFactoryOwnerDashboardById,
  resolveEventsFactoryId,
  type FactoryDashboardFactory,
} from "./factoryOwnerDashboard";
import { resolveProgressOwnerId } from "../components/progressbar/useFactoryProgress";
import { fetchFieldScoreForPlot } from "./fieldScore";
import { fetchWaterStressAnalysis, parseWaterStressMetrics } from "./waterStressApi";
import type { IndexPoint } from "./ownerOverview";

const EVENTS_BASE = "https://events-cropeye.up.railway.app";
const SLOW_TIMEOUT_MS = 90_000;

/** Load every page so the owner overview includes the officer's full farmer list. */
export async function fetchAllFarmersByFieldOfficer(
  fieldOfficerId: string | number,
  maxPages = 50,
): Promise<any[]> {
  const farmers: any[] = [];
  let nextPath: string | null = null;
  let pageCount = 0;

  do {
    if (pageCount >= maxPages) {
      throw new Error(`Farmers-by-field-officer pagination exceeded ${maxPages} pages.`);
    }
    pageCount += 1;
    const response = nextPath
      ? await api.get(nextPath)
      : await getFarmersByFieldOfficer(fieldOfficerId);
    const data = response?.data;
    farmers.push(...parseFarmersByFieldOfficerResponse(data));

    const nextUrl: unknown = data?.next;
    if (typeof nextUrl !== "string" || !nextUrl) {
      nextPath = null;
    } else {
      try {
        const parsed = new URL(nextUrl);
        nextPath = `${parsed.pathname}${parsed.search}`.replace(/^\/api/, "");
      } catch {
        nextPath = nextUrl.startsWith("/") ? nextUrl : null;
      }
      if (!nextPath) {
        throw new Error("Farmers-by-field-officer returned an invalid next-page URL.");
      }
    }
  } while (nextPath);

  const seen = new Set<string>();
  return farmers.filter((farmer) => {
    const id = farmer?.id ?? farmer?.user_id ?? farmer?.farmer_id;
    if (id == null || String(id).trim() === "") return true;
    const key = String(id).trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function indexValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function indexRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  if (!payload || typeof payload !== "object") return [];
  const response = payload as Record<string, unknown>;
  for (const key of ["data", "results", "items", "indices", "observations"]) {
    const value = response[key];
    if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }
  return [];
}

function firstIndexValue(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = indexValue(row[key]);
    if (value != null) return value;
  }
  return null;
}

function factoryIdCandidates(manager: any): string[] {
  const raw = [
    manager?.industry_id,
    manager?.industry?.industry_id,
    manager?.industry?.id,
    manager?.factory_id,
    manager?.factory?.id,
  ];
  const out: string[] = [];
  for (const v of raw) {
    if (v == null || v === "") continue;
    const n = Number(v);
    const id = Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : String(v).trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Manager → Events factory → GET /factories/{id}/dashboard (crop status,
 * days-to-harvest, field-score + yield distributions, brix, recovery, CCI, biomass).
 */
export async function fetchManagerRollup(
  managerRaw: any,
  fieldOfficerIds: string[],
): Promise<{ factory: FactoryDashboardFactory | null; factoryId: string }> {
  const ownerId = String(resolveProgressOwnerId() || "");
  if (!ownerId) return { factory: null, factoryId: "" };
  const endDate = factoryDashboardEndDate();
  const list = await fetchFactoriesOwnerDashboard(ownerId, endDate).catch(() => null);
  const factoryId = resolveEventsFactoryId({
    list,
    candidateIds: factoryIdCandidates(managerRaw),
    fieldOfficerIds,
  });
  if (!factoryId) return { factory: null, factoryId: "" };
  const factory = await fetchFactoryOwnerDashboardById(factoryId, ownerId, endDate).catch(() => null);
  return { factory, factoryId };
}

/** GET /plots/{id}/indices → time series (same mapping + cache key as OwnerFarmDash). */
export async function fetchPlotIndices(plotKey: string): Promise<IndexPoint[] | null> {
  const cacheKey = `ownerOverview_indices_v2_${plotKey}`;
  const cached = getCache(cacheKey);
  if (Array.isArray(cached) && cached.length > 0) return cached as IndexPoint[];
  try {
    const res = await eventsApi.get(`/plots/${encodePlotIdForEventsUrl(plotKey)}/indices`, {
      timeout: SLOW_TIMEOUT_MS,
    });
    const rows = indexRows(res.data);
    const mapped: IndexPoint[] = rows
      .flatMap((r) => {
        const date = r.date ?? r.timestamp ?? r.acquisition_date ?? r.created_at;
        if (!date) return [];
        const timestamp = new Date(String(date)).getTime();
        if (!Number.isFinite(timestamp)) return [];
        return [{
          date: new Date(timestamp).toISOString().split("T")[0],
          growth: firstIndexValue(r, "NDVI", "ndvi", "ndvi_mean"),
          stress: firstIndexValue(r, "NDMI", "ndmi", "ndmi_mean"),
          water: firstIndexValue(r, "NDWI", "ndwi", "ndwi_mean"),
          moisture: firstIndexValue(r, "NDRE", "ndre", "ndre_mean"),
        }];
      });
    if (mapped.length > 0) setCache(cacheKey, mapped);
    return mapped;
  } catch (error) {
    console.warn(`Could not load index history for plot ${plotKey}.`, error);
    return null;
  }
}

/** GET /plots/{id}/stress?index_type=NDRE&threshold=0.15 → count + stress days. */
export async function fetchPlotStress(plotKey: string): Promise<{ events: number; days: number | null } | null> {
  const cacheKey = `stress_${plotKey}_NDRE_0.15`;
  let data: any = getCache(cacheKey);
  if (!data) {
    try {
      const res = await axios.get(
        `${EVENTS_BASE}/plots/${encodePlotIdForEventsUrl(plotKey)}/stress?index_type=NDRE&threshold=0.15`,
        { timeout: SLOW_TIMEOUT_MS, headers: { Accept: "application/json" } },
      );
      data = res.data;
      setCache(cacheKey, data);
    } catch {
      return null;
    }
  }
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  let days = 0;
  for (const e of events) {
    const d = Number(e?.duration_days ?? e?.duration ?? e?.days);
    if (Number.isFinite(d)) days += d;
    else if (e?.start_date && e?.end_date) {
      const diff = (new Date(e.end_date).getTime() - new Date(e.start_date).getTime()) / 86_400_000;
      if (Number.isFinite(diff)) days += Math.max(1, Math.round(diff));
    }
  }
  return { events: events.length, days: days || null };
}

/** SEF field score (0–100) — only used for small scopes (farmer / plot). */
export async function fetchPlotFieldScore(plotKey: string): Promise<number | null> {
  try {
    return await fetchFieldScoreForPlot(plotKey);
  } catch {
    return null;
  }
}

/** SAR water-stress → CCI (0–100) + stress counts — farmer / plot scope only (slow API). */
export async function fetchPlotCondition(
  plotKey: string,
  plantationDate: string | null,
): Promise<{ cci: number | null; stressEvents: number | null; stressDays: number | null } | null> {
  try {
    const data = await fetchWaterStressAnalysis(plotKey, { plantationDate });
    if (!data) return null;
    const m = parseWaterStressMetrics(data);
    const pctVal = data.cci?.value_percent ?? data.average_cci?.value_percent;
    return {
      cci: pctVal != null ? Number(pctVal) : m.cropConditionValue != null ? m.cropConditionValue * 10 : null,
      stressEvents: m.stressCount,
      stressDays: m.stressTotalDays,
    };
  } catch {
    return null;
  }
}

/** Run async jobs with a concurrency limit; `onDone` streams results as they land. */
export async function runQueue<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onDone: (item: T, result: R) => void,
  isCancelled: () => boolean,
): Promise<void> {
  let i = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      if (isCancelled()) return;
      const item = items[i++];
      const result = await worker(item);
      if (isCancelled()) return;
      onDone(item, result);
    }
  });
  await Promise.all(lanes);
}

/** Spread a sample across field officers (round-robin) so every FO is represented. */
export function sampleAcrossOfficers<T extends { fieldOfficerId: string }>(plots: T[], limit: number): T[] {
  if (plots.length <= limit) return plots;
  const byFo = new Map<string, T[]>();
  for (const p of plots) byFo.set(p.fieldOfficerId, [...(byFo.get(p.fieldOfficerId) ?? []), p]);
  const queues = [...byFo.values()];
  const out: T[] = [];
  let idx = 0;
  while (out.length < limit && queues.some((q) => q.length)) {
    const q = queues[idx % queues.length];
    if (q.length) out.push(q.shift() as T);
    idx += 1;
  }
  return out;
}
