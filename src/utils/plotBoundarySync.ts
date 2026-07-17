import { removeCache, removeCachesMatchingPlot } from "./cache";
import {
  findPlotRef,
  getPlotNameCandidates,
  normalizePlotKey,
  type PlotRef,
} from "./plotName";
import type { GeoJsonPolygon } from "./plotGeometry";

export const PLOT_BOUNDARY_UPDATED_EVENT = "cropeye:plot-boundary-updated";

const LOCAL_BOUNDARY_PREFIX = "cropeye:plot-boundary:";

export type PlotBoundaryUpdatedDetail = {
  plotKey: string;
  plotId?: string;
  boundary: GeoJsonPolygon | null;
};

function normalizeBoundary(raw: unknown): GeoJsonPolygon | null {
  if (!raw) return null;

  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const row = value as GeoJsonPolygon;
  if (
    row?.type === "Polygon" &&
    Array.isArray(row.coordinates?.[0]) &&
    row.coordinates[0].length >= 3
  ) {
    return row;
  }

  const coords = (value as { coordinates?: number[][][] })?.coordinates;
  if (Array.isArray(coords?.[0]) && coords![0].length >= 3) {
    return { type: "Polygon", coordinates: coords! };
  }

  return null;
}

function localStorageKey(plotKey: string): string {
  return `${LOCAL_BOUNDARY_PREFIX}${normalizePlotKey(plotKey)}`;
}

/** Persist last saved boundary in sessionStorage (survives My Profile → Home navigation). */
export function persistLocalPlotBoundary(
  plotKey: string,
  boundary: GeoJsonPolygon | null,
  extraKeys: string[] = [],
): void {
  if (typeof window === "undefined") return;

  const keys = new Set<string>();
  if (plotKey?.trim()) keys.add(plotKey.trim());
  for (const key of extraKeys) {
    if (key?.trim()) keys.add(key.trim());
  }

  for (const key of keys) {
    const storageKey = localStorageKey(key);
    if (!boundary) {
      sessionStorage.removeItem(storageKey);
      continue;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(boundary));
  }
}

export function readLocalPlotBoundary(plotKey: string): GeoJsonPolygon | null {
  if (typeof window === "undefined" || !plotKey?.trim()) return null;

  try {
    const raw = sessionStorage.getItem(localStorageKey(plotKey));
    if (!raw) return null;
    return normalizeBoundary(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Try every plot-name variant (fastapi id, gat/plot, etc.). */
export function readLocalPlotBoundaryForPlot(
  plotName: string,
  plots?: PlotRef[] | null,
): GeoJsonPolygon | null {
  for (const candidate of getPlotNameCandidates(plotName, plots)) {
    const boundary = readLocalPlotBoundary(candidate);
    if (boundary) return boundary;
  }
  return null;
}

export function boundariesMatch(
  a: GeoJsonPolygon | null | undefined,
  b: GeoJsonPolygon | null | undefined,
): boolean {
  if (!a || !b) return false;
  try {
    return JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates);
  } catch {
    return false;
  }
}

/** Read plot polygon from my-profile plot record (shape varies by API version). */
export function resolvePlotBoundaryFromRecord(
  plot: unknown,
): GeoJsonPolygon | null {
  if (!plot || typeof plot !== "object") return null;
  const row = plot as Record<string, unknown>;
  const coordinates = row.coordinates as Record<string, unknown> | undefined;

  for (const raw of [
    row.boundary,
    coordinates?.boundary,
    (row.location as Record<string, unknown> | undefined)?.boundary,
  ]) {
    const boundary = normalizeBoundary(raw);
    if (boundary) return boundary;
  }

  return null;
}

/** Match my-profile plot record (plots array, farm.plot, or single nested plot). */
export function findProfilePlotRecord(
  profile: unknown,
  plotName: string,
): unknown {
  const data = profile as {
    plots?: unknown[];
    plot?: unknown;
    farm?: { plot?: unknown };
  } | null;

  const plots = data?.plots;
  if (Array.isArray(plots) && plotName?.trim()) {
    const matched = findPlotRef(plots as PlotRef[], plotName);
    if (matched) return matched;
    if (plots.length === 1) return plots[0];
  }

  const nested =
    data?.plot ??
    (Array.isArray(plots) && plots.length === 1 ? plots[0] : null) ??
    data?.farm?.plot ??
    null;

  if (!nested) return null;
  if (!plotName?.trim()) return nested;

  if (findPlotRef([nested as PlotRef], plotName)) return nested;
  if (!Array.isArray(plots) || plots.length <= 1) return nested;

  return null;
}

export function profilePlotBoundaryFeature(
  profile: unknown,
  plotName: string,
): { type: "Feature"; geometry: GeoJsonPolygon; properties: Record<string, unknown> } | null {
  if (!plotName?.trim()) return null;

  const plot = findProfilePlotRecord(profile, plotName);
  const boundary = resolvePlotBoundaryFromRecord(plot);
  if (!boundary) return null;

  return {
    type: "Feature",
    geometry: boundary,
    properties: {
      plot_name: plotName,
      source: "my-profile",
    },
  };
}

/** Saved boundary: session (last PATCH) → my-profile GET. */
export function resolveSavedPlotBoundaryFeature(
  profile: unknown,
  plotName: string,
  optimisticBoundary?: GeoJsonPolygon | null,
): { type: "Feature"; geometry: GeoJsonPolygon; properties: Record<string, unknown> } | null {
  const plots = (profile as { plots?: PlotRef[] } | null)?.plots;

  const localBoundary =
    optimisticBoundary ?? readLocalPlotBoundaryForPlot(plotName, plots);
  if (localBoundary) {
    return {
      type: "Feature",
      geometry: localBoundary,
      properties: {
        plot_name: plotName,
        source: optimisticBoundary ? "saved-optimistic" : "saved-local",
      },
    };
  }

  return profilePlotBoundaryFeature(profile, plotName);
}

/**
 * Patch a my-profile / farmerProfile payload so Home Map can read the saved
 * boundary immediately (even if GET /farms/my-profile/ is slow or omits it).
 */
export function mergeBoundaryIntoProfilePayload(
  profile: unknown,
  plotKey: string,
  boundary: GeoJsonPolygon | null,
): unknown {
  if (!profile || typeof profile !== "object") return profile;
  const data = { ...(profile as Record<string, unknown>) };
  const plots = Array.isArray(data.plots) ? [...(data.plots as unknown[])] : [];

  const patchPlot = (plot: unknown): unknown => {
    if (!plot || typeof plot !== "object") return plot;
    const row = { ...(plot as Record<string, unknown>) };
    row.boundary = boundary;
    const coordinates =
      row.coordinates && typeof row.coordinates === "object"
        ? { ...(row.coordinates as Record<string, unknown>) }
        : {};
    coordinates.boundary = boundary;
    row.coordinates = coordinates;
    return row;
  };

  if (plots.length > 0) {
    const matched = findPlotRef(plots as PlotRef[], plotKey);
    if (matched) {
      const idx = plots.indexOf(matched);
      if (idx >= 0) plots[idx] = patchPlot(plots[idx]);
    } else if (plots.length === 1) {
      plots[0] = patchPlot(plots[0]);
    }
    data.plots = plots;
  }

  if (data.plot && typeof data.plot === "object") {
    data.plot = patchPlot(data.plot);
  }

  const farm = data.farm as Record<string, unknown> | undefined;
  if (farm?.plot && typeof farm.plot === "object") {
    data.farm = { ...farm, plot: patchPlot(farm.plot) };
  }

  return data;
}

/** After PATCH my-profile: clear stale caches and notify map/dashboard listeners. */
export function notifyPlotBoundaryUpdated(
  detail: PlotBoundaryUpdatedDetail & { extraPlotKeys?: string[] },
): void {
  removeCache("farmerProfile");
  if (detail.plotKey?.trim()) {
    removeCachesMatchingPlot(detail.plotKey);
  }
  if (detail.plotId?.trim()) {
    removeCachesMatchingPlot(detail.plotId);
  }

  const extraKeys = [
    detail.plotId ?? "",
    ...(detail.extraPlotKeys ?? []),
    ...getPlotNameCandidates(detail.plotKey, null),
  ];
  persistLocalPlotBoundary(detail.plotKey, detail.boundary, extraKeys);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<PlotBoundaryUpdatedDetail>(PLOT_BOUNDARY_UPDATED_EVENT, {
        detail,
      }),
    );
  }
}

