import { getCache, setCache, removeCache } from "./cache";

type Jsonish = any;

const inFlight = new Map<string, Promise<Jsonish>>();

export type GetOrFetchJsonOptions = {
  /** Unique cache/dedupe key (include plot + date). */
  key: string;
  url: string;
  fetchInit?: RequestInit;
  /** LocalStorage TTL. If omitted, no localStorage read/write is performed. */
  ttlMs?: number;
  /** Skip localStorage + in-flight reuse (use after plot boundary edit). */
  forceRefresh?: boolean;
};

/**
 * Shared request dedupe + cache.
 * - If cached (localStorage) and fresh → returns it
 * - If same request already in-flight → returns the same Promise
 * - Else fetches once, caches, returns JSON
 */
export async function getOrFetchJson({
  key,
  url,
  fetchInit,
  ttlMs,
  forceRefresh = false,
}: GetOrFetchJsonOptions): Promise<Jsonish> {
  if (forceRefresh) {
    removeCache(key);
    inFlight.delete(key);
  } else if (ttlMs != null) {
    const cached = getCache(key, ttlMs);
    if (cached != null) return cached;
  }

  const existing = !forceRefresh ? inFlight.get(key) : undefined;
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(url, fetchInit);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${errorText ? ` - ${errorText.slice(0, 200)}` : ""}`,
        );
      }
      const data = (await res.json()) as Jsonish;
      if (ttlMs != null) setCache(key, data);
      return data;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

/** Drop an in-flight layer request so the next call hits the network. */
export function cancelInFlightRequest(key: string): void {
  inFlight.delete(key);
}

