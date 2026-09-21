/**
 * Analysis image dates for the map timeline ribbon (optional).
 * GET /stored-tiles is disabled — Growth layers use calendar date fallbacks.
 */
import {
  getSarIndexBaseUrl,
  isSarMappingHostAvailable,
  sarIndexUpstream,
} from "../utils/sarIndexHost";
import {
  getStoredTilesPlotCandidates,
  type PlotRef,
} from "../utils/plotName";

export interface TimelineBucket {
  growth_dates: string[];
  water_uptake_dates: string[];
  soil_moisture_dates: string[];
  pest_detection_dates: string[];
}

export interface AnalysisTimelineResponse {
  plot_name: string;
  timeline: TimelineBucket[];
  plantation_date?: string;
  end_date?: string;
}

export type MapAnalysisLayer = "Growth" | "Water Uptake" | "Soil Moisture" | "PEST";

const LAYER_TO_KEY: Record<MapAnalysisLayer, keyof TimelineBucket> = {
  Growth: "growth_dates",
  "Water Uptake": "water_uptake_dates",
  "Soil Moisture": "soil_moisture_dates",
  PEST: "pest_detection_dates",
};

/** Absolute floss host for ribbon dates (same as tiles). */
export function getAnalysisTimelineBaseUrl(): string {
  return sarIndexUpstream();
}

/** Try slash form first — floss uses `8/1A`, not `8_1A`. */
export function analysisTimelinePlotCandidates(plotName: string): string[] {
  const raw = String(plotName ?? "").trim();
  if (!raw) return [];
  const slash = raw.includes("_") && !raw.includes("/") ? raw.replace(/_/g, "/") : raw;
  const out = [slash, raw].filter(Boolean);
  // Never add underscore twin — breaks stored-tiles / tile lookups
  return [...new Set(out)];
}

function asDateArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const day = item.split("T")[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out.push(day);
  }
  return out;
}

/** Dates from stored-tiles `by_type[key][].analysis_date` (or string dates). */
function datesFromByTypeEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const day = item.split("T")[0].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) set.add(day);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const cand =
      row.analysis_date ?? row.end_date ?? row.date ?? row.image_date;
    if (typeof cand !== "string") continue;
    const day = cand.split("T")[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) set.add(day);
  }
  return [...set].sort();
}

/**
 * Normalize floss stored-tiles payload:
 * { plot_name, dates, by_type: { growth, water_uptake, soil_moisture, pest_detection } }
 */
export function normalizeStoredTilesResponse(
  data: any,
  fallbackPlotName: string,
): AnalysisTimelineResponse | null {
  if (!data || typeof data !== "object") return null;

  const byType =
    data.by_type && typeof data.by_type === "object" ? data.by_type : null;

  const growth = datesFromByTypeEntries(
    byType?.growth ?? byType?.analyze_Growth ?? data.growth,
  );
  const water = datesFromByTypeEntries(
    byType?.water_uptake ?? byType?.wateruptake ?? data.water_uptake,
  );
  const soil = datesFromByTypeEntries(
    byType?.soil_moisture ?? byType?.SoilMoisture ?? data.soil_moisture,
  );
  const pest = datesFromByTypeEntries(
    byType?.pest_detection ?? byType?.["pest-detection"] ?? data.pest_detection,
  );

  // If by_type is empty but top-level dates exist, use them for all layers
  // only when we have no typed lists (rare empty by_type with shared dates).
  const shared = asDateArray(data.dates);
  const growthDates = growth.length ? growth : [];
  const waterDates = water.length ? water : [];
  const soilDates = soil.length ? soil : [];
  const pestDates = pest.length ? pest : [];

  if (
    !growthDates.length &&
    !waterDates.length &&
    !soilDates.length &&
    !pestDates.length
  ) {
    if (!shared.length) return null;
    // Shared dates only — show on Growth so the ribbon is not empty.
    return {
      plot_name: String(data.plot_name || fallbackPlotName),
      end_date: shared[shared.length - 1],
      timeline: [
        {
          growth_dates: shared,
          water_uptake_dates: [],
          soil_moisture_dates: [],
          pest_detection_dates: [],
        },
      ],
    };
  }

  const allLatest = [
    ...growthDates,
    ...waterDates,
    ...soilDates,
    ...pestDates,
  ].sort();

  return {
    plot_name: String(data.plot_name || fallbackPlotName),
    end_date: allLatest[allLatest.length - 1],
    timeline: [
      {
        growth_dates: growthDates,
        water_uptake_dates: waterDates,
        soil_moisture_dates: soilDates,
        pest_detection_dates: pestDates,
      },
    ],
  };
}

/**
 * Normalize legacy image-dates / analysis_timeline payloads.
 */
export function normalizeImageDatesResponse(
  data: any,
  fallbackPlotName: string,
): AnalysisTimelineResponse | null {
  if (!data || typeof data !== "object") return null;

  // stored-tiles shape
  if (data.by_type || (Array.isArray(data.dates) && data.tiles !== undefined)) {
    return normalizeStoredTilesResponse(data, fallbackPlotName);
  }

  if (Array.isArray(data.timeline)) {
    const buckets = data.timeline
      .map((bucket: any) => ({
        growth_dates: asDateArray(bucket?.growth_dates),
        water_uptake_dates: asDateArray(bucket?.water_uptake_dates),
        soil_moisture_dates: asDateArray(bucket?.soil_moisture_dates),
        pest_detection_dates: asDateArray(bucket?.pest_detection_dates),
      }))
      .filter(
        (b: TimelineBucket) =>
          b.growth_dates.length ||
          b.water_uptake_dates.length ||
          b.soil_moisture_dates.length ||
          b.pest_detection_dates.length,
      );
    if (!buckets.length) return null;
    return {
      plot_name: String(data.plot_name || fallbackPlotName),
      timeline: buckets,
      plantation_date:
        typeof data.plantation_date === "string"
          ? data.plantation_date
          : undefined,
      end_date: typeof data.end_date === "string" ? data.end_date : undefined,
    };
  }

  const growth = asDateArray(
    data.growth ?? data.growth_dates ?? data.analysis_dates,
  );
  const water = asDateArray(data.water_uptake ?? data.water_uptake_dates);
  const soil = asDateArray(
    data.soil ?? data.soil_moisture ?? data.soil_moisture_dates,
  );
  const pest = asDateArray(data.pest ?? data.pest_detection_dates);

  if (!growth.length && !water.length && !soil.length && !pest.length) {
    return null;
  }

  return {
    plot_name: String(data.plot_name || fallbackPlotName),
    plantation_date:
      typeof data.plantation_date === "string" ? data.plantation_date : undefined,
    end_date: typeof data.end_date === "string" ? data.end_date : undefined,
    timeline: [
      {
        growth_dates: growth,
        water_uptake_dates: water,
        soil_moisture_dates: soil,
        pest_detection_dates: pest,
      },
    ],
  };
}

async function fetchStoredTilesJson(
  url: string,
): Promise<any | null> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return null;
  return res.json();
}

/** In-flight / short cache for optional stored-tiles lookups. */
const storedTilesInflight = new Map<
  string,
  Promise<AnalysisTimelineResponse | null>
>();
const storedTilesCache = new Map<
  string,
  { at: number; data: AnalysisTimelineResponse | null }
>();
const STORED_TILES_CACHE_MS = 60_000;

async function fetchStoredTilesOnce(
  plotName: string,
): Promise<AnalysisTimelineResponse | null> {
  const cacheKey = plotName.trim();
  const hit = storedTilesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < STORED_TILES_CACHE_MS) return hit.data;

  const existing = storedTilesInflight.get(cacheKey);
  if (existing) return existing;

  const run = (async () => {
    // Exact endpoint user specified (absolute floss — avoids Vite 502 hang-ups).
    // GET /stored-tiles?plot_name=…
    const absoluteBase = getAnalysisTimelineBaseUrl();
    const proxyBase = getSarIndexBaseUrl();
    const qs = `plot_name=${encodeURIComponent(plotName)}`;
    const urls = [
      `${absoluteBase}/stored-tiles?${qs}`,
      // Same-origin proxy fallback if browser blocks absolute CORS
      proxyBase && proxyBase !== absoluteBase
        ? `${proxyBase}/stored-tiles?${qs}`
        : "",
    ].filter(Boolean);

    let normalized: AnalysisTimelineResponse | null = null;
    for (const url of urls) {
      try {
        let data = await fetchStoredTilesJson(url);
        if (!data) {
          await new Promise((r) => setTimeout(r, 400));
          data = await fetchStoredTilesJson(url);
        }
        if (!data) continue;
        normalized = normalizeStoredTilesResponse(data, plotName);
        // Accept 200 even when empty (no dates for this plot key)
        if (normalized?.timeline?.length) break;
        if (
          data &&
          typeof data === "object" &&
          (Array.isArray(data.dates) || data.by_type != null)
        ) {
          // Valid stored-tiles response but no imagery — stop trying other hosts
          normalized = null;
          break;
        }
        normalized = null;
      } catch {
        // try next base
      }
    }

    storedTilesCache.set(cacheKey, { at: Date.now(), data: normalized });
    return normalized;
  })();

  storedTilesInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    storedTilesInflight.delete(cacheKey);
  }
}

export async function fetchAnalysisTimeline(
  plotName: string,
  plots?: PlotRef[] | null,
): Promise<AnalysisTimelineResponse | null> {
  const trimmed = plotName?.trim();
  if (!trimmed) return null;
  // stored-tiles is optional testing only — do not call (often 404 on Admin).
  // Growth/Water/Soil/Pest use calendar / analyze_* date fallbacks instead.
  void plots;
  return null;
}

function collectDatesForLayer(
  timeline: TimelineBucket[] | undefined,
  layer: MapAnalysisLayer,
): Set<string> {
  const key = LAYER_TO_KEY[layer];
  const set = new Set<string>();
  if (!timeline?.length) return set;
  for (const bucket of timeline) {
    const arr = bucket[key];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (typeof raw !== "string") continue;
      const day = raw.split("T")[0].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) set.add(day);
    }
  }
  return set;
}

/** Unique analysis dates for the layer, sorted oldest → newest. */
export function sortedRebinDatesForLayer(
  timeline: TimelineBucket[] | undefined,
  layer: MapAnalysisLayer,
): string[] {
  const set = collectDatesForLayer(timeline, layer);
  return [...set].sort();
}

/** Latest image date for one layer (Growth / Water / Soil / Pest). */
export function latestRebinDateForLayer(
  timeline: TimelineBucket[] | undefined,
  layer: MapAnalysisLayer,
): string {
  const dates = sortedRebinDatesForLayer(timeline, layer);
  return dates[dates.length - 1] ?? "";
}

/** Latest calendar date that appears in any layer’s rebin lists (for a single shared map `end_date` on load). */
export function latestRebinDateAcrossAllLayers(
  timeline: TimelineBucket[] | undefined,
): string {
  if (!timeline?.length) return "";
  let best = "";
  const layers: MapAnalysisLayer[] = [
    "Growth",
    "Water Uptake",
    "Soil Moisture",
    "PEST",
  ];
  for (const layer of layers) {
    const last = latestRebinDateForLayer(timeline, layer);
    if (last && last > best) best = last;
  }
  return best;
}

/**
 * Pick the end_date to send for a layer API:
 * - Prefer the UI/rebin date when that layer has imagery on/before it
 * - Never pass a date after that layer’s latest image (avoids 404 "No … images found")
 */
export function resolveLayerImageEndDate(
  timeline: TimelineBucket[] | undefined,
  layer: MapAnalysisLayer,
  uiDateIso: string,
): string {
  const ui = (uiDateIso || "").trim().split("T")[0];
  const dates = sortedRebinDatesForLayer(timeline, layer);
  const layerLatest = dates[dates.length - 1] ?? "";
  if (!layerLatest) {
    // No imagery recorded for this layer — caller should skip the API call.
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ui) || ui > layerLatest) {
    return layerLatest;
  }
  if (dates.includes(ui)) return ui;
  const floor = [...dates].reverse().find((d) => d <= ui);
  return floor || layerLatest;
}

/**
 * Candidate Admin `end_date` values for a layer, newest first.
 * Timeline can list dates Admin has not synced yet — callers should try these
 * in order and fall back on older dates when Admin returns 404.
 */
export function candidateEndDatesForLayer(
  timeline: TimelineBucket[] | undefined,
  layer: MapAnalysisLayer,
  uiDateIso?: string,
): string[] {
  const dates = sortedRebinDatesForLayer(timeline, layer);
  if (!dates.length) return [];
  const ui = (uiDateIso || "").trim().split("T")[0];
  const capped =
    /^\d{4}-\d{2}-\d{2}$/.test(ui) ? dates.filter((d) => d <= ui) : dates;
  const use = capped.length ? capped : dates;
  return [...use].reverse();
}
