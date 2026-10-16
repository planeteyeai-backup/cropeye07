import {
  fieldScoreCacheKey,
  findPlotRef,
  formatPlotNameForApi,
  getPlotNameCandidates,
  normalizePlotKey,
  type PlotRef,
} from './plotName';
import { FIELD_SCORE_HOST_DEFAULT } from './sarIndexHost';
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

/**
 * SEF `/analyze` plot ids:
 * - underscore (`564_865`) usually works; slash (`564/865`) often 500s
 * - bare Django numeric ids (`100`) also work on SEF for some plots
 */
export function fieldScorePlotCandidates(
  plotId: string,
  plots?: PlotRef[] | null,
): string[] {
  const all = getPlotNameCandidates(plotId, plots);
  const named = all.filter((candidate) => !/^\d+$/.test(candidate));
  const numeric = all.filter((candidate) => /^\d+$/.test(candidate));
  const matched = findPlotRef(plots, plotId);
  if (matched?.id != null) {
    const id = String(matched.id).trim();
    if (/^\d+$/.test(id) && !numeric.includes(id)) numeric.push(id);
  }
  if (/^\d+$/.test(String(plotId).trim())) {
    const id = String(plotId).trim();
    if (!numeric.includes(id)) numeric.push(id);
  }

  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | undefined | null) => {
    const s = String(value ?? '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  // Prefer numeric Django id first when available — SEF often keys plots this way.
  for (const candidate of numeric) add(candidate);

  for (const candidate of named) {
    if (candidate.includes('/')) add(candidate.replace(/\//g, '_'));
  }
  for (const candidate of named) add(candidate);
  for (const candidate of named) {
    if (candidate.includes('_') && !candidate.includes('/')) {
      add(candidate.replace(/_/g, '/'));
    }
  }

  // Some records append a local sub-plot suffix (for example `36/1_-2`)
  // that is not present in the SEF plot catalog; retry the parent plot name.
  for (const candidate of [...out]) {
    const parent = candidate.replace(/(?:_|\/)-\d+$/, '').trim();
    if (parent && parent !== candidate) add(parent);
  }

  return out;
}

async function fetchFieldScoreByPlotName(
  apiPlot: string,
  plotKeyNorm: string,
  signal: AbortSignal,
): Promise<number | null> {
  const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
  const endDate = new Date(Date.now() - tzOffsetMs)
    .toISOString()
    .slice(0, 10);

  const formattedPlot = formatPlotNameForApi(apiPlot);
  // Always SEF Railway — cropeye.ai/api/sef returns SPA HTML (200) with no score.
  const resp = await fetch(
    `${FIELD_SCORE_HOST_DEFAULT}/analyze?plot_name=${encodeURIComponent(formattedPlot)}&end_date=${endDate}&days_back=7`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    },
  );
  if (!resp.ok) return null;
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) return null;

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    for (const candidate of candidates) {
      try {
        const score = await fetchFieldScoreByPlotName(
          candidate,
          normalizePlotKey(candidate),
          controller.signal,
        );
        if (score != null) return score;
      } catch {
        if (controller.signal.aborted) return null;
        // try next candidate
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}
