import { resolveApiPlotName } from './plotName';

const FIELD_SCORE_API = 'https://sef-cropeye.up.railway.app/analyze';

type PlotRef = {
  fastapi_plot_id?: string;
  gat_number?: string;
  plot_number?: string;
};

const normalizePlotKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\//g, '_')
    .toLowerCase();

const pickLatestFieldRow = (rows: any[]): any | null => {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const dateA = a.date || a.analysis_date || '';
    const dateB = b.date || b.analysis_date || '';
    return String(dateB).localeCompare(String(dateA));
  });
  return sorted[0];
};

export async function fetchFieldScoreForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
): Promise<number | null> {
  if (!plotId?.trim()) return null;

  const apiPlot = resolveApiPlotName(plotId, plots);
  const plotKeyNorm = normalizePlotKey(apiPlot);

  try {
    const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
    const endDate = new Date(Date.now() - tzOffsetMs)
      .toISOString()
      .slice(0, 10);

    const resp = await fetch(
      `${FIELD_SCORE_API}?plot_name=${encodeURIComponent(apiPlot)}&end_date=${endDate}&days_back=7`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    let fieldData: any = null;

    if (Array.isArray(data)) {
      const exact = data.filter((item: any) => {
        const itemPlotName =
          item.plot_name || item.plot || item.name || item.plot_id || '';
        return normalizePlotKey(itemPlotName) === plotKeyNorm;
      });

      fieldData = pickLatestFieldRow(exact) ?? pickLatestFieldRow(data);
    } else if (typeof data === 'object' && data !== null) {
      fieldData = data;
    }

    const score =
      fieldData?.overall_health ??
      fieldData?.health_score ??
      fieldData?.statistics?.mean;

    if (score == null || Number.isNaN(Number(score))) return null;
    return Number(score);
  } catch {
    return null;
  }
}
