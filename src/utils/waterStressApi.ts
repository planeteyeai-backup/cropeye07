import { getCache, setCache } from './cache';
import { normalizePlotKey } from './plotName';

export const SAR_API_BASE_URL = 'https://admin-cropeye.up.railway.app';
export const WATER_STRESS_TIMEOUT_MS = 180_000;

export interface WaterStressCci {
  value: number;
  value_percent?: number;
  condition?: string;
}

export interface WaterStressResponse {
  plot_name?: string;
  stress_events?: number;
  total_stress_days?: number;
  cci?: WaterStressCci;
  average_cci?: WaterStressCci;
}

export const CCI_STATUS_LABELS: Record<number, string> = {
  0: 'Immediate condition',
  2: 'Critical condition',
  4: 'High stress',
  6: 'Moderate stress',
  8: 'Healthy crop',
  10: 'Excellent crop',
};

const CCI_BUCKETS = [0, 2, 4, 6, 8, 10] as const;

export function snapCciToBucket(value: number): number {
  return CCI_BUCKETS.reduce((best, bucket) =>
    Math.abs(bucket - value) < Math.abs(best - value) ? bucket : best,
  );
}

export function cropConditionLabelFromCci(
  cciValue: number | null | undefined,
): string | null {
  if (cciValue == null || !Number.isFinite(cciValue)) return null;
  return CCI_STATUS_LABELS[snapCciToBucket(cciValue)] ?? null;
}

export interface CropConditionStyle {
  bucket: number;
  label: string;
  textColor: string;
  iconColor: string;
  borderColor: string;
  subtextColor: string;
}

/** Colors per CCI bucket — worse condition = warmer/red, better = green. */
const CCI_STYLES: Record<
  number,
  Omit<CropConditionStyle, 'bucket' | 'label'>
> = {
  0: {
    textColor: '#991b1b',
    iconColor: '#dc2626',
    borderColor: '#fecaca',
    subtextColor: '#b91c1c',
  },
  2: {
    textColor: '#dc2626',
    iconColor: '#ef4444',
    borderColor: '#fecaca',
    subtextColor: '#dc2626',
  },
  4: {
    textColor: '#dc2626',
    iconColor: '#ef4444',
    borderColor: '#fecaca',
    subtextColor: '#b91c1c',
  },
  6: {
    textColor: '#ca8a04',
    iconColor: '#eab308',
    borderColor: '#fef08a',
    subtextColor: '#a16207',
  },
  8: {
    textColor: '#16a34a',
    iconColor: '#22c55e',
    borderColor: '#bbf7d0',
    subtextColor: '#15803d',
  },
  10: {
    textColor: '#047857',
    iconColor: '#10b981',
    borderColor: '#a7f3d0',
    subtextColor: '#065f46',
  },
};

export function cropConditionStyleFromCci(
  cciValue: number | null | undefined,
): CropConditionStyle | null {
  if (cciValue == null || !Number.isFinite(cciValue)) return null;
  const bucket = snapCciToBucket(cciValue);
  const palette = CCI_STYLES[bucket];
  if (!palette) return null;
  return {
    bucket,
    label: CCI_STATUS_LABELS[bucket],
    ...palette,
  };
}

export function waterStressCacheKey(
  plotName: string,
  endDate: string,
  plantationDate?: string | null,
): string {
  const plant = plantationDate?.trim() ? `_${plantationDate.trim()}` : '';
  return `waterStress_v1_${normalizePlotKey(plotName)}_${endDate}${plant}`;
}

function formatPlantationDate(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export async function fetchWaterStressAnalysis(
  plotName: string,
  options: { plantationDate?: unknown; endDate?: string } = {},
): Promise<WaterStressResponse | null> {
  const trimmedPlot = plotName?.trim();
  if (!trimmedPlot) return null;

  const endDate =
    options.endDate ?? new Date().toISOString().slice(0, 10);
  const plantationDate = formatPlantationDate(options.plantationDate);
  const cacheKey = waterStressCacheKey(trimmedPlot, endDate, plantationDate);

  const cached = getCache(cacheKey) as WaterStressResponse | null;
  if (cached?.cci != null || cached?.stress_events != null) {
    return cached;
  }

  const params = new URLSearchParams();
  params.set('plot_name', trimmedPlot);
  params.set('end_date', endDate);
  if (plantationDate) params.set('plantation_date', plantationDate);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WATER_STRESS_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${SAR_API_BASE_URL}/water-stress?${params.toString()}`,
      {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as WaterStressResponse;
    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseWaterStressMetrics(data: WaterStressResponse | null): {
  cropConditionLabel: string | null;
  cropConditionValue: number | null;
  stressCount: number | null;
  stressTotalDays: number | null;
} {
  if (!data) {
    return {
      cropConditionLabel: null,
      cropConditionValue: null,
      stressCount: null,
      stressTotalDays: null,
    };
  }

  const cciValue = data.cci?.value;
  const hasCci = cciValue != null && Number.isFinite(Number(cciValue));

  return {
    cropConditionLabel: hasCci
      ? cropConditionLabelFromCci(Number(cciValue))
      : null,
    cropConditionValue: hasCci ? Number(cciValue) : null,
    stressCount:
      data.stress_events != null && Number.isFinite(Number(data.stress_events))
        ? Number(data.stress_events)
        : null,
    stressTotalDays:
      data.total_stress_days != null &&
      Number.isFinite(Number(data.total_stress_days))
        ? Number(data.total_stress_days)
        : null,
  };
}
