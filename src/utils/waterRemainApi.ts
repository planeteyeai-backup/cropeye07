/**
 * GET /water-remain-per-day — same logic as CropO Flutter WaterBalanceApi:
 *   query: plot_name, start_date, end_date, crop_name?, lat?, lon?
 * Docs: https://sef-cropeye.up.railway.app/docs
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";
import { getCache, setCache } from "./cache";

/** Flutter uses 60s; SEF month ranges are slow. */
const WATER_REMAIN_TIMEOUT_MS = 60_000;
const WATER_REMAIN_CACHE_MS = 15 * 60 * 1000;

export type WaterHourStep = {
  etoMm: number;
  hourLossLiters: number;
  waterVolumeBeforeLiters: number;
  waterVolumeAfterLiters: number;
};

export type WaterRemainDay = {
  date: string; // YYYY-MM-DD
  eto_sum_mm: number;
  eto_loss_liters: number;
  water_volume_liters: number;
  water_remain_liters: number;
  water_remain_m3: number;
  one_mm_liters?: number;
  ndmi?: number | null;
  hourly_steps?: WaterHourStep[];
};

export type WaterRemainParsed = {
  plotName: string;
  cropName?: string;
  areaM2?: number;
  totalWaterRemainLiters?: number;
  totalEtoLossLiters?: number;
  latestNdmi?: number | null;
  days: WaterRemainDay[];
  raw: any;
};

export type WaterRemainFetchExtras = {
  cropName?: string;
  lat?: number;
  lon?: number;
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

/** Keep only past/today rows, sorted, last N days. */
export function filterPastDays(
  days: WaterRemainDay[],
  daysBack = 7,
  timeZone = IST,
): WaterRemainDay[] {
  const today = todayIsoInTz(timeZone);
  return [...days]
    .filter((d) => d.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-daysBack);
}

function orderWaterRemainCandidates(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const s = String(v ?? "").trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  const isNumericPlot = (s: string) =>
    /^\d+[/_]\d+[a-zA-Z]?$/.test(s.replace(/\//g, "_"));

  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    if (isNumericPlot(s)) {
      // e.g. 305/503 → SEF often only has 305_503 — try underscore first.
      if (s.includes("/")) push(s.replace(/\//g, "_"));
      push(s);
      if (s.includes("_")) push(s.replace(/_/g, "/"));
    } else {
      push(s);
      if (s.includes("_")) push(s.replace(/_/g, "/"));
      if (s.includes("/")) push(s.replace(/\//g, "_"));
    }
  }
  return out;
}

function waterRemainCacheKey(
  plotName: string,
  start_date: string,
  end_date: string,
  extras?: WaterRemainFetchExtras,
): string {
  const crop = extras?.cropName?.trim().toLowerCase() || "";
  const lat =
    extras?.lat != null && Number.isFinite(extras.lat)
      ? extras.lat.toFixed(5)
      : "";
  const lon =
    extras?.lon != null && Number.isFinite(extras.lon)
      ? extras.lon.toFixed(5)
      : "";
  return `waterRemain_${plotName}_${start_date}_${end_date}_${crop}_${lat}_${lon}`;
}

function normalizeHourStep(item: any): WaterHourStep | null {
  if (!item || typeof item !== "object") return null;
  return {
    etoMm: toFinite(item.eto_mm) ?? 0,
    hourLossLiters: toFinite(item.hour_loss_liters) ?? 0,
    waterVolumeBeforeLiters: toFinite(item.water_volume_before_liters) ?? 0,
    waterVolumeAfterLiters: toFinite(item.water_volume_after_liters) ?? 0,
  };
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

  const hourlyRaw = Array.isArray(item.hourly_steps) ? item.hourly_steps : [];
  const hourly_steps = hourlyRaw
    .map(normalizeHourStep)
    .filter((s: WaterHourStep | null): s is WaterHourStep => s != null);

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
    ndmi: toFinite(item.ndmi),
    hourly_steps: hourly_steps.length ? hourly_steps : undefined,
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

  let latestNdmi: number | null = null;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].ndmi != null && Number.isFinite(days[i].ndmi as number)) {
      latestNdmi = days[i].ndmi as number;
      break;
    }
  }

  return {
    plotName: String(data.plot_name ?? ""),
    cropName: data.crop_name != null ? String(data.crop_name) : undefined,
    areaM2: toFinite(data.area_m2) ?? undefined,
    totalWaterRemainLiters: toFinite(data.total_water_remain_liters) ?? undefined,
    totalEtoLossLiters: toFinite(data.total_eto_loss_liters) ?? undefined,
    latestNdmi,
    days,
    raw: data,
  };
}

const IST = "Asia/Kolkata";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in plot timezone (default IST). */
export function todayIsoInTz(timeZone = IST): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Last N calendar days ending today (inclusive) in IST. Flutter default = 30. */
export function pastRange(
  daysBack = 30,
  timeZone = IST,
): { start_date: string; end_date: string } {
  const end_date = todayIsoInTz(timeZone);
  const end = new Date(`${end_date}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - (daysBack - 1));
  return { start_date: isoDate(start), end_date };
}

/** ~Same calendar day last month through today (e.g. 02 Aug → 02 Sep). */
export function pastSameDayLastMonthRange(
  timeZone = IST,
): { start_date: string; end_date: string } {
  const end_date = todayIsoInTz(timeZone);
  const [y, mo, day] = end_date.split("-").map(Number);
  const start = new Date(y, mo - 2, day);
  const start_date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { start_date, end_date };
}

/** Keep rows within [start, end] and not after today. */
export function filterDaysInRange(
  days: WaterRemainDay[],
  startIso: string,
  endIso: string,
  timeZone = IST,
): WaterRemainDay[] {
  const today = todayIsoInTz(timeZone);
  const end = endIso < today ? endIso : today;
  return [...days]
    .filter((d) => d.date >= startIso && d.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** e.g. "27 August to 2 Sep" for chart/table subtitles. */
export function formatIrrigationDateRange(
  startIso: string,
  endIso: string,
): string {
  const start = new Date(`${startIso.slice(0, 10)}T12:00:00`);
  const end = new Date(`${endIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }
  const startLabel = start.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
  });
  const endLabel = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return `${startLabel} to ${endLabel}`;
}

/** Daily irrigation need (L) = net ETo after rain × mm-to-L factor from API. */
export function irrigationNeedLiters(
  etoSumMm: number,
  etoLossLiters: number,
  rainfallMm: number,
  oneMmLiters?: number,
): number {
  const rain = Math.max(0, Number(rainfallMm) || 0);
  const etoMm = Math.max(0, Number(etoSumMm) || 0);
  const loss = Math.max(0, Number(etoLossLiters) || 0);
  if (etoMm <= 0) return 0;

  const netMm = Math.max(0, etoMm - rain);
  if (oneMmLiters != null && oneMmLiters > 0) {
    return netMm * oneMmLiters;
  }
  return loss * (netMm / etoMm);
}

/** Flutter water-balance status from remain kL vs series max. */
export function waterBalanceStatus(
  remainKl: number,
  maxKl: number,
): { label: "Low" | "Moderate" | "High" | "Excessive"; color: string } {
  if (remainKl < 0) return { label: "Low", color: "#D32F2F" };
  const frac = maxKl <= 0 ? 0 : Math.min(1, Math.max(0, remainKl / maxKl));
  if (frac < 0.3) return { label: "Moderate", color: "#FFA000" };
  if (frac < 0.7) return { label: "High", color: "#2E7D32" };
  return { label: "Excessive", color: "#1565C0" };
}

async function getWaterRemainOnce(
  plotName: string,
  start_date: string,
  end_date: string,
  extras?: WaterRemainFetchExtras,
): Promise<any> {
  const cacheKey = waterRemainCacheKey(plotName, start_date, end_date, extras);
  const cached = getCache(cacheKey, WATER_REMAIN_CACHE_MS);
  if (cached) return cached;

  const base = waterRemainBaseUrl();
  const qs = new URLSearchParams({
    plot_name: plotName,
    start_date,
    end_date,
  });
  // Flutter WaterBalanceApi also sends crop + field centroid.
  const crop = extras?.cropName?.trim();
  if (crop) qs.set("crop_name", crop);
  if (extras?.lat != null && Number.isFinite(extras.lat)) {
    qs.set("lat", extras.lat.toFixed(6));
  }
  if (extras?.lon != null && Number.isFinite(extras.lon)) {
    qs.set("lon", extras.lon.toFixed(6));
  }

  const url = `${base}/water-remain-per-day?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATER_REMAIN_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      mode: "cors",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const data = await resp.json();
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Water remain timed out after ${WATER_REMAIN_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET `/water-remain-per-day` — Flutter WaterBalanceApi.fetch equivalent.
 * Default window = 30 days when no customRange (matches Flutter).
 */
export async function fetchWaterRemainForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
  daysBack = 30,
  customRange?: { start_date: string; end_date: string },
  extras?: WaterRemainFetchExtras,
): Promise<WaterRemainParsed> {
  if (!plotId?.trim()) throw new Error("Missing plot name");

  const { start_date, end_date } = customRange ?? pastRange(daysBack);
  const candidates = orderWaterRemainCandidates(
    getPlotNameCandidates(plotId, plots),
  );
  let lastErr: Error | null = null;

  for (const candidate of candidates) {
    try {
      const raw = await getWaterRemainOnce(
        candidate,
        start_date,
        end_date,
        extras,
      );
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

/** User-facing message when SEF has no plot boundary saved. Timeouts stay silent. */
export function formatWaterRemainError(err: unknown, plotId: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("404") ||
    /plot not found/i.test(msg)
  ) {
    return `Plot "${plotId}" is not registered in the irrigation service. Save the plot boundary (KML) again or ask your field officer to sync it.`;
  }
  // Don't surface slow SEF timeouts — card already shows empty/0 state.
  if (/timed out/i.test(msg)) {
    return "";
  }
  return `Water remain failed: ${msg}`;
}
