/**
 * SAR Index / map-tiles host (Growth, Water Uptake, Soil Moisture, Pest,
 * stored-tiles, water-stress).
 *
 * NOTE: VITE_SAR_INDEX_API_URL must point at the Mapping/SAR Index service.
 * If the ngrok tunnel is restarted against a different app (e.g. Weather Excel),
 * every /analyze_Growth, /water-stress, /stored-tiles call will 404.
 */
export const SAR_INDEX_HOST_DEFAULT =
  "https://floss-unblock-kick.ngrok-free.dev";

/** Field Score `/analyze` lives on SEF (not the floss tile host). */
export const FIELD_SCORE_HOST_DEFAULT = "https://sef-cropeye.up.railway.app";

const DEV_SAR_PROXY = "/api/sar-index";
const DEV_SEF_PROXY = "/api/sef";

/** Absolute upstream (no trailing slash). Env overrides default. */
export function sarIndexUpstream(): string {
  const fromEnv = String(import.meta.env.VITE_SAR_INDEX_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return SAR_INDEX_HOST_DEFAULT;
}

/**
 * Browser base for SAR tile / water-stress APIs.
 * Dev always uses Vite `/api/sar-index` → upstream (avoids ngrok CORS).
 */
export function getSarIndexBaseUrl(): string {
  if (import.meta.env.DEV) {
    const fromEnv = String(import.meta.env.VITE_SAR_INDEX_API_URL ?? "")
      .trim()
      .replace(/\/$/, "");
    if (fromEnv && !/^https?:\/\//i.test(fromEnv)) return fromEnv;
    return DEV_SAR_PROXY;
  }
  return sarIndexUpstream();
}

/** Field Score `/analyze` — SEF Railway (Map.tsx already uses this host). */
export function getFieldScoreBaseUrl(): string {
  if (import.meta.env.DEV) return DEV_SEF_PROXY;
  const fromEnv = String(import.meta.env.VITE_SEF_API_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return FIELD_SCORE_HOST_DEFAULT;
}

let mappingHostAvailable: boolean | null = null;
let mappingHostProbe: Promise<boolean> | null = null;

const MAPPING_PATH_HINT =
  /stored-tiles|water-stress|analyze_Growth|SoilMoisture|wateruptake|pest-detection/i;

/**
 * True when the configured SAR host actually exposes mapping routes.
 * Caches the result so a wrong ngrok target does not spam dozens of 404s.
 */
export async function isSarMappingHostAvailable(): Promise<boolean> {
  if (mappingHostAvailable != null) return mappingHostAvailable;
  if (mappingHostProbe) return mappingHostProbe;

  mappingHostProbe = (async () => {
    try {
      const base = getSarIndexBaseUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const resp = await fetch(`${base}/openapi.json`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "ngrok-skip-browser-warning": "true",
          },
          signal: controller.signal,
        });
        if (!resp.ok) {
          mappingHostAvailable = false;
          return false;
        }
        const json = (await resp.json()) as {
          info?: { title?: string };
          paths?: Record<string, unknown>;
        };
        const title = String(json?.info?.title ?? "");
        const paths = Object.keys(json?.paths ?? {});

        if (/weather\s*excel/i.test(title)) {
          mappingHostAvailable = false;
          if (import.meta.env.DEV) {
            console.warn(
              "[SAR] VITE_SAR_INDEX_API_URL points at Weather Excel, not Mapping/SAR Index. Update the ngrok tunnel or .env.development.",
            );
          }
          return false;
        }

        mappingHostAvailable = paths.some((p) => MAPPING_PATH_HINT.test(p));
        if (!mappingHostAvailable && import.meta.env.DEV) {
          console.warn(
            "[SAR] Mapping host has no stored-tiles / water-stress routes. Tile and water-stress calls are skipped until VITE_SAR_INDEX_API_URL is fixed.",
          );
        }
        return mappingHostAvailable;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      mappingHostAvailable = false;
      return false;
    } finally {
      mappingHostProbe = null;
    }
  })();

  return mappingHostProbe;
}

/** Clear cached probe (e.g. after env change / HMR). */
export function resetSarMappingHostProbe(): void {
  mappingHostAvailable = null;
  mappingHostProbe = null;
}
