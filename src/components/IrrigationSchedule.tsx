import React, { useEffect, useState } from "react";
import "./Irrigation/Irrigation.css";
import { useAppContext } from "../context/AppContext";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import {
  fetchWaterRemainForPlot,
  type WaterRemainDay,
} from "../utils/waterRemainApi";
import { fetchSoilMoistureForPlot } from "../utils/soilMoistureApi";
import { CloudRain, Sun } from "lucide-react";

type ScheduleDay = {
  day: string;
  etoSumMm: number;
  etoLossLiters: number;
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

/** Liters → kiloliters for ETO / Water Loss display. */
function litersToKl(liters: number): number {
  return Math.abs(Number(liters) || 0) / 1000;
}

function formatKl(liters: number): string {
  return `${litersToKl(liters).toFixed(1)} kL`;
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

        const [apiResp, moistureResp, rainByDate] = await Promise.all([
          fetchWaterRemainForPlot(plotName, profile?.plots, 7),
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

        const last7 = [...apiResp.days]
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-7);

        const todayStr = new Date().toISOString().slice(0, 10);
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
            waterRemainLiters: item.water_remain_liters,
            waterRemainM3: item.water_remain_m3,
            waterVolumeLiters: item.water_volume_liters,
            rainfall,
          };
        });

        setRemainDays(mapped);
        setAppState((prev: any) => ({
          ...prev,
          waterRemainSeries: last7,
        }));
        if (last7.length) {
          const latestEt = last7[last7.length - 1].eto_sum_mm;
          if (latestEt > 0) setEtValue(latestEt);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(`Water remain failed: ${e?.message || e}`);
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
    const todayStr = new Date().toISOString().slice(0, 10);

    const sourceDays: ScheduleDay[] =
      remainDays.length > 0
        ? remainDays
        : Array.from({ length: 7 }, (_, idx) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - idx));
            const key = d.toISOString().slice(0, 10);
            return {
              day: key,
              etoSumMm: key === todayStr ? etValue : 0,
              etoLossLiters: 0,
              waterRemainLiters: 0,
              waterRemainM3: 0,
              waterVolumeLiters: 0,
              rainfall: key === todayStr ? rainfallMm : 0,
            };
          });

    for (const hist of sourceDays) {
      const date = new Date(hist.day + "T12:00:00");
      const isToday = hist.day === todayStr;
      const etMm = hist.etoSumMm > 0 ? hist.etoSumMm : isToday ? etValue : 0;
      const rainMm =
        hist.rainfall > 0
          ? hist.rainfall
          : isToday
            ? rainfallMm
            : hist.rainfall;

      scheduleData.push({
        date: date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        isoDate: hist.day,
        isToday,
        etDisplayed: Number(etMm.toFixed(1)),
        etRange: getETRange(etMm),
        etoLossLiters: hist.etoLossLiters,
        waterLossLiters: hist.etoLossLiters,
        rainfall: rainMm,
        waterRequired: Math.round(hist.waterRemainLiters),
        waterRemainLiters: Math.round(hist.waterRemainLiters),
        waterRemainM3: hist.waterRemainM3,
        waterVolumeLiters: Math.round(hist.waterVolumeLiters),
        timeHours: null,
        time: `${hist.waterRemainM3.toFixed(2)} m³`,
      });
    }

    return scheduleData;
  };

  const scheduleData = generateScheduleData();
  const totalEtoLoss = scheduleData.reduce(
    (sum, day) => sum + (Number(day.etoLossLiters) || 0),
    0,
  );
  const totalRainMm = scheduleData.reduce(
    (sum, day) => sum + (Number(day.rainfall) || 0),
    0,
  );
  const latestRemainM3 =
    scheduleData.length > 0
      ? Number(scheduleData[scheduleData.length - 1].waterRemainM3) || 0
      : 0;

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
      <div className="bg-green-600 text-white p-2 flex items-center justify-center shrink-0">
        <h2 className="text-base sm:text-lg font-semibold text-center leading-tight">
          Past 7-Day Irrigation /acre
        </h2>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-2 gap-1.5 overflow-hidden">
        <div className="irrigation-schedule-grid irrigation-schedule-grid--head shrink-0 rounded-md bg-green-100 px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold text-gray-700">
          <span>Date</span>
          <span>ETO Loss</span>
          <span>Rain</span>
          <span>Water Loss</span>
          <span>Water Available</span>
        </div>

        <div className="irrigation-schedule-days flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1 pr-0.5">
          {scheduleData.map((day, idx) => (
            <div
              key={day.isoDate || idx}
              className={[
                "irrigation-schedule-grid irrigation-schedule-day-card shrink-0 rounded-md px-2 py-1.5 text-[10px] sm:text-[11px]",
                day.isToday
                  ? "bg-blue-50 ring-1 ring-blue-300"
                  : idx % 2
                    ? "bg-white"
                    : "bg-gray-50",
              ].join(" ")}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-semibold text-gray-800 whitespace-nowrap">
                    {day.date}
                  </span>
                  <Sun className="h-3 w-3 shrink-0 text-orange-500" />
                </div>
                {day.isToday && (
                  <span className="mt-0.5 inline-block rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-800">
                    Today
                  </span>
                )}
              </div>

              <div className="flex flex-col items-start justify-center gap-0.5 min-w-0">
                {loading ? (
                  <div className="loading-spinner-small" />
                ) : (
                  <>
                    <span className="font-semibold text-gray-800 whitespace-nowrap">
                      {formatKl(day.etoLossLiters)}
                    </span>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold whitespace-nowrap ${getETRangeColor(day.etRange)}`}
                    >
                      {day.etRange}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-0.5 font-semibold text-sky-700 whitespace-nowrap">
                <CloudRain className="h-3 w-3 shrink-0 text-sky-600" />
                {Number(day.rainfall || 0).toFixed(1)} mm
              </div>

              <div className="font-semibold text-gray-800 whitespace-nowrap">
                {formatKl(day.waterLossLiters ?? day.etoLossLiters)}
              </div>

              <div className="font-semibold text-gray-800 whitespace-nowrap">
                {Number(day.waterRemainM3).toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <div className="irrigation-schedule-grid irrigation-schedule-grid--total shrink-0 rounded-md border border-green-200 bg-green-50 px-2 py-2 text-[10px] sm:text-[11px] font-semibold relative z-10">
          <span className="text-gray-800">7-Day Total</span>
          <span className="text-gray-700 whitespace-nowrap">
            {formatKl(totalEtoLoss)}
          </span>
          <span className="text-sky-700 whitespace-nowrap">
            {totalRainMm.toFixed(1)} mm
          </span>
          <span className="text-gray-700 whitespace-nowrap">
            {formatKl(totalEtoLoss)}
          </span>
          <span className="text-gray-800 whitespace-nowrap" title="Latest water available m³">
            {latestRemainM3.toFixed(2)} m³
          </span>
        </div>
      </div>

      {error && <div className="error-message-small px-2 pb-2">{error}</div>}
    </div>
  );
};

export default IrrigationSchedule;
