/**
 * Water Balance / Soil Moisture card — CropO Flutter logic port:
 * - SoilMoistureApi: GET irrigation-and-soil-moisture/{plot}
 * - WaterBalanceApi: GET water-remain-per-day?plot_name&crop_name&start_date&end_date
 *   (SEF OpenAPI — lat/lon are not accepted on this route)
 * - Irrigation needed kL = remain < 0 ? abs(remainL)/1000 : 0
 * - ETo loss card = eto_loss_liters / 1000 (kL)
 * - Chart: Day = hourly irrigation trend; Week/Month = diverging bars
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, Sun } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";
import {
  fetchSoilMoistureForPlot,
  moistureBandForCrop,
} from "../../../utils/soilMoistureApi";
import {
  fetchWaterRemainForPlot,
  filterDaysInRange,
  formatIrrigationDateRange,
  formatWaterRemainError,
  needKlFromWaterFields,
  pastSameDayLastMonthRange,
  remainKlFromWaterFields,
  waterBalanceStatus,
  type WaterHourStep,
  type WaterRemainDay,
} from "../../../utils/waterRemainApi";

export type SoilMoistureExternalPlot = {
  plotName: string;
  lat: number;
  lon: number;
  cropName?: string;
};

interface SoilMoistureCardProps {
  optimalRange?: [number, number];
  moistGroundPercent?: number | null;
  targetDate?: string;
  compact?: boolean;
  medium?: boolean;
  fullWidth?: boolean;
  /** Agro dashboard / non-farmer views: use plot + coords without useFarmerProfile. */
  externalPlot?: SoilMoistureExternalPlot | null;
}

type TubeDay = {
  day: string;
  shortDate: string;
  soilMoisture: number;
  etoSumMm: number;
  waterRemainLiters: number;
  waterRemainM3: number;
  etoLossLiters: number;
  oneMmLiters?: number;
  rainfallMm: number;
  hourlySteps: WaterHourStep[];
};

type WaterRange = "day" | "week" | "month";

/** Flutter ListView diverging-bar colors */
const SURPLUS_COLOR = "#1565C0";
const DEFICIT_COLOR = "#D32F2F";
const SELECT_DOT = "#29B6F6";

/** Open-Meteo forecast `past_days` max is typically 92. */
const OPEN_METEO_PAST_DAYS_MAX = 92;

/** Calendar month window for Month tab (~same day last month → today). */
const MONTH_CHART_DAYS = 31;

type HourlyTrendPoint = {
  hour: number;
  label: string;
  /** Cumulative ET / water requirement through the day (KL) */
  requirementKl: number;
  remainKl: number;
  /** Instant hour loss (KL) */
  hourRequiredKl: number;
  /** Instant hour ETo (mm) from API */
  hourEtoMm: number;
  isLatest: boolean;
};

/** Compact multi-line labels on selected hour dots only. */
function HourlyPointLabel(props: {
  x?: number | string;
  y?: number | string;
  index?: number;
  payload?: HourlyTrendPoint;
}) {
  const { x, y, payload } = props;
  if (payload == null || x == null || y == null) return null;
  // Keep chart readable: label every 3rd hour + latest.
  if (payload.hour % 3 !== 0 && !payload.isLatest) return null;

  const cx = Number(x);
  const cy = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  return (
    <g transform={`translate(${cx},${cy - 10})`} style={{ pointerEvents: "none" }}>
      <text
        textAnchor="middle"
        fill="#0f172a"
        fontSize={8.5}
        fontWeight={800}
        dy={-18}
      >
        {payload.label}
      </text>
      <text
        textAnchor="middle"
        fill="#0f172a"
        fontSize={8}
        fontWeight={700}
        dy={-8}
      >
        {payload.remainKl.toFixed(1)} KL
      </text>
      <text
        textAnchor="middle"
        fill="#334155"
        fontSize={7.5}
        fontWeight={650}
        dy={2}
      >
        ETo {payload.hourEtoMm.toFixed(2)} mm
      </text>
    </g>
  );
}

function parsePrecipMm(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

async function fetchPastDailyRainfall(
  lat: number,
  lon: number,
  daysBack = 7,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    past_days: String(Math.min(Math.max(1, daysBack), OPEN_METEO_PAST_DAYS_MAX)),
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

function shortDateLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10) || iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Flutter: ETo loss card = eto_loss_liters / 1000 kL. */
function etoLossKl(etoLossLiters: number): number {
  return Math.max(0, Number(etoLossLiters) || 0) / 1000;
}

/**
 * Water remain in KL — always from water-remain API fields only:
 *   prefer water_remain_liters / 1000  (source of truth)
 *   else water_remain_m3 (1 m³ = 1 KL)
 * Do NOT invent remain from ETo / volume / chart math.
 * Week/Yearly used to prefer m³; that showed wrong KL when API m³ drifted.
 */
const remainKlFromApi = remainKlFromWaterFields;

const irrigationNeededKlFromApi = needKlFromWaterFields;

function buildTubesFromWaterRemain(
  days: WaterRemainDay[],
  moistureByDate: Map<string, number>,
  fallbackMoisture: number,
  rainByDate: Map<string, number>,
  range: { start_date: string; end_date: string },
): TubeDay[] {
  return filterDaysInRange(days, range.start_date, range.end_date).map((d) => ({
    day: d.date,
    shortDate: shortDateLabel(d.date),
    soilMoisture: moistureByDate.get(d.date) ?? fallbackMoisture,
    etoSumMm: d.eto_sum_mm,
    waterRemainLiters: d.water_remain_liters,
    waterRemainM3: d.water_remain_m3,
    etoLossLiters: d.eto_loss_liters,
    oneMmLiters: d.one_mm_liters,
    rainfallMm: rainByDate.get(d.date) ?? 0,
    hourlySteps: d.hourly_steps ?? [],
  }));
}

function sliceForRange(days: TubeDay[], range: WaterRange): TubeDay[] {
  if (!days.length) return [];
  if (range === "day") return days.slice(-1);
  if (range === "week") return days.length > 7 ? days.slice(-7) : days;
  // month
  return days.length > MONTH_CHART_DAYS
    ? days.slice(-MONTH_CHART_DAYS)
    : days;
}

const SoilMoistureCard: React.FC<SoilMoistureCardProps> = ({
  optimalRange,
  compact = false,
  medium = false,
  fullWidth = false,
  externalPlot = null,
}) => {
  const { setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();

  const [tubeDays, setTubeDays] = useState<TubeDay[]>([]);
  const [selDay, setSelDay] = useState<number>(-1);
  const [waterRange, setWaterRange] = useState<WaterRange>("day");
  const [loading, setLoading] = useState<boolean>(true);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [yearlyLoaded, setYearlyLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState<string>("");
  const [plotCoords, setPlotCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [cropName, setCropName] = useState<string>("sugarcane");
  /** True after profile/external plot meta (crop) is resolved. */
  const [plotMetaReady, setPlotMetaReady] = useState(false);
  const chartScrollRef = useRef<HTMLDivElement | null>(null);

  const band = useMemo(() => {
    if (optimalRange) {
      return {
        minOptimal: optimalRange[0],
        maxOptimal: optimalRange[1],
      };
    }
    return moistureBandForCrop(cropName);
  }, [optimalRange, cropName]);

  useEffect(() => {
    if (externalPlot?.plotName?.trim()) {
      const name = String(externalPlot.plotName).trim().replace(/^"|"$/g, "");
      setPlotName(name);
      setPlotCoords({
        lat: externalPlot.lat,
        lon: externalPlot.lon,
      });
      setCropName(externalPlot.cropName?.trim() || "sugarcane");
      setPlotMetaReady(true);
      return;
    }

    if (!profile || profileLoading) {
      setPlotMetaReady(false);
      return;
    }

    let plotToUse = "";
    let coords: { lat: number; lon: number } | null = null;
    let crop = "sugarcane";

    let selectedPlot: any = null;
    if (selectedPlotName) {
      selectedPlot = profile.plots?.find(
        (plot: any) =>
          plot.fastapi_plot_id === selectedPlotName ||
          `${plot.gat_number}_${plot.plot_number}` === selectedPlotName ||
          `${plot.gat_number}/${plot.plot_number}` === selectedPlotName,
      );
    }
    if (!selectedPlot && profile.plots?.length) {
      selectedPlot = profile.plots[0];
    }

    if (selectedPlot) {
      const fastapi = selectedPlot.fastapi_plot_id
        ? String(selectedPlot.fastapi_plot_id).trim()
        : "";
      const gat = selectedPlot.gat_number != null
        ? String(selectedPlot.gat_number).trim()
        : "";
      const num = selectedPlot.plot_number != null
        ? String(selectedPlot.plot_number).trim()
        : "";
      // Prefer underscore for pure-numeric gat/plot (SEF: 305_503 OK).
      // Prefer slash when plot has a letter suffix (SEF: 472/1B OK).
      const pureNumeric =
        Boolean(gat) &&
        Boolean(num) &&
        /^\d+$/.test(gat) &&
        /^\d+$/.test(num);
      const letterSuffix =
        Boolean(gat) &&
        Boolean(num) &&
        /[a-zA-Z]/.test(`${gat}${num}`);
      plotToUse =
        (pureNumeric ? `${gat}_${num}` : "") ||
        (letterSuffix ? `${gat}/${num}` : "") ||
        fastapi ||
        (gat && num ? `${gat}_${num}` : "") ||
        "";

      const loc = selectedPlot?.coordinates?.location?.coordinates;
      if (Array.isArray(loc) && loc.length >= 2) {
        const lon = Number(loc[0]);
        const lat = Number(loc[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          coords = { lat, lon };
        }
      } else {
        // Flutter: centroid of polygon when point missing
        const ring =
          selectedPlot?.coordinates?.boundary?.coordinates?.[0] ||
          selectedPlot?.boundary?.coordinates?.[0];
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
          if (n > 0) coords = { lat: sy / n, lon: sx / n };
        }
      }

      const cropRaw =
        selectedPlot?.crop_variety ??
        selectedPlot?.crop_type?.crop_variety ??
        selectedPlot?.farms?.[0]?.crop_variety ??
        selectedPlot?.farms?.[0]?.crop_type?.crop_variety ??
        profile?.agricultural_summary?.crop_types?.[0] ??
        "sugarcane";
      if (cropRaw) crop = String(cropRaw);
    }

    if (plotToUse && plotToUse !== plotName) setPlotName(plotToUse);
    setPlotCoords(coords);
    setCropName(crop);
    setPlotMetaReady(Boolean(plotToUse));
  }, [profile, profileLoading, selectedPlotName, plotName, externalPlot]);

  // Keep latest coords without re-triggering a full reload when moisture fills them in.
  const plotCoordsRef = useRef(plotCoords);
  plotCoordsRef.current = plotCoords;
  const loadedPlotRef = useRef<string>("");

  // Month API window: same calendar day last month → today (e.g. 19 Aug → 18 Sep).
  // Matches Month tab subtitle; SEF OpenAPI default is also ~1 calendar month.
  const chartRange = useMemo(() => pastSameDayLastMonthRange(), []);

  useEffect(() => {
    // Wait until plot + crop are resolved, then fetch the 1-month water-remain series.
    if (!plotName || !plotMetaReady) return;
    let cancelled = false;

    const applyTubeDays = (
      waterParsed: { days: WaterRemainDay[]; plotName: string },
      range: { start_date: string; end_date: string },
      moistureByDate: Map<string, number>,
      currentMoisture: number,
      rainByDate: Map<string, number>,
    ) => {
      const days = buildTubesFromWaterRemain(
        waterParsed.days,
        moistureByDate,
        currentMoisture,
        rainByDate,
        range,
      );
      if (!days.length) return false;
      setTubeDays(days);
      setSelDay(days.length - 1);
      return true;
    };

    const publishWaterSeries = (
      waterParsed: { days: WaterRemainDay[]; plotName: string },
      range: { start_date: string; end_date: string },
    ) => {
      setAppState((prev: any) => ({
        ...prev,
        waterRemainSeries: filterDaysInRange(
          waterParsed.days,
          range.start_date,
          range.end_date,
        ),
        waterRemainPlot: waterParsed.plotName,
      }));
    };

    const load = async () => {
      const isNewPlot = loadedPlotRef.current !== plotName;
      if (isNewPlot) {
        setLoading(true);
        setTubeDays([]);
        setSelDay(-1);
        setYearlyLoaded(false);
        setError(null);
      }
      setChartLoading(true);

      const monthRange = chartRange;
      const rainDaysBack = Math.max(
        7,
        Math.ceil(
          (new Date(`${monthRange.end_date}T12:00:00`).getTime() -
            new Date(`${monthRange.start_date}T12:00:00`).getTime()) /
            86400000,
        ) + 1,
      );

      const coords = plotCoordsRef.current;
      const waterExtras: { cropName: string; allowShortRange: boolean } = {
        cropName: cropName || "sugarcane",
        allowShortRange: true,
      };

      try {
        const plotRefs = externalPlot ? null : profile?.plots;
        const [moistureParsed, rainByDate] = await Promise.all([
          fetchSoilMoistureForPlot(plotName, plotRefs).catch(() => null),
          coords
            ? fetchPastDailyRainfall(
                coords.lat,
                coords.lon,
                Math.min(rainDaysBack, 90),
              ).catch(() => new Map<string, number>())
            : Promise.resolve(new Map<string, number>()),
        ]);
        if (cancelled) return;

        const moistureByDate = new Map<string, number>();
        let currentMoisture = 50;
        if (moistureParsed) {
          currentMoisture = moistureParsed.currentMoisture;
          for (const row of moistureParsed.stack) {
            moistureByDate.set(row.day, row.soil_moisture);
            const key = String(row.day).slice(0, 10);
            const rain = Number(row.rainfall_mm_yesterday);
            if (key && Number.isFinite(rain) && rain > 0) {
              rainByDate.set(key, rain);
            }
          }
          setAppState((prev: any) => ({
            ...prev,
            soilMoisture: currentMoisture,
            moistureStatus:
              currentMoisture >= band.minOptimal &&
              currentMoisture <= band.maxOptimal
                ? ""
                : currentMoisture < band.minOptimal
                  ? "Low"
                  : "High",
          }));

          // Prefer API coords when profile has none (do not re-trigger this effect).
          if (
            !plotCoordsRef.current &&
            moistureParsed.latitude != null &&
            moistureParsed.longitude != null
          ) {
            setPlotCoords({
              lat: moistureParsed.latitude,
              lon: moistureParsed.longitude,
            });
          }
        }

        try {
          // SEF GET: plot_name + crop_name + 1-month dates (Month tab window).
          const monthWater = await fetchWaterRemainForPlot(
            plotName,
            plotRefs,
            31,
            monthRange,
            waterExtras,
          );
          if (cancelled) return;

          let monthRain = rainByDate;
          const rainLat = plotCoordsRef.current?.lat ?? moistureParsed?.latitude;
          const rainLon = plotCoordsRef.current?.lon ?? moistureParsed?.longitude;
          if (
            rainLat != null &&
            rainLon != null &&
            rainDaysBack > 90
          ) {
            monthRain = await fetchPastDailyRainfall(
              rainLat,
              rainLon,
              rainDaysBack,
            ).catch(() => rainByDate);
          }
          if (cancelled) return;

          if (monthWater) {
            applyTubeDays(
              monthWater,
              monthRange,
              moistureByDate,
              currentMoisture,
              monthRain,
            );
            publishWaterSeries(monthWater, monthRange);
            setYearlyLoaded(true);
            loadedPlotRef.current = plotName;
            setLoading(false);
          } else {
            setLoading(false);
          }
        } catch (monthErr: any) {
          if (cancelled) return;
          setTubeDays([]);
          setSelDay(-1);
          const msg = formatWaterRemainError(monthErr, plotName);
          if (msg) setError(msg);
          setLoading(false);
        }
      } catch (err: any) {
        if (cancelled) return;
        setTubeDays([]);
        setSelDay(-1);
        const msg = formatWaterRemainError(err, plotName);
        if (msg) setError(msg);
        setLoading(false);
      } finally {
        if (!cancelled) {
          setChartLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    plotName,
    plotMetaReady,
    cropName,
    chartRange.start_date,
    chartRange.end_date,
    setAppState,
    profile?.plots,
    externalPlot,
  ]);

  const visibleDays = useMemo(
    () => sliceForRange(tubeDays, waterRange),
    [tubeDays, waterRange],
  );

  // Flutter: _selDay is always an index into the full time series.
  // Week/Day tabs only change which slice is charted; cards stay on that day.
  const visibleBase = useMemo(() => {
    if (!tubeDays.length || !visibleDays.length) return 0;
    return Math.max(0, tubeDays.length - visibleDays.length);
  }, [tubeDays.length, visibleDays.length]);

  useEffect(() => {
    if (!tubeDays.length) {
      setSelDay(-1);
      return;
    }
    setSelDay((prev) => {
      if (prev < 0 || prev >= tubeDays.length) {
        return tubeDays.length - 1;
      }
      // Day chart = hourly for *today* (latest API day). Do not keep an old
      // index after yearly load (index 0 became plantation e.g. 16 Feb).
      if (waterRange === "day") {
        return tubeDays.length - 1;
      }
      // If current day is outside the visible Week/Yearly window, snap to last visible.
      if (prev < visibleBase || prev >= visibleBase + visibleDays.length) {
        return visibleBase + visibleDays.length - 1;
      }
      return prev;
    });
  }, [tubeDays, visibleBase, visibleDays.length, waterRange]);

  // Keep ~7 cards in view; scroll so the selected day is among them (usually the latest).
  useEffect(() => {
    const root = chartScrollRef.current;
    if (!root || selDay < 0) return;
    const idx = selDay - visibleBase;
    if (idx < 0) return;
    const el = root.querySelector(
      `[data-day-idx="${idx}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [selDay, visibleBase, visibleDays.length, waterRange]);

  const selected =
    selDay >= 0 && selDay < tubeDays.length ? tubeDays[selDay] : null;

  // Always liters/1000 → KL (same for Day / Week / Yearly). m³ only as fallback.
  const irrigKl = irrigationNeededKlFromApi(
    selected?.waterRemainLiters,
    selected?.waterRemainM3,
  );
  // Flutter ETo loss card: eto_loss_liters / 1000 → KL (API field as-is)
  const etoKl = etoLossKl(selected?.etoLossLiters ?? 0);
  const etoTodayMm = selected?.etoSumMm ?? 0;
  const selectedRemainKl = remainKlFromApi(
    selected?.waterRemainLiters,
    selected?.waterRemainM3,
  );

  const chartH = useMemo(() => {
    if (waterRange === "week") {
      return compact ? 140 : medium ? 150 : 160;
    }
    if (waterRange === "month") {
      return compact ? 150 : medium ? 165 : 175;
    }
    // Day line chart needs room for point labels
    return compact ? 220 : medium ? 250 : 270;
  }, [waterRange, compact, medium]);

  // Status badge uses full series; bar heights use visible window so Week fills space.
  const seriesMaxRemainKl = useMemo(() => {
    let max = 0;
    for (const d of tubeDays) {
      max = Math.max(
        max,
        Math.abs(remainKlFromApi(d.waterRemainLiters, d.waterRemainM3)),
      );
    }
    return max > 0 ? max : 1;
  }, [tubeDays]);

  const visibleMaxRemainKl = useMemo(() => {
    let max = 0;
    for (const d of visibleDays) {
      max = Math.max(
        max,
        Math.abs(remainKlFromApi(d.waterRemainLiters, d.waterRemainM3)),
      );
    }
    return max > 0 ? max : 1;
  }, [visibleDays]);

  /** Week/yearly with only surplus → grow bars from bottom (use full height). */
  const weekFillFromBottom = useMemo(() => {
    if (waterRange === "day" || !visibleDays.length) return false;
    return !visibleDays.some(
      (d) =>
        irrigationNeededKlFromApi(d.waterRemainLiters, d.waterRemainM3) >= 0.05,
    );
  }, [visibleDays, waterRange]);

  /**
   * Day tab — water required only (cumulative ET loss from hourly_steps).
   * Skip leading overnight hours that stay at 0 KL (no useful signal).
   */
  const hourlyTrendPoints = useMemo(() => {
    const steps = selected?.hourlySteps ?? [];
    if (!steps.length) return [] as HourlyTrendPoint[];

    let cumRequirement = 0;

    const all = steps.map((step, index) => {
      const beforeL = Number(step.waterVolumeBeforeLiters) || 0;
      const afterL = Number(step.waterVolumeAfterLiters) || 0;
      const hourLossL = Number(step.hourLossLiters);
      const lossL =
        Number.isFinite(hourLossL) && hourLossL > 0
          ? hourLossL
          : Math.max(0, beforeL - afterL);
      const hourRequiredKl = lossL / 1000;
      cumRequirement += hourRequiredKl;

      const hour =
        step.hour != null && Number.isFinite(step.hour) ? Number(step.hour) : index;

      return {
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        requirementKl: Number(cumRequirement.toFixed(2)),
        remainKl: Number((afterL / 1000).toFixed(2)),
        hourRequiredKl: Number(hourRequiredKl.toFixed(3)),
        hourEtoMm: Number((Number(step.etoMm) || 0).toFixed(3)),
        isLatest: false,
      };
    });

    // Drop flat 0 KL prefix (e.g. 00:00–07:00 before ET starts).
    let start = 0;
    while (
      start < all.length - 1 &&
      all[start].requirementKl < 0.05 &&
      all[start].hourRequiredKl < 0.005
    ) {
      start += 1;
    }

    const trimmed = all.slice(start);
    if (trimmed.length) {
      trimmed[trimmed.length - 1] = {
        ...trimmed[trimmed.length - 1],
        isLatest: true,
      };
    }
    return trimmed;
  }, [selected]);

  const dayNeedsIrrigation = useMemo(
    () =>
      irrigationNeededKlFromApi(
        selected?.waterRemainLiters,
        selected?.waterRemainM3,
      ) >= 0.05,
    [selected],
  );

  const dayChartColors = useMemo(() => {
    if (dayNeedsIrrigation) {
      return {
        required: "#38BDF8",
        grid: "#BAE6FD",
        // Dark readable labels on light-blue chart
        axis: "#0F172A",
        surface: "#F0F9FF",
        border: "#7DD3FC",
      };
    }
    return {
      required: "#4ADE80",
      grid: "#DCFCE7",
      axis: "#0F172A",
      surface: "#F0FDF4",
      border: "#86EFAC",
    };
  }, [dayNeedsIrrigation]);

  const hourlyYDomain = useMemo((): [number, number] => {
    if (!hourlyTrendPoints.length) return [0, 1];
    const dataMax = Math.max(
      ...hourlyTrendPoints.map((p) => p.requirementKl),
      0.1,
    );
    const pad = Math.max(0.25, dataMax * 0.12);
    return [0, dataMax + pad];
  }, [hourlyTrendPoints]);

  const hourlyTicks = useMemo(() => {
    if (!hourlyTrendPoints.length) return [] as number[];
    const hours = hourlyTrendPoints.map((p) => p.hour);
    const first = hours[0];
    const last = hours[hours.length - 1];
    const ticks = hours.filter(
      (h) => h === first || h === last || h % 3 === 0,
    );
    return Array.from(new Set(ticks));
  }, [hourlyTrendPoints]);

  const balanceStatus = waterBalanceStatus(
    selectedRemainKl,
    Math.max(1, seriesMaxRemainKl),
  );

  const dateRangeLabel = useMemo(() => {
    if (!visibleDays.length) {
      return formatIrrigationDateRange(
        chartRange.start_date,
        chartRange.end_date,
      );
    }
    return formatIrrigationDateRange(
      visibleDays[0].day,
      visibleDays[visibleDays.length - 1].day,
    );
  }, [visibleDays, chartRange]);

  const statusBadgeClass =
    balanceStatus.label === "Low"
      ? "water-balance-badge--low"
      : balanceStatus.label === "Moderate"
        ? "water-balance-badge--moderated"
        : "water-balance-badge--high";

  return (
    <div
      className={`irrigation-card ${compact ? "irrigation-card--compact" : ""} ${medium ? "irrigation-card--medium" : ""} ${fullWidth ? "irrigation-card--full" : ""}`}
    >
      <div className="card-header water-balance-card-header">
        <div className="flex items-center gap-2 min-w-0">
          <Droplets className="card-icon shrink-0" size={22} />
          <h3 className="font-semibold truncate">soil moisture</h3>
        </div>
        {!loading && !error && selected && (
          <span
            className={`water-balance-badge ${statusBadgeClass}`}
            style={{ borderColor: balanceStatus.color, color: balanceStatus.color }}
          >
            {balanceStatus.label}
          </span>
        )}
      </div>

      <div className="card-content soil-moisture soil-moisture--diverging">
        {error && <p className="text-xs text-red-500 px-1">{error}</p>}

        {loading && !tubeDays.length ? (
          <p className="text-xs text-gray-400 text-center py-4">
            Loading Soil Moisture 
          </p>
        ) : (
          <>
            {/* Flutter KPI: Irrigation Need = remain < 0 ? abs : 0 (show 0 when surplus) */}
            <div className="water-balance-kpi-row">
              <div
                className="water-balance-kpi water-balance-kpi--irrigation"
                style={{
                  backgroundColor:
                    selectedRemainKl < 0 ? "#FFEBEE" : "#E3F2FD",
                }}
              >
                <div className="water-balance-kpi-label">
                  <Droplets
                    className="h-3.5 w-3.5"
                    style={{
                      color: selectedRemainKl < 0 ? "#D32F2F" : "#0288D1",
                    }}
                  />
                  Irrigation Need
                </div>
                <div
                  className="water-balance-kpi-value"
                  style={{
                    color: selectedRemainKl < 0 ? "#D32F2F" : "#0288D1",
                  }}
                >
                  {irrigKl.toFixed(1)} KL
                </div>
              </div>
              <div className="water-balance-kpi water-balance-kpi--eto">
                <div className="water-balance-kpi-label">
                  <Sun className="h-3.5 w-3.5" />
                  ETo loss
                </div>
                <div className="water-balance-kpi-value">{etoKl.toFixed(1)} KL</div>
              </div>
            </div>

            <p className="water-balance-eto-hint">
              ETo today: {etoTodayMm.toFixed(1)} mm/day
              {dateRangeLabel ? ` · ${dateRangeLabel}` : ""}
              {chartLoading && !yearlyLoaded && (
                <span className="text-gray-400"> · loading month…</span>
              )}
            </p>

            <div className="water-balance-range-tabs">
              {(
                [
                  ["day", "Day"],
                  ["week", "Week"],
                  ["month", "Month"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`water-balance-tab ${waterRange === key ? "is-active" : ""}`}
                  onClick={() => setWaterRange(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {visibleDays.length > 0 ? (
              <>
                {waterRange !== "day" ? (
                  <p className="water-balance-chart-hint water-balance-chart-hint--compact">
                    Tap a day for detail
                  </p>
                ) : null}

                {waterRange === "day" ? (
                  hourlyTrendPoints.length > 0 ? (
                    <div
                      className={`moisture-hourly-chart moisture-irrigation-trend-chart moisture-irrigation-trend-chart--farm moisture-irrigation-trend-chart--pro ${dayNeedsIrrigation ? "is-need" : "is-ok"}`}
                      style={{
                        height: chartH,
                        background: dayChartColors.surface,
                        borderColor: dayChartColors.border,
                      }}
                      aria-label="Water required"
                    >
                      <div className="moisture-irrigation-trend-header">
                        <div>
                          <div
                            className="moisture-irrigation-trend-title"
                            style={{ color: dayChartColors.axis }}
                          >
                            {/* WATER REQUIRED */}
                          </div>
                          <div
                            className="moisture-irrigation-trend-sub"
                            style={{ color: dayChartColors.axis }}
                          >
                            {selected?.shortDate ?? "Day"}
                          </div>
                        </div>
                      </div>

                      <div className="moisture-hourly-chart-plot">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={hourlyTrendPoints}
                            margin={{ top: 36, right: 12, left: 4, bottom: 4 }}
                          >
                            <defs>
                              <linearGradient
                                id="smRequiredFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor={dayChartColors.required}
                                  stopOpacity={0.28}
                                />
                                <stop
                                  offset="100%"
                                  stopColor={dayChartColors.required}
                                  stopOpacity={0.02}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke={dayChartColors.grid}
                              strokeDasharray="4 4"
                              vertical={false}
                            />
                            <XAxis
                              type="number"
                              dataKey="hour"
                              domain={[
                                hourlyTrendPoints[0]?.hour ?? 0,
                                hourlyTrendPoints[
                                  hourlyTrendPoints.length - 1
                                ]?.hour ?? 23,
                              ]}
                              ticks={hourlyTicks}
                              tickFormatter={(v) =>
                                `${String(Number(v)).padStart(2, "0")}:00`
                              }
                              tick={{ fontSize: 11, fill: dayChartColors.axis }}
                              tickLine={false}
                              axisLine={{ stroke: dayChartColors.border }}
                            />
                            <YAxis
                              orientation="left"
                              tick={{ fontSize: 11, fill: dayChartColors.axis }}
                              tickFormatter={(v) =>
                                `${Number(v).toFixed(1)} KL`
                              }
                              width={54}
                              tickLine={false}
                              axisLine={{ stroke: dayChartColors.border }}
                              domain={hourlyYDomain}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const row = payload[0]?.payload as
                                  | HourlyTrendPoint
                                  | undefined;
                                if (!row) return null;
                                return (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      borderRadius: 8,
                                      border: `1px solid ${dayChartColors.border}`,
                                      background: "#FFFFFF",
                                      color: dayChartColors.axis,
                                      padding: "8px 10px",
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                                      {row.label}
                                    </div>
                                    <div>
                                      Water remain:{" "}
                                      <b>{row.remainKl.toFixed(2)} KL</b>
                                    </div>
                                    <div>
                                      ETo loss:{" "}
                                      <b>{row.hourEtoMm.toFixed(2)} mm</b>
                                      {" · "}
                                      <b>{row.hourRequiredKl.toFixed(2)} KL</b>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="requirementKl"
                              stroke="none"
                              fill="url(#smRequiredFill)"
                              tooltipType="none"
                              legendType="none"
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="requirementKl"
                              name="Water required"
                              stroke={dayChartColors.required}
                              strokeWidth={2.75}
                              dot={{
                                r: 3.5,
                                fill: dayChartColors.required,
                                stroke: "#fff",
                                strokeWidth: 1.5,
                              }}
                              activeDot={{
                                r: 5.5,
                                fill: dayChartColors.required,
                                stroke: "#fff",
                                strokeWidth: 2,
                              }}
                              isAnimationActive={false}
                            >
                              <LabelList
                                dataKey="requirementKl"
                                content={<HourlyPointLabel />}
                              />
                            </Line>
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="moisture-irrigation-trend-legend">
                        <span>
                          <i style={{ backgroundColor: dayChartColors.required }} />{" "}
                        {/* Water required */}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-6">
                      No water data for this day
                    </p>
                  )
                ) : (
                <div
                  ref={chartScrollRef}
                  className={`moisture-diverging-scroll moisture-diverging-scroll--flutter ${weekFillFromBottom ? "moisture-diverging-scroll--fill-bottom" : ""} ${waterRange === "month" ? "moisture-diverging-scroll--month" : ""} ${medium ? "moisture-diverging-scroll--medium" : ""} ${fullWidth ? "moisture-diverging-scroll--full" : ""} ${compact ? "moisture-diverging-scroll--compact" : ""}`}
                  style={{ height: chartH }}
                  data-range={waterRange}
                  role="list"
                  aria-label="Water remain by day"
                >
                  {visibleDays.map((day, i) => {
                    const fullIdx = visibleBase + i;
                    const isSel = fullIdx === selDay;
                    const rKl = remainKlFromApi(
                      day.waterRemainLiters,
                      day.waterRemainM3,
                    );
                    const needKl = irrigationNeededKlFromApi(
                      day.waterRemainLiters,
                      day.waterRemainM3,
                    );
                    const isDeficit = needKl >= 0.05;
                    const isSurplus = rKl >= 0.05;
                    const frac =
                      isDeficit || isSurplus
                        ? Math.min(
                            1,
                            Math.max(0, Math.abs(rKl) / visibleMaxRemainKl),
                          )
                        : 0;
                    const barColor = isDeficit ? DEFICIT_COLOR : SURPLUS_COLOR;
                    // Surplus-only week: use almost full track height. Mixed: half above/below zero.
                    const heightCss = weekFillFromBottom
                      ? `max(8px, calc(${frac} * 78%))`
                      : `max(8px, calc(${frac} * 40%))`;

                    return (
                      <button
                        key={day.day || i}
                        type="button"
                        role="listitem"
                        data-day-idx={i}
                        className="moisture-diverging-day moisture-diverging-day--flutter"
                        style={{
                          backgroundColor: isSel
                            ? `${barColor}1A`
                            : "transparent",
                          borderColor: isSel ? `${barColor}73` : "transparent",
                          height: "100%",
                        }}
                        onClick={() => setSelDay(fullIdx)}
                        title={`${day.shortDate}: ${rKl.toFixed(1)} KL remain · need ${needKl.toFixed(1)} KL`}
                      >
                        {isSel ? (
                          <span
                            className="moisture-diverging-dot"
                            style={{ backgroundColor: SELECT_DOT }}
                          />
                        ) : (
                          <span className="moisture-diverging-dot-spacer" />
                        )}

                        <div
                          className={`moisture-diverging-track ${
                            weekFillFromBottom
                              ? "moisture-diverging-track--fill"
                              : ""
                          }`}
                        >
                          {!weekFillFromBottom && (
                            <div className="moisture-diverging-baseline" />
                          )}
                          {frac > 0 ? (
                            <div
                              className={`moisture-diverging-bar ${
                                weekFillFromBottom
                                  ? "is-absolute"
                                  : isDeficit
                                    ? "is-deficit"
                                    : "is-surplus"
                              }`}
                              style={{
                                backgroundColor: barColor,
                                height: heightCss,
                              }}
                            />
                          ) : (
                            <span className="moisture-diverging-zero">0</span>
                          )}
                        </div>

                        <span
                          className="moisture-diverging-label"
                          style={{
                            color: isSel ? barColor : "#64748b",
                            fontWeight: isSel ? 800 : 600,
                          }}
                        >
                          {day.shortDate}
                        </span>
                      </button>
                    );
                  })}
                </div>
                )}

                <div className="moisture-diverging-legend">
                  {waterRange === "day" ? null : (
                    <>
                      <span>
                        <i style={{ backgroundColor: SURPLUS_COLOR }} /> Remain
                      </span>
                      <span>
                        <i style={{ backgroundColor: DEFICIT_COLOR }} /> Deficit
                      </span>
                    </>
                  )}
                </div>

                {/* Flutter selected-day footer: date · water remain · ETo mm */}
                {selected && (
                  <div className="water-balance-day-footer">
                    <span className="water-balance-day-footer-date">
                      {selected.shortDate}
                    </span>
                    <span className="water-balance-day-footer-right">
                      <Droplets
                        className="h-3 w-3 shrink-0"
                        style={{
                          color: selectedRemainKl < 0 ? "#D32F2F" : "#0288D1",
                        }}
                      />
                      <span
                        style={{
                          color: selectedRemainKl < 0 ? "#D32F2F" : "#0288D1",
                          fontWeight: 700,
                        }}
                      >
                        {Math.abs(selectedRemainKl).toFixed(1)} KL
                        remain
                      </span>
                      <span className="water-balance-day-footer-eto">
                        ETo {Number(selected.etoSumMm || 0).toFixed(1)} mm
                      </span>
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-400 text-center py-4">
                No water-remain series for this plot
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SoilMoistureCard;
