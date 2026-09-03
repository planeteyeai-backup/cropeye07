import React, { useState, useEffect, useRef, Component, type ReactNode } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ComposedChart,
  BarChart,
  Bar,
} from "recharts";
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
} from "react-leaflet";
import { LatLngBounds } from "leaflet";
import {
  AlertTriangle,
  Calendar,
  Activity,
  Target,
  Leaf,
  BarChart3,
  LineChart as LineChartIcon,
  Users,
  MapPin,
  Beaker,
  Maximize2,
  Gauge,
  Loader2,
  Sprout,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import { getCache, setCache } from "../utils/cache";
import { fetchFieldScoreForPlot, fieldScoreCacheKey } from "../utils/fieldScore";
import {
  eventsApi,
  encodePlotIdForEventsUrl,
  getMyFieldOfficers,
  getFarmsByFarmerId,
  getSinglePlotAgroStats,
  isAnalyzeSinglePlotPlantationDateError,
  PLANTATION_DATE_NOT_PROVIDED_MSG,
  FARMS_ALL_CACHE_KEY,
} from "../api"; // Authenticated Django api + FastAPI events api
import { removeCache } from "../utils/cache";
import { MANAGER_FIELD_OFFICERS_CACHE_KEY } from "../services/prefetchService";
import { useAppContext } from "../context/AppContext";
import MapCropStatusOverlay from "./MapCropStatusOverlay";
import FieldIndicesStageBadge from "./FieldIndicesStageBadge";
import { useFieldIndicesCropStage } from "../hooks/useFieldIndicesCropStage";
import { enrichPlotsWithFarmDetails } from "../utils/fertilizerStage";
import { normalizePlotKey } from "../utils/plotName";
import {
  cropConditionStyleFromCci,
  fetchWaterStressAnalysis,
  parseWaterStressMetrics,
} from "../utils/waterStressApi";
import {
  MANAGER_FARM_DASH_ATTR,
  protectManagerFarmDashSubtree,
  syncManagerDashSelectLocks,
} from "../utils/protectManagerDashFromTranslate";
import {
  PLOT_BOUNDARY_UPDATED_EVENT,
  resolveLeafletBoundaryForPlotRecord,
} from "../utils/plotBoundarySync";

// Constants (same as FarmerDashboard)
const BASE_URL = "https://events-cropeye.up.railway.app";

/** indices / stress / irrigation / analyzeSinglePlot are often slow; 10s abort shows as "(canceled)" in DevTools. */
const MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS = 90_000;
// const OPTIMAL_BIOMASS = 150;
// const SOIL_API_URL = "https://events-cropeye.up.railway.app";
// const SOIL_DATE = "2025-10-03";

const OTHER_FARMERS_RECOVERY = {
  regional_average: 7.85,
  top_quartile: 8.52,
  bottom_quartile: 6.58,
  similar_farms: 7.63,
};

// Type definitions (keeping the same as original)
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

interface CustomStressDotProps {
  cx?: number;
  cy?: number;
  payload?: any;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

interface Metrics {
  brix: number | null;
  brixMin: number | null;
  brixMax: number | null;
  recovery: number | null;
  area: number | null;
  biomass: number | null;
  totalBiomass: number | null;
  biomassMin: number | null;
  biomassMax: number | null;
  stressCount: number | null;
  stressTotalDays: number | null;
  cropConditionLabel: string | null;
  cropConditionValue: number | null;
  irrigationEvents: number | null;
  fieldScore: number | null;
  expectedYield: number | null;
  daysToHarvest: number | null;
  growthStage: string | null;
  plantationDate: string | null;
  plantationType: string | null;
  soilPH: number | null;
  organicCarbonDensity: number | null;
  actualYield: number | null;
  cnRatio: number | null;
  sugarYieldMax: number | null;
  sugarYieldMin: number | null;
  sugarYieldMean: number | null;
}

interface PieChartWithNeedleProps {
  value: number;
  max: number;
  width?: number;
  height?: number;
  title?: string;
  unit?: string;
}

const MANAGER_OFFICERS_TTL_MS = 5 * 60 * 1000;

type TimePeriod = "daily" | "weekly" | "monthly" | "yearly";

function formatPlantationDateLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function extractPlantationInfo(source: any): {
  plantationDate: string | null;
  plantationType: string | null;
} {
  if (!source) {
    return { plantationDate: null, plantationType: null };
  }

  const plantationDate = formatPlantationDateLabel(
    source.plantation_date ??
      source.planting_date ??
      source.crop_type?.plantation_date,
  );

  const plantationTypeRaw =
    source.plantation_type_display ??
    source.plantation_type ??
    source.planting_method ??
    source.crop_type?.planting_method ??
    source.crop_type?.planting_method_display ??
    source.crop_type?.plantation_type_display ??
    source.crop_type?.plantation_type;

  return {
    plantationDate,
    plantationType: plantationTypeRaw ? String(plantationTypeRaw) : null,
  };
}

function getFarmerId(farmer: any): string | null {
  const id =
    farmer?.id ?? farmer?.farmer_id ?? farmer?.farmerId ?? farmer?.user_id ?? null;
  return id != null && String(id).trim() !== "" && String(id) !== "undefined"
    ? String(id)
    : null;
}

function getPlotIdFromRecord(plot: any): string | null {
  const id =
    plot?.fastapi_plot_id ??
    plot?.events_plot_id ??
    plot?.plot_id ??
    plot?.plot_name ??
    null;
  return id != null && String(id).trim() !== "" ? String(id) : null;
}

function getPlotIdsFromFarmer(farmer: any): string[] {
  const plots = Array.isArray(farmer?.plots) ? farmer.plots : [];
  const ids: string[] = [];
  for (const plot of plots) {
    const id = getPlotIdFromRecord(plot);
    if (id) ids.push(id);
  }
  return ids;
}

/** Keep slash/underscore plot ids equivalent (Google Translate / API format drift). */
function resolvePlotIdInList(
  plotIds: string[],
  candidate: string | null | undefined,
): string | null {
  if (!candidate?.trim() || !plotIds.length) return null;
  if (plotIds.includes(candidate)) return candidate;
  const target = normalizePlotKey(candidate);
  return plotIds.find((id) => normalizePlotKey(id) === target) ?? null;
}

function managerPlotStorageKey(farmerId: string): string {
  return `cropeye:mgrSelectedPlot:${farmerId}`;
}

function managerFarmerStorageKey(officerId: string): string {
  return `cropeye:mgrSelectedFarmer:${officerId}`;
}

function readStoredManagerPlot(
  farmerId: string,
  plotIds: string[],
): string | null {
  if (!farmerId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(managerPlotStorageKey(farmerId));
    return resolvePlotIdInList(plotIds, raw);
  } catch {
    return null;
  }
}

function writeStoredManagerPlot(farmerId: string, plotId: string): void {
  if (!farmerId || !plotId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(managerPlotStorageKey(farmerId), plotId);
  } catch {
    // ignore quota / private mode
  }
}

function readStoredManagerFarmer(
  officerId: string,
  farmers: any[],
): string | null {
  if (!officerId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(managerFarmerStorageKey(officerId));
    if (!raw?.trim()) return null;
    const match = farmers.find((f: any) => getFarmerId(f) === String(raw));
    return match ? String(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredManagerFarmer(officerId: string, farmerId: string): void {
  if (!officerId || !farmerId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(managerFarmerStorageKey(officerId), farmerId);
  } catch {
    // ignore
  }
}

/** Convert GeoJSON boundary ring to Leaflet [lat, lng] pairs; ignore bad points. */
function boundaryToLeafletCoords(boundary: any): [number, number][] {
  let value = boundary;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const coordsList = value?.coordinates;
  if (!Array.isArray(coordsList) || coordsList.length === 0) return [];
  const ring = coordsList[0];
  if (!Array.isArray(ring)) return [];
  return ring
    .filter(
      (pt) =>
        Array.isArray(pt) &&
        pt.length >= 2 &&
        Number.isFinite(Number(pt[0])) &&
        Number.isFinite(Number(pt[1])),
    )
    .map(([lng, lat]: [number, number]) => [Number(lat), Number(lng)]);
}

function parseFarmsListResponse(data: unknown): any[] {
  const payload = data as { results?: unknown[] };
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(data)) return data as any[];
  return [];
}

/** Keep map errors from blanking the whole Manager dashboard. */
class MapSectionErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn("[ManagerFarmDash] map section error:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[300px] items-center justify-center bg-slate-100 text-sm text-slate-600">
          Map failed to update. Select the farmer/plot again.
        </div>
      );
    }
    return this.props.children;
  }
}

/** Fit map to plot without remounting MapContainer (avoids removeChild crashes). */
function MapFitToPlot({
  center,
  boundsCoords,
}: {
  center: [number, number];
  boundsCoords: [number, number][];
}) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        if (boundsCoords.length >= 3) {
          const bounds = new LatLngBounds(boundsCoords);
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: false });
            return;
          }
        }
        map.setView(center, map.getZoom(), { animate: false });
      } catch (err) {
        console.warn("[ManagerFarmDash] map view update failed:", err);
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [center, boundsCoords, map]);

  return null;
}

const ManagerFarmDash: React.FC = () => {
  // const center: [number, number] = [17.5789, 75.053]; // Unused - using mapCenter state instead
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  // Sync selected plot to global context so the chatbot can read it
  const { setSelectedPlotName } = useAppContext();

  // Farmer and Plot selection state
  const [selectedFieldOfficerId, setSelectedFieldOfficerId] =
    useState<string>("");
  const [selectedFarmerId, setSelectedFarmerId] = useState<string>("");
  const [selectedPlotId, setSelectedPlotId] = useState<string>(""); // Start empty, will be set based on farmer selection
  const [fieldOfficers, setFieldOfficers] = useState<any[]>([]);
  const [farmersForSelectedOfficer, setFarmersForSelectedOfficer] = useState<
    any[]
  >([]);
  const [plots, setPlots] = useState<string[]>([]);
  const [loadingFarmers, setLoadingFarmers] = useState<boolean>(
    () => !getCache(MANAGER_FIELD_OFFICERS_CACHE_KEY, MANAGER_OFFICERS_TTL_MS),
  );
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [loadingWaterStress, setLoadingWaterStress] = useState<boolean>(false);
  const [plotStatsError, setPlotStatsError] = useState<string | null>(null);
  const [showDebugInfo] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const dashboardLoadedForPlotRef = useRef<string>("");
  const plotFetchGenRef = useRef(0);
  /** Farmer id we last auto-defaulted a plot for — avoid resetting to plot[0] on enrich/GT re-renders. */
  const plotAutoSelectFarmerRef = useRef<string>("");
  /** Last FO id whose farmers list we fully synced (ignore fieldOfficers identity churn). */
  const lastSyncedOfficerIdRef = useRef<string>("");
  /** Plot the user explicitly chose — never overwrite with plot[0] until FO/farmer changes. */
  const userPickedPlotRef = useRef<string | null>(null);
  const selectedFarmerIdRef = useRef<string>("");
  const selectedFieldOfficerIdRef = useRef<string>("");
  const selectedPlotIdRef = useRef<string>("");
  /** Production: only accept FO/farmer/plot <select> changes after a real pointer/key gesture. */
  const filterSelectGestureRef = useRef(false);
  const dashRootRef = useRef<HTMLDivElement>(null);

  const lineStyles: LineStyles = {
    growth: { color: "#16a34a", label: "Growth Index" },
    stress: { color: "#dc2626", label: "Crop Stress Index" },
    water: { color: "#3b82f6", label: "Water Uptake Index" },
    moisture: { color: "#92400e", label: "Soil Moisture Index" },
  };

  const [lineChartData, setLineChartData] = useState<LineChartData[]>([]);
  const [plotCoordinates, setPlotCoordinates] = useState<[number, number][]>(
    [],
  );
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
    biomassMin: null,
    biomassMax: null,
    stressCount: null,
    stressTotalDays: null,
    cropConditionLabel: null,
    cropConditionValue: null,
    irrigationEvents: null,
    fieldScore: null,
    expectedYield: null,
    daysToHarvest: null,
    growthStage: null,
    plantationDate: null,
    plantationType: null,
    soilPH: null,
    organicCarbonDensity: null,
    actualYield: null,
    cnRatio: null,
    sugarYieldMean: null,
    sugarYieldMax: null,
    sugarYieldMin: null,
  });

  const [stressEvents, setStressEvents] = useState<StressEvent[]>([]);
  const [showStressEvents] = useState<boolean>(false);
  const [ndreStressEvents] = useState<StressEvent[]>([]);
  const [showNDREEvents] = useState<boolean>(false);
  const [combinedChartData, setCombinedChartData] = useState<LineChartData[]>(
    [],
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("yearly");
  const [aggregatedData, setAggregatedData] = useState<LineChartData[]>([]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([
    17.5789, 75.053,
  ]);
  const [plotCoordinatesCache, setPlotCoordinatesCache] = useState<
    Map<string, [number, number][]>
  >(new Map());

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const selectedPlotRecord = React.useMemo(() => {
    if (!selectedPlotId || !selectedFarmerId) return null;
    const farmer = farmersForSelectedOfficer.find(
      (f) => getFarmerId(f) === String(selectedFarmerId),
    );
    const plotList = Array.isArray(farmer?.plots) ? farmer.plots : [];
    const target = normalizePlotKey(selectedPlotId);
    return (
      plotList.find((p: any) => {
        const id = getPlotIdFromRecord(p);
        return id != null && normalizePlotKey(id) === target;
      }) ?? null
    );
  }, [selectedPlotId, selectedFarmerId, farmersForSelectedOfficer]);

  // When /farms/ enrichment adds the farmer-edited KML, replace stale Events polygon.
  useEffect(() => {
    if (!selectedPlotId || !selectedPlotRecord) return;
    const savedCoords = resolveLeafletBoundaryForPlotRecord(
      selectedPlotRecord,
      selectedPlotId,
    );
    if (savedCoords.length < 3) return;

    setPlotCoordinates(savedCoords);
    setMapCenter(calculateCenter(savedCoords));
    setPlotCoordinatesCache((prev) => new Map(prev.set(selectedPlotId, savedCoords)));
  }, [selectedPlotRecord, selectedPlotId]);

  const selectedPlotPlantation = React.useMemo(
    () => extractPlantationInfo(selectedPlotRecord),
    [selectedPlotRecord],
  );

  const selectedFarmerForStage = React.useMemo(
    () =>
      farmersForSelectedOfficer.find(
        (item) => getFarmerId(item) === String(selectedFarmerId),
      ) ?? null,
    [farmersForSelectedOfficer, selectedFarmerId],
  );

  const currentCropStage = useFieldIndicesCropStage(
    selectedPlotRecord,
    selectedFarmerForStage,
    selectedPlotId,
    selectedFarmerId,
  );

  const displayPlantationDate =
    metrics.plantationDate ?? selectedPlotPlantation.plantationDate;
  const displayPlantationType =
    metrics.plantationType ?? selectedPlotPlantation.plantationType;

  // Fetch field officers on mount (cache-first; login prefetch warms the cache).
  useEffect(() => {
    void fetchManagerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    selectedFarmerIdRef.current = selectedFarmerId;
  }, [selectedFarmerId]);

  useEffect(() => {
    selectedFieldOfficerIdRef.current = selectedFieldOfficerId;
  }, [selectedFieldOfficerId]);

  useEffect(() => {
    selectedPlotIdRef.current = selectedPlotId;
  }, [selectedPlotId]);

  // Production-only: block Google Translate (Kannada) from rewriting Manager dashboard selects.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const root = dashRootRef.current;
    if (!root) return;

    const run = () => {
      protectManagerFarmDashSubtree(root);
      syncManagerDashSelectLocks(root);
    };
    run();

    const obs = new MutationObserver(run);
    obs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    const tick = window.setInterval(run, 400);

    return () => {
      obs.disconnect();
      window.clearInterval(tick);
    };
  }, [selectedFieldOfficerId, selectedFarmerId, selectedPlotId, fieldOfficers.length]);

  const markFilterSelectGesture = () => {
    filterSelectGestureRef.current = true;
  };

  const acceptFilterSelectChange = (next: string, current: string): boolean => {
    if (next === current) {
      filterSelectGestureRef.current = false;
      return false;
    }
    // Ignore empty flashes from Translate while a value is selected.
    if (!next && current) {
      filterSelectGestureRef.current = false;
      return false;
    }
    // Production: drop Translate remount "change" events with no user gesture.
    if (import.meta.env.PROD && !filterSelectGestureRef.current) {
      return false;
    }
    filterSelectGestureRef.current = false;
    return true;
  };

  const selectOfficerFarmersAndPlot = (
    officers: any[],
    preferredOfficerId?: string,
  ): void => {
    if (!officers.length) {
      setSelectedFieldOfficerId("");
      setFarmersForSelectedOfficer([]);
      setSelectedFarmerId("");
      setPlots([]);
      userPickedPlotRef.current = null;
      setSelectedPlotId("");
      return;
    }

    const officer =
      officers.find((o) => String(o.id) === preferredOfficerId) ?? officers[0];
    applyOfficerSelection(String(officer.id), officers);
  };

  /** Imperative FO change — never driven by <select> / Translate fake events. */
  const applyOfficerSelection = (
    officerId: string,
    officersList?: any[],
  ): void => {
    const list = officersList ?? fieldOfficers;
    if (!officerId) return;
    if (
      officerId === selectedFieldOfficerIdRef.current &&
      farmersForSelectedOfficer.length > 0
    ) {
      return;
    }

    const officer = list.find((fo) => String(fo.id) === String(officerId));
    if (!officer) return;

    const farmersList = Array.isArray(officer?.farmers) ? officer.farmers : [];
    lastSyncedOfficerIdRef.current = String(officerId);
    setSelectedFieldOfficerId(String(officerId));
    setFarmersForSelectedOfficer(farmersList);
    userPickedPlotRef.current = null;

    if (!farmersList.length) {
      plotAutoSelectFarmerRef.current = "";
      setSelectedFarmerId("");
      setPlots([]);
      setSelectedPlotId("");
      return;
    }

    const storedFarmerId = readStoredManagerFarmer(String(officerId), farmersList);
    const farmer =
      farmersList.find((f: any) => getFarmerId(f) === storedFarmerId) ??
      farmersList[0];
    const farmerId = getFarmerId(farmer) ?? "";
    const plotIds = getPlotIdsFromFarmer(farmer);
    const restoredPlot = readStoredManagerPlot(farmerId, plotIds);

    plotAutoSelectFarmerRef.current = farmerId;
    setSelectedFarmerId(farmerId);
    setPlots(plotIds);
    writeStoredManagerFarmer(String(officerId), farmerId);

    if (restoredPlot) {
      userPickedPlotRef.current = restoredPlot;
      setSelectedPlotId(restoredPlot);
    } else {
      setSelectedPlotId(plotIds[0] ?? "");
    }
  };

  // NEW: Function to set plot coordinates from existing state
  const setPlotCoordinatesFromState = (plotId: string): void => {
    try {
      const farmer = farmersForSelectedOfficer.find(
        (f) => getFarmerId(f) === String(selectedFarmerId),
      );
      const plot = farmer?.plots?.find(
        (p: any) =>
          normalizePlotKey(String(getPlotIdFromRecord(p) ?? "")) ===
          normalizePlotKey(plotId),
      );

      const coords = resolveLeafletBoundaryForPlotRecord(plot, plotId);
      if (coords.length >= 3) {
        setPlotCoordinates(coords);
        setMapCenter(calculateCenter(coords));
      } else {
        setPlotCoordinates([]);
      }
    } catch (err) {
      console.warn("[ManagerFarmDash] Failed to apply plot boundary:", err);
      // Keep previous polygon on parse errors to avoid Leaflet unmount crash.
    }
  };

  // Enrich farmer plots with /farms/ details (plantation date + planting method for crop stage).
  useEffect(() => {
    const farmerId = selectedFarmerId?.trim();
    if (!farmerId || farmerId === "undefined") return;

    let cancelled = false;

    void (async () => {
      try {
        const farmsRes = await getFarmsByFarmerId(farmerId);
        if (cancelled) return;
        // Ignore stale enrichment if user already switched farmer.
        if (selectedFarmerIdRef.current !== farmerId) return;

        const farms = parseFarmsListResponse(farmsRes?.data);
        if (!farms.length) return;

        setFarmersForSelectedOfficer((prev) =>
          prev.map((farmer) => {
            if (getFarmerId(farmer) !== farmerId) return farmer;
            const plotList = Array.isArray(farmer?.plots) ? farmer.plots : [];
            if (!plotList.length) return farmer;
            return {
              ...farmer,
              plots: enrichPlotsWithFarmDetails(plotList, farms),
            };
          }),
        );
        // Drop stale Events/FO polygons so map redraws from Django KML.
        setPlotCoordinatesCache(new Map());
        const plotId = selectedPlotIdRef.current;
        if (plotId) {
          void fetchPlotCoordinates(plotId);
        }
      } catch {
        // Stage hook falls back to its own farms fetch.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFarmerId]);

  // Re-fetch /farms/ boundaries after a farmer saves KML (same session or cache bust).
  useEffect(() => {
    const onBoundaryUpdated = () => {
      removeCache(FARMS_ALL_CACHE_KEY);
      setPlotCoordinatesCache(new Map());
      const farmerId = selectedFarmerIdRef.current?.trim();
      if (!farmerId || farmerId === "undefined") return;

      void (async () => {
        try {
          const farmsRes = await getFarmsByFarmerId(farmerId);
          const farms = parseFarmsListResponse(farmsRes?.data);
          if (!farms.length) return;

          setFarmersForSelectedOfficer((prev) =>
            prev.map((farmer) => {
              if (getFarmerId(farmer) !== farmerId) return farmer;
              const plotList = Array.isArray(farmer?.plots) ? farmer.plots : [];
              if (!plotList.length) return farmer;
              return {
                ...farmer,
                plots: enrichPlotsWithFarmDetails(plotList, farms),
              };
            }),
          );

          const plotId = selectedPlotIdRef.current;
          if (plotId) {
            setPlotCoordinatesFromState(plotId);
            void fetchPlotCoordinates(plotId);
          }
        } catch {
          // Best-effort refresh.
        }
      })();
    };

    window.addEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    return () => {
      window.removeEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh map when KML saved
  }, []);

  // Update plot id LIST only. Never assign selectedPlotId to plot[0] here.
  useEffect(() => {
    if (!selectedFarmerId || selectedFarmerId === "undefined") {
      setPlots([]);
      return;
    }

    const selectedFarmer = farmersForSelectedOfficer.find(
      (f) => getFarmerId(f) === String(selectedFarmerId),
    );
    if (!selectedFarmer) return;

    const plotIds = getPlotIdsFromFarmer(selectedFarmer);
    setPlots((prev) =>
      prev.length === plotIds.length &&
      prev.every((id, i) => id === plotIds[i])
        ? prev
        : plotIds,
    );

    if (plotIds.length === 0) return;
    setSelectedPlotId((prev) => {
      if (!prev) return prev;
      const kept = resolvePlotIdInList(plotIds, prev);
      if (kept) {
        if (kept !== prev && userPickedPlotRef.current) {
          userPickedPlotRef.current = kept;
          writeStoredManagerPlot(selectedFarmerId, kept);
        }
        return kept;
      }
      const locked = resolvePlotIdInList(plotIds, userPickedPlotRef.current);
      return locked ?? prev;
    });
  }, [selectedFarmerId, farmersForSelectedOfficer]);

  const applyUserPlotSelection = (plotId: string) => {
    if (!plotId) return;
    userPickedPlotRef.current = plotId;
    plotAutoSelectFarmerRef.current = String(selectedFarmerId);
    writeStoredManagerPlot(selectedFarmerId, plotId);
    if (plotId === selectedPlotId) return;
    dashboardLoadedForPlotRef.current = "";
    setSelectedPlotId(plotId);
    void fetchPlotCoordinates(plotId);
  };

  const applyFarmerSelection = (farmerId: string) => {
    if (!farmerId || farmerId === selectedFarmerId) return;
    userPickedPlotRef.current = null;
    dashboardLoadedForPlotRef.current = "";

    const farmer = farmersForSelectedOfficer.find(
      (f) => getFarmerId(f) === String(farmerId),
    );
    const plotIds = getPlotIdsFromFarmer(farmer);
    const restored = readStoredManagerPlot(farmerId, plotIds);

    plotAutoSelectFarmerRef.current = farmerId;
    setSelectedFarmerId(farmerId);
    setPlots(plotIds);
    writeStoredManagerFarmer(selectedFieldOfficerId, farmerId);

    if (restored) {
      userPickedPlotRef.current = restored;
      setSelectedPlotId(restored);
    } else {
      setSelectedPlotId(plotIds[0] ?? "");
    }
  };

  useEffect(() => {
    if (!selectedPlotId) {
      dashboardLoadedForPlotRef.current = "";
      return;
    }

    if (dashboardLoadedForPlotRef.current === selectedPlotId) {
      setPlotCoordinatesFromState(selectedPlotId);
      return;
    }

    const fetchGen = ++plotFetchGenRef.current;
    void fetchAllData(selectedPlotId, fetchGen);
    setPlotCoordinatesFromState(selectedPlotId);
  }, [selectedPlotId]);

  // Sync selected plot to global AppContext so the chatbot always has the
  // currently viewed plot_id without any manual input from the manager
  useEffect(() => {
    setSelectedPlotName(selectedPlotId || null);
  }, [selectedPlotId]);

  useEffect(() => {
    if (lineChartData.length > 0) {
      const aggregated = aggregateDataByPeriod(lineChartData, timePeriod);
      setAggregatedData(aggregated);
    }
  }, [lineChartData, timePeriod]);

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
    } else {
      setCombinedChartData([]);
    }
  }, [aggregatedData, ndreStressEvents, showNDREEvents]);

  // Helper function to make axios requests with timeout and retry logic
  // Optimized with shorter timeout for faster retrieval
  const makeRequestWithRetry = async (
    url: string,
    retries = 1,
    timeout = MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
  ): Promise<any> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      const response = await eventsApi.get(url, {
        signal: abortController.signal,
        timeout: timeout,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      clearTimeout(timeoutId);
      return response.data;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        error?.name === "AbortError"
      ) {
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return makeRequestWithRetry(url, retries - 1, timeout);
        }
        throw error;
      }

      // Handle CORS errors
      if (
        error.message?.includes("CORS") ||
        error.message?.includes("Access-Control-Allow-Origin")
      ) {
        throw new Error(
          `CORS error: The server at ${
            new URL(url).origin
          } is not configured to allow requests from this origin. Please contact the API administrator.`,
        );
      }

      // Handle timeout errors (including AbortError from AbortController)
      if (
        error.name === "AbortError" ||
        error.code === "ECONNABORTED" ||
        error.message?.includes("timeout") ||
        error.message?.includes("canceled")
      ) {
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
          return makeRequestWithRetry(url, retries - 1, timeout);
        }
        throw new Error(
          `Request timeout: The server took too long to respond. Please try again later.`,
        );
      }

      // Handle network errors
      if (
        error.code === "ERR_NETWORK" ||
        error.message?.includes("ERR_FAILED")
      ) {
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          return makeRequestWithRetry(url, retries - 1, timeout);
        }
        throw new Error(
          `Network error: Unable to connect to the server. Please check your internet connection.`,
        );
      }

      // Handle 504 Gateway Timeout
      if (error.response?.status === 504) {
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return makeRequestWithRetry(url, retries - 1, timeout);
        }
        throw new Error(
          `Gateway timeout: The server is taking too long to process your request. Please try again later.`,
        );
      }

      // Re-throw other errors
      throw error;
    }
  };

  // Fetch all data for selected plot — parallel network where possible (no backend changes).
  const fetchAllData = async (
    plotId: string,
    fetchGen?: number,
  ): Promise<void> => {
    if (!plotId) return;

    const isStale = () =>
      fetchGen != null && fetchGen !== plotFetchGenRef.current;

    const eventsPlotId = encodePlotIdForEventsUrl(plotId);
    const cleanId = plotId.replace(/"/g, "");
    const hasWarmCache = Boolean(
      getCache(`agroSingle_v1_${cleanId}`) && getCache(`indices_${plotId}`),
    );

    if (!hasLoadedOnce || !hasWarmCache) {
      setLoadingData(true);
    }
    setPlotStatsError(null);
    setLoadingWaterStress(true);
    // Keep previous metrics on screen while the new plot loads (avoids full-page "refresh" flash).
    try {
      const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
      const today = new Date(Date.now() - tzOffsetMs)
        .toISOString()
        .slice(0, 10);

      // Water stress (SAR API) — CCI + stress event cards (same as Owner dashboard)
      const farmerForWaterStress = farmersForSelectedOfficer.find(
        (f) => getFarmerId(f) === String(selectedFarmerId),
      );
      const plotForWaterStress =
        farmerForWaterStress?.plots?.find(
          (p: any) => getPlotIdFromRecord(p) === String(plotId),
        ) ?? null;
      const plantationForWaterStress =
        plotForWaterStress?.plantation_date ??
        plotForWaterStress?.crop_type?.plantation_date ??
        null;

      void fetchWaterStressAnalysis(plotId, {
        plantationDate: plantationForWaterStress,
        endDate: today,
        plots: farmerForWaterStress?.plots ?? null,
      })
        .then((data) => {
          if (isStale()) return;
          const parsed = parseWaterStressMetrics(data);
          setMetrics((prev) => ({
            ...prev,
            cropConditionLabel: parsed.cropConditionLabel,
            cropConditionValue: parsed.cropConditionValue,
            stressCount: parsed.stressCount,
            stressTotalDays: parsed.stressTotalDays,
          }));
        })
        .finally(() => {
          if (!isStale()) setLoadingWaterStress(false);
        });

      const harvestPromise = (async () => {
        const harvestCacheKey = `harvest_${plotId}_${today}`;
        let harvestData = getCache(harvestCacheKey);
        if (harvestData) return { harvestData };
        try {
          const harvestRes = await eventsApi.post(
            `${BASE_URL}/sugarcane-harvest?plot_name=${eventsPlotId}&end_date=${today}`,
            {},
            { timeout: MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS },
          );
          harvestData = harvestRes.data;
          setCache(harvestCacheKey, harvestData);
          return { harvestData };
        } catch (err) {
          if (
            (err as any)?.code === "ERR_CANCELED" ||
            (err as any)?.name === "CanceledError"
          ) {
            return { harvestData: null as any };
          }
          console.warn("Harvest status fetch failed, continuing...", err);
          return { harvestData: null as any };
        }
      })();

      const agroPromise = (async (): Promise<{
        currentPlotData: any;
        plantationDateMissing?: boolean;
      } | null> => {
        const cleanId = plotId.replace(/"/g, "");
        const cacheKey = `agroSingle_v1_${cleanId}`;
        const cached = getCache(cacheKey);
        if (cached) {
          return { currentPlotData: cached };
        }

        try {
          const data = await getSinglePlotAgroStats(cleanId, {
            timeout: MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
          });
          if (data) {
            setCache(cacheKey, data);
            return { currentPlotData: data };
          }
        } catch (err) {
          if (
            (err as any)?.code === "ERR_CANCELED" ||
            (err as any)?.name === "CanceledError"
          ) {
            return null;
          }
          if (isAnalyzeSinglePlotPlantationDateError(err)) {
            return { currentPlotData: null, plantationDateMissing: true };
          }
          console.warn("analyzeSinglePlot fetch failed:", err);
        }

        return { currentPlotData: null };
      })();

      const indicesCacheKey = `indices_${plotId}`;
      const stressCacheKey = `stress_${plotId}_NDRE_0.15`;
      const irrigationCacheKey = `irrigation_${plotId}`;

      const cachedIndices = getCache(indicesCacheKey);
      const cachedStress = getCache(stressCacheKey);
      const cachedIrrigation = getCache(irrigationCacheKey);

      const fetchPromises: Promise<{
        type: string;
        data: any;
      }>[] = [];

      if (!cachedIndices) {
        fetchPromises.push(
          makeRequestWithRetry(
            `${BASE_URL}/plots/${eventsPlotId}/indices`,
            1,
            MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
          )
            .then((data) => {
              const rows = Array.isArray(data) ? data : [];
              const processed = rows.map((item: any) => ({
                date: new Date(item.date).toISOString().split("T")[0],
                growth: item.NDVI,
                stress: item.NDMI,
                water: item.NDWI,
                moisture: item.NDRE,
              }));
              setCache(indicesCacheKey, processed);
              return { type: "indices", data: processed };
            })
            .catch(() => ({ type: "indices", data: null })),
        );
      } else {
        fetchPromises.push(
          Promise.resolve({ type: "indices", data: cachedIndices }),
        );
      }

      if (!cachedStress) {
        fetchPromises.push(
          makeRequestWithRetry(
            `${BASE_URL}/plots/${eventsPlotId}/stress?index_type=NDRE&threshold=0.15`,
            1,
            MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
          )
            .then((data) => {
              setCache(stressCacheKey, data);
              return { type: "stress", data };
            })
            .catch(() => ({
              type: "stress",
              data: { events: [], total_events: 0 },
            })),
        );
      } else {
        fetchPromises.push(
          Promise.resolve({ type: "stress", data: cachedStress }),
        );
      }

      if (!cachedIrrigation) {
        fetchPromises.push(
          makeRequestWithRetry(
            `${BASE_URL}/plots/${eventsPlotId}/irrigation?threshold_ndmi=0.05&threshold_ndwi=0.05&min_days_between_events=10`,
            1,
            MANAGER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
          )
            .then((data) => {
              setCache(irrigationCacheKey, data);
              return { type: "irrigation", data };
            })
            .catch(() => ({
              type: "irrigation",
              data: { total_events: null },
            })),
        );
      } else {
        fetchPromises.push(
          Promise.resolve({ type: "irrigation", data: cachedIrrigation }),
        );
      }

      const scoreCacheKey = fieldScoreCacheKey(plotId);
      const cachedFieldScore = getCache(scoreCacheKey);
      if (cachedFieldScore === undefined || cachedFieldScore === null) {
        const farmer = farmersForSelectedOfficer.find(
          (f) => getFarmerId(f) === String(selectedFarmerId),
        );
        fetchPromises.push(
          fetchFieldScoreForPlot(plotId, farmer?.plots)
            .then((score) => {
              if (score != null) setCache(scoreCacheKey, score);
              return { type: "fieldScore", data: score };
            })
            .catch(() => ({ type: "fieldScore", data: null })),
        );
      } else {
        fetchPromises.push(
          Promise.resolve({ type: "fieldScore", data: cachedFieldScore }),
        );
      }

      const chartsPromise = Promise.allSettled(fetchPromises);

      const [harvestOutcome, agroOutcome, chartSettled] = await Promise.all([
        harvestPromise,
        agroPromise,
        chartsPromise,
      ]);

      if (isStale()) return;

      const harvestData = harvestOutcome?.harvestData;
      const harvestStatus: string | null = harvestData
        ? harvestData.harvest_status ||
          harvestData.harvest_summary?.harvest_status ||
          harvestData.features?.[0]?.properties?.harvest_status ||
          null
        : null;

      const agroResolved = agroOutcome;
      let currentPlotData = agroResolved?.currentPlotData ?? null;

      if (agroResolved?.plantationDateMissing) {
        setPlotStatsError(PLANTATION_DATE_NOT_PROVIDED_MSG);
      }

      const toNumberOrNull = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const expectedYieldValue = toNumberOrNull(
        currentPlotData?.brix_sugar?.sugar_yield?.mean ??
          currentPlotData?.brix_sugar?.sugar_yield?.avg ??
          currentPlotData?.brix_sugar?.sugar_yield?.average ??
          currentPlotData?.brix_sugar?.sugar_yield_mean ??
          currentPlotData?.sugar_yield_mean ??
          currentPlotData?.expected_yield ??
          currentPlotData?.brix_sugar?.sugar_yield?.min,
      );

      const biomassStats = currentPlotData?.biomass ?? null;
      const biomassTotal = toNumberOrNull(biomassStats?.mean);
      const biomassMin = toNumberOrNull(biomassStats?.min);
      const biomassMax = toNumberOrNull(biomassStats?.max);
      const calculatedBiomass =
        biomassTotal !== null ? biomassTotal * 0.12 : null;
      const totalBiomassForMetric = biomassTotal;

      if (currentPlotData) {
        const brixStats = currentPlotData?.brix_sugar?.brix ?? null;
        const recoveryStats = currentPlotData?.brix_sugar?.recovery ?? null;

        setMetrics((prev) => ({
          ...prev,
          brix: toNumberOrNull(brixStats?.mean ?? brixStats?.min),
          brixMin: toNumberOrNull(brixStats?.min),
          brixMax: toNumberOrNull(brixStats?.max),
          recovery: toNumberOrNull(recoveryStats?.mean ?? recoveryStats?.min),
          area:
            currentPlotData?.area_acres ??
            currentPlotData?.soil?.area_acres ??
            (currentPlotData?.area_ha != null
              ? Number(currentPlotData.area_ha) * 2.47105
              : currentPlotData?.area) ??
            null,
          biomass: calculatedBiomass,
          totalBiomass: totalBiomassForMetric,
          biomassMin,
          biomassMax,
          expectedYield: expectedYieldValue,
          sugarYieldMean: expectedYieldValue,
          daysToHarvest: currentPlotData?.days_to_harvest ?? null,
          growthStage:
            harvestStatus || currentPlotData?.Sugarcane_Status || null,
          soilPH:
            toNumberOrNull(currentPlotData?.soil?.phh2o) ??
            toNumberOrNull(currentPlotData?.soil?.ph_h2o),
          organicCarbonDensity:
            currentPlotData?.soil?.organic_carbon_stock != null
              ? toNumberOrNull(currentPlotData.soil.organic_carbon_stock)
                ? parseFloat(
                    Number(currentPlotData.soil.organic_carbon_stock).toFixed(2),
                  )
                : null
              : null,
          actualYield: toNumberOrNull(
            currentPlotData?.brix_sugar?.sugar_yield?.mean ??
              currentPlotData?.brix_sugar?.sugar_yield?.min,
          ),
          sugarYieldMax: toNumberOrNull(
            currentPlotData?.brix_sugar?.sugar_yield?.max ??
              currentPlotData?.sugar_yield_max,
          ),
          sugarYieldMin: toNumberOrNull(
            currentPlotData?.brix_sugar?.sugar_yield?.min ??
              currentPlotData?.sugar_yield_min,
          ),
          ...extractPlantationInfo(currentPlotData),
        }));
      }

      let rawIndices: LineChartData[] = [];
      let stressData: any = { events: [], total_events: 0 };
      let irrigationData: any = { total_events: null };
      let fieldScore: number | null = null;

      chartSettled.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          const { type, data } = result.value;
          if (type === "indices") rawIndices = data || [];
          if (type === "stress")
            stressData = data || { events: [], total_events: 0 };
          if (type === "irrigation")
            irrigationData = data || { total_events: null };
          if (type === "fieldScore") fieldScore = data ?? null;
        }
      });

      if (isStale()) return;

      setLineChartData(rawIndices);
      setStressEvents(stressData?.events ?? []);

      // NDRE stress is for chart overlay only; CCI / Stress Events cards use water-stress API
      setMetrics((prev) => ({
        ...prev,
        irrigationEvents: irrigationData?.total_events ?? null,
        fieldScore,
        cnRatio: null,
      }));
    } catch (err: any) {
      if (
        err?.code === "ERR_CANCELED" ||
        err?.name === "CanceledError" ||
        err?.name === "AbortError"
      ) {
        return;
      }
    } finally {
      if (!isStale()) {
        dashboardLoadedForPlotRef.current = plotId;
        setHasLoadedOnce(true);
        setLoadingData(false);
      }
    }
  };

  // Fetch farmers from API - using authenticated endpoint
  const fetchManagerData = async (): Promise<void> => {
    const cached = getCache(
      MANAGER_FIELD_OFFICERS_CACHE_KEY,
      MANAGER_OFFICERS_TTL_MS,
    );
    if (cached?.field_officers) {
      setFieldOfficers(cached.field_officers);
      selectOfficerFarmersAndPlot(cached.field_officers);
      return;
    }

    setLoadingFarmers(true);
    try {
      const response = await getMyFieldOfficers();
      const officersData = response.data?.field_officers ?? [];
      setCache(MANAGER_FIELD_OFFICERS_CACHE_KEY, {
        field_officers: officersData,
      });
      setFieldOfficers(officersData);
      selectOfficerFarmersAndPlot(officersData);
    } catch (error: any) {
      if (error.response?.status === 401) {
      } else if (error.response?.status === 403) {
      }
    } finally {
      setLoadingFarmers(false);
    }
  };

  // Fetch plots from API - No longer needed, plots come from farmers data
  // const fetchPlots = async (): Promise<void> => {
  //   setLoadingPlots(true);
  //   try {
  //     const response = await axios.get(`${BASE_URL}/plots`);
  //     setPlots(response.data);
  //   } catch (error) {
  //     console.error("Error fetching plots:", error);
  //   } finally {
  //     setLoadingPlots(false);
  //   }
  // };

  // Fetch plot coordinates immediately when plot is selected
  const fetchPlotCoordinates = async (plotId: string): Promise<void> => {
    const farmerId = selectedFarmerIdRef.current?.trim();
    const farmer = farmersForSelectedOfficer.find(
      (f) => getFarmerId(f) === String(selectedFarmerId),
    );
    let plot = farmer?.plots?.find(
      (p: any) =>
        normalizePlotKey(String(getPlotIdFromRecord(p) ?? "")) ===
        normalizePlotKey(plotId),
    );

    // Always re-fetch Django /farms/?farmer_id= — FO/Events polygons stay stale after KML edit.
    if (farmerId && farmerId !== "undefined") {
      try {
        const farmsRes = await getFarmsByFarmerId(farmerId);
        const farms = parseFarmsListResponse(farmsRes?.data);
        if (farms.length) {
          const plotList = Array.isArray(farmer?.plots) ? farmer.plots : [];
          const enrichedPlots = enrichPlotsWithFarmDetails(
            plotList.length ? plotList : plot ? [plot] : [],
            farms,
          );
          plot =
            enrichedPlots.find(
              (p: any) =>
                normalizePlotKey(String(getPlotIdFromRecord(p) ?? "")) ===
                normalizePlotKey(plotId),
            ) ??
            (plot
              ? enrichPlotsWithFarmDetails([plot], farms)[0] ?? plot
              : null);

          setFarmersForSelectedOfficer((prev) =>
            prev.map((row) => {
              if (getFarmerId(row) !== farmerId) return row;
              const rows = Array.isArray(row?.plots) ? row.plots : [];
              if (!rows.length) return row;
              return {
                ...row,
                plots: enrichPlotsWithFarmDetails(rows, farms),
              };
            }),
          );
          setPlotCoordinatesCache((prev) => {
            const next = new Map(prev);
            next.delete(plotId);
            return next;
          });
        }
      } catch {
        // Fall through to cached / Events boundary below.
      }
    }

    let savedCoords = resolveLeafletBoundaryForPlotRecord(plot, plotId);

    if (savedCoords.length >= 3) {
      setPlotCoordinates(savedCoords);
      setPlotCoordinatesCache((prev) => new Map(prev.set(plotId, savedCoords)));
      setMapCenter(calculateCenter(savedCoords));
      return;
    }

    // Check cache only after saved boundary lookup.
    if (plotCoordinatesCache.has(plotId)) {
      const cachedCoords = plotCoordinatesCache.get(plotId);
      if (cachedCoords && cachedCoords.length > 0) {
        setPlotCoordinates(cachedCoords);
        const center = calculateCenter(cachedCoords);
        setMapCenter(center);
        return;
      }
    }

    try {
      const today = new Date().toISOString().slice(0, 10);
      const response = await eventsApi.post(
        `${BASE_URL}/analyze?plot_name=${encodePlotIdForEventsUrl(plotId)}&date=${today}`,
      );

      const coords = boundaryToLeafletCoords(
        response.data?.features?.[0]?.geometry,
      );
      if (coords.length >= 3) {
        setPlotCoordinates(coords);
        setPlotCoordinatesCache((prev) => new Map(prev.set(plotId, coords)));
        const center = calculateCenter(coords);
        setMapCenter(center);
      }
    } catch (error) {}
  };

  // Calculate center point from coordinates
  const calculateCenter = (coords: [number, number][]): [number, number] => {
    if (coords.length === 0) return [17.5789, 75.053];

    const sumLat = coords.reduce((sum, [lat]) => sum + lat, 0);
    const sumLng = coords.reduce((sum, [, lng]) => sum + lng, 0);

    return [sumLat / coords.length, sumLng / coords.length];
  };

  // Aggregation logic (same as FarmerDashboard)
  const aggregateDataByPeriod = (
    data: LineChartData[],
    period: TimePeriod,
  ): LineChartData[] => {
    if (period === "daily") {
      if (data.length < 2) return data;
      const sorted = [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
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
            "0",
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
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    }
    return Object.entries(groupedData)
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
            parseInt(month) - 1,
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
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Utility functions
  const toggleLine = (key: string): void => {
    const isOnlyThis = Object.keys(visibleLines).every((k) =>
      k === key
        ? visibleLines[k as keyof VisibleLines]
        : !visibleLines[k as keyof VisibleLines],
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

  // Map helpers live outside this component (MapFitToPlot).

  const getPlotBorderStyle = () => ({
    color: "#ffffff",
    fillColor: "#10b981",
    weight: 3,
    opacity: 1,
    fillOpacity: 0.3,
  });

  // Biomass data setup (same as FarmerDashboard)
  const currentBiomass = metrics.biomass || 0;
  const totalBiomass = metrics.totalBiomass || 0;

  const biomassData = [
    {
      name: "Total Biomass",
      value: totalBiomass,
      fill: "#3b82f6",
    },
    {
      name: "Underground Biomass",
      value: currentBiomass,
      fill: "#10b981",
    },
  ];

  const managerRecovery = metrics.recovery ?? 0;

  const recoveryComparisonData = [
    {
      name: "Managed Farms",
      value: managerRecovery,
      fill: "#10b981",
      label: "Managed Recovery",
    },
    {
      name: "Regional Avg",
      value: OTHER_FARMERS_RECOVERY.regional_average,
      fill: "#3b82f6",
      label: "Regional Average",
    },
    {
      name: "Top 25%",
      value: OTHER_FARMERS_RECOVERY.top_quartile,
      fill: "#22c55e",
      label: "Top Quartile",
    },
    {
      name: "Similar Farms",
      value: OTHER_FARMERS_RECOVERY.similar_farms,
      fill: "#f59e0b",
      label: "Similar Farms",
    },
  ];

  const chartDataToUse =
    combinedChartData.length > 0 ? combinedChartData : aggregatedData;
  const chartXAxisKey = timePeriod === "monthly" ? "displayDate" : "date";

  // Time period toggle component
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
        ),
      )}
    </div>
  );

  // Enhanced chart legend
  const ChartLegend: React.FC = () => (
    <div className="flex flex-wrap items-center gap-1 text-xs font-medium mb-2">
      {Object.entries(lineStyles).map(([key, { color, label }]) => (
        <React.Fragment key={key}>
          <button
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
          {key === "moisture" && (
            <FieldIndicesStageBadge stage={currentCropStage} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  // Custom tooltip component
  const CustomTooltip: React.FC<CustomTooltipProps> = ({
    active,
    payload,
    label,
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg backdrop-blur-sm">
          <p className="text-sm font-semibold text-gray-800 mb-2">
            {formatDate(label || "")}
          </p>
          {payload.map((entry, index) => {
            const lineStyle = lineStyles[entry.dataKey as keyof LineStyles];
            if (!lineStyle) return null;

            return (
              <div key={index} className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-sm text-gray-600">
                  {lineStyle.label}: {Number(entry.value).toFixed(4)}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  // Gauge component
  const PieChartWithNeedle: React.FC<PieChartWithNeedleProps> = ({
    value,
    max,
    width = 200,
    height = 120,
    title = "Gauge",
    unit = "",
  }) => {
    const safeMax = max > 0 ? max : 1;
    const safeValue = Number.isFinite(value) ? value : 0;
    const percent = Math.max(0, Math.min(1, safeValue / safeMax));
    const angle = 180 * percent;
    const cx = width / 2;
    const cy = height * 0.8;
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
      return "#10b981";
    };

    return (
      <div className="flex flex-col items-center">
        <svg width={width} height={height} className="overflow-visible">
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="8"
          />
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${
              cx + r * Math.cos(Math.PI - (angle * Math.PI) / 180)
            } ${cy - r * Math.sin(Math.PI - (angle * Math.PI) / 180)}`}
            fill="none"
            stroke={getColor(percent)}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <line
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#374151"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="4" fill="#374151" />
          <text
            x={cx}
            y={cy - r - 15}
            textAnchor="middle"
            className="text-lg font-bold fill-gray-700"
          >
            {safeValue.toFixed(1)} {unit}
          </text>
        </svg>
        <p className="text-sm text-gray-600 mt-2 font-medium">{title}</p>
      </div>
    );
  };

  // IMPORTANT: Do not block the whole UI on plot loading — filters stay visible;
  // metrics show "-" until data arrives (see loadingData banner below).

  return (
    <div
      ref={dashRootRef}
      {...{ [MANAGER_FARM_DASH_ATTR]: "true" }}
      className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50"
    >
      {/* Enhanced Header */}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ">
        {/* Debug Info Panel */}
        {showDebugInfo && (
          <div className="mb-6 bg-gray-900 rounded-xl shadow-lg p-4 border border-gray-700">
            <h3 className="text-sm font-bold text-green-400 mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Debug Information - API Request Details
            </h3>
            <div className="bg-black rounded-lg p-3 overflow-auto max-h-96">
              <pre className="text-xs text-green-300 font-mono">
                {JSON.stringify(
                  {
                    endpoint: `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/farms/recent-farmers/`,
                    method: "GET",
                    bearerToken: localStorage.getItem("token")
                      ? "✅ Present"
                      : "❌ Missing",
                    tokenPreview:
                      localStorage.getItem("token")?.substring(0, 30) + "...",
                    totalFarmers: farmersForSelectedOfficer.length,
                    selectedFarmer: selectedFarmerId,
                    selectedPlot: selectedPlotId,
                    farmersList: farmersForSelectedOfficer.map((f: any) => ({
                      id: f.id || f.farmer_id,
                      name:
                        `${f.first_name || ""} ${f.last_name || ""}`.trim() ||
                        f.name,
                      email: f.email,
                      plots: f.plots?.length || f.plot_ids?.length || 0,
                    })),
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              💡 Check the browser console for detailed API request/response
              logs
            </p>
          </div>
        )}

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full lg:w-auto">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <div className="flex flex-col flex-1 sm:flex-none">
                  <label className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Field Officer ({fieldOfficers.length})
                  </label>
                  <select
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64 notranslate"
                    translate="no"
                    data-gt-lock={selectedFieldOfficerId}
                    value={selectedFieldOfficerId}
                    onPointerDown={markFilterSelectGesture}
                    onKeyDown={markFilterSelectGesture}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!acceptFilterSelectChange(next, selectedFieldOfficerId)) {
                        e.currentTarget.value = selectedFieldOfficerId;
                        return;
                      }
                      applyOfficerSelection(next);
                    }}
                    disabled={loadingFarmers}
                  >
                    {loadingFarmers ? (
                      <option className="notranslate" translate="no">
                        Loading...
                      </option>
                    ) : fieldOfficers.length === 0 ? (
                      <option className="notranslate" translate="no">
                        No officers found
                      </option>
                    ) : (
                      <>
                        <option value="" className="notranslate" translate="no">
                          Select an officer
                        </option>
                        {fieldOfficers.map((officer) => (
                          <option
                            key={`officer-${officer.id}`}
                            value={officer.id}
                            className="notranslate"
                            translate="no"
                          >
                            {officer.first_name ?? ""} {officer.last_name ?? ""}{" "}
                            ({Array.isArray(officer.farmers)
                              ? officer.farmers.length
                              : 0}{" "}
                            farmers)
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                <div className="flex flex-col flex-1 sm:flex-none">
                  <label className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4" /> Farmers (
                    {farmersForSelectedOfficer.length})
                  </label>
                  <select
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64 notranslate"
                    translate="no"
                    data-gt-lock={selectedFarmerId}
                    value={selectedFarmerId}
                    onPointerDown={markFilterSelectGesture}
                    onKeyDown={markFilterSelectGesture}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!acceptFilterSelectChange(next, selectedFarmerId)) {
                        e.currentTarget.value = selectedFarmerId;
                        return;
                      }
                      applyFarmerSelection(next);
                    }}
                    disabled={
                      !selectedFieldOfficerId ||
                      farmersForSelectedOfficer.length === 0
                    }
                  >
                    {loadingFarmers ? (
                      <option className="notranslate" translate="no">
                        Loading farmers...
                      </option>
                    ) : farmersForSelectedOfficer.length === 0 ? (
                      <option className="notranslate" translate="no">
                        No farmers found
                      </option>
                    ) : (
                      <>
                        <option value="" className="notranslate" translate="no">
                          Select a farmer
                        </option>
                        {farmersForSelectedOfficer.map((farmer, index) => {
                          const farmerId =
                            getFarmerId(farmer) ?? `unknown-${index}`;
                          const farmerName =
                            `${farmer.first_name ?? ""} ${farmer.last_name ?? ""}`.trim() ||
                            farmer.name ||
                            farmer.username ||
                            `Farmer ${farmerId}`;
                          const plotsCount = Array.isArray(farmer.plots)
                            ? farmer.plots.length
                            : 0;
                          return (
                            <option
                              key={`farmer-${farmerId}`}
                              value={farmerId}
                              className="notranslate"
                              translate="no"
                            >
                              {farmerName} ({plotsCount} plot
                              {plotsCount !== 1 ? "s" : ""})
                            </option>
                          );
                        })}
                      </>
                    )}
                  </select>
                </div>

                <div className="flex flex-col flex-1 sm:flex-none">
                  <label className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Plots ({plots.length})
                  </label>
                  <select
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64 notranslate"
                    translate="no"
                    data-gt-lock={selectedPlotId}
                    value={selectedPlotId}
                    onPointerDown={markFilterSelectGesture}
                    onKeyDown={markFilterSelectGesture}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!acceptFilterSelectChange(next, selectedPlotId)) {
                        e.currentTarget.value = selectedPlotId;
                        return;
                      }
                      applyUserPlotSelection(next);
                    }}
                    disabled={!selectedFarmerId || plots.length === 0}
                  >
                    {!selectedFarmerId ? (
                      <option value="" className="notranslate" translate="no">
                        Select farmer first
                      </option>
                    ) : plots.length === 0 ? (
                      <option value="" className="notranslate" translate="no">
                        No plots available
                      </option>
                    ) : (
                      <>
                        <option value="" className="notranslate" translate="no">
                          Select a plot
                        </option>
                        {plots.map((plotId, index) => (
                          <option
                            key={`plot-${plotId}-${index}`}
                            value={plotId}
                            className="notranslate"
                            translate="no"
                          >
                            Plot: {plotId}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gradient-to-r from-gray-100 to-blue-50 px-4 py-3 rounded-lg ">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span className="font-medium">
              {new Date().toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {loadingData && (
          <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
            {hasLoadedOnce ? "Refreshing…" : "Loading plot data…"}
          </div>
        )}
        {plotStatsError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{plotStatsError}</span>
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
                <div className="text-sm font-semibold text-green-600">acre</div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">Field Area</p>
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
              Crop Status
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
                  Days
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">Days to Harvest</p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-blue-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-3">
              <Beaker className="w-6 h-6 text-blue-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800 flex items-center gap-1 justify-end">
                  {metrics.brix !== null ? (
                    metrics.brix.toFixed(2)
                  ) : (
                    "-"
                  )}
                  <span className="text-sm font-semibold text-blue-600">
                    °Brix (Avg)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-600">
              <p className="text-xs font-medium">Sugar Content</p>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="font-semibold text-red-600 text-sm">
                    {metrics.brixMax !== null ? metrics.brixMax.toFixed(2) : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                    Max
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-600 text-sm">
                    {metrics.brixMin !== null ? metrics.brixMin.toFixed(2) : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                    Min
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Metrics Cards — aligned with Owner / Farm Crop Status */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-purple-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-6 h-6 text-purple-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">
                  {loadingData ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    metrics.recovery?.toFixed(1) || "-"
                  )}
                </div>
                <div className="text-sm font-semibold text-purple-600">%</div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">Recovery Rate</p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-emerald-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Gauge className="w-6 h-6 text-emerald-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">
                  {!selectedPlotId ? (
                    "0"
                  ) : loadingData && metrics.fieldScore == null ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    (metrics.fieldScore ?? 0).toFixed(1)
                  )}
                </div>
                <div className="text-sm font-semibold text-emerald-600">%</div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">Field Score</p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-indigo-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <BarChart3 className="w-6 h-6 text-indigo-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">
                  {loadingData ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    metrics.expectedYield?.toFixed(1) || "-"
                  )}
                </div>
                <div className="text-sm font-semibold text-indigo-600">
                  T/acre
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 font-medium">Expected Yield</p>
          </div>

          {(() => {
            const cciStyle = cropConditionStyleFromCci(
              metrics.cropConditionValue,
            );
            const showCciValue =
              Boolean(selectedPlotId) &&
              !loadingWaterStress &&
              metrics.cropConditionValue != null;

            return (
              <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-emerald-200 hover:shadow-xl transition-all duration-300">
                <div className="flex items-center justify-between mb-2">
                  <Sprout className="w-6 h-6 shrink-0 text-emerald-600" />
                  <div className="text-right min-w-0">
                    <div className="text-2xl font-bold text-gray-800">
                      {!selectedPlotId ? (
                        "0"
                      ) : loadingWaterStress ? (
                        <Loader2 className="w-5 h-5 animate-spin inline-block" />
                      ) : (
                        (metrics.cropConditionValue ?? 0).toFixed(1)
                      )}
                    </div>
                    <div
                      className="text-xs font-semibold leading-tight max-w-[7.5rem] ml-auto truncate"
                      style={{ color: cciStyle?.textColor ?? "#6b7280" }}
                      title={
                        showCciValue
                          ? (cciStyle?.label ?? metrics.cropConditionLabel ?? "")
                          : undefined
                      }
                    >
                      {!selectedPlotId || loadingWaterStress
                        ? "CCI"
                        : (cciStyle?.label ?? metrics.cropConditionLabel ?? "CCI")}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-600 font-medium">
                  Crop Condition Index
                </p>
              </div>
            );
          })()}

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-red-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-5 h-5 text-red-600 shrink-0" />
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {!selectedPlotId ? (
                    "0"
                  ) : loadingWaterStress ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    (metrics.stressCount ?? 0)
                  )}
                </div>
                <div className="text-xs font-semibold text-red-600">
                  {!selectedPlotId || loadingWaterStress
                    ? "Total days"
                    : `${metrics.stressTotalDays ?? 0} days`}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">Stress Events</p>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-pink-200 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-3">
              <Activity className="w-6 h-6 text-pink-600" />
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800 flex items-center gap-1 justify-end">
                  {loadingData ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : metrics.totalBiomass !== null ? (
                    metrics.totalBiomass.toFixed(1)
                  ) : (
                    "-"
                  )}
                  {!loadingData && (
                    <span className="text-sm font-semibold text-pink-600">
                      T/acre
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-600">
              <p className="text-xs font-medium">Avg Biomass</p>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="font-semibold text-red-600 text-sm">
                    {metrics.biomassMax !== null
                      ? metrics.biomassMax.toFixed(1)
                      : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                    Max
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-600 text-sm">
                    {metrics.biomassMin !== null
                      ? metrics.biomassMin.toFixed(1)
                      : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                    Min
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Map and Status Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-lg overflow-hidden">
            <div
              ref={mapWrapperRef}
              className="relative w-full h-[400px] sm:h-[400px] md:h-[450px] lg:h-[500px] xl:h-full min-h-[300px]"
            >
              {/* Fullscreen Toggle */}
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

              <MapCropStatusOverlay
                growthStage={metrics.growthStage}
                plantationDate={displayPlantationDate}
                plantationType={displayPlantationType}
                loading={loadingData}
              />

              <MapSectionErrorBoundary
                resetKey={String(selectedFarmerId || "none")}
              >
                <MapContainer
                  key={`mgr-map-${selectedFarmerId || "none"}`}
                  center={mapCenter}
                  zoom={16}
                  minZoom={10}
                  maxZoom={20}
                  className="w-full h-full z-0"
                  style={{
                    height: "100%",
                    width: "100%",
                    borderRadius: "inherit",
                    position: "relative",
                  }}
                >
                  <MapFitToPlot
                    center={mapCenter}
                    boundsCoords={plotCoordinates}
                  />
                  <TileLayer
                    url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                    attribution="© Google"
                    maxZoom={20}
                    maxNativeZoom={18}
                    minZoom={10}
                    tileSize={256}
                    zoomOffset={0}
                    updateWhenZooming={false}
                    updateWhenIdle={true}
                  />
                  {plotCoordinates.length >= 3 && (
                    <Polygon
                      positions={plotCoordinates}
                      pathOptions={getPlotBorderStyle()}
                    />
                  )}
                </MapContainer>
              </MapSectionErrorBoundary>
            </div>
          </div>

          {/* Performance Gauges */}
          <div className="space-y-4">
            <div className="space-y-4">
                        <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-4">
                          <div className="flex items-center gap-3 mb-6">
                            <Target className="w-5 h-7 text-purple-600" />
                            <h3 className="text-sm font-semibold text-gray-800">
                              Sugarcane Yield Projection
                            </h3>
                          </div>
                          <div className="flex flex-col items-center">
                            <PieChartWithNeedle
                              value={metrics.sugarYieldMean || 0}
                              max={metrics.sugarYieldMax || 400}
                              title="Sugarcane Yield Forecast"
                              unit=" T/acre"
                              width={260}
                              height={130}
                            />
                            <div className="mt-2 text-center">
                              <div className="flex items-center justify-center gap-2 text-xs flex-wrap">
                                <div className="flex items-center gap-1">
                                  <div className="w-2 h-2 rounded bg-red-500"></div>
                                  <span className="text-red-700 font-semibold">
                                    min: {(metrics.sugarYieldMin || 0).toFixed(1)} T/acre
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-2 h-2 rounded bg-purple-500"></div>
                                  <span className="text-purple-700 font-semibold">
                                    mean: {(metrics.sugarYieldMean || 0).toFixed(1)}{" "}
                                    T/acre
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-2 h-2 rounded bg-green-500"></div>
                                  <span className="text-green-700 font-semibold">
                                    max: {(metrics.sugarYieldMax || 0).toFixed(1)} T/acre
                                  </span>
                                </div>
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                Performance:{" "}
                                {metrics.sugarYieldMax
                                  ? (((metrics.sugarYieldMean || 0) / metrics.sugarYieldMax) * 100).toFixed(1)
                                  : "0.0"}% of optimal yield
                              </div>
                            </div>
                          </div>
                        </div>
            </div>

            {/* Biomass Performance */}
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-green-600" />
                <h3 className="text-base sm:text-lg font-semibold text-gray-800">
                  Biomass Performance
                </h3>
              </div>
              <div className="h-48 sm:h-56 md:h-64 flex flex-col items-center justify-center relative">
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
                      {totalBiomass.toFixed(1)} T/acre
                    </text>
                    <Tooltip
                      wrapperStyle={{ zIndex: 50 }}
                      contentStyle={{ fontSize: "12px" }}
                      formatter={(value: number, name: string) => [
                        `${value.toFixed(1)} T/acre`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-sm sm:text-base text-gray-700 font-medium text-center mb-3">
                Biomass Distribution Chart
              </p>
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 text-sm sm:text-base flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-blue-500"></div>
                    <span className="text-blue-700 font-semibold">
                      Total: {totalBiomass.toFixed(1)} T/acre
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-green-500"></div>
                    <span className="text-green-700 font-semibold">
                      Underground: {currentBiomass.toFixed(1)} T/acre
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recovery Rate Comparison */}
            <div className="bg-white rounded-xl shadow-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  Recovery Rate Comparison
                </h3>
              </div>

              <div className="h-40 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={recoveryComparisonData}
                    margin={{ top: 10, right: 10, left: -10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      height={30}
                    />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 10]} />
                    <Tooltip
                      formatter={(value: number) => [
                        `${value.toFixed(1)}%`,
                        "Recovery Rate",
                      ]}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {recoveryComparisonData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 text-center text-sm text-gray-600">
                <span className="font-semibold text-green-700">
                  Managed Farms: {managerRecovery.toFixed(1)}%
                </span>{" "}
                vs{" "}
                <span className="font-semibold text-blue-700">
                  Regional Avg:{" "}
                  {OTHER_FARMERS_RECOVERY.regional_average.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Field Indices Analysis Chart */}
        <section className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-2 sm:p-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-3">
            <div className="flex items-center gap-2 mb-2 lg:mb-0">
              <LineChartIcon className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-800">
                Field Indices Analysis
              </h3>
            </div>
            <TimePeriodToggle />
          </div>

          <ChartLegend />

          <div className="h-80 sm:h-96 md:h-[28rem] bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg px-0 sm:px-3 -mx-2 sm:mx-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartDataToUse}
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
                      dataKey={chartXAxisKey}
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
                      dataKey={chartXAxisKey}
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
                    (v) => v,
                  ).length;

                  let goodRange: [number, number] = [0.3, 0.6];
                  let badRange: [number, number] = [-0.1, 0.1];
                  let labelText = "Average";

                  if (visibleCount === 1) {
                    const selectedIndex = Object.keys(visibleLines).find(
                      (key) => visibleLines[key as keyof VisibleLines],
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
                  } else if (visibleCount > 1) {
                    const allGoodRanges = Object.values(indexRanges).map(
                      (r) => r.good,
                    );
                    const allBadRanges = Object.values(indexRanges).map(
                      (r) => r.bad,
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
                          <text
                            x="79%"
                            y="25%"
                            textAnchor="middle"
                            className="text-xs font-left fill-green-600"
                            style={{ fontSize: "10px" }}
                          >
                            <tspan x="79%" dy="0">
                              {labelText}
                            </tspan>
                            <tspan x="79%" dy="12">
                              Good ({goodRange[0].toFixed(2)} -{" "}
                              {goodRange[1].toFixed(2)})
                            </tspan>
                          </text>
                          <text
                            x="35%"
                            y="35%"
                            textAnchor="middle"
                            className="text-xs font-right fill-red-600"
                            style={{ fontSize: "10px" }}
                          >
                            <tspan x="35%" dy="0">
                              {labelText}
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
                    isAnimationActive={false}
                    shape={<CustomStressDot />}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
};

const CustomStressDot: React.FC<CustomStressDotProps> = ({ cx, cy }) => {
  if (cx == null || cy == null) {
    return null;
  }

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle r={5} fill="#f97316" opacity={0.4} />
      <circle r={2} fill="#f97316" />
    </g>
  );
};

export default ManagerFarmDash;
