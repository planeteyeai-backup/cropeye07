import {
  getFarmsByFarmerId,
  getSinglePlotAgroStats,
} from '../../api';
import { fetchFieldScoreForPlot } from '../../utils/fieldScore';
import { plotKeyFromRecord, type PlotRef } from '../../utils/plotName';

export interface FarmerPlotMetrics {
  daysToHarvest: number | null;
  cropStatus: string | null;
  fieldScore: number | null;
  recoveryRate: number | null;
  plotCount: number;
  unavailable: boolean;
  loading?: boolean;
}

type RecordValue = Record<string, unknown>;

const EMPTY_METRICS: FarmerPlotMetrics = {
  daysToHarvest: null,
  cropStatus: null,
  fieldScore: null,
  recoveryRate: null,
  plotCount: 0,
  unavailable: false,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const metricsCache = new Map<
  string,
  { value: FarmerPlotMetrics; cachedAt: number }
>();
const metricsInFlight = new Map<string, Promise<FarmerPlotMetrics>>();

function asRecord(value: unknown): RecordValue | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const row = asRecord(value);
  if (!row) return [];
  if (Array.isArray(row.results)) return row.results;
  if (Array.isArray(row.farms)) return row.farms;
  if (Array.isArray(row.data)) return row.data;
  return [];
}

function hasPlotIdentity(row: RecordValue): boolean {
  return [
    row.fastapi_plot_id,
    row.plot_name,
    row.gat_number,
    row.plot_number,
    row.plot_id,
  ].some((value) => value != null && String(value).trim() !== '');
}

function plotRefsFromFarmResponse(response: unknown): PlotRef[] {
  const responseRow = asRecord(response);
  const farmRows = getList(responseRow?.data ?? response);
  const refs = new Map<string, PlotRef>();

  const addPlot = (value: unknown, farm?: RecordValue) => {
    const row = asRecord(value);
    if (!row) return;
    const merged: PlotRef = {
      fastapi_plot_id: String(row.fastapi_plot_id ?? farm?.fastapi_plot_id ?? ''),
      gat_number: String(row.gat_number ?? farm?.gat_number ?? ''),
      plot_number: String(row.plot_number ?? farm?.plot_number ?? ''),
      plot_name: String(row.plot_name ?? farm?.plot_name ?? ''),
      id: (row.id ?? row.plot_id) as string | number | undefined,
    };
    const key =
      plotKeyFromRecord(merged) ||
      String(row.plot_id ?? farm?.plot_id ?? '').trim();
    if (key) refs.set(key, merged);
  };

  for (const item of farmRows) {
    const farm = asRecord(item);
    if (!farm) continue;
    const nestedLists = [farm.plots, farm.farm_plots];
    let foundNestedPlots = false;
    for (const nested of nestedLists) {
      if (!Array.isArray(nested)) continue;
      foundNestedPlots = true;
      for (const plot of nested) addPlot(plot, farm);
    }

    if (farm.plot && typeof farm.plot === 'object') {
      foundNestedPlots = true;
      addPlot(farm.plot, farm);
    }

    const nestedFarmer = asRecord(farm.farmer);
    if (Array.isArray(nestedFarmer?.plots)) {
      foundNestedPlots = true;
      for (const plot of nestedFarmer.plots) addPlot(plot, farm);
    }

    if (!foundNestedPlots && hasPlotIdentity(farm)) addPlot(farm);
  }

  return [...refs.values()];
}

function analyticsRows(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is RecordValue => row != null);
  const row = asRecord(value);
  if (!row) return [];
  const feature = Array.isArray(row.features) ? asRecord(row.features[0]) : null;
  const properties = asRecord(feature?.properties);
  return [row, asRecord(row.brix_sugar), asRecord(row.harvest), properties]
    .filter((item): item is RecordValue => item != null);
}

function readDaysToHarvest(value: unknown): number | null {
  for (const row of analyticsRows(value)) {
    const days =
      asFiniteNumber(row.days_to_harvest) ??
      asFiniteNumber(asRecord(row.brix_sugar)?.days_to_harvest) ??
      asFiniteNumber(asRecord(row.harvest)?.days_to_harvest);
    if (days != null) return days;
  }
  return null;
}

function readCropStatus(value: unknown): string | null {
  for (const row of analyticsRows(value)) {
    const status =
      row.Sugarcane_Status ??
      row.sugarcane_status ??
      row.crop_status ??
      row.harvest_status;
    if (typeof status === 'string' && status.trim()) return status.trim();
  }
  return null;
}

function readRecoveryRate(value: unknown): number | null {
  for (const row of analyticsRows(value)) {
    const brixSugar = asRecord(row.brix_sugar) ?? row;
    const recovery = asRecord(brixSugar.recovery);
    const rate =
      asFiniteNumber(recovery?.mean) ??
      asFiniteNumber(recovery?.avg) ??
      asFiniteNumber(recovery?.average) ??
      asFiniteNumber(brixSugar.recovery_mean) ??
      asFiniteNumber(row.recovery_mean) ??
      asFiniteNumber(row['Recovery (Degree)']) ??
      asFiniteNumber(brixSugar.recovery);
    if (rate != null) return rate;
  }
  return null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function loadFarmerPlotMetrics(
  farmerId: string,
): Promise<FarmerPlotMetrics> {
  const key = farmerId.trim();
  if (!key) return EMPTY_METRICS;

  const cached = metricsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const pending = metricsInFlight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<FarmerPlotMetrics> => {
    let plotRefs: PlotRef[];
    try {
      const response = await getFarmsByFarmerId(key);
      plotRefs = plotRefsFromFarmResponse(response);
    } catch (error) {
      console.warn('[ProgressGridChart] Could not load farmer plots', {
        farmerId: key,
        error,
      });
      return { ...EMPTY_METRICS, unavailable: true };
    }

    if (plotRefs.length === 0) {
      const value = { ...EMPTY_METRICS, unavailable: true };
      metricsCache.set(key, { value, cachedAt: Date.now() });
      return value;
    }

    const days: number[] = [];
    const scores: number[] = [];
    const recoveryRates: number[] = [];
    const statuses = new Map<string, { label: string; count: number }>();
    let unavailable = false;

    for (const plot of plotRefs) {
      const plotKey = plotKeyFromRecord(plot);
      if (!plotKey) continue;

      const [agroResult, scoreResult] = await Promise.allSettled([
        getSinglePlotAgroStats(plotKey),
        fetchFieldScoreForPlot(plotKey, plotRefs),
      ]);

      let agroData: unknown = null;
      if (agroResult.status === 'fulfilled') {
        agroData = agroResult.value;
      } else {
        unavailable = true;
        console.warn('[ProgressGridChart] Could not load plot agro stats', {
          farmerId: key,
          plotId: plotKey,
          error: agroResult.reason,
        });
      }

      if (scoreResult.status === 'fulfilled') {
        if (scoreResult.value != null) scores.push(scoreResult.value);
      } else {
        unavailable = true;
        console.warn('[ProgressGridChart] Could not load plot field score', {
          farmerId: key,
          plotId: plotKey,
          error: scoreResult.reason,
        });
      }

      const daysToHarvest = readDaysToHarvest(agroData);
      if (daysToHarvest != null) days.push(daysToHarvest);

      const recoveryRate = readRecoveryRate(agroData);
      if (recoveryRate != null) recoveryRates.push(recoveryRate);

      const status = readCropStatus(agroData);
      if (status) {
        const statusKey = status.toLocaleLowerCase();
        const current = statuses.get(statusKey);
        statuses.set(statusKey, {
          label: current?.label ?? status,
          count: (current?.count ?? 0) + 1,
        });
      }
    }

    const cropStatus = [...statuses.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map(({ label, count }) => (count > 1 ? `${label} (${count})` : label))
      .join(', ');
    const value: FarmerPlotMetrics = {
      daysToHarvest: average(days),
      cropStatus: cropStatus || null,
      fieldScore: average(scores),
      recoveryRate: average(recoveryRates),
      plotCount: plotRefs.length,
      unavailable,
    };
    metricsCache.set(key, { value, cachedAt: Date.now() });
    return value;
  })().finally(() => {
    metricsInFlight.delete(key);
  });

  metricsInFlight.set(key, request);
  return request;
}

export { loadFarmerPlotMetrics };
