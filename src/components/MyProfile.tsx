import React, { useState, useEffect, useRef } from "react";
import {
  User, Mail, Phone, MapPin, FileText, Edit3, Save, X,
  ChevronDown, Leaf, Droplets, Calendar, Ruler, AlertCircle, CheckCircle, Map,
} from "lucide-react";
import { getFarmerMyProfile, patchUserMyProfile, patchFarmMyProfile, refreshApiEndpoints, getCropTypes } from "../api";
import EditPlotBoundaryModal from "./EditPlotBoundaryModal";
import type { GeoJsonPolygon, GeoJsonPoint } from "../utils/plotGeometry";
import {
  resolveGeoJsonPoint,
} from "../utils/plotGeometry";
import { normalizePlotKey, plotKeyFromRecord } from "../utils/plotName";
import {
  mergeBoundaryIntoProfilePayload,
} from "../utils/plotBoundarySync";
import { getCache, setCache } from "../utils/cache";
import { useAppContext } from "../context/AppContext";
import { useI18nLite } from "../i18nLite";
import {
  notifyFarmFieldsUpdated,
  overlaySavedFarmsOnProfile,
  persistSavedFarmFields,
  readLastSavedFarmId,
  readSavedFarmFields,
} from "../utils/farmSaveSync";

/** Normalize boundary from API (handles nested shapes and JSON strings). */
function normalizeBoundary(raw: any): GeoJsonPolygon | null {
  if (!raw) return null;

  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (
    value?.type === "Polygon" &&
    Array.isArray(value.coordinates?.[0]) &&
    value.coordinates[0].length >= 3
  ) {
    return value as GeoJsonPolygon;
  }

  if (Array.isArray(value.coordinates?.[0]) && value.coordinates[0].length >= 3) {
    return {
      type: "Polygon",
      coordinates: value.coordinates,
    };
  }

  return null;
}

/** Read saved plot polygon from my-profile (API shape varies). */
function resolvePlotBoundary(plot: any): GeoJsonPolygon | null {
  if (!plot) return null;

  const candidates = [
    plot.boundary,
    plot.coordinates?.boundary,
    plot.location?.boundary,
  ];

  for (const raw of candidates) {
    const boundary = normalizeBoundary(raw);
    if (boundary) return boundary;
  }

  return null;
}

function resolveNestedPlot(data: any) {
  if (data?.plot?.id != null || data?.plot?.boundary) return data.plot;
  const plot = (data?.plots ?? [])[0];
  const farm = plot?.farms?.[0] ?? data?.farm ?? data;
  return plot ?? farm?.plot ?? data?.plot ?? null;
}

// ── Plantation type / method constants (same as Add Farm.tsx) ──────────────
const PLANTATION_TYPE_OPTIONS = ["Adsali", "Suru", "pre_seasonal", "Ratoon"];
const PLANTATION_METHOD_OPTIONS = ["3_bud", "2_bud", "1_bud", "1_bud_stip"];

function toApiPlantationType(display: string): string | undefined {
  const v = display.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!v) return undefined;
  if (v === "adsali") return "adsali";
  if (v === "suru") return "suru";
  if (v === "ratoon") return "ratoon";
  if (v === "pre_seasonal" || v === "preseasonal") return "pre-seasonal";
  return display.trim();
}

function toApiPlantingMethod(display: string): string | undefined {
  const v = display.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "3 bud" || v === "3_bud" || v === "3-bud") return "3_bud";
  if (v === "2 bud" || v === "2_bud" || v === "2-bud") return "2_bud";
  if (v.includes("stip")) return "1_bud_stip";
  if (v === "1 bud" || v === "1_bud" || v === "1-bud") return "1_bud";
  return v.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Map API spellings onto the dropdown option values used by this form. */
function toFormPlantationType(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "adsali") return "Adsali";
  if (v === "suru") return "Suru";
  if (v === "ratoon") return "Ratoon";
  if (v === "pre_seasonal" || v === "preseasonal") return "pre_seasonal";
  return (raw ?? "").trim();
}

function toFormPlantingMethod(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v.includes("stip")) return "1_bud_stip";
  if (v.startsWith("3")) return "3_bud";
  if (v.startsWith("2")) return "2_bud";
  if (v.startsWith("1")) return "1_bud";
  return (raw ?? "").trim();
}

function normalizeIrrigationType(value: string): string {
  const v = (value ?? "").trim().toLowerCase();
  if (v.includes("drip")) return "drip";
  if (v.includes("flood")) return "flood";
  return v.replace(/\s+/g, "");
}

type CropTypeRecord = {
  id: number;
  crop_type: string;
  plantation_type: string;
  planting_method?: string;
};

function readCropTypeId(farm: any): number | undefined {
  if (farm?.crop_type_id != null && Number.isFinite(Number(farm.crop_type_id))) {
    return Number(farm.crop_type_id);
  }
  const crop = cropTypeOf(farm);
  if (crop?.id != null && Number.isFinite(Number(crop.id))) {
    return Number(crop.id);
  }
  return undefined;
}

function readSoilTypeId(farm: any): number | null | undefined {
  if (farm?.soil_type_id === null) return null;
  if (farm?.soil_type_id != null && Number.isFinite(Number(farm.soil_type_id))) {
    return Number(farm.soil_type_id);
  }
  const soil = farm?.soil_type;
  if (soil?.id != null && Number.isFinite(Number(soil.id))) {
    return Number(soil.id);
  }
  return undefined;
}

function normalizeCropTypeToken(value: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
}

function resolveCropTypeId(
  varietyType: string,
  varietySubtype: string,
  cropTypes: CropTypeRecord[],
  existingId?: number,
): number | undefined {
  const plantationNorm = normalizeCropTypeToken(
    toApiPlantationType(varietyType) ?? varietyType,
  );
  const methodNorm = normalizeCropTypeToken(
    toApiPlantingMethod(varietySubtype) ?? varietySubtype,
  );

  if (!plantationNorm && !methodNorm) return existingId;
  if (!cropTypes.length) return existingId;

  const matches = cropTypes.filter((entry) => {
    const plantation = normalizeCropTypeToken(entry.plantation_type ?? "");
    const crop = (entry.crop_type ?? "").trim().toLowerCase();
    if (crop && crop !== "sugarcane") return false;
    if (plantationNorm && plantation !== plantationNorm) return false;
    if (methodNorm) {
      const method = normalizeCropTypeToken(entry.planting_method ?? "");
      if (method && method !== methodNorm) return false;
    }
    return plantationNorm || methodNorm;
  });

  if (matches.length === 1) return matches[0].id;
  if (methodNorm) {
    const strict = matches.find(
      (entry) => normalizeCropTypeToken(entry.planting_method ?? "") === methodNorm,
    );
    if (strict) return strict.id;
  }
  if (matches.length > 0) return matches[0].id;
  return existingId;
}

function findFarmInProfile(dataObj: any, targetId: string | number): any | null {
  const tid = String(targetId);
  if (dataObj?.id != null && String(dataObj.id) === tid) return dataObj;
  if (dataObj?.farm?.id != null && String(dataObj.farm.id) === tid) return dataObj.farm;

  const plots = Array.isArray(dataObj?.plots) ? dataObj.plots : [];
  for (const plot of plots) {
    for (const farm of farmsOnPlot(plot)) {
      if (String(farm?.id) === tid) return farm;
    }
  }
  if (Array.isArray(dataObj?.farms)) {
    for (const farm of dataObj.farms) {
      if (String(farm?.id) === tid) return farm;
    }
  }
  if (dataObj?.farm && String(dataObj.farm?.id) === tid) return dataObj.farm;
  return null;
}

function mergeServerFarmIntoProfile(data: any, serverFarm: any, farmId: string | number): any {
  if (!data || !serverFarm) return data;
  const tid = String(farmId);
  const replaceFarm = (farm: any) =>
    farm?.id != null && String(farm.id) === tid ? { ...farm, ...serverFarm } : farm;

  const next = { ...data };
  if (Array.isArray(next.plots)) {
    next.plots = next.plots.map((plot: any) => {
      const patched = { ...plot };
      if (Array.isArray(plot?.farms)) patched.farms = plot.farms.map(replaceFarm);
      if (plot?.farm) patched.farm = replaceFarm(plot.farm);
      return patched;
    });
  }
  if (Array.isArray(next.farms)) next.farms = next.farms.map(replaceFarm);
  if (next.farm) next.farm = replaceFarm(next.farm);
  return next;
}

function comparableValue(key: string, value: unknown): string {
  if (value == null) return "";
  if (key === "plantation_date") return String(value).slice(0, 10);
  if (key === "irrigation_type") return normalizeIrrigationType(String(value));
  if (key === "variety_type") {
    return (toApiPlantationType(String(value)) ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-");
  }
  if (key === "variety_subtype") {
    return (toApiPlantingMethod(String(value)) ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "_");
  }
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function readFarmField(serverFarm: any, key: string): unknown {
  const crop = cropTypeOf(serverFarm);
  const irrigation = irrigationOf(serverFarm);
  switch (key) {
    case "crop_type_id":
      return readCropTypeId(serverFarm);
    case "soil_type_id":
      return readSoilTypeId(serverFarm);
    case "crop_variety":
      return firstNonEmpty(serverFarm?.crop_variety, crop?.crop_variety);
    case "variety_type":
      return firstNonEmpty(
        crop?.plantation_type,
        serverFarm?.plantation_type,
        serverFarm?.variety_type,
      );
    case "variety_subtype":
      return firstNonEmpty(
        crop?.planting_method,
        serverFarm?.planting_method,
        serverFarm?.variety_subtype,
      );
    case "flow_rate_liter_per_hour":
      return firstNonEmpty(
        irrigation?.flow_rate_lph,
        irrigation?.flow_rate_liter_per_hour,
        serverFarm?.flow_rate_liter_per_hour,
      );
    case "emitters_per_plant":
      return firstNonEmpty(
        irrigation?.emitters_count,
        irrigation?.emitters_per_plant,
        serverFarm?.emitters_per_plant,
      );
    case "motor_horsepower":
      return firstNonEmpty(irrigation?.motor_horsepower, serverFarm?.motor_horsepower);
    case "pipe_width_inches":
      return firstNonEmpty(irrigation?.pipe_width_inches, serverFarm?.pipe_width_inches);
    case "distance_motor_to_plot_m":
      return firstNonEmpty(
        irrigation?.distance_motor_to_plot_m,
        serverFarm?.distance_motor_to_plot_m,
      );
    case "irrigation_type":
      return normalizeIrrigationType(
        firstNonEmpty(
          irrigation?.irrigation_type_code,
          irrigation?.irrigation_type_name,
          irrigation?.irrigation_type,
          serverFarm?.irrigation_type,
        ),
      );
    default:
      return serverFarm?.[key];
  }
}

function findMismatchedFarmFields(
  sent: Record<string, unknown>,
  serverFarm: any,
): string[] {
  const mismatches: string[] = [];
  for (const [key, sentValue] of Object.entries(sent)) {
    if (key === "farm_id") continue;
    const serverValue = readFarmField(serverFarm, key);
    if (comparableValue(key, sentValue) !== comparableValue(key, serverValue)) {
      mismatches.push(key);
    }
  }
  return mismatches;
}

function formatApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const rec = data as Record<string, unknown>;
  if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
  if (typeof rec.error === "string" && rec.error.trim()) {
    const extra = rec.farm_ids != null ? ` · farm_ids: ${Array.isArray(rec.farm_ids) ? rec.farm_ids.join(", ") : rec.farm_ids}` : "";
    return `${rec.error}${extra}`;
  }
  if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (key === "detail" || key === "message" || key === "error" || key === "farm_ids") continue;
    if (Array.isArray(value)) {
      const text = value.map((item) => String(item)).filter(Boolean).join(", ");
      if (text) parts.push(`${key}: ${text}`);
    } else if (typeof value === "string" && value.trim()) {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.length ? parts.join(" · ") : fallback;
}

type FarmChoice = {
  farmId: string;
  plotId: string;
  gatNumber: string;
  plotNumber: string;
  label: string;
  farm: any;
  plot: any;
};

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text || text === "null" || text === "undefined") continue;
    return text;
  }
  return "";
}

function cropTypeOf(farm: any): any {
  const raw = farm?.crop_type ?? farm?.crop_types;
  if (Array.isArray(raw) && raw.length) return raw[0] ?? {};
  if (raw && typeof raw === "object") return raw;
  return {};
}

function irrigationOf(farm: any): any {
  if (Array.isArray(farm?.irrigations) && farm.irrigations.length) {
    return farm.irrigations[0] ?? {};
  }
  if (farm?.irrigation && typeof farm.irrigation === "object") return farm.irrigation;
  return {};
}

function farmsOnPlot(plot: any): any[] {
  if (!plot) return [];
  if (Array.isArray(plot.farms) && plot.farms.length) return plot.farms;
  if (plot.farm && typeof plot.farm === "object") return [plot.farm];
  if (Array.isArray(plot.farm_set) && plot.farm_set.length) return plot.farm_set;
  return [];
}

function collectFarmChoices(data: any): FarmChoice[] {
  const choices: FarmChoice[] = [];
  const seen = new Set<string>();

  const add = (farm: any, plot: any) => {
    const farmId = farm?.id != null ? String(farm.id) : "";
    if (!farmId || seen.has(farmId)) return;
    seen.add(farmId);
    const plotRec = plot ?? farm?.plot ?? null;
    const gat = String(plotRec?.gat_number ?? farm?.gat_number ?? "").trim();
    const plotNum = String(plotRec?.plot_number ?? farm?.plot_number ?? "").trim();
    const plotId =
      plotRec?.id ??
      plotRec?.plot_id ??
      farm?.plot_id ??
      farm?.plot?.id ??
      "";
    const fastapi = String(plotRec?.fastapi_plot_id ?? farm?.farm_uid ?? "").trim();
    const gatPlot = [gat, plotNum].filter(Boolean).join("/");
    choices.push({
      farmId,
      plotId: plotId != null && plotId !== "" ? String(plotId) : "",
      gatNumber: gat,
      plotNumber: plotNum,
      label: `${gatPlot || fastapi || "Plot"} · farm ${farmId}`,
      farm,
      plot: plotRec,
    });
  };

  const plots = Array.isArray(data?.plots) ? data.plots : [];
  for (const plot of plots) {
    farmsOnPlot(plot).forEach((farm: any) => add(farm, plot));
  }
  if (Array.isArray(data?.farms)) {
    data.farms.forEach((farm: any) => add(farm, farm?.plot ?? data?.plot ?? null));
  }
  if (data?.farm?.id != null) {
    add(data.farm, data.farm?.plot ?? data?.plot ?? null);
  }
  if (
    data?.id != null &&
    !Array.isArray(data?.plots) &&
    (data?.plantation_date != null || data?.crop_type != null || Array.isArray(data?.irrigations))
  ) {
    add(data, data?.plot ?? null);
  }
  return choices;
}

function toFormDate(raw: unknown): string {
  const text = firstNonEmpty(raw);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmY = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmY) return `${dmY[3]}-${dmY[2]}-${dmY[1]}`;
  return text.slice(0, 10);
}

function farmToForm(farm: any): FarmFormData {
  const crop = cropTypeOf(farm);
  const irrigation = irrigationOf(farm);
  return {
    address: firstNonEmpty(farm?.address),
    area_size: firstNonEmpty(farm?.area_size, farm?.area_size_numeric),
    plantation_date: toFormDate(firstNonEmpty(farm?.plantation_date, crop?.plantation_date)),
    crop_variety: firstNonEmpty(farm?.crop_variety, crop?.crop_variety),
    variety_type: toFormPlantationType(
      firstNonEmpty(
        farm?.variety_type,
        farm?.plantation_type,
        crop?.plantation_type_display,
        crop?.plantation_type,
      ),
    ),
    variety_subtype: toFormPlantingMethod(
      firstNonEmpty(
        farm?.variety_subtype,
        farm?.planting_method,
        crop?.planting_method_display,
        crop?.planting_method,
      ),
    ),
    spacing_a: firstNonEmpty(farm?.spacing_a),
    spacing_b: firstNonEmpty(farm?.spacing_b),
    irrigation_type: normalizeIrrigationType(
      firstNonEmpty(
        farm?.irrigation_type,
        irrigation?.irrigation_type_code,
        irrigation?.irrigation_type_name,
        irrigation?.irrigation_type,
        farm?.irrigation_type_name,
      ),
    ),
    flow_rate_liter_per_hour: firstNonEmpty(
      farm?.flow_rate_liter_per_hour,
      irrigation?.flow_rate_lph,
      irrigation?.flow_rate_liter_per_hour,
    ),
    emitters_per_plant: firstNonEmpty(
      farm?.emitters_per_plant,
      irrigation?.emitters_count,
      irrigation?.emitters_per_plant,
    ),
    motor_horsepower: firstNonEmpty(farm?.motor_horsepower, irrigation?.motor_horsepower),
    pipe_width_inches: firstNonEmpty(farm?.pipe_width_inches, irrigation?.pipe_width_inches),
    distance_motor_to_plot_m: firstNonEmpty(
      farm?.distance_motor_to_plot_m,
      irrigation?.distance_motor_to_plot_m,
    ),
    sugarcane_type: firstNonEmpty(farm?.sugarcane_type) || "new",
    sugarcane_yield: firstNonEmpty(farm?.sugarcane_yield),
    plants_in_field: firstNonEmpty(farm?.plants_in_field),
  };
}

function formFromFarm(farm: any, farmId?: string, plotId?: string): FarmFormData {
  const fromApi = farmToForm(farm);
  const plotKey = normalizePlotKey(currentPlotKey());
  const pending =
    (farmId ? readSavedFarmFields(farmId) : null) ??
    (plotId ? readSavedFarmFields(`plot:${plotId}`) : null) ??
    (plotKey ? readSavedFarmFields(`plotkey:${plotKey}`) : null);
  if (!pending) return fromApi;
  return { ...fromApi, ...pending } as FarmFormData;
}

function mergeFarmFieldsIntoFarmObject(farm: any, form: FarmFormData): any {
  const irrigation = normalizeIrrigationType(form.irrigation_type);
  const prevIrr = farm?.irrigations?.[0] ?? {};
  const nextIrrigation = {
    ...prevIrr,
    irrigation_type_code: irrigation,
    irrigation_type_name: irrigation,
    flow_rate_lph: form.flow_rate_liter_per_hour || prevIrr.flow_rate_lph,
    emitters_count: form.emitters_per_plant || prevIrr.emitters_count,
    motor_horsepower: form.motor_horsepower || prevIrr.motor_horsepower,
    pipe_width_inches: form.pipe_width_inches || prevIrr.pipe_width_inches,
    distance_motor_to_plot_m: form.distance_motor_to_plot_m || prevIrr.distance_motor_to_plot_m,
  };
  return {
    ...farm,
    address: form.address,
    area_size: form.area_size,
    plantation_date: form.plantation_date,
    crop_variety: form.crop_variety,
    variety_type: form.variety_type,
    variety_subtype: form.variety_subtype,
    plantation_type: toApiPlantationType(form.variety_type),
    planting_method: toApiPlantingMethod(form.variety_subtype),
    spacing_a: form.spacing_a,
    spacing_b: form.spacing_b,
    irrigation_type: irrigation,
    sugarcane_type: form.sugarcane_type,
    sugarcane_yield: form.sugarcane_yield,
    plants_in_field: form.plants_in_field,
    irrigations: Array.isArray(farm?.irrigations)
      ? [nextIrrigation, ...farm.irrigations.slice(1)]
      : [nextIrrigation],
    crop_type: {
      ...(farm?.crop_type ?? {}),
      crop_variety: form.crop_variety,
      plantation_type: toApiPlantationType(form.variety_type),
      planting_method: toApiPlantingMethod(form.variety_subtype),
    },
  };
}

/** Write saved form values onto the matching farm inside a my-profile payload. */
function farmRecordMatches(
  farm: any,
  plot: any,
  farmId: string,
  plotId?: string,
): boolean {
  if (farmId && farm?.id != null && String(farm.id) === String(farmId)) return true;
  if (plotId && plot?.id != null && String(plot.id) === String(plotId)) return true;
  if (plotId && farm?.plot_id != null && String(farm.plot_id) === String(plotId)) return true;
  return false;
}

function mergeFarmFormIntoProfile(
  data: any,
  farmId: string,
  form: FarmFormData,
  plotId?: string,
): any {
  if (!data || (!farmId && !plotId)) return data;
  const next = { ...data };

  const patchFarms = (farms: any[], plot: any) =>
    farms.map((farm: any) =>
      farmRecordMatches(farm, plot, farmId, plotId)
        ? mergeFarmFieldsIntoFarmObject(farm, form)
        : farm,
    );

  if (Array.isArray(next.plots)) {
    next.plots = next.plots.map((plot: any) => {
      const patched = { ...plot };
      if (Array.isArray(plot?.farms)) {
        patched.farms = patchFarms(plot.farms, plot);
      }
      if (plot?.farm && typeof plot.farm === "object") {
        patched.farm = farmRecordMatches(plot.farm, plot, farmId, plotId)
          ? mergeFarmFieldsIntoFarmObject(plot.farm, form)
          : plot.farm;
      }
      return patched;
    });
  }
  if (Array.isArray(next.farms)) {
    next.farms = patchFarms(next.farms, next.plot ?? null);
  }
  if (next.farm && farmRecordMatches(next.farm, next.plot ?? next.farm?.plot, farmId, plotId)) {
    next.farm = mergeFarmFieldsIntoFarmObject(next.farm, form);
  }
  return next;
}

function currentPlotKey(): string {
  try {
    return (localStorage.getItem("selectedPlot") || "").trim();
  } catch {
    return "";
  }
}

function choicePlotKeys(choice: FarmChoice): string[] {
  return [
    choice.farmId,
    choice.plotId,
    choice.gatNumber && choice.plotNumber ? `${choice.gatNumber}/${choice.plotNumber}` : "",
    choice.gatNumber && choice.plotNumber ? `${choice.gatNumber}_${choice.plotNumber}` : "",
    choice.plot?.fastapi_plot_id,
    choice.plot?.id,
    choice.farm?.farm_uid,
    plotKeyFromRecord(choice.plot),
  ]
    .filter((value) => value != null && String(value).trim() !== "")
    .map((value) => normalizePlotKey(String(value)))
    .filter(Boolean);
}

function pickFarmChoice(choices: FarmChoice[], plotKey = currentPlotKey()): FarmChoice | undefined {
  if (!choices.length) return undefined;
  const key = normalizePlotKey(plotKey);
  if (!key) return choices.length === 1 ? choices[0] : undefined;
  const match = choices.find((choice) => choicePlotKeys(choice).includes(key));
  if (match) return match;
  return choices.length === 1 ? choices[0] : undefined;
}

/** Prefer the map-selected plot, then fall back to explicit farm id. */
function resolveSaveFarmChoice(
  choices: FarmChoice[],
  activePlotKey: string,
  selectedFarmId: string,
): FarmChoice | undefined {
  const fromPlot = pickFarmChoice(choices, activePlotKey);
  if (fromPlot) return fromPlot;
  if (selectedFarmId) {
    const fromId = choices.find((c) => c.farmId === selectedFarmId);
    if (fromId) return fromId;
  }
  return choices.length === 1 ? choices[0] : undefined;
}

function ensureCropPayloadBlock(
  payload: Record<string, unknown>,
  farmForm: FarmFormData,
  plantationType: string | undefined,
  plantingMethod: string | undefined,
  cropTypeId: number | undefined,
): void {
  if (cropTypeId != null) payload.crop_type_id = cropTypeId;
  payload.crop_variety = farmForm.crop_variety.trim();
  if (plantationType) payload.variety_type = plantationType;
  if (plantingMethod) payload.variety_subtype = plantingMethod;
  if (farmForm.sugarcane_type.trim()) {
    payload.sugarcane_type = farmForm.sugarcane_type.trim();
  }
}

function ensureIrrigationPayloadBlock(
  payload: Record<string, unknown>,
  farmForm: FarmFormData,
  irrigation: string,
): void {
  payload.irrigation_type = irrigation;
  if (irrigation === "drip") {
    if (farmForm.flow_rate_liter_per_hour.trim()) {
      payload.flow_rate_liter_per_hour = farmForm.flow_rate_liter_per_hour.trim();
    }
    if (farmForm.emitters_per_plant.trim()) {
      payload.emitters_per_plant = Number(farmForm.emitters_per_plant);
    }
  } else {
    if (farmForm.motor_horsepower.trim()) {
      payload.motor_horsepower = Number(farmForm.motor_horsepower);
    }
    if (farmForm.pipe_width_inches.trim()) {
      payload.pipe_width_inches = Number(farmForm.pipe_width_inches);
    }
    if (farmForm.distance_motor_to_plot_m.trim()) {
      payload.distance_motor_to_plot_m = Number(farmForm.distance_motor_to_plot_m);
    }
  }
}

function plotMetaFromChoice(choice: FarmChoice) {
  const plot = choice.plot ?? choice.farm?.plot ?? null;
  const farm = choice.farm;
  const plotId =
    plot?.id ??
    plot?.plot_id ??
    farm?.plot_id ??
    farm?.plot?.id ??
    (choice.plotId || null) ??
    (choice.farmId || null);
  const gat = choice.gatNumber;
  const plotNum = choice.plotNumber;
  const gatPlot = gat && plotNum ? `${gat}/${plotNum}` : gat || plotNum || "";
  const fastapi = plot?.fastapi_plot_id != null ? String(plot.fastapi_plot_id).trim() : "";
  const primaryKey = plotKeyFromRecord(plot) || gatPlot || String(plotId ?? "");
  return {
    plotId: plotId != null && String(plotId).trim() !== "" ? String(plotId) : choice.farmId || "my-profile",
    plotLabel: primaryKey || gatPlot,
    plotKeys: [
      primaryKey,
      fastapi,
      gatPlot,
      gat && plotNum ? `${gat}_${plotNum}` : "",
      plotId != null ? String(plotId) : "",
      choice.farmId,
    ].filter(Boolean),
    boundary:
      resolvePlotBoundary(plot) ??
      resolvePlotBoundary(farm?.plot) ??
      resolvePlotBoundary(farm),
    location:
      resolveGeoJsonPoint(plot) ??
      resolveGeoJsonPoint(farm?.plot) ??
      resolveGeoJsonPoint(farm),
  };
}

interface UserFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address: string;
  village: string;
  district: string;
  state: string;
  taluka: string;
  aadhaar_number: string;
}

interface FarmFormData {
  address: string;
  area_size: string;
  plantation_date: string;
  crop_variety: string;
  variety_type: string;        // plantation type (Suru / Adsali …)
  variety_subtype: string;     // planting method (1_bud …)
  spacing_a: string;
  spacing_b: string;
  irrigation_type: string;
  flow_rate_liter_per_hour: string;
  emitters_per_plant: string;
  motor_horsepower: string;
  pipe_width_inches: string;
  distance_motor_to_plot_m: string;
  sugarcane_type: string;
  sugarcane_yield: string;
  plants_in_field: string;
}

const emptyUser: UserFormData = {
  first_name: "", last_name: "", email: "", phone_number: "",
  address: "", village: "", district: "", state: "", taluka: "", aadhaar_number: "",
};
const emptyFarm: FarmFormData = {
  address: "", area_size: "", plantation_date: "", crop_variety: "",
  variety_type: "", variety_subtype: "", spacing_a: "", spacing_b: "",
  irrigation_type: "", flow_rate_liter_per_hour: "",
  emitters_per_plant: "", motor_horsepower: "", pipe_width_inches: "", distance_motor_to_plot_m: "", sugarcane_type: "new", sugarcane_yield: "",
  plants_in_field: "",
};

const InputField: React.FC<{
  label: string; value: string; onChange?: (v: string) => void;
  icon?: React.ReactNode; readOnly?: boolean; type?: string; required?: boolean; placeholder?: string;
}> = ({ label, value, onChange, icon, readOnly, type = "text", required, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${readOnly ? "bg-gray-50 border-gray-200 text-gray-500" : "bg-white border-green-200 focus-within:border-green-500 focus-within:ring-2 focus-within:ring-green-100"}`}>
      {icon && <span className="text-gray-400 flex-shrink-0">{icon}</span>}
      <input
        type={type} value={value}
        readOnly={readOnly}
        placeholder={readOnly ? "—" : (placeholder || "")}
        onChange={e => onChange?.(e.target.value)}
        className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-300"
      />
    </div>
  </div>
);

const SelectField: React.FC<{
  label: string; value: string; options: string[];
  onChange?: (v: string) => void; readOnly?: boolean;
}> = ({ label, value, options, onChange, readOnly }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
    {readOnly ? (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-gray-50 border-gray-200 text-gray-500 text-sm min-h-[42px]">
        {value || "—"}
      </div>
    ) : (
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange?.(e.target.value)}
          className="w-full px-3 py-2.5 pr-8 rounded-xl border border-green-200 bg-white text-sm text-gray-800 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 appearance-none"
        >
          <option value="">— Select —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    )}
  </div>
);

interface Props { onClose?: () => void; }

const MyProfile: React.FC<Props> = ({ onClose }) => {
  const { selectedPlotName } = useAppContext();
  const { t } = useI18nLite();
  const [profileData, setProfileData] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const lastSyncedPlotKeyRef = useRef<string>("");

  const [editingUser, setEditingUser] = useState(false);
  const [editingFarm, setEditingFarm] = useState(false);

  const [userForm, setUserForm] = useState<UserFormData>(emptyUser);
  const [farmForm, setFarmForm] = useState<FarmFormData>(emptyFarm);
  const [farmChoices, setFarmChoices] = useState<FarmChoice[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const activePlotKey = selectedPlotName || currentPlotKey();

  const [savingUser, setSavingUser] = useState(false);
  const [savingFarm, setSavingFarm] = useState(false);
  const [userMsg, setUserMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [farmMsg, setFarmMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [plotBoundaryMeta, setPlotBoundaryMeta] = useState<{
    plotId: number | string | null;
    plotLabel: string;
    plotKeys: string[];
    boundary: GeoJsonPolygon | null;
    location: GeoJsonPoint | null;
  }>({ plotId: null, plotLabel: "", plotKeys: [], boundary: null, location: null });
  const [showBoundaryEditor, setShowBoundaryEditor] = useState(false);
  const [boundaryMsg, setBoundaryMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [cropTypes, setCropTypes] = useState<CropTypeRecord[]>([]);

  const openBoundaryEditor = () => {
    setBoundaryMsg(null);
    setShowBoundaryEditor(true);
  };

  useEffect(() => {
    let cancelled = false;
    getCropTypes()
      .then((res) => {
        if (cancelled) return;
        const data = res?.data;
        let list: any[] = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.results)) list = data.results;
        else if (data && Array.isArray(data.data)) list = data.data;
        const rows = list
          .map((item: any) => ({
            id: Number(item.id ?? item.pk),
            crop_type: item.crop_type ?? item.crop_type_name ?? item.name ?? "Sugarcane",
            plantation_type: String(
              item.plantation_type ?? item.plantation_type_display ?? "",
            ).trim(),
            planting_method: String(
              item.planting_method ?? item.planting_method_display ?? "",
            ).trim(),
          }))
          .filter((item) => Number.isFinite(item.id));
        setCropTypes(rows);
      })
      .catch(() => {
        if (!cancelled) setCropTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        setLoadingProfile(true);
        const res = await getFarmerMyProfile({ force: true });
        const raw: any = (res as { data?: unknown }).data ?? res;
        const data: any = overlaySavedFarmsOnProfile(raw);
        setProfileData(data);
        // Prefill user form
        const fp = data.farmer_profile ?? data;
        const pi = fp.personal_info ?? {};
        const ai = fp.address_info ?? {};
        setUserForm({
          first_name: pi.first_name ?? fp.first_name ?? "",
          last_name: pi.last_name ?? fp.last_name ?? "",
          email: fp.email ?? "",
          phone_number: pi.phone_number ?? fp.phone_number ?? "",
          address: ai.address ?? fp.address ?? "",
          village: ai.village ?? fp.village ?? "",
          district: ai.district ?? fp.district ?? "",
          state: ai.state ?? fp.state ?? "",
          taluka: ai.taluka ?? fp.taluka ?? "",
          aadhaar_number: pi.aadhaar_number ?? fp.aadhaar_number ?? "",
        });
        const choices = collectFarmChoices(data);
        setFarmChoices(choices);
        const lastFarmId = readLastSavedFarmId();
        const first =
          pickFarmChoice(choices, selectedPlotName || currentPlotKey()) ??
          (lastFarmId ? choices.find((c) => c.farmId === lastFarmId) : undefined) ??
          (choices.length === 1 ? choices[0] : undefined) ??
          choices[0];
        if (first) {
          lastSyncedPlotKeyRef.current = selectedPlotName || currentPlotKey() || first.farmId;
          setSelectedFarmId(first.farmId);
          setFarmForm(formFromFarm(first.farm, first.farmId, first.plotId));
          setPlotBoundaryMeta(plotMetaFromChoice(first));
        } else {
          const nestedPlot = resolveNestedPlot(data);
          const farm = nestedPlot?.farms?.[0] ?? nestedPlot?.farm ?? data.farm ?? {};
          setFarmForm(formFromFarm(farm, farm?.id != null ? String(farm.id) : "", nestedPlot?.id != null ? String(nestedPlot.id) : ""));
          setPlotBoundaryMeta(plotMetaFromChoice({
            farmId: "",
            plotId: nestedPlot?.id != null ? String(nestedPlot.id) : "",
            gatNumber: String(nestedPlot?.gat_number ?? ""),
            plotNumber: String(nestedPlot?.plot_number ?? ""),
            label: "",
            farm,
            plot: nestedPlot,
          }));
        }
      } catch (e) {
        console.error("MyProfile load error:", e);
      } finally {
        setLoadingProfile(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!farmChoices.length) return;
    // Only follow the map plot when that plot actually changes. Do not
    // overwrite the form after a save just because farmChoices was replaced.
    if (lastSyncedPlotKeyRef.current === activePlotKey && selectedFarmId) return;
    lastSyncedPlotKeyRef.current = activePlotKey;
    const next =
      pickFarmChoice(farmChoices, activePlotKey) ??
      farmChoices.find((c) => c.farmId === selectedFarmId) ??
      (readLastSavedFarmId()
        ? farmChoices.find((c) => c.farmId === readLastSavedFarmId())
        : undefined);
    if (!next) return;
    setSelectedFarmId(next.farmId);
    setFarmForm(formFromFarm(next.farm, next.farmId, next.plotId));
    setPlotBoundaryMeta(plotMetaFromChoice(next));
    setEditingFarm(false);
    setFarmMsg(null);
  }, [activePlotKey, farmChoices, selectedFarmId]);

  // ── Save user profile ─────────────────────────────────────────────────────
  const handleSaveUser = async () => {
    try {
      setSavingUser(true);
      setUserMsg(null);
      await patchUserMyProfile({
        first_name: userForm.first_name,
        last_name: userForm.last_name,
        email: userForm.email,
        phone_number: userForm.phone_number,
        address: userForm.address,
        village: userForm.village,
        district: userForm.district,
        state: userForm.state,
        taluka: userForm.taluka,
        aadhaar_number: userForm.aadhaar_number,
      });
      await refreshApiEndpoints();
      setUserMsg({ type: "success", text: "Profile updated successfully!" });
      setEditingUser(false);
      setTimeout(() => setUserMsg(null), 4000);
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.response?.data?.message || e.message;
      setUserMsg({ type: "error", text: detail || "Failed to save profile." });
    } finally {
      setSavingUser(false);
    }
  };

  const applyFarmChoice = (choice: FarmChoice, formOverride?: FarmFormData) => {
    setSelectedFarmId(choice.farmId);
    setFarmForm(formOverride ?? formFromFarm(choice.farm, choice.farmId, choice.plotId));
    setPlotBoundaryMeta(plotMetaFromChoice(choice));
  };

  // ── Save farm profile ─────────────────────────────────────────────────────
  const handleSaveFarm = async () => {
    try {
      setSavingFarm(true);
      setFarmMsg(null);

      const choice = resolveSaveFarmChoice(farmChoices, activePlotKey, selectedFarmId);
      if (!choice?.farmId) {
        setFarmMsg({
          type: "error",
          text: "This plot's farm was not found. Select the plot on the map, then try Save again.",
        });
        return;
      }

      if (choice.farmId !== selectedFarmId) {
        setSelectedFarmId(choice.farmId);
      }

      const irrigation = farmForm.irrigation_type.trim().toLowerCase();
      if (irrigation !== "drip" && irrigation !== "flood") {
        setFarmMsg({
          type: "error",
          text: "Please select Irrigation Type (drip or flood) before saving.",
        });
        return;
      }

      const plantationType = toApiPlantationType(farmForm.variety_type);
      const plantingMethod = toApiPlantingMethod(farmForm.variety_subtype);
      const farmIdNum = Number(choice.farmId);
      const existingCropTypeId = readCropTypeId(choice.farm);
      const cropTypeId = resolveCropTypeId(
        farmForm.variety_type,
        farmForm.variety_subtype,
        cropTypes,
        existingCropTypeId,
      );
      const existingSoilTypeId = readSoilTypeId(choice.farm);
      const originalForm = formFromFarm(choice.farm, choice.farmId, choice.plotId);
      const multiPlot = farmChoices.length > 1;
      const cropMetadataChanged =
        comparableValue("variety_type", originalForm.variety_type) !==
          comparableValue("variety_type", farmForm.variety_type) ||
        comparableValue("variety_subtype", originalForm.variety_subtype) !==
          comparableValue("variety_subtype", farmForm.variety_subtype) ||
        cropTypeId !== existingCropTypeId;
      const irrigationChanged =
        comparableValue("irrigation_type", originalForm.irrigation_type) !==
        comparableValue("irrigation_type", irrigation);

      const payload: Record<string, unknown> = {
        farm_id: Number.isFinite(farmIdNum) ? farmIdNum : choice.farmId,
        plantation_date: farmForm.plantation_date
          ? String(farmForm.plantation_date).slice(0, 10)
          : undefined,
        soil_type_id: existingSoilTypeId === undefined ? null : existingSoilTypeId,
        crop_type_id: cropTypeId,
        spacing_a: farmForm.spacing_a || undefined,
        spacing_b: farmForm.spacing_b || undefined,
        sugarcane_type: farmForm.sugarcane_type || undefined,
        crop_variety: farmForm.crop_variety || undefined,
        variety_type: plantationType || undefined,
        variety_subtype: plantingMethod || undefined,
        irrigation_type: irrigation,
      };

      if (farmForm.address.trim()) payload.address = farmForm.address.trim();
      if (farmForm.area_size.trim()) payload.area_size = farmForm.area_size.trim();
      if (farmForm.sugarcane_yield.trim()) {
        payload.sugarcane_yield = farmForm.sugarcane_yield.trim();
      }
      if (farmForm.plants_in_field.trim()) {
        payload.plants_in_field = Number(farmForm.plants_in_field);
      }

      ensureIrrigationPayloadBlock(payload, farmForm, irrigation);

      if (!multiPlot) {
        // Single plot: omit unchanged fields to keep PATCH small.
        for (const key of Object.keys(payload)) {
          const val = payload[key];
          if (val === undefined || val === "") {
            delete payload[key];
            continue;
          }
          if (key === "farm_id") continue;
          const orig =
            key === "crop_type_id"
              ? existingCropTypeId
              : key === "soil_type_id"
                ? existingSoilTypeId ?? null
                : key === "variety_type"
                  ? toApiPlantationType(originalForm.variety_type)
                  : key === "variety_subtype"
                    ? toApiPlantingMethod(originalForm.variety_subtype)
                    : (originalForm as unknown as Record<string, unknown>)[key];
          if (key === "plantation_date") {
            const a = String(val).slice(0, 10);
            const b = orig ? String(orig).slice(0, 10) : "";
            if (a === b) delete payload[key];
            continue;
          }
          if (comparableValue(key, orig) === comparableValue(key, val)) {
            delete payload[key];
          }
        }
      } else {
        // Multi-plot: send the full farm payload so the correct farm_id is fully updated.
        for (const key of Object.keys(payload)) {
          const val = payload[key];
          if (val === undefined || val === "") delete payload[key];
        }
      }

      // When crop metadata changes, always send the full crop block so crop_variety
      // is not replaced by the linked CropType default on the backend.
      if (cropMetadataChanged) {
        ensureCropPayloadBlock(
          payload,
          farmForm,
          plantationType,
          plantingMethod,
          cropTypeId,
        );
      }

      if (irrigationChanged || multiPlot) {
        ensureIrrigationPayloadBlock(payload, farmForm, irrigation);
      }

      if (!payload.farm_id) {
        setFarmMsg({ type: "error", text: "Missing farm_id — cannot save this plot." });
        return;
      }
      const resp = await patchFarmMyProfile(payload as Parameters<typeof patchFarmMyProfile>[0]);
      // Quick check: ensure response appears to reference the farm we updated.
      try {
        const body = (resp as any)?.data ?? resp;
        const findIdIn = (obj: any, targetId: string | number) => {
          const tid = String(targetId);
          if (!obj) return false;
          if (obj?.id != null && String(obj.id) === tid) return true;
          if (Array.isArray(obj?.farms)) {
            if (obj.farms.some((f: any) => String(f?.id) === tid)) return true;
          }
          if (Array.isArray(obj?.plots)) {
            for (const p of obj.plots) {
              if (Array.isArray(p?.farms) && p.farms.some((f: any) => String(f?.id) === tid)) return true;
            }
          }
          if (Array.isArray(obj?.farm_ids) && obj.farm_ids.some((x: any) => String(x) === tid)) return true;
          return false;
        };
        if (!findIdIn(body, choice.farmId)) {
          console.warn("PATCH /farms/my-profile/ returned response that does not reference farm_id", choice.farmId, body);
        }
      } catch (err) {
        // ignore
      }
      const sentForm: FarmFormData = { ...farmForm };
      persistSavedFarmFields(choice.farmId, sentForm);
      if (choice.plotId) persistSavedFarmFields(`plot:${choice.plotId}`, sentForm);
      const plotKey = normalizePlotKey(activePlotKey || currentPlotKey());
      if (plotKey) persistSavedFarmFields(`plotkey:${plotKey}`, sentForm);

      // Show saved values immediately so view mode never snaps back to stale GET.
      const optimistic = mergeFarmFormIntoProfile(
        profileData ?? {},
        choice.farmId,
        sentForm,
        choice.plotId,
      );
      setProfileData(optimistic);
      const optimisticChoices = collectFarmChoices(optimistic);
      setFarmChoices(optimisticChoices.length ? optimisticChoices : farmChoices);
      applyFarmChoice(
        optimisticChoices.find((c) => c.farmId === choice.farmId) ?? choice,
        sentForm,
      );
      setCache("farmerProfile", optimistic);
      notifyFarmFieldsUpdated(optimistic);
      lastSyncedPlotKeyRef.current = activePlotKey || currentPlotKey() || choice.farmId;
      setEditingFarm(false);

      let staleFields: string[] = [];
      try {
        const refreshed = (await getFarmerMyProfile({ force: true })) as { data?: any };
        const nextRaw = overlaySavedFarmsOnProfile(refreshed?.data ?? refreshed);
        if (nextRaw) {
          const serverFarm = findFarmInProfile(nextRaw, choice.farmId);
          const mergedProfile = serverFarm
            ? overlaySavedFarmsOnProfile(
                mergeServerFarmIntoProfile(profileData ?? nextRaw, serverFarm, choice.farmId),
              )
            : nextRaw;
          if (serverFarm) {
            staleFields = findMismatchedFarmFields(payload, findFarmInProfile(mergedProfile, choice.farmId) ?? serverFarm);
          }
          setProfileData(mergedProfile);
          const nextChoices = collectFarmChoices(mergedProfile);
          setFarmChoices(nextChoices.length ? nextChoices : farmChoices);
          const keep =
            nextChoices.find((c) => c.farmId === choice.farmId) ??
            pickFarmChoice(nextChoices, activePlotKey) ??
            choice;
          applyFarmChoice(keep, formFromFarm(keep.farm, keep.farmId, keep.plotId));
          setCache("farmerProfile", mergedProfile);
          notifyFarmFieldsUpdated(mergedProfile);
        }
      } catch {
        // Optimistic values already applied.
      }
      await refreshApiEndpoints();
      if (staleFields.length) {
        setFarmMsg({
          type: "success",
          text: `Saved. Server still returns old values for: ${staleFields.join(", ")}`,
        });
      } else {
        setFarmMsg({ type: "success", text: "Farm data updated successfully!" });
      }
      setTimeout(() => setFarmMsg(null), 4000);
    } catch (e: any) {
      setFarmMsg({
        type: "error",
        text: formatApiError(e.response?.data, e.message || "Failed to save farm data."),
      });
    } finally {
      setSavingFarm(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const setUser = (key: keyof UserFormData) => (val: string) =>
    setUserForm(f => ({ ...f, [key]: val }));
  const setFarm = (key: keyof FarmFormData) => (val: string) =>
    setFarmForm(f => ({ ...f, [key]: val }));

  const cancelUser = () => setEditingUser(false);
  const cancelFarm = () => {
    const choice = farmChoices.find((c) => c.farmId === selectedFarmId);
    if (choice) applyFarmChoice(choice);
    setFarmMsg(null);
    setEditingFarm(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading profile…</p>
        </div>
      </div>
    );
  }

  const FeedbackBanner = ({ msg }: { msg: typeof userMsg }) =>
    msg ? (
      <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${msg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
        {msg.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
        {msg.text}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">My Profile</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your personal and farm details</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        )}
      </div>

      <div className="space-y-6 max-w-4xl mx-auto">

        {/* ── PERSONAL INFORMATION ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                <User size={18} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Personal Information</h2>
                <p className="text-xs text-gray-500">Your contact and identity details</p>
              </div>
            </div>
            {!editingUser ? (
              <button
                onClick={() => setEditingUser(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all"
              >
                <Edit3 size={14} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelUser}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-all"
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  disabled={savingUser}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-60"
                >
                  {savingUser ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            <FeedbackBanner msg={userMsg} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="First Name" value={userForm.first_name} onChange={setUser("first_name")} icon={<User size={14} />} readOnly={!editingUser} required />
              <InputField label="Last Name" value={userForm.last_name} onChange={setUser("last_name")} icon={<User size={14} />} readOnly={!editingUser} required />
              <InputField label="Email" value={userForm.email} onChange={setUser("email")} icon={<Mail size={14} />} type="email" readOnly={!editingUser} />
              <InputField label="Phone Number" value={userForm.phone_number} onChange={setUser("phone_number")} icon={<Phone size={14} />} readOnly={!editingUser} required />
              <InputField label="Aadhaar Number" value={userForm.aadhaar_number} onChange={setUser("aadhaar_number")} icon={<FileText size={14} />} readOnly={!editingUser} />
              <InputField label="Address" value={userForm.address} onChange={setUser("address")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="Village" value={userForm.village} onChange={setUser("village")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="Taluka" value={userForm.taluka} onChange={setUser("taluka")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="District" value={userForm.district} onChange={setUser("district")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="State" value={userForm.state} onChange={setUser("state")} icon={<MapPin size={14} />} readOnly={!editingUser} />
            </div>
          </div>
        </div>

        {/* ── FARM / PLOT INFORMATION ──────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                <Leaf size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Farm & Plot Details</h2>
                <p className="text-xs text-gray-500">
                  Crop, irrigation and spacing information
                  {selectedFarmId ? ` · farm_id ${selectedFarmId}` : ""}
                </p>
              </div>
            </div>
            {!editingFarm ? (
              <button
                onClick={() => {
                  const choice =
                    resolveSaveFarmChoice(farmChoices, activePlotKey, selectedFarmId) ??
                    farmChoices.find((c) => c.farmId === selectedFarmId);
                  if (choice) applyFarmChoice(choice);
                  setEditingFarm(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all"
              >
                <Edit3 size={14} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelFarm}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-all"
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  onClick={handleSaveFarm}
                  disabled={savingFarm}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-60"
                >
                  {savingFarm ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            <FeedbackBanner msg={farmMsg} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="Farm Address" value={farmForm.address} onChange={setFarm("address")} icon={<MapPin size={14} />} readOnly={!editingFarm} />
              <InputField label="Area Size (acres)" value={farmForm.area_size} onChange={setFarm("area_size")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Plantation Date" value={farmForm.plantation_date} onChange={setFarm("plantation_date")} icon={<Calendar size={14} />} type="date" readOnly={!editingFarm} />
              <InputField label="Crop Variety" value={farmForm.crop_variety} onChange={setFarm("crop_variety")} icon={<Leaf size={14} />} readOnly={!editingFarm} />

              {/* Dropdowns shown only when editing */}
              <SelectField
                label="Plantation Type (Variety Type)"
                value={farmForm.variety_type}
                options={PLANTATION_TYPE_OPTIONS}
                onChange={setFarm("variety_type")}
                readOnly={!editingFarm}
              />
              <SelectField
                label="Planting Method (Variety Subtype)"
                value={farmForm.variety_subtype}
                options={PLANTATION_METHOD_OPTIONS}
                onChange={setFarm("variety_subtype")}
                readOnly={!editingFarm}
              />

              <InputField label="Spacing A (ft)" value={farmForm.spacing_a} onChange={setFarm("spacing_a")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Spacing B (ft)" value={farmForm.spacing_b} onChange={setFarm("spacing_b")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              
              <SelectField
                label="Irrigation Type"
                value={farmForm.irrigation_type}
                options={["drip", "flood"]}
                onChange={setFarm("irrigation_type")}
                readOnly={!editingFarm}
              />

              {farmForm.irrigation_type === "drip" && (
                <>
                  <InputField label="Flow Rate (L/hr)" value={farmForm.flow_rate_liter_per_hour} onChange={setFarm("flow_rate_liter_per_hour")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Emitters Per Plant" value={farmForm.emitters_per_plant} onChange={setFarm("emitters_per_plant")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                </>
              )}

              {farmForm.irrigation_type === "flood" && (
                <>
                  <InputField label="Motor Horsepower" value={farmForm.motor_horsepower} onChange={setFarm("motor_horsepower")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Pipe Width (inches)" value={farmForm.pipe_width_inches} onChange={setFarm("pipe_width_inches")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Distance Motor to Plot (m)" value={farmForm.distance_motor_to_plot_m} onChange={setFarm("distance_motor_to_plot_m")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
                </>
              )}

              {/* Sugarcane type select */}
              <SelectField
                label="Sugarcane Type"
                value={farmForm.sugarcane_type}
                options={["new", "old"]}
                onChange={setFarm("sugarcane_type")}
                readOnly={!editingFarm}
              />
              <InputField label="Sugarcane Yield (tonnes)" value={farmForm.sugarcane_yield} onChange={setFarm("sugarcane_yield")} icon={<Leaf size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Plants in Field" value={farmForm.plants_in_field} onChange={setFarm("plants_in_field")} icon={<Leaf size={14} />} type="number" readOnly={!editingFarm} />
            </div>

            <div className="pt-2 border-t border-gray-100">
              <FeedbackBanner msg={boundaryMsg} />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="notranslate" translate="no">
                  <p className="text-sm font-semibold text-gray-800">{t("plotBoundary.sectionTitle")}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {plotBoundaryMeta.boundary?.coordinates?.[0]?.length
                      ? t("plotBoundary.boundarySaved")
                      : t("plotBoundary.noBoundary")}
                  </p>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all cursor-pointer notranslate skiptranslate relative z-[100000]"
                  translate="no"
                  data-no-translate=""
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openBoundaryEditor();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openBoundaryEditor();
                    }
                  }}
                >
                  <Map size={14} aria-hidden />
                  <span translate="no">{t("plotBoundary.editButton")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <EditPlotBoundaryModal
            open={showBoundaryEditor}
            onClose={() => setShowBoundaryEditor(false)}
            plotId={plotBoundaryMeta.plotId || selectedFarmId || "my-profile"}
            plotLabel={plotBoundaryMeta.plotLabel}
            plotKeys={plotBoundaryMeta.plotKeys}
            initialBoundary={plotBoundaryMeta.boundary}
            initialLocation={plotBoundaryMeta.location}
            onSaved={(boundary, location) => {
              setPlotBoundaryMeta((prev) => ({ ...prev, boundary, location }));
              setProfileData((prev: any) => {
                const nestedPlot = resolveNestedPlot(prev);
                if (!nestedPlot) return prev;

                const updatedPlot = {
                  ...nestedPlot,
                  boundary,
                  location,
                  coordinates: {
                    ...(nestedPlot.coordinates ?? {}),
                    boundary,
                    location,
                  },
                };

                let next: any;
                if (Array.isArray(prev?.plots) && prev.plots.length > 0) {
                  const plots = [...prev.plots];
                  plots[0] = updatedPlot;
                  next = { ...prev, plots };
                } else if (prev?.farm?.plot) {
                  next = {
                    ...prev,
                    farm: { ...prev.farm, plot: updatedPlot },
                  };
                } else {
                  next = { ...prev, plot: updatedPlot };
                }

                // Keep Home Map's shared farmerProfile cache in sync immediately.
                const cached = getCache("farmerProfile");
                const merged = mergeBoundaryIntoProfilePayload(
                  cached ?? next,
                  plotBoundaryMeta.plotLabel || String(plotBoundaryMeta.plotId ?? ""),
                  boundary,
                );
                setCache("farmerProfile", merged);

                return next;
              });
              setBoundaryMsg({
                type: "success",
                text: boundary
                  ? "Plot boundary updated successfully!"
                  : "Plot boundary removed successfully!",
              });
              setTimeout(() => setBoundaryMsg(null), 4000);
            }}
          />

      </div>
    </div>
  );
};

export default MyProfile;
