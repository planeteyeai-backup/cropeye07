/** Re-export shared localStorage cache (single implementation in utils/cache.js). */
export {
  getCache,
  setCache,
  removeCache,
  removeCachesMatchingPlot,
  clearAllAppCache,
  pruneAppCache,
} from "../../utils/cache";
