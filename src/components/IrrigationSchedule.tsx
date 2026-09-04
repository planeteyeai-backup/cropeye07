import React, { useEffect, useState } from "react";
import "./Irrigation/Irrigation.css";
import { useAppContext } from "../context/AppContext";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import {
  fetchWaterRemainForPlot,
  filterPastDays,
  formatIrrigationDateRange,
  formatWaterRemainError,
  pastRange,
  type WaterRemainDay,
} from "../utils/waterRemainApi";
import { plotKeyFromRecord } from "../utils/plotName";
import { fetchSoilMoistureForPlot } from "../utils/soilMoistureApi";
import { CloudRain, Sun } from "lucide-react";

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

type PlotCoords = { lat: number; lon: number };

function parsePrecipMm(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

/** Flutter: irrigation needed kL only when remain is deficit. */
function irrigationNeededKl(remainLiters: number): number {
  if (!(remainLiters < 0)) return 0;
  return Math.abs(remainLiters) / 1000;
}

/** Flutter: ETo loss volume in kL. */
function etoLossKl(etoLossLiters: number): number {
  return Math.max(0, Number(etoLossLiters) || 0) / 1000;
}

function formatKl(value: number): string {
  return `${(Number(value) || 0).toFixed(1)} kL`;
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
  const { setAppState, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const [plotName, setPlotName] = useState<string>("");
  const [plotCoords, setPlotCoords] = useState<PlotCoords | null>(null);
  const [etValue, setEtValue] = useState<number>(0.1);
  const [rainfallMm, setRainfallMm] = useState<number>(0);
  /** Past 7 days from water-remain + daily rainfall (Open-Meteo / forecast) */
  const [remainDays, setRemainDays] = useState<ScheduleDay[]>([]);
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

    let selectedPlot = null;
    if (selectedPlotName) {
      selectedPlot = profile.plots?.find(
        (p: any) =>
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
      return;
    }

    const plotId =
      plotKeyFromRecord(selectedPlot) ||
      selectedPlot.fastapi_plot_id ||
      `${selectedPlot.gat_number}_${selectedPlot.plot_number}`;
    setPlotName(plotId);

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
                // Prefer past/history when present; fill gaps from forecast.
                if (!merged.has(k) || (merged.get(k) === 0 && v > 0)) {
                  merged.set(k, v);
                }
              }
              return merged;
            })
          : Promise.resolve(new Map<string, number>());

        // Flutter WaterBalanceApi: last 30 days (cumulative remain depends on start_date).
        const seriesRange = pastRange(30);
        const waterExtras = {
          cropName: "sugarcane",
          lat: plotCoords?.lat,
          lon: plotCoords?.lon,
        };
        const [apiResp, moistureResp, rainByDate] = await Promise.all([
          fetchWaterRemainForPlot(
            plotName,
            profile?.plots,
            30,
            seriesRange,
            waterExtras,
          ),
          fetchSoilMoistureForPlot(plotName, profile?.plots).catch(() => null),
          rainPromise,
        ]);
        if (cancelled) return;

        // Soil-moisture may include rainfall on some plots (often missing).
        if (moistureResp?.stack?.length) {
          for (const row of moistureResp.stack) {
            const key = String(row.day).slice(0, 10);
            const rain = Number(row.rainfall_mm_yesterday);
            if (key && Number.isFinite(rain) && rain > 0) {
              rainByDate.set(key, rain);
            }
          }
        }

        // Table still shows only past 7 days, sliced from the shared month series.
        const last7 = filterPastDays(apiResp.days, 7);

        const todayStr = new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Kolkata",
        });
        const mapped: ScheduleDay[] = last7.map((item: WaterRemainDay) => {
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

        setRemainDays(mapped);
        setAppState((prev: any) => ({
          ...prev,
          // Keep full month series when Soil Moisture already stored it; else last7.
          waterRemainSeries: apiResp.days.length > last7.length ? apiResp.days : last7,
        }));
        if (last7.length) {
          const latestEt = last7[last7.length - 1].eto_sum_mm;
          if (latestEt > 0) setEtValue(latestEt);
        }
      } catch (e: any) {
        if (cancelled) return;
        const msg = formatWaterRemainError(e, plotName);
        if (msg) setError(msg);
        setRemainDays([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [plotName, plotCoords, profile?.plots, rainfallMm, setAppState]);

  const generateScheduleData = () => {
    const scheduleData: Array<any> = [];
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    // Always show 7 calendar days. Missing API rows → irrigation need = 0.0 kL.
    const byDate = new Map(remainDays.map((d) => [d.day, d]));
    const sourceDays: ScheduleDay[] = [];
    for (let idx = 6; idx >= 0; idx -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - idx);
      const key = d.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
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

    for (const hist of sourceDays) {
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

      // Missing day / no deficit → irrigation need shows 0.0 kL (Flutter).
      const irrigKl = hasRemainSeries
        ? irrigationNeededKl(hist.waterRemainLiters)
        : 0;
      const lossKl = hasRemainSeries ? etoLossKl(hist.etoLossLiters) : 0;

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
  const totalEtoMm = scheduleData.reduce(
    (sum, day) => sum + (Number(day.etDisplayed) || 0),
    0,
  );
  const totalRainMm = scheduleData.reduce(
    (sum, day) => sum + (Number(day.rainfall) || 0),
    0,
  );
  const totalIrrigationNeedKl = scheduleData.reduce(
    (sum, day) => sum + (Number(day.irrigationNeedKl) || 0),
    0,
  );

  useEffect(() => {
    const data = generateScheduleData();
    if (data.length > 0) {
      setAppState((prev: any) => ({
        ...prev,
        irrigationScheduleData: data,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etValue, rainfallMm, remainDays, setAppState]);

  return (
    <div className="bg-white rounded-lg overflow-hidden shadow h-full flex flex-col">
      {/* Slim title bar */}
      <div className="bg-green-600 text-white px-2 py-1 flex flex-col items-center justify-center shrink-0 gap-0.5">
        <h2 className="text-xs font-semibold text-center leading-tight">
          Past 7-Day Irrigation /acre
        </h2>
        {dateRangeLabel && (
          <p className="text-[9px] text-green-100 leading-tight">{dateRangeLabel}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-1.5 pt-1 pb-1 gap-0.5 overflow-hidden">
        {/* Header row */}
        <div className="irrigation-schedule-grid irrigation-schedule-grid--head shrink-0 rounded bg-green-100 px-2 py-0.5 text-[9px] font-semibold text-gray-700">
          <span>Date</span>
          <span>ETO Loss</span>
          <span>Rain</span>
          <span>Irrigation Need</span>
        </div>

        {/* 7 data rows — flex-1 so they share space equally, no scroll */}
        <div className="irrigation-schedule-days flex-1 min-h-0 flex flex-col gap-0.5">
          {scheduleData.length === 0 && error ? (
            <p className="flex-1 flex items-center justify-center text-[10px] text-red-600 px-2 text-center leading-snug">
              {error}
            </p>
          ) : (
            scheduleData.map((day, idx) => (
            <div
              key={day.isoDate || idx}
              className={[
                "irrigation-schedule-grid irrigation-schedule-day-card flex-1 min-h-0 rounded px-2 py-0.5 text-[9px]",
                day.isToday
                  ? "bg-blue-50 ring-1 ring-blue-300"
                  : idx % 2
                    ? "bg-white"
                    : "bg-gray-50",
              ].join(" ")}
            >
              <div className="min-w-0 flex items-center gap-1">
                <span className="font-semibold text-gray-800 whitespace-nowrap">
                  {day.date}
                </span>
                <Sun className="h-2.5 w-2.5 shrink-0 text-orange-500" />
                {day.isToday && (
                  <span className="inline-block rounded bg-blue-100 px-0.5 text-[7px] font-semibold text-blue-800">
                    Today
                  </span>
                )}
              </div>

              <div className="flex flex-col items-start justify-center min-w-0 gap-0.5">
                {loading ? (
                  <div className="loading-spinner-small" />
                ) : (
                  <>
                    <span className="text-[11px] font-semibold text-gray-800 whitespace-nowrap">
                      {Number(day.etDisplayed || 0).toFixed(1)} mm
                    </span>
                    <span
                      className={`inline-block rounded px-1 py-0.5 text-[11px] font-medium leading-none ${getETRangeColor(day.etRange)}`}
                    >
                      {day.etRange}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-0.5 font-semibold text-sky-700 whitespace-nowrap">
                <CloudRain className="h-2.5 w-2.5 shrink-0 text-sky-600" />
                {Number(day.rainfall || 0).toFixed(1)} mm
              </div>

              <div
                className={`font-semibold whitespace-nowrap ${
                  (day.irrigationNeedKl ?? 0) > 0
                    ? "text-red-700"
                    : "text-emerald-800"
                }`}
              >
                {formatKl(day.irrigationNeedKl ?? 0)}
              </div>
            </div>
            ))
          )}
        </div>

        {/* Total row */}
        {scheduleData.length > 0 && (
        <div className="irrigation-schedule-grid irrigation-schedule-grid--total shrink-0 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[9px] font-semibold">
          <span className="text-gray-800">7-Day Total</span>
          <span className="text-gray-700 whitespace-nowrap">
            {totalEtoMm.toFixed(1)} mm
          </span>
          <span className="text-sky-700 whitespace-nowrap">{totalRainMm.toFixed(1)} mm</span>
          <span className="text-emerald-800 whitespace-nowrap">
            {formatKl(totalIrrigationNeedKl)}
          </span>
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
