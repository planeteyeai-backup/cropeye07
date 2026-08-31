import React, { useEffect, useMemo, useState } from "react";
import { Droplets, Sun } from "lucide-react";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";
import { fetchSoilMoistureForPlot } from "../../../utils/soilMoistureApi";
import {
  fetchWaterRemainForPlot,
  type WaterRemainDay,
} from "../../../utils/waterRemainApi";

interface SoilMoistureCardProps {
  optimalRange: [number, number];
  moistGroundPercent?: number | null;
  targetDate?: string;
  compact?: boolean;
}

type TubeDay = {
  day: string;
  shortDate: string;
  soilMoisture: number;
  etoSumMm: number;
  waterRemainLiters: number;
  waterRemainM3: number;
  etoLossLiters: number;
};

const SURPLUS_COLOR = "#1565C0";
const DEFICIT_COLOR = "#D32F2F";
const SELECT_DOT = "#29B6F6";

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

function litersToKl(l: number): number {
  return Math.abs(l) / 1000;
}

function buildTubesFromWaterRemain(
  days: WaterRemainDay[],
  moistureByDate: Map<string, number>,
  fallbackMoisture: number,
): TubeDay[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map((d) => ({
      day: d.date,
      shortDate: shortDateLabel(d.date),
      soilMoisture: moistureByDate.get(d.date) ?? fallbackMoisture,
      etoSumMm: d.eto_sum_mm,
      waterRemainLiters: d.water_remain_liters,
      waterRemainM3: d.water_remain_m3,
      etoLossLiters: d.eto_loss_liters,
    }));
}

/** Deficit/high-need day → daily ETo loss as irrigation (kL); low-need → 0. */
function irrigationNeededKl(day: TubeDay | null, isHighNeed: boolean): number {
  if (!day || !isHighNeed) return 0;
  return litersToKl(day.etoLossLiters);
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
}) => {
  const optimalMin = optimalRange[0];
  const optimalMax = optimalRange[1];
  const { setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();

  const [apiMoisture, setApiMoisture] = useState<number | null>(null);
  const [tubeDays, setTubeDays] = useState<TubeDay[]>([]);
  const [selDay, setSelDay] = useState<number>(-1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState<string>("");

  useEffect(() => {
    if (!profile || profileLoading) return;

    let plotToUse = "";
    if (selectedPlotName) {
      const foundPlot = profile.plots?.find(
        (plot: any) =>
          plot.fastapi_plot_id === selectedPlotName ||
          `${plot.gat_number}_${plot.plot_number}` === selectedPlotName,
      );
      plotToUse = foundPlot?.fastapi_plot_id || selectedPlotName || "";
    } else {
      plotToUse = profile.plots?.[0]?.fastapi_plot_id || "";
    }

    if (plotToUse && plotToUse !== plotName) {
      setPlotName(plotToUse);
    }
  }, [profile, profileLoading, selectedPlotName, plotName]);

  useEffect(() => {
    if (!plotName) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const [moistureParsed, waterParsed] = await Promise.all([
          fetchSoilMoistureForPlot(plotName, profile?.plots).catch(() => null),
          fetchWaterRemainForPlot(plotName, profile?.plots, 7),
        ]);
        if (cancelled) return;

        const moistureByDate = new Map<string, number>();
        let currentMoisture = 50;
        if (moistureParsed) {
          currentMoisture = moistureParsed.currentMoisture;
          for (const row of moistureParsed.stack) {
            moistureByDate.set(row.day, row.soil_moisture);
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

        const days = buildTubesFromWaterRemain(
          waterParsed.days,
          moistureByDate,
          currentMoisture,
        );
        setTubeDays(days);
        setSelDay(days.length > 0 ? days.length - 1 : -1);

        const latestMoisture =
          days.length > 0
            ? days[days.length - 1].soilMoisture
            : currentMoisture;
        setApiMoisture(parseFloat(Number(latestMoisture).toFixed(2)));

        setAppState((prev: any) => ({
          ...prev,
          waterRemainSeries: waterParsed.days.slice(-7),
          waterRemainPlot: waterParsed.plotName,
        }));
      } catch (err: any) {
        if (cancelled) return;
        setTubeDays([]);
        setSelDay(-1);
        setError(`Water remain failed: ${err?.message || err}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [plotName, optimalMin, optimalMax, setAppState, profile?.plots]);

  const selected = selDay >= 0 ? tubeDays[selDay] : null;
  const shownMoisture = selected?.soilMoisture ?? apiMoisture ?? 0;
  const shownStatus = statusForMoisture(
    shownMoisture,
    optimalMin,
    optimalMax,
  );

  /** Daily ETo loss range — chart color/height (API remain is cumulative, always −). */
  const etoNeedRange = useMemo(() => {
    const losses = tubeDays.map((d) => d.etoLossLiters).filter((v) => v > 0);
    if (!losses.length) return { min: 0, max: 1 };
    return { min: Math.min(...losses), max: Math.max(...losses) };
  }, [tubeDays]);

  const selectedHighNeed = selected
    ? isHighWaterNeed(
        selected.etoLossLiters,
        etoNeedRange.min,
        etoNeedRange.max,
      )
    : false;

  const irrigationKl = irrigationNeededKl(selected, selectedHighNeed);
  const etoLossKl = litersToKl(selected?.etoLossLiters ?? 0);
  const etoTodayMm = selected?.etoSumMm ?? 0;

  const statusBadgeClass =
    shownStatus === "Moderated"
      ? "water-balance-badge--moderated"
      : shownStatus === "Low"
        ? "water-balance-badge--low"
        : "water-balance-badge--high";

  const chartH = compact ? 150 : 200;

  return (
    <div
      className={`irrigation-card ${compact ? "irrigation-card--compact" : ""}`}
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

            {etoTodayMm > 0 && (
              <p className="water-balance-eto-hint">
                {selected ? `Date: ${selected.shortDate}` : ""}
              </p>
            )}

            {tubeDays.length > 0 ? (
              <>
                <p className="water-balance-chart-hint">Tap a day for detail</p>
                <div
                  className="moisture-diverging-scroll"
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
