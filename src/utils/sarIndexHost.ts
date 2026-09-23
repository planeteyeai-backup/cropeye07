/**
 * SAR Index / map-tiles host (Growth, Water Uptake, Soil Moisture, Pest,
 * water-stress). Defaults to Admin Railway — never use ngrok tunnels.
 *
 * Env: VITE_SAR_INDEX_API_URL — Mapping/SAR Index API.
 * Dev uses Vite `/api/sar-index` → upstream (CORS).
 */
export const SAR_INDEX_HOST_DEFAULT =
  "https://admin-cropeye.up.railway.app";

/** Field Score `/analyze` lives on SEF (not the tile host). */
export const FIELD_SCORE_HOST_DEFAULT = "https://sef-cropeye.up.railway.app";

const DEV_SEF_PROXY = "/api/sef";

function isUnreliableTunnelHost(url: string): boolean {
  return /ngrok|trycloudflare\.com|loca\.lt|cloudflared/i.test(url);
}

function envSarUrl(): string {
  return String(import.meta.env.VITE_SAR_INDEX_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
}

/** Absolute upstream (no trailing slash). Env overrides default; tunnels ignored. */
export function sarIndexUpstream(): string {
  const fromEnv = envSarUrl();
  if (/^https?:\/\//i.test(fromEnv) && !isUnreliableTunnelHost(fromEnv) && !fromEnv.includes('cropeye.ai')) {
    return fromEnv;
  }
  return SAR_INDEX_HOST_DEFAULT;
}

/**
 * Browser base for SAR tile / water-stress APIs.
 * Dev always uses Vite `/api/sar-index` → upstream.
 */
export function getSarIndexBaseUrl(): string {
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
