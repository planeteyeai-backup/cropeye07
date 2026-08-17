/** Prefix for all app cache keys - enables clearing all caches on logout */
const CACHE_PREFIX = "cropeye_cache_";

/** Drop unread/expired entries after this age (orphan keys never hit getCache). */
const DEFAULT_PRUNE_MAX_AGE_MS = 30 * 60 * 1000;

/** Cap how many cropeye_cache_* keys we keep (oldest by timestamp dropped). */
const DEFAULT_MAX_CACHE_ENTRIES = 60;

let setCacheCount = 0;

function prefixedKey(key) {
  return key.startsWith(CACHE_PREFIX) ? key : CACHE_PREFIX + key;
}

function readCacheEntry(fullKey) {
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      data: parsed.data,
      timestamp:
        typeof parsed.timestamp === "number" ? parsed.timestamp : 0,
    };
  } catch {
    return null;
  }
}

function listAppCacheKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
  } catch {
    // ignore
  }
  return keys;
}

/**
 * Remove expired cropeye_cache_* entries and cap total count.
 * Safe to call often; cheap when few keys.
 */
export function pruneAppCache(options = {}) {
  const maxAgeMs =
    typeof options.maxAgeMs === "number"
      ? options.maxAgeMs
      : DEFAULT_PRUNE_MAX_AGE_MS;
  const maxEntries =
    typeof options.maxEntries === "number"
      ? options.maxEntries
      : DEFAULT_MAX_CACHE_ENTRIES;

  const now = Date.now();
  const kept = [];
  let removed = 0;

  for (const key of listAppCacheKeys()) {
    const entry = readCacheEntry(key);
    if (!entry || now - entry.timestamp > maxAgeMs) {
      try {
        localStorage.removeItem(key);
        removed += 1;
      } catch {
        // ignore
      }
      continue;
    }
    kept.push({ key, timestamp: entry.timestamp });
  }

  if (kept.length > maxEntries) {
    kept.sort((a, b) => a.timestamp - b.timestamp);
    const overflow = kept.length - maxEntries;
    for (let i = 0; i < overflow; i += 1) {
      try {
        localStorage.removeItem(kept[i].key);
        removed += 1;
      } catch {
        // ignore
      }
    }
  }

  return removed;
}

export function setCache(key, data) {
  const payload = {
    data,
    timestamp: Date.now(),
  };
  const fullKey = prefixedKey(key);
  const serialized = JSON.stringify(payload);

  const write = () => localStorage.setItem(fullKey, serialized);

  try {
    write();
  } catch (e) {
    // QuotaExceeded — prune then retry once.
    pruneAppCache({ maxAgeMs: 5 * 60 * 1000, maxEntries: 40 });
    try {
      write();
    } catch (err) {
      console.warn("Failed to set cache key after prune:", key, err);
      return;
    }
  }

  setCacheCount += 1;
  // Periodic house-keeping so plot/layer keys do not pile up forever.
  if (setCacheCount % 8 === 0) {
    pruneAppCache();
  }
}

export function getCache(key, maxAgeMs = 10 * 60 * 1000) {
  // default 10 min
  const fullKey = prefixedKey(key);
  const raw = localStorage.getItem(fullKey);
  if (!raw) return null;
  try {
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > maxAgeMs) {
      localStorage.removeItem(fullKey);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(fullKey);
    return null;
  }
}

export function removeCache(key) {
  try {
    localStorage.removeItem(prefixedKey(key));
  } catch (e) {
    console.warn("Failed to remove cache key:", key, e);
  }
}

/** Drop layer/growth caches for one plot so map picks up edited boundary. */
export function removeCachesMatchingPlot(plotKey) {
  if (!plotKey?.trim()) return;

  const needle = String(plotKey).trim().toLowerCase().replace(/\//g, "_");
  const keysToRemove = [];

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CACHE_PREFIX)) continue;
      const normalized = key.toLowerCase().replace(/\//g, "_");
      if (
        normalized.includes(needle) ||
        normalized.includes(`_${needle}`) ||
        normalized.includes(`${needle}_`)
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn("Failed to clear plot caches:", plotKey, e);
  }
}

/** Clear all app caches (call on logout - manual or automatic) */
export function clearAllAppCache() {
  try {
    const keysToRemove = listAppCacheKeys();
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    if (keysToRemove.length > 0) {
      console.log("🗑️ Cleared app cache:", keysToRemove.length, "entries");
    }
  } catch (e) {
    console.warn("Failed to clear app cache:", e);
  }
}
