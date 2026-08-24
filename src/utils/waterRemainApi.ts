/**
 * GET /water-remain-per-day — daily ETo loss + water remain (L / m³).
 * Docs: https://sef-cropeye.up.railway.app/docs#/default/water_remain_get_water_remain_per_day_get
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";

export type WaterRemainDay = {
  date: string; // YYYY-MM-DD
  eto_sum_mm: number;
  eto_loss_liters: number;
  water_volume_liters: number;
  water_remain_liters: number;
  water_remain_m3: number;
  one_mm_liters?: number;
};

export type WaterRemainParsed = {
  plotName: string;
  days: WaterRemainDay[];
  raw: any;
};

const SEF_WATER_REMAIN_BASE = "https://sef-cropeye.up.railway.app";

function waterRemainBaseUrl(): string {
  return (
    String(import.meta.env.VITE_DEV_WATER_REMAIN_API_URL ?? "")
      .trim()
      .replace(/\/$/, "") ||
    String(import.meta.env.VITE_DEV_FIELD_API_URL ?? "")
      .trim()
      .replace(/\/$/, "") ||
    SEF_WATER_REMAIN_BASE
  );
}

function toFinite(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function orderCandidates(candidates: string[]): string[] {
  return [...candidates].sort((a, b) => {
    const aSlash = a.includes("/") ? 0 : 1;
    const bSlash = b.includes("/") ? 0 : 1;
    if (aSlash !== bSlash) return aSlash - bSlash;
    return a.length - b.length;
  });
}

function normalizeDay(item: any): WaterRemainDay | null {
  if (!item || typeof item !== "object") return null;
  const date = String(item.date ?? item.day ?? "").slice(0, 10);
  if (!date) return null;

  const etoLoss =
    toFinite(item.eto_loss_liters) ??
    toFinite(item.daily_water_loss_liters_from_eto_sum) ??
    0;
  const remainL =
    toFinite(item.water_remain_liters) ??
    toFinite(item.waterRemainLiters) ??
    0;
  const remainM3 =
    toFinite(item.water_remain_m3) ??
    (remainL != null ? remainL / 1000 : 0);

  return {
    date,
    eto_sum_mm: toFinite(item.eto_sum_mm) ?? toFinite(item.eto) ?? 0,
    eto_loss_liters: etoLoss ?? 0,
    water_volume_liters:
      toFinite(item.water_volume_liters) ??
      toFinite(item.water_liter) ??
      toFinite(item.water_liters) ??
      0,
    water_remain_liters: remainL ?? 0,
    water_remain_m3: remainM3 ?? 0,
    one_mm_liters: toFinite(item.one_mm_liters) ?? undefined,
  };
}

export function parseWaterRemainResponse(data: any): WaterRemainParsed | null {
  if (!data || typeof data !== "object") return null;

  const rawSeries =
    (Array.isArray(data.time_series) && data.time_series) ||
    (Array.isArray(data.days) && data.days) ||
    (Array.isArray(data.data) && data.data) ||
    (Array.isArray(data) ? data : null);

  const days = (rawSeries || [])
    .map(normalizeDay)
    .filter((d: WaterRemainDay | null): d is WaterRemainDay => d != null)
    .sort((a: WaterRemainDay, b: WaterRemainDay) => a.date.localeCompare(b.date));

  if (!days.length) return null;

  return {
    plotName: String(data.plot_name ?? ""),
    days,
    raw: data,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last N calendar days ending today (inclusive). */
export function pastRange(daysBack = 7): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (daysBack - 1));
  return { start_date: isoDate(start), end_date: isoDate(end) };
}

async function getWaterRemainOnce(
  plotName: string,
  start_date: string,
  end_date: string,
): Promise<any> {
  const base = waterRemainBaseUrl();
  const qs = new URLSearchParams({
    plot_name: plotName,
    start_date,
    end_date,
  });
  const url = `${base}/water-remain-per-day?${qs.toString()}`;

  const resp = await fetch(url, {
    method: "GET",
    mode: "cors",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return await resp.json();
}

/** GET `/water-remain-per-day` for past days (default last 7). */
export async function fetchWaterRemainForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
  daysBack = 7,
): Promise<WaterRemainParsed> {
  if (!plotId?.trim()) throw new Error("Missing plot name");

  const { start_date, end_date } = pastRange(daysBack);
  const candidates = orderCandidates(getPlotNameCandidates(plotId, plots));
  let lastErr: Error | null = null;

  for (const candidate of candidates) {
    try {
      const raw = await getWaterRemainOnce(candidate, start_date, end_date);
      const parsed = parseWaterRemainResponse(raw);
      if (!parsed) {
        lastErr = new Error("Water remain response had no time_series");
        continue;
      }
      return { ...parsed, plotName: parsed.plotName || candidate };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr || new Error("Water remain API failed");
}
