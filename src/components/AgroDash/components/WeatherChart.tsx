import React, { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  aggregateAgroWeatherSeries,
  type AgroTimePeriod,
  type AgroWeatherDay,
} from "../../../utils/agroWeatherApi";

interface WeatherChartProps {
  timePeriod: AgroTimePeriod;
  series?: AgroWeatherDay[];
  loading?: boolean;
  error?: string | null;
}

type VisibleMetrics = {
  precipitation: boolean;
  tempHigh: boolean;
  tempAvg: boolean;
  tempMin: boolean;
  wind: boolean;
  highHumidity: boolean;
  lowHumidity: boolean;
};

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function WeatherTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-gray-800">{label}</p>
      {payload.map((entry) => {
        const name = entry.name ?? "";
        const value = entry.value ?? 0;
        let unit = "";
        if (name.includes("Precipitation")) unit = " mm";
        else if (name.includes("Humidity")) unit = " %";
        else if (name.includes("Wind")) unit = " km/h";
        else if (name.includes("Temp")) unit = " °C";
        return (
          <p key={name} style={{ color: entry.color }} className="leading-5">
            {name}: {Number(value).toFixed(1)}
            {unit}
          </p>
        );
      })}
    </div>
  );
}

const WeatherChart: React.FC<WeatherChartProps> = ({
  timePeriod,
  series = [],
  loading = false,
  error = null,
}) => {
  const [visibleMetrics, setVisibleMetrics] = useState<VisibleMetrics>({
    precipitation: true,
    tempHigh: true,
    tempAvg: true,
    tempMin: true,
    wind: false,
    highHumidity: false,
    lowHumidity: false,
  });

  const processedData = useMemo(
    () => aggregateAgroWeatherSeries(series, timePeriod),
    [series, timePeriod],
  );

  const rainDomain = useMemo((): [number, number] => {
    const maxRain = Math.max(
      ...processedData.map((row) => row.precipitation),
      0,
    );
    return [0, Math.max(roundUp(maxRain * 1.2, 5), 10)];
  }, [processedData]);

  const tempDomain = useMemo((): [number, number] => {
    const temps: number[] = [];
    for (const row of processedData) {
      if (visibleMetrics.tempHigh) temps.push(row.tempHigh);
      if (visibleMetrics.tempAvg) temps.push(row.tempAvg);
      if (visibleMetrics.tempMin) temps.push(row.tempMin);
      if (visibleMetrics.wind) temps.push(row.wind);
    }
    if (!temps.length) return [0, 40];
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    return [Math.floor(min - 3), Math.ceil(max + 3)];
  }, [processedData, visibleMetrics]);

  const showHumidity =
    visibleMetrics.highHumidity || visibleMetrics.lowHumidity;
  const showTempOrWind =
    visibleMetrics.tempHigh ||
    visibleMetrics.tempAvg ||
    visibleMetrics.tempMin ||
    visibleMetrics.wind;

  const handleLegendClick = (metric: keyof VisibleMetrics) => {
    const isOnlyVisible =
      visibleMetrics[metric] &&
      Object.entries(visibleMetrics).filter(([, value]) => value).length === 1;

    if (isOnlyVisible) {
      setVisibleMetrics({
        precipitation: true,
        tempHigh: true,
        tempAvg: true,
        tempMin: true,
        wind: false,
        highHumidity: false,
        lowHumidity: false,
      });
    } else {
      setVisibleMetrics({
        precipitation: metric === "precipitation",
        tempHigh: metric === "tempHigh",
        tempAvg: metric === "tempAvg",
        tempMin: metric === "tempMin",
        wind: metric === "wind",
        highHumidity: metric === "highHumidity",
        lowHumidity: metric === "lowHumidity",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        Loading weather data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!processedData.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        No weather data available for this area.
      </div>
    );
  }

  return (
    <div className="relative items-start justify-start rounded-lg bg-white p-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            key={timePeriod}
            data={processedData}
            margin={{ top: 8, right: showHumidity ? 48 : 28, bottom: 0, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10 }}
              angle={timePeriod === "daily" ? -35 : 0}
              textAnchor={timePeriod === "daily" ? "end" : "middle"}
              height={timePeriod === "daily" ? 50 : 60}
            />

            {/* Left: rainfall (mm) */}
            {visibleMetrics.precipitation && (
              <YAxis
                yAxisId="rain"
                orientation="left"
                domain={rainDomain}
                tick={{ fontSize: 10, fill: "#2563eb" }}
                tickFormatter={(v) => `${v}`}
                label={{
                  value: "mm",
                  angle: -90,
                  position: "insideLeft",
                  offset: 8,
                  style: { fontSize: 10, fill: "#2563eb" },
                }}
              />
            )}

            {/* Right: temperature + wind (°C / km/h) */}
            {showTempOrWind && (
              <YAxis
                yAxisId="temp"
                orientation="right"
                domain={tempDomain}
                tick={{ fontSize: 10, fill: "#ef4444" }}
                tickFormatter={(v) => `${v}°`}
                label={{
                  value: "°C",
                  angle: 90,
                  position: "insideRight",
                  offset: showHumidity ? -8 : 0,
                  style: { fontSize: 10, fill: "#ef4444" },
                }}
              />
            )}

            {/* Second right: humidity (%) */}
            {showHumidity && (
              <YAxis
                yAxisId="humidity"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#16a34a" }}
                tickFormatter={(v) => `${v}%`}
                axisLine={false}
                tickLine={false}
                width={42}
                label={{
                  value: "% RH",
                  angle: 90,
                  position: "insideRight",
                  offset: 12,
                  style: { fontSize: 9, fill: "#16a34a" },
                }}
              />
            )}

            <Tooltip content={<WeatherTooltip />} />
            <Legend wrapperStyle={{ display: "none" }} />

            {visibleMetrics.precipitation && (
              <Bar
                yAxisId="rain"
                dataKey="precipitation"
                fill="#3b82f6"
                name="Precipitation"
                barSize={timePeriod === "daily" ? 18 : 12}
                radius={[2, 2, 0, 0]}
              />
            )}
            {visibleMetrics.tempHigh && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="tempHigh"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Temp High"
              />
            )}
            {visibleMetrics.tempAvg && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="tempAvg"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Temp Avg"
              />
            )}
            {visibleMetrics.tempMin && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="tempMin"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Temp Min"
              />
            )}
            {visibleMetrics.wind && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="wind"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Wind"
              />
            )}
            {visibleMetrics.highHumidity && (
              <Line
                yAxisId="humidity"
                type="monotone"
                dataKey="highHumidity"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="High Humidity"
              />
            )}
            {visibleMetrics.lowHumidity && (
              <Line
                yAxisId="humidity"
                type="monotone"
                dataKey="lowHumidity"
                stroke="#84cc16"
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Low Humidity"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap justify-center gap-2 text-[10px] sm:text-xs">
        {(
          [
            ["precipitation", "Precipitation (mm)", "#3b82f6"],
            ["tempHigh", "Temp High (°C)", "#ef4444"],
            ["tempAvg", "Temp Avg (°C)", "#f59e0b"],
            ["tempMin", "Temp Min (°C)", "#06b6d4"],
            ["wind", "Wind (km/h)", "#8b5cf6"],
            ["highHumidity", "High Humidity (%)", "#22c55e"],
            ["lowHumidity", "Low Humidity (%)", "#84cc16"],
          ] as const
        ).map(([key, label, color]) => (
          <button
            key={key}
            type="button"
            onClick={() => handleLegendClick(key)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${
              visibleMetrics[key]
                ? "border-gray-300 bg-white text-gray-700"
                : "border-gray-200 bg-gray-50 text-gray-400"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-400">
        Live data · Open-Meteo (+ CropEye forecast when available) ·{" "}
        {timePeriod === "daily"
          ? "last 7 days (past)"
          : timePeriod === "weekly"
            ? "last 12 weeks"
            : timePeriod === "monthly"
              ? "last 12 complete months"
              : "last 5 years (annual totals)"}
      </p>
    </div>
  );
};

export default WeatherChart;
