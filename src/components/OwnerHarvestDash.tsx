import api, { getTeamConnect, getCurrentUser, getFieldOfficerAgroStats } from "../api";
import React, { useState, useRef, useEffect, useMemo } from "react";
//import axios from "axios";
import {
  MapPin,
  ChevronDown,
  Loader2,
 // Calendar,
  TrendingUp,
  BarChart3,
 // PieChart,
  Activity,
  Maximize2,
} from "lucide-react";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  //LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  LabelList,
  ComposedChart,
  Area,
} from "recharts";
import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useMap } from "react-leaflet";

const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/users/owner-hierarchy/`;

// Chart Types
const CHART_TYPES = {
  BRIX: "brix",
  HARVEST: "harvest",
  PLANTATION: "plantation",
} as const;

type ChartType = (typeof CHART_TYPES)[keyof typeof CHART_TYPES];

// Type definitions
interface Filters {
  manager: string;
  region: string;
  representative: string;
  sugarcaneType: string;
  variety: string;
}

interface DateRange {
  start: string;
  end: string;
}

interface HarvestData {
  id?: string;
  "Plot No"?: string;
  "plot in no."?: string;
  Latitude: number;
  Longitude: number;
  "Sugarcane Status": string;
  "Area (Hect)": number;
  Days: number;
  /** Legacy typo key (kept for safety). */
  "Prediction Yield (T/acer)"?: number;
  "Prediction Yield (T/acre)"?: number;
  "Brix (Degree)": number;
  "Recovery (Degree)": number;
  "Distance (km)": number;
  Stage: string;
  Region: string;
  Manager?: string;
  "Sugarcane Type": string;
  Variety: string;
  representative?: string;
  representativeUrl?: string;
  boundaryCoordinates?: [number, number][];
}

interface PlotPoint {
  id: string | number;
  position: [number, number];
  status: string;
  plotNo: string;
  area: string;
  raw: HarvestData;
  boundaryCoordinates?: [number, number][];
}

interface StatusData {
  name: string;
  value: number;
  color: string;
}

interface BrixData {
  day: number;
  value: number;
}

interface HarvestChartData {
  day: number;
  area: number;
}

interface StageDistribution {
  stage: string;
  plots: number;
  color: string;
}

interface KeyMetric {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

interface BrixTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

interface HarvestTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

interface MapAutoCenterProps {
  center: [number, number] | null;
}

interface CombinedChartProps {
  brixData: BrixData[];
  harvestData: HarvestChartData[];
  stageDistribution: StageDistribution[];
  filteredData: HarvestData[];
  harvestRange: [number, number];
  setHarvestRange: (range: [number, number]) => void;
  activeChart: ChartType;
  setActiveChart: (chart: ChartType) => void;
}

// Pie chart color palette (used for both pie and map points)
const STATUS_COLOR_PALETTE = [
  "#3B82F6",
  "#60A5FA",
  "#FB923C",
  "#10B981",
  "#6366F1",
  "#eab308",
  "#888",
];

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

// Combined Chart Component
const CombinedChart: React.FC<CombinedChartProps> = ({
  brixData,
  harvestData,
  stageDistribution,
  filteredData,
  harvestRange,
  setHarvestRange,
  activeChart,
  setActiveChart,
}) => {
  React.useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      .slider-thumb::-webkit-slider-thumb {
        appearance: none;
        height: 12px;
        width: 12px;
        border-radius: 50%;
        background: #10B981;
        cursor: pointer;
        border: 2px solid #ffffff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .slider-thumb::-moz-range-thumb {
        height: 12px;
        width: 12px;
        border-radius: 50%;
        background: #10B981;
        cursor: pointer;
        border: 2px solid #ffffff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
    `;
    document.head.appendChild(style);
    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
    };
  }, []);

  const BrixTooltip: React.FC<BrixTooltipProps> = ({
    active,
    payload,
    label,
  }) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      const day = entry.day;
      const brixValues = filteredData
        .filter(
          (item) =>
            item.Days === day && typeof item["Brix (Degree)"] === "number",
        )
        .map((item) => item["Brix (Degree)"]);
      const avgBrix = brixValues.length
        ? (brixValues.reduce((a, b) => a + b, 0) / brixValues.length).toFixed(2)
        : "-";
      return (
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
          <div className="text-sm">
            <strong>Days:</strong> {day}
          </div>
          <div className="text-sm">
            <strong>Avg. Brix Value:</strong> {avgBrix}
          </div>
        </div>
      );
    }
    return null;
  };

  const HarvestTooltip: React.FC<HarvestTooltipProps> = ({
    active,
    payload,
    label,
  }) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      return (
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
          <div className="text-sm">
            <strong>Days:</strong> {entry.day}
          </div>
          <div className="text-sm">
            <strong>Avg Yield (T/acre):</strong> {entry.area?.toFixed(2)}
          </div>
          <div className="text-sm">
            <strong>Plot Count:</strong> {entry.count}
          </div>
          <div className="text-sm">
            <strong>Total Yield:</strong> {entry.totalYield?.toFixed(2)}
          </div>
        </div>
      );
    }
    return null;
  };

  const chartButtons = [
    { id: CHART_TYPES.BRIX, label: "Brix Value Prediction" },
    { id: CHART_TYPES.PLANTATION, label: "Plot wise Sugarcane Plantation" },
    { id: CHART_TYPES.HARVEST, label: "Ready To Harvest" },
  ];

  const renderChart = () => {
    switch (activeChart) {
      case CHART_TYPES.BRIX:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={brixData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 12 }}
                axisLine={{ stroke: "#e5e7eb" }}
                label={{
                  value: "Days",
                  position: "insideBottom",
                  offset: -1,
                }}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={{ stroke: "#e5e7eb" }}
                label={{
                  value: "Total Area",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                }}
              />
              <Tooltip content={<BrixTooltip />} />
              <Bar dataKey="value" fill="#3B82F6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      case CHART_TYPES.HARVEST:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={harvestData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 12 }}
                axisLine={{ stroke: "#e5e7eb" }}
                label={{
                  value: "Days",
                  position: "insideBottom",
                  offset: -1,
                }}
                scale="linear"
                type="number"
                domain={["dataMin", "dataMax"]}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={{ stroke: "#e5e7eb" }}
                label={{
                  value: "Yield (T/acre)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                }}
                yAxisId="left"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={{ stroke: "#e5e7eb" }}
                label={{
                  value: "Count",
                  angle: 90,
                  position: "insideRight",
                  offset: 10,
                }}
                yAxisId="right"
                orientation="right"
              />
              <Tooltip content={<HarvestTooltip />} />
              <Area
                type="monotone"
                dataKey="area"
                fill="#10B981"
                fillOpacity={0.3}
                stroke="#10B981"
                strokeWidth={2}
                yAxisId="left"
              />
              <Line
                type="monotone"
                dataKey="area"
                stroke="#10B981"
                strokeWidth={3}
                dot={{ fill: "#10B981", strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5 }}
                yAxisId="left"
              />
              <Bar
                dataKey="count"
                fill="#3B82F6"
                fillOpacity={0.6}
                yAxisId="right"
                radius={[2, 2, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        );
      case CHART_TYPES.PLANTATION:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="stage"
                tick={{ fontSize: 10, dy: 10 }}
                axisLine={{ stroke: "#e5e7eb" }}
              />
              <YAxis
                tick={{ fontSize: 14 }}
                axisLine={{ stroke: "#e5e7eb" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="plots" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="plots" position="top" />
                {stageDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 h-[500px] flex flex-col">
      <div className="flex justify-between items-center border-b border-gray-200 p-4">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {chartButtons.map((button) => (
            <button
              key={button.id}
              onClick={() => setActiveChart(button.id)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                activeChart === button.id
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
        {activeChart === CHART_TYPES.HARVEST && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-600">
                Days Range
              </span>
              <span className="text-xs text-gray-500">
                ({harvestRange[0]} - {harvestRange[1]})
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="200"
              value={harvestRange[1]}
              onChange={(e) =>
                setHarvestRange([harvestRange[0], parseInt(e.target.value)])
              }
              className="w-32 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
            />
          </div>
        )}
      </div>
      <div className="flex-1 p-4">{renderChart()}</div>
    </div>
  );
};

const HarvestDashboard: React.FC = () => {
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const [activeChart, setActiveChart] = useState<ChartType>(CHART_TYPES.BRIX);
  const [filters, setFilters] = useState<Filters>({
    manager: "All",
    region: "All",
    representative: "All",
    sugarcaneType: "All",
    variety: "All",
  });
  const [dateRange, setDateRange] = useState<DateRange>({
    start: "2024-12-14",
    end: "2024-12-14",
  });
  const [harvestRange, setHarvestRange] = useState<[number, number]>([
    -50, 100,
  ]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dropdownsLoading, setDropdownsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<HarvestData[]>([]);

  // Dynamic filter options
  const [managerOptions, setManagerOptions] = useState<string[]>(["All"]);
  const [regionOptions, setRegionOptions] = useState<string[]>(["All"]);
  const [representativeOptions, setRepresentativeOptions] = useState<string[]>([
    "All",
  ]);
  const [sugarcaneTypeOptions, setSugarcaneTypeOptions] = useState<string[]>([
    "All",
  ]);
  const [varietyOptions] = useState<string[]>(["All", "Phule 265"]);

  // Debounce non-representative filters
  const debouncedManager = useDebouncedValue(filters.manager, 300);
  const debouncedRegion = useDebouncedValue(filters.region, 300);
  const debouncedSugarcaneType = useDebouncedValue(filters.sugarcaneType, 300);
  const debouncedVariety = useDebouncedValue(filters.variety, 300);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setDropdownsLoading(true);
      setFetchError(null);

      try {
        // ── Step 1: get industry_id from current user ──────────────────────
        const meRes = await getCurrentUser();
        const me = meRes?.data;
        const industryId =
          me?.industry_id ??
          me?.industry?.id ??
          me?.industry?.industry_id ??
          me?.industryId;

        // ── Step 2: fetch team-connect with auth token ─────────────────────
        const teamRes = await getTeamConnect(industryId);
        const teamData = teamRes?.data;

        // ── Step 3: parse managers + field officers ────────────────────────
        let managersList: any[] = [];
        let fieldOfficersList: any[] = [];

        if (teamData?.users_by_role) {
          managersList = Array.isArray(teamData.users_by_role.managers)
            ? teamData.users_by_role.managers
            : [];
          fieldOfficersList = Array.isArray(teamData.users_by_role.field_officers)
            ? teamData.users_by_role.field_officers
            : [];
        } else if (Array.isArray(teamData?.managers)) {
          managersList = teamData.managers;
          fieldOfficersList = Array.isArray(teamData.field_officers)
            ? teamData.field_officers
            : managersList.flatMap((m: any) =>
                Array.isArray(m.field_officers) ? m.field_officers : []
              );
        } else if (Array.isArray(teamData?.results)) {
          managersList = teamData.results.filter(
            (u: any) =>
              u.role_id === 3 ||
              String(u.role?.name ?? "").toLowerCase().includes("manager")
          );
          fieldOfficersList = teamData.results.filter(
            (u: any) =>
              u.role_id === 2 ||
              (String(u.role?.name ?? "").toLowerCase().includes("field") &&
                String(u.role?.name ?? "").toLowerCase().includes("officer"))
          );
        }

        // ── Step 4: immediately populate manager & representative dropdowns ──
        const managerSet = new Set<string>();
        const foSet = new Set<string>();
        const foToManager: Record<string, string> = {};

        managersList.forEach((m: any) => {
          const name = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.username || "Unknown";
          if (name) managerSet.add(name);
        });

        // Map field officer → manager name
        if (fieldOfficersList.length === 0 && managersList.length > 0) {
          // Derive FOs from nested manager objects
          fieldOfficersList = managersList.flatMap((m: any) => {
            const mName = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.username;
            return (Array.isArray(m.field_officers) ? m.field_officers : []).map(
              (fo: any) => ({ ...fo, _managerName: mName })
            );
          });
        }

        fieldOfficersList.forEach((fo: any) => {
          const foName =
            `${fo.first_name ?? ""} ${fo.last_name ?? ""}`.trim() || fo.username || "Unknown";
          if (foName) foSet.add(foName);

          // Resolve manager name via created_by or _managerName
          const mgr = fo._managerName
            ? fo._managerName
            : managersList.find(
                (m: any) =>
                  m.id === fo.created_by ||
                  m.id === fo.manager_id ||
                  m.id === fo.manager?.id
              );
          const mgrName =
            typeof mgr === "string"
              ? mgr
              : mgr
              ? `${mgr.first_name ?? ""} ${mgr.last_name ?? ""}`.trim() || mgr.username
              : "Unknown";
          foToManager[foName] = mgrName;
        });

        setManagerOptions(["All", ...Array.from(managerSet).sort()]);
        setRepresentativeOptions(["All", ...Array.from(foSet).sort()]);
        setDropdownsLoading(false); // dropdowns are ready — show them now

        // ── Step 5: fetch agro-stats per field officer ────────────────────
        const today = new Date().toISOString().slice(0, 10);
        const allData: HarvestData[] = [];
        const talukaSet = new Set<string>();
        const plantationTypeSet = new Set<string>();

        await Promise.allSettled(
          fieldOfficersList.map(async (fo: any) => {
            try {
              const foId = fo.id;
              if (!foId) return;

              const foName =
                `${fo.first_name ?? ""} ${fo.last_name ?? ""}`.trim() ||
                fo.username ||
                "Unknown";
              const mgrName = foToManager[foName] || "Unknown";

              const statsData = await getFieldOfficerAgroStats(foId, today);
              if (!statsData || typeof statsData !== "object") return;

              Object.entries(statsData).forEach(
                ([plotId, plotData]: [string, any]) => {
                  if (!plotData || typeof plotData !== "object") return;

                  const area =
                    plotData.area_acres ?? plotData.soil?.area_acres ?? 0;
                  const yieldValue =
                    plotData.brix_sugar?.sugar_yield?.mean ??
                    plotData.brix_sugar?.sugar_yield?.min ??
                    0;
                  const brixValue =
                    plotData.brix_sugar?.brix?.mean ??
                    plotData.brix_sugar?.brix?.min ??
                    0;
                  const recoveryValue =
                    plotData.brix_sugar?.recovery?.mean ??
                    plotData.brix_sugar?.recovery?.min ??
                    0;

                  const coords =
                    plotData.geometry?.coordinates?.[0] || [];
                  if (!coords.length) return;

                  let cLat = 0,
                    cLng = 0;
                  coords.forEach((c: number[]) => {
                    cLng += c[0];
                    cLat += c[1];
                  });
                  cLat /= coords.length;
                  cLng /= coords.length;

                  if (!cLat || !cLng) return;

                  const boundaryCoords: [number, number][] = coords.map(
                    (c: number[]) => [c[1], c[0]] as [number, number]
                  );

                  let days = 0;
                  if (plotData.plantation_date) {
                    const pd = new Date(plotData.plantation_date);
                    if (!isNaN(pd.getTime())) {
                      days = Math.floor(
                        (Date.now() - pd.getTime()) / 86400000
                      );
                    }
                  }

                  let stage = "Germination Stage";
                  if (days > 150) stage = "Maturity Stage";
                  else if (days > 90) stage = "Grand Growth Stage";
                  else if (days > 30) stage = "Tillering Stage";

                  const status =
                    plotData.Sugarcane_Status ||
                    plotData.harvest_status ||
                    (days > 300
                      ? "Ready to Harvest"
                      : days > 270
                      ? "Partially Harvested"
                      : "Growing");

                  const regionName =
                    plotData.region ||
                    plotData.taluka ||
                    fo.taluka ||
                    fo.region ||
                    "Unknown";
                  const plantationType =
                    plotData.plantation_type || "Unknown";
                  const variety = plotData.variety || "Phule 265";

                  talukaSet.add(regionName);
                  plantationTypeSet.add(plantationType);

                  allData.push({
                    id: plotId,
                    "Plot No": plotData.plot_number || plotId,
                    Latitude: cLat,
                    Longitude: cLng,
                    "Sugarcane Status": status,
                    "Area (Hect)": area,
                    Days: days,
                    "Prediction Yield (T/acre)": yieldValue,
                    "Prediction Yield (T/acer)": yieldValue,
                    "Brix (Degree)": brixValue,
                    "Recovery (Degree)": recoveryValue,
                    "Distance (km)": Math.random() * 10 + 1,
                    Stage: stage,
                    Region: regionName,
                    Manager: mgrName,
                    "Sugarcane Type": plantationType,
                    Variety: variety,
                    representative: foName,
                    boundaryCoordinates: boundaryCoords,
                  });
                }
              );
            } catch {
              // silently skip failed FO stats
            }
          })
        );

        setRegionOptions(["All", ...Array.from(talukaSet).sort()]);
        setSugarcaneTypeOptions([
          "All",
          ...Array.from(plantationTypeSet).sort(),
        ]);
        setRawData(allData);
      } catch (err: any) {
        console.error("Harvest dashboard fetch error:", err);
        setFetchError(
          err?.response?.data?.detail ||
            err?.message ||
            "Failed to load data. Please try again."
        );
        setDropdownsLoading(false);
        setRawData([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Cascade: when manager changes, update representative options to only those under that manager
  useEffect(() => {
    const managerFiltered =
      debouncedManager === "All"
        ? rawData
        : rawData.filter((item) => item.Manager === debouncedManager);
    const repSet = new Set<string>();
    managerFiltered.forEach((item) => {
      if (item.representative) repSet.add(item.representative);
    });
    setRepresentativeOptions(["All", ...Array.from(repSet).sort()]);
    // Reset representative if the current selection is no longer valid
    setFilters((prev) => ({
      ...prev,
      representative:
        prev.representative === "All" || repSet.has(prev.representative)
          ? prev.representative
          : "All",
    }));
  }, [debouncedManager, rawData]);

  const filteredData = useMemo(
    () =>
      rawData.filter((item) => {
        const managerMatch =
          debouncedManager === "All" || item.Manager === debouncedManager;
        const regionMatch =
          debouncedRegion === "All" || item.Region === debouncedRegion;
        const repMatch =
          filters.representative === "All" ||
          item.representative === filters.representative;
        const typeMatch =
          debouncedSugarcaneType === "All" ||
          item["Sugarcane Type"] === debouncedSugarcaneType;
        const varietyMatch =
          debouncedVariety === "All" || item.Variety === debouncedVariety;
        return managerMatch && regionMatch && repMatch && typeMatch && varietyMatch;
      }),
    [
      rawData,
      debouncedManager,
      debouncedRegion,
      filters.representative,
      debouncedSugarcaneType,
      debouncedVariety,
    ],
  );

  const FIXED_STATUS_LABELS = [
    "Harvested",
    "Growing",
    "Partially Harvested",
    "Ready to Harvest",
  ];

  const statusCounts = useMemo(
    () =>
      filteredData.reduce((acc: { [key: string]: number }, item) => {
        const status = item["Sugarcane Status"];
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {}),
    [filteredData],
  );

  const statusColorMap = useMemo(() => {
    const map: { [key: string]: string } = {};
    FIXED_STATUS_LABELS.forEach((label, i) => {
      map[label] = STATUS_COLOR_PALETTE[i % STATUS_COLOR_PALETTE.length];
    });
    return map;
  }, []);

  const plotStatusData = useMemo(
    () =>
      FIXED_STATUS_LABELS.map((label) => ({
        name: label,
        value: statusCounts[label] || 0,
        color: statusColorMap[label],
      })),
    [statusCounts, statusColorMap],
  );

  const plotPoints = useMemo(() => {
    let dataToUse = filteredData;
    if (activeChart === CHART_TYPES.HARVEST) {
      dataToUse = filteredData.filter((item) => {
        if (typeof item.Days === "number") {
          return item.Days >= harvestRange[0] && item.Days <= harvestRange[1];
        }
        return false;
      });
    }
    return dataToUse.map((item, idx) => ({
      id: item.id || idx,
      position: [item.Latitude, item.Longitude] as [number, number],
      status: item["Sugarcane Status"],
      plotNo: item["Plot No"] || item["plot in no."] || `P${idx + 1}`,
      area: `${item["Area (Hect)"]} Ha`,
      raw: item,
      boundaryCoordinates: item.boundaryCoordinates,
    }));
  }, [filteredData, activeChart, harvestRange]);

  const brixData = useMemo(() => {
    const brixAreaByDay: { [key: number]: number } = {};
    filteredData.forEach((item) => {
      if (
        typeof item.Days === "number" &&
        typeof item["Area (Hect)"] === "number"
      ) {
        brixAreaByDay[item.Days] =
          (brixAreaByDay[item.Days] || 0) + item["Area (Hect)"];
      }
    });
    return Object.entries(brixAreaByDay)
      .map(([day, area]) => ({ day: Number(day), value: area }))
      .sort((a, b) => a.day - b.day);
  }, [filteredData]);

  const harvestData = useMemo(() => {
    const rangeFilteredData = filteredData.filter((item) => {
      if (typeof item.Days === "number") {
        return item.Days >= harvestRange[0] && item.Days <= harvestRange[1];
      }
      return false;
    });

    const dayGroups = rangeFilteredData.reduce(
      (acc: { [key: number]: number[] }, item) => {
        if (
          typeof item.Days === "number" &&
          typeof item["Prediction Yield (T/acre)"] === "number"
        ) {
          if (!acc[item.Days]) {
            acc[item.Days] = [];
          }
          acc[item.Days].push(item["Prediction Yield (T/acre)"]);
        }
        return acc;
      },
      {},
    );

    return Object.entries(dayGroups)
      .map(([day, yieldValues]) => ({
        day: Number(day),
        area:
          yieldValues.reduce((sum, val) => sum + val, 0) / yieldValues.length,
        count: yieldValues.length,
        totalYield: yieldValues.reduce((sum, val) => sum + val, 0),
      }))
      .sort((a, b) => a.day - b.day);
  }, [filteredData, harvestRange]);

  const stageDistribution = useMemo(() => {
    const stageCounts = filteredData.reduce(
      (acc: { [key: string]: number }, item) => {
        const stage = item.Stage;
        let groupedStage = stage;
        if (stage && stage.toLowerCase().includes("vegetative")) {
          groupedStage = "Tillering Stage";
        } else if (stage && stage.toLowerCase().includes("maturity")) {
          groupedStage = "Maturity Stage";
        } else if (stage && stage.toLowerCase().includes("germination")) {
          groupedStage = "Germination Stage";
        } else if (stage && stage.toLowerCase().includes("grand growth")) {
          groupedStage = "Grand Growth Stage";
        }
        acc[groupedStage] = (acc[groupedStage] || 0) + 1;
        return acc;
      },
      {},
    );

    const requiredStages = [
      { stage: "Germination Stage", color: STATUS_COLOR_PALETTE[0] },
      { stage: "Grand Growth Stage", color: STATUS_COLOR_PALETTE[1] },
      { stage: "Maturity Stage", color: STATUS_COLOR_PALETTE[2] },
      { stage: "Tillering Stage", color: STATUS_COLOR_PALETTE[3] },
    ];

    return requiredStages.map(({ stage, color }) => ({
      stage,
      plots: stageCounts[stage] || 0,
      color,
    }));
  }, [filteredData]);

  const keyMetrics = useMemo(() => {
    const totalArea = filteredData.reduce(
      (sum, item) => sum + (item["Area (Hect)"] || 0),
      0,
    );
    const avgYield = filteredData.length
      ? (
          filteredData.reduce(
            (sum, item) => sum + (item["Prediction Yield (T/acre)"] || 0),
            0,
          ) / filteredData.length
        ).toFixed(2)
      : "-";
    const avgRecovery = filteredData.length
      ? (
          filteredData.reduce(
            (sum, item) => sum + (item["Recovery (Degree)"] || 0),
            0,
          ) / filteredData.length
        ).toFixed(2)
      : "-";

    return [
      {
        label: "Total Area (acre)",
        value: totalArea ? totalArea.toFixed(2) : "-",
        icon: BarChart3,
      },
      {
        label: "Avg. Distance (KM)",
        value: filteredData.length
          ? (
              filteredData.reduce(
                (sum, item) => sum + (item["Distance (km)"] || 0),
                0,
              ) / filteredData.length
            ).toFixed(2)
          : "-",
        icon: MapPin,
      },
      {
        label: "Expected Yield (T/acre)",
        value: avgYield,
        icon: TrendingUp,
      },
      {
        label: "Recovery % (Expected)",
        value: avgRecovery,
        icon: Activity,
      },
    ];
  }, [filteredData]);

  const mapCenter = useMemo((): [number, number] | null => {
    if (filteredData.length > 0) {
      const validData = filteredData.filter(
        (item) =>
          item.Latitude &&
          item.Longitude &&
          item.Latitude !== 19.765 &&
          item.Longitude !== 74.475,
      );
      if (validData.length > 0) {
        const avgLat =
          validData.reduce((sum, item) => sum + (item.Latitude || 0), 0) /
          validData.length;
        const avgLng =
          validData.reduce((sum, item) => sum + (item.Longitude || 0), 0) /
          validData.length;
        return [avgLat, avgLng];
      }
    }
    return null;
  }, [filteredData]);

  const getPlotColor = useMemo(
    () =>
      (item: HarvestData): string => {
        const status = item["Sugarcane Status"];
        return statusColorMap[status] || STATUS_COLOR_PALETTE[0];
      },
    [statusColorMap],
  );

  function MapAutoCenter({ center }: MapAutoCenterProps) {
    const map = useMap();
    useEffect(() => {
      if (
        center &&
        Array.isArray(center) &&
        center.length === 2 &&
        !center.some(isNaN)
      ) {
        map.setView(center, map.getZoom());
      }
    }, [center, map]);
    return null;
  }

  const FilterDropdown: React.FC<FilterDropdownProps & { isLoading?: boolean }> = ({
    label,
    value,
    options,
    onChange,
    isLoading,
  }) => (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        {isLoading && (
          <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
        )}
      </div>
      <div className="relative box-border">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
          className={`w-full bg-white border rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none transition-colors ${
            isLoading
              ? "border-gray-200 text-gray-400 cursor-wait bg-gray-50"
              : "border-gray-300 text-gray-900"
          }`}
        >
          {isLoading ? (
            <option>Loading…</option>
          ) : (
            options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))
          )}
        </select>
        {isLoading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin pointer-events-none" />
        ) : (
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        )}
      </div>
    </div>
  );

  const isInitialLoad = loading && rawData.length === 0;

  const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
    <div
      className={`animate-pulse rounded-xl bg-gray-200/80 ${className || ""}`}
      aria-hidden
    />
  );

  if (isInitialLoad) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <div className="text-lg font-semibold text-gray-900">
                Harvest Dashboard
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading data…
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl p-6 shadow-sm border border-gray-100"
                >
                  <div className="flex items-center justify-between mb-3">
                    <SkeletonBlock className="h-8 w-8 rounded-lg" />
                  </div>
                  <SkeletonBlock className="h-8 w-28 mb-2" />
                  <SkeletonBlock className="h-4 w-36" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-3 space-y-3">
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <SkeletonBlock className="h-5 w-24 mb-2" />
                <SkeletonBlock className="h-10 w-full" />
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <SkeletonBlock className="h-5 w-24 mb-2" />
                <SkeletonBlock className="h-10 w-full" />
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <SkeletonBlock className="h-5 w-24 mb-2" />
                <SkeletonBlock className="h-10 w-full" />
              </div>
            </div>

            <div className="lg:col-span-9">
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <SkeletonBlock className="h-6 w-40" />
                  <SkeletonBlock className="h-9 w-28 rounded-lg" />
                </div>
                <div className="p-4">
                  <SkeletonBlock className="h-[420px] w-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        {loading && rawData.length > 0 && (
          <div className="mb-4 flex items-center justify-end gap-2 text-sm text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Refreshing…
          </div>
        )}
        <div className="mb-8">
          {/* <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border shadow-sm">
              <Calendar className="w-4 h-4 text-blue-500" />
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value }))
                }
                className="border-none outline-none text-sm"
              />
            </div>
          </div> */}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
            {keyMetrics.map((metric, index) => {
              const IconComponent = metric.icon;
              return (
                <div
                  key={index}
                  className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-2">
                    <IconComponent className="w-8 h-8 text-blue-500" />
                  </div>
                  <div className="text-3xl font-bold text-gray-900 mb-1">
                    {metric.value}
                  </div>
                  <div className="text-sm text-gray-600">{metric.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 space-y-2">
            <div className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
              {/* Filter panel header */}
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">Filters</span>
                {dropdownsLoading && (
                  <span className="flex items-center gap-1 text-xs text-blue-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading data…
                  </span>
                )}
              </div>

              {/* Error banner */}
              {fetchError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                  ⚠️ {fetchError}
                </div>
              )}

              <FilterDropdown
                label="Manager"
                value={filters.manager}
                options={managerOptions}
                isLoading={dropdownsLoading}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, manager: value }))
                }
              />
              <FilterDropdown
                label="Region"
                value={filters.region}
                options={regionOptions}
                isLoading={loading}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, region: value }))
                }
              />
              <FilterDropdown
                label="Representative"
                value={filters.representative}
                options={representativeOptions}
                isLoading={dropdownsLoading}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, representative: value }))
                }
              />
              <FilterDropdown
                label="Sugarcane Type"
                value={filters.sugarcaneType}
                options={sugarcaneTypeOptions}
                isLoading={loading}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, sugarcaneType: value }))
                }
              />
              <FilterDropdown
                label="Variety"
                value={filters.variety}
                options={varietyOptions}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, variety: value }))
                }
              />
            </div>
          </div>

          <div className="lg:col-span-9 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="relative w-full h-[400px]">
                  <div
                    className="absolute top-4 right-4 z-20 bg-white text-gray-700 border border-gray-200 shadow-md p-2 rounded cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (!document.fullscreenElement) {
                        mapWrapperRef.current?.requestFullscreen();
                      } else {
                        document.exitFullscreen();
                      }
                    }}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </div>
                  <div ref={mapWrapperRef} className="w-full h-full">
                    {mapCenter ? (
                      <MapContainer
                        center={mapCenter}
                        zoom={7.5}
                        minZoom={1}
                        maxZoom={25}
                        className="w-full h-full"
                        style={{
                          height: "100%",
                          width: "100%",
                          borderRadius: "inherit",
                        }}
                      >
                        <MapAutoCenter center={mapCenter} />
                        <TileLayer
                          url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                          attribution="© Google"
                          maxZoom={25}
                          maxNativeZoom={21}
                          minZoom={1}
                          tileSize={256}
                          zoomOffset={0}
                        />
                        {plotPoints.map((plot) => (
                          <React.Fragment key={plot.id}>
                            {/* Plot Boundary Polygon */}
                            {plot.boundaryCoordinates &&
                              plot.boundaryCoordinates.length > 0 && (
                                <Polygon
                                  positions={plot.boundaryCoordinates}
                                  pathOptions={{
                                    color: getPlotColor(plot.raw),
                                    fillColor: getPlotColor(plot.raw),
                                    fillOpacity: 0.2,
                                    weight: 2,
                                  }}
                                />
                              )}
                            {/* Plot Center Point */}
                            <CircleMarker
                              center={plot.position}
                              radius={8}
                              pathOptions={{
                                color: getPlotColor(plot.raw),
                                fillColor: getPlotColor(plot.raw),
                                fillOpacity: 0.8,
                                weight: 2,
                              }}
                            >
                              <Popup>
                                <div className="text-sm">
                                  <div className="font-semibold text-gray-900 mb-1">
                                    Plot {plot.plotNo}
                                  </div>
                                  <div className="text-gray-600 mb-1">
                                    Status:{" "}
                                    <span className="font-medium">
                                      {plot.status}
                                    </span>
                                  </div>
                                  <div className="text-gray-600">
                                    Area:{" "}
                                    <span className="font-medium">
                                      {plot.area}
                                    </span>
                                  </div>
                                </div>
                              </Popup>
                            </CircleMarker>
                          </React.Fragment>
                        ))}
                      </MapContainer>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-100">
                        <div className="text-gray-500">
                          No plot data available
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1 bg-white rounded-xl p-6 shadow-sm border border-gray-100 h-[400px] flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Sugarcane Status
                  </h3>
                </div>
                <div className="flex-1 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={plotStatusData}
                        cx="50%"
                        cy="50%"
                        innerRadius="40%"
                        outerRadius="70%"
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {plotStatusData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              STATUS_COLOR_PALETTE[
                                index % STATUS_COLOR_PALETTE.length
                              ]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mb-4">
                  {plotStatusData.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: STATUS_COLOR_PALETTE[index],
                          }}
                        ></div>
                        <span className="text-sm text-gray-700">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <CombinedChart
            harvestData={harvestData}
            brixData={brixData}
            stageDistribution={stageDistribution}
            filteredData={filteredData}
            harvestRange={harvestRange}
            setHarvestRange={setHarvestRange}
            activeChart={activeChart}
            setActiveChart={setActiveChart}
          />
        </div>
      </div>
    </div>
  );
};

export default HarvestDashboard;
