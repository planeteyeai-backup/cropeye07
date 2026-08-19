import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polygon, useMap, Circle, Pane } from "react-leaflet";
import { LatLngTuple, LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./Map.css";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { useAppContext } from "../context/AppContext";
import { FaExpand, FaColumns } from 'react-icons/fa';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AnalysisTimelineRibbon } from "./AnalysisTimelineRibbon";
import { resolveApiPlotName, plotKeyFromRecord } from "../utils/plotName";
import { getCache, removeCache, removeCachesMatchingPlot } from "../utils/cache";
import {
  fetchAnalysisTimeline,
  sortedRebinDatesForLayer,
  latestRebinDateAcrossAllLayers,
  type AnalysisTimelineResponse,
} from "../services/analysisTimeline";
import {
  getApiEndDateForLayer,
  persistPlotImageEndDatesFromTimeline,
} from "../utils/plotImageEndDates";
import {
  fetchAdminLayerWithDateFallback,
  isAdminNoImageryError,
} from "../utils/adminLayerApi";
import { getSinglePlotAgroStats, refreshApiEndpoints } from "../api";
import { useI18nLite } from "../i18nLite.ts";
import {
  isAnalysisGeometryStale,
  type GeoJsonPolygon,
} from "../utils/plotGeometry";
import {
  PLOT_BOUNDARY_UPDATED_EVENT,
  boundariesMatch,
  readLocalPlotBoundaryForPlot,
  resolveSavedPlotBoundaryFeature,
  type PlotBoundaryUpdatedDetail,
} from "../utils/plotBoundarySync";

function parsePositiveArea(value: unknown): number | null {
  if (value == null || value === "" || value === "N/A") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePlotKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^GAT/i, "")
    .replace(/\//g, "_")
    .replace(/ /g, "_")
    .toLowerCase();
}

/**
 * Acres straight from the API `area_acres` field only — the same value Harvest
 * Planning sums. No hectare conversion, no Django area_size, no geometry math,
 * so the map can never show a derived number the API did not return.
 */
function areaAcresFromApiRecord(record: unknown): number | null {
  const row = record as Record<string, unknown> | null | undefined;
  if (!row) return null;

  const soil = row.soil as Record<string, unknown> | undefined;

  return (
    parsePositiveArea(row.area_acres) ?? parsePositiveArea(soil?.area_acres)
  );
}

function areaAcresFromFeature(feature: unknown): number | null {
  const row = feature as any;
  if (!row) return null;

  return areaAcresFromApiRecord(row.properties ?? row);
}

function areaAcresFromAgroStatsCache(plotName: string): number | null {
  if (!plotName?.trim()) return null;

  const today = new Date().toISOString().split("T")[0];
  const keys = [
    `agroStats_v3_${today}`,
    `agroStats_${today}`,
    "agroStats_v3",
    "agroStats",
  ];

  for (const key of keys) {
    const payload = getCache(key) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") continue;

    const row =
      payload[plotName] ??
      payload[`"${plotName}"`] ??
      Object.entries(payload).find(([plotKey]) =>
        normalizePlotKey(plotKey) === normalizePlotKey(plotName),
      )?.[1];

    const acres = areaAcresFromApiRecord(row);
    if (acres != null) return acres;
  }

  return null;
}

/** API `area_acres` only: analysis feature → cached agroStats → analyzeSinglePlot. */
function resolveDisplayAreaAcres(args: {
  plotBoundary: any;
  plotData: any;
  selectedPlotName: string;
  apiAreaAcres: number | null;
}): number | null {
  const feature = args.plotBoundary ?? args.plotData?.features?.[0];

  const fromFeature = areaAcresFromFeature(feature);
  if (fromFeature != null) return fromFeature;

  const fromAgroStats = areaAcresFromAgroStatsCache(args.selectedPlotName);
  if (fromAgroStats != null) return fromAgroStats;

  if (args.apiAreaAcres != null && args.apiAreaAcres > 0) {
    return args.apiAreaAcres;
  }

  return null;
}

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

const LAYER_LOADING_MESSAGE: Record<
  "Growth" | "Water Uptake" | "Soil Moisture" | "PEST",
  string
> = {
  Growth: "Fetching growth data…",
  "Water Uptake": "Fetching water uptake data…",
  "Soil Moisture": "Fetching soil moisture data…",
  PEST: "Fetching pest data…",
};

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
 * Layer APIs always use that layer's latest image date from the analysis timeline.
 * Never pass calendar today or an older UI/rebin navigation date.
 */

function isNoImageryError(message: string | undefined): boolean {
  return isAdminNoImageryError(message);
}

/** Overview framing: zoom in enough to see analysis tiles inside the yellow border. */
const PLOT_VIEW_MAX_ZOOM = 21;
/** Wider first framing so every analysis tile is fetched before zooming in. */
const PLOT_PRELOAD_MAX_ZOOM = 17;
const PLOT_FIT_PADDING_PX = 56;

const SetPlotOverviewZoom: React.FC<{
  coordinates: number[][];
  /** Bumps effect when user picks another date / plot / layer so the map re-frames. */
  refitKey?: string;
  /** False until analysis tiles finish loading — keeps the wider framing. */
  tilesReady?: boolean;
}> = ({ coordinates, refitKey, tilesReady = true }) => {
  const map = useMap();

  useEffect(() => {
    if (!coordinates.length) return;

    const latlngs = coordinates
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map(([lng, lat]) => [lat, lng] as LatLngTuple)
      .filter((tuple: LatLngTuple) => !isNaN(tuple[0]) && !isNaN(tuple[1]));

    if (!latlngs.length) return;

    const bounds = new LatLngBounds(latlngs as LatLngTuple[]);
    if (!bounds.isValid()) return;

    const padding: [number, number] = [
      PLOT_FIT_PADDING_PX,
      PLOT_FIT_PADDING_PX,
    ];

    // Tiles still loading: snap to the wide framing so nothing animates while
    // imagery streams in, and re-apply until the container has its real size.
    if (!tilesReady) {
      const fitWide = () => {
        map.invalidateSize({ animate: false });
        map.fitBounds(bounds, {
          padding,
          maxZoom: PLOT_PRELOAD_MAX_ZOOM,
          animate: false,
        });
      };

      fitWide();
      const t1 = window.setTimeout(fitWide, 120);
      const t2 = window.setTimeout(fitWide, 450);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }

    // Tiles fully loaded: one uninterrupted flight in, no repeated re-fits that
    // would restart the animation mid-way.
    map.invalidateSize({ animate: false });
    const raf = window.requestAnimationFrame(() => {
      map.flyToBounds(bounds, {
        padding,
        maxZoom: PLOT_VIEW_MAX_ZOOM,
        animate: true,
        duration: 1.1,
        easeLinearity: 0.2,
      });
    });

    return () => window.cancelAnimationFrame(raf);
  }, [coordinates, map, refitKey, tilesReady]);

  return null;
};

interface MapProps {
  onHealthDataChange?: (data: any) => void;
  onSoilDataChange?: (data: any) => void;
  onFieldAnalysisChange?: (data: any) => void;
  onMoistGroundChange?: (percent: number) => void;
  onPestDataChange?: (data: any) => void;
  onSplitScreen?: () => void;
}

/** Clip analysis tiles to the saved (yellow) plot boundary so old Admin green cannot sit on the wrong field. */
const ClipAnalysisPaneToBoundary: React.FC<{
  paneName: string;
  boundary: GeoJsonPolygon | null;
  enabled: boolean;
}> = ({ paneName, boundary, enabled }) => {
  const map = useMap();

  useEffect(() => {
    const apply = () => {
      const pane = map.getPane(paneName);
      if (!pane) return;

      pane.style.overflow = "visible";
      pane.style.display = "block";
      pane.style.visibility = "visible";
      pane.style.opacity = "1";
      pane.style.zIndex = "450";
      pane.style.pointerEvents = "none";

      const ring = boundary?.coordinates?.[0];
      if (!enabled || !Array.isArray(ring) || ring.length < 3) {
        pane.style.clipPath = "";
        (pane.style as any).webkitClipPath = "";
        return;
      }

      const points: string[] = [];
      for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const lng = Number(pt[0]);
        const lat = Number(pt[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const p = map.latLngToLayerPoint([lat, lng]);
        points.push(`${Math.round(p.x)}px ${Math.round(p.y)}px`);
      }
      if (points.length < 3) {
        pane.style.clipPath = "";
        (pane.style as any).webkitClipPath = "";
        return;
      }
      const clip = `polygon(${points.join(", ")})`;
      pane.style.clipPath = clip;
      (pane.style as any).webkitClipPath = clip;
    };

    apply();
    map.on("move zoom zoomend moveend viewreset", apply);
    const raf = window.requestAnimationFrame(apply);
    return () => {
      window.cancelAnimationFrame(raf);
      map.off("move zoom zoomend moveend viewreset", apply);
      const pane = map.getPane(paneName);
      if (pane) {
        pane.style.clipPath = "";
        (pane.style as any).webkitClipPath = "";
      }
    };
  }, [map, paneName, boundary, enabled]);

  return null;
};

const CustomTileLayer: React.FC<{
  url: string;
  opacity?: number;
  tileKey?: string;
  pane?: string;
  /** Fires only after every requested tile of this layer has settled. */
  onAllTilesLoaded?: () => void;
}> = ({ url, opacity = 0.7, tileKey, pane, onAllTilesLoaded }) => {
  // Counted per tile: Leaflet's `load` alone can fire with zero tiles requested,
  // which would let the map zoom in before any imagery exists.
  const requestedRef = useRef(0);
  const settledRef = useRef(0);

  useEffect(() => {
    requestedRef.current = 0;
    settledRef.current = 0;
  }, [tileKey, url]);

  const settleTile = () => {
    settledRef.current += 1;
    if (requestedRef.current > 0 && settledRef.current >= requestedRef.current) {
      onAllTilesLoaded?.();
    }
  };

  if (!url) {
    return null;
  }

  return (
    <TileLayer
      key={tileKey}
      url={url}
      opacity={opacity}
      maxZoom={22}
      minZoom={1}
      tileSize={256}
      pane={pane}
      zIndex={450}
      keepBuffer={6}
      updateWhenZooming={false}
      eventHandlers={{
        tileloadstart: () => {
          requestedRef.current += 1;
        },
        tileload: settleTile,
        tileerror: (e: any) => {
          console.error("[Map] Analysis tile load error:", e?.tile?.src || e);
          settleTile();
        },
        load: () => {
          if (requestedRef.current > 0) onAllTilesLoaded?.();
        },
      }}
    />
  );
};

/**
 * Base satellite layer with per-tile counting so the first framing can wait for
 * real imagery. Never keyed/remounted (that would blank the map); readiness is
 * re-measured when `loadKey` changes.
 */
const BaseSatelliteTileLayer: React.FC<{
  url: string;
  attribution?: string;
  loadKey: string;
  onAllTilesLoaded?: () => void;
}> = ({ url, attribution, loadKey, onAllTilesLoaded }) => {
  const requestedRef = useRef(0);
  const settledRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    requestedRef.current = 0;
    settledRef.current = 0;
    doneRef.current = false;
  }, [loadKey]);

  const markReady = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onAllTilesLoaded?.();
  };

  const settleTile = () => {
    settledRef.current += 1;
    if (requestedRef.current > 0 && settledRef.current >= requestedRef.current) {
      markReady();
    }
  };

  return (
    <TileLayer
      url={url}
      attribution={attribution}
      maxZoom={22}
      keepBuffer={6}
      updateWhenZooming={false}
      eventHandlers={{
        tileloadstart: () => {
          requestedRef.current += 1;
        },
        tileload: settleTile,
        tileerror: settleTile,
        load: () => {
          if (requestedRef.current > 0) markReady();
        },
      }}
    />
  );
};

/** Recompute tile layout when Home becomes visible again (e.g. My Profile → Home). */
const MapResizeWhenVisible: React.FC = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;

    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
      });
    };

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(refresh)
        : null;
    observer?.observe(container);

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [map]);

  return null;
};

function exactSelectedEndDate(endDate: string | null | undefined): string[] {
  const day = (endDate || "").trim().split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return [day];
}

const CropEyeMap: React.FC<MapProps> = ({
  onFieldAnalysisChange,
  onPestDataChange,
  onSplitScreen,
}) => {
  const { profile, loading: profileLoading, refreshMyProfile } = useFarmerProfile();
  const { t } = useI18nLite();
  const { getCached, setCached, setAppState } = useAppContext();
  const plotNameForApi = (plotKey: string) =>
    resolveApiPlotName(plotKey, profile?.plots);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const initialFetchDoneRef = useRef<boolean>(false); // Track if initial fetch is done
  /** In-memory tile responses: key = `growth|plot|YYYY-MM-DD` etc. Avoids refetch when switching layer tab only. */
  const layerTilesCacheRef = useRef<Map<string, unknown>>(new Map());

  const [plotData, setPlotData] = useState<any>(null);
  const [plotBoundary, setPlotBoundary] = useState<any>(null); // Analysis API boundary (fallback)
  const [profileBoundaryRevision, setProfileBoundaryRevision] = useState(0);
  const [optimisticProfileBoundary, setOptimisticProfileBoundary] =
    useState<GeoJsonPolygon | null>(null);
  const skipAnalysisBoundaryRef = useRef(false);
  const boundaryRefreshGenRef = useRef(0);
  const [layersUpdatingAfterEdit, setLayersUpdatingAfterEdit] = useState(false);
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

  const [selectedLegendClass, setSelectedLegendClass] = useState<string | null>(null);
  const [layerChangeKey, setLayerChangeKey] = useState(0);
  /** Bumped on every layer-tab click so the map always re-zooms to the plot. */
  const [plotFitNonce, setPlotFitNonce] = useState(0);
  const [pixelTooltip, setPixelTooltip] = useState<{layers: Array<{layer: string, label: string, description: string, percentage: number}>, x: number, y: number} | null>(null);
  const [apiFallbackAreaAcres, setApiFallbackAreaAcres] = useState<number | null>(
    null,
  );
  
  // Date navigation state — empty until timeline snaps to a Sentinel-available date.
  // Never start as calendar "today" (Mandya Admin 404/500 for today).
  const [currentEndDate, setCurrentEndDate] = useState<string>("");
  const [showDatePopup, setShowDatePopup] = useState(false);
  const [popupSide, setPopupSide] = useState<'left' | 'right' | null>(null);
  const DAYS_STEP = 5;

  const [timelinePayload, setTimelinePayload] = useState<AnalysisTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const mapRebinSnapKeyRef = useRef<string>("");
  const layerFetchInFlightRef = useRef<Set<string>>(new Set());
  /** Layers still fetching for the current plot/date — spinner only waits on the active tab. */
  const layersPendingRef = useRef<Set<string>>(new Set());
  const activeLayerRef = useRef(activeLayer);
  const layerFetchGenRef = useRef(0);
  const currentEndDateRef = useRef(currentEndDate);
  currentEndDateRef.current = currentEndDate;

  useEffect(() => {
    activeLayerRef.current = activeLayer;
    // Switching tabs: show spinner only if that layer is still loading in background.
    setDateNavigationLoading(layersPendingRef.current.has(activeLayer));
  }, [activeLayer]);

  useEffect(() => {
    let cancelled = false;
    const plot = selectedPlotName?.trim();
    if (!plot) {
      setTimelinePayload(null);
      setTimelineLoading(false);
      setTimelineError(null);
      mapRebinSnapKeyRef.current = "";
      layerTilesCacheRef.current.clear();
      setCurrentEndDate("");
      return;
    }
    setTimelinePayload(null);
    setTimelineLoading(true);
    setTimelineError(null);
    mapRebinSnapKeyRef.current = "";
    layerTilesCacheRef.current.clear();
    setCurrentEndDate("");
    fetchAnalysisTimeline(plotNameForApi(plot))
      .then((data) => {
        if (cancelled) return;
        setTimelinePayload(data);
        // Store Sentinel-available end dates for this plot (Map + Soil/Fertilizer reuse).
        if (data?.timeline?.length) {
          persistPlotImageEndDatesFromTimeline(
            plotNameForApi(plot),
            data.timeline,
          );
        }
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

  /** Share active map imagery date with the green header (FarmerHomeGrid). */
  useEffect(() => {
    setAppState((prev) => ({
      ...prev,
      mapImageDate: currentEndDate || null,
      mapLatestImageDate: latestRebinOverall || null,
      mapImageLayer: activeLayer,
      mapImagePlot: selectedPlotName || null,
    }));
  }, [
    currentEndDate,
    latestRebinOverall,
    activeLayer,
    selectedPlotName,
    setAppState,
  ]);

  useEffect(() => {
    setLayerChangeKey(prev => prev + 1);
    // Layer tabs only switch the displayed tile; same `currentEndDate` and cached layer responses are reused.

    // Ensure plotBoundary is preserved when switching layers
    // Try to extract from current layer data if plotBoundary is missing
    // Do not restore Growth/analysis geometry when farmer saved a custom boundary.
    if (!skipAnalysisBoundaryRef.current && !plotBoundary && selectedPlotName) {
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

  // Fetch Growth / Water / Soil / Pest for the exact ribbon-selected date only (no date fallback).
  // Wait until currentEndDate is snapped to timeline (never fetch with calendar today).
  // Spinner clears when the *active* layer finishes — do not wait for slow Water/Pest.
  useEffect(() => {
    if (!selectedPlotName) return;
    if (timelineLoading) return;
    if (!latestRebinOverall) return;
    if (!currentEndDate) return;
    // Avoid racing before snap: today / future dates cause Mandya Admin 404s.
    if (currentEndDate > latestRebinOverall) return;

    const fetchKey = `${selectedPlotName}|img:${currentEndDate}|${latestRebinOverall}`;
    if (layerFetchInFlightRef.current.has(fetchKey)) return;
    layerFetchInFlightRef.current.add(fetchKey);
    setError(null);

    const fetchGen = ++layerFetchGenRef.current;
    const requestedDate = currentEndDate;
    const pending = new Set([
      "Growth",
      "Water Uptake",
      "Soil Moisture",
      "PEST",
    ]);
    layersPendingRef.current = pending;
    setDateNavigationLoading(pending.has(activeLayerRef.current));

    const markLayerDone = (layer: string) => {
      if (fetchGen !== layerFetchGenRef.current) return;
      layersPendingRef.current.delete(layer);
      if (layer === activeLayerRef.current) {
        setDateNavigationLoading(false);
      }
      if (layersPendingRef.current.size === 0) {
        layerFetchInFlightRef.current.delete(fetchKey);
        setDateNavigationLoading(false);
        console.log(
          "✅ Map: All layer fetches finished for plot:",
          selectedPlotName,
          "uiDate:",
          requestedDate,
        );
      }
    };

    void fetchGrowthData(selectedPlotName, { requestedDate }).finally(() =>
      markLayerDone("Growth"),
    );
    void fetchWaterUptakeData(selectedPlotName, { requestedDate }).finally(() =>
      markLayerDone("Water Uptake"),
    );
    void fetchSoilMoistureData(selectedPlotName, { requestedDate }).finally(() =>
      markLayerDone("Soil Moisture"),
    );
    void fetchPestData(selectedPlotName, { requestedDate }).finally(() =>
      markLayerDone("PEST"),
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlotName, timelineLoading, latestRebinOverall, currentEndDate]);

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

    const plotNames =
      profile.plots
        ?.map((plot) => plotKeyFromRecord(plot))
        .filter((name) => name.trim() !== "") || [];
    const savedPlot = typeof window !== 'undefined' ? localStorage.getItem('selectedPlot') : null;
    const savedIsValid = Boolean(
      savedPlot &&
        plotNames.some(
          (name) => normalizePlotKey(name) === normalizePlotKey(savedPlot),
        ),
    );
    const plotToUse = savedIsValid
      ? (plotNames.find(
          (name) => normalizePlotKey(name) === normalizePlotKey(savedPlot!),
        ) ?? savedPlot)
      : plotNames.length > 0
        ? plotNames[0]
        : null;

    if (plotToUse && normalizePlotKey(plotToUse) !== normalizePlotKey(selectedPlotName)) {
      const switchingPlot =
        Boolean(selectedPlotName?.trim()) &&
        normalizePlotKey(plotToUse) !== normalizePlotKey(selectedPlotName);
      setSelectedPlotName(plotToUse);
      if (!savedIsValid) localStorage.setItem('selectedPlot', plotToUse);
      if (switchingPlot) {
        setPlotBoundary(null);
        setOptimisticProfileBoundary(null);
      }
    }
  }, [profile, profileLoading]);

  // Hydrate yellow border from sessionStorage when Home Map mounts / plot changes
  // (covers My Profile → Home even if the CustomEvent was missed while remounting).
  useEffect(() => {
    if (!selectedPlotName?.trim()) return;
    const local = readLocalPlotBoundaryForPlot(selectedPlotName, profile?.plots);
    if (!local) return;
    setOptimisticProfileBoundary((prev) => {
      if (prev && boundariesMatch(prev, local)) return prev;
      return local;
    });
    setPlotBoundary(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlotName, profile?.plots]);

  // After My Profile boundary save: drop stale analysis geometry and reload profile.
  useEffect(() => {
    const onBoundaryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<PlotBoundaryUpdatedDetail>).detail;
      setPlotBoundary(null);
      setOptimisticProfileBoundary(detail?.boundary ?? null);
      setProfileBoundaryRevision((value) => value + 1);
      void refreshMyProfile();

      const updatedPlot = detail?.plotKey?.trim();
      const updatedId = detail?.plotId?.trim();
      if (!selectedPlotName) return;

      const samePlot =
        (updatedPlot &&
          normalizePlotKey(updatedPlot) ===
            normalizePlotKey(selectedPlotName)) ||
        (updatedId &&
          normalizePlotKey(updatedId) === normalizePlotKey(selectedPlotName)) ||
        (updatedPlot &&
          profile?.plots?.some((plot) => {
            const keys = [
              plotKeyFromRecord(plot),
              plot?.fastapi_plot_id,
              plot?.gat_number != null && plot?.plot_number != null
                ? `${plot.gat_number}/${plot.plot_number}`
                : "",
              plot?.id != null ? String(plot.id) : "",
            ];
            return keys.some(
              (key) =>
                key &&
                (normalizePlotKey(key) === normalizePlotKey(updatedPlot) ||
                  (updatedId &&
                    normalizePlotKey(key) === normalizePlotKey(updatedId))),
            );
          }));
      if (!samePlot) return;

      // Hide old Admin green immediately — it still maps the previous polygon.
      setGrowthData(null);
      setWaterUptakeData(null);
      setSoilMoistureData(null);
      setPestData(null);
      setPlotData(null);
      setLayersUpdatingAfterEdit(true);

      const apiPlot = plotNameForApi(selectedPlotName);
      removeCachesMatchingPlot(selectedPlotName);
      removeCachesMatchingPlot(apiPlot);
      if (detail?.plotKey) removeCachesMatchingPlot(detail.plotKey);
      if (detail?.plotId) removeCachesMatchingPlot(detail.plotId);
      [
        `layer:growth:${apiPlot}:${currentEndDate}`,
        `layer:water:${apiPlot}:${currentEndDate}`,
        `layer:soil:${apiPlot}:${currentEndDate}`,
        `layer:pest:${apiPlot}:${currentEndDate}`,
        `growthData_${apiPlot}`,
        `waterUptakeData_${apiPlot}`,
        `soilMoistureData_${apiPlot}`,
        `pestData_${apiPlot}`,
      ].forEach((key) => removeCache(key));

      layerTilesCacheRef.current.clear();
      skipAnalysisBoundaryRef.current = true;
      setLayerChangeKey((key) => key + 1);
      initialFetchDoneRef.current = false;

      const refreshGen = ++boundaryRefreshGenRef.current;

      const forceReloadLayers = async () => {
        await Promise.all([
          fetchGrowthData(selectedPlotName, {
            forceRefresh: true,
            requestedDate: currentEndDate,
          }),
          fetchWaterUptakeData(selectedPlotName, {
            forceRefresh: true,
            requestedDate: currentEndDate,
          }),
          fetchSoilMoistureData(selectedPlotName, {
            forceRefresh: true,
            requestedDate: currentEndDate,
          }),
          fetchPestData(selectedPlotName, {
            forceRefresh: true,
            requestedDate: currentEndDate,
          }),
          fetchPlotData(selectedPlotName),
        ]);
      };

      // Ask Admin/microservices to rebuild tiles, then poll until geometry catches up.
      void (async () => {
        try {
          await refreshApiEndpoints({
            plotId: detail?.plotId || updatedId,
            plotName: detail?.plotKey || selectedPlotName,
          });
          const delaysMs = [0, 3000, 8000, 20000, 45000, 90000];
          for (const delay of delaysMs) {
            if (boundaryRefreshGenRef.current !== refreshGen) return;
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            if (boundaryRefreshGenRef.current !== refreshGen) return;
            if (delay > 0) {
              await refreshApiEndpoints({
                plotId: detail?.plotId || updatedId,
                plotName: detail?.plotKey || selectedPlotName,
              });
            }
            await forceReloadLayers();
          }
        } catch (err) {
          console.warn("[Map] Layer refresh after boundary edit failed:", err);
        } finally {
          if (boundaryRefreshGenRef.current === refreshGen) {
            skipAnalysisBoundaryRef.current = false;
            // Banner clears when analysis IoU matches saved boundary (effect below).
            setTimeout(() => {
              if (boundaryRefreshGenRef.current === refreshGen) {
                setLayersUpdatingAfterEdit(false);
              }
            }, 2000);
          }
        }
      })();
    };

    window.addEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    return () => {
      window.removeEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlotName, refreshMyProfile]);

  // Separate useEffect to fetch all 4 APIs on initial plot selection (after functions are defined)
  // This runs once when selectedPlotName is first set (on login)
  useEffect(() => {
    if (!selectedPlotName || initialFetchDoneRef.current || profileLoading) {
      return;
    }
    if (timelineLoading || !latestRebinOverall) return;

    initialFetchDoneRef.current = true;

    // Growth tiles already load via the layer-fetch effect — do not call Admin Growth twice
    // (that duplicated "Loading plot data..." and slowed first paint).
    console.log('🔄 Map: Fetching field analysis on login for plot:', selectedPlotName);
    fetchFieldAnalysis(selectedPlotName)
      .then(() => {
        console.log('✅ Map: Field analysis fetched successfully on login');
      })
      .catch((err) => {
        console.error('❌ Map: Field analysis fetch failed:', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlotName, profileLoading, timelineLoading, latestRebinOverall]);

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
      const cap = latestRebinOverall || today;
      const nextIso = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;
      if (nextIso <= cap) {
        adjustDate(DAYS_STEP);
      } else {
        setCurrentEndDate(cap);
      }
    }
  };

  const fetchGrowthData = async (
    plotName: string,
    options?: { forceRefresh?: boolean; requestedDate?: string },
  ) => {
    if (!plotName) return;
    const apiPlot = plotNameForApi(plotName);
    const forceRefresh = Boolean(options?.forceRefresh);
    const requestedDate = options?.requestedDate ?? currentEndDate;

    // Exact ribbon date only — no fallback to other timeline dates/tiles.
    const candidateDates = exactSelectedEndDate(requestedDate);
    if (!candidateDates.length) return;
    const endDate = candidateDates[0];

    const isStale = () => currentEndDateRef.current !== requestedDate;

    if (!forceRefresh) {
      const memKey = `growth:${apiPlot}:${endDate}`;
      if (layerTilesCacheRef.current.has(memKey)) {
        if (isStale()) return;
        const hit = layerTilesCacheRef.current.get(memKey) as any;
        setGrowthData(hit ?? null);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && hit?.features?.[0]?.geometry) {
          setPlotBoundary(hit.features[0]);
        }
        return;
      }
      const sharedCached = getCache(`layer:growth:${apiPlot}:${endDate}`, 30 * 60 * 1000);
      if (sharedCached) {
        if (isStale()) return;
        layerTilesCacheRef.current.set(memKey, sharedCached);
        setGrowthData(sharedCached);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && sharedCached?.features?.[0]?.geometry) {
          setPlotBoundary(sharedCached.features[0]);
        }
        return;
      }
    } else {
      layerTilesCacheRef.current.delete(`growth:${apiPlot}:${endDate}`);
      removeCache(`layer:growth:${apiPlot}:${endDate}`);
      removeCache(`growthData_${apiPlot}`);
    }

    try {
      const { data, endDate: apiEndDate } = await fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: apiPlot,
        layer: "Growth",
        candidateDates,
        forceRefresh,
      });
      if (isStale()) return;
      const memKey = `growth:${apiPlot}:${apiEndDate}`;
      layerTilesCacheRef.current.set(memKey, data);
      setGrowthData(data);

      if (!skipAnalysisBoundaryRef.current && !plotBoundary && (data as any)?.features?.[0]?.geometry) {
        setPlotBoundary((data as any).features[0]);
      }
    } catch (err: any) {
      if (isStale()) return;
      console.error("Error fetching growth data:", {
        error: err,
        message: err?.message,
        plotName,
        endDate: requestedDate,
        candidateDates,
      });
      // Do not keep previous-date tiles when this date fails.
      setGrowthData(null);

      if (isNoImageryError(err?.message)) {
        return;
      }
      let errorMessage = "Failed to fetch growth data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
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

  const fetchWaterUptakeData = async (
    plotName: string,
    options?: { forceRefresh?: boolean; requestedDate?: string },
  ) => {
    if (!plotName) return;
    const apiPlot = plotNameForApi(plotName);
    const forceRefresh = Boolean(options?.forceRefresh);
    const requestedDate = options?.requestedDate ?? currentEndDate;
    const candidateDates = exactSelectedEndDate(requestedDate);
    if (!candidateDates.length) return;
    const endDate = candidateDates[0];
    const isStale = () => currentEndDateRef.current !== requestedDate;

    if (!forceRefresh) {
      const memKey = `water:${apiPlot}:${endDate}`;
      if (layerTilesCacheRef.current.has(memKey)) {
        if (isStale()) return;
        const hit = layerTilesCacheRef.current.get(memKey) as any;
        setWaterUptakeData(hit ?? null);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && hit?.features?.[0]?.geometry) {
          setPlotBoundary(hit.features[0]);
        }
        return;
      }
      const sharedCached = getCache(`layer:water:${apiPlot}:${endDate}`, 30 * 60 * 1000);
      if (sharedCached) {
        if (isStale()) return;
        layerTilesCacheRef.current.set(memKey, sharedCached);
        setWaterUptakeData(sharedCached);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && sharedCached?.features?.[0]?.geometry) {
          setPlotBoundary(sharedCached.features[0]);
        }
        return;
      }
    } else {
      layerTilesCacheRef.current.delete(`water:${apiPlot}:${endDate}`);
      removeCache(`layer:water:${apiPlot}:${endDate}`);
      removeCache(`waterUptakeData_${apiPlot}`);
    }

    try {
      const { data, endDate: apiEndDate } = await fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: apiPlot,
        layer: "Water Uptake",
        candidateDates,
        forceRefresh,
      });
      if (isStale()) return;
      const memKey = `water:${apiPlot}:${apiEndDate}`;
      layerTilesCacheRef.current.set(memKey, data);
      setWaterUptakeData(data);
      if (!skipAnalysisBoundaryRef.current && !plotBoundary && (data as any)?.features?.[0]?.geometry) {
        setPlotBoundary((data as any).features[0]);
      }
    } catch (err: any) {
      if (isStale()) return;
      console.error("Error fetching water uptake data:", {
        error: err,
        message: err?.message,
        plotName,
        endDate: requestedDate,
        candidateDates,
      });
      setWaterUptakeData(null);
      if (isNoImageryError(err?.message)) {
        return;
      }
      let errorMessage = "Failed to fetch water uptake data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
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

  const fetchSoilMoistureData = async (
    plotName: string,
    options?: { forceRefresh?: boolean; requestedDate?: string },
  ) => {
    if (!plotName) return;
    const apiPlot = plotNameForApi(plotName);
    const forceRefresh = Boolean(options?.forceRefresh);
    const requestedDate = options?.requestedDate ?? currentEndDate;
    const candidateDates = exactSelectedEndDate(requestedDate);
    if (!candidateDates.length) return;
    const endDate = candidateDates[0];
    const isStale = () => currentEndDateRef.current !== requestedDate;

    if (!forceRefresh) {
      const memKey = `soil:${apiPlot}:${endDate}`;
      if (layerTilesCacheRef.current.has(memKey)) {
        if (isStale()) return;
        const hit = layerTilesCacheRef.current.get(memKey) as any;
        setSoilMoistureData(hit ?? null);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && hit?.features?.[0]?.geometry) {
          setPlotBoundary(hit.features[0]);
        }
        return;
      }
      const sharedCached = getCache(`layer:soil:${apiPlot}:${endDate}`, 30 * 60 * 1000);
      if (sharedCached) {
        if (isStale()) return;
        layerTilesCacheRef.current.set(memKey, sharedCached);
        setSoilMoistureData(sharedCached);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && sharedCached?.features?.[0]?.geometry) {
          setPlotBoundary(sharedCached.features[0]);
        }
        return;
      }
    } else {
      layerTilesCacheRef.current.delete(`soil:${apiPlot}:${endDate}`);
      removeCache(`layer:soil:${apiPlot}:${endDate}`);
      removeCache(`soilMoistureData_${apiPlot}`);
    }

    try {
      const { data, endDate: apiEndDate } = await fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: apiPlot,
        layer: "Soil Moisture",
        candidateDates,
        forceRefresh,
      });
      if (isStale()) return;
      const memKey = `soil:${apiPlot}:${apiEndDate}`;
      layerTilesCacheRef.current.set(memKey, data);
      setSoilMoistureData(data);
      if (!skipAnalysisBoundaryRef.current && !plotBoundary && (data as any)?.features?.[0]?.geometry) {
        setPlotBoundary((data as any).features[0]);
      }
    } catch (err: any) {
      if (isStale()) return;
      console.error("Error fetching soil moisture data:", {
        error: err,
        message: err?.message,
        plotName,
        endDate: requestedDate,
        candidateDates,
      });
      setSoilMoistureData(null);
      if (isNoImageryError(err?.message)) {
        return;
      }
      let errorMessage = "Failed to fetch soil moisture data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
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

    const apiPlot = plotNameForApi(plotName);
    const candidateDates = exactSelectedEndDate(currentEndDate);
    if (!candidateDates.length) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: apiPlot,
        layer: "Growth",
        candidateDates,
      });
      setPlotData(data);

      if (!skipAnalysisBoundaryRef.current && (data as any)?.features?.[0]?.geometry) {
        setPlotBoundary((data as any).features[0]);
      }
    } catch (err: any) {
      console.error("Error fetching plot data:", {
        error: err,
        message: err?.message,
        plotName,
        candidateDates,
      });

      if (isNoImageryError(err?.message)) {
        // Keep existing plot visible when Admin has not synced latest timeline dates.
        return;
      }

      let errorMessage = "Failed to fetch plot data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
        if (err?.message?.includes("CORS") || err?.message?.includes("cors")) {
          errorMessage = "CORS error: Backend server is not allowing requests from this origin. Please check CORS configuration on the server.";
        } else {
          errorMessage = "Cannot connect to server. Please check if the backend service is running and accessible.";
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      if (
        !skipAnalysisBoundaryRef.current &&
        (!plotBoundary || plotBoundary.properties?.plot_name !== plotName)
      ) {
        setPlotData(null);
        setPlotBoundary(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchFieldAnalysis = async (plotName: string) => {
    if (!plotName) return;
    const apiPlot = plotNameForApi(plotName);

    try {
      const currentDate = getApiEndDateForLayer(
        plotName,
        "Growth",
        timelinePayload?.timeline,
        currentEndDate,
      );
      if (!currentDate) return;
      const resp = await fetch(
        `https://sef-cropeye.up.railway.app/analyze?plot_name=${encodeURIComponent(apiPlot)}&end_date=${currentDate}&days_back=15`,
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

  const fetchPestData = async (
    plotName: string,
    options?: { forceRefresh?: boolean; requestedDate?: string },
  ) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!plotName) {
      setPestData(null);
      return;
    }

    const apiPlot = plotNameForApi(plotName);
    const requestedDate = options?.requestedDate ?? currentEndDate;
    const candidateDates = exactSelectedEndDate(requestedDate);
    if (!candidateDates.length) return;
    const endDate = candidateDates[0];
    const isStale = () => currentEndDateRef.current !== requestedDate;

    const applyPestSummary = (data: any) => {
      if (!data?.pixel_summary || !onPestDataChange) return;
      const ps = data.pixel_summary;
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
    };

    if (!forceRefresh) {
      const memKey = `pest:${apiPlot}:${endDate}`;
      if (layerTilesCacheRef.current.has(memKey)) {
        if (isStale()) return;
        const hit = layerTilesCacheRef.current.get(memKey) as any;
        setPestData(hit ?? null);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && hit?.features?.[0]?.geometry) {
          setPlotBoundary(hit.features[0]);
        }
        applyPestSummary(hit);
        return;
      }
      const sharedCached = getCache(`layer:pest:${apiPlot}:${endDate}`, 30 * 60 * 1000);
      if (sharedCached) {
        if (isStale()) return;
        layerTilesCacheRef.current.set(memKey, sharedCached);
        setPestData(sharedCached);
        if (!skipAnalysisBoundaryRef.current && !plotBoundary && sharedCached?.features?.[0]?.geometry) {
          setPlotBoundary(sharedCached.features[0]);
        }
        applyPestSummary(sharedCached);
        return;
      }
    } else {
      layerTilesCacheRef.current.delete(`pest:${apiPlot}:${endDate}`);
      removeCache(`layer:pest:${apiPlot}:${endDate}`);
      removeCache(`pestData_${apiPlot}`);
      removeCache(`pestData_${plotName}`);
    }

    try {
      const { data, endDate: apiEndDate } = await fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: apiPlot,
        layer: "PEST",
        candidateDates,
        forceRefresh,
      });
      if (isStale()) return;
      const memKey = `pest:${apiPlot}:${apiEndDate}`;
      layerTilesCacheRef.current.set(memKey, data);
      setPestData(data);
      if (!skipAnalysisBoundaryRef.current && !plotBoundary && (data as any)?.features?.[0]?.geometry) {
        setPlotBoundary((data as any).features[0]);
      }
      applyPestSummary(data);
    } catch (err: any) {
      if (isStale()) return;
      console.error("Error in fetchPestData:", {
        error: err,
        message: err?.message,
        plotName,
        endDate: requestedDate,
        candidateDates,
      });
      setPestData(null);
      if (isNoImageryError(err?.message)) {
        return;
      }
      let errorMessage = "Failed to fetch pest data";
      if (err?.message?.includes("Failed to fetch") || err?.name === "TypeError") {
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

  // Prefer saved/my-profile boundary; fall back to analysis API geometry.
  const profileBoundaryFeature = useMemo(() => {
    const feature = resolveSavedPlotBoundaryFeature(
      profile,
      selectedPlotName,
      optimisticProfileBoundary,
    );
    skipAnalysisBoundaryRef.current = !!feature?.geometry;
    return feature;
  }, [
    profile,
    selectedPlotName,
    profileBoundaryRevision,
    optimisticProfileBoundary,
  ]);

  useEffect(() => {
    if (profileBoundaryFeature?.geometry) {
      setPlotBoundary(null);
    }
  }, [profileBoundaryFeature, selectedPlotName]);

  useEffect(() => {
    if (!optimisticProfileBoundary) return;
    const fromProfile = resolveSavedPlotBoundaryFeature(
      profile,
      selectedPlotName,
    );
    if (
      fromProfile?.geometry &&
      boundariesMatch(optimisticProfileBoundary, fromProfile.geometry)
    ) {
      setOptimisticProfileBoundary(null);
    }
  }, [profile, selectedPlotName, optimisticProfileBoundary, profileBoundaryRevision]);

  const currentPlotFeature =
    profileBoundaryFeature ?? plotBoundary ?? plotData?.features?.[0];

  // Analysis API tiles may still follow the *pre-edit* shape until Admin regenerates.
  // Clip tiles to the saved (yellow) boundary so old green cannot sit on the wrong field.
  const activeLayerFeature = useMemo(() => {
    if (activeLayer === "Growth") return growthData?.features?.[0] ?? null;
    if (activeLayer === "Water Uptake") return waterUptakeData?.features?.[0] ?? null;
    if (activeLayer === "Soil Moisture") return soilMoistureData?.features?.[0] ?? null;
    if (activeLayer === "PEST") return pestData?.features?.[0] ?? null;
    return null;
  }, [activeLayer, growthData, waterUptakeData, soilMoistureData, pestData]);

  const analysisFeature =
    activeLayerFeature ??
    plotBoundary ??
    plotData?.features?.[0] ??
    growthData?.features?.[0] ??
    waterUptakeData?.features?.[0] ??
    soilMoistureData?.features?.[0] ??
    pestData?.features?.[0] ??
    null;

  const savedBoundaryGeometry = (profileBoundaryFeature?.geometry ??
    null) as GeoJsonPolygon | null;
  const analysisGeometry = (analysisFeature?.geometry ??
    null) as GeoJsonPolygon | null;

  const analysisStaleVsSaved = useMemo(
    () => isAnalysisGeometryStale(savedBoundaryGeometry, analysisGeometry),
    [savedBoundaryGeometry, analysisGeometry],
  );

  useEffect(() => {
    if (!layersUpdatingAfterEdit) return;
    if (savedBoundaryGeometry && analysisGeometry && !analysisStaleVsSaved) {
      setLayersUpdatingAfterEdit(false);
    }
  }, [
    layersUpdatingAfterEdit,
    savedBoundaryGeometry,
    analysisGeometry,
    analysisStaleVsSaved,
  ]);

  const shouldShowAnalysisOverlay = Boolean(activeUrl);
  const clipTilesToSavedBoundary = Boolean(savedBoundaryGeometry);

  const plotFitCoordinates = useMemo(() => {
    const ring =
      (profileBoundaryFeature ?? currentPlotFeature)?.geometry?.coordinates?.[0] ??
      analysisGeometry?.coordinates?.[0] ??
      null;
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring as number[][];
  }, [profileBoundaryFeature, currentPlotFeature, analysisGeometry]);

  const plotFitKey = `${selectedPlotName}|${currentEndDate}|${activeLayer}|${activeUrl ? "1" : "0"}|${plotFitNonce}`;

  const analysisTileKey = `${activeLayer}-layer-${layerChangeKey}-${selectedPlotName}-${currentEndDate}`;

  /**
   * Two-phase framing: stay wide until this layer's tiles are fully loaded, then
   * zoom to the plot so the overlay is never revealed half-painted.
   */
  const [loadedTileKey, setLoadedTileKey] = useState<string | null>(null);
  /** Tile URL not here yet, but the layer request is still running for this plot. */
  const waitingForLayerData =
    Boolean(selectedPlotName) &&
    !activeUrl &&
    (loading || dateNavigationLoading || layersUpdatingAfterEdit);
  const analysisOverlayReady = shouldShowAnalysisOverlay
    ? loadedTileKey === analysisTileKey
    : !waitingForLayerData;

  /** Base satellite readiness — without this the map flew in over blank tiles. */
  const baseTileLoadKey = `${selectedPlotName ?? "none"}|${plotFitNonce}`;
  const [loadedBaseTileKey, setLoadedBaseTileKey] = useState<string | null>(null);

  useEffect(() => {
    setLoadedBaseTileKey(null);
  }, [baseTileLoadKey]);

  const handleBaseTilesLoaded = useCallback(() => {
    setLoadedBaseTileKey(baseTileLoadKey);
  }, [baseTileLoadKey]);

  const baseTilesReady = loadedBaseTileKey === baseTileLoadKey;

  /** Never block the zoom forever if a tile request stalls. */
  const [tileWaitExpired, setTileWaitExpired] = useState(false);

  useEffect(() => {
    setTileWaitExpired(false);
    const timer = window.setTimeout(() => setTileWaitExpired(true), 8000);
    return () => window.clearTimeout(timer);
  }, [baseTileLoadKey, analysisTileKey]);

  const analysisTilesReady =
    tileWaitExpired || (baseTilesReady && analysisOverlayReady);

  useEffect(() => {
    setLoadedTileKey(null);
  }, [analysisTileKey]);

  const handleAnalysisTilesLoaded = useCallback(() => {
    setLoadedTileKey(analysisTileKey);
  }, [analysisTileKey]);

  const displayAreaAcres = useMemo(
    () =>
      resolveDisplayAreaAcres({
        plotBoundary: profileBoundaryFeature ?? plotBoundary,
        plotData,
        selectedPlotName,
        apiAreaAcres: apiFallbackAreaAcres,
      }),
    [
      profileBoundaryFeature,
      plotBoundary,
      plotData,
      selectedPlotName,
      apiFallbackAreaAcres,
    ],
  );

  // Only source left when the analysis feature has no area_acres: cached
  // agroStats, then a single analyzeSinglePlot call for this plot.
  useEffect(() => {
    if (!selectedPlotName?.trim()) {
      setApiFallbackAreaAcres(null);
      return;
    }

    const fromAgroStats = areaAcresFromAgroStatsCache(selectedPlotName);
    if (fromAgroStats != null) {
      setApiFallbackAreaAcres(fromAgroStats);
      return;
    }

    if (areaAcresFromFeature(plotBoundary ?? plotData?.features?.[0]) != null) {
      return;
    }

    const cacheKey = `mapPlotAreaAcres_${selectedPlotName}`;
    const cached = getCached(cacheKey) as { areaAcres?: number } | null;
    if (cached?.areaAcres != null && cached.areaAcres > 0) {
      setApiFallbackAreaAcres(cached.areaAcres);
      return;
    }

    let cancelled = false;
    const apiPlot = plotNameForApi(selectedPlotName);

    void getSinglePlotAgroStats(apiPlot)
      .then((data) => {
        if (cancelled) return;
        const acres = areaAcresFromApiRecord(data);
        if (acres != null) {
          setApiFallbackAreaAcres(acres);
          setCached(cacheKey, { areaAcres: acres });
        }
      })
      .catch(() => {
        // analyzeSinglePlot may fail when plantation date is missing
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlotName, plotBoundary, plotData, getCached, setCached]);

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
    let featureToUse =
      profileBoundaryFeature ?? plotBoundary ?? currentPlotFeature;
    
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
        key={`plot-border-${selectedPlotName}-${profileBoundaryFeature ? "profile" : plotBoundary ? "persistent" : "temp"}`}
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
        {layersUpdatingAfterEdit && (
          <div
            className="absolute left-1/2 top-3 z-[1000] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-center text-xs text-amber-900 shadow"
            role="status"
          >
            Updating map layers for the new plot boundary… Admin tiles can take a few minutes.
          </div>
        )}
        {/* Map-top controls (no background container) */}
        <div className="map-overlay map-overlay--left">
          <div className="layer-buttons">
            {(["Growth", "Water Uptake", "Soil Moisture", "PEST"] as const).map(
              (layer) => (
                <button
                  key={layer}
                  onClick={() => {
                    setActiveLayer(layer);
                    setLayerChangeKey((k) => k + 1);
                    setPlotFitNonce((n) => n + 1);
                  }}
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
                  const plotKey = plotKeyFromRecord(plot);
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
                    <option key={plotKey || plot.id} value={plotKey}>
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
                {LAYER_LOADING_MESSAGE[activeLayer] ??
                  LAYER_FETCH_ROTATION_MESSAGES[fetchRotationIndex]}
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

        {displayAreaAcres != null && (
          <div className="plot-info">
            <div className="plot-area">
              <span className="plot-area-value">
                {displayAreaAcres.toFixed(2)}{" "}
                {t("farmerDashboard.units.acre", { defaultValue: "acre" })}
              </span>
            </div>
          </div>
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
          zoom={PLOT_PRELOAD_MAX_ZOOM}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          maxZoom={22}
          minZoom={10}
        >
          <BaseSatelliteTileLayer
            url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            attribution="© Google"
            loadKey={baseTileLoadKey}
            onAllTilesLoaded={handleBaseTilesLoaded}
          />
          <MapResizeWhenVisible />

          {plotFitCoordinates && (
            <SetPlotOverviewZoom
              coordinates={plotFitCoordinates}
              refitKey={plotFitKey}
              tilesReady={analysisTilesReady}
            />
          )}

          {shouldShowAnalysisOverlay && (
            <Pane name="analysisOverlay" style={{ zIndex: 450 }}>
              <ClipAnalysisPaneToBoundary
                paneName="analysisOverlay"
                boundary={savedBoundaryGeometry}
                enabled={clipTilesToSavedBoundary}
              />
              <CustomTileLayer
                key={analysisTileKey}
                url={activeUrl ?? ""}
                opacity={0.85}
                tileKey={analysisTileKey}
                pane="analysisOverlay"
                onAllTilesLoaded={handleAnalysisTilesLoaded}
              />
            </Pane>
          )}

          {/* Legend pixels + yellow border ABOVE green analysis tiles (pane 450).
              Default overlay-pane is forced to z-index 100 in CSS, so without this
              the white pixel circles render under the tile layer and look invisible. */}
          {selectedLegendClass && (
            <Pane name="pixelOverlay" style={{ zIndex: 550 }}>
              {renderFilteredPixels()}
            </Pane>
          )}
          <Pane name="plotBorderOverlay" style={{ zIndex: 560 }}>
            {renderPlotBorder()}
          </Pane>
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
