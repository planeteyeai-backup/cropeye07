/** Plot id sent to analyze_Growth / layer APIs (underscore form, not gat/plot display). */
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

  const plot = plots?.find((p) => {
    if (!p) return false;
    const gat = String(p.gat_number ?? '').trim();
    const num = String(p.plot_number ?? '').trim();
    const underscored = gat && num ? `${gat}_${num}`.replace(/\//g, '_') : '';
    const slashed = gat && num ? `${gat}/${num}` : '';
    return (
      p.fastapi_plot_id === key ||
      underscored === key ||
      slashed === key ||
      underscored === key.replace(/\//g, '_') ||
      slashed === key.replace(/_/g, '/')
    );
  });

  const fromGatPlot =
    plot?.gat_number != null && plot?.plot_number != null
      ? `${String(plot.gat_number).trim()}_${String(plot.plot_number).trim()}`.replace(
          /\//g,
          '_',
        )
      : '';

  const fastapi = plot?.fastapi_plot_id ? String(plot.fastapi_plot_id).trim() : '';

  if (fastapi && !fastapi.includes('/')) return fastapi;
  if (fromGatPlot) return fromGatPlot;
  if (fastapi) return fastapi.replace(/\//g, '_');
  return key.replace(/\//g, '_');
};
