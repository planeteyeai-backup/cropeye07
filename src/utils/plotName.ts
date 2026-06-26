/**
 * Plot id sent to admin layer APIs (analyze_Growth, wateruptake, SoilMoisture, etc.).
 * Always prefer the exact `fastapi_plot_id` from `/farms/my-profile/` — do not rewrite `/` → `_`.
 */
import { encodePlotIdForEventsUrl } from "../api";

export const resolveApiPlotName = (
  plotKey: string,
  plots?: Array<{
    fastapi_plot_id?: string;
    gat_number?: string;
    plot_number?: string;
  }> | null,
): string => {
  const key = plotKey?.trim();
  if (!key) return key;

  const matchesKey = (p: {
    fastapi_plot_id?: string;
    gat_number?: string;
    plot_number?: string;
  }) => {
    if (!p) return false;
    const fastapi = p.fastapi_plot_id ? String(p.fastapi_plot_id).trim() : "";
    if (fastapi && fastapi === key) return true;

    const gat = String(p.gat_number ?? "").trim();
    const num = String(p.plot_number ?? "").trim();
    if (!gat || !num) return false;

    const underscored = `${gat}_${num}`;
    const slashed = `${gat}/${num}`;
    return (
      underscored === key ||
      slashed === key ||
      underscored === key.replace(/\//g, "_") ||
      slashed === key.replace(/_/g, "/")
    );
  };

  const plot = plots?.find(matchesKey);

  if (plot?.fastapi_plot_id) {
    return String(plot.fastapi_plot_id).trim();
  }

  // No profile match — use the key as-is (selected value may already be fastapi_plot_id)
  return key;
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
