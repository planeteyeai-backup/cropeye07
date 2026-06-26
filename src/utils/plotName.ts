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
    .replace(/\//g, "_")
    .replace(/ /g, "_")
    .toLowerCase();
}

/** Format plot name for SEF/field-score API query (spaces → `+`). */
export function formatPlotNameForApi(plotName: string): string {
  return String(plotName ?? "").trim().replace(/ /g, "+");
}

export function fieldScoreCacheKey(plotId: string): string {
  return `fieldScore_${normalizePlotKey(plotId)}`;
}

/** Plot id sent to analyze_Growth / layer APIs — use backend `fastapi_plot_id` as-is. */
export const resolveApiPlotName = (
  plotKey: string,
  plots?: PlotRef[] | null,
): string => {
  const key = plotKey?.trim();
  if (!key) return key;

  const matched = findPlotRef(plots, plotKey);
  const fastapi = matched?.fastapi_plot_id
    ? String(matched.fastapi_plot_id).trim()
    : "";

  if (fastapi) return fastapi;

  const gat =
    matched?.gat_number != null ? String(matched.gat_number).trim() : "";
  const num =
    matched?.plot_number != null ? String(matched.plot_number).trim() : "";
  if (gat && num) {
    return `${gat}/${num}`;
  }

  return key;
};

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
  const seen = new Set<string>();

  const add = (value: string | undefined | null) => {
    const s = String(value ?? "").trim();
    if (!s) return;
    const k = normalizePlotKey(s);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };

  const matched = findPlotRef(plots, plotId);

  if (matched?.fastapi_plot_id) add(matched.fastapi_plot_id);
  add(plotId);
  add(resolveApiPlotName(plotId, plots));
  if (matched?.gat_number != null && matched?.plot_number != null) {
    add(`${matched.gat_number}_${matched.plot_number}`);
    add(`${matched.gat_number}/${matched.plot_number}`);
  }
  if (matched?.plot_name) add(matched.plot_name);

  return out.length > 0 ? out : [plotId];
}
