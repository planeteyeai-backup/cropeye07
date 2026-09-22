/**
 * SAR Index Mapping API — Growth / Water / Soil / Pest layers.
 * Host: VITE_SAR_INDEX_API_URL (tiles only). Unset locally to skip.
 *
 * Responses include stored PNG `tile_url` (S3) for ImageOverlay, plus pixel_summary.
 * Try ribbon/UI date first, then newer→older timeline dates on 404.
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
import { getSarIndexBaseUrl, isSarMappingHostAvailable } from "./sarIndexHost";

export { getSarIndexBaseUrl } from "./sarIndexHost";

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
    m.includes("growth_tiles_disabled") ||
    m.includes("no sentinel") ||
    m.includes("no images found") ||
    m.includes("empty response") ||
    m.includes("invalid data") ||
    m.includes("unexpected end of json") ||
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
  /** Try these plot_name forms (underscore first). Falls back to apiPlotName. */
  apiPlotNames?: string[];
  layer: MapAnalysisLayer;
  candidateDates: string[];
  forceRefresh?: boolean;
  daysBack?: number;
}): Promise<AdminLayerFetchResult> {
  const {
    plotName,
    apiPlotName,
    apiPlotNames,
    layer,
    candidateDates,
    forceRefresh = false,
    daysBack = 15,
  } = options;

  const path = ADMIN_LAYER_PATH[layer];
  const slug = LAYER_CACHE_SLUG[layer];
  const today = new Date().toISOString().split("T")[0];
  let lastError: Error | null = null;

  if (!(await isSarMappingHostAvailable())) {
    throw new Error("GROWTH_TILES_DISABLED");
  }

  const plotNames = [
    ...new Set(
      [...(apiPlotNames ?? []), apiPlotName]
        .map((n) => String(n ?? "").trim())
        .filter(Boolean),
    ),
  ];

  for (const endDate of candidateDates) {
    if (!endDate) continue;
    if (isLayerEndDateFailed(plotName, layer, endDate)) continue;

    let dateHadImageryMiss = false;

    for (const plotId of plotNames) {
      const base = getSarIndexBaseUrl();
      const url = `${base}/${path}?plot_name=${encodeURIComponent(
        plotId,
      )}&end_date=${endDate}&days_back=${daysBack}`;
      const cacheKey = `layer:${slug}:${plotId}:${endDate}`;
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
            headers: {
              Accept: "application/json",
            },
          },
        });
        persistWorkingLayerEndDate(plotName, layer, endDate);
        return { data, endDate, cacheKey };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);
        removeCache(cacheKey);
        if (isAdminNoImageryError(message)) {
          dateHadImageryMiss = true;
          console.warn(
            `[AdminLayer] ${layer} miss @ ${endDate} for ${plotId}; trying next…`,
          );
          continue;
        }
        console.warn(
          `[AdminLayer] ${layer} error @ ${endDate} for ${plotId}: ${message}`,
        );
      }
    }

    // Only blacklist the date after every plot_id form failed for it.
    if (dateHadImageryMiss) {
      markLayerEndDateFailed(plotName, layer, endDate);
    }
  }

  throw (
    lastError ||
    new Error(`No Admin ${layer} imagery available for ${apiPlotName}`)
  );
}
