import budSchedule from '../bud.json';

interface BudStage {
  stage: string;
  days: string;
}

interface BudMethod {
  method: string;
  stages: BudStage[];
}

const FERTILIZER_SCHEDULE =
  (budSchedule as { fertilizer_schedule?: BudMethod[] }).fertilizer_schedule ??
  [];

const DEFAULT_BUD_METHOD = '2-bud';

/** "0–30" / "211-360" → [0, 30]. Handles en/em dashes from bud.json. */
function parseDayRange(days: string): [number, number] {
  const cleaned = `${days}`.replace(/[–—]/g, '-');
  const parts = cleaned.split('-').map((part) => Number(part.trim()));
  const lo = Number.isFinite(parts[0]) ? parts[0] : 0;
  const hi = Number.isFinite(parts[1]) ? parts[1] : lo;
  return [lo, hi];
}

export function daysSincePlantation(
  plantationDate?: string | null,
): number | null {
  if (!plantationDate) return null;
  const start = new Date(plantationDate);
  if (Number.isNaN(start.getTime())) return null;
  const diffMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/** Normalize "3 Bud Method" / "3-bud" / "3bud" for bud.json lookup. */
function normalizeBudMethodKey(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  const stip = /stip/.test(raw);
  const digit = raw.match(/([123])\s*-?\s*bud/)?.[1];
  if (digit) return stip ? `${digit}-bud stip` : `${digit}-bud`;
  return raw.replace(/\s+/g, '-');
}

/** Match the requested bud method from bud.json, else fall back to 2-bud. */
export function resolveBudMethodStages(
  budMethod?: string | null,
): BudMethod | null {
  if (FERTILIZER_SCHEDULE.length === 0) return null;
  const wanted = normalizeBudMethodKey(`${budMethod ?? ''}`);
  return (
    FERTILIZER_SCHEDULE.find(
      (m) => normalizeBudMethodKey(m.method) === wanted,
    ) ??
    FERTILIZER_SCHEDULE.find(
      (m) => m.method.toLowerCase() === DEFAULT_BUD_METHOD,
    ) ??
    FERTILIZER_SCHEDULE[0]
  );
}

/**
 * Current growth stage from days since plantation, using the bud.json schedule.
 * Returns '-' when plantation date is missing/invalid.
 */
export function resolveGrowthStage(
  plantationDate?: string | null,
  budMethod?: string | null,
): string {
  const days = daysSincePlantation(plantationDate);
  if (days == null) return '-';

  const method = resolveBudMethodStages(budMethod);
  if (!method) return '-';

  for (const stage of method.stages) {
    const [lo, hi] = parseDayRange(stage.days);
    if (days >= lo && days <= hi) return stage.stage;
  }

  const last = method.stages[method.stages.length - 1];
  if (last) {
    const [, hi] = parseDayRange(last.days);
    if (days > hi) return 'Harvest ready';
  }
  return '-';
}
