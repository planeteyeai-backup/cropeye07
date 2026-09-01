import api, {
  getTeamConnect,
  getCurrentUser,
  getOwnerFieldOfficersAgroStats,
  getMyFieldOfficers,
  getManagerFieldOfficersAgroStats,
  getAllFarmsWithFarmerDetails,
  getIndustries,
  fetchDistrictTotalPlotArea,
  normalizeDistrictForEventsApi,
  resolveManagerDistrictForEventsApi,
  type DistrictTotalPlotAreaResponse,
  FARMS_ALL_CACHE_KEY,
} from "../api";
import { removeCache } from "../utils/cache";
import { PLOT_BOUNDARY_UPDATED_EVENT } from "../utils/plotBoundarySync";
import {
  buildOwnerHarvestRows,
  collectCropVarietiesFromFarmRows,
  collectHarvestFilterOptions,
  collectHarvestFilterOptionsFromHierarchy,
  enrichHierarchyWithFarmRows,
  extractFactoryLatLng,
  filterHarvestRows,
  hierarchyHasPlottableData,
  mergeHarvestFilterOptions,
  normalizeRegionLabel,
  parseManagerFieldOfficersResponse,
  parseOwnerHierarchyResponse,
  parseTeamConnectHierarchy,
  personDisplayName,
  pickBestHierarchy,
  rowBelongsToManager,
  rowBelongsToFieldOfficer,
  rowMatchesRegion,
  inferDistrictSlugFromHarvestRows,
  sumHarvestAreaFromAgroStats,
  sumHarvestAreaFromRows,
  type TeamConnectHarvestRow,
  type TeamConnectHierarchy,
} from "../utils/teamConnectHarvest";
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


// Chart Types
const CHART_TYPES = {
  BRIX: "brix",
  HARVEST: "harvest",
  PLANTATION: "plantation",
} as const;

type ChartType = (typeof CHART_TYPES)[keyof typeof CHART_TYPES];

// Type definitions
interface Filters {
  managerId: string;
  fieldOfficerId: string;
  region: string;
  sugarcaneType: string;
  variety: string;
}

interface FilterOption {
  value: string;
  label: string;
}

interface HarvestData {
  id?: string;
  "Plot No"?: string;
  "plot in no."?: string;
  Latitude: number;
  Longitude: number;
  "Sugarcane Status": string;
  "Area (acre)": number;
  Days: number;
  /** Legacy typo key (kept for safety). */
  "Prediction Yield (T/acer)"?: number | null;
  "Prediction Yield (T/acre)"?: number | null;
  "Brix (Degree)": number | null;
  "Recovery (Degree)": number | null;
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

interface FilterDropdownProps {
  label: string;
  value: string;
  options: FilterOption[];
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
  }) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      const day = entry.day;
      const brixValues: number[] = [];
      for (const item of filteredData) {
        const v = item["Brix (Degree)"];
        if (
          item.Days === day &&
          typeof v === "number" &&
          Number.isFinite(v)
        ) {
          brixValues.push(v);
        }
      }
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

type HarvestDashMode = "owner" | "manager";

interface HarvestDashboardProps {
  mode?: HarvestDashMode;
}

const HarvestDashboard: React.FC<HarvestDashboardProps> = ({
  mode = "owner",
}) => {
  const isManagerMode = mode === "manager";
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const [activeChart, setActiveChart] = useState<ChartType>(CHART_TYPES.BRIX);
  const [filters, setFilters] = useState<Filters>({
    managerId: "All",
    fieldOfficerId: "All",
    region: "All",
    sugarcaneType: "All",
    variety: "All",
  });
  const [harvestRange, setHarvestRange] = useState<[number, number]>([
    -50, 100,
  ]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dropdownsLoading, setDropdownsLoading] = useState<boolean>(true);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  const loadStartedAtRef = useRef<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // District total area (Events API: /districts/{district}/total-plot-area)
  const [managerDistrict, setManagerDistrict] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [districtAreaData, setDistrictAreaData] = useState<DistrictTotalPlotAreaResponse | null>(null);
  const [districtAreaLoading, setDistrictAreaLoading] = useState(false);

  const [rawData, setRawData] = useState<TeamConnectHarvestRow[]>([]);
  const [hierarchyMeta, setHierarchyMeta] = useState<TeamConnectHierarchy>({
    managers: [],
    fieldOfficers: [],
    farmers: [],
  });
  /** Kept for agroStats auto-refresh without reloading FO/farms. */
  const managerHarvestCtxRef = useRef<{
    hierarchy: TeamConnectHierarchy;
    me: any;
    farmRows: any[];
    agroStats: Record<string, unknown>;
  } | null>(null);
  const ownerHarvestCtxRef = useRef<{
    hierarchy: TeamConnectHierarchy;
    me: any;
    farmRows: any[];
    industries: any[];
    agroStats: Record<string, unknown>;
  } | null>(null);
  const [managerAgroStats, setManagerAgroStats] = useState<Record<string, unknown>>(
    {},
  );
  const agroRefreshingRef = useRef(false);
  const districtFetchAttemptRef = useRef("");
  const applyHarvestRowsRef = useRef<
    | ((
        hierarchy: TeamConnectHierarchy,
        agroStats: Record<string, unknown>,
        farmRows: any[],
        me: any,
        industries: any[],
        opts?: { resetFilters?: boolean },
      ) => TeamConnectHarvestRow[])
    | null
  >(null);
  const [boundaryRefreshToken, setBoundaryRefreshToken] = useState(0);

  // Dynamic filter options
  const [regionOptions, setRegionOptions] = useState<FilterOption[]>([
    { value: "All", label: "All" },
  ]);
  const [representativeOptions, setRepresentativeOptions] = useState<
    FilterOption[]
  >([{ value: "All", label: "All" }]);
  const [sugarcaneTypeOptions, setSugarcaneTypeOptions] = useState<
    FilterOption[]
  >([{ value: "All", label: "All" }]);
  const [varietyOptions, setVarietyOptions] = useState<FilterOption[]>([
    { value: "All", label: "All" },
  ]);
  /** True until /farms/ enrich finishes — Variety is empty without crop_variety from farms. */
  const [varietyLoading, setVarietyLoading] = useState(true);
  /** Farm crop_variety list — cascade must not wipe this when plot rows lack Variety. */
  const farmVarietyNamesRef = useRef<string[]>([]);

  const managerOptions = useMemo<FilterOption[]>(() => {
    const managers = hierarchyMeta.managers ?? [];
    return [
      { value: "All", label: "All" },
      ...managers.map((manager) => ({
        value: String(manager?.id ?? manager?.user_id ?? ""),
        label: personDisplayName(manager),
      })),
    ].filter((option) => option.value !== "");
  }, [hierarchyMeta.managers]);

  // Debounce non-representative filters
  const debouncedManagerId = useDebouncedValue(filters.managerId, 300);
  const debouncedRegion = useDebouncedValue(filters.region, 300);
  const debouncedSugarcaneType = useDebouncedValue(filters.sugarcaneType, 300);
  const debouncedVariety = useDebouncedValue(filters.variety, 300);

  const resolveDistrictForArea = (): string => {
    return normalizeDistrictForEventsApi(managerDistrict);
  };

  // Fetch district total area from Events API (district-wide, not per region filter).
  const fetchDistrictArea = async (district: string) => {
    const d = normalizeDistrictForEventsApi(district);
    if (!d) {
      setDistrictAreaData(null);
      return;
    }
    setDistrictAreaLoading(true);
    setDistrictAreaData(null);
    try {
      const json = await fetchDistrictTotalPlotArea(d);
      setDistrictAreaData(json);
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.warn("[Harvest] district total area failed:", err);
      }
      setDistrictAreaData(null);
    } finally {
      setDistrictAreaLoading(false);
    }
  };

  useEffect(() => {
    if (!isManagerMode || !managerUserId) return;
    const district = resolveDistrictForArea();
    if (!district) {
      setDistrictAreaData(null);
      return;
    }
    fetchDistrictArea(district);
    // Region filter only narrows table rows — district total area stays district-wide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagerMode, managerUserId, managerDistrict]);

  // If profile did not yield a district slug, infer Mandya/etc. from loaded plot regions.
  useEffect(() => {
    if (!isManagerMode || !managerUserId || !rawData.length) return;
    const inferred = inferDistrictSlugFromHarvestRows(rawData);
    if (!inferred) return;

    if (!managerDistrict) {
      setManagerDistrict(inferred);
    }

    if (!districtAreaData && districtFetchAttemptRef.current !== inferred) {
      districtFetchAttemptRef.current = inferred;
      void fetchDistrictArea(inferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagerMode, managerUserId, managerDistrict, rawData, districtAreaData]);

  const isLoadingHarvest = loading || dropdownsLoading;


  useEffect(() => {
    if (!isLoadingHarvest) {
      loadStartedAtRef.current = null;
      setLoadElapsedSec(0);
      return;
    }

    if (loadStartedAtRef.current == null) {
      loadStartedAtRef.current = Date.now();
      setLoadElapsedSec(0);
    }

    const timerId = window.setInterval(() => {
      if (loadStartedAtRef.current == null) return;
      setLoadElapsedSec(
        Math.floor((Date.now() - loadStartedAtRef.current) / 1000),
      );
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isLoadingHarvest]);

  const harvestLoadHint = isManagerMode
    ? "Loading field officers & yield… variety filters may fill in a moment."
    : "";

  const harvestLoadingLabel =
    loadElapsedSec > 0
      ? `Loading data… ${loadElapsedSec}s`
      : "Loading data…";

  useEffect(() => {
    let alive = true;
    const cleanups: Array<() => void> = [];

    const applyHarvestRows = (
      hierarchy: TeamConnectHierarchy,
      agroStats: Record<string, unknown>,
      farmRows: any[],
      me: any,
      industries: any[],
      opts?: { resetFilters?: boolean },
    ) => {
      applyHarvestRowsRef.current = applyHarvestRows;
      const enriched = enrichHierarchyWithFarmRows(hierarchy, farmRows);
      const factoryCenter = extractFactoryLatLng(
        me,
        me?.industry,
        industries[0],
        ...industries,
        Object.values(agroStats)[0],
      );
      const allData = buildOwnerHarvestRows(
        enriched,
        agroStats as Record<string, any>,
        { factoryCenter, farmRows },
      );
      const fromRows = collectHarvestFilterOptions(allData);
      const fromHierarchy = collectHarvestFilterOptionsFromHierarchy(enriched);
      const fromFarms = collectCropVarietiesFromFarmRows(farmRows);
      // Do not wipe a prior farm variety list when a refresh passes empty farmRows.
      if (fromFarms.length > 0) {
        farmVarietyNamesRef.current = fromFarms;
      }
      const varietySource =
        fromFarms.length > 0 ? fromFarms : farmVarietyNamesRef.current;
      const options = mergeHarvestFilterOptions(fromRows, fromHierarchy, {
        managers: [],
        representatives: [],
        regions: [],
        sugarcaneTypes: [],
        varieties: varietySource,
      });

      if (!alive) return allData;

      setHierarchyMeta(enriched);
      setRegionOptions(
        options.regions.length > 0
          ? [
              { value: "All", label: "All" },
              ...options.regions.map((value) => ({ value, label: value })),
            ]
          : [{ value: "All", label: "All" }],
      );
      setSugarcaneTypeOptions(
        options.sugarcaneTypes.length > 0
          ? [
              { value: "All", label: "All" },
              ...options.sugarcaneTypes.map((value) => ({
                value,
                label: value,
              })),
            ]
          : [{ value: "All", label: "All" }],
      );
      setVarietyOptions(
        options.varieties.length > 0
          ? [
              { value: "All", label: "All" },
              ...options.varieties.map((value) => ({ value, label: value })),
            ]
          : [{ value: "All", label: "All" }],
      );
      // Only reset filters on the first paint — background variety enrich must keep user picks.
      if (opts?.resetFilters !== false) {
        setFilters({
          managerId: "All",
          fieldOfficerId: "All",
          region: "All",
          sugarcaneType: "All",
          variety: "All",
        });
      }
      setRawData(allData);
      return allData;
    };

    async function fetchData() {
      setLoading(true);
      setDropdownsLoading(true);
      setVarietyLoading(true);
      loadStartedAtRef.current = Date.now();
      setLoadElapsedSec(0);
      setFetchError(null);

      try {
        const today = new Date().toISOString().slice(0, 10);

        // ── Manager: me + FO once; agroStats reuses FO cache (no duplicate FO HTTP) ──
        if (isManagerMode) {
          const [meSettled, officersSettled] = await Promise.allSettled([
            getCurrentUser(),
            getMyFieldOfficers(),
          ]);

          if (!alive) return;

          if (officersSettled.status === "rejected") {
            const err: any = officersSettled.reason;
            setFetchError(
              err?.response?.data?.detail ||
                err?.message ||
                "Could not load field officers. Please try again.",
            );
            setDropdownsLoading(false);
            setVarietyLoading(false);
            setRawData([]);
            setLoading(false);
            return;
          }

          const me =
            meSettled.status === "fulfilled"
              ? (meSettled.value?.data ?? null)
              : null;
          const officersPayload = officersSettled.value?.data;
          const hierarchy = parseManagerFieldOfficersResponse(officersPayload);
          setManagerUserId(String(me?.id ?? me?.user_id ?? ""));
          const districtSlug = resolveManagerDistrictForEventsApi(
            me,
            hierarchy.fieldOfficers,
            officersPayload?.manager ?? hierarchy.managers?.[0],
            me?.industry,
          );
          setManagerDistrict(districtSlug);
          districtFetchAttemptRef.current = districtSlug;
          setDistrictAreaData(null);

          let agroStats: Record<string, unknown> = {};
          try {
            // Always hit Events agroStats when opening Harvest Planning.
            // Without force:true, login prefetch cache hides the Network request.
            agroStats = (await getManagerFieldOfficersAgroStats(undefined, {
              force: true,
            })) as Record<string, unknown>;
            setManagerAgroStats(agroStats);
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn("[Harvest] manager agroStats failed:", err);
            }
          }

          managerHarvestCtxRef.current = {
            hierarchy,
            me,
            farmRows: [],
            agroStats,
          };

          // First paint: FO hierarchy + agroStats (map/KPIs). Farms only enrich variety.
          const firstRows = applyHarvestRows(
            hierarchy,
            agroStats,
            [],
            me,
            [],
          );
          setDropdownsLoading(false);
          setLoading(false);
          if (firstRows.length === 0) {
            setFetchError(
              "No harvest plots found for your field officers. Check FO assignments or try again later.",
            );
          }

          let lastAgroFetchAt = Date.now();
          const AGRO_REFRESH_MIN_MS = 2 * 60 * 1000;

          // Soft refresh only — do NOT force-hit right after the first fetch (that doubled agroStats).
          const refreshAgroStats = async (opts?: { force?: boolean }) => {
            if (!alive || agroRefreshingRef.current) return;
            const now = Date.now();
            if (
              !opts?.force &&
              now - lastAgroFetchAt < AGRO_REFRESH_MIN_MS
            ) {
              return;
            }
            const ctx = managerHarvestCtxRef.current;
            if (!ctx) return;
            agroRefreshingRef.current = true;
            try {
              const fresh = (await getManagerFieldOfficersAgroStats(undefined, {
                force: true,
              })) as Record<string, unknown>;
              setManagerAgroStats(fresh);
              lastAgroFetchAt = Date.now();
              if (!alive) return;
              let farmRows = ctx.farmRows;
              try {
                const latestFarms = await getAllFarmsWithFarmerDetails({
                  force: true,
                });
                if (latestFarms?.length) farmRows = latestFarms;
              } catch {
                /* keep previous farmRows */
              }
              if (managerHarvestCtxRef.current) {
                managerHarvestCtxRef.current = {
                  ...managerHarvestCtxRef.current,
                  farmRows,
                  agroStats: fresh,
                };
              }
              applyHarvestRows(
                ctx.hierarchy,
                fresh,
                farmRows,
                ctx.me,
                [],
                { resetFilters: false },
              );
            } catch (err) {
              if (import.meta.env.DEV) {
                console.warn("[Harvest] agroStats auto-refresh failed:", err);
              }
            } finally {
              agroRefreshingRef.current = false;
            }
          };

          // Background: farms pagination (was the main multi-loading delay).
          void getAllFarmsWithFarmerDetails({ force: true })
            .then((farmRows) => {
              if (!alive) return;
              if (farmRows?.length && managerHarvestCtxRef.current) {
                managerHarvestCtxRef.current = {
                  ...managerHarvestCtxRef.current,
                  farmRows,
                };
              }
              const enrichedRows = applyHarvestRows(
                hierarchy,
                agroStats,
                farmRows || [],
                me,
                [],
                { resetFilters: false },
              );
              if (enrichedRows.length > 0) setFetchError(null);
            })
            .catch((err) => {
              if (import.meta.env.DEV) {
                console.warn(
                  "[Harvest] /farms/?include_farmer=true failed:",
                  err,
                );
              }
            })
            .finally(() => {
              if (alive) setVarietyLoading(false);
            });

          // Auto-refresh agroStats every 5 minutes while Harvest stays open.
          const refreshMs = 5 * 60 * 1000;
          const intervalId = window.setInterval(() => {
            void refreshAgroStats({ force: true });
          }, refreshMs);

          const onVisible = () => {
            if (document.visibilityState === "visible") {
              // Cooldown prevents spam when tab focus flickers.
              void refreshAgroStats();
            }
          };
          document.addEventListener("visibilitychange", onVisible);

          cleanups.push(() => {
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", onVisible);
          });
          return;
        }

        // ── Owner path: me + team once; agroStats reuses hierarchy; farms parallel for variety ──
        let agroStats: Record<string, unknown> = {};
        let hierarchy: TeamConnectHierarchy = {
          managers: [],
          fieldOfficers: [],
          farmers: [],
        };
        let me: any = null;

        try {
          const meRes = await getCurrentUser();
          me = meRes?.data ?? null;
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[Harvest] /users/me/ failed:", err);
          }
        }

        const industryId =
          me?.industry_id ??
          me?.industry?.id ??
          me?.industry?.industry_id ??
          me?.industryId;

        const [teamSettled, ownerHierarchySettled] = await Promise.allSettled([
          getTeamConnect(industryId),
          api.get("/users/owner-hierarchy/"),
        ]);

        const teamHierarchy =
          teamSettled.status === "fulfilled"
            ? parseTeamConnectHierarchy(teamSettled.value?.data)
            : { managers: [], fieldOfficers: [], farmers: [] };

        if (teamSettled.status === "rejected") {
          throw teamSettled.reason;
        }

        const ownerHierarchy =
          ownerHierarchySettled.status === "fulfilled"
            ? parseOwnerHierarchyResponse(ownerHierarchySettled.value?.data)
            : teamHierarchy;

        hierarchy = pickBestHierarchy(teamHierarchy, ownerHierarchy);
        if (!hierarchyHasPlottableData(hierarchy)) {
          hierarchy = hierarchyHasPlottableData(ownerHierarchy)
            ? ownerHierarchy
            : teamHierarchy;
        }

        setHierarchyMeta(hierarchy);

        // Start farms/industries while agroStats runs (cuts total wait for variety).
        const farmsPromise = getAllFarmsWithFarmerDetails({ force: true });
        const industriesPromise = getIndustries()
          .then((industriesRes) => {
            const data = industriesRes?.data;
            return Array.isArray(data?.results)
              ? data.results
              : Array.isArray(data)
                ? data
                : [];
          })
          .catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("[Harvest] /users/industries/ failed:", err);
            }
            return [] as any[];
          });

        try {
          agroStats = (await getOwnerFieldOfficersAgroStats(today, {
            hierarchy,
          })) as Record<string, unknown>;
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[Harvest] agroStats failed:", err);
          }
        }

        if (!alive) return;

        ownerHarvestCtxRef.current = {
          hierarchy,
          me,
          farmRows: [],
          industries: [],
          agroStats,
        };

        // First paint: map/KPIs. Keep dropdowns loading until farms fill variety.
        const firstRows = applyHarvestRows(hierarchy, agroStats, [], me, [], {
          resetFilters: true,
        });
        setLoading(false);
        if (firstRows.length === 0) {
          setFetchError(
            "No harvest plots found. Check team-connect has farmers with plots, or try again later.",
          );
        }

        try {
          const [farmsSettled, industriesSettled] = await Promise.allSettled([
            farmsPromise,
            industriesPromise,
          ]);

          if (!alive) return;

          const farmRows =
            farmsSettled.status === "fulfilled" ? farmsSettled.value : [];
          if (farmsSettled.status === "rejected" && import.meta.env.DEV) {
            console.warn(
              "[Harvest] /farms/?include_farmer=true failed:",
              farmsSettled.reason,
            );
          }

          const industries =
            industriesSettled.status === "fulfilled"
              ? industriesSettled.value
              : [];

          const enrichedRows = applyHarvestRows(
            hierarchy,
            agroStats,
            farmRows || [],
            me,
            industries || [],
            { resetFilters: false },
          );
          if (ownerHarvestCtxRef.current) {
            ownerHarvestCtxRef.current = {
              ...ownerHarvestCtxRef.current,
              farmRows: farmRows || [],
              industries: industries || [],
            };
          }
          if (enrichedRows.length > 0) setFetchError(null);
        } finally {
          if (alive) {
            setDropdownsLoading(false);
            setVarietyLoading(false);
          }
        }

        return;
      } catch (err: any) {
        if (!alive) return;
        console.error("Harvest dashboard fetch error:", err);
        setFetchError(
          err?.response?.data?.detail ||
            err?.message ||
            "Failed to load data. Please try again.",
        );
        setVarietyLoading(false);
        setDropdownsLoading(false);
        setRawData([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchData();
    return () => {
      alive = false;
      cleanups.forEach((fn) => fn());
    };
  }, [isManagerMode]);

  // After farmer KML save: bust farms cache and remap polygons from GET /farms/.
  useEffect(() => {
    const onBoundaryUpdated = () => {
      removeCache(FARMS_ALL_CACHE_KEY);
      setBoundaryRefreshToken((token) => token + 1);
    };
    window.addEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    return () => {
      window.removeEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    };
  }, []);

  useEffect(() => {
    if (boundaryRefreshToken === 0) return;
    const applyRows = applyHarvestRowsRef.current;
    if (!applyRows) return;

    const ctx = isManagerMode
      ? managerHarvestCtxRef.current
      : ownerHarvestCtxRef.current;
    if (!ctx) return;

    void (async () => {
      try {
        const farmRows = await getAllFarmsWithFarmerDetails({ force: true });
        if (isManagerMode && managerHarvestCtxRef.current) {
          managerHarvestCtxRef.current = {
            ...managerHarvestCtxRef.current,
            farmRows: farmRows || [],
          };
        }
        if (!isManagerMode && ownerHarvestCtxRef.current) {
          ownerHarvestCtxRef.current = {
            ...ownerHarvestCtxRef.current,
            farmRows: farmRows || [],
          };
        }
        applyRows(
          ctx.hierarchy,
          ctx.agroStats ?? {},
          farmRows || [],
          ctx.me,
          isManagerMode ? [] : ownerHarvestCtxRef.current?.industries ?? [],
          { resetFilters: false },
        );
      } catch {
        // Best-effort — user can hard refresh.
      }
    })();
  }, [boundaryRefreshToken, isManagerMode]);

  // Cascade dropdown options from harvest rows only (values present in response data).
  // Do not seed from hierarchy/scopedOptions — that shows empty/unavailable varieties & regions.
  useEffect(() => {
    const hasValue = (value: unknown): value is string =>
      typeof value === "string" &&
      value.trim() !== "" &&
      value.trim().toLowerCase() !== "unknown" &&
      value.trim().toLowerCase() !== "all";

    const managerFiltered =
      debouncedManagerId === "All"
        ? rawData
        : rawData.filter((item) =>
            rowBelongsToManager(item, debouncedManagerId, hierarchyMeta),
          );

    const regionSet = new Set<string>();
    managerFiltered.forEach((item) => {
      if (hasValue(item.Region)) {
        regionSet.add(normalizeRegionLabel(item.Region));
      }
    });
    setRegionOptions(
      regionSet.size > 0
        ? [
            { value: "All", label: "All" },
            ...Array.from(regionSet)
              .sort()
              .map((value) => ({ value, label: value })),
          ]
        : [{ value: "All", label: "All" }],
    );

    const regionFiltered =
      debouncedRegion === "All"
        ? managerFiltered
        : managerFiltered.filter((item) =>
            rowMatchesRegion(item, debouncedRegion, hierarchyMeta),
          );

    const repMap = new Map<string, string>();
    regionFiltered.forEach((item) => {
      if (!item.fieldOfficerId) return;
      const label = hasValue(item.representative)
        ? item.representative
        : String(item.fieldOfficerId);
      repMap.set(String(item.fieldOfficerId), label);
    });
    setRepresentativeOptions(
      repMap.size > 0
        ? [
            { value: "All", label: "All" },
            ...Array.from(repMap.entries())
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([value, label]) => ({ value, label })),
          ]
        : [{ value: "All", label: "All" }],
    );

    const repFiltered =
      filters.fieldOfficerId === "All"
        ? regionFiltered
        : regionFiltered.filter((item) =>
            rowBelongsToFieldOfficer(
              item,
              filters.fieldOfficerId,
              hierarchyMeta,
            ),
          );

    const typeSet = new Set<string>();
    repFiltered.forEach((item) => {
      if (hasValue(item["Sugarcane Type"])) {
        typeSet.add(item["Sugarcane Type"].trim());
      }
    });
    setSugarcaneTypeOptions(
      typeSet.size > 0
        ? [
            { value: "All", label: "All" },
            ...Array.from(typeSet)
              .sort()
              .map((value) => ({ value, label: value })),
          ]
        : [{ value: "All", label: "All" }],
    );

    const typeFiltered =
      debouncedSugarcaneType === "All"
        ? repFiltered
        : repFiltered.filter(
            (item) => item["Sugarcane Type"] === debouncedSugarcaneType,
          );

    const varietySet = new Set<string>();
    typeFiltered.forEach((item) => {
      if (hasValue(item.Variety)) {
        varietySet.add(item.Variety.trim());
      }
    });
    // Always keep /farms/ crop_variety names — plot rows often miss Variety (key mismatch).
    farmVarietyNamesRef.current.forEach((v) => {
      if (hasValue(v)) varietySet.add(v.trim());
    });
    setVarietyOptions(
      varietySet.size > 0
        ? [
            { value: "All", label: "All" },
            ...Array.from(varietySet)
              .sort()
              .map((value) => ({ value, label: value })),
          ]
        : [{ value: "All", label: "All" }],
    );

    setFilters((prev) => ({
      ...prev,
      region:
        prev.region === "All" || regionSet.has(prev.region) ? prev.region : "All",
      fieldOfficerId:
        prev.fieldOfficerId === "All" || repMap.has(prev.fieldOfficerId)
          ? prev.fieldOfficerId
          : "All",
      sugarcaneType:
        prev.sugarcaneType === "All" || typeSet.has(prev.sugarcaneType)
          ? prev.sugarcaneType
          : "All",
      variety:
        prev.variety === "All" || varietySet.has(prev.variety)
          ? prev.variety
          : "All",
    }));
  }, [
    rawData,
    hierarchyMeta,
    debouncedManagerId,
    debouncedRegion,
    debouncedSugarcaneType,
    filters.fieldOfficerId,
  ]);

  const filteredData = useMemo(
    () =>
      filterHarvestRows(
        rawData,
        {
          managerId: debouncedManagerId,
          fieldOfficerId: filters.fieldOfficerId,
          region: debouncedRegion,
          sugarcaneType: debouncedSugarcaneType,
          variety: debouncedVariety,
        },
        hierarchyMeta,
      ),
    [
      rawData,
      hierarchyMeta,
      debouncedManagerId,
      debouncedRegion,
      filters.fieldOfficerId,
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
      plotNo: item["Plot No"] || `P${idx + 1}`,
      area: `${item["Area (acre)"]} acre`,
      raw: item,
      boundaryCoordinates: item.boundaryCoordinates,
    }));
  }, [filteredData, activeChart, harvestRange]);

  const brixData = useMemo(() => {
    const brixAreaByDay: { [key: number]: number } = {};
    filteredData.forEach((item) => {
      if (
        typeof item.Days === "number" &&
        typeof item["Area (acre)"] === "number"
      ) {
        brixAreaByDay[item.Days] =
          (brixAreaByDay[item.Days] || 0) + item["Area (acre)"];
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

  const extractRowArea = (item: any): number => {
    if (!item) return 0;
    const val =
      item["Area (acre)"] ??
      item["Area (acer)"] ??
      item.area_acres ??
      item.area_size ??
      item.area ??
      item.acreage ??
      item.raw?.area_acres ??
      item.raw?.area_size ??
      item.raw?.area ??
      item.raw?.farm?.area_acres ??
      item.raw?.farm?.area_size ??
      item.raw?.farm?.area ??
      item.raw?.plot?.area_acres ??
      item.raw?.plot?.area_size ??
      item.raw?.plot?.area ??
      0;
    if (typeof val === "number" && Number.isFinite(val)) return val > 0 ? val : 0;
    if (typeof val === "string") {
      const parsed = parseFloat(val.replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    return 0;
  };

  const keyMetrics = useMemo(() => {
    const summedArea = filteredData.reduce(
      (sum, item) => sum + extractRowArea(item),
      0,
    );
    const allManagerPlotArea = sumHarvestAreaFromRows(rawData);
    const agroAreaTotal = sumHarvestAreaFromAgroStats(managerAgroStats);
    const fallbackArea = Math.max(summedArea, allManagerPlotArea, agroAreaTotal);

    const totalAreaValue = isManagerMode
      ? districtAreaLoading && !districtAreaData && fallbackArea <= 0
        ? "..."
        : districtAreaData
          ? districtAreaData.total_area_acres.toFixed(2)
          : fallbackArea > 0
            ? fallbackArea.toFixed(2)
            : "-"
      : summedArea > 0
        ? summedArea.toFixed(2)
        : filteredData.length > 0
          ? "0.00"
          : "-";
    // Average only values present in agroStats (including API 0). Never invent static numbers.
    const yields = filteredData
      .map((item) => item["Prediction Yield (T/acre)"])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avgYield = yields.length
      ? (yields.reduce((sum, v) => sum + v, 0) / yields.length).toFixed(2)
      : "-";
    const recoveries = filteredData
      .map((item) => item["Recovery (Degree)"])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avgRecovery = recoveries.length
      ? (
          recoveries.reduce((sum, v) => sum + v, 0) / recoveries.length
        ).toFixed(2)
      : "-";

    return [
      {
        label: "Total Area (acre)",
        value: totalAreaValue,
        icon: BarChart3,
        sub:
          isManagerMode && districtAreaData
            ? `${districtAreaData.plot_count} plots · ${districtAreaData.district}`
            : isManagerMode && fallbackArea > 0 && !districtAreaData
              ? `${rawData.length} assigned plots`
              : undefined,
      },
      {
        label: "Avg. Distance (KM)",

        value: (() => {
          const withDistance = filteredData.filter(
            (item) => Number(item["Distance (km)"]) > 0,
          );
          if (!withDistance.length) return "-";
          const avg =
            withDistance.reduce(
              (sum, item) => sum + Number(item["Distance (km)"]),
              0,
            ) / withDistance.length;
          return avg.toFixed(2);
        })(),
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
  }, [
    filteredData,
    rawData,
    isManagerMode,
    districtAreaData,
    districtAreaLoading,
    managerAgroStats,
  ]);

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
              <option key={option.value} value={option.value}>
                {option.label}
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
              <div className="flex flex-col items-end gap-1 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {harvestLoadingLabel}
                </div>
                <p className="max-w-md text-right text-xs text-gray-500">
                  {harvestLoadHint}
                </p>
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
                  {(metric as any).sub && (
                    <div className="text-xs text-gray-400 mt-1">{(metric as any).sub}</div>
                  )}
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
                  <span className="flex flex-col items-end gap-0.5 text-xs text-blue-500">
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {harvestLoadingLabel}
                    </span>
                    <span className="text-[11px] text-blue-400/90">
                      {harvestLoadHint}
                    </span>
                  </span>
                )}
              </div>

              {/* Error banner */}
              {fetchError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                  ⚠️ {fetchError}
                </div>
              )}

              {!isManagerMode && (
                <FilterDropdown
                  label="Manager"
                  value={filters.managerId}
                  options={managerOptions}
                  isLoading={dropdownsLoading}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      managerId: value,
                      fieldOfficerId: "All",
                      region: "All",
                      sugarcaneType: "All",
                      variety: "All",
                    }))
                  }
                />
              )}
              <FilterDropdown
                label="Region"
                value={filters.region}
                options={regionOptions}
                isLoading={loading}
                onChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    region: value,
                    fieldOfficerId: "All",
                    sugarcaneType: "All",
                    variety: "All",
                  }))
                }
              />
              <FilterDropdown
                label="Representative"
                value={filters.fieldOfficerId}
                options={representativeOptions}
                isLoading={dropdownsLoading}
                onChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    fieldOfficerId: value,
                    sugarcaneType: "All",
                    variety: "All",
                  }))
                }
              />
              <FilterDropdown
                label="Sugarcane Type"
                value={filters.sugarcaneType}
                options={sugarcaneTypeOptions}
                isLoading={loading}
                onChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    sugarcaneType: value,
                    variety: "All",
                  }))
                }
              />
              <FilterDropdown
                label="Variety"
                value={filters.variety}
                options={varietyOptions}
                isLoading={varietyLoading}
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
                        {plotStatusData.map((_item, index) => (
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
