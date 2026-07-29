/**
 * Persist per-plot Sentinel / analysis image end dates from analysis_timeline.
 * APIs must only receive dates that have imagery — never "today" by default.
 *
 * `growth`/`water`/`soil`/`pest`/`overall` = timeline hints.
 * `verified` = dates Admin actually returned 200 for (must survive timeline refresh).
 */
import {
  fetchAnalysisTimeline,
  latestRebinDateAcrossAllLayers,
  latestRebinDateForLayer,
  resolveLayerImageEndDate,
  type AnalysisTimelineResponse,
  type MapAnalysisLayer,
} from "../services/analysisTimeline";
import { normalizePlotKey } from "./plotName";

const STORAGE_PREFIX = "cropeye:plotImageEndDates:";

export type VerifiedLayerEndDates = {
  growth?: string;
  water?: string;
  soil?: string;
  pest?: string;
};

export type StoredPlotImageEndDates = {
  growth: string;
  water: string;
  soil: string;
  pest: string;
  /** Latest across all layers — safe default for soil NPK / shared calls */
  overall: string;
  /** Admin-confirmed dates (do not overwrite on timeline refresh) */
  verified?: VerifiedLayerEndDates;
  /** Dates that returned Admin 404 for this plot/layer */
  failed?: Partial<Record<"growth" | "water" | "soil" | "pest", string[]>>;
  updatedAt: number;
};

function storageKey(plotName: string): string {
  return `${STORAGE_PREFIX}${normalizePlotKey(plotName)}`;
}

export function storePlotImageEndDates(
  plotName: string,
  dates: StoredPlotImageEndDates,
): void {
  if (!plotName?.trim()) return;
  try {
    sessionStorage.setItem(storageKey(plotName), JSON.stringify(dates));
  } catch {
    // ignore quota / private mode
  }
}

export function readStoredPlotImageEndDates(
  plotName: string,
): StoredPlotImageEndDates | null {
  if (!plotName?.trim()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(plotName));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlotImageEndDates;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildPlotImageEndDatesFromTimeline(
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
): Omit<StoredPlotImageEndDates, "verified" | "failed"> {
  return {
    growth: latestRebinDateForLayer(timeline, "Growth"),
    water: latestRebinDateForLayer(timeline, "Water Uptake"),
    soil: latestRebinDateForLayer(timeline, "Soil Moisture"),
    pest: latestRebinDateForLayer(timeline, "PEST"),
    overall: latestRebinDateAcrossAllLayers(timeline),
    updatedAt: Date.now(),
  };
}

/** Save timeline hints; keep previously verified / failed Admin dates. */
export function persistPlotImageEndDatesFromTimeline(
  plotName: string,
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
): StoredPlotImageEndDates {
  const prev = readStoredPlotImageEndDates(plotName);
  const dates: StoredPlotImageEndDates = {
    ...buildPlotImageEndDatesFromTimeline(timeline),
    verified: prev?.verified,
    failed: prev?.failed,
  };
  storePlotImageEndDates(plotName, dates);
  return dates;
}

export function layerToStoredKey(
  layer: MapAnalysisLayer,
): keyof Pick<StoredPlotImageEndDates, "growth" | "water" | "soil" | "pest"> {
  switch (layer) {
    case "Growth":
      return "growth";
    case "Water Uptake":
      return "water";
    case "Soil Moisture":
      return "soil";
    case "PEST":
      return "pest";
  }
}

export function getVerifiedLayerEndDate(
  plotName: string,
  layer: MapAnalysisLayer,
): string {
  const stored = readStoredPlotImageEndDates(plotName);
  return stored?.verified?.[layerToStoredKey(layer)] || "";
}

export function markLayerEndDateFailed(
  plotName: string,
  layer: MapAnalysisLayer,
  endDate: string,
): void {
  if (!plotName?.trim() || !endDate) return;
  const key = layerToStoredKey(layer);
  const prev = readStoredPlotImageEndDates(plotName);
  const day = endDate.trim().split("T")[0];
  const failedList = [...(prev?.failed?.[key] || [])];
  if (!failedList.includes(day)) failedList.push(day);
  // Keep last ~12 failed dates per layer
  const trimmed = failedList.slice(-12);
  const next: StoredPlotImageEndDates = {
    growth: prev?.growth || "",
    water: prev?.water || "",
    soil: prev?.soil || "",
    pest: prev?.pest || "",
    overall: prev?.overall || "",
    verified: prev?.verified,
    failed: { ...(prev?.failed || {}), [key]: trimmed },
    updatedAt: Date.now(),
  };
  storePlotImageEndDates(plotName, next);
}

export function isLayerEndDateFailed(
  plotName: string,
  layer: MapAnalysisLayer,
  endDate: string,
): boolean {
  const key = layerToStoredKey(layer);
  const day = (endDate || "").trim().split("T")[0];
  const list = readStoredPlotImageEndDates(plotName)?.failed?.[key] || [];
  return list.includes(day);
}

/**
 * End date to send for a layer API = this layer’s image date for the UI/ribbon.
 * Does NOT walk to older dates (that shows wrong tiles vs latest update).
 */
export function getApiEndDateForLayer(
  _plotName: string,
  layer: MapAnalysisLayer,
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
  uiDateIso?: string,
): string {
  if (timeline?.length) {
    return resolveLayerImageEndDate(
      timeline,
      layer,
      uiDateIso || latestRebinDateForLayer(timeline, layer),
    );
  }

  const stored = readStoredPlotImageEndDates(_plotName);
  if (!stored) return "";
  const key = layerToStoredKey(layer);
  return stored[key] || stored.overall || "";
}

/**
 * Best available image end_date for soil NPK / required-n (never today unless imagery exists).
 * Prefer Admin-verified dates, then overall timeline.
 */
export async function resolveAvailableImageEndDateForPlot(
  plotName: string,
): Promise<string> {
  if (!plotName?.trim()) return "";

  const stored = readStoredPlotImageEndDates(plotName);
  if (stored?.verified?.soil) return stored.verified.soil;
  if (stored?.verified?.growth) return stored.verified.growth;
  if (stored?.overall) return stored.overall;
  if (stored?.soil) return stored.soil;
  if (stored?.growth) return stored.growth;

  try {
    const timeline = await fetchAnalysisTimeline(plotName);
    if (!timeline?.timeline?.length) return "";
    const dates = persistPlotImageEndDatesFromTimeline(
      plotName,
      timeline.timeline,
    );
    return dates.overall || dates.soil || dates.growth || "";
  } catch {
    return "";
  }
}
