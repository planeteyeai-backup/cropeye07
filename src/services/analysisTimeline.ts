/** GET https://cropeye-database-production.up.railway.app/analysis_timeline?plot_name=... */

const TIMELINE_PATH = "/analysis_timeline";

export interface TimelineBucket {
  growth_dates: string[];
  water_uptake_dates: string[];
  soil_moisture_dates: string[];
  pest_detection_dates: string[];
}

export interface AnalysisTimelineResponse {
  plot_name: string;
  timeline: TimelineBucket[];
}

export type MapAnalysisLayer = "Growth" | "Water Uptake" | "Soil Moisture" | "PEST";

const LAYER_TO_KEY: Record<MapAnalysisLayer, keyof TimelineBucket> = {
  Growth: "growth_dates",
  "Water Uptake": "water_uptake_dates",
  "Soil Moisture": "soil_moisture_dates",
  PEST: "pest_detection_dates",
};

/**
 * Dev: Vite proxies `/api/analysis-timeline` → cropeye-database (no CORS).
 * Prod: browser calls this URL directly — the database host must allow your site’s origin (CORS),
 * or set `VITE_ANALYSIS_TIMELINE_BASE_URL` to a same-origin path your host proxies (e.g. `/api/analysis-timeline`).
 */
export function getAnalysisTimelineBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_ANALYSIS_TIMELINE_BASE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/api/analysis-timeline";
  return "https://cropeye-database-production.up.railway.app";
}

/** Try slash and underscore forms — timeline DB keys differ per plot (`8/1A` vs `597_45`). */
export function analysisTimelinePlotCandidates(plotName: string): string[] {
  const raw = String(plotName ?? "").trim();
  if (!raw) return [];
  const slash = raw.replace(/_/g, "/");
  const underscore = raw.replace(/\//g, "_");
  return [...new Set([raw, slash, underscore].filter(Boolean))];
}

async function fetchAnalysisTimelineOnce(
  plotName: string,
): Promise<AnalysisTimelineResponse | null> {
  const url = `${getAnalysisTimelineBaseUrl()}${TIMELINE_PATH}?plot_name=${encodeURIComponent(plotName)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      const snippet = await res.text().catch(() => "");
      throw new Error(
        `Timeline endpoint returned non-JSON (content-type: ${ct || "unknown"}). ` +
          `This usually means your production host is serving index.html for "${TIMELINE_PATH}" ` +
          `because a proxy/rewrite is missing or VITE_ANALYSIS_TIMELINE_BASE_URL is wrong. ` +
          (snippet ? `First bytes: ${JSON.stringify(snippet.slice(0, 120))}` : ""),
      );
    }
    const data = (await res.json()) as AnalysisTimelineResponse;
    if (data?.timeline && Array.isArray(data.timeline)) return data;
    return null;
  } catch (err) {
    if (err instanceof Error && err.message.includes("non-JSON")) throw err;
    return null;
  }
}

export async function fetchAnalysisTimeline(
  plotName: string,
): Promise<AnalysisTimelineResponse | null> {
  const trimmed = plotName?.trim();
  if (!trimmed) return null;

  let lastHtmlError: Error | null = null;
  for (const candidate of analysisTimelinePlotCandidates(trimmed)) {
    try {
      const data = await fetchAnalysisTimelineOnce(candidate);
      if (data?.timeline?.length) return data;
    } catch (err) {
      if (err instanceof Error && err.message.includes("non-JSON")) {
        lastHtmlError = err;
      }
    }
  }
  if (lastHtmlError) throw lastHtmlError;
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
  const layers: MapAnalysisLayer[] = ["Growth", "Water Uptake", "Soil Moisture", "PEST"];
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
