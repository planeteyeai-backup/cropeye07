/** Prefix for all app cache keys - enables clearing all caches on logout */
const CACHE_PREFIX = "cropeye_cache_";

function prefixedKey(key) {
  return key.startsWith(CACHE_PREFIX) ? key : CACHE_PREFIX + key;
}

export function setCache(key, data) {
  const payload = {
    data,
    timestamp: Date.now(),
  };
  localStorage.setItem(prefixedKey(key), JSON.stringify(payload));
}

export function getCache(key, maxAgeMs = 10 * 60 * 1000) {
  // default 10 min
  const raw = localStorage.getItem(prefixedKey(key));
  if (!raw) return null;
  try {
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > maxAgeMs) {
      localStorage.removeItem(prefixedKey(key));
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(prefixedKey(key));
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
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    if (keysToRemove.length > 0) {
      console.log("🗑️ Cleared app cache:", keysToRemove.length, "entries");
    }
  } catch (e) {
    console.warn("Failed to clear app cache:", e);
  }
}
