/**
 * Water Balance / Soil Moisture card — CropO Flutter logic port:
 * - SoilMoistureApi: GET irrigation-and-soil-moisture/{plot}
 * - WaterBalanceApi: GET water-remain-per-day?plot_name&crop_name&lat&lon&dates
 * - Irrigation needed kL = remain < 0 ? abs(remainL)/1000 : 0
 * - ETo loss card = eto_loss_liters / 1000 (kL)
 * - Chart: Flutter diverging remain bars (blue ↑ surplus / red ↓ deficit)
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, Sun } from "lucide-react";
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
  pastRange,
  waterBalanceStatus,
  type WaterRemainDay,
} from "../../../utils/waterRemainApi";

interface SoilMoistureCardProps {
  optimalRange?: [number, number];
  moistGroundPercent?: number | null;
  targetDate?: string;
  compact?: boolean;
  medium?: boolean;
  fullWidth?: boolean;
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
};

type WaterRange = "day" | "week" | "month";

/** Flutter ListView diverging-bar colors */
const SURPLUS_COLOR = "#1565C0";
const DEFICIT_COLOR = "#D32F2F";
const SELECT_DOT = "#29B6F6";

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

function shortDateLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10) || iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Flutter: irrigation needed kL only when remain is deficit. */
function irrigationNeededKl(remainLiters: number): number {
  if (!(remainLiters < 0)) return 0;
  return Math.abs(remainLiters) / 1000;
}

/** Flutter: ETo loss card = eto_loss_liters / 1000 kL. */
function etoLossKl(etoLossLiters: number): number {
  return Math.max(0, Number(etoLossLiters) || 0) / 1000;
}

function remainKl(remainLiters: number): number {
  return (Number(remainLiters) || 0) / 1000;
}

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
  }));
}

function sliceForRange(days: TubeDay[], range: WaterRange): TubeDay[] {
  if (!days.length) return [];
  if (range === "day") return days.slice(-1);
  if (range === "week") return days.length > 7 ? days.slice(-7) : days;
  return days;
}

const SoilMoistureCard: React.FC<SoilMoistureCardProps> = ({
  optimalRange,
  compact = false,
  medium = false,
  fullWidth = false,
}) => {
  const { setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();

  const [apiMoisture, setApiMoisture] = useState<number | null>(null);
  const [tubeDays, setTubeDays] = useState<TubeDay[]>([]);
  const [selDay, setSelDay] = useState<number>(-1);
  const [waterRange, setWaterRange] = useState<WaterRange>("week");
  const [loading, setLoading] = useState<boolean>(true);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [monthLoaded, setMonthLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState<string>("");
  const [plotCoords, setPlotCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [cropName, setCropName] = useState<string>("sugarcane");
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
    if (!profile || profileLoading) return;

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
      plotToUse =
        selectedPlot.fastapi_plot_id ||
        `${selectedPlot.gat_number}_${selectedPlot.plot_number}` ||
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
        profile?.crop_variety ??
        "sugarcane";
      if (cropRaw) crop = String(cropRaw);
    }

    if (plotToUse && plotToUse !== plotName) setPlotName(plotToUse);
    setPlotCoords(coords);
    setCropName(crop);
  }, [profile, profileLoading, selectedPlotName, plotName]);

  // Flutter WaterBalanceApi: last 30 days ending today (NOT same-day-last-month).
  // Cumulative water_remain_liters depends on start_date — wrong window ⇒ wrong Aug values.
  const chartRange = useMemo(() => pastRange(30), []);

  useEffect(() => {
    if (!plotName) return;
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
      const latestMoisture = days[days.length - 1].soilMoisture;
      setApiMoisture(parseFloat(Number(latestMoisture).toFixed(2)));
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
      setLoading(true);
      setChartLoading(true);
      setMonthLoaded(false);
      setError(null);
      setTubeDays([]);
      setSelDay(-1);

      const quickRange = pastRange(7);
      const monthRange = chartRange;
      const rainDaysBack = Math.max(
        7,
        Math.ceil(
          (new Date(`${monthRange.end_date}T12:00:00`).getTime() -
            new Date(`${monthRange.start_date}T12:00:00`).getTime()) /
            86400000,
        ) + 1,
      );

      // Flutter WaterBalanceApi: crop + field centroid + date window
      const waterExtras = {
        cropName: cropName || "sugarcane",
        lat: plotCoords?.lat,
        lon: plotCoords?.lon,
      };

      const monthWaterPromise = fetchWaterRemainForPlot(
        plotName,
        profile?.plots,
        30,
        monthRange,
        waterExtras,
      );

      try {
        const [moistureParsed, quickWater, rainByDate] = await Promise.all([
          fetchSoilMoistureForPlot(plotName, profile?.plots).catch(() => null),
          fetchWaterRemainForPlot(
            plotName,
            profile?.plots,
            7,
            quickRange,
            waterExtras,
          ).catch(() => null),
          plotCoords
            ? fetchPastDailyRainfall(plotCoords.lat, plotCoords.lon, 7).catch(
                () => new Map<string, number>(),
              )
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
          setApiMoisture(parseFloat(Number(currentMoisture).toFixed(2)));

          // Prefer API coords when profile has none
          if (
            !plotCoords &&
            moistureParsed.latitude != null &&
            moistureParsed.longitude != null
          ) {
            setPlotCoords({
              lat: moistureParsed.latitude,
              lon: moistureParsed.longitude,
            });
          }
        }

        if (quickWater) {
          applyTubeDays(
            quickWater,
            quickRange,
            moistureByDate,
            currentMoisture,
            rainByDate,
          );
          publishWaterSeries(quickWater, quickRange);
        }

        try {
          const monthWater = await monthWaterPromise;
          if (cancelled) return;

          let monthRain = rainByDate;
          if (plotCoords && rainDaysBack > 7) {
            monthRain = await fetchPastDailyRainfall(
              plotCoords.lat,
              plotCoords.lon,
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
            setMonthLoaded(true);
          }
        } catch (monthErr: any) {
          if (cancelled) return;
          if (!quickWater) {
            setTubeDays([]);
            setSelDay(-1);
            const msg = formatWaterRemainError(monthErr, plotName);
            if (msg) setError(msg);
          } else {
            publishWaterSeries(quickWater, quickRange);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        setTubeDays([]);
        setSelDay(-1);
        const msg = formatWaterRemainError(err, plotName);
        if (msg) setError(msg);
      } finally {
        if (!cancelled) {
          setChartLoading(false);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    plotName,
    plotCoords?.lat,
    plotCoords?.lon,
    cropName,
    chartRange,
    band.minOptimal,
    band.maxOptimal,
    setAppState,
    profile?.plots,
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
      // If current day is outside the visible Day/Week window, snap to last visible (Flutter).
      if (prev < visibleBase || prev >= visibleBase + visibleDays.length) {
        return visibleBase + visibleDays.length - 1;
      }
      return prev;
    });
  }, [tubeDays, visibleBase, visibleDays.length]);

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

  const shownMoisture = selected?.soilMoisture ?? apiMoisture ?? 0;
  const moistureStatus =
    shownMoisture >= band.minOptimal && shownMoisture <= band.maxOptimal
      ? ""
      : shownMoisture < band.minOptimal
        ? "Low"
        : "High";

  const irrigKl = irrigationNeededKl(selected?.waterRemainLiters ?? 0);
  // Flutter ETo loss card: eto_loss_liters / 1000 → kL
  const etoKl = etoLossKl(selected?.etoLossLiters ?? 0);
  const etoTodayMm = selected?.etoSumMm ?? 0;
  const selectedRemainKl = remainKl(selected?.waterRemainLiters ?? 0);

  const chartH = compact ? 180 : medium ? 220 : fullWidth ? 260 : 260;

  // Flutter: maxRemain from full series abs(waterRemainLiters)
  const maxRemainL = useMemo(() => {
    let max = 0;
    for (const d of tubeDays) {
      max = Math.max(max, Math.abs(d.waterRemainLiters));
    }
    return max > 0 ? max : 1;
  }, [tubeDays]);

  const balanceStatus = waterBalanceStatus(
    selectedRemainKl,
    Math.max(1, maxRemainL / 1000),
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
            {/* Flutter KPI row */}
            <div className="water-balance-kpi-row">
              <div
                className="water-balance-kpi water-balance-kpi--irrigation"
                style={{
                  backgroundColor:
                    (selected?.waterRemainLiters ?? 0) < 0
                      ? "#FFEBEE"
                      : "#E3F2FD",
                }}
              >
                <div className="water-balance-kpi-label">
                  <Droplets
                    className="h-3.5 w-3.5"
                    style={{
                      color:
                        (selected?.waterRemainLiters ?? 0) < 0
                          ? "#D32F2F"
                          : "#0288D1",
                    }}
                  />
                  Irrigation needed
                </div>
                <div
                  className="water-balance-kpi-value"
                  style={{
                    color:
                      (selected?.waterRemainLiters ?? 0) < 0
                        ? "#D32F2F"
                        : "#0288D1",
                  }}
                >
                  {irrigKl.toFixed(1)} kL
                </div>
              </div>
              <div className="water-balance-kpi water-balance-kpi--eto">
                <div className="water-balance-kpi-label">
                  <Sun className="h-3.5 w-3.5" />
                  ETo loss
                </div>
                <div className="water-balance-kpi-value">{etoKl.toFixed(1)} kL</div>
              </div>
            </div>

            <p className="water-balance-eto-hint">
              ETo today: {etoTodayMm.toFixed(1)} mm/day
              {dateRangeLabel ? ` · ${dateRangeLabel}` : ""}
              {moistureStatus
                ? ` · Moisture ${shownMoisture.toFixed(0)}% (${moistureStatus})`
                : apiMoisture != null
                  ? ` · Moisture ${shownMoisture.toFixed(0)}%`
                  : ""}
              {chartLoading && !monthLoaded && (
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
                <p className="water-balance-chart-hint">
                  {/* Tap a day for detail */}
                </p>
                <div
                  ref={chartScrollRef}
                  className={`moisture-diverging-scroll moisture-diverging-scroll--flutter ${medium ? "moisture-diverging-scroll--medium" : ""} ${fullWidth ? "moisture-diverging-scroll--full" : ""} ${compact ? "moisture-diverging-scroll--compact" : ""}`}
                  style={{ height: chartH }}
                  data-range={waterRange}
                  role="list"
                  aria-label="Water remain by day"
                >
                  {visibleDays.map((day, i) => {
                    const fullIdx = visibleBase + i;
                    const isSel = fullIdx === selDay;
                    const remainL = day.waterRemainLiters;
                    const needKl = irrigationNeededKl(remainL);
                    const rKl = remainKl(remainL);
                    // Same display rule as Past 7-Day Irrigation Need column (> 0.0 kL).
                    const isDeficit = needKl >= 0.05;
                    const isSurplus = rKl >= 0.05;
                    const frac =
                      isDeficit || isSurplus
                        ? Math.min(1, Math.max(0, Math.abs(remainL) / maxRemainL))
                        : 0;
                    const barColor = isDeficit ? DEFICIT_COLOR : SURPLUS_COLOR;

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
                        title={`${day.shortDate}: ${rKl.toFixed(1)} kL remain · need ${irrigationNeededKl(remainL).toFixed(1)} kL`}
                      >
                        {isSel ? (
                          <span
                            className="moisture-diverging-dot"
                            style={{ backgroundColor: SELECT_DOT }}
                          />
                        ) : (
                          <span className="moisture-diverging-dot-spacer" />
                        )}

                        <div className="moisture-diverging-track">
                          <div className="moisture-diverging-baseline" />
                          {frac > 0 ? (
                            <div
                              className={`moisture-diverging-bar ${
                                isDeficit ? "is-deficit" : "is-surplus"
                              }`}
                              style={{
                                backgroundColor: barColor,
                                height: `max(4px, calc(${frac} * 50%))`,
                              }}
                            />
                          ) : (
                            <span className="moisture-diverging-zero">0</span>
                          )}
                        </div>

                        <span
                          className="moisture-diverging-label"
                          style={{
                            color: isSel ? barColor : "#94a3b8",
                            fontWeight: isSel ? 800 : 400,
                          }}
                        >
                          {day.shortDate}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="moisture-diverging-legend">
                  <span>
                    <i style={{ backgroundColor: SURPLUS_COLOR }} /> Remain
                  </span>
                  <span>
                    <i style={{ backgroundColor: DEFICIT_COLOR }} /> Deficit
                  </span>
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
                          color:
                            selected.waterRemainLiters < 0
                              ? "#D32F2F"
                              : "#0288D1",
                        }}
                      />
                      <span
                        style={{
                          color:
                            selected.waterRemainLiters < 0
                              ? "#D32F2F"
                              : "#0288D1",
                          fontWeight: 700,
                        }}
                      >
                        {remainKl(selected.waterRemainLiters).toFixed(1)} kL
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
