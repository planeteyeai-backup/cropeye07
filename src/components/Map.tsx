import React, { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polygon, useMap, Circle } from "react-leaflet";
import { LatLngTuple, LeafletMouseEvent, LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./Map.css";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { useAppContext } from "../context/AppContext";
import { FaExpand, FaColumns } from 'react-icons/fa';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AnalysisTimelineRibbon } from "./AnalysisTimelineRibbon";
import { getOrFetchJson } from "../utils/requestCache";
import { getCache } from "../utils/cache";
import {
  fetchAnalysisTimeline,
  sortedRebinDatesForLayer,
  latestRebinDateAcrossAllLayers,
  type AnalysisTimelineResponse,
} from "../services/analysisTimeline";

// Add custom styles for the enhanced tooltip
const tooltipStyles = `
  .hover-tooltip {
    position: fixed;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    z-index: 1000;
    pointer-events: none;
    max-width: 200px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .enhanced-tooltip {
    position: fixed;
    background: rgba(0, 0, 0, 0.95);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    z-index: 1000;
    pointer-events: none;
    max-width: 220px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(5px);
  }

  .enhanced-tooltip-line {
    margin: 3px 0;
    padding: 2px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 16px;
  }

  .enhanced-tooltip-line:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    padding-bottom: 4px;
    margin-bottom: 4px;
  }

.layer-name {
  font-weight: bold;
  color: #4CAF50;
  margin-right: 6px;
  min-width: 60px;
  font-size: 10px;
}

.layer-description {
  color: #e0e0e0;
  flex: 1;
  text-align: right;
  font-size: 10px;
  }
  
  @media (max-width: 768px) {
    .hover-tooltip {
      padding: 6px 8px;
      font-size: 10px;
      max-width: 150px;
    }
    
    .enhanced-tooltip {
      padding: 6px 8px;
      font-size: 10px;
      max-width: 160px;
    }
    
    .layer-name {
      min-width: 40px;
      font-size: 9px;
    }
    
    .layer-description {
      font-size: 9px;
    }
  }
  
  @media (max-width: 320px) {
    .hover-tooltip {
      padding: 4px 6px;
      font-size: 9px;
      max-width: 120px;
    }
    
    .enhanced-tooltip {
      padding: 2px 15px;
      font-size: 9px;
      max-width: 100px;
    }
    
    .layer-name {
      min-width: 30px;
      font-size: 8px;
    }
    
    .layer-description {
      font-size: 8px;
    }
  }
`;

// Inject styles if not already injected
if (typeof document !== 'undefined' && !document.querySelector('#map-tooltip-styles')) {
  const styleSheet = document.createElement("style");
  styleSheet.id = 'map-tooltip-styles';
  styleSheet.innerText = tooltipStyles;
  document.head.appendChild(styleSheet);
}

// Unified legend circle color (orange)
const LEGEND_CIRCLE_COLOR = '#F57C00';

const LAYER_FETCH_ROTATION_MESSAGES = [
  "Fetching growth data…",
  "Fetching water uptake data…",
  "Fetching soil moisture data…",
  "Fetching pest data…",
] as const;

const LAYER_LABELS: Record<string, string> = {
  Growth: "Growth",
  "Water Uptake": "Water Uptake",
  "Soil Moisture": "Soil Moisture",
  PEST: "Pest",
};

/** Legend % for Water Uptake "Very Healthy": API sends `very_healthy_pixel_count` (derive from total) or `very_healthy_pixel_percentage`. */
function waterUptakeVeryHealthyPercent(pixelSummary: Record<string, unknown>): number {
  const ps = pixelSummary as Record<string, number | undefined>;
  const pct = ps.very_healthy_pixel_percentage;
  if (typeof pct === "number" && !Number.isNaN(pct)) return Math.round(pct);
  const count = Number(ps.very_healthy_pixel_count) || 0;
  const total = Number(ps.total_pixel_count) || 0;
  if (total > 0) return Math.round((count / total) * 100);
  return 0;
}

function waterUptakeVeryHealthyCoordinates(pixelSummary: Record<string, unknown>): number[][] {
  const ps = pixelSummary as Record<string, unknown>;
  const v = ps.very_healthy_pixel_coordinates;
  if (Array.isArray(v) && v.length) return v as number[][];
  const legacy = ps.excess_pixel_coordinates;
  return Array.isArray(legacy) ? (legacy as number[][]) : [];
}

/**
 * Layer APIs use `end_date` = calendar day after the date shown in the rebin ribbon / arrows
 * (e.g. UI 2025-04-08 → request end_date=2025-04-09).
 */
function layerApiEndDate(uiDateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(uiDateIso.trim());
  if (!m) return uiDateIso;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return uiDateIso;
  dt.setDate(dt.getDate() + 1);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Overview framing: wider context like satellite overview (~zoom ≤16); refit when date changes. */
const PLOT_VIEW_MAX_ZOOM = 16;
const PLOT_FIT_PADDING_PX = 56;

const SetPlotOverviewZoom: React.FC<{
  coordinates: number[][];
  /** Bumps effect when user picks another date so the map re-frames even if boundary coords match. */
  refitKey?: string;
}> = ({ coordinates, refitKey }) => {
  const map = useMap();

  useEffect(() => {
    if (!coordinates.length) return;

    const latlngs = coordinates
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map(([lng, lat]) => [lat, lng] as LatLngTuple)
      .filter((tuple: LatLngTuple) => !isNaN(tuple[0]) && !isNaN(tuple[1]));

    if (!latlngs.length) return;

    const bounds = new LatLngBounds(latlngs as LatLngTuple[]);
    map.fitBounds(bounds, {
      padding: [PLOT_FIT_PADDING_PX, PLOT_FIT_PADDING_PX],
      maxZoom: PLOT_VIEW_MAX_ZOOM,
      animate: true,
    });
  }, [coordinates, map, refitKey]);

  return null;
};

// Function to check if a point is inside polygon
const isPointInPolygon = (point: [number, number], polygon: [number, number][]): boolean => {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
};

interface MapProps {
  onHealthDataChange?: (data: any) => void;
  onSoilDataChange?: (data: any) => void;
  onFieldAnalysisChange?: (data: any) => void;
  onMoistGroundChange?: (percent: number) => void;
  onPestDataChange?: (data: any) => void;
  onSplitScreen?: () => void;
}

const CustomTileLayer: React.FC<{
  url: string;
  opacity?: number;
  tileKey?: string;
}> = ({ url, opacity = 0.7, tileKey }) => {
  // console.log('CustomTileLayer URL:', url);

  if (!url) {
    // console.log('No URL provided to CustomTileLayer');
    return null;
  }

  return (
    <TileLayer
      key={tileKey}
      url={url}
      opacity={opacity}
      maxZoom={22}
      minZoom={10}
      tileSize={256}
      eventHandlers={{
        tileerror: (e: any) => console.error('Tile loading error:', e),
      }}
    />
  );
};

const CropEyeMap: React.FC<MapProps> = ({
  onHealthDataChange,
  onSoilDataChange,
  onFieldAnalysisChange,
  onMoistGroundChange,
  onPestDataChange,
  onSplitScreen,
}) => {
  const { profile, loading: profileLoading } = useFarmerProfile();
  const { getCached, setCached } = useAppContext();
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const initialFetchDoneRef = useRef<boolean>(false); // Track if initial fetch is done
  /** In-memory tile responses: key = `growth|plot|YYYY-MM-DD` etc. Avoids refetch when switching layer tab only. */
  const layerTilesCacheRef = useRef<Map<string, unknown>>(new Map());

  const [plotData, setPlotData] = useState<any>(null);
  const [plotBoundary, setPlotBoundary] = useState<any>(null); // Separate state for plot boundary that persists
  const [loading, setLoading] = useState(false);
  const [dateNavigationLoading, setDateNavigationLoading] = useState(false); // Loading state for date navigation
  const [fetchRotationIndex, setFetchRotationIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mapCenter] = useState<LatLngTuple>([17.842832246588202, 74.91558702408217]);
  const [selectedPlotName, setSelectedPlotName] = useState("");
  const [activeLayer, setActiveLayer] = useState<"Growth" | "Water Uptake" | "Soil Moisture" | "PEST">("Growth");

  // New state for different layer data
  const [growthData, setGrowthData] = useState<any>(null);
  const [waterUptakeData, setWaterUptakeData] = useState<any>(null);
  const [soilMoistureData, setSoilMoistureData] = useState<any>(null);
  const [pestData, setPestData] = useState<any>(null);

  const [hoveredPlotInfo, setHoveredPlotInfo] = useState<any>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedLegendClass, setSelectedLegendClass] = useState<string | null>(null);
  const [layerChangeKey, setLayerChangeKey] = useState(0);
  const [pixelTooltip, setPixelTooltip] = useState<{layers: Array<{layer: string, label: string, description: string, percentage: number}>, x: number, y: number} | null>(null);
  const [plotAreaAcres, setPlotAreaAcres] = useState<number | null>(null);
  
  // Date navigation state (similar to Streamlit logic)
  const [currentEndDate, setCurrentEndDate] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [showDatePopup, setShowDatePopup] = useState(false);
  const [popupSide, setPopupSide] = useState<'left' | 'right' | null>(null);
  const DAYS_STEP = 5;

  const [timelinePayload, setTimelinePayload] = useState<AnalysisTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const mapRebinSnapKeyRef = useRef<string>("");
  const layerFetchInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const plot = selectedPlotName?.trim();
    if (!plot) {
      setTimelinePayload(null);
      setTimelineLoading(false);
      setTimelineError(null);
      mapRebinSnapKeyRef.current = "";
      layerTilesCacheRef.current.clear();
      return;
    }
    setTimelinePayload(null);
    setTimelineLoading(true);
    setTimelineError(null);
    mapRebinSnapKeyRef.current = "";
    layerTilesCacheRef.current.clear();
    fetchAnalysisTimeline(plot)
      .then((data) => {
        if (!cancelled) setTimelinePayload(data);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load analysis timeline";
          setTimelineError(msg);
          setTimelinePayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlotName]);

  const mapRebinDates = useMemo(
    () => sortedRebinDatesForLayer(timelinePayload?.timeline, activeLayer),
    [timelinePayload, activeLayer],
  );

  const latestRebinOverall = useMemo(
    () => latestRebinDateAcrossAllLayers(timelinePayload?.timeline),
    [timelinePayload],
  );

  /** Snap once per plot/timeline to global latest rebin date — not on layer tab change (avoids redundant fetches). */
  useEffect(() => {
    if (!selectedPlotName?.trim() || !latestRebinOverall) return;
    const snapKey = `${selectedPlotName}|${latestRebinOverall}`;
    if (mapRebinSnapKeyRef.current === snapKey) return;
    mapRebinSnapKeyRef.current = snapKey;
    setCurrentEndDate(latestRebinOverall);
  }, [selectedPlotName, latestRebinOverall]);

  useEffect(() => {
    setLayerChangeKey(prev => prev + 1);
    // Layer tabs only switch the displayed tile; same `currentEndDate` and cached layer responses are reused.

    // Ensure plotBoundary is preserved when switching layers
    // Try to extract from current layer data if plotBoundary is missing
    if (!plotBoundary && selectedPlotName) {
      if (activeLayer === "Growth" && growthData?.features?.[0]) {
        setPlotBoundary(growthData.features[0]);
      } else if (activeLayer === "Water Uptake" && waterUptakeData?.features?.[0]) {
        setPlotBoundary(waterUptakeData.features[0]);
      } else if (activeLayer === "Soil Moisture" && soilMoistureData?.features?.[0]) {
        setPlotBoundary(soilMoistureData.features[0]);
      } else if (activeLayer === "PEST" && pestData?.features?.[0]) {
        setPlotBoundary(pestData.features[0]);
      } else if (plotData?.features?.[0]) {
        // Fallback to plotData if available
        setPlotBoundary(plotData.features[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, selectedPlotName]);

  // Fetch data when currentEndDate changes for ALL 4 layers (Growth, Water Uptake, Soil Moisture, and PEST)
  // This ensures all layers are updated when date navigation buttons are clicked, keeping dates synchronized
  // Works regardless of which layer is currently active - all 4 layers always use the same date
  useEffect(() => {
    if (selectedPlotName) {
      const fetchKey = `${selectedPlotName}|${currentEndDate}`;
      if (layerFetchInFlightRef.current.has(fetchKey)) return;
      layerFetchInFlightRef.current.add(fetchKey);
      setDateNavigationLoading(true);
      const fetchAllLayerData = async () => {
        try {
          // Fetch all 4 layers simultaneously in parallel to keep dates synchronized
          await Promise.all([
            fetchGrowthData(selectedPlotName),
            fetchWaterUptakeData(selectedPlotName),
            fetchSoilMoistureData(selectedPlotName),
            fetchPestData(selectedPlotName)
          ]);
          console.log('✅ Map: All 4 layer APIs (Growth, Water Uptake, Soil Moisture, Pest) fetched successfully for date:', currentEndDate);
        } catch (err) {
          console.error('❌ Map: Some layer APIs failed to fetch for date:', currentEndDate, err);
        } finally {
          setDateNavigationLoading(false);
          layerFetchInFlightRef.current.delete(fetchKey);
        }
      };
      fetchAllLayerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEndDate, selectedPlotName]);

  useEffect(() => {
    if (!dateNavigationLoading) {
      setFetchRotationIndex(0);
      return;
    }
    setFetchRotationIndex(0);
    const tickMs = 1400;
    const id = window.setInterval(() => {
      setFetchRotationIndex((i) => (i + 1) % LAYER_FETCH_ROTATION_MESSAGES.length);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [dateNavigationLoading]);

  const getCurrentDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Use saved plot from localStorage when returning to Home, else default to first plot
  useEffect(() => {
    if (profileLoading || !profile) return;

    const plotNames = profile.plots?.map(plot => plot.fastapi_plot_id) || [];
    const savedPlot = typeof window !== 'undefined' ? localStorage.getItem('selectedPlot') : null;
    const savedIsValid = savedPlot && plotNames.includes(savedPlot);
    const plotToUse = savedIsValid ? savedPlot : (plotNames.length > 0 ? plotNames[0] : null);

    if (plotToUse && plotToUse !== selectedPlotName) {
      setSelectedPlotName(plotToUse);
      if (!savedIsValid) localStorage.setItem('selectedPlot', plotToUse);
      if (!savedIsValid) setPlotBoundary(null);
    }
  }, [profile, profileLoading]);

  // Separate useEffect to fetch all 4 APIs on initial plot selection (after functions are defined)
  // This runs once when selectedPlotName is first set (on login)
  useEffect(() => {
    if (!selectedPlotName || initialFetchDoneRef.current || profileLoading) {
      return;
    }

    // Mark that we're doing the initial fetch to prevent duplicate calls
    initialFetchDoneRef.current = true;
    
    // Initial plot fetch: only non-layer APIs here.
    // The 4 layer APIs are already fetched by the [currentEndDate, selectedPlotName] effect above.
    console.log('🔄 Map: Fetching plot + field analysis on login for plot:', selectedPlotName);
    Promise.all([fetchPlotData(selectedPlotName), fetchFieldAnalysis(selectedPlotName)])
      .then(() => {
        console.log('✅ Map: Plot + field analysis fetched successfully on login');
      })
      .catch((err) => {
        console.error('❌ Map: Plot/analysis fetch failed:', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlotName, profileLoading]);

  // Removed fetchAllLayerData - date-dependent layers are now fetched by useEffect

  // Adjust date by ±5 days
  const isAtOrAfterCurrentDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date >= today;
  };

  const mapRebinDateIndex = useMemo(() => {
    if (!mapRebinDates.length) return -1;
    return mapRebinDates.indexOf(currentEndDate);
  }, [mapRebinDates, currentEndDate]);

  const timeSeriesNavLeftDisabled =
    dateNavigationLoading || (mapRebinDates.length > 0 && mapRebinDateIndex === 0);
  const timeSeriesNavRightDisabled =
    dateNavigationLoading ||
    (mapRebinDates.length > 0
      ? mapRebinDateIndex >= 0 && mapRebinDateIndex === mapRebinDates.length - 1
      : isAtOrAfterCurrentDate(currentEndDate));

  const adjustDate = (days: number) => {
    const current = new Date(currentEndDate);
    current.setDate(current.getDate() + days);
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const newDate = `${year}-${month}-${day}`;
    setCurrentEndDate(newDate);
    // Keep popup visible and update the value on each click
    setShowDatePopup(true);
  };

  const onLeftArrowClick = () => {
    setPopupSide("left");
    setShowDatePopup(true);
    if (mapRebinDates.length > 0) {
      const i = mapRebinDates.indexOf(currentEndDate);
      if (i > 0) setCurrentEndDate(mapRebinDates[i - 1]);
      else if (i === -1) setCurrentEndDate(mapRebinDates[mapRebinDates.length - 1]);
      return;
    }
    adjustDate(-DAYS_STEP);
  };

  const onRightArrowClick = () => {
    setPopupSide("right");
    setShowDatePopup(true);
    if (mapRebinDates.length > 0) {
      const i = mapRebinDates.indexOf(currentEndDate);
      if (i >= 0 && i < mapRebinDates.length - 1) {
        setCurrentEndDate(mapRebinDates[i + 1]);
      } else if (i === -1) {
        setCurrentEndDate(mapRebinDates[mapRebinDates.length - 1]);
      }
      return;
    }
    const today = getCurrentDate();
    const currentDate = new Date(currentEndDate);
    const todayDate = new Date(today);
    currentDate.setHours(0, 0, 0, 0);
    todayDate.setHours(0, 0, 0, 0);
    if (currentDate < todayDate) {
      const nextDate = new Date(currentEndDate);
      nextDate.setDate(nextDate.getDate() + DAYS_STEP);
      if (nextDate <= todayDate) {
        adjustDate(DAYS_STEP);
      } else {
        setCurrentEndDate(today);
      }
    }
  };

  const fetchGrowthData = async (plotName: string) => {
    if (!plotName) return;

    const apiEndDate = layerApiEndDate(currentEndDate);
    const memKey = `growth:${plotName}:${currentEndDate}`;
    if (layerTilesCacheRef.current.has(memKey)) {
      const hit = layerTilesCacheRef.current.get(memKey) as any;
      setGrowthData(hit ?? null);
      if (!plotBoundary && hit?.features?.[0]?.geometry) {
        setPlotBoundary(hit.features[0]);
      }
      return;
    }

    // Check cache first (only for today's date to ensure freshness)
    const today = new Date().toISOString().split('T')[0];
    const sharedKey = `layer:growth:${plotName}:${currentEndDate}`;
    const sharedTtlMs = currentEndDate === today ? 10 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sharedCached = getCache(sharedKey, sharedTtlMs);
    if (sharedCached) {
      layerTilesCacheRef.current.set(memKey, sharedCached);
      setGrowthData(sharedCached);
      if (!plotBoundary && sharedCached?.features?.[0]?.geometry) {
        setPlotBoundary(sharedCached.features[0]);
      }
      return;
    }
    // Back-compat: older cache key used by prefetch/login
    if (currentEndDate === today) {
      const cachedData = getCached(`growthData_${plotName}`);
      if (cachedData) {
        layerTilesCacheRef.current.set(memKey, cachedData);
        setGrowthData(cachedData);
        if (!plotBoundary && cachedData?.features?.[0]?.geometry) {
          setPlotBoundary(cachedData.features[0]);
        }
        return;
      }
    }

    // Use proxy in development to avoid CORS issues, direct URL in production
    // const baseUrl = import.meta.env.DEV 
      // ? '/api/dev-plot' 
      // : 'https://admin-cropeye.up.railway.app';
    const baseUrl='https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/analyze_Growth?plot_name=${plotName}&end_date=${apiEndDate}&days_back=15`;
    
    try {
      
      // Try fetch with explicit CORS mode and proper headers matching curl command
      const data = await getOrFetchJson({
        key: sharedKey,
        url,
        ttlMs: sharedTtlMs,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        },
      });
      layerTilesCacheRef.current.set(memKey, data);
      setGrowthData(data);
      
      // Cache the data if it's for today's date
      if (currentEndDate === today) {
        setCached(`growthData_${plotName}`, data);
      }
      
      // Preserve plot boundary from growth data if not already set
      if (!plotBoundary && data?.features?.[0]?.geometry) {
        setPlotBoundary(data.features[0]);
      }
    } catch (err: any) {
      layerTilesCacheRef.current.delete(memKey);
      console.error("Error fetching growth data:", {
        error: err,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        url: url,
        plotName: plotName,
        endDate: currentEndDate,
        apiEndDate,
      });
      setGrowthData(null);
      
      // Provide more specific error messages
      let errorMessage = "Failed to fetch growth data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        // Check for CORS error specifically
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    }
  };

  const fetchWaterUptakeData = async (plotName: string) => {
    if (!plotName) return;

    const apiEndDate = layerApiEndDate(currentEndDate);
    const memKey = `water:${plotName}:${currentEndDate}`;
    if (layerTilesCacheRef.current.has(memKey)) {
      const hit = layerTilesCacheRef.current.get(memKey) as any;
      setWaterUptakeData(hit ?? null);
      if (!plotBoundary && hit?.features?.[0]?.geometry) {
        setPlotBoundary(hit.features[0]);
      }
      return;
    }

    // Check cache first (only for today's date to ensure freshness)
    const today = new Date().toISOString().split('T')[0];
    const sharedKey = `layer:water:${plotName}:${currentEndDate}`;
    const sharedTtlMs = currentEndDate === today ? 10 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sharedCached = getCache(sharedKey, sharedTtlMs);
    if (sharedCached) {
      layerTilesCacheRef.current.set(memKey, sharedCached);
      setWaterUptakeData(sharedCached);
      if (!plotBoundary && sharedCached?.features?.[0]?.geometry) {
        setPlotBoundary(sharedCached.features[0]);
      }
      return;
    }
    // Back-compat: older cache key used by prefetch/login
    if (currentEndDate === today) {
      const cachedData = getCached(`waterUptakeData_${plotName}`);
      if (cachedData) {
        layerTilesCacheRef.current.set(memKey, cachedData);
        setWaterUptakeData(cachedData);
        if (!plotBoundary && cachedData?.features?.[0]?.geometry) {
          setPlotBoundary(cachedData.features[0]);
        }
        return;
      }
    }

    // Use direct backend URL in production (proxy only works in dev)
    // const baseUrl = import.meta.env.DEV 
    //   ? '/api/dev-plot' 
    //   : 'https://admin-cropeye.up.railway.app';
    const baseUrl = 'https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/wateruptake?plot_name=${plotName}&end_date=${apiEndDate}&days_back=15`;

    try {
      
      // Try fetch with explicit CORS mode and proper headers matching curl command
      const data = await getOrFetchJson({
        key: sharedKey,
        url,
        ttlMs: sharedTtlMs,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        },
      });
      layerTilesCacheRef.current.set(memKey, data);
      setWaterUptakeData(data);
      
      // Cache the data if it's for today's date
      if (currentEndDate === today) {
        setCached(`waterUptakeData_${plotName}`, data);
      }
      
      // Preserve plot boundary from water uptake data if not already set
      if (!plotBoundary && data?.features?.[0]?.geometry) {
        setPlotBoundary(data.features[0]);
      }
    } catch (err: any) {
      layerTilesCacheRef.current.delete(memKey);
      console.error("Error fetching water uptake data:", {
        error: err,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        url: url,
        plotName: plotName,
        endDate: currentEndDate,
        apiEndDate,
      });
      setWaterUptakeData(null);
      
      // Provide more specific error messages
      let errorMessage = "Failed to fetch water uptake data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        // Check for CORS error specifically
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    }
  };

  const fetchSoilMoistureData = async (plotName: string) => {
    if (!plotName) return;

    const apiEndDate = layerApiEndDate(currentEndDate);
    const memKey = `soil:${plotName}:${currentEndDate}`;
    if (layerTilesCacheRef.current.has(memKey)) {
      const hit = layerTilesCacheRef.current.get(memKey) as any;
      setSoilMoistureData(hit ?? null);
      if (!plotBoundary && hit?.features?.[0]?.geometry) {
        setPlotBoundary(hit.features[0]);
      }
      return;
    }

    // Check cache first (only for today's date to ensure freshness)
    const today = new Date().toISOString().split('T')[0];
    const sharedKey = `layer:soil:${plotName}:${currentEndDate}`;
    const sharedTtlMs = currentEndDate === today ? 10 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sharedCached = getCache(sharedKey, sharedTtlMs);
    if (sharedCached) {
      layerTilesCacheRef.current.set(memKey, sharedCached);
      setSoilMoistureData(sharedCached);
      if (!plotBoundary && sharedCached?.features?.[0]?.geometry) {
        setPlotBoundary(sharedCached.features[0]);
      }
      return;
    }
    // Back-compat: older cache key used by prefetch/login
    if (currentEndDate === today) {
      const cachedData = getCached(`soilMoistureData_${plotName}`);
      if (cachedData) {
        layerTilesCacheRef.current.set(memKey, cachedData);
        setSoilMoistureData(cachedData);
        if (!plotBoundary && cachedData?.features?.[0]?.geometry) {
          setPlotBoundary(cachedData.features[0]);
        }
        return;
      }
    }

    // Use direct backend URL in production (proxy only works in dev)
    // const baseUrl = import.meta.env.DEV 
    //   ? '/api/dev-plot' 
    //   : 'https://admin-cropeye.up.railway.app';
    const baseUrl = 'https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/SoilMoisture?plot_name=${plotName}&end_date=${apiEndDate}&days_back=7`;

    
    try {
      const data = await getOrFetchJson({
        key: sharedKey,
        url,
        ttlMs: sharedTtlMs,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        },
      });
      layerTilesCacheRef.current.set(memKey, data);
      setSoilMoistureData(data);
      
      // Cache the data if it's for today's date
      if (currentEndDate === today) {
        setCached(`soilMoistureData_${plotName}`, data);
      }
      
      // Preserve plot boundary from soil moisture data if not already set
      if (!plotBoundary && data?.features?.[0]?.geometry) {
        setPlotBoundary(data.features[0]);
      }
    } catch (err: any) {
      layerTilesCacheRef.current.delete(memKey);
      console.error("Error fetching soil moisture data:", {
        error: err,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        url: url,
        plotName: plotName,
        endDate: currentEndDate,
        apiEndDate,
      });
      setSoilMoistureData(null);
      
      // Provide more specific error messages
      let errorMessage = "Failed to fetch soil moisture data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        // Check for CORS error specifically
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    }
  };

  const fetchPlotData = async (plotName: string) => {
    setLoading(true);
    setError(null);

      const currentDate = getCurrentDate();
    // Use direct backend URL in production (proxy only works in dev)
    // const baseUrl = import.meta.env.DEV 
    //   ? '/api/dev-plot' 
    //   : 'https://admin-cropeye.up.railway.app';
    const baseUrl = 'https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/analyze_Growth?plot_name=${plotName}&end_date=${currentDate}&days_back=7`;

    try {
      
      // Try fetch with explicit CORS mode and proper headers matching curl command
      const resp = await fetch(url, {
          method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "omit",
        headers: { 
          "Accept": "application/json"
        },
        // Note: Not setting body at all, let browser handle empty POST body
      });


      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'Unable to read error response');
        console.error("Plot API error response:", errorText);
        
        // Handle 502 Bad Gateway - filter out HTML error page
        if (resp.status === 502 || errorText.includes('<html>') || errorText.includes('Bad Gateway')) {
          throw new Error('Backend service is temporarily unavailable. Please try again in a few moments.');
        }
        
        throw new Error(`Plot API failed: ${resp.status} ${resp.statusText}`);
      }

      const data = await resp.json();
      setPlotData(data);
      
      // Preserve plot boundary separately so it persists across layer changes
      if (data?.features?.[0]?.geometry) {
        setPlotBoundary(data.features[0]);
      }
    } catch (err: any) {
      console.error("Error fetching plot data:", {
        error: err,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        url: url,
        plotName: plotName,
        endDate: currentDate
      });
      
      // Provide more specific error messages
      let errorMessage = "Failed to fetch plot data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        // Check for CORS error specifically
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      // Don't clear plotData or plotBoundary on error - keep existing plot visible
      // Only clear if this is a new plot selection
      if (!plotBoundary || plotBoundary.properties?.plot_name !== plotName) {
        setPlotData(null);
        setPlotBoundary(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchFieldAnalysis = async (plotName: string) => {
    if (!plotName) return;

    try {
      // console.log("Fetching field analysis for plot:", plotName);
      const currentDate = getCurrentDate();
      const resp = await fetch(
        `https://sef-cropeye.up.railway.app/analyze?plot_name=${plotName}&end_date=${currentDate}&days_back=7`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!resp.ok) throw new Error(`Field analysis API failed: ${resp.status}`);

      const data = await resp.json();
      // console.log("Field analysis API response:", data);

      let fieldData: any = null;

      if (Array.isArray(data)) {
        const plotData = data.filter((item: any) => {
          const itemPlotName = item.plot_name || item.plot || item.name || '';
          return itemPlotName === plotName;
        });

        if (plotData.length > 0) {
          plotData.sort((a: any, b: any) => {
            const dateA = a.date || a.analysis_date || '';
            const dateB = b.date || b.analysis_date || '';
            return dateB.localeCompare(dateA);
          });

          fieldData = plotData[0];
        }
      } else if (typeof data === "object" && data !== null) {
        fieldData = data;
      }

      if (fieldData && onFieldAnalysisChange) {
        const overallHealth = fieldData?.overall_health ?? fieldData?.health_score ?? 0;
        const healthStatus = fieldData?.health_status ?? fieldData?.status ?? "Unknown";
        const meanValue = fieldData?.statistics?.mean ?? fieldData?.mean ?? 0;

        onFieldAnalysisChange({
          plotName: fieldData.plot_name ?? plotName,
          overallHealth,
          healthStatus,
          statistics: {
            mean: meanValue,
          },
        });
      }
    } catch (err) {
      // console.error("Error in fetchFieldAnalysis:", err);
    }
  };

  const fetchPestData = async (plotName: string) => {
    if (!plotName) {
      setPestData(null);
      return;
    }

    const apiEndDate = layerApiEndDate(currentEndDate);
    const memKey = `pest:${plotName}:${currentEndDate}`;
    if (layerTilesCacheRef.current.has(memKey)) {
      const hit = layerTilesCacheRef.current.get(memKey) as any;
      setPestData(hit ?? null);
      if (!plotBoundary && hit?.features?.[0]?.geometry) {
        setPlotBoundary(hit.features[0]);
      }
      if (hit?.pixel_summary && onPestDataChange) {
        const ps = hit.pixel_summary;
        const chewingPestPercentage = ps.chewing_affected_pixel_percentage || 0;
        const suckingPercentage = ps.sucking_affected_pixel_percentage || 0;
        const fungiPercentage = ps.fungi_affected_pixel_percentage || 0;
        const soilBornePercentage = ps.SoilBorn_affected_pixel_percentage || 0;
        const totalAffectedPercentage =
          chewingPestPercentage + suckingPercentage + fungiPercentage + soilBornePercentage;
        onPestDataChange({
          plotName,
          pestPercentage: totalAffectedPercentage,
          healthyPercentage: 100 - totalAffectedPercentage,
          totalPixels: ps.total_pixel_count || 0,
          pestAffectedPixels:
            (ps.chewing_affected_pixel_count || 0) +
            (ps.sucking_affected_pixel_count || 0) +
            (ps.fungi_affected_pixel_count || 0) +
            (ps.SoilBorn_pixel_count || 0),
          chewingPestPercentage,
          chewingPestPixels: ps.chewing_affected_pixel_count || 0,
          suckingPercentage,
          suckingPixels: ps.sucking_affected_pixel_count || 0,
        });
      }
      return;
    }

    // Check cache first (only for today's date to ensure freshness)
    const today = new Date().toISOString().split('T')[0];
    const sharedKey = `layer:pest:${plotName}:${currentEndDate}`;
    const sharedTtlMs = currentEndDate === today ? 10 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sharedCached = getCache(sharedKey, sharedTtlMs);
    if (sharedCached) {
      layerTilesCacheRef.current.set(memKey, sharedCached);
      setPestData(sharedCached);
      if (!plotBoundary && sharedCached?.features?.[0]?.geometry) {
        setPlotBoundary(sharedCached.features[0]);
      }
      return;
    }
    // Back-compat: older cache key used by prefetch/login
    if (currentEndDate === today) {
      const cachedData = getCached(`pestData_${plotName}`);
      if (cachedData) {
        layerTilesCacheRef.current.set(memKey, cachedData);
        setPestData(cachedData);
        return;
      }
    }

    // Use direct backend URL in production (proxy only works in dev)
    // const baseUrl = import.meta.env.DEV 
    //   ? '/api/dev-plot' 
    //   : 'https://admin-cropeye.up.railway.app';
    const baseUrl = 'https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/pest-detection?plot_name=${plotName}&end_date=${apiEndDate}&days_back=7`;

    try {
      const data = await getOrFetchJson({
        key: sharedKey,
        url,
        ttlMs: sharedTtlMs,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        },
      });
      layerTilesCacheRef.current.set(memKey, data);
      setPestData(data);
      
      // Cache the data if it's for today's date
      if (currentEndDate === today) {
        setCached(`pestData_${plotName}`, data);
      }
      
      // Preserve plot boundary from pest data if not already set
      if (!plotBoundary && data?.features?.[0]?.geometry) {
        setPlotBoundary(data.features[0]);
      }

      if (data?.pixel_summary && onPestDataChange) {
        const chewingPestPercentage = data.pixel_summary.chewing_affected_pixel_percentage || 0;
        const suckingPercentage = data.pixel_summary.sucking_affected_pixel_percentage || 0;
        const fungiPercentage = data.pixel_summary.fungi_affected_pixel_percentage || 0;
        const soilBornePercentage = data.pixel_summary.SoilBorn_affected_pixel_percentage || 0;

        const totalAffectedPercentage = chewingPestPercentage + suckingPercentage + fungiPercentage + soilBornePercentage;
        
        onPestDataChange({
          plotName,
          pestPercentage: totalAffectedPercentage,
          healthyPercentage: 100 - totalAffectedPercentage,
          totalPixels: data.pixel_summary.total_pixel_count || 0,
          pestAffectedPixels: (data.pixel_summary.chewing_affected_pixel_count || 0) + 
                             (data.pixel_summary.sucking_affected_pixel_count || 0) + 
                             (data.pixel_summary.fungi_affected_pixel_count || 0) +  
                             (data.pixel_summary.SoilBorn_pixel_count || 0),
          chewingPestPercentage,
          chewingPestPixels: data.pixel_summary.chewing_affected_pixel_count || 0,
          suckingPercentage,
          suckingPixels: data.pixel_summary.sucking_affected_pixel_count || 0,
        });
      }
    } catch (err: any) {
      layerTilesCacheRef.current.delete(memKey);
      console.error("Error in fetchPestData:", {
        error: err,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        url: url,
        plotName: plotName,
        endDate: currentEndDate,
        apiEndDate,
      });
      setPestData(null);
      
      // Provide more specific error messages
      let errorMessage = "Failed to fetch pest data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        // Check for CORS error specifically
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    }
  };

  const getActiveLayerUrl = () => {
    // Flexible extractor for tile URL from various possible shapes
    const extractTileUrl = (data: any): string | null => {
      if (!data || typeof data !== 'object') return null;

      // Common paths
      const candidates = [
        data?.features?.[0]?.properties?.tile_url,
        data?.features?.[0]?.properties?.tileURL,
        data?.features?.[0]?.properties?.tileServerUrl,
        data?.features?.[0]?.properties?.tiles,
        data?.properties?.tile_url,
        data?.tile_url,
        data?.tileURL,
        data?.tileServerUrl,
      ].filter(Boolean);

      // If tiles is an array, pick first
      for (const c of candidates) {
        if (Array.isArray(c) && c.length > 0) {
          return typeof c[0] === 'string' ? c[0] : null;
        }
        if (typeof c === 'string') {
          return c;
        }
      }
      return null;
    };

    let rawUrl: string | null = null;
    if (activeLayer === "PEST") rawUrl = extractTileUrl(pestData);
    else if (activeLayer === "Growth") rawUrl = extractTileUrl(growthData);
    else if (activeLayer === "Water Uptake") rawUrl = extractTileUrl(waterUptakeData);
    else if (activeLayer === "Soil Moisture") rawUrl = extractTileUrl(soilMoistureData);

    if (!rawUrl) {
      // console.warn(`[Map] No tile_url found for layer ${activeLayer}`);
      return null;
    }

    // Validate tile template contains placeholders
    const hasTemplate = rawUrl.includes('{z}') && rawUrl.includes('{x}') && rawUrl.includes('{y}');
    if (!hasTemplate) {
      // console.warn(`[Map] tile_url missing template placeholders for layer ${activeLayer}:`, rawUrl);
      return null;
    }

    return rawUrl;
  };

  // Memoize active URL to track changes
  const activeUrl = useMemo(() => getActiveLayerUrl(), [activeLayer, pestData, growthData, waterUptakeData, soilMoistureData]);

  // Use plotBoundary if available (persists across layer changes), otherwise fall back to plotData
  const currentPlotFeature = plotBoundary || plotData?.features?.[0];

  // Persist the last known non-zero plot area so it doesn't flash to 0 during refetches
  useEffect(() => {
    const area =
      (plotBoundary?.properties?.area_acres ??
        plotData?.features?.[0]?.properties?.area_acres) as number | undefined;
    if (typeof area === "number" && Number.isFinite(area) && area > 0) {
      setPlotAreaAcres(area);
    }
  }, [plotBoundary, plotData]);

  const legendData = useMemo(() => {
    if (activeLayer === "PEST") {
      const chewingPestPercentage = pestData?.pixel_summary?.chewing_affected_pixel_percentage || 0;
      const suckingPercentage = pestData?.pixel_summary?.sucking_affected_pixel_percentage || 0;
      const fungiPercentage = pestData?.pixel_summary?.fungi_affected_pixel_percentage || 0;
      const soilBornePercentage = pestData?.pixel_summary?.SoilBorn_affected_pixel_percentage || 0;
      
      return [
        { label: "Chewing", color: "#DC2626", percentage: Math.round(chewingPestPercentage), description: "Areas affected by chewing pests" },
        { label: "Sucking", color: "#B91C1C", percentage: Math.round(suckingPercentage), description: "Areas affected by sucking disease" },
        { label: "fungi", color: "#991B1B", percentage: Math.round(fungiPercentage), description: "fungi infections affecting plants" },
        { label: "Soil Borne", color: "#7F1D1D", percentage: Math.round(soilBornePercentage), description: "Soil borne infections affecting plants" }
      ];
    }

    if (activeLayer === "Water Uptake") {
      const pixelSummary = waterUptakeData?.pixel_summary;
      if (!pixelSummary) return [];

      return [
        { label: "Deficient", color: "#E6F3FF", percentage: Math.round(pixelSummary.deficient_pixel_percentage || 0), description: "weak root" },
        { label: "Less", color: "#87CEEB", percentage: Math.round(pixelSummary.less_pixel_percentage || 0), description: "weak roots" },
        { label: "Adequate", color: "#4682B4", percentage: Math.round(pixelSummary.adequat_pixel_percentage || 0), description: "healthy roots" },
        { label: "Excellent", color: "#1E90FF", percentage: Math.round(pixelSummary.excellent_pixel_percentage || 0), description: "healthy roots" },
        { label: "Very Healthy", color: "#000080", percentage: waterUptakeVeryHealthyPercent(pixelSummary), description: "very healthy roots" }
      ];
    }

    if (activeLayer === "Soil Moisture") {
      const pixelSummary = soilMoistureData?.pixel_summary;
      if (!pixelSummary) return [];

      return [
        { label: "Less", color: "#9fd4d2", percentage: Math.round(pixelSummary.less_pixel_percentage || 0), description: "less soil moisture" },
        { label: "Adequate", color: "#8fc7c5", percentage: Math.round(pixelSummary.adequate_pixel_percentage || 0), description: "Irrigation need" },
        { label: "Excellent", color: "#8fe3e0", percentage: Math.round(pixelSummary.excellent_pixel_percentage || 0), description: "no irrigation require" },
        { label: "Excess", color: "#74dbd8", percentage: Math.round(pixelSummary.excess_pixel_percentage || 0), description: "water logging" },
        { label: "Shallow", color: "#50f2ec", percentage: Math.round(pixelSummary.shallow_water_pixel_percentage || 0), description: "water source" }
      ];
    }

    if (activeLayer === "Growth") {
      const pixelSummary = growthData?.pixel_summary;
      if (!pixelSummary) return [];

      return [
        { label: "Weak", color: "#90EE90", percentage: Math.round(pixelSummary.weak_pixel_percentage || 0), description: "damaged or weak crop" },
        { label: "Stress", color: "#32CD32", percentage: Math.round(pixelSummary.stress_pixel_percentage || 0), description: "crop under stress" },
        { label: "Moderate", color: "#228B22", percentage: Math.round(pixelSummary.moderate_pixel_percentage || 0), description: "Crop under normal growth" },
        { label: "Healthy", color: "#006400", percentage: Math.round(pixelSummary.healthy_pixel_percentage || 0), description: "proper growth" }
      ];
    }

    return [];
  }, [activeLayer, pestData, waterUptakeData, soilMoistureData, growthData]);

  const getFilteredPixels = useMemo(() => {
    // console.log('getFilteredPixels called with:', { selectedLegendClass, activeLayer });
    
    if (!selectedLegendClass) {
      // console.log('No selectedLegendClass, returning empty array');
      return [];
    }

    if (activeLayer === "PEST") {
      if (!pestData || !currentPlotFeature) {
        // console.log('Missing pestData or currentPlotFeature');
        return [];
      }

      // console.log('Processing PEST layer for selectedLegendClass:', selectedLegendClass);
      
      if (!["Chewing", "Sucking", "fungi", "Soil Borne"].includes(selectedLegendClass)) {
        // console.log('SelectedLegendClass not in allowed pest categories:', selectedLegendClass);
        return [];
      }
      
      let coordinates = [];
      let pestType = "";
      
      if (selectedLegendClass === "Chewing") {
        coordinates = pestData.pixel_summary?.chewing_affected_pixel_coordinates || [];
        pestType = "Chewing";
      } else if (selectedLegendClass === "Sucking") {
        coordinates = pestData.pixel_summary?.sucking_affected_pixel_coordinates || [];
        pestType = "Sucking";
      } else if (selectedLegendClass === "fungi") {
        coordinates = pestData.pixel_summary?.fungi_affected_pixel_coordinates || [];
        pestType = "fungi";
      } else if (selectedLegendClass === "Soil Borne") {
        coordinates = pestData.pixel_summary?.SoilBorne_affected_pixel_coordinates || [];
        pestType = "Soil Borne";
      }
      
      if (!coordinates || !Array.isArray(coordinates)) {
        // console.log('No valid coordinates found for', pestType);
        return [];
      }
      
      // console.log(`Found ${coordinates.length} coordinates for ${pestType}`);

      const actualPixels = coordinates.map((coord, index) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;
        
        return {
          geometry: {
            coordinates: [coord[0], coord[1]]
          },
          properties: {
            pixel_id: `${pestType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
            pest_type: pestType,
            pest_category: pestType
          }
        };
      }).filter(Boolean);
      
      // console.log(`Generated ${actualPixels.length} pixel objects for ${pestType}`);
      return actualPixels;
    }
    
    if (activeLayer === "Water Uptake") {
      if (!waterUptakeData || !currentPlotFeature) {
        // console.log('Missing waterUptakeData or currentPlotFeature');
        return [];
      }

      //    console.log('Processing Water Uptake layer for selectedLegendClass:', selectedLegendClass);

      const pixelSummary = waterUptakeData.pixel_summary;
      if (!pixelSummary) return [];

      let coordinates = [];
      let categoryType = "";

      if (selectedLegendClass === "Deficient") {
        coordinates = pixelSummary.deficient_pixel_coordinates || [];
        categoryType = "Deficient";
      } else if (selectedLegendClass === "Less") {
        coordinates = pixelSummary.less_pixel_coordinates || [];
        categoryType = "Less";
      } else if (selectedLegendClass === "Adequate") {
        coordinates = pixelSummary.adequat_pixel_coordinates || [];
        categoryType = "Adequate";
      } else if (selectedLegendClass === "Excellent") {
        coordinates = pixelSummary.excellent_pixel_coordinates || [];
        categoryType = "Excellent";
      } else if (selectedLegendClass === "Very Healthy") {
        coordinates = waterUptakeVeryHealthyCoordinates(pixelSummary);
        categoryType = "Very Healthy";
      }

      if (!coordinates || !Array.isArray(coordinates)) {
        // console.log('No valid coordinates found for', categoryType);
      return [];
    }
    
      // console.log(`Found ${coordinates.length} coordinates for ${categoryType}`);

      const actualPixels = coordinates.map((coord, index) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;

        return {
          geometry: {
            coordinates: [coord[0], coord[1]]
          },
          properties: {
            pixel_id: `${categoryType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
            category_type: categoryType,
            water_uptake_category: categoryType
          }
        };
      }).filter(Boolean);

      // console.log(`Generated ${actualPixels.length} pixel objects for ${categoryType}`);
      return actualPixels;
    }

    if (activeLayer === "Soil Moisture") {
      if (!soilMoistureData || !currentPlotFeature) {
        // console.log('Missing soilMoistureData or currentPlotFeature');
        return [];
      }

      // console.log('Processing Soil Moisture layer for selectedLegendClass:', selectedLegendClass);

      const pixelSummary = soilMoistureData.pixel_summary;
      if (!pixelSummary) return [];

      let coordinates = [];
      let categoryType = "";

      if (selectedLegendClass === "Less") {
        coordinates = pixelSummary.less_pixel_coordinates || [];
        categoryType = "Less";
      } else if (selectedLegendClass === "Adequate") {
        coordinates = pixelSummary.adequate_pixel_coordinates || [];
        categoryType = "Adequate";
      } else if (selectedLegendClass === "Excellent") {
        coordinates = pixelSummary.excellent_pixel_coordinates || [];
        categoryType = "Excellent";
      } else if (selectedLegendClass === "Excess") {
        coordinates = pixelSummary.excess_pixel_coordinates || [];
        categoryType = "Excess";
      } else if (selectedLegendClass === "Shallow") {
        coordinates = pixelSummary.shallow_water_pixel_coordinates || [];
        categoryType = "Shallow";
      }

      if (!coordinates || !Array.isArray(coordinates)) {
        // console.log('No valid coordinates found for', categoryType);
        return [];
      }

      // console.log(`Found ${coordinates.length} coordinates for ${categoryType}`);

      const actualPixels = coordinates.map((coord, index) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;

        return {
          geometry: {
            coordinates: [coord[0], coord[1]]
          },
          properties: {
            pixel_id: `${categoryType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
            category_type: categoryType,
            soil_moisture_category: categoryType
          }
        };
      }).filter(Boolean);

      // console.log(`Generated ${actualPixels.length} pixel objects for ${categoryType}`);
      return actualPixels;
    }

    if (activeLayer === "Growth") {
      if (!growthData || !currentPlotFeature) {
        // console.log('Missing growthData or currentPlotFeature');
        return [];
      }

      // console.log('Processing Growth layer for selectedLegendClass:', selectedLegendClass);

      const pixelSummary = growthData.pixel_summary;
      if (!pixelSummary) return [];

      let coordinates = [];
      let categoryType = "";

      if (selectedLegendClass === "Weak") {
        coordinates = pixelSummary.weak_pixel_coordinates || [];
        categoryType = "Weak";
      } else if (selectedLegendClass === "Stress") {
        coordinates = pixelSummary.stress_pixel_coordinates || [];
        categoryType = "Stress";
      } else if (selectedLegendClass === "Moderate") {
        coordinates = pixelSummary.moderate_pixel_coordinates || [];
        categoryType = "Moderate";
      } else if (selectedLegendClass === "Healthy") {
        coordinates = pixelSummary.healthy_pixel_coordinates || [];
        categoryType = "Healthy";
      }

      if (!coordinates || !Array.isArray(coordinates)) {
        // console.log('No valid coordinates found for', categoryType);
        return [];
      }

      // console.log(`Found ${coordinates.length} coordinates for ${categoryType}`);

      const actualPixels = coordinates.map((coord, index) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;

    return {
          geometry: {
            coordinates: [coord[0], coord[1]]
          },
          properties: {
            pixel_id: `${categoryType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
            category_type: categoryType,
            growth_category: categoryType
          }
        };
      }).filter(Boolean);

      // console.log(`Generated ${actualPixels.length} pixel objects for ${categoryType}`);
      return actualPixels;
    }

    return [];
  }, [selectedLegendClass, activeLayer, pestData, waterUptakeData, soilMoistureData, growthData, currentPlotFeature]);

  const getMultiLayerDataForPosition = (coords: number[]) => {
    const allLayerData = [];
    const tolerance = 0.00001;
    
    // Helper function to find category for coordinates in a layer
    const findCategoryInLayer = (layerData: any, layerName: string, legendItems: any[]) => {
      if (!layerData?.pixel_summary) return null;
      
      for (const legendItem of legendItems) {
        const coordsKey = getCoordinatesKey(layerName, legendItem.label);
        let coordinates = layerData.pixel_summary[coordsKey] || [];
        if (
          layerName === "Water Uptake" &&
          legendItem.label === "Very Healthy" &&
          (!Array.isArray(coordinates) || coordinates.length === 0)
        ) {
          coordinates = waterUptakeVeryHealthyCoordinates(layerData.pixel_summary);
        }
        
        const found = coordinates.find((coord: number[]) => 
          Math.abs(coord[0] - coords[0]) < tolerance && 
          Math.abs(coord[1] - coords[1]) < tolerance
        );
        
        if (found) {
          return {
            layer: layerName,
            label: legendItem.label,
            description: legendItem.description,
            percentage: legendItem.percentage
          };
        }
      }
      return null;
    };
    
    // Get coordinates key for each layer type
    const getCoordinatesKey = (layerName: string, label: string) => {
      if (layerName === 'Growth') {
        return `${label.toLowerCase()}_pixel_coordinates`;
      } else if (layerName === 'Water Uptake') {
        if (label === 'Adequate') return 'adequat_pixel_coordinates';
        if (label === 'Very Healthy') return 'very_healthy_pixel_coordinates';
        return `${label.toLowerCase()}_pixel_coordinates`;
      } else if (layerName === 'Soil Moisture') {
        if (label === 'Shallow') return 'shallow_water_pixel_coordinates';
        return `${label.toLowerCase()}_pixel_coordinates`;
      } else if (layerName === 'PEST') {
        if (label === 'Chewing') return 'chewing_affected_pixel_coordinates';
        if (label === 'Sucking') return 'sucking_affected_pixel_coordinates';
        if (label === 'fungi') return 'fungi_affected_pixel_coordinates';
        if (label === 'Soil Borne') return 'SoilBorne_affected_pixel_coordinates';
      }
      return '';
    };
    
    // Check Growth layer
    if (growthData) {
      const growthLegend = [
        { label: "Weak", description: "damaged or weak crop", percentage: Math.round(growthData.pixel_summary?.weak_pixel_percentage || 0) },
        { label: "Stress", description: "crop under stress", percentage: Math.round(growthData.pixel_summary?.stress_pixel_percentage || 0) },
        { label: "Moderate", description: "Crop under normal growth", percentage: Math.round(growthData.pixel_summary?.moderate_pixel_percentage || 0) },
        { label: "Healthy", description: "proper growth", percentage: Math.round(growthData.pixel_summary?.healthy_pixel_percentage || 0) }
      ];
      const growthResult = findCategoryInLayer(growthData, 'Growth', growthLegend);
      if (growthResult) allLayerData.push(growthResult);
    }
    
    // Check Water Uptake layer
    if (waterUptakeData) {
      const waterLegend = [
        { label: "Deficient", description: "weak root", percentage: Math.round(waterUptakeData.pixel_summary?.deficient_pixel_percentage || 0) },
        { label: "Less", description: "weak roots", percentage: Math.round(waterUptakeData.pixel_summary?.less_pixel_percentage || 0) },
        { label: "Adequate", description: "healthy roots", percentage: Math.round(waterUptakeData.pixel_summary?.adequat_pixel_percentage || 0) },
        { label: "Excellent", description: "healthy roots", percentage: Math.round(waterUptakeData.pixel_summary?.excellent_pixel_percentage || 0) },
        { label: "Very Healthy", description: "very healthy roots", percentage: waterUptakeVeryHealthyPercent(waterUptakeData.pixel_summary || {}) }
      ];
      const waterResult = findCategoryInLayer(waterUptakeData, 'Water Uptake', waterLegend);
      if (waterResult) allLayerData.push(waterResult);
    }
    
    // Check Soil Moisture layer
    if (soilMoistureData) {
      const soilLegend = [
        { label: "Less", description: "less soil moisture", percentage: Math.round(soilMoistureData.pixel_summary?.less_pixel_percentage || 0) },
        { label: "Adequate", description: "Irrigation need", percentage: Math.round(soilMoistureData.pixel_summary?.adequate_pixel_percentage || 0) },
        { label: "Excellent", description: "no irrigation require", percentage: Math.round(soilMoistureData.pixel_summary?.excellent_pixel_percentage || 0) },
        { label: "Excess", description: "water logging", percentage: Math.round(soilMoistureData.pixel_summary?.excess_pixel_percentage || 0) },
        { label: "Shallow", description: "water source", percentage: Math.round(soilMoistureData.pixel_summary?.shallow_water_pixel_percentage || 0) }
      ];
      const soilResult = findCategoryInLayer(soilMoistureData, 'Soil Moisture', soilLegend);
      if (soilResult) allLayerData.push(soilResult);
    }
    
    // Check PEST layer
    if (pestData) {
      const pestLegend = [
        { label: "Chewing", description: "Areas affected by chewing pests", percentage: Math.round(pestData.pixel_summary?.chewing_affected_pixel_percentage || 0) },
        { label: "Sucking", description: "Areas affected by sucking disease", percentage: Math.round(pestData.pixel_summary?.sucking_affected_pixel_percentage || 0) },
        { label: "fungi", description: "fungi infections affecting plants", percentage: Math.round(pestData.pixel_summary?.fungi_affected_pixel_percentage || 0) },
        { label: "Soil Borne", description: "Soil borne infections affecting plants", percentage: Math.round(pestData.pixel_summary?.SoilBorn_affected_pixel_percentage || 0) }
      ];
      const pestResult = findCategoryInLayer(pestData, 'PEST', pestLegend);
      if (pestResult) allLayerData.push(pestResult);
    }
    
    return allLayerData;
  };

  const handleLegendClick = (label: string, percentage: number) => {
    if (percentage === 0) return;

    setSelectedLegendClass((prev) => (prev === label ? null : label));
  };

  const renderPlotBorder = () => {
    // Always prioritize plotBoundary (persists across layer changes)
    let featureToUse = plotBoundary || currentPlotFeature;
    
    // If still no feature, try to get from active layer data as fallback (read-only)
    if (!featureToUse) {
      if (activeLayer === "Growth" && growthData?.features?.[0]) {
        featureToUse = growthData.features[0];
      } else if (activeLayer === "Water Uptake" && waterUptakeData?.features?.[0]) {
        featureToUse = waterUptakeData.features[0];
      } else if (activeLayer === "Soil Moisture" && soilMoistureData?.features?.[0]) {
        featureToUse = soilMoistureData.features[0];
      } else if (activeLayer === "PEST" && pestData?.features?.[0]) {
        featureToUse = pestData.features[0];
      }
    }
    
    const geom = featureToUse?.geometry;
    if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]) {
      // If no geometry available, return null but don't clear anything
      return null;
    }

    const coords = geom.coordinates[0]
      .map((c: any) => [c[1], c[0]] as LatLngTuple)
      .filter((tuple: LatLngTuple) => !isNaN(tuple[0]) && !isNaN(tuple[1]));

    if (coords.length === 0) return null;

    return (
      <Polygon
        key={`plot-border-${selectedPlotName}-${plotBoundary ? 'persistent' : 'temp'}`}
        positions={coords}
        pathOptions={{
          fillOpacity: 0,
          color: "#FFD700",
          weight: 3,
          interactive: false,
        }}
      />
    );
  };

  const renderFilteredPixels = () => {
    if (!selectedLegendClass || getFilteredPixels.length === 0) return null;

    return getFilteredPixels.map((pixel: any, index: number) => {
      const coords = pixel?.geometry?.coordinates;

      if (!coords || !Array.isArray(coords) || coords.length < 2) {
        return null;
      }
      
      const circleRadius = 0.000025;

      return (
        <Circle
          key={`filtered-pixel-${pixel?.properties?.pixel_id || index}`}
          center={[coords[1], coords[0]]}
          radius={circleRadius}
          pathOptions={{
            fillColor: "#FFFFFF",
            fillOpacity: 1.8,
            color: "#FFFFFF",
            weight: 6,
            opacity: 1.8,
          }}
          eventHandlers={{
            mouseover: (e: any) => {
              const allLayerData = getMultiLayerDataForPosition(coords);
              if (allLayerData.length > 0) {
                setPixelTooltip({
                  layers: allLayerData,
                  x: e.originalEvent.clientX,
                  y: e.originalEvent.clientY
                });
              }
            },
            mouseout: () => {
              setPixelTooltip(null);
            },
            mousemove: (e: any) => {
              if (pixelTooltip) {
                setPixelTooltip(prev => prev ? {
                  ...prev,
                  x: e.originalEvent.clientX,
                  y: e.originalEvent.clientY - 10
                } : null);
              }
            }
          }}
        />
      );
    });
  };

  return (
    <div className="map-wrapper">
      {/* Enhanced Multi-Layer Tooltip */}
      {pixelTooltip && pixelTooltip.layers.length > 0 && (
        <div 
          className="enhanced-tooltip"
          style={{
            left: `${pixelTooltip.x + 10}px`,
            top: `${pixelTooltip.y - 10}px`,
          }}
        >
          {pixelTooltip.layers.map((layerData, index) => (
            <div key={index} className="enhanced-tooltip-line">
              <span className="layer-name">{layerData.layer}:</span>
              <span className="layer-description">
                {layerData.label} - {layerData.description}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="map-container" ref={mapWrapperRef}>
        {/* Map-top controls (no background container) */}
        <div className="map-overlay map-overlay--left">
          <div className="layer-buttons">
            {(["Growth", "Water Uptake", "Soil Moisture", "PEST"] as const).map(
              (layer) => (
                <button
                  key={layer}
                  onClick={() => setActiveLayer(layer)}
                  className={activeLayer === layer ? "active" : ""}
                  disabled={loading}
                >
                  {LAYER_LABELS[layer]}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="map-overlay map-overlay--right">
          {profile && !profileLoading && (
            <div className="plot-selector">
              <label>Select Plot:</label>
              <select
                value={selectedPlotName}
                onChange={(e) => {
                  const newPlot = e.target.value;
                  setSelectedPlotName(newPlot);
                  localStorage.setItem("selectedPlot", newPlot);
                  setPlotBoundary(null);
                  initialFetchDoneRef.current = false;
                  console.log(
                    "🔄 Map: Fetching all 4 layer APIs for new plot:",
                    newPlot,
                  );
                  Promise.all([
                    fetchGrowthData(newPlot),
                    fetchWaterUptakeData(newPlot),
                    fetchSoilMoistureData(newPlot),
                    fetchPestData(newPlot),
                    fetchPlotData(newPlot),
                    fetchFieldAnalysis(newPlot),
                  ])
                    .then(() => {
                      console.log("✅ Map: All 4 layer APIs fetched for new plot");
                      initialFetchDoneRef.current = true;
                    })
                    .catch((err) => {
                      console.error(
                        "❌ Map: Some APIs failed to fetch for new plot:",
                        err,
                      );
                    });
                }}
                disabled={loading}
              >
                {profile.plots?.map((plot) => {
                  let displayName = "";

                  if (
                    plot.gat_number &&
                    plot.plot_number &&
                    plot.gat_number.trim() !== "" &&
                    plot.plot_number.trim() !== "" &&
                    !plot.gat_number.startsWith("GAT_") &&
                    !plot.plot_number.startsWith("PLOT_")
                  ) {
                    displayName = `${plot.gat_number}_${plot.plot_number}`;
                  } else if (
                    plot.gat_number &&
                    plot.gat_number.trim() !== "" &&
                    !plot.gat_number.startsWith("GAT_")
                  ) {
                    displayName = plot.gat_number;
                  } else if (
                    plot.plot_number &&
                    plot.plot_number.trim() !== "" &&
                    !plot.plot_number.startsWith("PLOT_")
                  ) {
                    displayName = plot.plot_number;
                  } else {
                    const village = plot.address?.village;
                    const taluka = plot.address?.taluka;

                    if (village) {
                      displayName = `Plot in ${village}`;
                      if (taluka) displayName += `, ${taluka}`;
                    } else {
                      displayName = "Plot (No GAT/Plot Number)";
                    }
                  }

                  return (
                    <option
                      key={plot.fastapi_plot_id}
                      value={plot.fastapi_plot_id}
                    >
                      {displayName}
                    </option>
                  );
                }) || []}
              </select>
            </div>
          )}
        </div>

        {/* Errors/loading (small, no background container) */}
        {profileLoading && (
          <div className="map-overlay map-overlay--status loading-indicator">
            Loading farmer profile...
          </div>
        )}
        {!profileLoading && !selectedPlotName && (
          <div className="map-overlay map-overlay--status error-message">
            No plot data available for this farmer
          </div>
        )}
        {loading && (
          <div className="map-overlay map-overlay--status loading-indicator">
            Loading plot data...
          </div>
        )}
        {error && (
          <div className="map-overlay map-overlay--status error-message">
            {error}
          </div>
        )}

        {(activeLayer === "Growth" ||
          activeLayer === "Water Uptake" ||
          activeLayer === "Soil Moisture" ||
          activeLayer === "PEST") &&
          !!selectedPlotName && (
            <AnalysisTimelineRibbon
              plotName={selectedPlotName}
              activeLayer={activeLayer}
              selectedDate={currentEndDate}
              onSelectDate={(iso) => {
                setCurrentEndDate(iso);
                // Do not show timeseries-date-popup here: without setPopupSide(left|right)
                // it uses default CSS (left:50%, bottom:500px) and the date sits in the map center.
                // Arrow buttons set popupSide so the popup anchors beside them; the ribbon already
                // shows the selected date on the cells.
                setShowDatePopup(false);
              }}
              externalTimeline={{ payload: timelinePayload, loading: timelineLoading, error: timelineError }}
            />
          )}

        {/* Loading Spinner Overlay - Shows when fetching map data */}
        {dateNavigationLoading && (
          <div 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000,
              pointerEvents: 'none'
            }}
          >
            <div 
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
              }}
            >
              <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#3B82F6' }} />
              <p
                key={fetchRotationIndex}
                className="map-layer-fetch-status-text"
                style={{
                  fontSize: "24px",
                  color: "#374151",
                  fontWeight: 700,
                  margin: 0,
                  textAlign: "center",
                  maxWidth: "min(90vw, 320px)",
                  lineHeight: 1.4,
                }}
              >
                {LAYER_FETCH_ROTATION_MESSAGES[fetchRotationIndex]}
              </p>
            </div>
          </div>
        )}

        {/* Back Button */}
        <button
          className="back-btn"
          title="Go Back"
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            }
            window.history.back();
          }}
        >
          <ArrowLeft size={18} />
        </button>

        {/* Fullscreen Button */}
        <button
          className="fullscreen-btn"
          title="Enter Fullscreen"
          onClick={() => {
            if (!document.fullscreenElement) mapWrapperRef.current?.requestFullscreen();
            else document.exitFullscreen();
          }}
        >
          <FaExpand />
        </button>

        {/* Split Screen Button */}
       {onSplitScreen && (
          <button
            className="splitscreen-btn"
            title="Split Screen View"
            onClick={onSplitScreen}
          >
            <FaColumns />
          </button>
        )} 

        {(plotBoundary || currentPlotFeature) && (
          <>
            <div className="plot-info">
              <div className="plot-area">
                <span className="plot-area-value">
                  {(() => {
                    const raw =
                      (plotBoundary || currentPlotFeature)?.properties?.area_acres ??
                      plotAreaAcres;
                    const n = Number(raw);
                    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : "0.00";
                  })()}{" "}
                  acre
                </span>
              </div>
            </div>
          </>
        )}

        {/* Date Navigation Arrows - Show for Growth, Water Uptake, Soil Moisture, and PEST */}
        {(activeLayer === "Growth" || activeLayer === "Water Uptake" || activeLayer === "Soil Moisture" || activeLayer === "PEST") && (
          <>
            <button
              className="timeseries-nav-arrow-left"
              onClick={onLeftArrowClick}
              aria-label={
                mapRebinDates.length
                  ? "Previous analysis date on timeline"
                  : "Previous date"
              }
              title={
                dateNavigationLoading
                  ? "Loading..."
                  : mapRebinDates.length
                    ? "Previous timeline date"
                    : `Previous (${DAYS_STEP} days)`
              }
              disabled={timeSeriesNavLeftDisabled}
              style={{
                opacity: timeSeriesNavLeftDisabled ? 0.7 : 1,
                cursor: timeSeriesNavLeftDisabled ? "not-allowed" : "pointer",
                pointerEvents: timeSeriesNavLeftDisabled ? "none" : "auto",
              }}
            >
              {dateNavigationLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'white' }} />
              ) : (
                <span className="timeseries-arrow-icon timeseries-arrow-left-icon"></span>
              )}
            </button>
            <button
              className="timeseries-nav-arrow-right"
              onClick={onRightArrowClick}
              aria-label={
                mapRebinDates.length
                  ? "Next analysis date on timeline"
                  : "Next date"
              }
              title={
                dateNavigationLoading
                  ? "Loading..."
                  : mapRebinDates.length
                    ? "Next timeline date"
                    : `Next (${DAYS_STEP} days)`
              }
              disabled={timeSeriesNavRightDisabled}
              style={{
                opacity: timeSeriesNavRightDisabled ? 0.7 : 1,
                cursor: timeSeriesNavRightDisabled ? "not-allowed" : "pointer",
                pointerEvents: timeSeriesNavRightDisabled ? "none" : "auto",
              }}
            >
              {dateNavigationLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'white' }} />
              ) : (
                <span className="timeseries-arrow-icon timeseries-arrow-right-icon"></span>
              )}
            </button>
            
            {/* Date Popup */}
            {showDatePopup && (
              <div className={`timeseries-date-popup ${popupSide === 'left' ? 'timeseries-date-popup-left' : ''} ${popupSide === 'right' ? 'timeseries-date-popup-right' : ''}`}>
                <div className="timeseries-date-popup-content">
                  <div className="timeseries-date-popup-value">{currentEndDate}</div>
                  <div className="timeseries-date-popup-range">
                    {/* Start: {(() => {
                      const endDate = new Date(currentEndDate);
                      const startDate = new Date(endDate);  
                      startDate.setDate(startDate.getDate() - DAYS_STEP);
                      return startDate.toISOString().split('T')[0];
                    })()} */}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <MapContainer
          center={mapCenter}
          zoom={PLOT_VIEW_MAX_ZOOM}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          maxZoom={22}
          minZoom={10}
        >
          <TileLayer
            url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            attribution="© Google"
            maxZoom={22}
          />

          {(plotBoundary || currentPlotFeature)?.geometry?.coordinates?.[0] &&
            Array.isArray((plotBoundary || currentPlotFeature).geometry.coordinates[0]) && (
            <SetPlotOverviewZoom
              coordinates={(plotBoundary || currentPlotFeature).geometry.coordinates[0]}
              refitKey={currentEndDate}
            />
          )}

          {activeUrl && (
            <CustomTileLayer
              key={`${activeLayer}-layer-${layerChangeKey}`}
              url={activeUrl}
              opacity={0.7}
              tileKey={`${activeLayer}-layer-${layerChangeKey}`}
            />
          )}

          {selectedLegendClass && renderFilteredPixels()}
          {renderPlotBorder()}
        </MapContainer>

        {legendData.length > 0 && (
          <div className="map-legend-bottom">
            <div className="legend-items-bottom">
              {legendData.map((item: any, index: number) => (
                <div
                  key={index}
                  className={`legend-item-bottom ${
                    selectedLegendClass === item.label ? "active" : ""
                  } ${item.percentage === 0 ? "zero-percent" : ""}`}
                  onClick={() => handleLegendClick(item.label, item.percentage)}
                  style={{
                    pointerEvents: item.percentage === 0 ? 'none' : 'auto',
                    cursor: 'pointer'
                  }}
                >
                  <div
                    className="legend-circle-bottom cursor-pointer transition-all duration-150"
                    style={{
                      background: LEGEND_CIRCLE_COLOR,
                      boxShadow: `0 5px 8px ${LEGEND_CIRCLE_COLOR}40`
                    }}
                  >
                    <div className="legend-percentage-bottom font-bold text-xlg text-white-900">
                      {item.percentage}
                    </div>
                  </div>
                  <div className="legend-label-bottom text-white-500">{item.label}</div>
                </div>
              ))}
            </div>

          </div>
        )}
              </div>
    </div>
  );
};

export default CropEyeMap;
