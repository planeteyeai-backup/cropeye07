import React, { useEffect, useState } from "react";
import "./Irrigation/Irrigation.css";
import { useAppContext } from "../context/AppContext";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { getSinglePlotAgroStats } from "../api";
import { resolveApiPlotName } from "../utils/plotName";
import {
  filterPastDays,
  formatIrrigationDateRange,
  needKlFromWaterFields,
  todayIsoInTz,
  type WaterRemainDay,
} from "../utils/waterRemainApi";
import { calculateAreaMetricsFromGeometry } from "../utils/plotGeometry";
import { CloudRain, Sun } from "lucide-react";

/** Normalize gat/plot so `8_1A` and `8/1A` match the shared Soil Moisture series. */
function normalizePlotId(id: string | null | undefined): string {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "/");
}

function plotsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePlotId(a);
  const nb = normalizePlotId(b);
  if (!na || !nb) return true;
  return na === nb;
}

type ScheduleDay = {
  day: string;
  etoSumMm: number;
  etoLossLiters: number;
  oneMmLiters?: number;
  waterRemainLiters: number;
  waterRemainM3: number;
  waterVolumeLiters: number;
  rainfall: number;
};

type IrrigationSystemParams = {
  irrigationTypeCode: string;
  flowRateLph: number | null;
  emittersCount: number;
  totalPlants: number;
  spacingA: number;
  spacingB: number;
  motorHp: number | null;
  pipeWidthInches: number | null;
  distanceMotorToPlot: number | null;
};

type PlotCoords = { lat: number; lon: number };

const EVENTS_API_BASE =
  String(import.meta.env.VITE_DEV_EVENTS_API_URL ?? "")
    .trim()
    .replace(/\/$/, "") || "https://events-cropeye.up.railway.app";

function parsePrecipMm(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

/**
 * Irrigation needed (KL) — same as SoilMoistureCard / Flutter:
 * remainKl from liters/1000 or m³; need = remain < 0 ? abs(remain) : 0.
 */
const irrigationNeededKlFromRemain = needKlFromWaterFields;

/** Flutter: ETo loss volume in kL. */
function etoLossKl(etoLossLiters: number): number {
  return Math.max(0, Number(etoLossLiters) || 0) / 1000;
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Motor Horsepower (HP) from farm irrigation profile.
 * Accepts API variants: motor_horsepower, motor_Horsepower, etc.
 * Walks irrigations[] arrays and nested farm/plot objects.
 */
function resolveMotorHorsepower(
  ...sources: Array<Record<string, unknown> | null | undefined | any>
): number | null {
  const keys = [
    "motor_horsepower",
    "motor_Horsepower",
    "Motor_Horsepower",
    "motorHorsepower",
    "horsepower",
    "motor_hp",
    "hp",
  ];

  const readHp = (obj: any): number | null => {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      const n = toFiniteNumber(obj[key]);
      if (n != null && n > 0) return n;
    }
    return null;
  };

  for (const src of sources) {
    if (!src) continue;
    const direct = readHp(src);
    if (direct != null) return direct;

    // Single irrigation object
    const oneIrr = readHp(src.irrigation);
    if (oneIrr != null) return oneIrr;

    // irrigations: [...]
    const irrList = Array.isArray(src.irrigations)
      ? src.irrigations
      : Array.isArray(src.irrigation)
        ? src.irrigation
        : [];
    for (const irr of irrList) {
      const fromIrr = readHp(irr);
      if (fromIrr != null) return fromIrr;
    }

    // farms: [...]
    const farmList = Array.isArray(src.farms)
      ? src.farms
      : src.farm
        ? Array.isArray(src.farm)
          ? src.farm
          : [src.farm]
        : [];
    for (const farm of farmList) {
      const fromFarm = readHp(farm);
      if (fromFarm != null) return fromFarm;
      const farmIrr = readHp(farm?.irrigation);
      if (farmIrr != null) return farmIrr;
      const farmIrrList = Array.isArray(farm?.irrigations)
        ? farm.irrigations
        : [];
      for (const irr of farmIrrList) {
        const fromIrr = readHp(irr);
        if (fromIrr != null) return fromIrr;
      }
    }
  }
  return null;
}

/** Liters applied vs previous remain after subtracting rainfall contribution. */
function irrigatedLitersFromBalance(
  curr: ScheduleDay,
  prev: ScheduleDay | null,
): number {
  if (!prev) return 0;
  const oneMm = toFiniteNumber(curr.oneMmLiters) ?? 0;
  const rainL = Math.max(0, Number(curr.rainfall) || 0) * Math.max(0, oneMm);
  const jump =
    (Number(curr.waterVolumeLiters) || 0) -
    (Number(prev.waterRemainLiters) || 0) -
    rainL;
  // Ignore tiny noise; treat only real positive water additions as irrigation.
  return jump > 100 ? jump : 0;
}

/**
 * Pump runtime from Need (KL) shown in the table:
 *   water_liters = Need_KL × 1000
 *   Time (minutes) = (Water (liters) / ((Motor_HP × 7000) × Area)) × 60
 * HP must be farm Motor Horsepower (not a guessed default when available).
 */
const LITERS_PER_HOUR_PER_HP = 7000;
/** Last resort only when Motor Horsepower is missing on the farm profile. */
const DEFAULT_MOTOR_HP = 7.5;

function calcPumpDurationMinutes(
  needKl: number,
  motorHp: number | null,
  areaAcres: number | null,
): number | null {
  if (!(needKl > 0)) return 0;
  const hp =
    motorHp != null && motorHp > 0 ? motorHp : DEFAULT_MOTOR_HP;
  const area = areaAcres != null && areaAcres > 0 ? areaAcres : 1;
  // Water in liters; Motor Horsepower × 7000 × Area in denominator
  const waterLiters = needKl * 1000;
  const denom = hp * LITERS_PER_HOUR_PER_HP * area;
  if (!(denom > 0)) return null;
  return (waterLiters / denom) * 60;
}

function formatPumpHours(minutes: number | null): string {
  if (minutes == null) return "—";
  if (!(minutes > 0)) return "0 h";
  const hours = minutes / 60;
  if (hours >= 1) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m >= 60) return `${h + 1}h`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  if (m >= 1) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${Math.max(1, Math.round(minutes * 60))}s`;
}

/** Prefer plot acres; else derive from one_mm_liters (≈ plot area m²). */
function resolveAreaAcres(
  plotAreaAcres: number | null,
  oneMmLiters?: number,
): number | null {
  if (plotAreaAcres != null && plotAreaAcres > 0) return plotAreaAcres;
  const oneMm = toFiniteNumber(oneMmLiters);
  if (oneMm != null && oneMm > 0) {
    const acres = oneMm / 4046.8564224;
    return acres > 0 ? acres : null;
  }
  return null;
}

/**
 * Same acre value as map label (e.g. 1.41 acre):
 * 1) area_acres fields
 * 2) polygon/boundary calculated acres
 * 3) area_size as acres (app stores acres, not hectares)
 */
function resolvePlotAreaAcresFromProfile(
  selectedPlot: any,
  firstFarm: any,
): number | null {
  const acresDirect = parseAreaAcres(
    selectedPlot?.area_acres ??
      selectedPlot?.soil?.area_acres ??
      firstFarm?.area_acres ??
      firstFarm?.soil?.area_acres,
  );
  if (acresDirect != null) return Number(acresDirect.toFixed(2));

  const ring =
    selectedPlot?.coordinates?.boundary?.coordinates?.[0] ||
    selectedPlot?.boundary?.coordinates?.[0] ||
    firstFarm?.boundary?.coordinates?.[0] ||
    firstFarm?.coordinates?.boundary?.coordinates?.[0];
  if (Array.isArray(ring) && ring.length >= 3) {
    const metrics = calculateAreaMetricsFromGeometry({
      type: "Polygon",
      coordinates: [ring],
    });
    if (metrics?.acres != null && metrics.acres > 0) {
      return Number(metrics.acres.toFixed(2));
    }
  }

  // In this app area_size is typically acres (see farm list / fertilizer UI).
  const sizeAsAcres = parseAreaAcres(
    selectedPlot?.area_size_numeric ??
      selectedPlot?.area_size ??
      firstFarm?.area_size_numeric ??
      firstFarm?.area_size ??
      selectedPlot?.area ??
      firstFarm?.area,
  );
  if (sizeAsAcres != null) return Number(sizeAsAcres.toFixed(2));

  return null;
}

function parseAreaAcres(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Prefer analyzeSinglePlot `area_acres` (same as map label). */
function areaAcresFromAnalyzeResponse(data: unknown): number | null {
  const row = data as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== "object") return null;

  const soil = row.soil as Record<string, unknown> | undefined;
  const props = row.properties as Record<string, unknown> | undefined;
  const soilProps = props?.soil as Record<string, unknown> | undefined;
  const direct =
    parseAreaAcres(row.area_acres) ??
    parseAreaAcres(soil?.area_acres) ??
    parseAreaAcres(props?.area_acres) ??
    parseAreaAcres(soilProps?.area_acres);
  if (direct != null) return Number(direct.toFixed(2));

  const features = row.features as unknown[] | undefined;
  if (Array.isArray(features) && features[0]) {
    const feat = features[0] as { properties?: Record<string, unknown> };
    const fromFeat =
      parseAreaAcres(feat.properties?.area_acres) ??
      parseAreaAcres((feat as Record<string, unknown>).area_acres);
    if (fromFeat != null) return Number(fromFeat.toFixed(2));
  }

  for (const value of Object.values(row)) {
    if (!value || typeof value !== "object") continue;
    const nested = value as Record<string, unknown>;
    const acres =
      parseAreaAcres(nested.area_acres) ??
      parseAreaAcres(
        (nested.properties as Record<string, unknown> | undefined)?.area_acres,
      );
    if (acres != null) return Number(acres.toFixed(2));
  }

  return null;
}

/** Hours from applied/required liters using plot drip/flood system params. */
function calcIrrigationHours(
  waterLiters: number,
  system: IrrigationSystemParams,
): number | null {
  if (!(waterLiters > 0)) return 0;

  if (system.irrigationTypeCode === "drip") {
    const flow = system.flowRateLph;
    const emitters = system.emittersCount;
    const plants = system.totalPlants;
    if (flow == null || !(flow > 0) || !(emitters > 0)) {
      return null;
    }
    // emitters_count is often per-plant; if it's clearly below plant count, scale up.
    const totalEmitters =
      plants > 0 && emitters < plants ? emitters * plants : emitters;
    const totalFlowLph = totalEmitters * flow;
    if (!(totalFlowLph > 0)) return null;
    return waterLiters / totalFlowLph;
  }

  const motorHp = system.motorHp;
  const pipeWidthInches = system.pipeWidthInches;
  if (
    motorHp == null ||
    !(motorHp > 0) ||
    pipeWidthInches == null ||
    !(pipeWidthInches > 0)
  ) {
    return null;
  }

  const diameterMeters = pipeWidthInches * 0.0254;
  const pipeAreaSqM = Math.PI * Math.pow(diameterMeters / 2, 2);
  const baseVelocity = Math.max(0.75, Math.min(2.5, motorHp * 0.45));
  let frictionFactor = 1;
  if (system.distanceMotorToPlot && system.distanceMotorToPlot > 0) {
    const reduction = (system.distanceMotorToPlot / 100) * 0.05;
    frictionFactor = Math.max(0.5, 1 - reduction);
  }
  const flowRateLitersPerHour =
    pipeAreaSqM * baseVelocity * frictionFactor * 3600 * 1000;
  if (!(flowRateLitersPerHour > 0)) return null;
  return waterLiters / flowRateLitersPerHour;
}

/** Fallback hours when system params are incomplete: depth(mm) as hours proxy. */
function fallbackIrrigationHours(
  waterLiters: number,
  oneMmLiters?: number,
): number | null {
  if (!(waterLiters > 0)) return 0;
  const oneMm = toFiniteNumber(oneMmLiters);
  if (oneMm == null || !(oneMm > 0)) return null;
  return waterLiters / oneMm;
}

async function fetchIrrigationEventDates(
  plotName: string,
): Promise<Set<string>> {
  const dates = new Set<string>();
  if (!plotName?.trim()) return dates;
  const candidates = Array.from(
    new Set([
      plotName,
      plotName.replace(/_/g, "/"),
      plotName.replace(/\//g, "_"),
    ]),
  );
  for (const candidate of candidates) {
    try {
      const qs = new URLSearchParams({
        threshold_ndmi: "0.05",
        threshold_ndwi: "0.05",
        min_days_between_events: "10",
      });
      const url = `${EVENTS_API_BASE}/plots/${encodeURIComponent(candidate)}/irrigation?${qs}`;
      const resp = await fetch(url, {
        method: "GET",
        mode: "cors",
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const events = Array.isArray(data?.events) ? data.events : [];
      for (const ev of events) {
        const day = String(ev?.date ?? "").slice(0, 10);
        if (day) dates.add(day);
      }
      return dates;
    } catch {
      /* try next plot-name form */
    }
  }
  return dates;
}

/** Calendar day in Asia/Kolkata: today minus N days → YYYY-MM-DD. */
function istDayOffset(daysBack: number): string {
  const today = todayIsoInTz();
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - daysBack);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapWaterRemainToScheduleDays(
  days: WaterRemainDay[],
  rainByDate: Map<string, number>,
  todayStr: string,
  rainfallMm: number,
): ScheduleDay[] {
  return days.map((item) => {
    const fromMap = rainByDate.get(item.date);
    const rainfall =
      fromMap != null && Number.isFinite(fromMap)
        ? fromMap
        : item.date === todayStr
          ? rainfallMm
          : 0;
    return {
      day: item.date,
      etoSumMm: item.eto_sum_mm,
      etoLossLiters: item.eto_loss_liters,
      oneMmLiters: item.one_mm_liters,
      waterRemainLiters: item.water_remain_liters,
      waterRemainM3: item.water_remain_m3,
      waterVolumeLiters: item.water_volume_liters,
      rainfall,
    };
  });
}

/** Daily rainfall (mm) for last N days at plot lat/lon — Open-Meteo past_days. */
async function fetchPastDailyRainfall(
  lat: number,
  lon: number,
  daysBack = 7,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    past_days: String(daysBack),
    forecast_days: "1",
    daily: "precipitation_sum",
    timezone: "Asia/Kolkata",
  });
  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!resp.ok) throw new Error(`Rainfall API ${resp.status}`);
  const data = await resp.json();
  const times: string[] = data?.daily?.time ?? [];
  const precip: unknown[] = data?.daily?.precipitation_sum ?? [];
  times.forEach((iso, i) => {
    const key = String(iso).slice(0, 10);
    if (key) map.set(key, parsePrecipMm(precip[i]));
  });
  return map;
}

/** Merge CropEye forecast precip for overlapping dates (today + near future). */
async function fetchForecastRainfall(
  lat: number,
  lon: number,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const resp = await fetch(
      `https://weather-cropeye.up.railway.app/forecast?lat=${lat}&lon=${lon}`,
    );
    if (!resp.ok) return map;
    const data = await resp.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    for (const row of rows) {
      const key = String(row?.date ?? "").slice(0, 10);
      if (!key) continue;
      map.set(key, parsePrecipMm(row?.precipitation));
    }
  } catch {
    /* optional */
  }
  return map;
}

const IrrigationSchedule: React.FC = () => {
  const { appState, setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const [plotName, setPlotName] = useState<string>("");
  const [plotCoords, setPlotCoords] = useState<PlotCoords | null>(null);
  const [etValue, setEtValue] = useState<number>(0.1);
  const [rainfallMm, setRainfallMm] = useState<number>(0);
  /** Past 7 days from water-remain + daily rainfall (Open-Meteo / forecast) */
  const [remainDays, setRemainDays] = useState<ScheduleDay[]>([]);
  const [rainByDate, setRainByDate] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [irrigationEventDates, setIrrigationEventDates] = useState<Set<string>>(
    () => new Set(),
  );
  const [irrigationSystem, setIrrigationSystem] =
    useState<IrrigationSystemParams>({
      irrigationTypeCode: "flood",
      flowRateLph: null,
      emittersCount: 0,
      totalPlants: 0,
      spacingA: 0,
      spacingB: 0,
      motorHp: null,
      pipeWidthInches: null,
      distanceMotorToPlot: null,
    });
  const [plotAreaAcres, setPlotAreaAcres] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const getETRange = (etMm: number): "Low" | "Medium" | "High" => {
    if (etMm <= 3.0) return "Low";
    if (etMm <= 5.5) return "Medium";
    return "High";
  };

  const getETRangeColor = (range: "Low" | "Medium" | "High"): string => {
    switch (range) {
      case "Low":
        return "text-green-600 bg-green-50";
      case "Medium":
        return "text-orange-600 bg-orange-50";
      case "High":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  const fetchCurrentRainfall = async (lat: number, lon: number) => {
    try {
      const url = `https://weather-cropeye.up.railway.app/current-weather?lat=${lat}&lon=${lon}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Current weather ${resp.status}`);
      const data = await resp.json();
      setRainfallMm(Number(data?.precip_mm) || 0);
    } catch {
      setRainfallMm(0);
    }
  };

  useEffect(() => {
    if (!profile || profileLoading) return;

    type FarmerPlot = NonNullable<typeof profile.plots>[number];
    let selectedPlot: FarmerPlot | undefined;
    if (selectedPlotName) {
      selectedPlot = profile.plots?.find(
        (p) =>
          p.fastapi_plot_id === selectedPlotName ||
          `${p.gat_number}_${p.plot_number}` === selectedPlotName,
      );
    }
    if (!selectedPlot && profile.plots?.length) {
      selectedPlot = profile.plots[0];
    }
    if (!selectedPlot) {
      setPlotName("");
      setPlotCoords(null);
      setPlotAreaAcres(null);
      return;
    }

    // Same plot id preference as SoilMoistureCard so shared waterRemainPlot matches.
    const fastapi = selectedPlot.fastapi_plot_id
      ? String(selectedPlot.fastapi_plot_id).trim()
      : "";
    const gat =
      selectedPlot.gat_number != null
        ? String(selectedPlot.gat_number).trim()
        : "";
    const num =
      selectedPlot.plot_number != null
        ? String(selectedPlot.plot_number).trim()
        : "";
    const pureNumeric =
      Boolean(gat) && Boolean(num) && /^\d+$/.test(gat) && /^\d+$/.test(num);
    const plotId =
      (pureNumeric ? `${gat}_${num}` : "") ||
      fastapi ||
      (gat && num ? `${gat}_${num}` : "") ||
      "";
    setPlotName(plotId);

    // Collect irrigation from plot farms + top-level profile farms for this plot.
    const plotFarmsRaw =
      selectedPlot?.farms ??
      (Array.isArray((selectedPlot as any)?.farm)
        ? (selectedPlot as any).farm
        : (selectedPlot as any)?.farm
          ? [(selectedPlot as any).farm]
          : []);
    const firstFarm =
      (Array.isArray(plotFarmsRaw) ? plotFarmsRaw[0] : plotFarmsRaw) ?? null;
    const firstIrrigation =
      firstFarm?.irrigations?.[0] ??
      firstFarm?.irrigation ??
      (selectedPlot as any)?.irrigations?.[0] ??
      (selectedPlot as any)?.irrigation ??
      null;
    const irrigationCode = String(
      firstIrrigation?.irrigation_type_code ??
        firstIrrigation?.irrigation_type_name ??
        firstIrrigation?.irrigation_type ??
        firstFarm?.irrigation_type ??
        "flood",
    )
      .trim()
      .toLowerCase();
    const resolvedMotorHp = resolveMotorHorsepower(
      firstIrrigation,
      firstFarm,
      selectedPlot,
      profile,
      ...(Array.isArray(plotFarmsRaw) ? plotFarmsRaw : []),
      ...(Array.isArray(profile?.farms) ? profile.farms : []),
      ...(Array.isArray(profile?.plots) ? profile.plots : []),
    );
    if (import.meta.env.DEV) {
      console.debug("[IrrigationSchedule] Motor HP for hours:", resolvedMotorHp, {
        plot: plotId,
        fromIrrigation: firstIrrigation?.motor_horsepower ?? firstIrrigation?.motor_Horsepower,
        fromFarm: firstFarm?.motor_horsepower ?? firstFarm?.motor_Horsepower,
      });
    }
    setIrrigationSystem({
      irrigationTypeCode: irrigationCode.includes("drip") ? "drip" : "flood",
      flowRateLph: toFiniteNumber(
        firstIrrigation?.flow_rate_lph ??
          firstIrrigation?.flow_rate_liter_per_hour ??
          firstFarm?.flow_rate_lph,
      ),
      emittersCount:
        toFiniteNumber(
          firstIrrigation?.emitters_count ??
            firstIrrigation?.emitters_per_plant ??
            firstFarm?.emitters_count,
        ) ?? 0,
      totalPlants: toFiniteNumber(firstFarm?.plants_in_field) ?? 0,
      spacingA: toFiniteNumber(firstFarm?.spacing_a) ?? 0,
      spacingB: toFiniteNumber(firstFarm?.spacing_b) ?? 0,
      motorHp: resolvedMotorHp,
      pipeWidthInches: toFiniteNumber(
        firstIrrigation?.pipe_width_inches ?? firstFarm?.pipe_width_inches,
      ),
      distanceMotorToPlot: toFiniteNumber(
        firstIrrigation?.distance_motor_to_plot_m ??
          firstFarm?.distance_motor_to_plot_m,
      ),
    });

    setPlotAreaAcres(resolvePlotAreaAcresFromProfile(selectedPlot, firstFarm));

    // Override with analyzeSinglePlot area_acres (same source as map label).
    let cancelled = false;
    const apiPlot =
      resolveApiPlotName(plotId, profile?.plots) || plotId;
    if (apiPlot) {
      void getSinglePlotAgroStats(apiPlot)
        .then((data) => {
          if (cancelled) return;
          const acres = areaAcresFromAnalyzeResponse(data);
          if (acres != null) setPlotAreaAcres(acres);
        })
        .catch(() => {
          /* keep profile/boundary acres */
        });
    }

    try {
      let latN: number | null = null;
      let lonN: number | null = null;
      const loc = selectedPlot?.coordinates?.location?.coordinates;
      if (Array.isArray(loc) && loc.length >= 2) {
        lonN = Number(loc[0]);
        latN = Number(loc[1]);
      } else {
        const plotAny = selectedPlot as {
          coordinates?: { boundary?: { coordinates?: number[][][] } };
          boundary?: { coordinates?: number[][][] };
        };
        const ring =
          plotAny.coordinates?.boundary?.coordinates?.[0] ||
          plotAny.boundary?.coordinates?.[0];
        if (Array.isArray(ring) && ring.length >= 3) {
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (const pt of ring) {
            if (!Array.isArray(pt) || pt.length < 2) continue;
            sx += Number(pt[0]);
            sy += Number(pt[1]);
            n += 1;
          }
          if (n > 0) {
            lonN = sx / n;
            latN = sy / n;
          }
        }
      }
      if (
        latN != null &&
        lonN != null &&
        Number.isFinite(latN) &&
        Number.isFinite(lonN)
      ) {
        setPlotCoords({ lat: latN, lon: lonN });
        void fetchCurrentRainfall(latN, lonN);
      } else {
        setPlotCoords(null);
      }
    } catch {
      setPlotCoords(null);
    }

    return () => {
      cancelled = true;
    };
  }, [profile, profileLoading, selectedPlotName]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    try {
      if (!profile || !selectedPlotName) return;
      let selectedPlot = profile.plots?.find(
        (p: any) =>
          p.fastapi_plot_id === selectedPlotName ||
          `${p.gat_number}_${p.plot_number}` === selectedPlotName,
      );
      if (!selectedPlot && profile.plots?.length) selectedPlot = profile.plots[0];
      const coords = selectedPlot?.coordinates?.location?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const [lon, lat] = coords;
        interval = setInterval(() => {
          void fetchCurrentRainfall(lat, lon);
        }, 3600 * 1000);
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [profile, selectedPlotName]);

  useEffect(() => {
    if (!plotName) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rainPromise = plotCoords
          ? Promise.all([
              fetchPastDailyRainfall(plotCoords.lat, plotCoords.lon, 7).catch(
                () => new Map<string, number>(),
              ),
              fetchForecastRainfall(plotCoords.lat, plotCoords.lon),
            ]).then(([past, forecast]) => {
              const merged = new Map(past);
              for (const [k, v] of forecast) {
                if (!merged.has(k) || (merged.get(k) === 0 && v > 0)) {
                  merged.set(k, v);
                }
              }
              return merged;
            })
          : Promise.resolve(new Map<string, number>());

        // Rain + irrigation events only.
        // water-remain MUST come from SoilMoistureCard (one plantation→today URL).
        const [rainMap, eventDates] = await Promise.all([
          rainPromise,
          fetchIrrigationEventDates(plotName),
        ]);
        if (cancelled) return;

        setRainByDate(new Map(rainMap));
        setIrrigationEventDates(eventDates);

        const shared = Array.isArray(appState.waterRemainSeries)
          ? (appState.waterRemainSeries as WaterRemainDay[])
          : [];
        if (shared.length >= 7 && plotsMatch(appState.waterRemainPlot, plotName)) {
          const todayStr = todayIsoInTz();
          const last7 = filterPastDays(shared, 7);
          setRemainDays(
            mapWaterRemainToScheduleDays(last7, rainMap, todayStr, rainfallMm),
          );
          if (last7.length) {
            const latestEt = last7[last7.length - 1].eto_sum_mm;
            if (latestEt > 0) setEtValue(latestEt);
          }
        }
      } catch {
        if (cancelled) return;
        setRemainDays([]);
        setIrrigationEventDates(new Set());
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    plotName,
    plotCoords,
    rainfallMm,
    appState.waterRemainSeries,
    appState.waterRemainPlot,
  ]);

  // When Soil Moisture finishes the single water-remain fetch, fill the 7-day table.
  useEffect(() => {
    const shared = Array.isArray(appState.waterRemainSeries)
      ? (appState.waterRemainSeries as WaterRemainDay[])
      : [];
    if (!plotName || shared.length < 7) return;
    if (!plotsMatch(appState.waterRemainPlot, plotName)) return;

    const todayStr = todayIsoInTz();
    const last7 = filterPastDays(shared, 7);
    setRemainDays(
      mapWaterRemainToScheduleDays(last7, rainByDate, todayStr, rainfallMm),
    );
    if (last7.length) {
      const latestEt = last7[last7.length - 1].eto_sum_mm;
      if (latestEt > 0) setEtValue(latestEt);
    }
  }, [
    appState.waterRemainSeries,
    appState.waterRemainPlot,
    plotName,
    rainByDate,
    rainfallMm,
  ]);

  const generateScheduleData = () => {
    const scheduleData: Array<any> = [];
    const todayStr = todayIsoInTz();

    // Always show 7 IST calendar days ending today. Older dates are excluded.
    const byDate = new Map(remainDays.map((d) => [d.day, d]));
    const sourceDays: ScheduleDay[] = [];
    for (let idx = 6; idx >= 0; idx -= 1) {
      const key = istDayOffset(idx);
      const hist = byDate.get(key);
      sourceDays.push(
        hist ?? {
          day: key,
          etoSumMm: key === todayStr ? etValue : 0,
          etoLossLiters: 0,
          oneMmLiters: undefined,
          waterRemainLiters: 0,
          waterRemainM3: 0,
          waterVolumeLiters: 0,
          rainfall: key === todayStr ? rainfallMm : 0,
        },
      );
    }

    for (let i = 0; i < sourceDays.length; i += 1) {
      const hist = sourceDays[i];
      const prev = i > 0 ? sourceDays[i - 1] : null;
      const date = new Date(hist.day + "T12:00:00");
      const isToday = hist.day === todayStr;
      const hasRemainSeries = byDate.has(hist.day);
      const etMm = hasRemainSeries
        ? hist.etoSumMm > 0
          ? hist.etoSumMm
          : isToday
            ? etValue
            : 0
        : isToday
          ? etValue
          : 0;
      const rainMm =
        hist.rainfall > 0
          ? hist.rainfall
          : isToday
            ? rainfallMm
            : hist.rainfall;

      // Need (KL) from water-remain API — same value shown in the Need column
      const irrigKl = hasRemainSeries
        ? irrigationNeededKlFromRemain(
            hist.waterRemainLiters,
            hist.waterRemainM3,
          )
        : 0;
      const lossKl = hasRemainSeries ? etoLossKl(hist.etoLossLiters) : 0;

      const irrigatedLiters = hasRemainSeries
        ? irrigatedLitersFromBalance(
            { ...hist, rainfall: rainMm },
            prev && byDate.has(prev.day) ? prev : null,
          )
        : 0;
      const givenFromEvents = irrigationEventDates.has(hist.day);
      const givenFromVolume = irrigatedLiters > 0;
      const irrigationGiven = givenFromEvents || givenFromVolume;

      // Hours for applied irrigation (Given) and required irrigation (Not Given).
      const requiredLiters = irrigKl > 0 ? irrigKl * 1000 : 0;
      const givenLitersForHours = Math.max(
        irrigatedLiters,
        irrigationGiven
          ? requiredLiters > 0
            ? requiredLiters
            : Math.max(0, Number(hist.etoLossLiters) || 0)
          : 0,
      );
      const requiredHours =
        requiredLiters > 0
          ? (calcIrrigationHours(requiredLiters, irrigationSystem) ??
            fallbackIrrigationHours(requiredLiters, hist.oneMmLiters))
          : null;
      let irrigationHours =
        calcIrrigationHours(givenLitersForHours, irrigationSystem) ??
        fallbackIrrigationHours(givenLitersForHours, hist.oneMmLiters);

      if (irrigationGiven && (irrigationHours == null || irrigationHours <= 0)) {
        irrigationHours = 0;
      }

      // Hours: Motor HP × profile/map acres (do NOT use one_mm area — that was ~1.56 vs map 1.41)
      const areaForHours =
        plotAreaAcres != null && plotAreaAcres > 0
          ? plotAreaAcres
          : resolveAreaAcres(null, hist.oneMmLiters);
      const pumpMinutes = calcPumpDurationMinutes(
        irrigKl,
        irrigationSystem.motorHp,
        areaForHours,
      );

      scheduleData.push({
        date: date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        isoDate: hist.day,
        isToday,
        etDisplayed: Number(etMm.toFixed(1)),
        etRange: getETRange(etMm),
        etoLossLiters: hasRemainSeries ? hist.etoLossLiters : 0,
        etoLossKl: lossKl,
        irrigationNeedKl: irrigKl,
        waterRemainLiters: hasRemainSeries ? hist.waterRemainLiters : 0,
        waterRemainM3: hasRemainSeries ? hist.waterRemainM3 : 0,
        rainfall: rainMm,
        dataMissing: !hasRemainSeries,
        irrigatedLiters,
        irrigationGiven,
        irrigationHours,
        requiredHours,
        pumpMinutes,
        waterRequiredKl: irrigKl,
      });
    }

    return scheduleData;
  };

  const scheduleData = generateScheduleData();
  const dateRangeLabel =
    scheduleData.length >= 2
      ? formatIrrigationDateRange(
          scheduleData[0].isoDate,
          scheduleData[scheduleData.length - 1].isoDate,
        )
      : scheduleData.length === 1
        ? formatIrrigationDateRange(
            scheduleData[0].isoDate,
            scheduleData[0].isoDate,
          )
        : "";
  const todayRow = scheduleData.find((d) => d.isToday);
  const todayGiven = Boolean(todayRow?.irrigationGiven);
  const todayNeedKl = Number(todayRow?.irrigationNeedKl) || 0;
  const waterRequirementMessage = todayGiven
    ? "Water requirement fulfilled — irrigation has been provided as required."
    : todayNeedKl > 0.05
      ? "Water requirement pending — irrigation is still required."
      : "Water requirement fulfilled — no irrigation needed today.";

  useEffect(() => {
    const data = generateScheduleData();
    if (data.length > 0) {
      setAppState((prev: any) => ({
        ...prev,
        irrigationScheduleData: data,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    etValue,
    rainfallMm,
    remainDays,
    irrigationEventDates,
    irrigationSystem,
    plotAreaAcres,
    setAppState,
  ]);

  const renderIrrigationStatus = (day: any) => {
    if (loading) return <div className="loading-spinner-small" />;

    if (day.irrigationGiven) {
      const givenKl =
        Number(day.irrigatedLiters) > 0
          ? Number(day.irrigatedLiters) / 1000
          : Number(day.irrigationNeedKl) > 0
            ? Number(day.irrigationNeedKl)
            : 0;
      return (
        <div className="irrigation-schedule-status-block">
          <div className="irrigation-status-title irrigation-status-title--given">
            Irrigation Given
          </div>
          <div className="irrigation-status-detail irrigation-status-detail--given">
            Water given: {givenKl > 0 ? givenKl.toFixed(1) : "—"}
          </div>
        </div>
      );
    }

    const needKl = Number(day.waterRequiredKl ?? day.irrigationNeedKl) || 0;
    const hasNeed = needKl > 0.05;

    return (
      <div className="irrigation-schedule-status-block">
        <div className="irrigation-status-title irrigation-status-title--not-given">
          Irrigation required
        </div>
        {hasNeed ? (
          <div className="irrigation-status-detail">{needKl.toFixed(1)}</div>
        ) : (
          <div className="irrigation-status-detail irrigation-status-detail--secondary">
            {/* No water required */}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="irrigation-schedule-card">
      <div className="irrigation-schedule-card-header">
        <h2>Past 7-Day Irrigation /Acre</h2>
        {dateRangeLabel && <p>{dateRangeLabel}</p>}
      </div>

      <div className="irrigation-schedule-card-body">
        <div className="irrigation-schedule-grid irrigation-schedule-grid--head">
          <span>Date</span>
          <span>ETO (mm)</span>
          <span>Rain</span>
          <span>Need (KL)</span>
          <span>Water given</span>
          <span className="irrigation-schedule-hours-head">Hours</span>
        </div>

        <div className="irrigation-schedule-days">
          {scheduleData.length === 0 && error ? (
            <p className="flex-1 flex items-center justify-center text-[10px] text-red-600 px-2 text-center leading-snug">
              {error}
            </p>
          ) : (
            scheduleData.map((day, idx) => (
              <div
                key={day.isoDate || idx}
                className={[
                  "irrigation-schedule-grid irrigation-schedule-day-card",
                  day.isToday
                    ? "irrigation-schedule-day-card--today"
                    : "irrigation-schedule-day-card--past",
                ].join(" ")}
              >
                <div className="irrigation-schedule-date-cell">
                  <div className="irrigation-schedule-date-row">
                    <span
                      className={`irrigation-schedule-date-text ${
                        day.isToday
                          ? "irrigation-schedule-date--today"
                          : "irrigation-schedule-date--past"
                      }`}
                    >
                      {day.date}
                    </span>
                    <Sun
                      className={`h-2.5 w-2.5 shrink-0 ${
                        day.isToday ? "text-amber-300" : "text-slate-300"
                      }`}
                    />
                  </div>
                  {day.isToday ? (
                    <span className="irrigation-schedule-today-badge">Today</span>
                  ) : null}
                </div>

                <div className="flex flex-col items-start justify-center min-w-0 leading-tight">
                  {loading ? (
                    <div className="loading-spinner-small" />
                  ) : (
                    <>
                      <span className="text-[10px] font-semibold whitespace-nowrap">
                        {Number(day.etDisplayed || 0).toFixed(1)}
                      </span>
                      <span
                        className={`inline-block rounded px-1 text-[9px] font-medium leading-none ${getETRangeColor(day.etRange)}`}
                      >
                        {day.etRange}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-0.5 font-semibold text-sky-700 whitespace-nowrap text-[10px]">
                  <CloudRain className="h-2.5 w-2.5 shrink-0 text-sky-600" />
                  {Number(day.rainfall || 0).toFixed(1)}
                </div>

                <div
                  className={`irrigation-schedule-need ${
                    (day.irrigationNeedKl ?? 0) >= 0.05
                      ? "irrigation-schedule-need--active"
                      : "irrigation-schedule-need--zero"
                  }`}
                >
                  {(Number(day.irrigationNeedKl) || 0).toFixed(1)}
                </div>

                <div className="irrigation-schedule-status min-w-0">
                  {renderIrrigationStatus(day)}
                </div>

                <div
                  className="irrigation-schedule-hours"
                  title={
                    !day.isToday
                      ? "Hours shown for today only"
                      : day.pumpMinutes != null && day.pumpMinutes > 0
                        ? `Need ${Number(day.irrigationNeedKl || 0).toFixed(1)} KL → ${(Number(day.pumpMinutes) / 60).toFixed(3)} h · Motor HP ${
                            irrigationSystem.motorHp != null &&
                            irrigationSystem.motorHp > 0
                              ? irrigationSystem.motorHp
                              : `${DEFAULT_MOTOR_HP} (default)`
                          } · Area ${
                            plotAreaAcres != null && plotAreaAcres > 0
                              ? plotAreaAcres
                              : "?"
                          } acre · (Water L / ((MotorHP×7000)×Area))×60`
                        : "No irrigation needed"
                  }
                >
                  {!day.isToday ? (
                    <span className="text-slate-300">—</span>
                  ) : loading ? (
                    <div className="loading-spinner-small" />
                  ) : (
                    formatPumpHours(
                      day.pumpMinutes == null
                        ? null
                        : Number(day.pumpMinutes),
                    )
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 7-Day Total — keep row; hide numeric totals */}
        {scheduleData.length > 0 && (
          <div className="irrigation-schedule-grid irrigation-schedule-grid--total irrigation-schedule-grid--total-blue">
            <span className="text-blue-900">7-Day Total</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span
              className={`irrigation-schedule-status irrigation-schedule-total-msg ${
                todayGiven ? "text-emerald-800" : "text-blue-900"
              }`}
            >
              {waterRequirementMessage}
            </span>
            <span aria-hidden="true" />
          </div>
        )}
      </div>

      {error && scheduleData.length > 0 && (
        <div className="error-message-small px-2 pb-2">{error}</div>
      )}
    </div>
  );
};

export default IrrigationSchedule;
