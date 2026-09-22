import {
  fieldScoreCacheKey,
  findPlotRef,
  formatPlotNameForApi,
  getPlotNameCandidates,
  normalizePlotKey,
  type PlotRef,
} from './plotName';
import { getFieldScoreBaseUrl } from './sarIndexHost';
import { parseResponseJson } from './requestCache';

export { fieldScoreCacheKey };

const pickLatestFieldRow = (rows: any[]): any | null => {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const dateA = a.date || a.analysis_date || '';
    const dateB = b.date || b.analysis_date || '';
    return String(dateB).localeCompare(String(dateA));
  });
  return sorted[0];
};

function extractScore(fieldData: any): number | null {
  const score =
    fieldData?.overall_health ??
    fieldData?.health_score ??
    fieldData?.statistics?.mean;

  if (score == null || Number.isNaN(Number(score))) return null;
  return Number(score);
}

/** SEF `/analyze` expects gat/plot names (`64/1`), not bare Django numeric ids. */
function fieldScorePlotCandidates(
  plotId: string,
  plots?: PlotRef[] | null,
): string[] {
  const all = getPlotNameCandidates(plotId, plots);
  const preferred = all.filter((c) => !/^\d+$/.test(c));
  return preferred.length > 0 ? preferred : all;
}

async function fetchFieldScoreByPlotName(
  apiPlot: string,
  plotKeyNorm: string,
): Promise<number | null> {
  const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
  const endDate = new Date(Date.now() - tzOffsetMs)
    .toISOString()
    .slice(0, 10);

  const formattedPlot = formatPlotNameForApi(apiPlot);
  const base = getFieldScoreBaseUrl();
  const resp = await fetch(
    `${base}/analyze?plot_name=${encodeURIComponent(formattedPlot)}&end_date=${endDate}&days_back=7`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );
  if (!resp.ok) return null;

  const data = await parseResponseJson(resp);
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

  return extractScore(fieldData);
}

export async function fetchFieldScoreForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
): Promise<number | null> {
  if (!plotId?.trim()) return null;

  const matchedPlot = findPlotRef(plots, plotId);
  const plotList =
    matchedPlot && plots?.length
      ? [matchedPlot, ...plots.filter((plot) => plot !== matchedPlot)]
      : plots;

  const candidates = fieldScorePlotCandidates(plotId, plotList);
  const plotKeyNorm = normalizePlotKey(candidates[0] ?? plotId);

  for (const candidate of candidates) {
    try {
      const score = await fetchFieldScoreByPlotName(candidate, plotKeyNorm);
      if (score != null) return score;
    } catch {
      // try next candidate
    }
  }

  return null;
}
