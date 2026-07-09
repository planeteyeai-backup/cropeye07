import budData from "../components/bud.json";
import { collectFarmsFromRecord } from "./plantation";

export interface FertilizerStageRow {
  stage: string;
  days: string;
}

function normalizePlantingMethod(method: string): string {
  return method
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePlotKeyForMatch(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\//g, "_")
    .replace(/ /g, "_")
    .toLowerCase();
}

function plotKeysForRecord(record: any): string[] {
  if (!record) return [];

  const gat = record?.gat_number != null ? String(record.gat_number).trim() : "";
  const num = record?.plot_number != null ? String(record.plot_number).trim() : "";

  const keys = [
    record?.fastapi_plot_id,
    record?.events_plot_id,
    record?.plot_id,
    record?.plot_name,
    gat && num ? `${gat}_${num}` : null,
    gat && num ? `${gat}/${num}` : null,
  ]
    .filter((value) => value != null && `${value}`.trim() !== "")
    .map((value) => normalizePlotKeyForMatch(String(value)));

  return [...new Set(keys)];
}

function recordMatchesPlotId(record: any, plotId?: string | null): boolean {
  if (!record || !plotId?.trim()) return false;
  const target = normalizePlotKeyForMatch(plotId);
  return plotKeysForRecord(record).includes(target);
}

export function calculateDaysSincePlantation(plantationDate: string): number {
  let plantation = new Date(plantationDate);

  if (Number.isNaN(plantation.getTime())) {
    const parts = plantationDate.split("-");
    if (parts.length === 3 && parts[0].length === 4) {
      plantation = new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10),
      );
    } else if (parts.length === 3 && parts[2].length === 4) {
      plantation = new Date(
        parseInt(parts[2], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[0], 10),
      );
    } else {
      const parts2 = plantationDate.split("/");
      if (parts2.length === 3) {
        plantation = new Date(
          parseInt(parts2[2], 10),
          parseInt(parts2[1], 10) - 1,
          parseInt(parts2[0], 10),
        );
      } else {
        plantation = new Date(Date.parse(plantationDate));
      }
    }
  }

  if (Number.isNaN(plantation.getTime())) return 0;

  const today = new Date();
  const diffTime = today.getTime() - plantation.getTime();
  return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
}

export function getCurrentStageForDays(
  days: number,
  stages: FertilizerStageRow[],
): FertilizerStageRow | null {
  if (!stages.length) return null;

  for (const stage of stages) {
    const daysRange = stage.days.replace(/[–-]/g, "-");
    const [minDays, maxDays] = daysRange
      .split("-")
      .map((value) => parseInt(value.trim(), 10));

    if (
      Number.isFinite(minDays) &&
      Number.isFinite(maxDays) &&
      days >= minDays &&
      days <= maxDays
    ) {
      return stage;
    }
  }

  return stages[stages.length - 1] ?? null;
}

function findFertilizerSchedule(plantingMethod: string) {
  const normalizedMethod = normalizePlantingMethod(plantingMethod);
  return budData.fertilizer_schedule.find((schedule) => {
    const scheduleMethod = normalizePlantingMethod(schedule.method);
    return scheduleMethod === normalizedMethod;
  });
}

export function getCurrentCropStageName(
  plantationDate: string,
  plantingMethod: string,
): string | null {
  if (!plantationDate?.trim() || !plantingMethod?.trim()) return null;

  const schedule = findFertilizerSchedule(plantingMethod);
  if (!schedule?.stages?.length) return null;

  const days = calculateDaysSincePlantation(plantationDate);
  const stage = getCurrentStageForDays(days, schedule.stages);
  return stage?.stage ?? null;
}

function readPlantingMethodFromRecord(record: any): string | null {
  if (!record) return null;

  const cropType = record.crop_type;
  const candidates = [
    cropType?.planting_method,
    cropType?.planting_method_display,
    record.planting_method,
    record.planting_method_display,
    record.plantation_Method,
    record.plantation_method,
    record.variety_subtype,
  ];

  for (const value of candidates) {
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return null;
}

function readPlantationDateFromRecord(record: any): string | null {
  if (!record) return null;

  const cropType = record.crop_type;
  const candidates = [
    record.plantation_date,
    record.planting_date,
    cropType?.plantation_date,
  ];

  for (const value of candidates) {
    if (value != null && String(value).trim() !== "" && String(value) !== "N/A") {
      return String(value).trim();
    }
  }

  return null;
}

export function extractCropStageInputsFromFarm(
  farm: unknown,
): { plantationDate: string | null; plantingMethod: string | null } {
  const record = farm as any;
  return {
    plantationDate: readPlantationDateFromRecord(record),
    plantingMethod: readPlantingMethodFromRecord(record),
  };
}

function mergeStageInputs(
  primary: { plantationDate: string | null; plantingMethod: string | null },
  secondary: { plantationDate: string | null; plantingMethod: string | null },
): { plantationDate: string | null; plantingMethod: string | null } {
  return {
    plantationDate: primary.plantationDate ?? secondary.plantationDate,
    plantingMethod: primary.plantingMethod ?? secondary.plantingMethod,
  };
}

function extractFromRecord(
  record: unknown,
): { plantationDate: string | null; plantingMethod: string | null } {
  const farms = collectFarmsFromRecord(record);
  let merged = extractCropStageInputsFromFarm(record);

  for (const farm of farms) {
    merged = mergeStageInputs(merged, extractCropStageInputsFromFarm(farm));
    if (merged.plantationDate && merged.plantingMethod) return merged;
  }

  return merged;
}

function findPlotRecordInFarmer(farmer: any, plotId?: string | null): any | null {
  if (!farmer || !plotId?.trim()) return null;
  const plots = Array.isArray(farmer?.plots) ? farmer.plots : [];
  return (
    plots.find((plot: any) => recordMatchesPlotId(plot, plotId)) ??
    null
  );
}

function findFarmForPlotInFarmer(farmer: any, plotId?: string | null): any | null {
  if (!farmer || !plotId?.trim()) return null;

  const matchedPlot = findPlotRecordInFarmer(farmer, plotId);
  if (matchedPlot) {
    const plotFarms = collectFarmsFromRecord(matchedPlot);
    if (plotFarms.length) return plotFarms[0];
    const plotInputs = extractFromRecord(matchedPlot);
    if (plotInputs.plantationDate || plotInputs.plantingMethod) {
      return matchedPlot;
    }
  }

  const farms = collectFarmsFromRecord(farmer);
  const matchedFarm = farms.find((farm) => recordMatchesPlotId(farm, plotId));
  if (matchedFarm) return matchedFarm;

  return farms[0] ?? null;
}

export function extractCropStageInputs(
  plot: unknown,
  farmer?: unknown,
  plotId?: string | null,
): { plantationDate: string | null; plantingMethod: string | null } {
  let merged = { plantationDate: null as string | null, plantingMethod: null as string | null };

  const plotRecord = plot as any;
  const farmerRecord = farmer as any;

  if (plotRecord) {
    merged = mergeStageInputs(merged, extractFromRecord(plotRecord));
    if (merged.plantationDate && merged.plantingMethod) return merged;
  }

  if (farmerRecord && plotId) {
    const farmForPlot = findFarmForPlotInFarmer(farmerRecord, plotId);
    if (farmForPlot) {
      merged = mergeStageInputs(merged, extractCropStageInputsFromFarm(farmForPlot));
      if (merged.plantationDate && merged.plantingMethod) return merged;
    }

    const matchedPlot = findPlotRecordInFarmer(farmerRecord, plotId);
    if (matchedPlot) {
      merged = mergeStageInputs(merged, extractFromRecord(matchedPlot));
      if (merged.plantationDate && merged.plantingMethod) return merged;
    }
  }

  if (farmerRecord) {
    merged = mergeStageInputs(merged, extractFromRecord(farmerRecord));
  }

  return merged;
}

/** @deprecated Use extractCropStageInputs or resolveCropStageFromContext */
export function extractCropStageInputsFromPlot(plot: unknown): {
  plantationDate: string | null;
  plantingMethod: string | null;
} {
  return extractCropStageInputs(plot);
}

export function resolveCropStageFromContext(
  plot: unknown,
  farmer?: unknown,
  plotId?: string | null,
): string | null {
  const { plantationDate, plantingMethod } = extractCropStageInputs(
    plot,
    farmer,
    plotId,
  );
  if (!plantationDate || !plantingMethod) return null;
  return getCurrentCropStageName(plantationDate, plantingMethod);
}

export function resolveCropStageFromPlot(plot: unknown): string | null {
  return resolveCropStageFromContext(plot);
}

/** Merge /farms/ rows into field-officer plot list so stage inputs are available. */
export function enrichPlotsWithFarmDetails(plots: any[], farms: any[]): any[] {
  if (!Array.isArray(plots) || plots.length === 0) return plots ?? [];
  if (!Array.isArray(farms) || farms.length === 0) return plots;

  return plots.map((plot) => {
    const plotKey =
      plot?.fastapi_plot_id ??
      plot?.events_plot_id ??
      plot?.plot_id ??
      plot?.plot_name ??
      null;

    const matchedFarm =
      (plotKey
        ? farms.find((farm) => recordMatchesPlotId(farm, String(plotKey)))
        : null) ??
      farms.find((farm) => {
        const gat = farm?.gat_number != null ? String(farm.gat_number) : "";
        const num = farm?.plot_number != null ? String(farm.plot_number) : "";
        const plotGat = plot?.gat_number != null ? String(plot.gat_number) : "";
        const plotNum =
          plot?.plot_number != null ? String(plot.plot_number) : "";
        return gat && num && gat === plotGat && num === plotNum;
      }) ??
      null;

    if (!matchedFarm) return plot;

    return {
      ...matchedFarm,
      ...plot,
      plantation_date:
        plot?.plantation_date ??
        plot?.planting_date ??
        matchedFarm?.plantation_date ??
        matchedFarm?.planting_date,
      crop_type: plot?.crop_type ?? matchedFarm?.crop_type,
      farms:
        Array.isArray(plot?.farms) && plot.farms.length > 0
          ? plot.farms
          : [matchedFarm],
    };
  });
}
