export type PlotRef = {
  fastapi_plot_id?: string;
  events_plot_id?: string;
  plot_name?: string;
  plot_id?: string;
  gat_number?: string;
  plot_number?: string;
  Group_Gat_No?: string;
  Gat_No_Id?: string;
  boundary?: { coordinates?: unknown };
};

/** Compare plot ids: `143/3`, `143_3`, and spacing variants match. */
export const normalizePlotKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\+/g, ' ')
    .replace(/\//g, '_')
    .replace(/\s+/g, ' ')
    .toLowerCase();

export function plotKeysMatch(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return normalizePlotKey(a) === normalizePlotKey(b);
}

/** Events/SEF API: spaces → `+` (e.g. `188_1 2A` → `188_1+2A`). */
export function formatPlotNameForApi(plotId: string | number): string {
  return String(plotId).trim().replace(/ /g, '+');
}

export function fieldScoreCacheKey(plotId: string): string {
  return `fieldScore_${normalizePlotKey(plotId)}`;
}

function gatPlotPair(plot: PlotRef): { gat: string; num: string } {
  const gat = String(
    plot.gat_number ?? plot.Group_Gat_No ?? '',
  ).trim();
  const num = String(plot.plot_number ?? plot.Gat_No_Id ?? '').trim();
  return { gat, num };
}

export function plotIdentityCandidates(plot: PlotRef | null | undefined): string[] {
  if (!plot) return [];
  const { gat, num } = gatPlotPair(plot);
  const underscored =
    gat && num ? `${gat}_${num}`.replace(/\//g, '_') : '';
  const slashed = gat && num ? `${gat}/${num}` : '';

  const raw = [
    plot.fastapi_plot_id,
    plot.events_plot_id,
    plot.plot_name,
    plot.plot_id,
    underscored,
    slashed,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function findPlotRef(
  plots: PlotRef[] | null | undefined,
  plotKey: string,
): PlotRef | undefined {
  if (!plots?.length || !plotKey?.trim()) return undefined;
  return plots.find((plot) =>
    plotIdentityCandidates(plot).some((candidate) =>
      plotKeysMatch(candidate, plotKey),
    ),
  );
}

/** Plot id sent to analyze / field-score APIs (underscore form when possible). */
export const resolveApiPlotName = (
  plotKey: string,
  plots?: PlotRef[] | null,
): string => {
  const key = plotKey?.trim();
  if (!key) return key;

  const plot = findPlotRef(plots, key);
  const { gat, num } = gatPlotPair(plot ?? {});
  const fromGatPlot =
    gat && num
      ? `${gat}_${num}`.replace(/\//g, '_')
      : '';

  const fastapi = plot?.fastapi_plot_id
    ? String(plot.fastapi_plot_id).trim()
    : '';

  if (fastapi && !fastapi.includes('/')) {
    return formatPlotNameForApi(fastapi);
  }
  if (fromGatPlot) return formatPlotNameForApi(fromGatPlot);
  if (fastapi) return formatPlotNameForApi(fastapi.replace(/\//g, '_'));
  return formatPlotNameForApi(key.replace(/\//g, '_'));
};

/** Names to try against field-score API when format varies (`1143_23` vs `143/3`). */
export function getPlotNameCandidates(
  plotKey: string,
  plots?: PlotRef[] | null,
): string[] {
  const key = plotKey?.trim();
  if (!key) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value?: string | null) => {
    if (!value?.trim()) return;
    const trimmed = value.trim();
    const variants = [
      trimmed,
      trimmed.replace(/\//g, '_'),
      formatPlotNameForApi(trimmed),
      formatPlotNameForApi(trimmed.replace(/\//g, '_')),
    ];
    for (const variant of variants) {
      const norm = normalizePlotKey(variant);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(variant);
    }
  };

  add(key);
  add(resolveApiPlotName(key, plots));

  const plot = findPlotRef(plots, key);
  if (plot) {
    for (const candidate of plotIdentityCandidates(plot)) {
      add(candidate);
    }
  }

  return out;
};

/** Exact fastapi_plot_id + URL-encoded form for Events/admin API paths and query params. */
export function resolvePlotForEventsApi(
  plotKey: string,
  plots?: Array<{
    fastapi_plot_id?: string;
    gat_number?: string;
    plot_number?: string;
  }> | null,
): { plotId: string; encoded: string } {
  const plotId = resolveApiPlotName(plotKey, plots);
  return { plotId, encoded: encodePlotIdForEventsUrl(plotId) };
}
