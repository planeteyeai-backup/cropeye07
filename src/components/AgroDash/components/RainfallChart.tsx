import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  aggregateAgroWeatherSeries,
  type AgroTimePeriod,
  type AgroWeatherDay,
} from "../../../utils/agroWeatherApi";

interface RainfallChartProps {
  timePeriod: AgroTimePeriod;
  series?: AgroWeatherDay[];
  loading?: boolean;
  error?: string | null;
}

const RainfallChart: React.FC<RainfallChartProps> = ({
  timePeriod,
  series = [],
  loading = false,
  error = null,
}) => {
  const processedData = useMemo(
    () => aggregateAgroWeatherSeries(series, timePeriod),
    [series, timePeriod],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        Loading rainfall data…
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
        No rainfall data available for this area.
      </div>
    );
  }

  const totalRain = processedData.reduce((sum, row) => sum + row.rainfall, 0);
  const maxBar = Math.max(...processedData.map((row) => row.rainfall), 0);
  const maxDaily = Math.max(
    ...processedData.map((row) => row.maxDailyRainfall),
    0,
  );
  const rainyDays = processedData.reduce((sum, row) => sum + row.rainyDays, 0);
  const rainYMax = Math.max(Math.ceil(maxBar * 1.25), 5);

  return (
    <div className="relative rounded-lg bg-white p-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            key={timePeriod}
            data={processedData}
            margin={{ top: 10, right: 18, bottom: 0, left: -20 }}
          >
            <defs>
              <linearGradient id="rainfallGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10 }}
              angle={0}
              textAnchor="middle"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              domain={[0, rainYMax]}
              tickFormatter={(v) => `${v} mm`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              formatter={(value: number) => [`${Number(value).toFixed(1)} mm`, "Rainfall"]}
            />
            <Area
              type="monotone"
              dataKey="rainfall"
              stroke="#2563eb"
              fill="url(#rainfallGradient)"
              name="Rainfall (mm)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="font-semibold text-blue-600">
            {totalRain.toFixed(1)} mm
          </div>
          <div className="text-gray-500">Total Rain</div>
        </div>
        <div>
          <div className="font-semibold text-blue-600">{rainyDays}</div>
          <div className="text-gray-500">Rainy Days</div>
        </div>
        <div>
          <div className="font-semibold text-blue-600">
            {maxDaily.toFixed(1)} mm
          </div>
          <div className="text-gray-500">
            {timePeriod === "daily"
              ? "Max Daily"
              : timePeriod === "weekly"
                ? "Max Day (wk)"
                : timePeriod === "monthly"
                  ? "Max Day (mo)"
                  : "Max Day (yr)"}
          </div>
        </div>
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

export default RainfallChart;
