/**
 * Agroclimatic weather + rainfall series for Owner/Manager dashboards.
 * Uses Open-Meteo (history + short forecast). Optional CropEye weather forecast merge.
 */

export type AgroWeatherDay = {
  date: string;
  month: string;
  precipitation: number;
  tempHigh: number;
  tempAvg: number;
  tempMin: number;
  wind: number;
  highHumidity: number;
  lowHumidity: number;
  /** Same as precipitation — for RainfallChart */
  rainfall: number;
  cumulativeRainfall: number;
  rainyDays: number;
  maxDailyRainfall: number;
  avgRainfall: number;
};

const DEFAULT_LAT = 16.7;
const DEFAULT_LON = 74.2;
const EMPTY_PLOTS: Array<{ position?: [number, number] | null }> = [];

function weatherBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_DEV_WEATHER_API_URL ?? "").trim();
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/$/, "");
  return "https://weather-cropeye.up.railway.app";
}

export type AgroTimePeriod = "daily" | "weekly" | "monthly" | "yearly";

/** How many past calendar days to pull from Open-Meteo before aggregating. */
const PERIOD_FETCH_DAYS: Record<AgroTimePeriod, number> = {
  daily: 14,
  weekly: 98,
  /** ~13 months so we can keep 12 complete months. */
  monthly: 400,
  /** ~5 calendar years for yearly totals. */
  yearly: 365 * 5 + 30,
};

const PERIOD_CHART_POINTS: Record<AgroTimePeriod, number> = {
  daily: 7,
  weekly: 12,
  monthly: 12,
  yearly: 5,
};

function sortByDate(series: AgroWeatherDay[]): AgroWeatherDay[] {
  return [...series].sort((a, b) => a.date.localeCompare(b.date));
}

function filterSeriesToLastDays(
  series: AgroWeatherDay[],
  days: number,
): AgroWeatherDay[] {
  const sorted = sortByDate(series);
  if (!sorted.length) return sorted;
  const lastDate = sorted[sorted.length - 1].date;
  const cut = new Date(`${lastDate}T12:00:00`);
  cut.setDate(cut.getDate() - days + 1);
  const cutStr = cut.toISOString().slice(0, 10);
  return sorted.filter((row) => row.date >= cutStr);
}

function weekStartKey(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  return weekStart.toISOString().slice(0, 10);
}

function monthKey(dateStr: string): string {
  return String(dateStr).slice(0, 7);
}

function yearKey(dateStr: string): string {
  return String(dateStr).slice(0, 4);
}

function formatWeekLabel(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatMonthLabelFromKey(key: string): string {
  const [year, month] = key.split("-");
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    1,
  ).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatYearLabel(key: string): string {
  return key;
}

/** Current YYYY-MM in IST (avoid UTC month roll). */
function currentMonthKeyIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

function aggregateBucket(
  items: AgroWeatherDay[],
  opts?: { tempExtremes?: boolean },
): AgroWeatherDay {
  const useExtremes = opts?.tempExtremes ?? false;
  const avg = (pick: (row: AgroWeatherDay) => number) =>
    items.reduce((sum, row) => sum + pick(row), 0) / items.length;
  const sum = (pick: (row: AgroWeatherDay) => number) =>
    items.reduce((total, row) => total + pick(row), 0);
  const sorted = sortByDate(items);
  const last = sorted[sorted.length - 1];
  const rainfallTotal = sum((row) => row.rainfall);
  const maxDailyRainfall = Math.max(
    ...items.map((row) => row.maxDailyRainfall),
    0,
  );

  return {
    date: sorted[0].date,
    month: sorted[0].month,
    precipitation: rainfallTotal,
    tempHigh: useExtremes
      ? Math.max(...items.map((row) => row.tempHigh))
      : avg((row) => row.tempHigh),
    tempAvg: avg((row) => row.tempAvg),
    tempMin: useExtremes
      ? Math.min(...items.map((row) => row.tempMin))
      : avg((row) => row.tempMin),
    wind: avg((row) => row.wind),
    highHumidity: avg((row) => row.highHumidity),
    lowHumidity: avg((row) => row.lowHumidity),
    rainfall: rainfallTotal,
    cumulativeRainfall: last?.cumulativeRainfall ?? 0,
    rainyDays: sum((row) => row.rainyDays),
    maxDailyRainfall,
    avgRainfall: items.length ? rainfallTotal / items.length : 0,
  };
}

/** Slice + aggregate live series for Daily / Weekly / Monthly / Yearly chart tabs. */
export function aggregateAgroWeatherSeries(
  series: AgroWeatherDay[],
  period: AgroTimePeriod,
): AgroWeatherDay[] {
  if (!series.length) return [];

  const today = ymdTodayIst();

  if (period === "daily") {
    // Daily = last 7 completed/past days including today — not future forecast.
    const historical = sortByDate(series).filter((row) => row.date <= today);
    return filterSeriesToLastDays(historical, PERIOD_CHART_POINTS.daily).map(
      (row) => ({
        ...row,
        month: formatDailyLabel(row.date),
      }),
    );
  }

  const windowed = filterSeriesToLastDays(series, PERIOD_FETCH_DAYS[period]).filter(
    (row) => row.date <= today,
  );
  const grouped = new Map<string, AgroWeatherDay[]>();

  for (const row of windowed) {
    const key =
      period === "weekly"
        ? weekStartKey(row.date)
        : period === "yearly"
          ? yearKey(row.date)
          : monthKey(row.date);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  let keys = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  // Monthly: drop incomplete current month so bars are full-month totals.
  if (period === "monthly") {
    const cur = currentMonthKeyIst();
    keys = keys.filter((k) => k < cur);
  }

  // Yearly: keep complete prior years + current year-to-date.
  if (period === "yearly") {
    // nothing to drop; current year is YTD by design
  }

  const aggregated = keys.map((key) => {
    const items = grouped.get(key)!;
    const row = aggregateBucket(items, {
      tempExtremes: period === "monthly" || period === "yearly",
    });
    return {
      ...row,
      date: key,
      month:
        period === "weekly"
          ? formatWeekLabel(key)
          : period === "yearly"
            ? formatYearLabel(key)
            : formatMonthLabelFromKey(key),
    };
  });

  return aggregated.slice(-PERIOD_CHART_POINTS[period]);
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function ymdDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Today YYYY-MM-DD in Asia/Kolkata. */
function ymdTodayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

/** Archive API lags ~1–2 days; never request future/today as end. */
function archiveEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function formatDailyLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type OpenMeteoDaily = {
  time?: string[];
  precipitation_sum?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  temperature_2m_mean?: number[];
  wind_speed_10m_max?: number[];
  relative_humidity_2m_max?: number[];
  relative_humidity_2m_min?: number[];
};

const ARCHIVE_DAILY_FIELDS = [
  "precipitation_sum",
  "temperature_2m_max",
  "temperature_2m_min",
  "temperature_2m_mean",
  "wind_speed_10m_max",
].join(",");

const FORECAST_DAILY_FIELDS = [
  "precipitation_sum",
  "temperature_2m_max",
  "temperature_2m_min",
  "temperature_2m_mean",
  "wind_speed_10m_max",
  "relative_humidity_2m_max",
  "relative_humidity_2m_min",
].join(",");

function mergeDaily(a: OpenMeteoDaily | null, b: OpenMeteoDaily | null): OpenMeteoDaily {
  const byDate = new Map<string, number>();
  const merged: OpenMeteoDaily = {
    time: [],
    precipitation_sum: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    temperature_2m_mean: [],
    wind_speed_10m_max: [],
    relative_humidity_2m_max: [],
    relative_humidity_2m_min: [],
  };

  const push = (daily: OpenMeteoDaily | null, preferOverwrite: boolean) => {
    if (!daily?.time?.length) return;
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      if (!date) continue;
      const existing = byDate.get(date);
      if (existing != null) {
        if (!preferOverwrite) continue;
        merged.precipitation_sum![existing] = num(daily.precipitation_sum?.[i]);
        merged.temperature_2m_max![existing] = num(daily.temperature_2m_max?.[i]);
        merged.temperature_2m_min![existing] = num(daily.temperature_2m_min?.[i]);
        merged.temperature_2m_mean![existing] = num(daily.temperature_2m_mean?.[i]);
        merged.wind_speed_10m_max![existing] = num(daily.wind_speed_10m_max?.[i]);
        if (daily.relative_humidity_2m_max?.[i] != null) {
          merged.relative_humidity_2m_max![existing] = num(
            daily.relative_humidity_2m_max?.[i],
          );
        }
        if (daily.relative_humidity_2m_min?.[i] != null) {
          merged.relative_humidity_2m_min![existing] = num(
            daily.relative_humidity_2m_min?.[i],
          );
        }
        continue;
      }
      byDate.set(date, merged.time!.length);
      merged.time!.push(date);
      merged.precipitation_sum!.push(num(daily.precipitation_sum?.[i]));
      merged.temperature_2m_max!.push(num(daily.temperature_2m_max?.[i]));
      merged.temperature_2m_min!.push(num(daily.temperature_2m_min?.[i]));
      merged.temperature_2m_mean!.push(num(daily.temperature_2m_mean?.[i]));
      merged.wind_speed_10m_max!.push(num(daily.wind_speed_10m_max?.[i]));
      merged.relative_humidity_2m_max!.push(num(daily.relative_humidity_2m_max?.[i]));
      merged.relative_humidity_2m_min!.push(num(daily.relative_humidity_2m_min?.[i]));
    }
  };

  // Archive first, then forecast overwrites recent overlapping days.
  push(a, false);
  push(b, true);
  return merged;
}

async function fetchOpenMeteoArchive(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<OpenMeteoDaily | null> {
  if (startDate > endDate) return null;
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate,
    end_date: endDate,
    daily: ARCHIVE_DAILY_FIELDS,
    timezone: "Asia/Kolkata",
  });
  const resp = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?${qs}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Open-Meteo archive ${resp.status}: ${text.slice(0, 120)}`);
  }
  const json = await resp.json();
  return (json?.daily as OpenMeteoDaily) ?? null;
}

async function fetchOpenMeteoForecastWindow(
  lat: number,
  lon: number,
): Promise<OpenMeteoDaily | null> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    past_days: "92",
    forecast_days: "1",
    daily: FORECAST_DAILY_FIELDS,
    timezone: "Asia/Kolkata",
  });
  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`Open-Meteo forecast ${resp.status}`);
  const json = await resp.json();
  return (json?.daily as OpenMeteoDaily) ?? null;
}

async function fetchOpenMeteoRange(
  lat: number,
  lon: number,
  startDate: string,
): Promise<OpenMeteoDaily | null> {
  const archEnd = archiveEndDate();
  const archStart = startDate <= archEnd ? startDate : archEnd;

  const [archive, recent] = await Promise.all([
    fetchOpenMeteoArchive(lat, lon, archStart, archEnd).catch((err) => {
      console.warn("[agroWeather] archive failed", err);
      return null;
    }),
    fetchOpenMeteoForecastWindow(lat, lon).catch((err) => {
      console.warn("[agroWeather] forecast failed", err);
      return null;
    }),
  ]);
  const merged = mergeDaily(archive, recent);
  return merged.time?.length ? merged : null;
}

/** Optional CropEye 7-day forecast — merges over Open-Meteo when available. */
async function fetchCropEyeForecast(
  lat: number,
  lon: number,
): Promise<Map<string, { precip: number; tmax: number; tmin: number; wind: number; hum: number }>> {
  const map = new Map<
    string,
    { precip: number; tmax: number; tmin: number; wind: number; hum: number }
  >();
  try {
    const url = `${weatherBaseUrl()}/forecast?lat=${lat}&lon=${lon}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return map;
    const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const row of rows) {
      const date = String(row?.date ?? "").slice(0, 10);
      if (!date) continue;
      map.set(date, {
        precip: num(String(row?.precipitation ?? "").replace(/[^\d.+-]/g, "")),
        tmax: num(String(row?.temperature_max ?? "").replace(/[^\d.+-]/g, "")),
        tmin: num(String(row?.temperature_min ?? "").replace(/[^\d.+-]/g, "")),
        wind: num(String(row?.wind_speed_max ?? "").replace(/[^\d.+-]/g, "")),
        hum: num(String(row?.humidity_max ?? "").replace(/[^\d.+-]/g, "")),
      });
    }
  } catch {
    // CropEye weather is optional; Open-Meteo remains primary.
  }
  return map;
}

function dailyToSeries(daily: OpenMeteoDaily, cropEye: Map<string, any>): AgroWeatherDay[] {
  const times = daily.time ?? [];
  let cumulative = 0;
  const out: AgroWeatherDay[] = [];

  for (let i = 0; i < times.length; i++) {
    const date = times[i];
    if (!date) continue;
    const ce = cropEye.get(date);
    const precip = ce?.precip ?? num(daily.precipitation_sum?.[i]);
    const tempHigh = ce?.tmax ?? num(daily.temperature_2m_max?.[i]);
    const tempMin = ce?.tmin ?? num(daily.temperature_2m_min?.[i]);
    const tempAvg =
      num(daily.temperature_2m_mean?.[i]) || (tempHigh + tempMin) / 2;
    const wind = ce?.wind ?? num(daily.wind_speed_10m_max?.[i]);
    const highHumidity = ce?.hum ?? num(daily.relative_humidity_2m_max?.[i]);
    const lowHumidity = num(daily.relative_humidity_2m_min?.[i]);

    cumulative += Math.max(0, precip);
    const rainy = precip > 0.1 ? 1 : 0;

    out.push({
      date,
      month: formatMonthLabel(date),
      precipitation: precip,
      tempHigh,
      tempAvg,
      tempMin,
      wind,
      highHumidity,
      lowHumidity,
      rainfall: precip,
      cumulativeRainfall: cumulative,
      rainyDays: rainy,
      maxDailyRainfall: precip,
      avgRainfall: precip,
    });
  }

  return out;
}

type CacheEntry = { at: number; series: AgroWeatherDay[] };
const seriesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Fetch weather for Agroclimatic Weather + Rainfall charts.
 * Primary: Open-Meteo archive/forecast. Overlay: CropEye forecast when available.
 */
export async function fetchAgroWeatherSeries(
  lat?: number | null,
  lon?: number | null,
  period: AgroTimePeriod = "weekly",
): Promise<AgroWeatherDay[]> {
  const safeLat =
    typeof lat === "number" && Number.isFinite(lat) ? lat : DEFAULT_LAT;
  const safeLon =
    typeof lon === "number" && Number.isFinite(lon) ? lon : DEFAULT_LON;

  const cacheKey = `${safeLat.toFixed(3)},${safeLon.toFixed(3)},${period}`;
  const cached = seriesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.series;
  }

  const startDate = ymdDaysAgo(PERIOD_FETCH_DAYS[period]);

  const [daily, cropEye] = await Promise.all([
    fetchOpenMeteoRange(safeLat, safeLon, startDate),
    fetchCropEyeForecast(safeLat, safeLon),
  ]);

  if (!daily?.time?.length) {
    throw new Error("No weather daily series returned");
  }

  const series = dailyToSeries(daily, cropEye);
  seriesCache.set(cacheKey, { at: Date.now(), series });
  return series;
}

export function resolveAgroWeatherCoords(
  plots: Array<{ position?: [number, number] | null }> | null | undefined,
): { lat: number; lon: number } {
  const list = plots?.length ? plots : EMPTY_PLOTS;
  const valid = list.filter(
    (p) =>
      Array.isArray(p.position) &&
      Number.isFinite(p.position[0]) &&
      Number.isFinite(p.position[1]),
  );
  if (!valid.length) return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
  const lat =
    valid.reduce((s, p) => s + (p.position![0] as number), 0) / valid.length;
  const lon =
    valid.reduce((s, p) => s + (p.position![1] as number), 0) / valid.length;
  return { lat, lon };
}

/** Stable empty plots reference — avoids weather effect re-firing every render. */
export const AGRO_EMPTY_PLOTS = EMPTY_PLOTS;
