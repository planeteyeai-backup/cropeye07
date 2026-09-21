/**
 * SAR Index / map-tiles host (Growth, Water Uptake, Soil Moisture, Pest,
 * stored-tiles, water-stress).
 *
 * Env: VITE_SAR_INDEX_API_URL — Mapping/SAR Index API.
 * Dev uses Vite `/api/sar-index` → upstream (CORS).
 */
export const SAR_INDEX_HOST_DEFAULT =
  "https://admin-cropeye.up.railway.app";

/** Field Score `/analyze` lives on SEF (not the floss tile host). */
export const FIELD_SCORE_HOST_DEFAULT = "https://sef-cropeye.up.railway.app";

const DEV_SAR_PROXY = "/api/sar-index";
const DEV_SEF_PROXY = "/api/sef";

function envSarUrl(): string {
  return String(import.meta.env.VITE_SAR_INDEX_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
}

/** Absolute upstream (no trailing slash). Env overrides default. */
export function sarIndexUpstream(): string {
  const fromEnv = envSarUrl();
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return SAR_INDEX_HOST_DEFAULT;
}

/**
 * Browser base for SAR tile / water-stress APIs.
 * Dev always uses Vite `/api/sar-index` → upstream.
 */
export function getSarIndexBaseUrl(): string {
  if (import.meta.env.DEV) {
    const fromEnv = envSarUrl();
    if (fromEnv && !/^https?:\/\//i.test(fromEnv)) return fromEnv;
    return DEV_SAR_PROXY;
  }
  return sarIndexUpstream();
}

/** Field Score `/analyze` — SEF Railway. */
export function getFieldScoreBaseUrl(): string {
  if (import.meta.env.DEV) return DEV_SEF_PROXY;
  const fromEnv = String(import.meta.env.VITE_SEF_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return FIELD_SCORE_HOST_DEFAULT;
}

/**
 * Always allow SAR mapping calls when a base URL exists.
 * Real tile requests fail individually if the host is down.
 */
export async function isSarMappingHostAvailable(): Promise<boolean> {
  return Boolean(getSarIndexBaseUrl());
}

export function resetSarMappingHostProbe(): void {
  /* availability is env-based */
}
