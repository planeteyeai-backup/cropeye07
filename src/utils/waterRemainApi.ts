/**
 * GET /water-remain-per-day — SEF OpenAPI:
 *   query: plot_name, crop_name?, start_date?, end_date?, sand_pct?, silt_pct?, clay_pct?
 * Docs: https://sef-cropeye.up.railway.app/docs
 * Note: lat/lon are NOT accepted by this endpoint (ignored if sent).
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";
import { getCache, setCache } from "./cache";

/** Flutter uses 60s; SEF month ranges are slow. */
const WATER_REMAIN_TIMEOUT_MS = 60_000;
const WATER_REMAIN_CACHE_MS = 15 * 60 * 1000;

export type WaterHourStep = {
  hour?: number;
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
  sandPct?: number;
  siltPct?: number;
  clayPct?: number;
  /**
   * When true, allow start→end shorter than ~35 days (real recent plantation).
   * Without this, accidental pastRange(30) windows are expanded to 365 days.
   */
  allowShortRange?: boolean;
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

/**
 * Water remain in KL — one rule for footer "X KL remain" AND Need (KL) column.
 *   prefer water_remain_liters / 1000
 *   else water_remain_m3 as KL (1 m³ = 1 KL — never ÷ 1000 on m³)
 */
export function remainKlFromWaterFields(
  waterRemainLiters?: number | null,
  waterRemainM3?: number | null,
): number {
  const liters = toFinite(waterRemainLiters);
  if (liters != null) return liters / 1000;
  const m3 = toFinite(waterRemainM3);
  if (m3 != null) return m3;
  return 0;
}

/** Need (KL) from same remain: deficit only → abs(remainKl), else 0. */
export function needKlFromWaterFields(
  waterRemainLiters?: number | null,
  waterRemainM3?: number | null,
): number {
  const kl = remainKlFromWaterFields(waterRemainLiters, waterRemainM3);
  return kl < 0 ? Math.abs(kl) : 0;
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

/**
 * SEF plot ids are inconsistent:
 *   - pure numeric gat/plot → usually underscore (`305_503`); slash 404s
 *   - letter suffix (`8/1A`) → usually slash; underscore 404s
 * Always try both forms; order reduces noisy 404s.
 */
function orderWaterRemainCandidates(candidates: string[]): string[] {
  const forms = new Set<string>();
  for (const raw of candidates) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    forms.add(s);
    if (s.includes("/")) forms.add(s.replace(/\//g, "_"));
    if (s.includes("_")) forms.add(s.replace(/_/g, "/"));
  }

  const score = (s: string): number => {
    const hasAlphaSuffix = /[/_]\d*[a-zA-Z]/i.test(s);
    const underscoreOnly = s.includes("_") && !s.includes("/");
    const slashOnly = s.includes("/") && !s.includes("_");
    if (hasAlphaSuffix) {
      if (slashOnly) return 0;
      if (underscoreOnly) return 1;
      return 2;
    }
    if (underscoreOnly) return 0;
    if (slashOnly) return 1;
    return 2;
  };

  return [...forms].sort((a, b) => {
    const d = score(a) - score(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

function waterRemainCacheKey(
  plotName: string,
  start_date: string,
  end_date: string,
  extras?: WaterRemainFetchExtras,
): string {
  const crop = (extras?.cropName?.trim() || "sugarcane").toLowerCase();
  const sand =
    extras?.sandPct != null && Number.isFinite(extras.sandPct)
      ? String(extras.sandPct)
      : "";
  const silt =
    extras?.siltPct != null && Number.isFinite(extras.siltPct)
      ? String(extras.siltPct)
      : "";
  const clay =
    extras?.clayPct != null && Number.isFinite(extras.clayPct)
      ? String(extras.clayPct)
      : "";
  return `waterRemain_${plotName}_${start_date}_${end_date}_${crop}_${sand}_${silt}_${clay}`;
}

function normalizeHourStep(item: any, index = 0): WaterHourStep | null {
  if (!item || typeof item !== "object") return null;
  const hourRaw =
    toFinite(item.hour) ??
    toFinite(item.hour_of_day) ??
    toFinite(item.h) ??
    index;
  return {
    hour: hourRaw != null && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : index,
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
  // Liters is the source of truth (Flutter). Derive m³/KL from liters when
  // present so a bad/stale water_remain_m3 from the API cannot skew charts.
  const remainL =
    toFinite(item.water_remain_liters) ??
    toFinite(item.waterRemainLiters);
  const remainM3FromApi = toFinite(item.water_remain_m3);
  // Keep liters + m3 aligned with remainKlFromWaterFields (1 m³ = 1 KL).
  const remainKl = remainKlFromWaterFields(remainL, remainM3FromApi);
  const remainLitersFinal =
    remainL ?? (remainM3FromApi != null ? remainM3FromApi * 1000 : 0);
  const remainM3 = remainL != null ? remainL / 1000 : remainKl;

  const hourlyRaw = Array.isArray(item.hourly_steps) ? item.hourly_steps : [];
  const hourly_steps = hourlyRaw
    .map((step: any, i: number) => normalizeHourStep(step, i))
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
    water_remain_liters: remainLitersFinal,
    water_remain_m3: remainM3,
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

/** Today as YYYY-MM-DD in plot timezone (default IST). */
export function todayIsoInTz(timeZone = IST): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Last N calendar days ending today (inclusive) in IST. */
export function pastRange(
  daysBack = 365,
  timeZone = IST,
): { start_date: string; end_date: string } {
  const end_date = todayIsoInTz(timeZone);
  const [y, mo, day] = end_date.split("-").map(Number);
  const end = new Date(y, mo - 1, day);
  const start = new Date(end);
  start.setDate(start.getDate() - (daysBack - 1));
  const start_date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { start_date, end_date };
}

/** Inclusive range clamped so start ≤ end ≤ today (IST). */
export function rangeToToday(
  startIso: string | null | undefined,
  timeZone = IST,
): { start_date: string; end_date: string } {
  const end_date = todayIsoInTz(timeZone);
  const raw = String(startIso ?? "")
    .trim()
    .slice(0, 10);
  let start_date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  if (!start_date || start_date > end_date) {
    return pastRange(365, timeZone);
  }
  return { start_date, end_date };
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

const waterRemainInFlight = new Map<string, Promise<any>>();

/** Remember which plot_name form SEF accepted (slash vs underscore). */
const preferredPlotForm = new Map<string, string>();

function plotFormKey(plotId: string): string {
  return String(plotId ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "/");
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

  const existing = waterRemainInFlight.get(cacheKey);
  if (existing) return existing;

  const base = waterRemainBaseUrl();
  const qs = new URLSearchParams({
    plot_name: plotName,
    start_date,
    end_date,
  });
  // Official SEF GET params (OpenAPI): crop_name is required for correct remain.
  // Never omit it — short calls without crop default to sugarcane server-side and skew KL.
  qs.set("crop_name", extras?.cropName?.trim() || "sugarcane");
  if (extras?.sandPct != null && Number.isFinite(extras.sandPct)) {
    qs.set("sand_pct", String(extras.sandPct));
  }
  if (extras?.siltPct != null && Number.isFinite(extras.siltPct)) {
    qs.set("silt_pct", String(extras.siltPct));
  }
  if (extras?.clayPct != null && Number.isFinite(extras.clayPct)) {
    qs.set("clay_pct", String(extras.clayPct));
  }

  const url = `${base}/water-remain-per-day?${qs.toString()}`;
  if (import.meta.env.DEV) {
    console.debug("[water-remain]", url);
  }

  const pending = (async () => {
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
        throw new Error(
          `Water remain timed out after ${WATER_REMAIN_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      waterRemainInFlight.delete(cacheKey);
    }
  })();

  waterRemainInFlight.set(cacheKey, pending);
  return pending;
}

/**
 * Resolve water-remain date window.
 * Default / preferred: ~1 calendar month (Month tab). Do not auto-expand to 365d.
 */
function resolveFetchRange(
  daysBack: number,
  customRange: { start_date: string; end_date: string } | undefined,
  _extras?: WaterRemainFetchExtras,
): { start_date: string; end_date: string } {
  if (customRange?.start_date && customRange?.end_date) {
    return customRange;
  }
  if (daysBack > 0 && daysBack <= 35) {
    return pastSameDayLastMonthRange();
  }
  return pastRange(Math.max(daysBack, 30));
}

/**
 * GET `/water-remain-per-day` — SEF OpenAPI.
 * Preferred window = last ~1 calendar month (start ≈ same day last month → today)
 * + crop_name. Matches Month tab ("19 August to 18 Sept").
 */
export async function fetchWaterRemainForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
  daysBack = 31,
  customRange?: { start_date: string; end_date: string },
  extras?: WaterRemainFetchExtras,
): Promise<WaterRemainParsed> {
  if (!plotId?.trim()) throw new Error("Missing plot name");

  const { start_date, end_date } = resolveFetchRange(daysBack, customRange, extras);
  const ordered = orderWaterRemainCandidates(
    getPlotNameCandidates(plotId, plots),
  );
  const preferred = preferredPlotForm.get(plotFormKey(plotId));
  const candidates =
    preferred && ordered.includes(preferred)
      ? [preferred, ...ordered.filter((c) => c !== preferred)]
      : ordered;
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
      preferredPlotForm.set(plotFormKey(plotId), candidate);
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
    const safePlot = String(plotId ?? "")
      .trim()
      .slice(0, 64)
      .replace(/[^\w/._+\-]/g, "");
    return `Plot "${safePlot || "selected"}" is not registered in the irrigation service. Save the plot boundary (KML) again or ask your field officer to sync it.`;
  }
  if (/timed out|abort/i.test(msg)) {
    return "";
  }
  if (/HTTP\s*5\d\d|502|503|504|524|network|failed to fetch/i.test(msg)) {
    return "Irrigation service is temporarily unavailable. Try again shortly.";
  }
  return "Could not load water remain for this plot.";
}
