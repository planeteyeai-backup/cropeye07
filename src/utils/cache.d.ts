export function getCache(key: string, maxAgeMs?: number): any;
export function setCache(key: string, value: any): void;
export function removeCache(key: string): void;
export function removeCachesMatchingPlot(plotKey: string): void;
export function clearAllAppCache(): void;