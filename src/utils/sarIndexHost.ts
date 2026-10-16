/**
 * SAR Index / map-tiles host (Growth, Water Uptake, Soil Moisture, Pest,
 * water-stress). Always Admin Railway — never ngrok / Cloudflare tunnels.
 *
 * Env: VITE_SAR_INDEX_API_URL — optional Railway override only.
 */
export const SAR_INDEX_HOST_DEFAULT =
  "https://admin-cropeye.up.railway.app";

/** Field Score `/analyze` lives on SEF (not the tile host). */
export const FIELD_SCORE_HOST_DEFAULT = "https://sef-cropeye.up.railway.app";

function isTunnelHost(url: string): boolean {
  return /ngrok|trycloudflare\.com|loca\.lt|cloudflared/i.test(url);
}

function envSarUrl(): string {
  return String(import.meta.env.VITE_SAR_INDEX_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
}

/** Absolute upstream (no trailing slash). Tunnel / cropeye.ai env values ignored. */
export function sarIndexUpstream(): string {
  const fromEnv = envSarUrl();
  if (
    /^https?:\/\//i.test(fromEnv) &&
    !isTunnelHost(fromEnv) &&
    !/cropeye\.ai|vercel\.app/i.test(fromEnv)
  ) {
    return fromEnv;
  }
  return SAR_INDEX_HOST_DEFAULT;
}

/**
 * Browser base for SAR tile / water-stress APIs.
 * Always the hosted Admin Railway URL (dev + prod) — no localhost/ngrok.
 */
export function getSarIndexBaseUrl(): string {
  return sarIndexUpstream();
}

/**
 * Field Score `/analyze` — ALWAYS SEF Railway.
 * Do not read VITE_SEF_* env: production had VITE_SEF_API_URL=https://cropeye.ai/api/sef
 * which Vercel rewrites to SPA HTML (200) and the Field Score card stays empty.
 */
export function getFieldScoreBaseUrl(): string {
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
