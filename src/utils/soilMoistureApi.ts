/**
 * SEF soil-moisture API for Irrigation cards.
 * Current response uses `time_series` + `final_soil_moisture_capped`.
 * Older responses used `soil_moisture_stack` — both are supported.
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";

export type SoilMoistureDay = {
  day: string;
  soil_moisture: number;
  rainfall_mm_yesterday?: number;
  rainfall_provisional?: boolean;
  et_mean_mm_yesterday?: number;
  /** Surplus (+) / deficit (−) liters when API provides it (water-balance style). */
  water_remain_liters?: number;
};

export type SoilMoistureParsed = {
  plotName: string;
  currentMoisture: number;
  stack: SoilMoistureDay[];
  raw: any;
};

function sefBaseUrl(): string {
  return (
    String(import.meta.env.VITE_DEV_FIELD_API_URL ?? "")
      .trim()
      .replace(/\/$/, "") || "https://sef-cropeye.up.railway.app"
  );
}

function toFinite(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer slash ids — SEF 404s on many underscore forms (`8_1A` vs `8/1A`). */
function orderSoilMoistureCandidates(candidates: string[]): string[] {
  return [...candidates].sort((a, b) => {
    const aSlash = a.includes("/") ? 0 : 1;
    const bSlash = b.includes("/") ? 0 : 1;
    if (aSlash !== bSlash) return aSlash - bSlash;
    return a.length - b.length;
  });
}

function normalizeStackItem(item: any): SoilMoistureDay | null {
  if (!item || typeof item !== "object") return null;
  const day = String(item.day ?? item.date ?? "").slice(0, 10);
  const moisture =
    toFinite(item.soil_moisture) ??
    toFinite(item.soil_moisture_capped) ??
    toFinite(item.soil_moisture_uncapped) ??
    toFinite(item.smanchor) ??
    toFinite(item.value) ??
    toFinite(item.moisture);
  if (!day || moisture == null) return null;
  const waterRemain =
    toFinite(item.water_remain_liters) ??
    toFinite(item.waterRemainLiters) ??
    toFinite(item.water_remain_kl) ??
    toFinite(item.remain_liters);
  return {
    day,
    soil_moisture: moisture,
    rainfall_mm_yesterday:
      toFinite(item.rainfall_mm_yesterday) ??
      toFinite(item.rainfall_mm) ??
      undefined,
    rainfall_provisional: Boolean(item.rainfall_provisional),
    et_mean_mm_yesterday:
      toFinite(item.et_mean_mm_yesterday) ??
      toFinite(item.eto) ??
      toFinite(item.et_adj) ??
      undefined,
    water_remain_liters: waterRemain ?? undefined,
  };
}

/** Normalize SEF/old soil-moisture JSON into a daily stack + current value. */
export function parseSoilMoistureResponse(data: any): SoilMoistureParsed | null {
  if (!data || typeof data !== "object") return null;

  const stackRaw =
    (Array.isArray(data.time_series) && data.time_series) ||
    (Array.isArray(data.soil_moisture_stack) && data.soil_moisture_stack) ||
    (Array.isArray(data.series) && data.series) ||
    (Array.isArray(data.data) && data.data) ||
    (Array.isArray(data) ? data : null);

  const stack = (stackRaw || [])
    .map(normalizeStackItem)
    .filter((row: SoilMoistureDay | null): row is SoilMoistureDay => row != null)
    .sort((a: SoilMoistureDay, b: SoilMoistureDay) => a.day.localeCompare(b.day));

  const current =
    toFinite(data.final_soil_moisture_capped) ??
    toFinite(data.final_soil_moisture_uncapped) ??
    toFinite(data.smanchor_used) ??
    (stack.length ? stack[stack.length - 1].soil_moisture : null);

  if (current == null && !stack.length) return null;

  const filledStack =
    stack.length > 0
      ? stack
      : [
          {
            day: new Date().toISOString().slice(0, 10),
            soil_moisture: current as number,
          },
        ];

  return {
    plotName: String(data.plot_name ?? ""),
    currentMoisture: current ?? filledStack[filledStack.length - 1].soil_moisture,
    stack: filledStack,
    raw: data,
  };
}

async function postSoilMoistureOnce(plotName: string): Promise<any> {
  const base = sefBaseUrl();
  const attempts: Array<{ url: string; body?: string }> = [
    {
      url: `${base}/soil-moisture/${encodeURIComponent(plotName)}`,
      body: JSON.stringify({ plot_name: plotName }),
    },
    {
      url: `${base}/soil-moisture`,
      body: JSON.stringify({ plot_name: plotName }),
    },
    {
      url: `${base}/soil-moisture/${encodeURIComponent(plotName)}`,
    },
  ];

  let lastErr: Error | null = null;
  for (const attempt of attempts) {
    try {
      const resp = await fetch(attempt.url, {
        method: "POST",
        mode: "cors",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: attempt.body,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        lastErr = new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
        continue;
      }
      return await resp.json();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error("Soil moisture POST failed");
}

/** POST SEF `/soil-moisture` and return normalized stack + current %. */
export async function fetchSoilMoistureForPlot(
  plotId: string,
  plots?: PlotRef[] | null,
): Promise<SoilMoistureParsed> {
  if (!plotId?.trim()) throw new Error("Missing plot name");

  const candidates = orderSoilMoistureCandidates(
    getPlotNameCandidates(plotId, plots),
  );
  let lastErr: Error | null = null;

  for (const candidate of candidates) {
    try {
      const raw = await postSoilMoistureOnce(candidate);
      const parsed = parseSoilMoistureResponse(raw);
      if (!parsed) {
        lastErr = new Error("Soil moisture response had no usable values");
        continue;
      }
      return { ...parsed, plotName: parsed.plotName || candidate };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr || new Error("Soil moisture API failed");
}
