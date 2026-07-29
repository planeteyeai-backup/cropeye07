/**
 * Admin map-layer APIs (Growth / Water / Soil / Pest).
 *
 * Why frontend tiles differed from backend:
 * - Growth/Soil timeline often lists e.g. 2026-07-17 (Admin 404)
 * - Backend uses a newer shared date (e.g. 2026-07-21 / 07-26) → Admin 200 + latest tiles
 * - Frontend fell back to 2026-06-28 → older/different map tiles
 *
 * Fix: try ribbon/UI date first, then all timeline dates (newest→oldest),
 * then this layer’s dates. Same Admin response as backend. Ribbon UI unchanged.
 */
import {
  candidateEndDatesForLayer,
  latestRebinDateAcrossAllLayers,
  latestRebinDateForLayer,
  resolveLayerImageEndDate,
  sortedRebinDatesForLayer,
  type AnalysisTimelineResponse,
  type MapAnalysisLayer,
} from "../services/analysisTimeline";
import { getOrFetchJson } from "./requestCache";
import { removeCache } from "./cache";
import {
  isLayerEndDateFailed,
  layerToStoredKey,
  markLayerEndDateFailed,
  readStoredPlotImageEndDates,
  storePlotImageEndDates,
  type StoredPlotImageEndDates,
} from "./plotImageEndDates";

const ADMIN_BASE = "https://admin-cropeye.up.railway.app";
const MAX_DATE_ATTEMPTS = 5;

const ALL_LAYERS: MapAnalysisLayer[] = [
  "Growth",
  "Water Uptake",
  "Soil Moisture",
  "PEST",
];

export const ADMIN_LAYER_PATH: Record<MapAnalysisLayer, string> = {
  Growth: "analyze_Growth",
  "Water Uptake": "wateruptake",
  "Soil Moisture": "SoilMoisture",
  PEST: "pest-detection",
};

const LAYER_CACHE_SLUG: Record<MapAnalysisLayer, string> = {
  Growth: "growth",
  "Water Uptake": "water",
  "Soil Moisture": "soil",
  PEST: "pest",
};

export function isAdminNoImageryError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("no sentinel") ||
    m.includes("no images found") ||
    /\b404\b/.test(m)
  );
}

export function persistWorkingLayerEndDate(
  plotName: string,
  layer: MapAnalysisLayer,
  endDate: string,
): void {
  if (!plotName?.trim() || !endDate) return;
  const prev = readStoredPlotImageEndDates(plotName);
  const key = layerToStoredKey(layer);
  const day = endDate.trim().split("T")[0];
  const verified = { ...(prev?.verified || {}), [key]: day };
  const failedForLayer = (prev?.failed?.[key] || []).filter((d) => d !== day);
  storePlotImageEndDates(plotName, {
    growth: prev?.growth || "",
    water: prev?.water || "",
    soil: prev?.soil || "",
    pest: prev?.pest || "",
    overall: prev?.overall || day,
    verified,
    failed: { ...(prev?.failed || {}), [key]: failedForLayer },
    updatedAt: Date.now(),
  });
}

/** All unique timeline dates across layers, newest first. */
function allTimelineDatesNewestFirst(
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
): string[] {
  const set = new Set<string>();
  for (const layer of ALL_LAYERS) {
    for (const d of sortedRebinDatesForLayer(timeline, layer)) set.add(d);
  }
  return [...set].sort().reverse();
}

export function resolveCorrectLayerEndDate(
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
  layer: MapAnalysisLayer,
  uiDateIso?: string,
): string {
  const ui =
    (uiDateIso || "").trim().split("T")[0] ||
    latestRebinDateForLayer(timeline, layer);
  return resolveLayerImageEndDate(timeline, layer, ui);
}

/**
 * Match backend Admin tile selection:
 * 1) Ribbon/UI date (overall latest often 07-26 — same as backend)
 * 2) Overall latest across layers
 * 3) All timeline dates newest→oldest (Admin finds Growth/Soil in days_back window)
 * 4) This layer’s own dates
 *
 * Example D0000560020 Growth/Soil:
 *   07-17 → 404 (listed in layer timeline but missing on Admin)
 *   07-26 / 07-21 → 200 + latest tiles (what backend shows)
 *   06-28 → 200 but older tiles (avoid preferring this first)
 */
export function buildAdminEndDateCandidates(
  plotName: string,
  layer: MapAnalysisLayer,
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
  uiDateIso?: string,
): string[] {
  const overall = latestRebinDateAcrossAllLayers(timeline);
  const ui = (uiDateIso || "").trim().split("T")[0];
  const allNewest = allTimelineDatesNewestFirst(timeline);
  const layerPreferred = resolveCorrectLayerEndDate(timeline, layer, uiDateIso);
  const layerDates = candidateEndDatesForLayer(timeline, layer, uiDateIso);

  if (!allNewest.length && !layerPreferred) return [];

  const ordered: string[] = [];
  const push = (d: string) => {
    const day = (d || "").trim().split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    // Never call Admin with a date after the newest known imagery.
    if (overall && day > overall) return;
    if (isLayerEndDateFailed(plotName, layer, day)) return;
    if (!ordered.includes(day)) ordered.push(day);
  };

  // Backend-style: ribbon / overall first → latest tiles
  push(ui);
  push(overall);
  for (const d of allNewest) {
    if (ui && d > ui) continue;
    push(d);
  }
  push(layerPreferred);
  for (const d of layerDates) push(d);

  return ordered.slice(0, MAX_DATE_ATTEMPTS);
}

export type AdminLayerFetchResult = {
  data: unknown;
  endDate: string;
  cacheKey: string;
};

export async function fetchAdminLayerWithDateFallback(options: {
  plotName: string;
  apiPlotName: string;
  layer: MapAnalysisLayer;
  candidateDates: string[];
  forceRefresh?: boolean;
  daysBack?: number;
}): Promise<AdminLayerFetchResult> {
  const {
    plotName,
    apiPlotName,
    layer,
    candidateDates,
    forceRefresh = false,
    daysBack = 15,
  } = options;

  const path = ADMIN_LAYER_PATH[layer];
  const slug = LAYER_CACHE_SLUG[layer];
  const today = new Date().toISOString().split("T")[0];
  let lastError: Error | null = null;

  for (const endDate of candidateDates) {
    if (!endDate) continue;
    if (isLayerEndDateFailed(plotName, layer, endDate)) continue;

    const url = `${ADMIN_BASE}/${path}?plot_name=${encodeURIComponent(
      apiPlotName,
    )}&end_date=${endDate}&days_back=${daysBack}`;
    const cacheKey = `layer:${slug}:${apiPlotName}:${endDate}`;
    const ttlMs = endDate === today ? 10 * 60 * 1000 : 30 * 60 * 1000;

    try {
      const data = await getOrFetchJson({
        key: cacheKey,
        url,
        ttlMs,
        forceRefresh,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      });
      persistWorkingLayerEndDate(plotName, layer, endDate);
      return { data, endDate, cacheKey };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      if (isAdminNoImageryError(message)) {
        markLayerEndDateFailed(plotName, layer, endDate);
        removeCache(cacheKey);
        console.warn(
          `[AdminLayer] ${layer} 404 @ ${endDate} for ${apiPlotName}; trying next date (match backend)…`,
        );
        continue;
      }
      throw lastError;
    }
  }

  throw (
    lastError ||
    new Error(`No Admin ${layer} imagery available for ${apiPlotName}`)
  );
}
