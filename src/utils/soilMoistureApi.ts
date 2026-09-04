/**
 * Soil moisture — same logic as CropO Flutter SoilMoistureApi:
 *   1) GET /irrigation-and-soil-moisture/{plot_name}  (path, preferred)
 *   2) GET /soil-moisture/{plot_name}                 (legacy fallback)
 * Prefer soil_moisture_uncapped when present.
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";
import { getCache, setCache } from "./cache";

const SOIL_MOISTURE_TIMEOUT_MS = 30_000;
const SOIL_MOISTURE_CACHE_MS = 15 * 60 * 1000;

export type SoilMoistureDay = {
  day: string;
  soil_moisture: number;
  rainfall_mm_yesterday?: number;
  rainfall_provisional?: boolean;
  et_mean_mm_yesterday?: number;
  /** Surplus (+) / deficit (−) liters when API provides it (water-balance style). */
  water_remain_liters?: number;
};

export type SoilMoistureParsed = {
  plotName: string;
  latitude?: number;
  longitude?: number;
  currentMoisture: number;
  stack: SoilMoistureDay[];
  raw: any;
};

function sefBaseUrl(): string {
  return (
    String(import.meta.env.VITE_DEV_FIELD_API_URL ?? "")
      .trim()
      .replace(/\/$/, "") || "https://sef-cropeye.up.railway.app"
  );
}

function toFinite(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer the selected/fastapi id as-is; try both slash and underscore forms. */
function orderSoilMoistureCandidates(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const s = String(v ?? "").trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const c of candidates) {
    push(c);
    if (c.includes("_")) push(c.replace(/_/g, "/"));
    if (c.includes("/")) push(c.replace(/\//g, "_"));
  }
  return out;
}

function normalizeStackItem(item: any): SoilMoistureDay | null {
  if (!item || typeof item !== "object") return null;
  const day = String(item.day ?? item.date ?? "").slice(0, 10);
  // Flutter: uncapped → soil_moisture → capped
  const moisture =
    toFinite(item.soil_moisture_uncapped) ??
    toFinite(item.soil_moisture) ??
    toFinite(item.soil_moisture_capped) ??
    toFinite(item.smanchor) ??
    toFinite(item.value) ??
    toFinite(item.moisture);
  if (!day || moisture == null) return null;
  const waterRemain =
    toFinite(item.water_remain_liters) ??
    toFinite(item.waterRemainLiters) ??
    toFinite(item.water_remain_kl) ??
    toFinite(item.remain_liters);
  return {
    day,
    soil_moisture: moisture,
    rainfall_mm_yesterday:
      toFinite(item.rainfall_mm_yesterday) ??
      toFinite(item.rainfall_mm) ??
      undefined,
    rainfall_provisional: Boolean(item.rainfall_provisional),
    et_mean_mm_yesterday:
      toFinite(item.et_mean_mm_yesterday) ??
      toFinite(item.eto) ??
      toFinite(item.et_adj) ??
      undefined,
    water_remain_liters: waterRemain ?? undefined,
  };
}

/** Normalize SEF/old soil-moisture JSON into a daily stack + current value. */
export function parseSoilMoistureResponse(data: any): SoilMoistureParsed | null {
  if (!data || typeof data !== "object") return null;

  const stackRaw =
    (Array.isArray(data.time_series) && data.time_series) ||
    (Array.isArray(data.soil_moisture_stack) && data.soil_moisture_stack) ||
    (Array.isArray(data.series) && data.series) ||
    (Array.isArray(data.data) && data.data) ||
    (Array.isArray(data) ? data : null);

  const stack = (stackRaw || [])
    .map(normalizeStackItem)
    .filter((row: SoilMoistureDay | null): row is SoilMoistureDay => row != null)
    .sort((a: SoilMoistureDay, b: SoilMoistureDay) => a.day.localeCompare(b.day));

  // Flutter prefers uncapped final when present.
  const current =
    toFinite(data.final_soil_moisture_uncapped) ??
    toFinite(data.final_soil_moisture_capped) ??
    toFinite(data.smanchor_used) ??
    (stack.length ? stack[stack.length - 1].soil_moisture : null);

  if (current == null && !stack.length) return null;

  const filledStack =
    stack.length > 0
      ? stack
      : [
          {
            day: new Date().toISOString().slice(0, 10),
            soil_moisture: current as number,
          },
        ];

  return {
    plotName: String(data.plot_name ?? ""),
    latitude: toFinite(data.latitude) ?? undefined,
    longitude: toFinite(data.longitude) ?? undefined,
    currentMoisture: current ?? filledStack[filledStack.length - 1].soil_moisture,
    stack: filledStack,
    raw: data,
  };
}

async function fetchJsonGet(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOIL_MOISTURE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      mode: "cors",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const err = new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
      (err as Error & { status?: number }).status = resp.status;
      throw err;
    }
    return await resp.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Soil moisture timed out after ${SOIL_MOISTURE_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Flutter preferred + legacy GET paths for one plot name. */
async function getSoilMoistureOnce(plotName: string): Promise<any> {
  const cacheKey = `soil_moisture:${plotName.trim()}`;
  const cached = getCache(cacheKey, SOIL_MOISTURE_CACHE_MS);
  if (cached) return cached;

  const base = sefBaseUrl();
  const encoded = encodeURIComponent(plotName);
  const preferred = `${base}/irrigation-and-soil-moisture/${encoded}`;
  const legacy = `${base}/soil-moisture/${encoded}`;

  let preferredRaw: any = null;
  try {
    preferredRaw = await fetchJsonGet(preferred);
  } catch (err: any) {
    const status = err?.status;
    // Network / 404 / 405 → try legacy (same as Flutter).
    if (status != null && status !== 404 && status !== 405) {
      // Still try legacy once for robustness, then throw if both fail.
    }
  }

  let legacyRaw: any = null;
  try {
    legacyRaw = await fetchJsonGet(legacy);
  } catch {
    /* optional enrich / fallback */
  }

  if (preferredRaw) {
    const preferredParsed = parseSoilMoistureResponse(preferredRaw);
    const needsCoords =
      !preferredParsed?.latitude && !preferredParsed?.longitude;
    if (needsCoords && legacyRaw) {
      const legacyParsed = parseSoilMoistureResponse(legacyRaw);
      const merged = {
        ...preferredRaw,
        latitude: preferredRaw.latitude ?? legacyRaw.latitude,
        longitude: preferredRaw.longitude ?? legacyRaw.longitude,
        plot_name:
          preferredRaw.plot_name || legacyRaw.plot_name || plotName,
        time_series:
          preferredRaw.time_series ??
          preferredRaw.soil_moisture_stack ??
          legacyRaw.time_series ??
          legacyRaw.soil_moisture_stack,
      };
      setCache(cacheKey, merged);
      return merged;
    }
    setCache(cacheKey, preferredRaw);
    return preferredRaw;
  }

  if (legacyRaw) {
    setCache(cacheKey, legacyRaw);
    return legacyRaw;
  }

  // Last resort: older CropEye POST body form (some deployments only).
  try {
    const resp = await fetch(`${base}/soil-moisture`, {
      method: "POST",
      mode: "cors",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plot_name: plotName }),
    });
    if (resp.ok) {
      const raw = await resp.json();
      setCache(cacheKey, raw);
      return raw;
    }
  } catch {
    /* ignore */
  }

  throw new Error(`Soil moisture GET failed for "${plotName}"`);
}

/** Fetch soil moisture stack — Flutter SoilMoistureApi.fetch equivalent. */
export async function fetchSoilMoistureForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
): Promise<SoilMoistureParsed> {
  if (!plotId?.trim()) throw new Error("Missing plot name");

  const candidates = orderSoilMoistureCandidates(
    getPlotNameCandidates(plotId, plots),
  );
  let lastErr: Error | null = null;

  for (const candidate of candidates) {
    try {
      const raw = await getSoilMoistureOnce(candidate);
      const parsed = parseSoilMoistureResponse(raw);
      if (!parsed) {
        lastErr = new Error("Soil moisture response had no usable values");
        continue;
      }
      return { ...parsed, plotName: parsed.plotName || candidate };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr || new Error("Soil moisture API failed");
}

/** Sugarcane / crop moisture reference bands (Flutter SoilMoistureGraphWidget). */
export function moistureBandForCrop(crop: string): {
  minOptimal: number;
  maxOptimal: number;
  wiltingPoint: number;
  saturationPoint: number;
} {
  const c = String(crop ?? "").toLowerCase();
  if (c.includes("sugarcane")) {
    return { minOptimal: 45, maxOptimal: 70, wiltingPoint: 25, saturationPoint: 85 };
  }
  if (c.includes("tomato")) {
    return { minOptimal: 40, maxOptimal: 65, wiltingPoint: 22, saturationPoint: 82 };
  }
  if (c.includes("maize") || c.includes("corn")) {
    return { minOptimal: 45, maxOptimal: 70, wiltingPoint: 25, saturationPoint: 85 };
  }
  if (c.includes("wheat") || c.includes("cotton")) {
    return { minOptimal: 35, maxOptimal: 60, wiltingPoint: 18, saturationPoint: 78 };
  }
  if (c.includes("rice") || c.includes("paddy")) {
    return { minOptimal: 55, maxOptimal: 80, wiltingPoint: 35, saturationPoint: 92 };
  }
  if (c.includes("grape")) {
    return { minOptimal: 35, maxOptimal: 58, wiltingPoint: 20, saturationPoint: 80 };
  }
  return { minOptimal: 40, maxOptimal: 65, wiltingPoint: 22, saturationPoint: 82 };
}
