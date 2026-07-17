export type PlotRef = {
  fastapi_plot_id?: string;
  gat_number?: string;
  plot_number?: string;
  plot_name?: string;
  id?: string | number;
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
  if (gat && num) {
    return `${gat}/${num}`;
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

  const addWithForms = (value: string | undefined | null) => {
    const s = sanitizePlotName(String(value ?? ""));
    if (!s) return;
    addExact(s);
    // SAR water-stress accepts slash (`8/1A`) but 404s on underscore (`8_1A`).
    if (s.includes("_")) addExact(s.replace(/_/g, "/"));
    if (s.includes("/")) addExact(s.replace(/\//g, "_"));
  };

  const matched = findPlotRef(plots, plotId);

  if (matched?.fastapi_plot_id) addWithForms(matched.fastapi_plot_id);
  addWithForms(plotId);
  addWithForms(resolveApiPlotName(plotId, plots));
  if (matched?.gat_number != null && matched?.plot_number != null) {
    const gat = sanitizePlotName(String(matched.gat_number));
    const num = sanitizePlotName(String(matched.plot_number));
    if (gat && num) {
      addWithForms(`${gat}_${num}`);
      addWithForms(`${gat}/${num}`);
    }
  }
  if (matched?.plot_name) addWithForms(matched.plot_name);

  const cleaned = sanitizePlotName(plotId);
  return out.length > 0 ? out : cleaned ? [cleaned] : [];
}
