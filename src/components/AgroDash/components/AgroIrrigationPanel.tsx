import React, { useEffect, useMemo, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import RainfallCard from "../../Irrigation/cards/RainfallCard";
import TemperatureCard from "../../Irrigation/cards/TemperatureCard";
import HumidityCard from "../../Irrigation/cards/HumidityCard";
import "../../Irrigation/Irrigation.css";
import { fetchCurrentWeather } from "../../../services/weatherService";
import {
  fetchSoilMoistureForPlot,
  moistureBandForCrop,
} from "../../../utils/soilMoistureApi";
import {
  fetchWaterRemainForPlot,
  filterPastDays,
  formatWaterRemainError,
  pastSameDayLastMonthRange,
  remainKlFromWaterFields,
  type WaterRemainDay,
} from "../../../utils/waterRemainApi";
import { useAppContext } from "../../../context/AppContext";

export type AgroIrrigationPlot = {
  plotNo: string;
  position: [number, number];
  area?: string;
  status?: string;
};

interface AgroIrrigationPanelProps {
  plots: AgroIrrigationPlot[];
  selectedPlotId?: string | null;
  onPlotSelect?: (plotNo: string) => void;
}

function remainKl(day: WaterRemainDay): number {
  return remainKlFromWaterFields(day.water_remain_liters, day.water_remain_m3);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const AgroIrrigationPanel: React.FC<AgroIrrigationPanelProps> = ({
  plots,
  selectedPlotId = null,
  onPlotSelect,
}) => {
  const { setSelectedPlotName } = useAppContext();
  const [activePlot, setActivePlot] = useState<string>("");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [moistureLoading, setMoistureLoading] = useState(false);
  const [remainLoading, setRemainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainError, setRemainError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [weather, setWeather] = useState<{
    precip_mm?: number;
    temperature_c?: number;
    humidity?: number;
  } | null>(null);
  const [moisture, setMoisture] = useState<{
    current: number | null;
    bandMin: number;
    bandMax: number;
  }>({ current: null, bandMin: 20, bandMax: 40 });
  const [remainDays, setRemainDays] = useState<WaterRemainDay[]>([]);

  const plotOptions = useMemo(() => {
    const seen = new Set<string>();
    return plots.filter((p) => {
      const key = String(p.plotNo || "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [plots]);

  useEffect(() => {
    if (!plotOptions.length) {
      setActivePlot("");
      return;
    }
    const preferred =
      (selectedPlotId &&
        plotOptions.find((p) => p.plotNo === selectedPlotId)?.plotNo) ||
      (activePlot &&
        plotOptions.find((p) => p.plotNo === activePlot)?.plotNo) ||
      plotOptions[0].plotNo;
    if (preferred !== activePlot) setActivePlot(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-pick when options / external selection change
  }, [plotOptions, selectedPlotId]);

  const selected = useMemo(
    () => plotOptions.find((p) => p.plotNo === activePlot) ?? null,
    [plotOptions, activePlot],
  );

  useEffect(() => {
    if (!selected) {
      setWeather(null);
      setMoisture((prev) => ({ ...prev, current: null }));
      setRemainDays([]);
      return;
    }

    setSelectedPlotName(selected.plotNo);
    onPlotSelect?.(selected.plotNo);

    let cancelled = false;
    const [lat, lon] = selected.position;
    const band = moistureBandForCrop("sugarcane");

    const load = async () => {
      setError(null);
      setRemainError(null);
      setWeatherLoading(true);
      setMoistureLoading(true);
      setRemainLoading(true);

      try {
        const wx = await fetchCurrentWeather(lat, lon);
        if (!cancelled) {
          setWeather(wx);
          setLastUpdated(new Date());
        }
      } catch {
        if (!cancelled) {
          setWeather(null);
          setError("Could not load weather for this plot.");
        }
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }

      try {
        const sm = await fetchSoilMoistureForPlot(selected.plotNo);
        if (!cancelled) {
          setMoisture({
            current:
              sm?.currentMoisture != null && Number.isFinite(sm.currentMoisture)
                ? sm.currentMoisture
                : null,
            bandMin: band.minOptimal,
            bandMax: band.maxOptimal,
          });
        }
      } catch {
        if (!cancelled) {
          setMoisture({
            current: null,
            bandMin: band.minOptimal,
            bandMax: band.maxOptimal,
          });
        }
      } finally {
        if (!cancelled) setMoistureLoading(false);
      }

      try {
        const parsed = await fetchWaterRemainForPlot(
          selected.plotNo,
          null,
          31,
          pastSameDayLastMonthRange(),
          { cropName: "sugarcane", allowShortRange: true },
        );
        if (!cancelled) {
          setRemainDays(filterPastDays(parsed.days, 7));
        }
      } catch (err) {
        if (!cancelled) {
          setRemainDays([]);
          const msg = formatWaterRemainError(err, selected.plotNo);
          if (msg) setRemainError(msg);
        }
      } finally {
        if (!cancelled) setRemainLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selected?.plotNo, selected?.position[0], selected?.position[1]]);

  const moistureStatus = (() => {
    if (moisture.current == null) return { label: "—", color: "text-gray-500" };
    if (moisture.current < moisture.bandMin)
      return { label: "Dry — irrigate", color: "text-amber-700" };
    if (moisture.current > moisture.bandMax)
      return { label: "Wet — hold", color: "text-blue-700" };
    return { label: "Optimal", color: "text-emerald-700" };
  })();

  const remainChart = useMemo(
    () =>
      remainDays.map((d) => {
        const kl = remainKl(d);
        return {
          date: shortDate(d.date),
          remainKl: Number(kl.toFixed(2)),
          fill: kl < 0 ? "#ef4444" : "#0288D1",
        };
      }),
    [remainDays],
  );

  const latestRemainKl = remainDays.length
    ? remainKl(remainDays[remainDays.length - 1])
    : null;

  if (!plotOptions.length) {
    return (
      <div className="rounded-lg border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">
        Select plots on the map / filters to view soil moisture and water remain.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3 sm:p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="h-5 w-5 text-blue-600" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Soil moisture &amp; water remain
            </h3>
            <p className="text-[11px] text-gray-500">
              Irrigation panel · same APIs as farmer irrigation (not full page)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-xs font-medium text-gray-600 shrink-0">
            Plot
          </label>
          <select
            value={activePlot}
            onChange={(e) => {
              setActivePlot(e.target.value);
              onPlotSelect?.(e.target.value);
            }}
            className="min-w-0 flex-1 sm:min-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {plotOptions.map((p) => (
              <option key={p.plotNo} value={p.plotNo}>
                {p.plotNo}
                {p.area ? ` · ${p.area}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error}
        </div>
      )}

      <div className="irrigation-container !p-0 !shadow-none !bg-transparent">
        <div className="card-row">
          {weatherLoading && !weather ? (
            <div className="flex h-24 w-full items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading weather…
            </div>
          ) : (
            <>
              <RainfallCard
                value={weather?.precip_mm || 0}
                lastUpdated={lastUpdated}
              />
              <TemperatureCard
                value={weather?.temperature_c || 0}
                lastUpdated={lastUpdated}
              />
              <HumidityCard
                value={weather?.humidity || 0}
                lastUpdated={lastUpdated}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="text-xs font-medium text-blue-700 mb-1">
            Soil moisture
          </div>
          {moistureLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold text-gray-900">
                {moisture.current != null
                  ? `${moisture.current.toFixed(1)}%`
                  : "—"}
              </div>
              <div className={`text-xs mt-1 font-medium ${moistureStatus.color}`}>
                {moistureStatus.label}
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
          <div className="text-xs font-medium text-sky-700 mb-1">
            Water remain (latest)
          </div>
          {remainLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div
                className={`text-2xl font-bold ${
                  latestRemainKl != null && latestRemainKl < 0
                    ? "text-red-600"
                    : "text-sky-800"
                }`}
              >
                {latestRemainKl != null
                  ? `${latestRemainKl.toFixed(1)} KL`
                  : "—"}
              </div>
              <div className="text-xs mt-1 text-gray-500">
                From water-remain API · last 7 days
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="text-xs font-medium text-gray-600 mb-1">
            Optimal band · Plot
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {moisture.bandMin}–{moisture.bandMax}%
          </div>
          <div className="text-xs mt-1 text-gray-500 truncate">
            {selected?.plotNo || "—"}
            {selected?.status ? ` · ${selected.status}` : ""}
            {selected?.area ? ` · ${selected.area}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-100 bg-slate-50/80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-800">
            Water remain (7 days)
          </h4>
          {remainLoading && (
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Updating…
            </span>
          )}
        </div>
        {remainError ? (
          <p className="py-6 text-center text-xs text-amber-700">{remainError}</p>
        ) : remainChart.length === 0 && !remainLoading ? (
          <p className="py-6 text-center text-xs text-gray-500">
            No water-remain series for this plot
          </p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={remainChart}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}`}
                  label={{
                    value: "KL",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fill: "#64748b" },
                  }}
                />
                <Tooltip
                  formatter={(value: number) => [
                    `${Number(value).toFixed(2)} KL`,
                    "Water remain",
                  ]}
                />
                <Bar
                  dataKey="remainKl"
                  name="Water remain"
                  radius={[3, 3, 0, 0]}
                >
                  {remainChart.map((row, i) => (
                    <Cell key={`remain-${i}`} fill={row.fill} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgroIrrigationPanel;
