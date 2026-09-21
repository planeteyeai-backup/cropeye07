/**
 * Comprehensive Agriculture Analysis API
 * Host: https://events-cropeye.up.railway.app/docs
 *
 * Used by Owner Farm Dash, Farm Crop Status, factory dashboard rollup,
 * analyzeSinglePlot / FO agroStats / indices / stress / sugarcane-harvest.
 *
 * Prefer Events Railway — the old Cloudflare tunnel
 * (amendments-wrist-interview-existed.trycloudflare.com) often returns 502
 * origin_error when the tunnel host is down.
 */
import axios from "axios";

export const AGRICULTURE_ANALYSIS_API_DEFAULT =
  "https://events-cropeye.up.railway.app";

const DEV_PROXY = "/api/agriculture-analysis";

function isUnreliableTunnelHost(url: string): boolean {
  return /trycloudflare\.com|ngrok|loca\.lt|cloudflared/i.test(url);
}

/** Absolute upstream host (no trailing slash). */
export function agricultureAnalysisUpstream(): string {
  const preferred = String(
    import.meta.env.VITE_AGRICULTURE_ANALYSIS_API_URL ?? "",
  )
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(preferred) && !isUnreliableTunnelHost(preferred)) {
    return preferred;
  }

  // VITE_DEV_EVENTS_API_URL is often a dead Cloudflare tunnel in Render env —
  // never use tunnel hosts for plot stats (analyzeSinglePlot / indices).
  const eventsAlias = String(import.meta.env.VITE_DEV_EVENTS_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (
    /^https?:\/\//i.test(eventsAlias) &&
    !isUnreliableTunnelHost(eventsAlias)
  ) {
    return eventsAlias;
  }

  return AGRICULTURE_ANALYSIS_API_DEFAULT;
}

/**
 * Base URL for browser fetches.
 * Dev prefers Vite proxy to avoid Cloudflare tunnel CORS issues.
 */
export function agricultureAnalysisBaseUrl(): string {
  if (import.meta.env.DEV) return DEV_PROXY;
  return agricultureAnalysisUpstream();
}

/** Join base + path without double slashes. */
export function agricultureAnalysisUrl(path: string): string {
  const base = agricultureAnalysisBaseUrl().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * HTTP client with NO baseURL — callers pass agricultureAnalysisUrl(...) or
 * absolute hosts. Prevents Railway eventsApi from hijacking relative proxy paths.
 */
export const agricultureAnalysisHttp = axios.create({
  headers: {
    Accept: "application/json",
  },
});
