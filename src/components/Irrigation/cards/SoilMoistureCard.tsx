import React, { useEffect, useMemo, useState } from "react";
import { Droplets, Sun } from "lucide-react";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";
import { fetchSoilMoistureForPlot } from "../../../utils/soilMoistureApi";
import {
  fetchWaterRemainForPlot,
  filterDaysInRange,
  formatIrrigationDateRange,
  formatWaterRemainError,
  pastRange,
  pastSameDayLastMonthRange,
  type WaterRemainDay,
} from "../../../utils/waterRemainApi";

interface SoilMoistureCardProps {
  optimalRange: [number, number];
  moistGroundPercent?: number | null;
  targetDate?: string;
  compact?: boolean;
  /** Medium dashboard card — fixed comfortable width/height, not full-page stretch. */
  medium?: boolean;
  /** Full-width dashboard row — spans container width with balanced chart height. */
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

function statusForMoisture(
  pct: number,
  optimalMin: number,
  optimalMax: number,
): string {
  if (pct >= optimalMin && pct <= optimalMax) return "";
  if (pct < optimalMin) return "Low";
  return "High";
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

function irrigationNeededKl(day: TubeDay | null): number {
  if (!day) return 0;
  // Same as Past 7-Day table: water_remain_m3 → kL (1 m³ = 1 kL), keep API sign.
  return Number(day.waterRemainM3) || 0;
}

function isHighWaterNeed(
  etoLoss: number,
  minEto: number,
  maxEto: number,
): boolean {
  if (maxEto <= minEto) return false;
  // Red = above week midpoint (max requirement); blue = below (min need).
  return etoLoss >= (minEto + maxEto) / 2;
}

const SoilMoistureCard: React.FC<SoilMoistureCardProps> = ({
  optimalRange,
  compact = false,
  medium = false,
  fullWidth = false,
}) => {
  const optimalMin = optimalRange[0];
  const optimalMax = optimalRange[1];
  const { setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();

  const [apiMoisture, setApiMoisture] = useState<number | null>(null);
  const [tubeDays, setTubeDays] = useState<TubeDay[]>([]);
  const [selDay, setSelDay] = useState<number>(-1);
  const [loading, setLoading] = useState<boolean>(true);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [monthLoaded, setMonthLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState<string>("");
  const [plotCoords, setPlotCoords] = useState<{ lat: number; lon: number } | null>(
    null,
  );

  useEffect(() => {
    if (!profile || profileLoading) return;

    let plotToUse = "";
    let coords: { lat: number; lon: number } | null = null;

    let selectedPlot: any = null;
    if (selectedPlotName) {
      selectedPlot = profile.plots?.find(
        (plot: any) =>
          plot.fastapi_plot_id === selectedPlotName ||
          `${plot.gat_number}_${plot.plot_number}` === selectedPlotName,
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
      }
    }

    if (plotToUse && plotToUse !== plotName) {
      setPlotName(plotToUse);
    }
    setPlotCoords(coords);
  }, [profile, profileLoading, selectedPlotName, plotName]);

  const chartRange = useMemo(() => pastSameDayLastMonthRange(), []);

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

      // Month fetch runs in parallel — SEF can take 30–60s for ~32 days.
      const monthWaterPromise = fetchWaterRemainForPlot(
        plotName,
        profile?.plots,
        7,
        monthRange,
      );

      try {
        const [moistureParsed, quickWater, rainByDate] = await Promise.all([
          fetchSoilMoistureForPlot(plotName, profile?.plots).catch(() => null),
          fetchWaterRemainForPlot(plotName, profile?.plots, 7, quickRange).catch(
            () => null,
          ),
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
            moisturePercent: currentMoisture,
            currentSoilMoisture: currentMoisture,
            moistureStatus: statusForMoisture(
              currentMoisture,
              optimalMin,
              optimalMax,
            ),
            soilMoistureTrendData: moistureParsed.stack
              .slice(-7)
              .map((item, idx) => {
                const d = new Date(`${item.day}T12:00:00`);
                const dayNames = [
                  "Sun",
                  "Mon",
                  "Tue",
                  "Wed",
                  "Thu",
                  "Fri",
                  "Sat",
                ];
                return {
                  date: item.day,
                  value: parseFloat(item.soil_moisture.toFixed(2)),
                  day: dayNames[d.getDay()] || "",
                  x: idx,
                  rainfallMm: item.rainfall_mm_yesterday ?? 0,
                  rainfallProvisional: Boolean(item.rainfall_provisional),
                  etMm: item.et_mean_mm_yesterday ?? 0,
                };
              }),
          }));
        }

        if (quickWater) {
          applyTubeDays(
            quickWater,
            quickRange,
            moistureByDate,
            currentMoisture,
            rainByDate,
          );
        }

        // Show KPIs + 7-day candles immediately; month continues loading.
        setLoading(false);

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
            setError(formatWaterRemainError(monthErr, plotName));
          } else {
            // Fallback: publish 7-day series only if month failed.
            publishWaterSeries(quickWater, quickRange);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        setTubeDays([]);
        setSelDay(-1);
        setError(formatWaterRemainError(err, plotName));
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
  }, [plotName, plotCoords, chartRange, optimalMin, optimalMax, setAppState, profile?.plots]);

  const selected = selDay >= 0 ? tubeDays[selDay] : null;
  const shownMoisture = selected?.soilMoisture ?? apiMoisture ?? 0;
  const shownStatus = statusForMoisture(
    shownMoisture,
    optimalMin,
    optimalMax,
  );

  const dateRangeLabel = useMemo(() => {
    return formatIrrigationDateRange(
      chartRange.start_date,
      chartRange.end_date,
    );
  }, [chartRange]);

  /** Daily ETo loss range — chart color/height (API remain is cumulative, always −). */
  const etoNeedRange = useMemo(() => {
    const losses = tubeDays.map((d) => d.etoLossLiters).filter((v) => v > 0);
    if (!losses.length) return { min: 0, max: 1 };
    return { min: Math.min(...losses), max: Math.max(...losses) };
  }, [tubeDays]);

  const irrigationKl = irrigationNeededKl(selected);
  const etoTodayMm = selected?.etoSumMm ?? 0;

  const statusBadgeClass =
    shownStatus === "Moderated"
      ? "water-balance-badge--moderated"
      : shownStatus === "Low"
        ? "water-balance-badge--low"
        : "water-balance-badge--high";

  const chartH = compact ? 150 : medium ? 180 : fullWidth ? 200 : 200;

  return (
    <div
      className={`irrigation-card ${compact ? "irrigation-card--compact" : ""} ${medium ? "irrigation-card--medium" : ""} ${fullWidth ? "irrigation-card--full" : ""}`}
    >
      <div className="card-header water-balance-card-header">
        <div className="flex items-center gap-2 min-w-0">
          <Droplets className="card-icon shrink-0" size={22} />
          <h3 className="font-semibold truncate">soil moisture</h3>
        </div>
        {!loading && !error && (
          <span className={`water-balance-badge ${statusBadgeClass}`}>
            {shownStatus}
          </span>
        )}
      </div>

      <div className="card-content soil-moisture soil-moisture--diverging">
        {error && (
          <p className="text-xs text-red-500 px-1">{error}</p>
        )}

        {loading && !tubeDays.length ? (
          <p className="text-xs text-gray-400 text-center py-4">Loading…</p>
        ) : (
          <>
            {/* Top KPI row — like mobile WATER BALANCE card */}
            <div className="water-balance-kpi-row">
              <div className="water-balance-kpi water-balance-kpi--irrigation">
                <div className="water-balance-kpi-label">
                  <Droplets className="h-3.5 w-3.5" />
                  Irrigation needed
                </div>
                <div className="water-balance-kpi-value">
                  {irrigationKl.toFixed(1)} kL
                </div>
              </div>
              <div className="water-balance-kpi water-balance-kpi--eto">
                <div className="water-balance-kpi-label">
                  <Sun className="h-3.5 w-3.5" />
                  ETo loss
                </div>
                <div className="water-balance-kpi-value">
                  {etoTodayMm.toFixed(1)} mm
                </div>
              </div>
            </div>

            {dateRangeLabel && (
              <p className="water-balance-eto-hint">
                {dateRangeLabel}
                {chartLoading && !monthLoaded && (
                  <span className="text-gray-400"> · loading month…</span>
                )}
              </p>
            )}

            {tubeDays.length > 0 ? (
              <>
                <p className="water-balance-chart-hint">Tap a day for detail</p>
                <div
                  className={`moisture-diverging-scroll moisture-diverging-scroll--month ${medium ? "moisture-diverging-scroll--medium" : ""} ${fullWidth ? "moisture-diverging-scroll--full" : ""} ${compact ? "moisture-diverging-scroll--compact" : ""}`}
                  style={{ height: chartH }}
                  role="list"
                  aria-label="Water surplus and deficit by day"
                >
                  {tubeDays.map((day, i) => {
                    const isSel = i === selDay;
                    const { min: minEto, max: maxEto } = etoNeedRange;
                    const span = Math.max(maxEto - minEto, 1);
                    const isHighNeed = isHighWaterNeed(
                      day.etoLossLiters,
                      minEto,
                      maxEto,
                    );
                    // Red ↓ = high daily water need; Blue ↑ = low daily need.
                    const isDeficit = isHighNeed;
                    const frac = isDeficit
                      ? (day.etoLossLiters - minEto) / span
                      : (maxEto - day.etoLossLiters) / span;
                    const barColor = isDeficit ? DEFICIT_COLOR : SURPLUS_COLOR;
                    const halfPx = (chartH - 28) / 2;
                    const barPx = Math.max(8, frac * halfPx);

                    return (
                      <button
                        key={day.day || i}
                        type="button"
                        role="listitem"
                        className="moisture-diverging-day"
                        style={{
                          backgroundColor: isSel
                            ? `${barColor}1A`
                            : "transparent",
                          borderColor: isSel ? `${barColor}73` : "transparent",
                          height: "100%",
                        }}
                        onClick={() => setSelDay(i)}
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
                          <div
                            className={`moisture-diverging-bar ${isDeficit ? "is-deficit" : "is-surplus"}`}
                            style={{
                              backgroundColor: barColor,
                              height: barPx,
                            }}
                            title={`${day.shortDate}: ETo loss ${(day.etoLossLiters / 1000).toFixed(1)} kL · ${isHighNeed ? "High need" : "Low need"}`}
                          />
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
                    <i style={{ backgroundColor: SURPLUS_COLOR }} /> Low need
                  </span>
                  <span>
                    <i style={{ backgroundColor: DEFICIT_COLOR }} /> High need
                  </span>
                </div>
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
