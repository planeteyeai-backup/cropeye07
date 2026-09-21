export type PlotRef = {
  fastapi_plot_id?: string;
  gat_number?: string;
  plot_number?: string;
  plot_name?: string;
  id?: string | number;
  /** Optional GeoJSON-style boundary when API/profile includes it. */
  boundary?: {
    type?: string;
    coordinates?: [number, number][][] | number[][][];
  } | null;
  geometry?: {
    type?: string;
    coordinates?: [number, number][][] | number[][][];
  } | null;
};

/** Normalize plot identifiers for comparison (slashes/spaces → underscore, lowercase). */
export function normalizePlotKey(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/\/*$/g, "")
    .replace(/\//g, "_")
    .replace(/ /g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/** Trim junk that backends sometimes leave on gat/plot ids (trailing `_`, `/`). */
export function sanitizePlotName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^[_/\s]+|[_/\s]+$/g, "");
}

/** Format plot name for SEF/field-score API query (spaces → `+`). */
export function formatPlotNameForApi(plotName: string): string {
  return sanitizePlotName(plotName).replace(/ /g, "+");
}

export function fieldScoreCacheKey(plotId: string): string {
  return `fieldScore_${normalizePlotKey(plotId)}`;
}

/** Plot id sent to analyze_Growth / layer APIs — use backend `fastapi_plot_id` as-is. */
export const resolveApiPlotName = (
  plotKey: string,
  plots?: PlotRef[] | null,
): string => {
  const key = sanitizePlotName(plotKey);
  if (!key) return key;

  const matched = findPlotRef(plots, plotKey);
  const fastapi = matched?.fastapi_plot_id
    ? sanitizePlotName(String(matched.fastapi_plot_id))
    : "";

  if (fastapi) return fastapi;

  const gat =
    matched?.gat_number != null
      ? sanitizePlotName(String(matched.gat_number))
      : "";
  const num =
    matched?.plot_number != null
      ? sanitizePlotName(String(matched.plot_number))
      : "";
  /** Prefer slash (`8/1A`) — never convert fastapi id to underscore. */
  if (gat && num) {
    return `${gat}/${num}`;
  }

  // If UI key used underscore, still send slash to floss tile APIs
  if (key.includes("_") && !key.includes("/")) {
    return key.replace(/_/g, "/");
  }

  return key;
};

/** Primary plot key for dropdowns and API calls (fastapi id, else gat_plot). */
export function plotKeyFromRecord(plot: PlotRef | null | undefined): string {
  const fastapi =
    plot?.fastapi_plot_id != null
      ? sanitizePlotName(String(plot.fastapi_plot_id))
      : "";
  if (fastapi) return fastapi;

  const gat =
    plot?.gat_number != null ? sanitizePlotName(String(plot.gat_number)) : "";
  const num =
    plot?.plot_number != null ? sanitizePlotName(String(plot.plot_number)) : "";
  if (gat && num) return `${gat}_${num}`;

  if (plot?.plot_name) return sanitizePlotName(String(plot.plot_name));
  if (plot?.id != null) return String(plot.id);
  return "";
}

export function findPlotRef(
  plots: PlotRef[] | null | undefined,
  plotId: string,
): PlotRef | null {
  if (!plots?.length || !plotId?.trim()) return null;

  const key = normalizePlotKey(plotId);

  return (
    plots.find((p) => {
      if (!p) return false;
      const fastapi = p.fastapi_plot_id
        ? normalizePlotKey(p.fastapi_plot_id)
        : "";
      const gat = String(p.gat_number ?? "").trim();
      const num = String(p.plot_number ?? "").trim();
      const underscored =
        gat && num ? normalizePlotKey(`${gat}_${num}`) : "";
      const slashed = gat && num ? normalizePlotKey(`${gat}/${num}`) : "";
      const plotName = p.plot_name ? normalizePlotKey(p.plot_name) : "";

      return (
        fastapi === key ||
        underscored === key ||
        slashed === key ||
        plotName === key
      );
    }) ?? null
  );
}

/** Ordered plot-name variants to try against field-score / analyze APIs. */
export function getPlotNameCandidates(
  plotId: string,
  plots?: PlotRef[] | null,
): string[] {
  const out: string[] = [];
  const seenExact = new Set<string>();

  const addExact = (value: string | undefined | null) => {
    const s = sanitizePlotName(String(value ?? ""));
    if (!s) return;
    const exact = s.toLowerCase();
    if (seenExact.has(exact)) return;
    seenExact.add(exact);
    out.push(s);
  };

  /** Prefer slash (`8/1A`) over underscore (`8_1A`) — floss SAR rejects/ignores `_`. */
  const addSlashPreferred = (value: string | undefined | null) => {
    const s = sanitizePlotName(String(value ?? ""));
    if (!s) return;
    if (s.includes("_") && !s.includes("/")) {
      addExact(s.replace(/_/g, "/"));
      addExact(s); // underscore last
      return;
    }
    addExact(s);
    if (s.includes("/")) {
      // Do not add underscore twin — causes failed stored-tiles / wrong plot keys
      return;
    }
  };

  const matched = findPlotRef(plots, plotId);

  if (matched?.fastapi_plot_id) addSlashPreferred(matched.fastapi_plot_id);
  addSlashPreferred(plotId);
  addSlashPreferred(resolveApiPlotName(plotId, plots));
  if (matched?.gat_number != null && matched?.plot_number != null) {
    const gat = sanitizePlotName(String(matched.gat_number));
    const num = sanitizePlotName(String(matched.plot_number));
    if (gat && num) {
      addSlashPreferred(`${gat}/${num}`);
    }
  }
  if (matched?.plot_name) addSlashPreferred(matched.plot_name);

  // Numeric Django id last — SEF /analyze 404s/500s on bare ids; stored-tiles may need it.
  if (matched?.id != null) addExact(String(matched.id));

  const cleaned = sanitizePlotName(plotId);
  return out.length > 0 ? out : cleaned ? [cleaned] : [];
}

/**
 * Candidates for GET /stored-tiles?plot_name=…
 * Prefer numeric id + slash fastapi id (`8/1A`). Never send underscore (`8_1A`).
 */
export function getStoredTilesPlotCandidates(
  plotId: string,
  plots?: PlotRef[] | null,
): string[] {
  const matched = findPlotRef(plots, plotId);
  const base = getPlotNameCandidates(plotId, plots).filter(
    (c) => !c.includes("_"),
  );
  if (matched?.id == null) return base;
  const numeric = sanitizePlotName(String(matched.id));
  if (!numeric || !/^\d+$/.test(numeric)) return base;
  return [numeric, ...base.filter((c) => c !== numeric)];
}
