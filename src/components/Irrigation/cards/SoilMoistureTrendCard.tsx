import React, { useEffect, useMemo, useRef, useState } from "react";
import { CloudRain, Droplets, Gauge, Wind } from "lucide-react";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";

interface MoistureData {
  date: string;
  value: number;
  day: string;
  x: number;
  isCurrentDate?: boolean;
  rainfallMm?: number;
  rainfallProvisional?: boolean;
  etMm?: number;
}

interface SoilMoistureTrendCardProps {
  selectedPlotName?: string | null;
}

// New API response (9006) types
interface SoilMoistureStackItem {
  day: string; // e.g. "2025-09-24"
  soil_moisture: number; // percentage value 0-100
  rainfall_mm_yesterday: number;
  rainfall_provisional: boolean;
  et_mean_mm_yesterday: number;
}

interface SoilMoistureStackResponse {
  plot_name: string;
  latitude: number;
  longitude: number;
  soil_moisture_stack: SoilMoistureStackItem[];
}

const SoilMoistureTrendCard: React.FC<SoilMoistureTrendCardProps> = ({
  selectedPlotName,
}) => {
  const { appState, setAppState, setCached } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const data = appState.soilMoistureTrendData || [];
  const [loading, setLoading] = useState<boolean>(!data.length);
  const [error, setError] = useState<string | null>(null);
  const [currentDateMoisture, setCurrentDateMoisture] = useState<number | null>(
    null,
  );
  const [animateIn, setAnimateIn] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [plotName, setPlotName] = useState<string>("");
  const optimalMin = 60;
  const optimalMax = 80;
  const maxValue = 100;

  // Set plot name when profile loads
  useEffect(() => {
    if (selectedPlotName) {
      setPlotName(selectedPlotName);
      console.log(
        "SoilMoistureTrendCard: Using selected plot:",
        selectedPlotName,
      );
      return;
    }
    if (profile && !profileLoading) {
      // Priority order: fastapi_plot_id -> gat_number_plot_number -> first available farms[].farm_uid
      const plots = profile.plots || [];
      const fastapi = plots.find((p) => p.fastapi_plot_id)?.fastapi_plot_id;
      const gatCombo =
        !fastapi && plots.length
          ? `${plots[0].gat_number}_${plots[0].plot_number}`
          : null;
      const fallbackFarmUid =
        !fastapi && !gatCombo && plots[0]?.farms?.length
          ? plots[0].farms[0].farm_uid
          : null;
      const resolved = (
        fastapi ||
        gatCombo ||
        fallbackFarmUid ||
        ""
      ).toString();
      setPlotName(resolved);
      console.log(
        "SoilMoistureTrendCard: Resolved plot name:",
        resolved,
        "from profile",
      );
    }
  }, [profile, profileLoading, selectedPlotName]);

  // New endpoint utilities
  const fetchSoilMoistureStack = async (
    plot: string,
  ): Promise<SoilMoistureStackResponse> => {
    const base = "https://sef-cropeye.up.railway.app";
    const attempts: Array<{ url: string; init?: RequestInit; note: string }> = [
      {
        url: `${base}/soil-moisture/${encodeURIComponent(plot)}`,
        note: "GET path param",
      },
      {
        url: `${base}/soil-moisture/${encodeURIComponent(plot)}/`,
        note: "GET path param trailing slash",
      },
      {
        url: `${base}/soil-moisture?plot_name=${encodeURIComponent(plot)}`,
        note: "GET query param",
      },
      {
        url: `${base}/soil-moisture/${encodeURIComponent(plot)}`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        note: "POST path param",
      },
      {
        url: `${base}/soil-moisture`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plot_name: plot }),
        },
        note: "POST body JSON",
      },
    ];

    let lastErr: any = null;
    for (const attempt of attempts) {
      try {
        console.log("Fetching soil moisture stack:", attempt.note, attempt.url);
        const resp = await fetch(attempt.url, attempt.init);
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          console.warn("Attempt failed:", attempt.note, resp.status, body);
          lastErr = new Error(
            `HTTP ${resp.status}: ${body || resp.statusText}`,
          );
          continue;
        }
        const json = await resp.json();
        console.log(
          "Soil moisture raw response (via",
          attempt.note,
          "):",
          json,
        );
        return json;
      } catch (e) {
        console.warn("Attempt exception:", attempt.note, e);
        lastErr = e;
      }
    }
    throw lastErr || new Error("All soil moisture fetch attempts failed");
  };

  // Get current date in YYYY-MM-DD format
  const getCurrentDate = (): string => {
    return new Date().toISOString().split("T")[0];
  };

  // Map new endpoint response to chart data
  const mapStackToWeekData = (
    stack: SoilMoistureStackItem[],
  ): MoistureData[] => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayStr = getCurrentDate();
    // Keep only last 7 records; ensure sorted by day asc
    const sorted = [...stack]
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-7);
    return sorted.map((item, idx) => {
      const d = new Date(item.day);
      return {
        date: item.day,
        value: parseFloat(item.soil_moisture.toFixed(2)),
        day: dayNames[d.getDay()],
        x: idx,
        isCurrentDate: item.day === todayStr,
        rainfallMm: Number.isFinite(item.rainfall_mm_yesterday)
          ? Number(item.rainfall_mm_yesterday)
          : 0,
        rainfallProvisional: Boolean(item.rainfall_provisional),
        etMm: Number.isFinite(item.et_mean_mm_yesterday)
          ? Number(item.et_mean_mm_yesterday)
          : 0,
      } as MoistureData;
    });
  };

  const fetchWeeklyTrend = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch from new 9006 endpoint
      if (!plotName) throw new Error("Missing plot name");
      const apiResp = await fetchSoilMoistureStack(plotName);
      console.log("SoilMoisture API response:", apiResp);
      if (
        !apiResp?.soil_moisture_stack ||
        !Array.isArray(apiResp.soil_moisture_stack)
      ) {
        throw new Error("Invalid API shape: soil_moisture_stack missing");
      }
      const weekData = mapStackToWeekData(apiResp.soil_moisture_stack);
      console.log("Mapped week data:", weekData);

      setAppState((prev: any) => ({
        ...prev,
        soilMoistureTrendData: weekData,
      }));

      setCached(`soilMoistureTrend_${plotName}`, weekData);

      // kick animations after data render
      setAnimateIn(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true));
      });

      // Set current date moisture for the header indicator
      const todayStr = getCurrentDate();
      const todayItem = apiResp.soil_moisture_stack.find(
        (item) => item.day === todayStr,
      );
      if (todayItem)
        setCurrentDateMoisture(parseFloat(todayItem.soil_moisture.toFixed(2)));
    } catch (err: any) {
      console.error("Failed to fetch moisture trend data:", err);
      setError(`Unable to load soil moisture trend: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!plotName) return;
    fetchWeeklyTrend();
  }, [plotName]);

  const chartWidth = 1200;
  const chartHeight = 320;
  const leftPadding = 64;
  const rightPadding = 64;
  const topPadding = 34;
  const bottomPadding = 74;

  const getX = (index: number) =>
    leftPadding + ((chartWidth - leftPadding - rightPadding) / 6) * index;

  const getY = (value: number) =>
    topPadding +
    (chartHeight - topPadding - bottomPadding) * (1 - value / maxValue);

  const plotW = chartWidth - leftPadding - rightPadding;
  const plotH = chartHeight - topPadding - bottomPadding;

  const { todayPoint, maxRain, maxEt } = useMemo(() => {
    const arr = (data as MoistureData[]) || [];
    const today = arr.find((p) => p.isCurrentDate) || arr[arr.length - 1];
    const rainMax = Math.max(1, ...arr.map((p) => Math.max(0, p.rainfallMm ?? 0)));
    const etMax = Math.max(1, ...arr.map((p) => Math.max(0, p.etMm ?? 0)));
    return { todayPoint: today, maxRain: rainMax, maxEt: etMax };
  }, [data]);

  const getRainY = (mm: number) => {
    const clamped = Math.max(0, Math.min(maxRain, mm));
    const pct = maxRain ? clamped / maxRain : 0;
    return topPadding + plotH * (1 - pct);
  };

  const getEtY = (mm: number) => {
    const clamped = Math.max(0, Math.min(maxEt, mm));
    const pct = maxEt ? clamped / maxEt : 0;
    return topPadding + plotH * (1 - pct);
  };

  const linePath = (data as MoistureData[])
    .map((point: MoistureData, i: number) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(point.value)}`)
    .join(" ");

  const etPath = (data as MoistureData[])
    .map((point: MoistureData, i: number) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getEtY(point.etMm ?? 0)}`)
    .join(" ");

  const areaPath = [
    linePath,
    `L ${getX((data as MoistureData[]).length - 1)} ${getY(0)}`,
    `L ${getX(0)} ${getY(0)}`,
    "Z",
  ].join(" ");

  const gridLines = Array.from({ length: 6 }).map((_, i) => {
    const value = i * 20;
    const y = getY(value);
    return (
      <g key={i}>
        <line
          x1={leftPadding}
          y1={y}
          x2={chartWidth - rightPadding}
          y2={y}
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <text
          x={leftPadding - 10}
          y={y + 4}
          textAnchor="end"
          fontSize="14" // Increased from 12
          fill="#64748b"
          fontWeight="600" // Added bold
        >
          {value}%
        </text>
      </g>
    );
  });

  const moistureStatus = useMemo(() => {
    const v = todayPoint?.value ?? currentDateMoisture ?? null;
    if (v == null) return { label: "—", tone: "gray" as const };
    if (v < 40) return { label: "Low", tone: "red" as const };
    if (v <= 80) return { label: "Good", tone: "green" as const };
    return { label: "High", tone: "blue" as const };
  }, [todayPoint, currentDateMoisture]);

  const recommendation = useMemo(() => {
    const m = todayPoint?.value ?? currentDateMoisture ?? null;
    const rain = todayPoint?.rainfallMm ?? 0;
    const et = todayPoint?.etMm ?? 0;

    if (m == null) {
      return {
        title: "Moisture trend",
        subtitle: "Select a plot to see weekly moisture + rainfall + ET.",
        tone: "gray" as const,
      };
    }

    if (m < 40 && rain < 2 && et >= 4) {
      return {
        title: "Action: Irrigate today",
        subtitle: "Moisture is low, rainfall was low, and ET is high.",
        tone: "red" as const,
      };
    }
    if (m < 40 && rain < 5) {
      return {
        title: "Action: Consider irrigation",
        subtitle: "Moisture is low and rainfall is not enough.",
        tone: "orange" as const,
      };
    }
    if (m >= optimalMin && m <= optimalMax) {
      return {
        title: "Action: Maintain",
        subtitle: "Moisture is in the optimal range.",
        tone: "green" as const,
      };
    }
    if (m > 80 && rain >= 5) {
      return {
        title: "Action: Avoid irrigation",
        subtitle: "Moisture is high and rainfall is strong.",
        tone: "blue" as const,
      };
    }
    if (m > 80) {
      return {
        title: "Action: Monitor",
        subtitle: "Moisture is high; irrigate only if it drops.",
        tone: "blue" as const,
      };
    }
    return {
      title: "Action: Monitor",
      subtitle: "Keep watching the trend for the next 2–3 days.",
      tone: "gray" as const,
    };
  }, [todayPoint, currentDateMoisture, optimalMin, optimalMax]);

  const toneClasses: Record<
    "red" | "orange" | "green" | "blue" | "gray",
    { chip: string; border: string; icon: string; bg: string }
  > = {
    red: {
      chip: "bg-red-100 text-red-800 border-red-200",
      border: "border-red-200",
      icon: "text-red-600",
      bg: "bg-gradient-to-br from-red-50 to-white",
    },
    orange: {
      chip: "bg-orange-100 text-orange-800 border-orange-200",
      border: "border-orange-200",
      icon: "text-orange-600",
      bg: "bg-gradient-to-br from-orange-50 to-white",
    },
    green: {
      chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
      border: "border-emerald-200",
      icon: "text-emerald-600",
      bg: "bg-gradient-to-br from-emerald-50 to-white",
    },
    blue: {
      chip: "bg-blue-100 text-blue-800 border-blue-200",
      border: "border-blue-200",
      icon: "text-blue-600",
      bg: "bg-gradient-to-br from-blue-50 to-white",
    },
    gray: {
      chip: "bg-gray-100 text-gray-700 border-gray-200",
      border: "border-gray-200",
      icon: "text-gray-600",
      bg: "bg-gradient-to-br from-gray-50 to-white",
    },
  };

  const hoveredPoint = useMemo(() => {
    if (hoverIndex == null) return null;
    const arr = data as MoistureData[];
    return arr?.[hoverIndex] ?? null;
  }, [data, hoverIndex]);

  const formatShortDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <div className="soil-moisture-trend-card flex flex-col min-h-0">
      {/* Action + KPIs */}
      
      <div
        className={`rounded-xl border ${toneClasses[recommendation.tone].border} ${toneClasses[recommendation.tone].bg} p-3 sm:p-4`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Droplets className="h-5 w-5 text-blue-600" />
            Soil Moisture Trend
          </h3>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Gauge className={`h-5 w-5 ${toneClasses[recommendation.tone].icon}`} />
              <div className="text-sm sm:text-base font-bold text-gray-900">
                {recommendation.title}
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${toneClasses[moistureStatus.tone].chip}`}
              >
                {moistureStatus.label}
              </span>
            </div>
            <div className="mt-1 text-xs sm:text-sm text-gray-700">
              {recommendation.subtitle}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs font-semibold text-gray-800">
              <Droplets className="h-4 w-4 text-blue-600" />
              {(todayPoint?.value ?? currentDateMoisture ?? 0).toFixed(1)}%
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs font-semibold text-gray-800">
              <CloudRain className="h-4 w-4 text-sky-600" />
              {(todayPoint?.rainfallMm ?? 0).toFixed(1)}mm
              {todayPoint?.rainfallProvisional ? (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                  provisional
                </span>
              ) : null}
            </span>
            {/* <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs font-semibold text-gray-800">
              <Wind className="h-4 w-4 text-indigo-600" />
              {(todayPoint?.etMm ?? 0).toFixed(1)} ET
            </span> */}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs font-semibold text-gray-700">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-700" />
            Moisture %
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
            Rain (mm)
          </span>    
          <span className="ml-auto text-gray-600">
            Optimal moisture: {optimalMin}-{optimalMax}%
          </span>
        </div>
      </div>

      {loading && (
        <div className="irrigation-loading">
          <div className="loading-spinner-small"></div>
          <p>Loading soil moisture data...</p>
        </div>
      )}

      {error && <div className="error-message-small">{error}</div>}

      {!loading && !error && data.length > 0 && (
        <>
          <div
            ref={chartWrapRef}
            className="mt-3 flex-1 w-full relative aspect-square sm:aspect-[2.1/1] md:aspect-[2.8/1]"
          >
            {/* Floating tooltip */}
            {hoveredPoint && tooltipPos && (
              <div
                className="pointer-events-none absolute z-20 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur-sm"
                style={(() => {
                  const wrap = chartWrapRef.current?.getBoundingClientRect();
                  const maxW = wrap?.width ?? 320;
                  const maxH = wrap?.height ?? 200;
                  const tipW = 220;
                  const tipH = 98;
                  const x = Math.max(8, Math.min(maxW - tipW - 8, tooltipPos.x + 10));
                  const y = Math.max(8, Math.min(maxH - tipH - 8, tooltipPos.y - 10 - tipH));
                  return { left: x, top: y, width: tipW };
                })()}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-gray-900">
                    {hoveredPoint.day} • {formatShortDate(hoveredPoint.date)}
                  </div>
                  {hoveredPoint.isCurrentDate ? (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                      Today
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-amber-50 px-2 py-1 border border-amber-100">
                    <div className="text-[10px] font-semibold text-amber-800">
                      Moisture
                    </div>
                    <div className="font-extrabold text-amber-900">
                      {hoveredPoint.value.toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-lg bg-sky-50 px-2 py-1 border border-sky-100">
                    <div className="text-[10px] font-semibold text-sky-800">
                      Rain
                    </div>
                    <div className="font-extrabold text-sky-900">
                      {(hoveredPoint.rainfallMm ?? 0).toFixed(1)}mm
                    </div>
                    {hoveredPoint.rainfallProvisional ? (
                      <div className="text-[9px] font-bold text-amber-700">
                        provisional
                      </div>
                    ) : (
                      <div className="text-[9px] text-sky-700 opacity-70"> </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <svg
              className="absolute inset-0 w-full h-full"
              width="100%"
              viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient
                  id="areaGradient"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#B45309" stopOpacity="0.35" />
                  <stop offset="40%" stopColor="#D97706" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.04" />
                </linearGradient>
                <linearGradient id="rainGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.78" />
                  <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.12" />
                </linearGradient>
                <style>
                  {`
                    @keyframes smPulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
                  `}
                </style>
              </defs>

              {/* Optimal range background (60-80% soil moisture) */}
              <rect
                x={leftPadding}
                y={getY(optimalMax)}
                width={chartWidth - leftPadding - rightPadding}
                height={getY(optimalMin) - getY(optimalMax)}
                fill="rgba(16, 185, 129, 0.14)"
              />

              {/* Soil moisture interpretation zones */}
              {/* Low moisture zone (0-40%) - Darker red */}
              <rect
                x={leftPadding}
                y={getY(40)}
                width={chartWidth - leftPadding - rightPadding}
                height={getY(0) - getY(40)}
                fill="rgba(239, 68, 68, 0.10)"
              />

              {/* High moisture zone (80-100%) - Darker blue */}
              <rect
                x={leftPadding}
                y={getY(100)}
                width={chartWidth - leftPadding - rightPadding}
                height={getY(80) - getY(100)}
                fill="rgba(59, 130, 246, 0.10)"
              />

              {/* Grid lines and Y-axis labels (0%, 20%, 40%, 60%, 80%, 100%) */}
              {gridLines}

              {/* Hover guideline */}
              {hoverIndex != null && (
                <line
                  x1={getX(hoverIndex)}
                  x2={getX(hoverIndex)}
                  y1={topPadding}
                  y2={chartHeight - bottomPadding}
                  stroke="rgba(148,163,184,0.65)"
                  strokeWidth={2}
                  strokeDasharray="6 8"
                />
              )}

              {/* Right axis labels for mm (rain/ET) */}
              <text
                x={chartWidth - rightPadding + 8}
                y={topPadding - 10}
                textAnchor="start"
                fontSize="12"
                fill="#64748b"
                fontWeight="700"
              >
                mm
              </text>
              <text
                x={chartWidth - rightPadding + 8}
                y={getRainY(maxRain) + 4}
                textAnchor="start"
                fontSize="12"
                fill="#64748b"
                fontWeight="600"
              >
                {maxRain.toFixed(0)}
              </text>
              <text
                x={chartWidth - rightPadding + 8}
                y={getRainY(0) + 4}
                textAnchor="start"
                fontSize="12"
                fill="#94a3b8"
                fontWeight="600"
              >
                0
              </text>

              {/* Rainfall bars */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) => {
                const barW = Math.max(18, plotW / 18);
                const x = getX(i) - barW / 2;
                const rain = Math.max(0, point.rainfallMm ?? 0);
                const y = getRainY(rain);
                const h = getRainY(0) - y;
                const growH = animateIn ? h : 0;
                const growY = animateIn ? y : getRainY(0);
                return (
                  <g key={`rain-${i}`}>
                    <rect
                      x={x}
                      y={growY}
                      width={barW}
                      height={growH}
                      fill="url(#rainGradient)"
                      stroke={point.rainfallProvisional ? "#F59E0B" : "rgba(14,165,233,0.35)"}
                      strokeWidth={point.rainfallProvisional ? 2 : 1}
                      rx={6}
                      style={{
                        transition: "all 900ms cubic-bezier(0.2, 0.9, 0.2, 1)",
                        transitionDelay: `${i * 55}ms`,
                      }}
                      opacity={0.9}
                    />
                    {point.rainfallProvisional ? (
                      <line
                        x1={x + 3}
                        y1={growY + 6}
                        x2={x + barW - 3}
                        y2={growY + 6}
                        stroke="#F59E0B"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        opacity={0.9}
                      />
                    ) : null}
                  </g>
                );
              })}

              {/* Area fill */}
              <path
                d={areaPath}
                fill="url(#areaGradient)"
                opacity={animateIn ? 1 : 0}
                style={{ transition: "opacity 700ms ease" }}
              />

              {/* ET dashed line */}
              <path
                d={etPath}
                fill="none"
                stroke="#4F46E5"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                opacity={animateIn ? 0.9 : 0}
                style={{ transition: "opacity 700ms ease 150ms" }}
              />

              {/* Line */}
              <path
                d={linePath}
                fill="none"
                stroke="#B45309"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  filter: "drop-shadow(0 6px 12px rgba(180,83,9,0.18))",
                }}
              />

              {/* Data points */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) => (
                <circle
                  key={`point-${i}`}
                  cx={getX(i)}
                  cy={getY(point.value)}
                  r={point.isCurrentDate ? "8" : "6"}
                  fill={point.isCurrentDate ? "#22C55E" : "#D97706"}
                  stroke={point.isCurrentDate ? "#16A34A" : "#FFEDD5"}
                  strokeWidth="3"
                  opacity={animateIn ? 1 : 0}
                  style={{
                    transition: "opacity 500ms ease 250ms, transform 500ms ease 250ms",
                    transformOrigin: `${getX(i)}px ${getY(point.value)}px`,
                    transform: animateIn ? "scale(1)" : "scale(0.85)",
                  }}
                />
              ))}

              {/* Special highlight for current date */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) =>
                point.isCurrentDate ? (
                  <circle
                    key={`current-highlight-${i}`}
                    cx={getX(i)}
                    cy={getY(point.value)}
                    r="12"
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth="2"
                    strokeDasharray="4,4"
                    opacity="0.8"
                    style={{
                      animation: animateIn ? "smPulse 1.4s ease-in-out infinite" : undefined,
                    }}
                  />
                ) : null,
              )}

              {/* Day labels */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) => (
                <text
                  key={`label-${i}`}
                  x={getX(i)}
                  y={chartHeight + 25}
                  textAnchor="middle"
                  fontSize="18" // Increased from 14
                  fill={point.isCurrentDate ? "#22C55E" : "#64748b"}
                  fontWeight={point.isCurrentDate ? "700" : "600"} // Increased weight
                >
                  {point.day}
                  {point.isCurrentDate && " (Today)"}
                </text>
              ))}

              {/* Date labels */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) => (
                <text
                  key={`date-${i}`}
                  x={getX(i)}
                  y={chartHeight + 40}
                  textAnchor="middle"
                  fontSize="18" // Increased from 11
                  fill={point.isCurrentDate ? "#22C55E" : "#94a3b8"}
                  fontWeight={point.isCurrentDate ? "600" : "500"} // Increased weight
                >
                  {new Date(point.date).getDate()}/
                  {new Date(point.date).getMonth() + 1}
                </text>
              ))}

              {/* Value labels with better visibility */}
              {(data as MoistureData[]).map((point: MoistureData, i: number) => (
                <g key={`value-group-${i}`}>
                  {/* Background for value text */}
                  <rect
                    x={getX(i) - 22} // Slightly wider for larger text
                    y={getY(point.value) - 28} // Adjusted for larger text
                    width="44"
                    height="20" // Increased height
                    fill={point.isCurrentDate ? "#22C55E" : "#B45309"}
                    fillOpacity="0.1"
                    rx="10"
                  />
                  {/* Value text */}
                  <text
                    x={getX(i)}
                    y={getY(point.value) - (point.isCurrentDate ? 22 : 17)}
                    textAnchor="middle"
                    fontSize={point.isCurrentDate ? "16" : "14"} // Increased from 14 and 12
                    fill={point.isCurrentDate ? "#22C55E" : "#B45309"}
                    fontWeight="700"
                  >
                    {point.value}%{point.isCurrentDate && ""}
                  </text>
                </g>
              ))}

              <text
                x={leftPadding}
                y={topPadding - 10}
                textAnchor="start"
                fontSize="12"
                fill="#64748b"
                fontWeight="700"
              >
                Moisture % • Rain (mm)
              
              </text>

              {/* Invisible hitboxes for tooltip */}
              {(data as MoistureData[]).map((_point: MoistureData, i: number) => {
                const w = plotW / 7;
                const x = leftPadding + w * i;
                return (
                  <rect
                    key={`hit-${i}`}
                    x={x}
                    y={topPadding}
                    width={w}
                    height={chartHeight - topPadding - bottomPadding}
                    fill="transparent"
                    style={{ cursor: "default" }}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => {
                      setHoverIndex(null);
                      setTooltipPos(null);
                    }}
                    onMouseMove={(e) => {
                      const rect = chartWrapRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setTooltipPos({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                    }}
                    onTouchStart={(e) => {
                      const t = e.touches?.[0];
                      const rect = chartWrapRef.current?.getBoundingClientRect();
                      if (!t || !rect) return;
                      setHoverIndex(i);
                      setTooltipPos({
                        x: t.clientX - rect.left,
                        y: t.clientY - rect.top,
                      });
                    }}
                    onTouchMove={(e) => {
                      const t = e.touches?.[0];
                      const rect = chartWrapRef.current?.getBoundingClientRect();
                      if (!t || !rect) return;
                      setTooltipPos({
                        x: t.clientX - rect.left,
                        y: t.clientY - rect.top,
                      });
                    }}
                  />
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
};
export default SoilMoistureTrendCard;
