import React, { useState, useEffect } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  ReferenceArea,
  Scatter,
  ComposedChart,
  PieChart,
  Pie,
} from "recharts";
import {
  Calendar,
  TrendingUp,
  Droplets,
  Thermometer,
  Activity,
  Target,
  Leaf,
  LineChart as LineChartIcon,
  Users,
  MapPin,
  Beaker,
  MessageCircle,
} from "lucide-react";
import Chatbot from "./Chatbot";
import axios from "axios";
import { eventsApi, getSinglePlotAgroStats } from "../api";
import { getCache, setCache } from "../utils/cache";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { useAppContext } from "../context/AppContext";
import CommonSpinner from "./CommanSpinner";
import { useI18nLite } from "../i18nLite.ts";

// Type definitions
interface PieChartWithNeedleProps {
  value: number;
  max: number;
  width?: number;
  height?: number;
  title?: string;
  unit?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

interface CustomStressDotProps {
  cx?: number;
  cy?: number;
  payload?: any;
}

interface LineChartData {
  date: string;
  growth: number;
  stress: number;
  water: number;
  moisture: number;
  stressLevel?: number | null;
  isStressEvent?: boolean;
  stressEventData?: any;
}

interface Metrics {
  brix: number | null;
  brixMin: number | null;
  brixMax: number | null;
  recovery: number | null;
  area: number | null;
  biomass: number | null;
  totalBiomass: number | null;
  stressCount: number | null;
  irrigationEvents: number | null;
  sugarYieldMean: number | null;
  daysToHarvest: number | null;
  growthStage: string | null;
  soilPH: number | null;
  organicCarbonDensity: number | null;
  actualYield: number | null;
  cnRatio: number | null;
  sugarYieldMax: number | null;
  sugarYieldMin: number | null;
}

interface VisibleLines {
  growth: boolean;
  stress: boolean;
  water: boolean;
  moisture: boolean;
}

interface LineStyles {
  [key: string]: {
    color: string;
    label: string;
  };
}

interface StressEvent {
  from_date: string;
  to_date: string;
  stress: number;
}

type TimePeriod = "daily" | "weekly" | "monthly" | "yearly";

// Enhanced PieChartWithNeedle component for gauge-style visualization
const PieChartWithNeedle: React.FC<PieChartWithNeedleProps> = ({
  value,
  max,
  width = 60,
  height = 100,
  title = "Gauge",
  unit = "",
}) => {
  const percent = Math.max(0, Math.min(1, value / max));
  const angle = 180 * percent;
  const cx = width / 2;
  const cy = height * 0.9;
  const r = width * 0.35;
  const needleLength = r * 0.9;
  const needleAngle = 180 - angle;
  const rad = (Math.PI * needleAngle) / 180;
  const x = cx + needleLength * Math.cos(rad);
  const y = cy - needleLength * Math.sin(rad);

  const getColor = (percent: number): string => {
    if (percent < 0.3) return "#ef4444";
    if (percent < 0.6) return "#f97316";
    if (percent < 0.8) return "#eab308";
    return "#800080";
  };

  return (
    <div className="flex flex-col items-center">
      <svg width={width} height={height} className="overflow-visible">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="6"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${
            cx + r * Math.cos(Math.PI - (angle * Math.PI) / 180)
          } ${cy - r * Math.sin(Math.PI - (angle * Math.PI) / 180)}`}
          fill="none"
          stroke={getColor(percent)}
          strokeWidth="6"
          strokeLinecap="round"
        />
        <line
          x1={cx}
          y1={cy}
          x2={x}
          y2={y}
          stroke="#374151"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="3" fill="#374151" />
        <text
          x={cx}
          y={cy - r - 8}
          textAnchor="middle"
          className="text-sm font-semibold fill-gray-700"
        >
          {value.toFixed(1)}
          {unit}
        </text>
      </svg>
      <p className="text-xs text-gray-600 mt-1 text-center">{title}</p>
    </div>
  );
};

const BASE_URL = "https://events-cropeye.up.railway.app";
// const OPTIMAL_BIOMASS = 150;
const SOIL_API_URL = "https://main-cropeye.up.railway.app";
const SOIL_DATE = "2025-10-03";

const OTHER_FARMERS_RECOVERY = {
  regional_average: 7.85,
  top_quartile: 8.52,
  bottom_quartile: 6.58,
  similar_farms: 7.63,
};

const FarmerDashboard: React.FC = () => {
  const { t } = useI18nLite();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const { selectedPlotName, setSelectedPlotName } = useAppContext();

  const [currentPlotId, setCurrentPlotId] = useState<string | null>(null);
  const [showDebugInfo] = useState(false);
  const [lineChartData, setLineChartData] = useState<LineChartData[]>([]);
  const [visibleLines, setVisibleLines] = useState<VisibleLines>({
    growth: true,
    stress: true,
    water: true,
    moisture: true,
  });

  const [metrics, setMetrics] = useState<Metrics>({
    brix: null,
    brixMin: null,
    brixMax: null,
    recovery: null,
    area: null,
    biomass: null,
    totalBiomass: null,
    stressCount: null,
    irrigationEvents: null,
    sugarYieldMean: null,
    daysToHarvest: null,
    growthStage: null,
    soilPH: null,
    organicCarbonDensity: null,
    actualYield: null,
    cnRatio: null,
    sugarYieldMax: null,
    sugarYieldMin: null,
  });

  // Mobile layout flag for charts
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const [stressEvents, setStressEvents] = useState<StressEvent[]>([]);
  const [showStressEvents] = useState<boolean>(false);
  const [ndreStressEvents, setNdreStressEvents] = useState<StressEvent[]>([]);
  const [showNDREEvents, setShowNDREEvents] = useState<boolean>(false);
  const [combinedChartData, setCombinedChartData] = useState<LineChartData[]>(
    []
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("weekly");
  const [aggregatedData, setAggregatedData] = useState<LineChartData[]>([]);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  const lineStyles: LineStyles = {
    growth: {
      color: "#22c55e",
      label: t("farmerDashboard.lineStyles.growth", {
        defaultValue: "Growth Index",
      }),
    },
    stress: {
      color: "#ef4444",
      label: t("farmerDashboard.lineStyles.stress", {
        defaultValue: "Stress Index",
      }),
    },
    water: {
      color: "#3b82f6",
      label: t("farmerDashboard.lineStyles.water", {
        defaultValue: "Water Index",
      }),
    },
    moisture: {
      color: "#f59e0b",
      label: t("farmerDashboard.lineStyles.moisture", {
        defaultValue: "Moisture Index",
      }),
    },
  };

  useEffect(() => {
    if (!profile || profileLoading) return;

    const plotNames = profile.plots?.map((plot) => plot.fastapi_plot_id) || [];
    const savedPlot = localStorage.getItem("selectedPlot");
    const savedIsValid = savedPlot && plotNames.includes(savedPlot);
    const plotToUse = savedIsValid ? savedPlot : (plotNames.length > 0 ? plotNames[0] : null);

    if (plotToUse) {
      setCurrentPlotId(plotToUse);
      setSelectedPlotName(plotToUse);
      if (!savedIsValid) localStorage.setItem("selectedPlot", plotToUse);
    }
  }, [profile, profileLoading]);

  useEffect(() => {
    if (currentPlotId && !profileLoading) {
      console.log(
        "🔄 FarmerDashboard: Fetching dashboard data for plot:",
        currentPlotId
      );
      fetchAllData();
    }
  }, [currentPlotId, profileLoading]);

  useEffect(() => {
    if (lineChartData.length > 0) {
      const aggregated = aggregateDataByPeriod(lineChartData, timePeriod);
      setAggregatedData(aggregated);
    }
  }, [lineChartData, timePeriod]);

  const aggregateDataByPeriod = (
    data: LineChartData[],
    period: TimePeriod
  ): LineChartData[] => {
    if (period === "daily") {
      if (data.length < 2) return data;
      const sorted = [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const last = sorted[sorted.length - 1];
      const secondLast = sorted[sorted.length - 2];
      return [secondLast, last];
    }

    const groupedData: { [key: string]: LineChartData[] } = {};

    data.forEach((item) => {
      const date = new Date(item.date);
      let key: string;

      switch (period) {
        case "weekly":
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
          break;
        case "monthly":
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
            2,
            "0"
          )}`;
          break;
        case "yearly":
          return;
        default:
          key = item.date;
      }

      if (!groupedData[key]) {
        groupedData[key] = [];
      }
      groupedData[key].push(item);
    });

    if (period === "yearly") {
      return [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    }

    const rows = Object.entries(groupedData)
      .map(([key, items]) => {
        const avgGrowth =
          items.reduce((sum, item) => sum + item.growth, 0) / items.length;
        const avgStress =
          items.reduce((sum, item) => sum + item.stress, 0) / items.length;
        const avgWater =
          items.reduce((sum, item) => sum + item.water, 0) / items.length;
        const avgMoisture =
          items.reduce((sum, item) => sum + item.moisture, 0) / items.length;

        let displayDate: string;
        if (period === "monthly") {
          const [year, month] = key.split("-");
          displayDate = new Date(
            parseInt(year),
            parseInt(month) - 1
          ).toLocaleDateString("en-US", { month: "short", year: "numeric" });
        } else {
          displayDate = key;
        }

        return {
          date: key,
          displayDate,
          growth: avgGrowth,
          stress: avgStress,
          water: avgWater,
          moisture: avgMoisture,
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Weekly: only current calendar week and previous calendar week (same week-start rule as grouping).
    if (period === "weekly") {
      const today = new Date();
      const currentWeekStart = new Date(today);
      currentWeekStart.setDate(today.getDate() - today.getDay());
      const previousWeekStart = new Date(currentWeekStart);
      previousWeekStart.setDate(previousWeekStart.getDate() - 7);
      const allowed = new Set([
        currentWeekStart.toISOString().split("T")[0],
        previousWeekStart.toISOString().split("T")[0],
      ]);
      return rows.filter((r) => allowed.has(r.date));
    }

    // Monthly: only current calendar month and previous calendar month.
    if (period === "monthly") {
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthKey = `${prevMonthDate.getFullYear()}-${String(
        prevMonthDate.getMonth() + 1
      ).padStart(2, "0")}`;
      const allowed = new Set([currentMonthKey, previousMonthKey]);
      return rows.filter((r) => allowed.has(r.date));
    }

    return rows;
  };

  const fetchAllData = async (): Promise<void> => {
    if (!currentPlotId) {
      console.warn("⚠️ FarmerDashboard: No plot ID available");
      return;
    }

    try {
      const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
      const endDate = new Date(Date.now() - tzOffsetMs)
        .toISOString()
        .slice(0, 10);

      const indicesCacheKey = `indices_${currentPlotId}`;
      let rawIndices = getCache(indicesCacheKey);

      if (!rawIndices) {
        const indicesRes = await eventsApi.get(
          `${BASE_URL}/plots/${currentPlotId}/indices`
        );
        rawIndices = indicesRes.data.map((item: any) => ({
          date: new Date(item.date).toISOString().split("T")[0],
          growth: item.NDVI,
          stress: item.NDMI,
          water: item.NDWI,
          moisture: item.NDRE,
        }));
        setCache(indicesCacheKey, rawIndices);
      }

      setLineChartData(rawIndices);

      const stressCacheKey = `stress_${currentPlotId}_NDMI_0.15`;
      let stressData = getCache(stressCacheKey);

      if (!stressData) {
        const stressRes = await eventsApi.get(
          `${BASE_URL}/plots/${currentPlotId}/stress?index_type=NDRE&threshold=0.15`
        );
        stressData = stressRes.data;
        setCache(stressCacheKey, stressData);
      }

      setStressEvents(stressData?.events ?? []);

      const irrigationCacheKey = `irrigation_${currentPlotId}`;
      let irrigationData = getCache(irrigationCacheKey);

      if (!irrigationData) {
        const irrigationRes = await eventsApi.get(
          `${BASE_URL}/plots/${currentPlotId}/irrigation?threshold_ndmi=0.05&threshold_ndwi=0.05&min_days_between_events=10`
        );
        irrigationData = irrigationRes.data;
        setCache(irrigationCacheKey, irrigationData);
      }

      const soilCacheKey = `soil_${currentPlotId}_${SOIL_DATE}`;
      let soilData = getCache(soilCacheKey);

      if (!soilData) {
        const res = await axios.post(
          `${SOIL_API_URL}/analyze?plot_name=${currentPlotId}&date=${SOIL_DATE}&fe_days_back=30`
        );
        soilData = res.data;
        setCache(soilCacheKey, soilData);
      }

      // Fetch harvest status from sugarcane-harvest endpoint
      const harvestCacheKey = `harvest_${currentPlotId}_${endDate}`;
      let harvestStatus = null;
      let harvestData = getCache(harvestCacheKey);
      let harvestDate = null;
      let isHarvested = false;

      if (!harvestData) {
        try {
          const harvestRes = await eventsApi.post(
            `${BASE_URL}/sugarcane-harvest?plot_name=${currentPlotId}&end_date=${endDate}`
          );
          harvestData = harvestRes.data;
          setCache(harvestCacheKey, harvestData);
        } catch (harvestErr) {
          console.error("Error fetching harvest status:", harvestErr);
        }
      }

      // Extract harvest_status and harvest_date from response
      if (harvestData) {
        const harvestProperties =
          harvestData?.features?.[0]?.properties ||
          harvestData?.harvest_summary;
        
        harvestStatus =
          harvestProperties?.harvest_status ||
          harvestData?.harvest_summary?.harvest_status ||
          null;
        
        harvestDate = harvestProperties?.harvest_date || null;
        isHarvested =
          harvestProperties?.has_harvest === true &&
          harvestProperties?.harvest_status === "harvested";
      }

      // Determine which date to use for fetching yield data
      // For harvested plots, use harvest_date; for others, use end_date
      const yieldDataDate = isHarvested && harvestDate ? harvestDate : endDate;

      // Prefer new single-plot agro stats endpoint for better performance
      const singlePlotCacheKey = `agroSingle_v1_${currentPlotId}_${yieldDataDate}`;
      let currentPlotData = getCache(singlePlotCacheKey);

      if (!currentPlotData) {
        try {
          currentPlotData = await getSinglePlotAgroStats(currentPlotId);
          setCache(singlePlotCacheKey, currentPlotData);
        } catch (singleErr) {
          console.error(
            "Error fetching single-plot agroStats, falling back to bulk agroStats:",
            singleErr,
          );

          // Fallback to older bulk agroStats endpoint if new one fails
          const agroStatsCacheKey = `agroStats_v3_${yieldDataDate}`;
          const agroStatsUrl = `https://events-cropeye.up.railway.app/plots/agroStats?end_date=${yieldDataDate}`;

          let allPlotsData = getCache(agroStatsCacheKey);

          if (!allPlotsData) {
            try {
              const agroStatsRes = await eventsApi.get(agroStatsUrl);
              allPlotsData = agroStatsRes.data;
              setCache(agroStatsCacheKey, allPlotsData);
            } catch (err) {
              console.error("Error fetching agroStats:", err);
              allPlotsData = null;
            }
          }

          if (allPlotsData) {
            currentPlotData = allPlotsData[currentPlotId];
            if (!currentPlotData) {
              const quotedPlotId = `"${currentPlotId}"`;
              currentPlotData = allPlotsData[quotedPlotId];
            }
          }
        }
      }

      // const stats = soilData?.features?.[0]?.properties?.statistics;
      const sugarYieldMeanValue =
        currentPlotData?.brix_sugar?.sugar_yield?.mean ?? null;

      let calculatedBiomass = null;
      let totalBiomassForMetric = null;

      if (sugarYieldMeanValue !== null) {
        const totalBiomass = sugarYieldMeanValue * 1.27;
        const underGroundBiomassInTons = totalBiomass * 0.12;
        calculatedBiomass = underGroundBiomassInTons;
        totalBiomassForMetric = totalBiomass;
      }

      const newMetrics = {
        brix: currentPlotData?.brix_sugar?.brix?.mean ?? null,
        brixMin: currentPlotData?.brix_sugar?.brix?.min ?? null,
        brixMax: currentPlotData?.brix_sugar?.brix?.max ?? null,
        recovery: currentPlotData?.brix_sugar?.recovery?.mean ?? null,
        area: currentPlotData?.area_acres ?? null,
        biomass: calculatedBiomass,
        totalBiomass: totalBiomassForMetric,
        daysToHarvest: currentPlotData?.days_to_harvest ?? null,
        growthStage: harvestStatus || currentPlotData?.Sugarcane_Status || null,
        soilPH: currentPlotData?.soil?.phh2o ?? null,
        organicCarbonDensity:
          currentPlotData?.soil?.organic_carbon_stock != null
            ? parseFloat(currentPlotData.soil.organic_carbon_stock.toFixed(2))
            : null,
        actualYield: currentPlotData?.brix_sugar?.sugar_yield?.mean ?? null,
        stressCount: stressData?.total_events ?? 0,
        irrigationEvents: irrigationData?.total_events ?? null,
        sugarYieldMean: sugarYieldMeanValue,
        cnRatio: null,
        sugarYieldMax: currentPlotData?.brix_sugar?.sugar_yield?.max ?? null,
        sugarYieldMin: currentPlotData?.brix_sugar?.sugar_yield?.min ?? null,
      };

      setMetrics(newMetrics);
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  const fetchNDREStressEvents = async (): Promise<void> => {
    if (!currentPlotId) {
      console.warn(
        "⚠️ FarmerDashboard: No plot ID available for NDRE stress events"
      );
      return;
    }

    try {
      const res = await axios.get(
        `${BASE_URL}/plots/${currentPlotId}/stress?index_type=NDRE&threshold=0.15`
      );
      const data = res.data;
      setNdreStressEvents(data.events ?? []);
      setShowNDREEvents(true);
    } catch (err) {
      console.error("Error fetching NDRE stress events:", err);
    }
  };

  useEffect(() => {
    if (aggregatedData.length > 0) {
      const combined = aggregatedData.map((point) => {
        const stressEvent = showNDREEvents
          ? ndreStressEvents.find((event) => {
              const eventStart = new Date(event.from_date);
              const eventEnd = new Date(event.to_date);
              const pointDate = new Date(point.date);
              return pointDate >= eventStart && pointDate <= eventEnd;
            })
          : null;

        return {
          ...point,
          stressLevel: stressEvent ? stressEvent.stress : null,
          isStressEvent: !!stressEvent,
          stressEventData: stressEvent,
        };
      });

      setCombinedChartData(combined);
    }
  }, [aggregatedData, ndreStressEvents, showNDREEvents]);

  const toggleLine = (key: string): void => {
    const isOnlyThis = Object.keys(visibleLines).every((k) =>
      k === key
        ? visibleLines[k as keyof VisibleLines]
        : !visibleLines[k as keyof VisibleLines]
    );

    if (isOnlyThis) {
      setVisibleLines({
        growth: true,
        stress: true,
        water: true,
        moisture: true,
      });
    } else {
      setVisibleLines({
        growth: key === "growth",
        stress: key === "stress",
        water: key === "water",
        moisture: key === "moisture",
      });
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStressColor = (stress: number): string => {
    if (stress < 0.1) return "#dc2626";
    if (stress < 0.15) return "#f97316";
    return "#eab308";
  };

  const getStressSeverityLabel = (stress: number): string => {
    if (stress < 0.1)
      return t("farmerDashboard.stressLevels.high", { defaultValue: "High" });
    if (stress < 0.15)
      return t("farmerDashboard.stressLevels.medium", {
        defaultValue: "Medium",
      });
    return t("farmerDashboard.stressLevels.low", { defaultValue: "Low" });
  };

  const CustomStressDot: React.FC<CustomStressDotProps> = (props) => {
    const { cx, cy, payload } = props;

    if (!payload || !payload.isStressEvent) return null;

    const color = getStressColor(payload.stressLevel);
    const radius =
      payload.stressLevel < 0.1 ? 10 : payload.stressLevel < 0.15 ? 8 : 6;

    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={radius + 1}
          fill="white"
          stroke={color}
          strokeWidth={2}
          fillOpacity={0.9}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          fillOpacity={0.8}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  const CustomTooltip: React.FC<CustomTooltipProps> = ({
    active,
    payload,
    label,
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 border border-gray-200 rounded-lg shadow-lg backdrop-blur-sm">
          <p className="text-xs font-semibold text-gray-800 mb-1">
            {timePeriod === "monthly" ? label : formatDate(label || "")}
          </p>
          {payload.map((entry, index) => {
            let displayValue = "";
            let displayLabel = "";

            if (
              entry.dataKey === "stressLevel" &&
              entry.payload?.isStressEvent
            ) {
              displayValue = `${Number(entry.value).toFixed(
                4
              )} (${getStressSeverityLabel(entry.value)})`;
              displayLabel = t("farmerDashboard.tooltip.ndreStressLevel", {
                defaultValue: "NDRE Stress Level",
              });
            } else if (lineStyles[entry.dataKey as keyof LineStyles]) {
              const value = entry.value;
              const numericValue =
                typeof value === "number" ? value : parseFloat(value);
              displayValue = !isNaN(numericValue)
                ? numericValue.toFixed(4)
                : "N/A";
              displayLabel =
                lineStyles[entry.dataKey as keyof LineStyles]?.label ||
                entry.dataKey;
            } else {
              return null;
            }

            return (
              <div key={index} className="flex items-center gap-1 mb-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs text-gray-600">
                  {displayLabel}: {displayValue}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  };

  const TimePeriodToggle: React.FC = () => (
    <div className="flex flex-wrap gap-1 mb-3">
      {(["daily", "weekly", "monthly", "yearly"] as TimePeriod[]).map(
        (period) => (
          <button
            key={period}
            onClick={() => setTimePeriod(period)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
              timePeriod === period
                ? "bg-blue-500 text-white shadow-md transform scale-105"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow-sm"
            }`}
          >
            {period.charAt(0).toUpperCase() + period.slice(1)}
          </button>
        )
      )}
    </div>
  );

  const ChartLegend: React.FC = () => (
    <div className="flex flex-wrap gap-1 text-xs font-medium mb-2">
      {Object.entries(lineStyles).map(([key, { color, label }]) => (
        <button
          key={key}
          onClick={() => toggleLine(key)}
          className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-200 ${
            visibleLines[key as keyof VisibleLines]
              ? "bg-white shadow-sm transform scale-105"
              : "bg-gray-100 opacity-50 hover:opacity-75"
          }`}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-gray-700 text-xs">{label}</span>
        </button>
      ))}
      {showNDREEvents && (
        <div className="flex items-center gap-1 ml-1 px-2 py-1 bg-orange-100 rounded-md border border-orange-300">
          <div className="w-2 h-2 rounded-full bg-orange-500 border border-orange-600"></div>
          <span className="text-orange-800 font-semibold text-xs">
            {t("farmerDashboard.chartLegend.stress", {
              defaultValue: "Stress",
            })}
          </span>
        </div>
      )}
    </div>
  );

  const currentBiomass = metrics.biomass || 0;
  const totalBiomass = metrics.totalBiomass || 0;

  const biomassData = [
    {
      name: t("farmerDashboard.biomassData.totalBiomass", {
        defaultValue: "Total Biomass",
      }),
      value: totalBiomass,
      fill: "#3b82f6",
    },
    {
      name: t("farmerDashboard.biomassData.undergroundBiomass", {
        defaultValue: "Underground Biomass",
      }),
      value: currentBiomass,
      fill: "#10b981",
    },
  ];

  const recoveryComparisonData = [
    {
      name: t("farmerDashboard.recoveryComparison.yourFarm", {
        defaultValue: "Your Farm",
      }),
      value: metrics.recovery || 0,
      fill: "#10b981",
      label: t("farmerDashboard.recoveryComparison.yourRecoveryRateLabel", {
        defaultValue: "Your Recovery Rate",
      }),
    },
    {
      name: t("farmerDashboard.recoveryComparison.regionalAverage", {
        defaultValue: "Regional Average",
      }),
      value: OTHER_FARMERS_RECOVERY.regional_average,
      fill: "#3b82f6",
      label: t("farmerDashboard.recoveryComparison.regionalAverage", {
        defaultValue: "Regional Average",
      }),
    },
    {
      name: t("farmerDashboard.recoveryComparison.top25Percent", {
        defaultValue: "Top 25%",
      }),
      value: OTHER_FARMERS_RECOVERY.top_quartile,
      fill: "#22c55e",
      label: t("farmerDashboard.recoveryComparison.topQuartileLabel", {
        defaultValue: "Top Quartile",
      }),
    },
    {
      name: t("farmerDashboard.recoveryComparison.similarFarms", {
        defaultValue: "Similar Farms",
      }),
      value: OTHER_FARMERS_RECOVERY.similar_farms,
      fill: "#f59e0b",
      label: t("farmerDashboard.recoveryComparison.similarFarmsLabel", {
        defaultValue: "Similar Farms",
      }),
    },
  ];

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <CommonSpinner />
      </div>
    );
  }

  if (!currentPlotId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 flex items-center justify-center">
        <div className="text-center bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-8 max-w-md">
          <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-800 mb-2">
            {t("farmerDashboard.noPlotsFoundTitle", {
              defaultValue: "No Plots Found",
            })}
          </h3>
          <p className="text-gray-600">
            {t("farmerDashboard.noPlotsFoundDescription", {
              defaultValue:
                "No farm plots are registered to your account. Please contact your field officer to register your farm plot.",
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 relative">
      {/* Chatbot Floating Button */}
      {!isChatbotOpen && (
        <button
          onClick={() => setIsChatbotOpen(true)}
          className="fixed bottom-6 right-6 z-[99998] bg-gradient-to-r from-green-600 to-emerald-600 text-white p-4 rounded-full shadow-2xl hover:shadow-green-500/50 transition-all duration-300 hover:scale-110 animate-pulse"
          aria-label={t("farmerDashboard.chatbot.openChatbotAria", {
            defaultValue: "Open Chatbot",
          })}
          title={t("farmerDashboard.chatbot.openCropEyeAssistantTitle", {
            defaultValue: "Open CropEye Assistant",
          })}
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chatbot Component */}
      <Chatbot isOpen={isChatbotOpen} onClose={() => setIsChatbotOpen(false)} />
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Plot Selector - Top Left */}
        {profile && !profileLoading && (
          <div className="bg-white rounded-lg shadow-md p-4 mb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="font-semibold text-gray-700">
                {t("farmerDashboard.labels.selectPlot", {
                  defaultValue: "Select Plot:",
                })}
              </label>
              <select
                value={selectedPlotName || ""}
                onChange={(e) => {
                  const nextPlot = e.target.value;
                  setSelectedPlotName(nextPlot);
                  setCurrentPlotId(nextPlot);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {profile.plots?.map(plot => {
                  let displayName = '';
                  
                  if (plot.gat_number && plot.plot_number && 
                      plot.gat_number.trim() !== "" && plot.plot_number.trim() !== "" &&
                      !plot.gat_number.startsWith('GAT_') && !plot.plot_number.startsWith('PLOT_')) {
                    displayName = `${plot.gat_number}_${plot.plot_number}`;
                  } else if (plot.gat_number && plot.gat_number.trim() !== "" && !plot.gat_number.startsWith('GAT_')) {
                    displayName = plot.gat_number;
                  } else if (plot.plot_number && plot.plot_number.trim() !== "" && !plot.plot_number.startsWith('PLOT_')) {
                    displayName = plot.plot_number;
                  } else {
                    const village = plot.address?.village;
                    const taluka = plot.address?.taluka;
                    
                    if (village) {
                      displayName = `Plot in ${village}`;
                      if (taluka) displayName += `, ${taluka}`;
                    } else {
                      displayName = 'Plot (No GAT/Plot Number)';
                    }
                  }
                  
                  return (
                    <option key={plot.fastapi_plot_id} value={plot.fastapi_plot_id}>
                      {displayName}
                    </option>
                  );
                }) || []}
              </select>
            </div>
          </div>
        )}
        
        {/* Debug Info Panel */}
        {showDebugInfo && (
          <div className="bg-gray-900 rounded-xl shadow-lg p-4 border border-gray-700">
            <h3 className="text-sm font-bold text-green-400 mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Debug Information - API Response
            </h3>
            <div className="bg-black rounded-lg p-3 overflow-auto max-h-96">
              <pre className="text-xs text-green-300 font-mono">
                {JSON.stringify(
                  {
                    farmerProfile: profile,
                    extractedPlotId: currentPlotId,
                    plotIdType: typeof currentPlotId,
                    availablePlots:
                      profile?.plots?.map((p) => p.fastapi_plot_id) || [],
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2
                )}
              </pre>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              💡 Check the browser console for detailed extraction logs
            </p>
          </div>
        )}

        {/* Top Priority Metrics - 4 Key Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-green-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <MapPin className="w-6 h-6 text-green-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">
                  {metrics.area?.toFixed(2) || "-"}
                </div>
                <div className="text-sm font-semibold text-green-600">
                  {t("farmerDashboard.units.acre", { defaultValue: "acre" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">
              {t("farmerDashboard.cards.fieldArea", {
                defaultValue: "Field Area",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-emerald-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Leaf className="w-6 h-6 text-emerald-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {metrics.growthStage || "-"}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium mt-7">
              {t("farmerDashboard.cards.cropStatus", {
                defaultValue: "Crop Status",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-orange-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-6 h-6 text-orange-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">
                  {metrics.growthStage?.toLowerCase().includes("harvested") ? (
                    0
                  ) : metrics.daysToHarvest !== null ? (
                    metrics.daysToHarvest
                  ) : (
                    "-"
                  )}
                </div>
                <div className="text-sm font-semibold text-orange-600">
                  {t("farmerDashboard.cards.days", { defaultValue: "Days" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">
              {t("farmerDashboard.cards.daysToHarvest", {
                defaultValue: "Days to Harvest",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-blue-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Beaker className="w-6 h-6 text-blue-600" />
              <div className="text-right">
                <div className="text-xl font-bold text-gray-800">
                  {metrics.brix || "-"}
                  <span className="text-xl font-bold text-blue-600">
                    {"\u00B0"}Brix(Avg)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xl text-gray-600">
              <p className="text-xs text-gray-600 font-medium">
                {t("farmerDashboard.cards.sugarContent", {
                  defaultValue: "Sugar Content",
                })}
              </p>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="font-semibold text-red-600">
                    {metrics.brixMax || "-"}
                  </div>
                  <div className="text-gray-500">
                    {t("farmerDashboard.labels.max", { defaultValue: "Max" })}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-600">
                    {metrics.brixMin || "-"}
                  </div>
                  <div className="text-gray-500">
                    {t("farmerDashboard.labels.min", { defaultValue: "Min" })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Field Indices Analysis Chart */}
        <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-2 sm:p-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-3">
            <div className="flex items-center gap-2 mb-2 lg:mb-0">
              <LineChartIcon className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-800">
                {t("farmerDashboard.charts.fieldIndicesAnalysis", {
                  defaultValue: "Field Indices Analysis",
                })}
              </h3>
            </div>
            <TimePeriodToggle />
          </div>

          <ChartLegend />

          <div className="h-80 sm:h-96 md:h-[28rem] bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg px-0 sm:px-3 -mx-2 sm:mx-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={combinedChartData}
                margin={{ top: 10, right: 6, left: 9, bottom: 10 }}
                layout={isMobile ? "vertical" : "horizontal"}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
                {isMobile ? (
                  <>
                    <XAxis
                      type="number"
                      domain={[-0.75, 0.8]}
                      stroke="#6b7280"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey={
                        timePeriod === "monthly" ? "displayDate" : "date"
                      }
                      tickFormatter={(tick: string) => {
                        if (timePeriod === "monthly") return tick;
                        if (timePeriod === "daily") {
                          const d = new Date(tick);
                          return d.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          });
                        }
                        const d = new Date(tick);
                        const yy = d.getFullYear().toString().slice(-2);
                        return `${d.toLocaleString("default", {
                          month: "short",
                        })}-${yy}`;
                      }}
                      stroke="#6b7280"
                      tick={{ fontSize: 12 }}
                    />
                  </>
                ) : (
                  <>
                    <XAxis
                      dataKey={
                        timePeriod === "monthly" ? "displayDate" : "date"
                      }
                      tickFormatter={(tick: string) => {
                        if (timePeriod === "monthly") return tick;
                        if (timePeriod === "daily") {
                          const d = new Date(tick);
                          return d.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          });
                        }
                        const d = new Date(tick);
                        const yy = d.getFullYear().toString().slice(-2);
                        return `${d.toLocaleString("default", {
                          month: "short",
                        })}-${yy}`;
                      }}
                      stroke="#6b7280"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      domain={[-0.75, 0.8]}
                      stroke="#6b7280"
                      tick={{ fontSize: 12 }}
                    />
                  </>
                )}
                <Tooltip content={<CustomTooltip />} />

                {(() => {
                  const indexRanges = {
                    water: { good: [0.4, 0.8], bad: [-0.3, -0.75] },
                    moisture: { good: [-0.25, 0.8], bad: [-0.6, -0.75] },
                    growth: { good: [0.2, 0.8], bad: [0.15, -0.75] },
                    stress: { good: [0.35, 0.8], bad: [0.2, -0.75] },
                  };

                  const visibleCount = Object.values(visibleLines).filter(
                    (v) => v
                  ).length;

                  let goodRange: [number, number] = [0.3, 0.6];
                  let badRange: [number, number] = [-0.1, 0.1];
                  let labelText = t("farmerDashboard.labels.average", {
                    defaultValue: "Average",
                  });

                  if (visibleCount === 1) {
                    const selectedIndex = Object.keys(visibleLines).find(
                      (key) => visibleLines[key as keyof VisibleLines]
                    );

                    if (
                      selectedIndex &&
                      indexRanges[selectedIndex as keyof typeof indexRanges]
                    ) {
                      const range =
                        indexRanges[selectedIndex as keyof typeof indexRanges];
                      goodRange = range.good as [number, number];
                      badRange = range.bad as [number, number];
                      labelText =
                        selectedIndex.charAt(0).toUpperCase() +
                        selectedIndex.slice(1);
                    }
                  } else {
                    const allGoodRanges = Object.values(indexRanges).map(
                      (r) => r.good
                    );
                    const allBadRanges = Object.values(indexRanges).map(
                      (r) => r.bad
                    );

                    const avgGoodMin =
                      allGoodRanges.reduce((sum, [min]) => sum + min, 0) /
                      allGoodRanges.length;
                    const avgGoodMax =
                      allGoodRanges.reduce((sum, [, max]) => sum + max, 0) /
                      allGoodRanges.length;
                    const avgBadMin =
                      allBadRanges.reduce((sum, [min]) => sum + min, 0) /
                      allBadRanges.length;
                    const avgBadMax =
                      allBadRanges.reduce((sum, [, max]) => sum + max, 0) /
                      allBadRanges.length;

                    goodRange = [avgGoodMin, avgGoodMax] as [number, number];
                    badRange = [avgBadMin, avgBadMax] as [number, number];
                    labelText = t("farmerDashboard.labels.average", {
                      defaultValue: "Average",
                    });
                  }

                  return (
                    <>
                      {isMobile ? (
                        <>
                          <ReferenceArea
                            x1={goodRange[0]}
                            x2={goodRange[1]}
                            fill="#1ad3e8"
                            fillOpacity={0.7}
                            stroke="none"
                          />
                          <ReferenceArea
                            x1={badRange[0]}
                            x2={badRange[1]}
                            fill="#dae81a"
                            fillOpacity={0.7}
                            stroke="none"
                          />
                        </>
                      ) : (
                        <>
                          <ReferenceArea
                            y1={goodRange[0]}
                            y2={goodRange[1]}
                            fill="#1ad3e8"
                            fillOpacity={0.7}
                            stroke="none"
                          />
                          <ReferenceArea
                            y1={badRange[0]}
                            y2={badRange[1]}
                            fill="#dae81a"
                            fillOpacity={0.7}
                            stroke="none"
                          />
                        </>
                      )}
                      {isMobile ? (
                        <>
                          {/* Mobile: two-line labels using tspans */}
                          <text
                            x="79"
                            y="25%"
                            textAnchor="middle"
                            className="text-xs font-left fill-green-600"
                            style={{ fontSize: "10px" }}
                          >
                            <tspan x="79%" dy="0">
                              {t("farmerDashboard.labels.average", {
                                defaultValue: "Average",
                              })}
                            </tspan>
                            <tspan x="79%" dy="12">
                              Good ({goodRange[0].toFixed(2)} -{" "}
                              {goodRange[1].toFixed(2)})
                            </tspan>
                          </text>
                          <text
                            x="79%"
                            y="35%"
                            textAnchor="middle"
                            className="text-xs font-right fill-red-600"
                            style={{ fontSize: "10px" }}
                          >
                            <tspan x="30%" dy="0">
                              Average
                            </tspan>
                            <tspan x="35%" dy="12">
                              Bad ({badRange[0].toFixed(2)} -{" "}
                              {badRange[1].toFixed(2)})
                            </tspan>
                          </text>
                        </>
                      ) : (
                        <>
                          <text
                            x="95%"
                            y="25%"
                            textAnchor="end"
                            className="text-xs font-medium fill-green-600"
                            style={{ fontSize: "10px" }}
                          >
                            {labelText} Good ({goodRange[0].toFixed(2)} -{" "}
                            {goodRange[1].toFixed(2)})
                          </text>
                          <text
                            x="95%"
                            y="75%"
                            textAnchor="end"
                            className="text-xs font-medium fill-red-600"
                            style={{ fontSize: "10px" }}
                          >
                            {labelText} Bad ({badRange[0].toFixed(2)} -{" "}
                            {badRange[1].toFixed(2)})
                          </text>
                        </>
                      )}
                    </>
                  );
                })()}

                {showStressEvents &&
                  stressEvents.map((event, index) => (
                    <React.Fragment key={index}>
                      <ReferenceLine
                        {...(isMobile
                          ? { y: event.from_date }
                          : { x: event.from_date })}
                        stroke="#dc2626"
                        strokeDasharray="5 5"
                        strokeWidth={1}
                        label={{
                          value: `Start: ${formatDate(event.from_date)}`,
                          position: "top",
                          fontSize: 8,
                          fill: "#dc2626",
                        }}
                      />
                      <ReferenceLine
                        {...(isMobile
                          ? { y: event.to_date }
                          : { x: event.to_date })}
                        stroke="#dc2626"
                        strokeDasharray="5 5"
                        strokeWidth={1}
                        label={{
                          value: `End: ${formatDate(event.to_date)}`,
                          position: "top",
                          fontSize: 8,
                          fill: "#dc2626",
                        }}
                      />
                      {isMobile ? (
                        <ReferenceArea
                          y1={event.from_date}
                          y2={event.to_date}
                          fill="#dc2626"
                          fillOpacity={0.1}
                        />
                      ) : (
                        <ReferenceArea
                          x1={event.from_date}
                          x2={event.to_date}
                          fill="#dc2626"
                          fillOpacity={0.1}
                        />
                      )}
                    </React.Fragment>
                  ))}

                {visibleLines.growth && (
                  <Line
                    type="monotone"
                    dataKey="growth"
                    stroke={lineStyles.growth.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: lineStyles.growth.color }}
                    activeDot={{ r: 4, fill: lineStyles.growth.color }}
                  />
                )}
                {visibleLines.stress && (
                  <Line
                    type="monotone"
                    dataKey="stress"
                    stroke={lineStyles.stress.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: lineStyles.stress.color }}
                    activeDot={{ r: 4, fill: lineStyles.stress.color }}
                  />
                )}
                {visibleLines.water && (
                  <Line
                    type="monotone"
                    dataKey="water"
                    stroke={lineStyles.water.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: lineStyles.water.color }}
                    activeDot={{ r: 4, fill: lineStyles.water.color }}
                  />
                )}
                {visibleLines.moisture && (
                  <Line
                    type="monotone"
                    dataKey="moisture"
                    stroke={lineStyles.moisture.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: lineStyles.moisture.color }}
                    activeDot={{ r: 4, fill: lineStyles.moisture.color }}
                  />
                )}

                {showNDREEvents && (
                  <Scatter
                    dataKey="stressLevel"
                    fill="#f97316"
                    shape={<CustomStressDot />}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-emerald-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-1">
              <Leaf className="w-5 h-5 text-emerald-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {metrics.organicCarbonDensity || "-"}
                </div>
                <div className="text-xs font-semibold text-emerald-600">
                  g/cm{"\u00B3"}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {t("farmerDashboard.cards.organicCarbonDensity", {
                defaultValue: "Organic Carbon Density",
              })}
            </p>
          </div>

          <button
            onClick={fetchNDREStressEvents}
            onDoubleClick={() => setShowNDREEvents(!showNDREEvents)}
            className="w-full"
          >
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-red-200 hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-1">
                <Activity className="w-5 h-5 text-red-600" />
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-800">
                    {metrics.stressCount || "0"}
                  </div>
                  <div className="text-xs font-semibold text-red-600">
                    {t("farmerDashboard.labels.events", { defaultValue: "Events" })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-600">
                {t("farmerDashboard.card.stressEvents", {
                  defaultValue: "pest Stress Events",
                })}
              </p>
            </div>
          </button>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-cyan-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-1">
              <Droplets className="w-5 h-5 text-cyan-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {metrics.irrigationEvents || "-"}
                </div>
                <div className="text-xs font-semibold text-cyan-600">
                  {t("farmerDashboard.labels.events", { defaultValue: "Events" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {t("farmerDashboard.card.irrigationEvents", {
                defaultValue: "Irrigation stress Events",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-purple-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-1">
              <Activity className="w-5 h-5 text-purple-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {totalBiomass?.toFixed(1) || "-"}
                </div>
                <div className="text-xs font-semibold text-purple-600">
                  {t("farmerDashboard.units.tPerAcre", { defaultValue: "T/acre" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {t("farmerDashboard.cards.totalBiomass", {
                defaultValue: "Total Biomass",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-yellow-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-1">
              <Thermometer className="w-5 h-5 text-yellow-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {metrics.soilPH?.toFixed(2) || "-"}
                </div>
                <div className="text-xs font-semibold text-yellow-600">
                  {t("farmerDashboard.labels.ph", { defaultValue: "pH" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {t("farmerDashboard.cards.soilPHLevel", {
                defaultValue: "Soil pH Level",
              })}
            </p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border border-green-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-1">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {metrics.recovery?.toFixed(1) || "-"}
                </div>
                <div className="text-xs font-semibold text-green-600">
                  {t("farmerDashboard.labels.percent", { defaultValue: "%" })}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {t("farmerDashboard.cards.recoveryRate", {
                defaultValue: "Recovery Rate",
              })}
            </p>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* First Row: Yield and Biomass Cards - Horizontally Aligned */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Expected Yield Comparison */}
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-purple-600" />
                <h3 className="text-sm font-semibold text-gray-800">
                  {t("farmerDashboard.cards.sugarcaneYieldProjection", {
                    defaultValue: "Sugarcane Yield Projection",
                  })}
                </h3>
              </div>
              <div className="h-48 sm:h-56 md:h-64 flex flex-col items-center justify-center relative flex-grow">
                <PieChartWithNeedle
                  value={metrics.sugarYieldMean || 0}
                  max={metrics.sugarYieldMax || 400}
                  title={t("farmerDashboard.cards.sugarcaneYieldForecast", {
                    defaultValue: "Sugarcane Yield Forecast",
                  })}
                  unit={` ${t("farmerDashboard.units.tPerAcre", {
                    defaultValue: "T/acre",
                  })}`}
                  width={260}
                  height={130}
                />
              </div>
              <p className="text-sm text-gray-700 font-medium text-center mb-2 mt-2">
                {t("farmerDashboard.cards.sugarcaneYieldForecast", {
                  defaultValue: "Sugarcane Yield Forecast",
                })}
              </p>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-xs flex-wrap">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded bg-red-500"></div>
                    <span className="text-red-700 font-semibold">
                      {t("farmerDashboard.labels.minWithColon", {
                        defaultValue: "min:",
                      })}{" "}
                      {(metrics.sugarYieldMin || 0).toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded bg-purple-500"></div>
                    <span className="text-purple-700 font-semibold">
                      {t("farmerDashboard.labels.meanWithColon", {
                        defaultValue: "mean:",
                      })}{" "}
                      {(metrics.sugarYieldMean || 0).toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded bg-green-500"></div>
                    <span className="text-green-700 font-semibold">
                      {t("farmerDashboard.labels.maxWithColon", {
                        defaultValue: "max:",
                      })}{" "}
                      {(metrics.sugarYieldMax || 0).toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {t("farmerDashboard.labels.performance", {
                    defaultValue: "Performance:",
                  })}{" "}
                  {metrics.sugarYieldMax
                    ? (((metrics.sugarYieldMean || 0) / metrics.sugarYieldMax) * 100).toFixed(1)
                    : "0.0"}
                  {t("farmerDashboard.labels.optimalYieldPercentSuffix", {
                    defaultValue: "% of optimal yield",
                  })}
                </div>
              </div>
            </div>

            {/* Biomass Performance */}
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-green-600" />
                <h3 className="text-sm font-semibold text-gray-800">
                  {t("farmerDashboard.charts.biomassPerformance", {
                    defaultValue: "Biomass Performance",
                  })}
                </h3>
              </div>
              <div className="h-48 sm:h-56 md:h-64 flex flex-col items-center justify-center relative flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={biomassData}
                      cx="50%"
                      cy="80%"
                      startAngle={180}
                      endAngle={0}
                      outerRadius={110}
                      innerRadius={70}
                      dataKey="value"
                      labelLine={false}
                    >
                      {biomassData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <text
                      x="50%"
                      y="70%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-base sm:text-lg font-semibold fill-blue-600"
                    >
                      {totalBiomass.toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </text>
                    <Tooltip
                      wrapperStyle={{ zIndex: 50 }}
                      contentStyle={{ fontSize: "12px" }}
                      formatter={(value: number, name: string) => [
                        `${value.toFixed(1)} ${t("farmerDashboard.units.tPerAcre", {
                          defaultValue: "T/acre",
                        })}`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-sm text-gray-700 font-medium text-center mb-2 mt-2">
                {t("farmerDashboard.charts.biomassDistributionChart", {
                  defaultValue: "Biomass Distribution Chart",
                })}
              </p>
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 text-xs flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-blue-500"></div>
                    <span className="text-blue-700 font-semibold">
                      {t("farmerDashboard.biomassDistribution.total", {
                        defaultValue: "Total:",
                      })}{" "}
                      {totalBiomass.toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-green-500"></div>
                    <span className="text-green-700 font-semibold">
                      {t("farmerDashboard.biomassDistribution.underground", {
                        defaultValue: "Underground:",
                      })}{" "}
                      {currentBiomass.toFixed(1)}{" "}
                      {t("farmerDashboard.units.tPerAcre", {
                        defaultValue: "T/acre",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recovery Rate Comparison */}
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-800">
                  {t("farmerDashboard.charts.recoveryRateComparison", {
                    defaultValue: "Recovery Rate Comparison",
                  })}
              </h3>
            </div>
            <div className="h-48 sm:h-56 md:h-64 flex flex-col items-center justify-center relative flex-grow">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={recoveryComparisonData}
                  margin={{ top: 1, right: 5, left: -20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} height={10} />
                  <YAxis tick={{ fontSize: 8 }} domain={[0, 10]} />
                  <Tooltip
                    formatter={(value: number) => [
                      `${value.toFixed(1)}%`,
                      t("farmerDashboard.tooltip.recoveryRateLabel", {
                        defaultValue: "Recovery Rate",
                      }),
                    ]}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]}>
                    {recoveryComparisonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-gray-700 font-medium text-center mb-2 mt-2">
              {t("farmerDashboard.charts.recoveryRateComparison", {
                defaultValue: "Recovery Rate Comparison",
              })}
            </p>
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-green-500"></div>
                  <span className="text-green-700 font-semibold">
                    {t("farmerDashboard.labels.yourFarm", {
                      defaultValue: "Your Farm:",
                    })}{" "}
                    {(metrics.recovery || 0).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-blue-500"></div>
                  <span className="text-blue-700 font-semibold">
                    {t("farmerDashboard.labels.regionalAvg", {
                      defaultValue: "Regional Avg:",
                    })}{" "}
                    {OTHER_FARMERS_RECOVERY.regional_average.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FarmerDashboard;
