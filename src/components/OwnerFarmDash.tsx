import React, { useState, useEffect, useRef } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ReferenceArea,
  Scatter,
  ComposedChart,
  BarChart,
  Bar,
} from "recharts";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Tooltip as LeafletTooltip,
  useMap,
  ImageOverlay,
  Pane,
} from "react-leaflet";
import {
  AlertTriangle,
  Loader2,
  Calendar,
  //Droplets,
  Sprout,
  Activity,
  Target,
  Leaf,
  BarChart3,
  // PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Users,
  MapPin,
  Beaker,
  // Crop,
  // Zap,
  // Clock,
  // Gauge,
  // Filter,
  // RefreshCw,
  Maximize2,
  Gauge,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./Map.css";
import axios from "axios";
import { getCache, setCache } from "../utils/cache";
import { fetchFieldScoreForPlot, fieldScoreCacheKey } from "../utils/fieldScore";
import {
  findPlotRef,
  getPlotNameCandidates,
  resolveApiPlotName,
} from "../utils/plotName";
import {
  buildAdminEndDateCandidates,
  fetchAdminLayerWithDateFallback,
} from "../utils/adminLayerApi";
import {
  fetchAnalysisTimeline,
  latestRebinDateForLayer,
  type AnalysisTimelineResponse,
} from "../services/analysisTimeline";
import { readStoredPlotImageEndDates } from "../utils/plotImageEndDates";
import MapCropStatusOverlay from "./MapCropStatusOverlay";
import FieldIndicesStageBadge from "./FieldIndicesStageBadge";
import { useFieldIndicesCropStage } from "../hooks/useFieldIndicesCropStage";
import { enrichPlotsWithFarmDetails } from "../utils/fertilizerStage";
import { fetchPlotBoundaryCoordinates } from "../utils/plotBoundary";
import {
  PLOT_BOUNDARY_UPDATED_EVENT,
  resolveLeafletBoundaryForPlotRecord,
} from "../utils/plotBoundarySync";
import {
  cropConditionStyleFromCci,
  fetchWaterStressAnalysis,
  parseWaterStressMetrics,
} from "../utils/waterStressApi";
import api, {
  encodePlotIdForEventsUrl,
  fetchAllOwnerFactoryBoundaryPlots,
  getCurrentUser,
  getFarmersByFieldOfficer,
  getFarmsByFarmerId,
  getFieldOfficerAgroStats,
  getOwnerFieldOfficersAgroStats,
  getSinglePlotAgroStats,
  getTeamConnect,
  isAnalyzeSinglePlotPlantationDateError,
  parseFarmersByFieldOfficerResponse,
  PLANTATION_DATE_NOT_PROVIDED_MSG,
  fetchDistrictTotalPlotArea,
  fetchOwnerDistrictsTotalPlotAreaSum,
  type OwnerDistrictsTotalPlotAreaSum,
  type DistrictTotalPlotAreaResponse,
} from "../api"; // Import the authenticated api instance + hierarchy helpers
import {
  buildFoMapPlotsFromAgroStats,
  buildFoMapPlotsFromOwnerBoundaries,
  factoryDashboardEndDate,
  factoryRecoveryComparisonBars,
  factoryRecoveryPeersFromRollup,
  fetchFactoriesOwnerDashboard,
  fetchFactoryOwnerDashboardById,
  fetchOwnerFactoriesDetailedDashboard,
  filterAgroStatsByOfficerIds,
  filterFoMapPlotsByFactoryId,
  formatFactoryCropStatusLabel,
  mergeFoMapPlots,
  resolveEventsFactoryId,
  type FactoryDashboardFactory,
  type FactoryTop25Farmer,
  type FoMapPlot,
} from "../utils/factoryOwnerDashboard";
import {
  agricultureAnalysisBaseUrl,
  agricultureAnalysisHttp,
  agricultureAnalysisUrl,
} from "../utils/agricultureAnalysisApi";
import { resolveProgressOwnerId } from "./progressbar/useFactoryProgress";
import { LatLngBounds } from "leaflet";

// Comprehensive Agriculture Analysis API (Events Railway; Vite proxy in DEV)
const BASE_URL = "https://events-cropeye.up.railway.app";

/** indices / stress / irrigation on this host are often slow; 10s caused AbortController + axios to cancel (Network shows "(canceled)" ~10s). */
const OWNER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS = 90_000;

const OTHER_FARMERS_RECOVERY = {
  regional_average: 7.85,
  top_quartile: 8.52,
  bottom_quartile: 6.58,
  similar_farms: 7.63,
};

function extractAdminTileUrl(data: unknown): string | null {
  const d = data as Record<string, any> | null | undefined;
  const candidates = [
    d?.features?.[0]?.properties?.tile_url,
    d?.features?.[0]?.properties?.tileURL,
    d?.features?.[0]?.properties?.tileServerUrl,
    d?.features?.[0]?.properties?.tiles,
    d?.properties?.tile_url,
    d?.tile_url,
    d?.tileURL,
    d?.tileServerUrl,
  ].filter(Boolean);

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === "string") {
      return c[0];
    }
    if (typeof c === "string") return c;
  }
  return null;
}

function isXyzTileTemplate(url: string): boolean {
  return url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
}

function isStoredAnalysisPngUrl(url: string): boolean {
  if (!url || isXyzTileTemplate(url)) return false;
  if (/\.png(\?|#|$)/i.test(url)) return true;
  return /^https?:\/\//i.test(url);
}

function boundsFromLeafletPositions(
  positions: [number, number][],
): LatLngBounds | null {
  if (!positions?.length) return null;
  try {
    const bounds = new LatLngBounds(positions);
    return bounds.isValid() ? bounds : null;
  } catch {
    return null;
  }
}

/**
 * Clip Growth tiles/PNG to the FO plot outline so green fills the full white
 * border (same idea as Map ClipAnalysisPaneToBoundary).
 * positions are Leaflet [lat, lng].
 */
function ClipOwnerGrowthPane({
  paneName,
  positions,
  enabled,
}: {
  paneName: string;
  positions: [number, number][];
  enabled: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const apply = () => {
      const pane = map.getPane(paneName);
      if (!pane) return;

      pane.style.overflow = "visible";
      pane.style.pointerEvents = "none";
      pane.style.zIndex = "450";

      if (!enabled || !positions || positions.length < 3) {
        pane.style.clipPath = "";
        (pane.style as any).webkitClipPath = "";
        return;
      }

      const points: string[] = [];
      for (const pt of positions) {
        const lat = Number(pt[0]);
        const lng = Number(pt[1]);
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
  }, [map, paneName, positions, enabled]);

  return null;
}

function ownerGrowthDateCandidates(
  plotName: string,
  timeline: AnalysisTimelineResponse["timeline"] | undefined,
): string[] {
  const fromApi = buildAdminEndDateCandidates(plotName, "Growth", timeline);
  if (fromApi.length) return fromApi;

  const days: string[] = [];
  const push = (d: string | undefined | null) => {
    const day = String(d || "")
      .trim()
      .split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    if (!days.includes(day)) days.push(day);
  };

  const stored = readStoredPlotImageEndDates(plotName);
  push(stored?.verified?.growth);
  push(stored?.growth);
  push(stored?.overall);
  push(latestRebinDateForLayer(timeline, "Growth"));

  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 5);
    push(d.toISOString().split("T")[0]);
  }
  return days.slice(0, 5);
}

/** User-facing errors: never expose URLs, hosts, or API paths. */
function toSafeUserError(message: unknown): string {
  const raw = String(message ?? "").trim();
  if (!raw) return "Something went wrong. Please try again.";
  if (
    /https?:\/\//i.test(raw) ||
    /\/(factories|plots|api|field-officers)\b/i.test(raw) ||
    /\.(railway\.app|ngrok|cloudflare|trycloudflare)/i.test(raw) ||
    /owner_id=|end_date=|factory_id=/i.test(raw)
  ) {
    return "Unable to load data right now. Please try again.";
  }
  return raw;
}

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
  fieldScore: number | null;
  expectedYield: number | null;
  daysToHarvest: number | null;
  growthStage: string | null;
  soilPH: number | null;
  organicCarbonDensity: number | null;
  actualYield: number | null;
  cnRatio: number | null;
  sugarYieldMax: number | null;
  sugarYieldMin: number | null;
  plantationDate: string | null;
  plantationType: string | null;
}

interface PieChartWithNeedleProps {
  value: number;
  max: number;
  width?: number;
  height?: number;
  title?: string;
  unit?: string;
  showTitle?: boolean;
}

const GAUGE_CHART_HEIGHT = 168;
const GAUGE_ARC_WIDTH = 240;

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
      source.planted_on ??
      source.date_of_plantation ??
      source.crop_type?.plantation_date ??
      source.crop_type?.planting_date ??
      source.farms?.[0]?.plantation_date ??
      source.farms?.[0]?.crop_type?.plantation_date,
  );

  const plantationTypeRaw =
    source.plantation_type_display ??
    source.plantation_type ??
    source.planting_method ??
    source.planting_method_display ??
    source.crop_type?.planting_method ??
    source.crop_type?.planting_method_display ??
    source.crop_type?.plantation_type_display ??
    source.crop_type?.plantation_type ??
    source.farms?.[0]?.plantation_type ??
    source.farms?.[0]?.crop_type?.plantation_type ??
    source.farms?.[0]?.crop_type?.planting_method;

  return {
    plantationDate,
    plantationType: plantationTypeRaw ? String(plantationTypeRaw) : null,
  };
}

/** team-connect returns `created_by` like "karnataka_manager_1 (manager)" without numeric manager_id on FOs */
function parseCreatedByUsername(createdBy: unknown): string | null {
  if (typeof createdBy !== "string" || !createdBy.trim()) return null;
  const match = createdBy.trim().match(/^(\S+)/);
  return match ? match[1].toLowerCase() : null;
}

/** Candidate industry/factory ids from a manager row (may be owner_id � validate later). */
function factoryIdCandidatesFromManager(manager: any): string[] {
  const raw = [
    manager?.industry_id,
    manager?.industry?.industry_id,
    manager?.industry?.id,
    manager?.factory_id,
    manager?.factory?.id,
  ];
  const out: string[] = [];
  for (const value of raw) {
    if (value == null || value === "") continue;
    const n = Number(value);
    const id =
      Number.isFinite(n) && n > 0
        ? String(Math.trunc(n))
        : String(value).trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function nestedOfficerIdsFromManager(manager: any): string[] {
  const nested = Array.isArray(manager?.field_officers)
    ? manager.field_officers
    : [];
  return nested
    .map((fo: any) => String(fo?.id ?? fo?.user_id ?? "").trim())
    .filter(Boolean);
}

/**
 * Map manager/industry ? Events factory id for GET /factories/{id}/dashboard.
 * Never use Django owner_id / manager user id (those 404 on the Events API).
 */
async function resolveFactoryIdForManagerSelection(
  ownerId: string,
  endDate: string,
  manager: any,
  fieldOfficerId: string,
  managerOfficerIds: string[] = [],
): Promise<{ factoryId: string; list: Awaited<ReturnType<typeof fetchFactoriesOwnerDashboard>> }> {
  const list = await fetchFactoriesOwnerDashboard(ownerId, endDate);
  const fieldOfficerIds = [
    fieldOfficerId.trim(),
    ...managerOfficerIds,
    ...nestedOfficerIdsFromManager(manager),
  ].filter(Boolean);

  const factoryId = resolveEventsFactoryId({
    list,
    candidateIds: factoryIdCandidatesFromManager(manager),
    fieldOfficerIds,
  });

  return { factoryId, list };
}

function officerIdsForManager(
  managerId: string,
  managers: any[],
  fieldOfficers: any[],
): Set<string> {
  const selectedManager = managers.find(
    (m) => String(m?.id ?? m?.user_id) === String(managerId),
  );
  return new Set(
    fieldOfficers
      .filter((fo: any) => {
        const mid = fo?.manager_id ?? fo?.manager?.id ?? fo?.managerId;
        if (mid != null && String(mid) === String(managerId)) return true;
        if (!selectedManager) return false;
        const creatorUsername = parseCreatedByUsername(fo?.created_by);
        const managerUsername = `${selectedManager?.username ?? ""}`
          .trim()
          .toLowerCase();
        return (
          !!creatorUsername &&
          !!managerUsername &&
          creatorUsername === managerUsername
        );
      })
      .map((fo: any) => String(fo?.id ?? fo?.user_id))
      .filter(Boolean),
  );
}

function enrichFieldOfficersWithManagerIds(
  fieldOfficers: any[],
  managers: any[],
): any[] {
  const managersByUsername = new Map<string, any>();
  for (const m of managers || []) {
    const username = `${m?.username ?? ""}`.trim().toLowerCase();
    if (username) managersByUsername.set(username, m);
  }

  return (fieldOfficers || []).map((fo) => {
    let managerId =
      fo?.manager_id ??
      fo?.manager?.id ??
      fo?.managerId ??
      fo?.manager_id_number ??
      null;

    if (managerId == null) {
      const creatorUsername = parseCreatedByUsername(fo?.created_by);
      const mgr = creatorUsername
        ? managersByUsername.get(creatorUsername)
        : null;
      if (mgr) managerId = mgr?.id ?? mgr?.user_id ?? null;
    }

    if (managerId == null && fo?.username) {
      const foUsername = `${fo.username}`.toLowerCase();
      for (const [mgrUsername, mgr] of managersByUsername) {
        if (foUsername.includes(mgrUsername)) {
          managerId = mgr?.id ?? mgr?.user_id ?? null;
          break;
        }
      }
    }

    return { ...fo, manager_id: managerId };
  });
}

function countFieldOfficersForManager(
  manager: any,
  fieldOfficers: any[],
): number {
  const managerId = manager?.id ?? manager?.user_id ?? null;
  const managerUsername = `${manager?.username ?? ""}`.trim().toLowerCase();

  return (fieldOfficers || []).filter((fo) => {
    const foManagerId =
      fo?.manager_id ?? fo?.manager?.id ?? fo?.managerId ?? null;
    if (
      managerId != null &&
      foManagerId != null &&
      String(foManagerId) === String(managerId)
    ) {
      return true;
    }
    const creatorUsername = parseCreatedByUsername(fo?.created_by);
    return (
      !!managerUsername &&
      !!creatorUsername &&
      creatorUsername === managerUsername
    );
  }).length;
}

function normalizeManagersWithFoCounts(
  managers: any[],
  fieldOfficers: any[],
): any[] {
  return (managers || []).map((m) => {
    const count = countFieldOfficersForManager(m, fieldOfficers);
    return {
      ...m,
      field_officers_count:
        m?.field_officers_count ?? m?.fieldOfficersCount ?? count,
    };
  });
}

function farmerBelongsToFieldOfficer(farmer: any, officer: any): boolean {
  const officerId = officer?.id ?? officer?.user_id ?? null;
  const officerUsername = `${officer?.username ?? ""}`.trim().toLowerCase();

  const farmerFoId =
    farmer?.field_officer_id ??
    farmer?.field_officer?.id ??
    farmer?.fieldOfficerId ??
    null;
  if (
    officerId != null &&
    farmerFoId != null &&
    String(farmerFoId) === String(officerId)
  ) {
    return true;
  }

  const creatorUsername = parseCreatedByUsername(farmer?.created_by);
  return (
    !!officerUsername &&
    !!creatorUsername &&
    creatorUsername === officerUsername
  );
}

function getFarmersForFieldOfficer(officer: any, allFarmers: any[]): any[] {
  const nested = officer?.farmers;
  if (Array.isArray(nested) && nested.length > 0) return nested;
  return (allFarmers || []).filter((f) =>
    farmerBelongsToFieldOfficer(f, officer),
  );
}

function enrichFieldOfficersWithFarmers(
  fieldOfficers: any[],
  farmers: any[],
): any[] {
  return (fieldOfficers || []).map((fo) => {
    const foFarmers = getFarmersForFieldOfficer(fo, farmers);
    return {
      ...fo,
      farmers: foFarmers,
      farmers_count: foFarmers.length,
    };
  });
}

function getFarmerId(farmer: any): string | null {
  const id =
    farmer?.id ?? farmer?.farmer_id ?? farmer?.farmerId ?? farmer?.user_id ?? null;
  return id != null ? String(id) : null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/** Events API plot_name format: `{gat_number}_{plot_number}` e.g. `27_6`. */
function buildGatPlotName(record: any): string | null {
  if (!record || typeof record !== "object") return null;

  const gatRaw =
    record?.gat_number ??
    record?.Group_Gat_No ??
    record?.GroupGatNo ??
    record?.group_gat_no ??
    "";
  const plotRaw =
    record?.plot_number ??
    record?.Gat_No_Id ??
    record?.GatNoId ??
    record?.gat_no_id ??
    "";

  const gat = `${gatRaw}`.trim();
  const plotNum = `${plotRaw}`.trim();
  const gatOk = /^\d+$/.test(gat);
  const plotOk = /^\d+$/.test(plotNum);

  if (gatOk && plotOk) {
    return `${gat}_${plotNum}`;
  }
  return null;
}

function normalizePlotFromFieldOfficer(plot: any, farmer?: any): any | null {
  const fastapiId =
    plot?.fastapi_plot_id != null && `${plot.fastapi_plot_id}`.trim() !== ""
      ? String(plot.fastapi_plot_id).trim()
      : null;
  const gatPlot = buildGatPlotName(plot);
  const plotKey = fastapiId ?? gatPlot;
  if (!plotKey) return null;

  return {
    ...plot,
    id: plot?.id ?? plotKey,
    fastapi_plot_id: plotKey,
    events_plot_id: plotKey,
    plot_id: plot?.plot_id ?? plotKey,
    plot_name: plotKey,
    boundary:
      plot?.boundary ??
      plot?.coordinates?.boundary ??
      plot?.plot?.boundary,
    coordinates: plot?.coordinates,
    farmer,
  };
}

function plotsFromFieldOfficerFarmer(farmer: any): any[] {
  if (!farmer) return [];
  const rawPlots = farmer?.plots ?? farmer?.plot_list ?? [];
  if (!Array.isArray(rawPlots) || rawPlots.length === 0) return [];

  const normalized = rawPlots
    .map((plot: any) => normalizePlotFromFieldOfficer(plot, farmer))
    .filter((plot): plot is any => plot != null && !!plot.fastapi_plot_id);

  return dedupePlotRecords(normalized);
}

async function loadPlotsFromFieldOfficerApi(
  fieldOfficerId: string,
  farmerId: string,
): Promise<{ farmer: any | null; plots: any[] }> {
  const res = await getFarmersByFieldOfficer(fieldOfficerId);
  const farmers = parseFarmersByFieldOfficerResponse(res?.data);
  const farmer =
    farmers.find((f: any) => getFarmerId(f) === String(farmerId)) ?? null;
  const plots = plotsFromFieldOfficerFarmer(farmer);
  return { farmer, plots };
}

/** Events/FastAPI plot key � `{gat_number}_{plot_number}`, not username or farm_uid. */
function resolveEventsPlotId(farm: any, _farmerCtx?: any): string | null {
  const fromFarm = buildGatPlotName(farm);
  if (fromFarm) return fromFarm;

  if (farm?.plot && typeof farm.plot === "object") {
    const fromPlot = buildGatPlotName(farm.plot);
    if (fromPlot) return fromPlot;
  }

  if (Array.isArray(farm?.plots)) {
    for (const plot of farm.plots) {
      const fromNested = buildGatPlotName(plot);
      if (fromNested) return fromNested;
    }
  }

  const named = farm?.fastapi_plot_id ?? farm?.plot_name ?? null;
  if (named && !isUuidLike(String(named))) {
    const plotName = String(named).trim();
    if (/^\d+_\d+$/.test(plotName)) return plotName;
  }

  return null;
}

function farmRecordToPlot(farm: any, farmerCtx?: any): any {
  const eventsPlotId = resolveEventsPlotId(farm, farmerCtx);
  const farmUid = farm?.farm_uid ?? null;
  return {
    ...farm,
    id: farm?.id ?? eventsPlotId ?? farmUid,
    farm_uid: farmUid,
    events_plot_id: eventsPlotId,
    fastapi_plot_id: eventsPlotId,
    plot_id: farm?.plot_id ?? eventsPlotId,
    plot_name: eventsPlotId,
    boundary:
      farm?.boundary ??
      farm?.coordinates?.boundary ??
      farm?.plot?.boundary ??
      farm?.plot?.coordinates?.boundary,
    coordinates: farm?.coordinates,
  };
}

function normalizePlotRecord(plot: any, farmer?: any): any {
  const eventsPlotId =
    resolveEventsPlotId(plot, farmer) ??
    (plot?.fastapi_plot_id && !isUuidLike(String(plot.fastapi_plot_id))
      ? String(plot.fastapi_plot_id)
      : null);
  return {
    ...plot,
    id: plot?.id ?? eventsPlotId,
    events_plot_id: eventsPlotId,
    fastapi_plot_id: eventsPlotId,
    plot_id: plot?.plot_id ?? eventsPlotId,
    plot_name: eventsPlotId,
    boundary:
      plot?.boundary ??
      plot?.coordinates?.boundary ??
      plot?.plot?.boundary,
    coordinates: plot?.coordinates,
  };
}

function extractPlotsFromFarmer(farmer: any): any[] {
  const fromFieldOfficer = plotsFromFieldOfficerFarmer(farmer);
  if (fromFieldOfficer.length > 0) return fromFieldOfficer;

  if (Array.isArray(farmer?.plots) && farmer.plots.length > 0) {
    return farmer.plots.map((plot: any) => normalizePlotRecord(plot, farmer));
  }
  if (Array.isArray(farmer?.farms) && farmer.farms.length > 0) {
    return farmer.farms.map((farm: any) => farmRecordToPlot(farm));
  }
  if (farmer?.farm && typeof farmer.farm === "object") {
    return [farmRecordToPlot(farmer.farm)];
  }
  if (Array.isArray(farmer?.plot_ids) && farmer.plot_ids.length > 0) {
    return farmer.plot_ids.map((plotId: any) =>
      normalizePlotRecord({ id: plotId, fastapi_plot_id: String(plotId) }, farmer),
    );
  }
  return [];
}

function parseFarmsListResponse(data: any): any[] {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function dedupePlotRecords(records: any[]): any[] {
  const seenPlotKeys = new Set<string>();
  const seenFarmIds = new Set<string>();
  const unique: any[] = [];

  for (const record of records || []) {
    const plotKey =
      (record?.fastapi_plot_id && String(record.fastapi_plot_id).trim()) ||
      resolveEventsPlotId(record) ||
      buildGatPlotName(record);
    if (plotKey) {
      if (seenPlotKeys.has(plotKey)) continue;
      seenPlotKeys.add(plotKey);
      unique.push(record);
      continue;
    }

    const farmKey =
      record?.id != null
        ? `farm_${record.id}`
        : record?.farm_uid
          ? String(record.farm_uid)
          : "";
    if (farmKey) {
      if (seenFarmIds.has(farmKey)) continue;
      seenFarmIds.add(farmKey);
    }
    unique.push(record);
  }

  return unique;
}

function boundaryToLeafletCoords(boundary: any): [number, number][] {
  const coordsList = boundary?.coordinates;
  if (!coordsList || !Array.isArray(coordsList) || coordsList.length === 0) {
    return [];
  }
  const ring = coordsList[0];
  if (!Array.isArray(ring)) return [];
  return ring
    .filter((pt) => Array.isArray(pt) && pt.length >= 2)
    .map(([lng, lat]: [number, number]) => [lat, lng]);
}

function applyLeafletCoords(
  coords: [number, number][],
  setPlotCoordinates: React.Dispatch<
    React.SetStateAction<[number, number][]>
  >,
  setMapCenter: React.Dispatch<React.SetStateAction<[number, number]>>,
  _setMapKey?: React.Dispatch<React.SetStateAction<number>>,
): boolean {
  if (coords.length === 0) return false;
  setPlotCoordinates(coords);
  setMapCenter(calculateCenterFromCoords(coords));
  // Do not remount MapContainer here � causes "Map container is already initialized".
  // Center/polygon updates via MapAutoCenter + children instead.
  return true;
}

function calculateCenterFromCoords(
  coords: [number, number][],
): [number, number] {
  if (coords.length === 0) return [17.5789, 75.053];
  const sumLat = coords.reduce((sum, [lat]) => sum + lat, 0);
  const sumLng = coords.reduce((sum, [, lng]) => sum + lng, 0);
  return [sumLat / coords.length, sumLng / coords.length];
}

const OwnerFarmDash: React.FC = () => {
  // const center: [number, number] = [17.5789, 75.053]; // Unused - using mapCenter state instead
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  // Farmer and Plot selection state
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [selectedFieldOfficerId, setSelectedFieldOfficerId] =
    useState<string>("");
  const [selectedFarmerId, setSelectedFarmerId] = useState<string>("");
  const [selectedPlotId, setSelectedPlotId] = useState<string>(""); // Start empty, will be set based on farmer selection
  const selectedPlotIdRef = useRef<string>("");
  const selectedFarmerIdRef = useRef<string>("");
  const [managers, setManagers] = useState<any[]>([]);
  const [fieldOfficers, setFieldOfficers] = useState<any[]>([]);
  // Raw field officers list (used to filter per selected manager).
  const [teamFieldOfficersRaw, setTeamFieldOfficersRaw] = useState<any[]>([]);
  const [teamFarmersRaw, setTeamFarmersRaw] = useState<any[]>([]);
  const [farmerPlotsCache, setFarmerPlotsCache] = useState<
    Record<string, any[]>
  >({});
  const [farmersForSelectedOfficer, setFarmersForSelectedOfficer] = useState<
    any[]
  >([]);
  const [plots, setPlots] = useState<string[]>([]);
  const [loadingHierarchy, setLoadingHierarchy] = useState<boolean>(true);
  const [loadingFarmersForOfficer, setLoadingFarmersForOfficer] =
    useState<boolean>(false);
  const [loadingFarmerPlots, setLoadingFarmerPlots] = useState<boolean>(false);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [plotStatsError, setPlotStatsError] = useState<string | null>(null);
  const [showDebugInfo] = useState(false);
  const [loadingSections, setLoadingSections] = useState<{
    plotStats: boolean;
    indices: boolean;
    stress: boolean;
    waterStress: boolean;
    irrigation: boolean;
  }>({
    plotStats: false,
    indices: false,
    stress: false,
    waterStress: false,
    irrigation: false,
  });

  const isFarmerDataLoading =
    loadingSections.plotStats ||
    loadingSections.indices ||
    loadingSections.stress ||
    loadingSections.waterStress ||
    loadingSections.irrigation;

  // Keep existing UI bindings (cards already check `loadingData`)
  useEffect(() => {
    setLoadingData(isFarmerDataLoading);
  }, [isFarmerDataLoading]);

  const lineStyles: LineStyles = {
    growth: { color: "#22c55e", label: "Growth Index" },
    stress: { color: "#ef4444", label: "Stress Index" },
    water: { color: "#3b82f6", label: "Water Index" },
    moisture: { color: "#f59e0b", label: "Moisture Index" },
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
    fieldScore: null,
    expectedYield: null,
    daysToHarvest: null,
    growthStage: null,
    soilPH: null,
    organicCarbonDensity: null,
    actualYield: null,
    cnRatio: null,
    sugarYieldMax: null,
    sugarYieldMin: null,
    plantationDate: null,
    plantationType: null,
  });

  const [stressEvents, setStressEvents] = useState<StressEvent[]>([]);
  const [showStressEvents] = useState<boolean>(false);
  const [ndreStressEvents, setNdreStressEvents] = useState<StressEvent[]>([]);
  const [showNDREEvents] = useState<boolean>(false);
  const [combinedChartData, setCombinedChartData] = useState<LineChartData[]>(
    [],
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("yearly");
  const [aggregatedData, setAggregatedData] = useState<LineChartData[]>([]);

  // Mobile layout flag for charts
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [mapKey, setMapKey] = useState<number>(0);
  const [mapCenter, setMapCenter] = useState<[number, number]>([
    17.5789, 75.053,
  ]);
  const [plotCoordinatesCache, setPlotCoordinatesCache] = useState<
    Map<string, [number, number][]>
  >(new Map());
  /** Logged-in / configured factory owner id for GET /factories/dashboard?owner_id= */
  const [dashboardOwnerId, setDashboardOwnerId] = useState<string>("");
  const [loadingFactoryDash, setLoadingFactoryDash] = useState(false);
  const [factoryRollup, setFactoryRollup] =
    useState<FactoryDashboardFactory | null>(null);

  // Owner total area (all districts) — shown when no manager selected
  const [ownerDistrictsAreaSum, setOwnerDistrictsAreaSum] =
    useState<OwnerDistrictsTotalPlotAreaSum | null>(null);
  // Manager-selected district area
  const [districtAreaData, setDistrictAreaData] =
    useState<DistrictTotalPlotAreaResponse | null>(null);
  const [districtAreaLoading, setDistrictAreaLoading] = useState(false);
  const [foMapPlots, setFoMapPlots] = useState<FoMapPlot[]>([]);
  /** Backend Growth PNG/XYZ from analyze_Growth (same as Map page). */
  const [growthOverlayUrl, setGrowthOverlayUrl] = useState<string | null>(null);
  const [growthOverlayBounds, setGrowthOverlayBounds] =
    useState<LatLngBounds | null>(null);
  const growthOverlayRequestRef = useRef(0);
  const [factoryRecoveryPeers, setFactoryRecoveryPeers] = useState<{
    factoryAvg: number | null;
    top25Avg: number | null;
    similarPct: number | null;
    topFarmerAvg: number | null;
    topFarmers: FactoryTop25Farmer[];
  } | null>(null);
  const hierarchyRequestIdRef = useRef<number>(0);
  const prevFieldOfficerIdRef = useRef<string>("");
  const lastFetchedFarmerIdRef = useRef<string>("");
  const dashboardLoadedForPlotRef = useRef<string>("");
  const farmerFetchGenRef = useRef(0);
  const factoryDashRequestIdRef = useRef(0);
  /** Cache FO agroStats so fetchAllData can look up a plot without calling analyzeSinglePlot. */
  const foAgroStatsRef = useRef<Record<string, any> | null>(null);

  const selectedFarmerForUi =
    farmersForSelectedOfficer.find(
      (f: any) => getFarmerId(f) === String(selectedFarmerId),
    ) ?? null;

  const selectedFarmerNameForUi =
    selectedFarmerForUi?.name ??
    selectedFarmerForUi?.full_name ??
    selectedFarmerForUi?.fullName ??
    selectedFarmerForUi?.username ??
    (selectedFarmerId ? `Farmer ${selectedFarmerId}` : "Farmer");

  /** Stable key so loading managers does not cancel an in-flight owner dashboard. */
  const selectedManagerForDash = selectedManagerId
    ? managers.find(
        (m) => String(m?.id ?? m?.user_id) === String(selectedManagerId),
      )
    : null;
  const managerDashKey = selectedManagerId
    ? String(
        selectedManagerForDash?.industry_id ??
          selectedManagerForDash?.factory_id ??
          selectedManagerForDash?.industry?.id ??
          (managers.length ? "none" : "wait"),
      )
    : "owner-all";

  // Fetch farmers list on component mount
  useEffect(() => {
    fetchOwnerHierarchy();
  }, []);

  // Owner total area — fetch once on mount (all districts, no manager filter)
  useEffect(() => {
    let cancelled = false;
    fetchOwnerDistrictsTotalPlotAreaSum()
      .then((sum) => { if (!cancelled) setOwnerDistrictsAreaSum(sum); })
      .catch(() => { if (!cancelled) setOwnerDistrictsAreaSum(null); });
    return () => { cancelled = true; };
  }, []);

  // Manager-selected district area
  useEffect(() => {
    if (!selectedManagerId) {
      setDistrictAreaData(null);
      return;
    }
    const selManager = managers.find(
      (m) => String(m.id ?? m.user_id) === String(selectedManagerId),
    );
    const district = String(
      selManager?.district || selManager?.factory_name || "",
    ).trim();
    if (!district) {
      setDistrictAreaData(null);
      return;
    }
    let cancelled = false;
    setDistrictAreaLoading(true);
    fetchDistrictTotalPlotArea(district)
      .then((data) => { if (!cancelled) setDistrictAreaData(data); })
      .catch(() => { if (!cancelled) setDistrictAreaData(null); })
      .finally(() => { if (!cancelled) setDistrictAreaLoading(false); });
    return () => { cancelled = true; };
  }, [selectedManagerId, managers]);

  // Keep refs so async boundary refresh targets the latest selection.
  useEffect(() => {
    selectedPlotIdRef.current = selectedPlotId;
  }, [selectedPlotId]);

  useEffect(() => {
    selectedFarmerIdRef.current = selectedFarmerId;
  }, [selectedFarmerId]);

  const applyCoordinatesFromPlot = (plot: any, plotKey?: string): boolean => {
    const coords = resolveLeafletBoundaryForPlotRecord(
      plot,
      plotKey ?? plot?.fastapi_plot_id ?? plot?.plot_id ?? plot?.id,
    );
    if (coords.length > 0) {
      return applyLeafletCoords(
        coords,
        setPlotCoordinates,
        setMapCenter,
        setMapKey,
      );
    }

    const legacy = boundaryToLeafletCoords(
      plot?.boundary ?? plot?.coordinates?.boundary,
    );
    return applyLeafletCoords(
      legacy,
      setPlotCoordinates,
      setMapCenter,
      setMapKey,
    );
  };

  const findPlotInSelection = (plotId: string): any | null => {
    const farmer = farmersForSelectedOfficer.find(
      (f) => getFarmerId(f) === String(selectedFarmerId),
    );
    if (!farmer) return null;
    const allPlots = extractPlotsFromFarmer(farmer);
    return findPlotRef(allPlots, plotId) ?? null;
  };

  const selectedPlotPlantation = React.useMemo(() => {
    if (!selectedPlotId) {
      return { plantationDate: null, plantationType: null };
    }
    return extractPlantationInfo(findPlotInSelection(selectedPlotId));
  }, [selectedPlotId, selectedFarmerId, farmersForSelectedOfficer]);

  const selectedFarmerForStage = React.useMemo(
    () =>
      farmersForSelectedOfficer.find(
        (item) => getFarmerId(item) === String(selectedFarmerId),
      ) ?? null,
    [farmersForSelectedOfficer, selectedFarmerId],
  );

  const selectedPlotRecordForStage = React.useMemo(() => {
    if (!selectedPlotId || !selectedFarmerId) return null;

    const cachedPlots = farmerPlotsCache[String(selectedFarmerId)] ?? [];
    const fromCache = findPlotRef(cachedPlots, selectedPlotId);
    const fromFarmer = findPlotInSelection(selectedPlotId);
    return fromCache ?? fromFarmer;
  }, [
    selectedPlotId,
    selectedFarmerId,
    farmerPlotsCache,
    farmersForSelectedOfficer,
  ]);

  // Prefer Django /farms/ edited KML once enrichment completes (over stale Events polygon).
  useEffect(() => {
    if (!selectedPlotId || !selectedPlotRecordForStage) return;
    const savedCoords = resolveLeafletBoundaryForPlotRecord(
      selectedPlotRecordForStage,
      selectedPlotId,
    );
    if (savedCoords.length < 3) return;

    applyLeafletCoords(
      savedCoords,
      setPlotCoordinates,
      setMapCenter,
      setMapKey,
    );
    setPlotCoordinatesCache((prev) => new Map(prev.set(selectedPlotId, savedCoords)));
  }, [selectedPlotRecordForStage, selectedPlotId]);

  const currentCropStage = useFieldIndicesCropStage(
    selectedPlotRecordForStage,
    selectedFarmerForStage,
    selectedPlotId,
    selectedFarmerId,
  );

  const displayPlantationDate =
    selectedPlotPlantation.plantationDate ?? metrics.plantationDate;
  const displayPlantationType =
    selectedPlotPlantation.plantationType ?? metrics.plantationType;

  // Update field officers dropdown when manager changes
  useEffect(() => {
    if (!selectedManagerId) {
      setFieldOfficers([]);
      // Do not reset FO/farmer on every hierarchy refresh � that re-fires factory fetch
      // and can drop owner totals while the slow dashboard request is in flight.
      if (selectedFieldOfficerId) {
        setSelectedFieldOfficerId("");
        setFarmersForSelectedOfficer([]);
        setSelectedFarmerId("");
        setPlots([]);
        setSelectedPlotId("");
      }
      return;
    }

    const selectedManager = managers.find(
      (m) => String(m?.id ?? m?.user_id) === String(selectedManagerId),
    );
    const filtered = teamFieldOfficersRaw.filter((fo: any) => {
      const mid =
        fo?.manager_id ??
        fo?.manager?.id ??
        fo?.managerId ??
        fo?.manager_id;
      if (mid != null && String(mid) === String(selectedManagerId)) {
        return true;
      }
      if (!selectedManager) return false;
      const creatorUsername = parseCreatedByUsername(fo?.created_by);
      const managerUsername = `${selectedManager?.username ?? ""}`
        .trim()
        .toLowerCase();
      return (
        !!creatorUsername &&
        !!managerUsername &&
        creatorUsername === managerUsername
      );
    });

    setFieldOfficers(filtered);
    // Step-by-step: do not auto-select field officer
    setSelectedFieldOfficerId("");
    setFarmersForSelectedOfficer([]);
    setSelectedFarmerId("");
    setPlots([]);
    setSelectedPlotId("");
  }, [selectedManagerId, teamFieldOfficersRaw, managers]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: avoid FO clear loop

  // KPI cards: factory dashboard only (do NOT wait on agroStats � that was
  // keeping spinners forever while FO agroStats 404/hang on Cloudflare).
  // 1) No manager ? GET /factories/dashboard (detailed aggregate)
  // 2) Manager ? GET /factories/{industry_id}/dashboard
  // 3) Farmer selected ? skip factory cards
  useEffect(() => {
    const foId = selectedFieldOfficerId
      ? String(selectedFieldOfficerId).trim()
      : "";
    const farmerId = selectedFarmerId ? String(selectedFarmerId).trim() : "";
    const managerId = selectedManagerId
      ? String(selectedManagerId).trim()
      : "";

    if (farmerId) {
      factoryDashRequestIdRef.current += 1;
      setLoadingFactoryDash(false);
      return;
    }

    // Manager picked but hierarchy not loaded yet � wait (don't cancel later).
    if (managerId && managerDashKey === "wait") {
      setLoadingFactoryDash(true);
      return;
    }

    const requestId = ++factoryDashRequestIdRef.current;
    setLoadingFactoryDash(true);

    void (async () => {
      try {
        const ownerId = String(
          dashboardOwnerId.trim() || resolveProgressOwnerId() || "",
        );
        if (ownerId && ownerId !== dashboardOwnerId) {
          setDashboardOwnerId(ownerId);
        }
        if (!ownerId) {
          if (requestId === factoryDashRequestIdRef.current) {
            setFactoryRollup(null);
            setFactoryRecoveryPeers(null);
            setLoadingFactoryDash(false);
          }
          return;
        }

        const endDate = factoryDashboardEndDate();
        let factory: FactoryDashboardFactory | null = null;

        if (!managerId) {
          factory = await fetchOwnerFactoriesDetailedDashboard(
            ownerId,
            endDate,
          );
        } else {
          const officerIds = selectedManagerForDash
            ? Array.from(
                officerIdsForManager(
                  managerId,
                  managers,
                  teamFieldOfficersRaw,
                ),
              )
            : [];
          const { factoryId } = selectedManagerForDash
            ? await resolveFactoryIdForManagerSelection(
                ownerId,
                endDate,
                selectedManagerForDash,
                foId,
                officerIds,
              )
            : { factoryId: "" };
          if (requestId !== factoryDashRequestIdRef.current) return;

          // List /factories/dashboard rows are metric-empty shells. Biomass +
          // recovery live only on GET /factories/{id}/dashboard � never fall
          // back to the shell or owner-root rollup for a single district.
          if (factoryId) {
            factory = await fetchFactoryOwnerDashboardById(
              factoryId,
              ownerId,
              endDate,
            );
            if (
              (!factory ||
                (factory.biomass_avg_t_per_acre == null &&
                  factory.recovery?.factory_avg_pct == null)) &&
              requestId === factoryDashRequestIdRef.current
            ) {
              await new Promise((r) => setTimeout(r, 1200));
              if (requestId !== factoryDashRequestIdRef.current) return;
              factory =
                (await fetchFactoryOwnerDashboardById(
                  factoryId,
                  ownerId,
                  endDate,
                )) ?? factory;
            }
          }
        }

        if (requestId !== factoryDashRequestIdRef.current) return;

        if (factory) {
          setFactoryRollup(factory);
          setFactoryRecoveryPeers(factoryRecoveryPeersFromRollup(factory));
        } else {
          setFactoryRollup(null);
          setFactoryRecoveryPeers(null);
        }
      } catch {
        if (requestId !== factoryDashRequestIdRef.current) return;
        setFactoryRollup(null);
        setFactoryRecoveryPeers(null);
      } finally {
        if (requestId === factoryDashRequestIdRef.current) {
          setLoadingFactoryDash(false);
        }
      }
    })();
  }, [
    selectedFieldOfficerId,
    selectedFarmerId,
    selectedManagerId,
    managerDashKey,
    selectedManagerForDash,
    managers,
    teamFieldOfficersRaw,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- owner resolved inside

  // Map polygons � all owner industries when no manager; filter when manager/FO selected.
  useEffect(() => {
    const foId = selectedFieldOfficerId
      ? String(selectedFieldOfficerId).trim()
      : "";
    const farmerId = selectedFarmerId ? String(selectedFarmerId).trim() : "";
    const managerId = selectedManagerId
      ? String(selectedManagerId).trim()
      : "";

    // Farmer+plot view uses selected plot polygon only.
    if (farmerId) {
      setFoMapPlots([]);
      return;
    }

    let cancelled = false;
    const endDate = factoryDashboardEndDate();

    void (async () => {
      try {
        // 1) Always try owner-factory-boundaries first (all industries / districts).
        const ownerBoundaryPlots = await fetchAllOwnerFactoryBoundaryPlots().catch(
          () => [],
        );
        let mapPlots = buildFoMapPlotsFromOwnerBoundaries(
          ownerBoundaryPlots as Array<Record<string, any>>,
        );

        // 2) Merge FO agroStats geometries (status / extra plots).
        let agroStats: Record<string, unknown> | null = null;
        if (foId) {
          const raw = await getFieldOfficerAgroStats(foId, endDate).catch(
            () => null,
          );
          agroStats =
            raw && typeof raw === "object"
              ? (raw as Record<string, unknown>)
              : null;
          // Cache FO agroStats so fetchAllData can use it without calling analyzeSinglePlot
          if (agroStats) foAgroStatsRef.current = agroStats as Record<string, any>;
        } else {
          const officers =
            teamFieldOfficersRaw.length > 0
              ? teamFieldOfficersRaw
              : managers.flatMap((m: any) =>
                  Array.isArray(m?.field_officers) ? m.field_officers : [],
                );
          const agroStatsRaw = await getOwnerFieldOfficersAgroStats(endDate, {
            hierarchy: {
              fieldOfficers: officers,
              managers,
            },
          }).catch(() => null);

          agroStats =
            agroStatsRaw && typeof agroStatsRaw === "object"
              ? (agroStatsRaw as Record<string, unknown>)
              : null;

          if (managerId && agroStats) {
            agroStats = filterAgroStatsByOfficerIds(
              agroStats,
              officerIdsForManager(
                managerId,
                managers,
                teamFieldOfficersRaw,
              ),
            );
          }
        }

        if (cancelled) return;

        const fromAgro = buildFoMapPlotsFromAgroStats(agroStats);
        mapPlots = mergeFoMapPlots(mapPlots, fromAgro);

        // Manager selected ? keep that factory/industry plots when ids match.
        if (managerId && !foId) {
          const factoryId =
            selectedManagerForDash?.industry_id ??
            selectedManagerForDash?.factory_id ??
            selectedManagerForDash?.industry?.id ??
            selectedManagerForDash?.industry?.industry_id ??
            null;
          if (factoryId != null) {
            mapPlots = filterFoMapPlotsByFactoryId(mapPlots, factoryId);
          }
        }

        setFoMapPlots(mapPlots);
        if (mapPlots[0]?.positions[0]) {
          setMapCenter(mapPlots[0].positions[0]);
          setMapKey((k) => k + 1);
        }
      } catch {
        if (!cancelled) setFoMapPlots([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedFieldOfficerId,
    selectedFarmerId,
    selectedManagerId,
    selectedManagerForDash,
    teamFieldOfficersRaw,
    managers,
  ]);

  // Load farmers for the selected field officer from dedicated API.
  useEffect(() => {
    if (!selectedFieldOfficerId) {
      prevFieldOfficerIdRef.current = "";
      setFarmersForSelectedOfficer([]);
      setSelectedFarmerId("");
      setPlots([]);
      setSelectedPlotId("");
      setLoadingFarmersForOfficer(false);
      return;
    }

    const fieldOfficerChanged =
      prevFieldOfficerIdRef.current !== String(selectedFieldOfficerId);
    prevFieldOfficerIdRef.current = String(selectedFieldOfficerId);

    if (fieldOfficerChanged) {
      lastFetchedFarmerIdRef.current = "";
      dashboardLoadedForPlotRef.current = "";
      setSelectedFarmerId("");
      setPlots([]);
      setSelectedPlotId("");
      setPlotCoordinates([]);
    }

    let cancelled = false;
    setLoadingFarmersForOfficer(true);
    setFarmersForSelectedOfficer([]);

    void (async () => {
      try {
        const res = await getFarmersByFieldOfficer(selectedFieldOfficerId);
        if (cancelled) return;

        const apiFarmers = parseFarmersByFieldOfficerResponse(res?.data);

        // If API returns empty, fall back to hierarchy data (nested farmers / teamFarmersRaw)
        if (apiFarmers.length > 0) {
          setFarmersForSelectedOfficer(apiFarmers);
        } else {
          const officer = fieldOfficers.find(
            (fo) =>
              String(fo.id ?? fo.user_id) === String(selectedFieldOfficerId),
          );
          const fallbackFarmers = officer
            ? getFarmersForFieldOfficer(officer, teamFarmersRaw)
            : [];
          setFarmersForSelectedOfficer(fallbackFarmers);
        }
      } catch {
        if (cancelled) return;
        const officer = fieldOfficers.find(
          (fo) =>
            String(fo.id ?? fo.user_id) === String(selectedFieldOfficerId),
        );
        const fallbackFarmers = officer
          ? getFarmersForFieldOfficer(officer, teamFarmersRaw)
          : [];
        setFarmersForSelectedOfficer(fallbackFarmers);
      } finally {
        if (!cancelled) setLoadingFarmersForOfficer(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFieldOfficerId, fieldOfficers, teamFarmersRaw]);

  const applyFarmerPlotsToUi = (
    farmerId: string,
    farmPlots: any[],
    options?: { selectFirstPlot?: boolean },
  ) => {
    const plotIds = farmPlots
      .map((plot) => plot?.fastapi_plot_id)
      .filter((id) => id != null && `${id}`.trim() !== "")
      .map((id) => String(id));
    setPlots(plotIds);
    setFarmersForSelectedOfficer((prev) =>
      prev.map((f) =>
        getFarmerId(f) === String(farmerId)
          ? { ...f, plots: farmPlots, plots_count: farmPlots.length }
          : f,
      ),
    );

    if (options?.selectFirstPlot !== false && plotIds.length > 0) {
      const firstPlot =
        farmPlots.find(
          (p) => String(p?.fastapi_plot_id) === String(plotIds[0]),
        ) ?? farmPlots[0];
      const fastapiPlotId = plotIds[0];
      dashboardLoadedForPlotRef.current = "";
      setSelectedPlotId(fastapiPlotId);
      if (!applyCoordinatesFromPlot(firstPlot) && fastapiPlotId) {
        void fetchPlotCoordinates(fastapiPlotId);
      }
    }
  };

  // Plots + map boundary from farmers-by-field-officer (same endpoint as farmers list).
  useEffect(() => {
    if (!selectedFarmerId || !selectedFieldOfficerId) {
      lastFetchedFarmerIdRef.current = "";
      dashboardLoadedForPlotRef.current = "";
      setPlots([]);
      setSelectedPlotId("");
      setPlotCoordinates([]);
      return;
    }

    const farmerId = String(selectedFarmerId);
    const fieldOfficerId = String(selectedFieldOfficerId);
    const fetchGen = ++farmerFetchGenRef.current;

    let cancelled = false;
    setLoadingFarmerPlots(true);
    dashboardLoadedForPlotRef.current = "";
    setSelectedPlotId("");
    setPlots([]);
    setPlotCoordinates([]);

    void (async () => {
      try {
        const { farmer, plots: farmPlots } = await loadPlotsFromFieldOfficerApi(
          fieldOfficerId,
          farmerId,
        );
        if (cancelled || fetchGen !== farmerFetchGenRef.current) return;

        // If API returned no plots, fall back to hierarchy farmer data
        let resolvedFarmer = farmer;
        let resolvedPlots = farmPlots;
        if (!resolvedPlots.length) {
          const hierarchyFarmer = farmersForSelectedOfficer.find(
            (f) => getFarmerId(f) === farmerId,
          );
          if (hierarchyFarmer) {
            resolvedFarmer = hierarchyFarmer;
            resolvedPlots = plotsFromFieldOfficerFarmer(hierarchyFarmer);
          }
        }
        let enrichedPlots = resolvedPlots;
        try {
          const farmsRes = await getFarmsByFarmerId(farmerId);
          const farms = parseFarmsListResponse(farmsRes?.data);
          enrichedPlots = enrichPlotsWithFarmDetails(resolvedPlots, farms);
          // Drop Events/FO polygon cache so map redraws from Django KML.
          setPlotCoordinatesCache((prev) => {
            const next = new Map(prev);
            for (const plot of enrichedPlots) {
              const key = String(
                plot?.fastapi_plot_id ?? plot?.plot_id ?? plot?.id ?? "",
              ).trim();
              if (key) next.delete(key);
            }
            return next;
          });
        } catch {
          enrichedPlots = resolvedPlots;
        }

        lastFetchedFarmerIdRef.current = farmerId;
        setFarmerPlotsCache((prev) => ({
          ...prev,
          [farmerId]: enrichedPlots,
        }));

        if (resolvedFarmer) {
          setFarmersForSelectedOfficer((prev) =>
            prev.map((f) =>
              getFarmerId(f) === farmerId
                ? {
                    ...f,
                    ...resolvedFarmer,
                    plots: enrichedPlots,
                    plots_count: enrichedPlots.length,
                  }
                : f,
            ),
          );
        }

        applyFarmerPlotsToUi(farmerId, enrichedPlots);
      } catch {
        if (cancelled || fetchGen !== farmerFetchGenRef.current) return;
        const cached = farmersForSelectedOfficer.find(
          (f) => getFarmerId(f) === farmerId,
        );
        const fallbackPlots = plotsFromFieldOfficerFarmer(cached);
        if (fallbackPlots.length > 0) {
          applyFarmerPlotsToUi(farmerId, fallbackPlots);
        } else {
          setPlots([]);
          setSelectedPlotId("");
          dashboardLoadedForPlotRef.current = "";
        }
      } finally {
        if (!cancelled && fetchGen === farmerFetchGenRef.current) {
          setLoadingFarmerPlots(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- farmer + field officer selection
  }, [selectedFarmerId, selectedFieldOfficerId]);

  useEffect(() => {
    if (!selectedPlotId) {
      dashboardLoadedForPlotRef.current = "";
      return;
    }
    if (dashboardLoadedForPlotRef.current === selectedPlotId) return;

    dashboardLoadedForPlotRef.current = selectedPlotId;
    setLoadingSections({
      plotStats: true,
      indices: true,
      stress: true,
      waterStress: true,
      irrigation: true,
    });
    fetchAllData();
    const plot = findPlotInSelection(selectedPlotId);
    if (!plot || !applyCoordinatesFromPlot(plot, selectedPlotId)) {
      void fetchPlotCoordinates(selectedPlotId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load dashboard once per plot id
  }, [selectedPlotId]);

  // Backend Growth tile fill � only when Mapping host is configured (optional testing).
  const plotCoordsKey =
    selectedPlotId && plotCoordinates.length >= 3
      ? `${selectedPlotId}|${plotCoordinates
          .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
          .join(";")}`
      : "";

  useEffect(() => {
    if (!plotCoordsKey || !selectedPlotId || plotCoordinates.length < 3) {
      setGrowthOverlayUrl(null);
      setGrowthOverlayBounds(null);
      return;
    }

    const plotBounds = boundsFromLeafletPositions(plotCoordinates);
    if (!plotBounds) {
      setGrowthOverlayUrl(null);
      setGrowthOverlayBounds(null);
      return;
    }

    const requestId = ++growthOverlayRequestRef.current;
    let cancelled = false;
    const plotIdAtStart = selectedPlotId;
    const farmerPlotsAtStart =
      (selectedFarmerForUi as { plots?: unknown[] } | null)?.plots ??
      farmersForSelectedOfficer.flatMap((f: any) =>
        Array.isArray(f?.plots) ? f.plots : [],
      );

    const run = async () => {
      try {
        const { isSarMappingHostAvailable } = await import(
          "../utils/sarIndexHost"
        );
        if (!(await isSarMappingHostAvailable())) {
          setGrowthOverlayUrl(null);
          setGrowthOverlayBounds(null);
          return;
        }

        const plotNameCandidates = getPlotNameCandidates(
          plotIdAtStart,
          farmerPlotsAtStart as any,
        );
        const apiPlots =
          plotNameCandidates.length > 0
            ? plotNameCandidates
            : [
                resolveApiPlotName(
                  plotIdAtStart,
                  farmerPlotsAtStart as any,
                ),
              ].filter(Boolean);

        let lastErr: unknown = null;
        for (const apiPlot of apiPlots) {
          try {
            const timeline = await fetchAnalysisTimeline(
              apiPlot,
              farmerPlotsAtStart as any,
            ).catch(() => null);
            if (cancelled || growthOverlayRequestRef.current !== requestId)
              return;

            const candidateDates = ownerGrowthDateCandidates(
              plotIdAtStart,
              timeline?.timeline,
            );
            if (!candidateDates.length) continue;

            const { data } = await fetchAdminLayerWithDateFallback({
              plotName: plotIdAtStart,
              apiPlotName: apiPlot,
              layer: "Growth",
              candidateDates,
            });
            if (cancelled || growthOverlayRequestRef.current !== requestId)
              return;

            const tileUrl = extractAdminTileUrl(data);
            // Always stretch/clip to the FO UI boundary so green fills the full outline
            // (Admin GEE geometry can be smaller / offset vs farmers-by-FO boundary).
            if (
              tileUrl &&
              (isStoredAnalysisPngUrl(tileUrl) || isXyzTileTemplate(tileUrl))
            ) {
              setGrowthOverlayUrl(tileUrl);
              setGrowthOverlayBounds(plotBounds);
              return;
            }
          } catch (err) {
            lastErr = err;
            console.warn(
              `[OwnerFarmDash] Growth tiles failed for ${apiPlot}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }

        if (cancelled || growthOverlayRequestRef.current !== requestId) return;
        if (lastErr) {
          console.warn(
            "[OwnerFarmDash] No Growth overlay for plot",
            plotIdAtStart,
            lastErr instanceof Error ? lastErr.message : lastErr,
          );
        }
        setGrowthOverlayUrl(null);
        setGrowthOverlayBounds(null);
      } catch (err) {
        if (cancelled || growthOverlayRequestRef.current !== requestId) return;
        console.warn(
          "[OwnerFarmDash] Growth overlay error:",
          err instanceof Error ? err.message : err,
        );
        setGrowthOverlayUrl(null);
        setGrowthOverlayBounds(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plotCoordsKey captures plot + boundary
  }, [plotCoordsKey]);

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
    }
  }, [aggregatedData, ndreStressEvents, showNDREEvents]);

  // Helper function to make axios requests with timeout and retry logic
  // Optimized with shorter timeout for faster retrieval
  const makeRequestWithRetry = async (
    url: string,
    retries = 1,
    timeout = 15000,
  ): Promise<any> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      const response = await axios.get(url, {
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

  // Fetch all data for selected plot - Optimized for faster retrieval
  const fetchAllData = async (): Promise<void> => {
    if (!selectedPlotId) return;
    setPlotStatsError(null);
    // Clear previous farmer/plot metrics so cards don't stay on stale "�" / FO rollup.
    setMetrics((prev) => ({
      ...prev,
      brix: null,
      brixMin: null,
      brixMax: null,
      recovery: null,
      area: null,
      biomass: null,
      totalBiomass: null,
      biomassMin: null,
      biomassMax: null,
      expectedYield: null,
      daysToHarvest: null,
      growthStage: null,
      actualYield: null,
      sugarYieldMax: null,
      sugarYieldMin: null,
      cropConditionLabel: null,
      cropConditionValue: null,
      stressCount: null,
      stressTotalDays: null,
    }));
    try {
      const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
      const endDate = new Date(Date.now() - tzOffsetMs)
        .toISOString()
        .slice(0, 10);
      // const today = endDate; // For compatibility with existing code

      // Step 1: Harvest status (do NOT block dashboard render)
      // We show the dashboard using endDate first, then update growthStage when harvest status arrives.
      const harvestCacheKey = `harvest_${selectedPlotId}_${endDate}`;
      let harvestStatus: string | null = null;
      let harvestData = getCache(harvestCacheKey);
      let harvestDate: string | null = null;
      let isHarvested = false;

      const parseHarvest = (data: any) => {
        const harvestProperties =
          data?.features?.[0]?.properties || data?.harvest_summary;
        const parsedHarvestStatus =
          harvestProperties?.harvest_status ||
          data?.harvest_summary?.harvest_status ||
          null;
        const parsedHarvestDate = harvestProperties?.harvest_date || null;
        const parsedIsHarvested =
          harvestProperties?.has_harvest === true &&
          harvestProperties?.harvest_status === "harvested";
        return {
          harvestStatus: parsedHarvestStatus,
          harvestDate: parsedHarvestDate,
          isHarvested: parsedIsHarvested,
        };
      };

      if (harvestData) {
        const parsed = parseHarvest(harvestData);
        harvestStatus = parsed.harvestStatus;
        harvestDate = parsed.harvestDate;
        isHarvested = parsed.isHarvested;
      }

      const harvestPromise = harvestData
        ? Promise.resolve({ harvestStatus, harvestDate, isHarvested })
        : agricultureAnalysisHttp
            .post(
              agricultureAnalysisUrl(
                `/sugarcane-harvest?plot_name=${encodePlotIdForEventsUrl(selectedPlotId)}&end_date=${endDate}`,
              ),
            )
            .then((harvestRes) => {
              const data = harvestRes.data;
              setCache(harvestCacheKey, data);
              const parsed = parseHarvest(data);
              return parsed;
            })
            .catch((harvestErr) => {
              console.error("Error fetching harvest status:", harvestErr);
              return { harvestStatus: null, harvestDate: null, isHarvested: false };
            });

      // Step 2: Use endDate immediately for agroStats/indices/stress/irrigation.
      // If we later find a harvested plot, we will still update growthStage,
      // but we avoid blocking the first paint waiting for harvest.
      const yieldDataDate = endDate;

      // Step 3: Fetch critical data (agroStats) with versioned caching
      // Optimization: prefer the faster single-plot endpoint (analyzeSinglePlot),
      // avoid downloading agroStats for ALL plots on owner dashboard load.
      const singlePlotCacheKey = `agroSingle_v4_${selectedPlotId}_${yieldDataDate}`;
      let currentPlotData = getCache(singlePlotCacheKey);
      // Reject empty/invalid cache hits (same issue Manager fixed with v2 keys).
      if (
        currentPlotData &&
        typeof currentPlotData === "object" &&
        !currentPlotData.area_acres &&
        !currentPlotData.brix_sugar &&
        !currentPlotData.Sugarcane_Status &&
        !currentPlotData.sugarcane_status
      ) {
        currentPlotData = null;
      }

      const applyPlotStatsToState = (plot: any) => {
        const toNumberOrNull = (v: any): number | null => {
          if (v === null || v === undefined) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };

        const expectedYieldValue = toNumberOrNull(
          plot?.brix_sugar?.sugar_yield?.mean ??
            plot?.brix_sugar?.sugar_yield?.avg ??
            plot?.brix_sugar?.sugar_yield?.average ??
            plot?.brix_sugar?.sugar_yield_mean ??
            plot?.sugar_yield_mean ??
            plot?.expected_yield,
        );

        const biomassStats = plot?.biomass ?? null;
        const biomassTotal = toNumberOrNull(biomassStats?.mean);
        const biomassMin = toNumberOrNull(biomassStats?.min);
        const biomassMax = toNumberOrNull(biomassStats?.max);
        const calculatedBiomass =
          biomassTotal !== null ? biomassTotal * 0.12 : null;
        const totalBiomassForMetric = biomassTotal;

        setMetrics((prev) => ({
          ...prev,
          brix: toNumberOrNull(plot?.brix_sugar?.brix?.mean),
          brixMin: toNumberOrNull(plot?.brix_sugar?.brix?.min),
          brixMax: toNumberOrNull(plot?.brix_sugar?.brix?.max),
          recovery: toNumberOrNull(plot?.brix_sugar?.recovery?.mean),
          area:
            plot?.area_acres ??
            plot?.soil?.area_acres ??
            (plot?.area_ha != null ? Number(plot.area_ha) * 2.47105 : plot?.area) ??
            null,
          biomass: calculatedBiomass,
          totalBiomass: totalBiomassForMetric,
          biomassMin,
          biomassMax,
          expectedYield: expectedYieldValue,
          daysToHarvest: plot?.days_to_harvest ?? null,
          growthStage: plot?.Sugarcane_Status ?? plot?.sugarcane_status ?? null,
          soilPH:
            toNumberOrNull(plot?.soil?.phh2o) ??
            toNumberOrNull(plot?.soil?.ph_h2o) ??
            null,
          organicCarbonDensity:
            plot?.soil?.organic_carbon_stock != null
              ? toNumberOrNull(plot.soil.organic_carbon_stock)
                ? parseFloat(plot.soil.organic_carbon_stock.toFixed(2))
                : null
              : null,
          actualYield: toNumberOrNull(
            plot?.brix_sugar?.sugar_yield?.mean ??
              plot?.brix_sugar?.sugar_yield_mean,
          ),
          sugarYieldMax: toNumberOrNull(
            plot?.brix_sugar?.sugar_yield?.max ??
              plot?.sugar_yield_max,
          ),
          sugarYieldMin: toNumberOrNull(
            plot?.brix_sugar?.sugar_yield?.min ??
              plot?.sugar_yield_min,
          ),
          ...extractPlantationInfo(plot),
        }));
      };

      // Step 5: Update metrics immediately with cached data.
      // If missing, fetch plot stats in the background (no abort controller timeouts)
      // because the events endpoints can be slow.
      if (currentPlotData) {
        applyPlotStatsToState(currentPlotData);
        setLoadingSections((prev) => ({ ...prev, plotStats: false }));
      } else {
        const plotIdAtStart = selectedPlotId;
        const farmerPlotsAtStart =
          (selectedFarmerForUi as { plots?: unknown[] } | null)?.plots ??
          farmersForSelectedOfficer.flatMap((f: any) =>
            Array.isArray(f?.plots) ? f.plots : [],
          );
        void (async () => {
          try {
            // Re-check cache (might be filled while this async started).
            let plotData = getCache(singlePlotCacheKey);
            if (
              plotData &&
              typeof plotData === "object" &&
              !plotData.area_acres &&
              !plotData.brix_sugar &&
              !plotData.Sugarcane_Status
            ) {
              plotData = null;
            }

            if (!plotData) {
              const candidates = getPlotNameCandidates(
                plotIdAtStart,
                farmerPlotsAtStart as any,
              );
              const tryIds =
                candidates.length > 0 ? candidates : [plotIdAtStart];
              let lastErr: unknown = null;

              for (const tryId of tryIds) {
                try {
                  plotData = await getSinglePlotAgroStats(tryId, {
                    timeout: OWNER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
                    endDate: yieldDataDate,
                  });
                  if (plotData) {
                    setCache(singlePlotCacheKey, plotData);
                    break;
                  }
                } catch (singleErr) {
                  lastErr = singleErr;
                  if (isAnalyzeSinglePlotPlantationDateError(singleErr)) {
                    if (selectedPlotIdRef.current === plotIdAtStart) {
                      setPlotStatsError(PLANTATION_DATE_NOT_PROVIDED_MSG);
                      setLoadingSections((prev) => ({
                        ...prev,
                        plotStats: false,
                      }));
                    }
                    return;
                  }
                  // 404 ? try next plot-name candidate (slash vs underscore).
                  const status = (singleErr as { response?: { status?: number } })
                    ?.response?.status;
                  if (status === 404) continue;
                  throw singleErr;
                }
              }

              if (!plotData && lastErr) {
                console.warn(
                  "[OwnerFarmDash] analyzeSinglePlot failed for",
                  plotIdAtStart,
                  lastErr,
                );
              }
            }

            // Fallback: FO / plot agroStats path � never call removed /plots/agroStats bulk.
            if (!plotData) {
              console.warn(
                "[OwnerFarmDash] analyzeSinglePlot empty; skipping removed /plots/agroStats bulk endpoint",
              );
            }

            if (
              plotData &&
              selectedPlotIdRef.current === plotIdAtStart
            ) {
              if (import.meta.env.DEV) {
                console.log("[OwnerFarmDash] plot stats loaded:", {
                  plotId: plotIdAtStart,
                  expectedYield: plotData?.brix_sugar?.sugar_yield?.mean ?? null,
                  area: plotData?.area_acres ?? null,
                  status: plotData?.Sugarcane_Status ?? null,
                });
              }
              applyPlotStatsToState(plotData);
              setLoadingSections((prev) => ({ ...prev, plotStats: false }));
            }
          } catch (e) {
            console.error("[OwnerFarmDash] plot stats fetch failed:", e);
            setLoadingSections((prev) => ({ ...prev, plotStats: false }));
          } finally {
            // If we couldn't apply data (no plotData), still stop the plot-stats loader.
            setLoadingSections((prev) => ({ ...prev, plotStats: false }));
          }
        })();
      }

      // Prefer agroStats Sugarcane_Status; do not overwrite Growing with harvest "Ready to harvest".
      harvestPromise.then(({ harvestStatus: hs }) => {
        if (!hs) return;
        setMetrics((prev) => {
          const agro = prev.growthStage?.trim();
          if (agro) return prev;
          return {
            ...prev,
            growthStage: hs,
          };
        });
      });

      // Step 6: Fetch additional data in parallel with shorter timeouts
      // Check cache first for each endpoint
      const indicesCacheKey = `indices_${selectedPlotId}`;
      const stressCacheKey = `stress_${selectedPlotId}_NDRE_0.15`;

      let cachedIndices = getCache(indicesCacheKey);
      let cachedStress = getCache(stressCacheKey);

      // Fetch indices first (chart), then fetch stress/field score in the background.
      // This reduces the perceived "dashboard load time".
      const eventsPlotId = encodePlotIdForEventsUrl(selectedPlotId);
      if (cachedIndices) {
        // Cached indices are already in LineChartData[] format.
        setLineChartData(cachedIndices as LineChartData[]);
        setLoadingSections((prev) => ({ ...prev, indices: false }));
      } else {
        // Don't block dashboard further on indices (chart can render later).
        setLineChartData([]);
        makeRequestWithRetry(
          `${BASE_URL}/plots/${eventsPlotId}/indices`,
          1,
          OWNER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
        )
          .then((data) => {
            const mapped = (data || []).map((item: any) => ({
              date: new Date(item.date).toISOString().split("T")[0],
              growth: item.NDVI,
              stress: item.NDMI,
              water: item.NDWI,
              moisture: item.NDRE,
            }));
            setCache(indicesCacheKey, mapped);
            setLineChartData(mapped);
            setLoadingSections((prev) => ({ ...prev, indices: false }));
          })
          .catch(() => {
            setLineChartData([]);
            setLoadingSections((prev) => ({ ...prev, indices: false }));
          });
      }

      // Water stress (SAR API) � crop condition indices + stress event cards
      const plotForWaterStress = findPlotInSelection(selectedPlotId);
      const plantationForWaterStress =
        plotForWaterStress?.plantation_date ??
        plotForWaterStress?.crop_type?.plantation_date ??
        null;

      void fetchWaterStressAnalysis(selectedPlotId, {
        plantationDate: plantationForWaterStress,
        endDate,
      })
        .then((data) => {
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
          setLoadingSections((prev) => ({ ...prev, waterStress: false }));
        });

      // NDRE stress events � chart overlay only (not summary cards)
      if (!cachedStress) {
        makeRequestWithRetry(
          `${BASE_URL}/plots/${eventsPlotId}/stress?index_type=NDRE&threshold=0.15`,
          1,
          OWNER_EVENTS_SLOW_ENDPOINT_TIMEOUT_MS,
        )
          .then((data) => {
            setCache(stressCacheKey, data);
            const events = data?.events ?? [];
            setStressEvents(events);
            setNdreStressEvents(events);
            setMetrics((prev) => ({
              ...prev,
              cnRatio: null,
            }));
            setLoadingSections((prev) => ({ ...prev, stress: false }));
          })
          .catch(() => {
            const events: any[] = [];
            setStressEvents(events);
            setNdreStressEvents(events);
            setMetrics((prev) => ({
              ...prev,
              cnRatio: null,
            }));
            setLoadingSections((prev) => ({ ...prev, stress: false }));
          });
      } else {
        const events = cachedStress?.events ?? [];
        setStressEvents(events);
        setNdreStressEvents(events);
        setMetrics((prev) => ({
          ...prev,
          cnRatio: null,
        }));
        setLoadingSections((prev) => ({ ...prev, stress: false }));
      }

      // Field score - background
      const scoreCacheKey = fieldScoreCacheKey(selectedPlotId);
      const cachedFieldScore = getCache(scoreCacheKey);

      if (cachedFieldScore === undefined || cachedFieldScore === null) {
        const plotRef = findPlotInSelection(selectedPlotId);
        const farmer = farmersForSelectedOfficer.find(
          (f) => getFarmerId(f) === String(selectedFarmerId),
        );
        const plotRefs = farmer
          ? extractPlotsFromFarmer(farmer)
          : plotRef
            ? [plotRef]
            : null;

        fetchFieldScoreForPlot(selectedPlotId, plotRefs)
          .then((score) => {
            if (score != null) setCache(scoreCacheKey, score);
            setMetrics((prev) => ({
              ...prev,
              fieldScore: score,
            }));
            setLoadingSections((prev) => ({ ...prev, irrigation: false }));
          })
          .catch(() => {
            setMetrics((prev) => ({
              ...prev,
              fieldScore: null,
            }));
            setLoadingSections((prev) => ({ ...prev, irrigation: false }));
          });
      } else {
        setMetrics((prev) => ({
          ...prev,
          fieldScore: cachedFieldScore ?? null,
        }));
        setLoadingSections((prev) => ({ ...prev, irrigation: false }));
      }
    } catch (err: any) {
      // You could add a toast notification here to inform the user
      // For now, we'll just log the error and continue with partial data
      setLoadingSections((prev) => ({
        ...prev,
        plotStats: false,
        indices: false,
        stress: false,
        irrigation: false,
      }));
    } finally {
      // Per-endpoint loaders are cleared in their own handlers above.
    }
  };

  // Fetch farmers from API - using authenticated endpoint
  const fetchOwnerHierarchy = async (): Promise<void> => {
    const HIERARCHY_CACHE_KEY = "ownerTeamConnect_v9";
    const HIERARCHY_TTL_MS = 30 * 60 * 1000; // 30 minutes

    // Fast path: hydrate managers/field officers from cache immediately
    const cached = getCache(HIERARCHY_CACHE_KEY, HIERARCHY_TTL_MS);
    if (cached?.managers && Array.isArray(cached.managers)) {
      const cachedFarmers = Array.isArray(cached.farmers) ? cached.farmers : [];
      const cachedFieldOfficers = enrichFieldOfficersWithFarmers(
        enrichFieldOfficersWithManagerIds(
          Array.isArray(cached.fieldOfficers) ? cached.fieldOfficers : [],
          cached.managers,
        ),
        cachedFarmers,
      );
      const cachedManagers = normalizeManagersWithFoCounts(
        cached.managers,
        cachedFieldOfficers,
      );
      const hasAnyFieldOfficer = cachedManagers.some(
        (m: any) => (m?.field_officers_count ?? 0) > 0,
      );
      const looksIncomplete =
        cachedManagers.length <= 1 &&
        !hasAnyFieldOfficer &&
        cachedFieldOfficers.length === 0;

      if (!looksIncomplete) {
        setManagers(cachedManagers);
        setTeamFieldOfficersRaw(cachedFieldOfficers);
        setTeamFarmersRaw(cachedFarmers);
        setLoadingHierarchy(false);
        return;
      }
    }

    const requestId = ++hierarchyRequestIdRef.current;
    setLoadingHierarchy(true);

    const normalizeRole = (u: any) => {
      const roleId = u?.role_id ?? u?.role?.id ?? u?.role?.role_id ?? null;
      const roleNameRaw =
        u?.role?.name ?? u?.role_name ?? u?.roleName ?? u?.type ?? u?.user_type ?? "";
      const roleName = `${roleNameRaw}`.toLowerCase();
      return { roleId, roleName };
    };

    try {
      let managersTmp: any[] = [];
      let fieldOfficersTmp: any[] = [];
      let farmersTmp: any[] = [];

      // Prefer owner-hierarchy so ALL industries/managers appear (not one industry_id only).
      try {
        const response = await api.get(
          `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/users/owner-hierarchy/`,
        );
        const responseData = response.data;
        managersTmp = Array.isArray(responseData?.managers)
          ? responseData.managers
          : Array.isArray(responseData?.results)
            ? responseData.results
            : [];
        if (Array.isArray(managersTmp) && managersTmp.length > 0) {
          fieldOfficersTmp = managersTmp.flatMap((m: any) =>
            (Array.isArray(m?.field_officers) ? m.field_officers : []).map(
              (fo: any) => ({
                ...fo,
                manager_id: fo?.manager_id ?? fo?.manager?.id ?? m?.id,
              }),
            ),
          );
          farmersTmp = managersTmp.flatMap((m: any) =>
            (Array.isArray(m?.field_officers) ? m.field_officers : []).flatMap(
              (fo: any) =>
                Array.isArray(fo?.farmers) ? fo.farmers : [],
            ),
          );
        }
      } catch {
        // fall through to team-connect
      }

      // Prefer team-connect for lighter payload (if possible)
      const meRes = await getCurrentUser();
      const me = meRes?.data;
      const industryId =
        me?.industry_id ??
        me?.industry?.id ??
        me?.industry?.industry_id ??
        me?.industryId;

      // Merge team-connect for current industry if hierarchy was empty / incomplete
      if (
        (!managersTmp || managersTmp.length === 0) ||
        (!fieldOfficersTmp || fieldOfficersTmp.length === 0)
      ) {
      if (industryId) {
        const teamRes = await getTeamConnect(industryId);
        const d = teamRes?.data;

        // Format: { users_by_role: { managers: [], field_officers: [], farmers: [] } }
        if (d?.users_by_role) {
          managersTmp = Array.isArray(d.users_by_role.managers)
            ? d.users_by_role.managers
            : [];
          fieldOfficersTmp = Array.isArray(d.users_by_role.field_officers)
            ? d.users_by_role.field_officers
            : [];
          farmersTmp = Array.isArray(d.users_by_role.farmers)
            ? d.users_by_role.farmers
            : [];
        }

        // Format: { managers: [], field_officers: [], farmers: [] }
        if ((!managersTmp || managersTmp.length === 0) && Array.isArray(d?.managers)) {
          managersTmp = d.managers;
        }
        if ((!fieldOfficersTmp || fieldOfficersTmp.length === 0) && Array.isArray(d?.field_officers)) {
          fieldOfficersTmp = d.field_officers;
        }
        if ((!farmersTmp || farmersTmp.length === 0) && Array.isArray(d?.farmers)) {
          farmersTmp = d.farmers;
        }

        // Format: { results: [...] } (role detection per item)
        if (Array.isArray(d?.results)) {
          d.results.forEach((u: any) => {
            const { roleId, roleName } = normalizeRole(u);
            if (
              (!managersTmp || managersTmp.length === 0) &&
              (roleId === 3 || roleName.includes("manager"))
            ) {
              managersTmp.push(u);
            }
            if (
              (!fieldOfficersTmp || fieldOfficersTmp.length === 0) &&
              (roleId === 2 ||
                (roleName.includes("field") && roleName.includes("officer")))
            ) {
              fieldOfficersTmp.push(u);
            }
            if (
              (!farmersTmp || farmersTmp.length === 0) &&
              (roleId === 1 || roleName.includes("farmer"))
            ) {
              farmersTmp.push(u);
            }
          });
        }
      }
      } // end incomplete hierarchy ? team-connect merge

      // If team-connect gives managers but no flat field-officers array,
      // try deriving field officers from nested manager objects.
      if (
        Array.isArray(managersTmp) &&
        managersTmp.length > 0 &&
        (!Array.isArray(fieldOfficersTmp) || fieldOfficersTmp.length === 0)
      ) {
        fieldOfficersTmp = managersTmp.flatMap((m: any) => {
          const mid = m?.id ?? m?.user_id ?? null;
          const nestedFos = m?.field_officers ?? m?.fieldOfficers ?? m?.fo_list ?? [];
          if (!Array.isArray(nestedFos)) return [];
          return nestedFos.map((fo: any) => ({
            ...fo,
            manager_id: fo?.manager_id ?? fo?.manager?.id ?? fo?.managerId ?? mid,
          }));
        });
      }

      // Fallback to owner-hierarchy if team-connect doesn't provide managers
      if (
        !Array.isArray(managersTmp) ||
        managersTmp.length === 0 ||
        !Array.isArray(fieldOfficersTmp) ||
        fieldOfficersTmp.length === 0
      ) {
        const response = await api.get(
          `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/users/owner-hierarchy/`,
        );
        const responseData = response.data;

        managersTmp = Array.isArray(responseData?.managers)
          ? responseData.managers
          : Array.isArray(responseData?.results)
            ? responseData.results
            : [];

        // Flatten managers -> field_officers and attach manager_id for filtering.
        if (Array.isArray(managersTmp)) {
          fieldOfficersTmp = managersTmp.flatMap((m: any) =>
            (Array.isArray(m?.field_officers) ? m.field_officers : []).map((fo: any) => ({
              ...fo,
              manager_id: fo?.manager_id ?? fo?.manager?.id ?? m?.id,
            })),
          );
        }
      }

      fieldOfficersTmp = enrichFieldOfficersWithManagerIds(
        fieldOfficersTmp || [],
        managersTmp || [],
      );
      fieldOfficersTmp = enrichFieldOfficersWithFarmers(
        fieldOfficersTmp || [],
        farmersTmp || [],
      );

      const managersNormalized = normalizeManagersWithFoCounts(
        managersTmp || [],
        fieldOfficersTmp,
      );

      // If the team-connect parsing produced an incomplete tree (common issue:
      // only 1 manager with 0 field officers), force-fetch the heavier
      // owner-hierarchy endpoint to ensure the managers dropdown is correct.
      const managersCount = managersNormalized.length;
      const hasAnyFieldOfficer =
        managersNormalized.some(
          (m: any) => (m.field_officers_count ?? 0) > 0,
        );

      let finalManagers = managersNormalized;
      let finalFieldOfficers = fieldOfficersTmp;

      if (managersCount <= 1 && !hasAnyFieldOfficer) {
        // IMPORTANT: Don't block UI. Run the heavy fallback in background.
        void (async () => {
          try {
            const response = await api.get(
              `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/users/owner-hierarchy/`,
            );
            if (hierarchyRequestIdRef.current !== requestId) return;

            const responseData = response.data;
            const fallbackManagersTmp = Array.isArray(responseData?.managers)
              ? responseData.managers
              : Array.isArray(responseData?.results)
                ? responseData.results
                : [];

            const fallbackFieldOfficersTmp = enrichFieldOfficersWithFarmers(
              enrichFieldOfficersWithManagerIds(
                (fallbackManagersTmp || []).flatMap((m: any) =>
                  (Array.isArray(m?.field_officers) ? m.field_officers : []).map(
                    (fo: any) => ({
                      ...fo,
                      manager_id: fo?.manager_id ?? fo?.manager?.id ?? m?.id,
                    }),
                  ),
                ),
                fallbackManagersTmp || [],
              ),
              farmersTmp || [],
            );

            const fallbackManagersNormalized = normalizeManagersWithFoCounts(
              fallbackManagersTmp || [],
              fallbackFieldOfficersTmp,
            );

            setManagers(fallbackManagersNormalized);
            setTeamFieldOfficersRaw(fallbackFieldOfficersTmp);
            setTeamFarmersRaw(farmersTmp || []);
            setCache(HIERARCHY_CACHE_KEY, {
              managers: fallbackManagersNormalized,
              fieldOfficers: fallbackFieldOfficersTmp,
              farmers: farmersTmp || [],
            });
          } catch {
            // Keep whatever we already computed.
          }
        })();
      }

      if (import.meta.env.DEV) {
        console.log("[OwnerFarmDash] hierarchy final:", {
          managersCount: finalManagers.length,
          managersPreview: finalManagers.slice(0, 5).map((m: any) => ({
            id: m?.id ?? m?.user_id,
            name: `${m?.first_name ?? ""} ${m?.last_name ?? ""}`.trim(),
            foCount: m?.field_officers_count ?? 0,
          })),
          fieldOfficersCount: (finalFieldOfficers || []).length,
        });
      }

      setManagers(finalManagers);
      setTeamFieldOfficersRaw(finalFieldOfficers);
      setTeamFarmersRaw(farmersTmp || []);
      setCache(HIERARCHY_CACHE_KEY, {
        managers: finalManagers,
        fieldOfficers: finalFieldOfficers,
        farmers: farmersTmp || [],
      });

      // Manager-first loading: do not auto-select manager on first load.
      setSelectedManagerId("");
    } catch (error: any) {
      console.error("Owner hierarchy load failed:", error?.message || error);
      setManagers([]);
      setTeamFieldOfficersRaw([]);
      setTeamFarmersRaw([]);
      setFarmerPlotsCache({});
    } finally {
      setLoadingHierarchy(false);
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
    let plot =
      findPlotInSelection(plotId) ??
      (farmerId ? findPlotRef(farmerPlotsCache[farmerId] ?? [], plotId) : null);

    // Always re-fetch Django /farms/?farmer_id= � FO/Events polygons stay stale after KML edit.
    if (farmerId) {
      try {
        const farmsRes = await getFarmsByFarmerId(farmerId);
        const farms = parseFarmsListResponse(farmsRes?.data);
        if (farms.length) {
          const basePlots =
            farmerPlotsCache[farmerId]?.length
              ? farmerPlotsCache[farmerId]
              : extractPlotsFromFarmer(
                  farmersForSelectedOfficer.find(
                    (f) => getFarmerId(f) === farmerId,
                  ) ?? {},
                );
          const seed = plot ? [plot] : basePlots;
          const enrichedSeed = enrichPlotsWithFarmDetails(
            seed.length ? seed : basePlots,
            farms,
          );
          const enrichedPlots = enrichPlotsWithFarmDetails(
            basePlots.length ? basePlots : enrichedSeed,
            farms,
          );
          plot =
            findPlotRef(enrichedPlots, plotId) ??
            findPlotRef(enrichedSeed, plotId) ??
            (plot
              ? enrichPlotsWithFarmDetails([plot], farms)[0] ?? plot
              : null);

          setFarmerPlotsCache((prev) => ({
            ...prev,
            [farmerId]: enrichedPlots.length ? enrichedPlots : enrichedSeed,
          }));
          setFarmersForSelectedOfficer((prev) =>
            prev.map((row) => {
              if (getFarmerId(row) !== farmerId) return row;
              const plotList = extractPlotsFromFarmer(row);
              if (!plotList.length) {
                return enrichedPlots.length
                  ? { ...row, plots: enrichedPlots, plots_count: enrichedPlots.length }
                  : row;
              }
              return {
                ...row,
                plots: enrichPlotsWithFarmDetails(plotList, farms),
              };
            }),
          );
        }
      } catch {
        // Fall through to cached / Events boundary below.
      }
    }

    let savedCoords = resolveLeafletBoundaryForPlotRecord(plot, plotId);

    if (savedCoords.length > 0) {
      applyLeafletCoords(
        savedCoords,
        setPlotCoordinates,
        setMapCenter,
        setMapKey,
      );
      setPlotCoordinatesCache((prev) => new Map(prev.set(plotId, savedCoords)));
      return;
    }

    // Check cache only after saved boundary lookup.
    if (plotCoordinatesCache.has(plotId)) {
      const cachedCoords = plotCoordinatesCache.get(plotId);
      if (cachedCoords && cachedCoords.length > 0) {
        applyLeafletCoords(
          cachedCoords,
          setPlotCoordinates,
          setMapCenter,
          setMapKey,
        );
        return;
      }
    }

    try {
      const coords = await fetchPlotBoundaryCoordinates(plotId);
      if (coords && coords.length > 0) {
        applyLeafletCoords(
          coords,
          setPlotCoordinates,
          setMapCenter,
          setMapKey,
        );
        setPlotCoordinatesCache((prev) => new Map(prev.set(plotId, coords)));
      }
    } catch (error) {}
  };

  useEffect(() => {
    const onBoundaryUpdated = () => {
      setPlotCoordinatesCache(new Map());
      const farmerId = selectedFarmerIdRef.current?.trim();
      const plotId = selectedPlotIdRef.current;
      if (!plotId) return;

      void (async () => {
        let plot = findPlotInSelection(plotId);

        if (farmerId) {
          try {
            const farmsRes = await getFarmsByFarmerId(farmerId);
            const farms = parseFarmsListResponse(farmsRes?.data);
            if (farms.length) {
              const basePlots =
                farmerPlotsCache[farmerId]?.length
                  ? farmerPlotsCache[farmerId]
                  : extractPlotsFromFarmer(
                      farmersForSelectedOfficer.find(
                        (f) => getFarmerId(f) === farmerId,
                      ) ?? {},
                    );
              const enrichedPlots = enrichPlotsWithFarmDetails(basePlots, farms);
              setFarmerPlotsCache((prev) => ({
                ...prev,
                [farmerId]: enrichedPlots,
              }));
              setFarmersForSelectedOfficer((prev) =>
                prev.map((row) => {
                  if (getFarmerId(row) !== farmerId) return row;
                  const plotList = extractPlotsFromFarmer(row);
                  if (!plotList.length) return row;
                  return {
                    ...row,
                    plots: enrichPlotsWithFarmDetails(plotList, farms),
                  };
                }),
              );
              plot =
                findPlotRef(enrichedPlots, plotId) ??
                (plot
                  ? enrichPlotsWithFarmDetails([plot], farms)[0] ?? plot
                  : null);
            }
          } catch {
            // Best-effort Django refresh.
          }
        }

        if (!applyCoordinatesFromPlot(plot, plotId)) {
          void fetchPlotCoordinates(plotId);
        }
      })();

      if (farmerId) {
        lastFetchedFarmerIdRef.current = "";
      }
    };

    window.addEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    return () => {
      window.removeEventListener(PLOT_BOUNDARY_UPDATED_EVENT, onBoundaryUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh map when farmer edits KML
  }, []);

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
    if (stress < 0.1) return "High";
    if (stress < 0.15) return "Medium";
    return "Low";
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

  // Map auto-center / zoom to current plots
  function MapAutoCenter({
    center,
    zoom = 17,
  }: {
    center: [number, number];
    zoom?: number;
  }) {
    const map = useMap();
    useEffect(() => {
      if (!center?.[0] || !center?.[1]) return;
      map.setView(center, zoom, { animate: false });
    }, [center, zoom, map]);
    return null;
  }

  function FitPlotPositions({
    positions,
    maxZoom = 18,
    minZoom,
  }: {
    positions: [number, number][];
    maxZoom?: number;
    /** When set, never zoom out past this (keeps multi-plot views readable). */
    minZoom?: number;
  }) {
    const map = useMap();
    useEffect(() => {
      const coords = (positions || []).filter(([lat, lng]) => {
        const la = Number(lat);
        const ln = Number(lng);
        return (
          Number.isFinite(la) &&
          Number.isFinite(ln) &&
          Math.abs(la) > 0.5 &&
          Math.abs(ln) > 0.5 &&
          Math.abs(la) <= 90 &&
          Math.abs(ln) <= 180
        );
      });
      if (coords.length < 2) return;
      try {
        const bounds = new LatLngBounds(coords);
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [48, 48],
            maxZoom,
            animate: false,
          });
          // Statewide / multi-district bounds zoom too far out � plots become dots.
          if (minZoom != null && map.getZoom() < minZoom) {
            map.setView(bounds.getCenter(), minZoom, { animate: false });
          }
        }
      } catch {
        // ignore invalid geometries
      }
    }, [positions, maxZoom, minZoom, map]);
    return null;
  }

  /** Owner FO / industry plot cloud.
   * One factory ? keep a readable mid zoom.
   * All districts ? fit full bounds (do NOT force zoom-in; that hid most plots).
   */
  function FitFoMapPlots({ plots }: { plots: FoMapPlot[] }) {
    const coords = plots.flatMap((p) => p.positions);
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const [lat, lng] of coords) {
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, ln);
      maxLng = Math.max(maxLng, ln);
    }
    const latSpan = Number.isFinite(minLat) ? maxLat - minLat : 0;
    const lngSpan = Number.isFinite(minLng) ? maxLng - minLng : 0;
    // ~0.35� � 35�40 km � wider than one factory / district cluster
    const multiDistrict = latSpan > 0.35 || lngSpan > 0.35;

    return (
      <FitPlotPositions
        positions={coords}
        maxZoom={multiDistrict ? 11 : 14}
        minZoom={multiDistrict ? undefined : 12}
      />
    );
  }

  const getPlotBorderStyle = () => ({
    color: "#ffffff",
    fillColor: "#10b981",
    fill: true,
    weight: 3,
    opacity: 1,
    // Always paint green inside the boundary (Growth tiles layer on top when present).
    fillOpacity: 0.45,
  });

  /** FO / district overview � green fill on every plot so map is not hollow outlines. */
  const getFoPlotBorderStyle = (plotId: string) => {
    const sel = String(selectedPlotId || "")
      .replace(/^"|"$/g, "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "/");
    const pid = String(plotId || "")
      .replace(/^"|"$/g, "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "/");
    const isSelected = !!sel && sel === pid;
    return {
      color: isSelected ? "#facc15" : "#ffffff",
      fillColor: "#10b981",
      fill: true,
      weight: isSelected ? 3 : 2,
      opacity: 1,
      fillOpacity: isSelected ? 0.5 : 0.35,
    };
  };

  // 1�2) No farmer ? factory dashboard cards. 3) Farmer selected ? plot/farmer metrics.
  const useFoFactoryMetrics =
    !selectedFarmerId && (Boolean(factoryRollup) || loadingFactoryDash);
  const foCropStatusLabel = formatFactoryCropStatusLabel(factoryRollup);
  const foArea = factoryRollup?.total_field_area_acres ?? null;
  const foExpectedYield =
    factoryRollup?.expected_yield_t_per_acre ??
    factoryRollup?.average_yield_t_per_acre ??
    null;
  const foExpectedYieldMin =
    factoryRollup?.expected_yield_min_t_per_acre ?? null;
  const foExpectedYieldMax =
    factoryRollup?.expected_yield_max_t_per_acre ?? null;
  const foBiomassAvg = factoryRollup?.biomass_avg_t_per_acre ?? null;
  const foBiomassMin = factoryRollup?.biomass_min_t_per_acre ?? null;
  const foBiomassMax = factoryRollup?.biomass_max_t_per_acre ?? null;
  const foRecoveryAvg = factoryRollup?.recovery?.factory_avg_pct ?? null;
  const foBrixAvg =
    factoryRollup?.brix_avg != null &&
    Number.isFinite(Number(factoryRollup.brix_avg))
      ? Number(factoryRollup.brix_avg)
      : null;
  const foBrixMin =
    factoryRollup?.brix_min != null &&
    Number.isFinite(Number(factoryRollup.brix_min))
      ? Number(factoryRollup.brix_min)
      : null;
  const foBrixMax =
    factoryRollup?.brix_max != null &&
    Number.isFinite(Number(factoryRollup.brix_max))
      ? Number(factoryRollup.brix_max)
      : null;
  const foFieldScoreAvg =
    factoryRollup?.field_score_avg != null &&
    Number.isFinite(Number(factoryRollup.field_score_avg))
      ? Number(factoryRollup.field_score_avg)
      : null;

  const displayArea = selectedFarmerId
    ? metrics.area  // farmer selected → show that farmer's plot area from analyzeSinglePlot
    : ownerDistrictsAreaSum?.total_area_acres ?? foArea ?? null; // no farmer → total district area
  const displayCropStatus = useFoFactoryMetrics
    ? foCropStatusLabel
    : metrics.growthStage;
  const displayExpectedYield = useFoFactoryMetrics
    ? foExpectedYield
    : metrics.expectedYield;
  const displayBiomassAvg = useFoFactoryMetrics
    ? foBiomassAvg
    : metrics.totalBiomass;
  const displayRecovery = useFoFactoryMetrics
    ? foRecoveryAvg
    : metrics.recovery;
  const displayBrix = useFoFactoryMetrics ? foBrixAvg : metrics.brix;
  const displayBrixMin = useFoFactoryMetrics ? foBrixMin : metrics.brixMin;
  const displayBrixMax = useFoFactoryMetrics ? foBrixMax : metrics.brixMax;
  const displayExpectedYieldMin = useFoFactoryMetrics
    ? foExpectedYieldMin
    : metrics.sugarYieldMin;
  const displayExpectedYieldMax = useFoFactoryMetrics
    ? foExpectedYieldMax
    : metrics.sugarYieldMax;
  const displayBiomassMin = useFoFactoryMetrics
    ? foBiomassMin
    : metrics.biomassMin;
  const displayBiomassMax = useFoFactoryMetrics
    ? foBiomassMax
    : metrics.biomassMax;
  const displayFieldScore = useFoFactoryMetrics
    ? foFieldScoreAvg
    : metrics.fieldScore;
  const foCardsLoading = useFoFactoryMetrics && loadingFactoryDash;

  // Biomass pie: use factory avg when in FO mode; avoid fake zeros when missing
  const totalBiomass = useFoFactoryMetrics
    ? foBiomassAvg ?? 0
    : metrics.totalBiomass ?? 0;
  const currentBiomass = useFoFactoryMetrics
    ? foBiomassAvg != null
      ? foBiomassAvg * 0.12
      : 0
    : metrics.biomass ?? 0;

  // Recovery Rate Comparison (factory mode = Regional + Top 25 recovery %)
  const recoveryComparisonData = useFoFactoryMetrics
    ? factoryRecoveryComparisonBars(factoryRollup)
    : [
        {
          name: "Your Farm",
          value: metrics.recovery ?? 0,
          fill: "#10b981",
          label: "Your Recovery Rate",
        },
        {
          name: "Regional Average",
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

  const recoveryYMax = Math.max(
    10,
    ...recoveryComparisonData.map((d) => Number(d.value) || 0),
  );

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
      {showNDREEvents && (
        <div className="flex items-center gap-1 ml-1 px-2 py-1 bg-orange-100 rounded-md border border-orange-300">
          <div className="w-2 h-2 rounded-full bg-orange-500 border border-orange-600"></div>
          <span className="text-orange-800 font-semibold text-xs">Stress</span>
        </div>
      )}
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
                4,
              )} (${getStressSeverityLabel(entry.value)})`;
              displayLabel = "NDRE Stress Level";
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

  // Gauge component
  const PieChartWithNeedle: React.FC<PieChartWithNeedleProps> = ({
    value,
    max,
    width = GAUGE_ARC_WIDTH,
    height,
    title = "Gauge",
    unit = "",
    showTitle = false,
  }) => {
    const percent = Math.max(0, Math.min(1, value / max));
    const angle = 180 * percent;
    const strokeW = 9;
    const r = Math.round(width * 0.3);
    const cx = width / 2;
    const cy = r + strokeW / 2 + 3;
    const svgHeight = height ?? cy + 4;
    const needleLength = r * 0.88;
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
      <div className="flex flex-col items-center gap-0">
        <div className="text-center leading-none">
          <div className="text-lg font-bold text-gray-800">
            {value.toFixed(1)}
            <span className="text-sm font-semibold text-gray-600">{unit}</span>
          </div>
        </div>
        <svg
          width={width}
          height={svgHeight}
          viewBox={`0 0 ${width} ${svgHeight}`}
          className="block -mt-1.5"
          aria-hidden
        >
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeW}
          />
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${
              cx + r * Math.cos(Math.PI - (angle * Math.PI) / 180)
            } ${cy - r * Math.sin(Math.PI - (angle * Math.PI) / 180)}`}
            fill="none"
            stroke={getColor(percent)}
            strokeWidth={strokeW}
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
        </svg>
        {showTitle && (
          <p className="text-xs font-medium text-gray-600">{title}</p>
        )}
      </div>
    );
  };

  // Shared metric-card layout: equal height in grid row, footer pinned to bottom.
  const metricCardShell =
    "bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 border hover:shadow-xl transition-all duration-300 flex flex-col gap-1.5 h-full w-full [&>*:last-child]:mt-auto";

  const MetricListRow = ({
    label,
    value,
    tone,
  }: {
    label: string;
    value: React.ReactNode;
    tone: string;
  }) => (
    <div className="flex items-center justify-between gap-2 text-xs leading-4 w-full">
      <span className="text-gray-700 text-left whitespace-nowrap shrink-0">
        {label}
      </span>
      <span
        className={`font-medium tabular-nums whitespace-nowrap shrink-0 ${tone}`}
      >
        {value}
      </span>
    </div>
  );

  // IMPORTANT: Do not block the whole UI on hierarchy loading.
  // Dropdowns will show "Loading..." until data arrives.
  // This avoids long full-screen spinners for Owner dashboard.

  // const totalFarmers = fieldOfficers.reduce(
  //   (acc, officer) => acc + (officer.farmers?.length || 0),
  //   0
  // );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
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
                    endpoint: `${import.meta.env.VITE_API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"}/farms/?farmer_id={id}`,
                    method: "GET",
                    bearerToken: localStorage.getItem("token")
                      ? "? Present"
                      : "? Missing",
                    tokenPreview:
                      localStorage.getItem("token")?.substring(0, 30) + "...",
                    // totalFarmers: farmers.length,
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
              ?? Check the browser console for detailed API request/response
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
                    Managers ({managers.length})
                  </label>
                  <select
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64"
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    disabled={loadingHierarchy}
                  >
                    {loadingHierarchy ? (
                      <option>Loading...</option>
                    ) : managers.length === 0 ? (
                      <option>No managers found</option>
                    ) : (
                      <>
                        <option value="">Select a manager</option>
                        {managers.map((manager) => (
                          <option
                            key={`manager-${manager.id}`}
                            value={manager.id}
                          >
                            {manager.first_name} {manager.last_name} (
                            {manager.field_officers_count ??
                              manager.field_officers?.length ??
                              (manager.field_officers_count === 0 ? 0 : "�")}{" "}
                            FOs)
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                <div className="flex flex-col flex-1 sm:flex-none">
                  <label className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Field Officer ({fieldOfficers.length})
                  </label>
                  <select
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64"
                    value={selectedFieldOfficerId}
                    onChange={(e) => setSelectedFieldOfficerId(e.target.value)}
                    disabled={!selectedManagerId || fieldOfficers.length === 0}
                  >
                    {!selectedManagerId ? (
                      <option>Select a manager first</option>
                    ) : fieldOfficers.length === 0 ? (
                      <option>No officers found</option>
                    ) : (
                      <>
                        <option value="">Select an officer</option>
                        {fieldOfficers.map((officer) => (
                          <option
                            key={`officer-${officer.id ?? officer.user_id}`}
                            value={String(officer.id ?? officer.user_id ?? "")}
                          >
                            {officer.first_name} {officer.last_name} (
                            {officer.farmers_count ??
                              officer.farmers?.length ??
                              0}{" "}
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
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64"
                    value={selectedFarmerId}
                    onChange={(e) => {
                      const nextFarmerId = e.target.value;
                      lastFetchedFarmerIdRef.current = "";
                      dashboardLoadedForPlotRef.current = "";
                      setPlots([]);
                      setSelectedPlotId("");
                      setPlotCoordinates([]);
                      setSelectedFarmerId(nextFarmerId);
                    }}
                    disabled={
                      !selectedFieldOfficerId ||
                      loadingFarmersForOfficer ||
                      farmersForSelectedOfficer.length === 0
                    }
                  >
                    {!selectedFieldOfficerId ? (
                      <option>Select an officer first</option>
                    ) : loadingHierarchy || loadingFarmersForOfficer ? (
                      <option>Loading farmers...</option>
                    ) : farmersForSelectedOfficer.length === 0 ? (
                      <option>No farmers found</option>
                    ) : (
                      <>
                        <option value="">Select a farmer</option>
                        {farmersForSelectedOfficer.map((farmer) => {
                          const farmerId = getFarmerId(farmer) ?? "";
                          const farmerName =
                            `${farmer.first_name ?? ""} ${farmer.last_name ?? ""}`.trim() ||
                            farmer.name ||
                            farmer.username ||
                            `Farmer ${farmerId}`;
                          const plotsCount =
                            String(farmerId) === String(selectedFarmerId)
                              ? plots.length
                              : (farmerPlotsCache[farmerId]?.length ?? 0);
                          const label =
                            plotsCount > 0
                              ? `${farmerName} (${plotsCount} plot${plotsCount !== 1 ? "s" : ""})`
                              : farmerName;

                          return (
                            <option key={`farmer-${farmerId}`} value={farmerId}>
                              {label}
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
                    className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm w-full sm:w-64"
                    value={selectedPlotId}
                    onChange={(e) => {
                      const newPlotId = e.target.value;
                      setSelectedPlotId(newPlotId);
                      if (newPlotId) {
                        const plot = findPlotInSelection(newPlotId);
                        if (!plot || !applyCoordinatesFromPlot(plot)) {
                          void fetchPlotCoordinates(newPlotId);
                        }
                      }
                    }}
                    disabled={
                      !selectedFarmerId || loadingFarmerPlots || plots.length === 0
                    }
                  >
                    {!selectedFarmerId ? (
                      <option value="">Select farmer first</option>
                    ) : loadingFarmerPlots ? (
                      <option value="">Loading plots...</option>
                    ) : plots.length === 0 ? (
                      <option value="">No plots available</option>
                    ) : (
                      <>
                        <option value="">Select a plot</option>
                        {plots.map((plotId, index) => {
                          return (
                            <option
                              key={`plot-${plotId}-${index}`}
                              value={plotId}
                            >
                              {plotId}
                            </option>
                          );
                        })}
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
        {plotStatsError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{toSafeUserError(plotStatsError)}</span>
          </div>
        )}
        {/* Top Priority Metrics - 4 Key Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          <div className={`${metricCardShell} border-green-200`}>
            <div className="flex items-start justify-between gap-2">
              <MapPin className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
              <div className="text-right min-w-0 flex-1">
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-gray-800 tabular-nums">
                      {displayArea != null ? Number(displayArea).toFixed(2) : "-"}
                    </div>
                    <div className="text-sm font-medium text-green-600">acre</div>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-800 font-bold">
              Field Area
            </p>
          </div>

          <div className={`${metricCardShell} border-emerald-200`}>
            {useFoFactoryMetrics && factoryRollup?.crop_status?.counts ? (
              <>
                <div className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-emerald-600 shrink-0" />
                </div>
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="space-y-1 w-full">
                    <MetricListRow
                      label="Harvest Maturity"
                      value={`${Number(factoryRollup.crop_status.counts.harvest_maturity ?? 0)} plots`}
                      tone="text-emerald-600"
                    />
                    <MetricListRow
                      label="Grand Growth"
                      value={`${Number(factoryRollup.crop_status.counts.grand_growth ?? 0)} plots`}
                      tone="text-emerald-600"
                    />
                    <MetricListRow
                      label="Tillering"
                      value={`${Number(factoryRollup.crop_status.counts.tillering ?? 0)} plots`}
                      tone="text-emerald-600"
                    />
                    {Number(factoryRollup.crop_status.counts.other_or_unknown ?? 0) >
                    0 ? (
                      <MetricListRow
                        label="Other"
                        value={`${Number(factoryRollup.crop_status.counts.other_or_unknown ?? 0)} plots`}
                        tone="text-emerald-600"
                      />
                    ) : null}
                  </div>
                )}
                <p className="text-xs text-gray-800 font-bold">Crop Status</p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Leaf className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-right min-w-0">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                      <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                    ) : (
                      <div className="text-2xl font-bold text-gray-800">
                        {displayCropStatus || "-"}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-800 font-bold">Crop Status</p>
              </>
            )}
          </div>

          <div className={`${metricCardShell} border-orange-200`}>
            {useFoFactoryMetrics && factoryRollup?.days_to_harvest ? (
              <>
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-orange-600 shrink-0" />
                </div>
                {foCardsLoading ||
                (useFoFactoryMetrics && loadingFactoryDash) ||
                (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="space-y-1 w-full">
                    <MetricListRow
                      label="<=15 days"
                      value={`${Number(factoryRollup.days_to_harvest.within_15_days ?? 0)} plots`}
                      tone="text-orange-600"
                    />
                    <MetricListRow
                      label="<=1 month"
                      value={`${Number(factoryRollup.days_to_harvest.within_1_month ?? 0)} plots`}
                      tone="text-orange-600"
                    />
                    <MetricListRow
                      label="<=45 days"
                      value={`${Number(factoryRollup.days_to_harvest.within_45_days ?? 0)} plots`}
                      tone="text-orange-600"
                    />
                    <MetricListRow
                      label="<=90 days"
                      value={`${Number(factoryRollup.days_to_harvest.within_90_days ?? 0)} plots`}
                      tone="text-orange-600"
                    />
                    <MetricListRow
                      label="<=120 days"
                      value={`${Number(factoryRollup.days_to_harvest.within_120_days ?? 0)} plots`}
                      tone="text-orange-600"
                    />
                  </div>
                )}
                <p className="text-xs text-gray-800 font-bold">
                  Days to Harvest
                  {factoryRollup.days_to_harvest.plots_with_days_to_harvest !=
                  null ? (
                    <span className="text-gray-400 font-normal">
                      {" "}
                      -{" "}
                      {Number(
                        factoryRollup.days_to_harvest.plots_with_days_to_harvest,
                      )}{" "}
                      plots
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Calendar className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                  <div className="text-right min-w-0">
                    {foCardsLoading ||
                    (useFoFactoryMetrics && loadingFactoryDash) ||
                    (!useFoFactoryMetrics && loadingData) ? (
                      <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-gray-800 tabular-nums">
                          {metrics.growthStage?.toLowerCase().includes("harvested")
                            ? 0
                            : metrics.daysToHarvest !== null
                              ? metrics.daysToHarvest
                              : "-"}
                        </div>
                        <div className="text-sm font-medium text-orange-600">
                          Days
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-800 font-bold">
                  Days to Harvest
                </p>
              </>
            )}
          </div>

          <div className={`${metricCardShell} border-blue-200`}>
            <div className="flex items-start justify-between gap-2">
              <Beaker className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-right min-w-0">
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                ) : (
                  <div className="text-2xl font-bold text-gray-800 flex items-baseline gap-1 justify-end tabular-nums">
                    {displayBrix != null ? Number(displayBrix).toFixed(2) : "-"}
                    <span className="text-sm font-medium text-blue-600">
                      Brix(Avg)
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
              <p className="font-bold shrink-0 text-gray-800">Sugar Content</p>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-semibold text-red-600 tabular-nums leading-tight">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                      ? "-"
                      : displayBrixMax != null
                        ? Number(displayBrixMax).toFixed(2)
                        : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
                    Max
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-green-600 tabular-nums leading-tight">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                      ? "-"
                      : displayBrixMin != null
                        ? Number(displayBrixMin).toFixed(2)
                        : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
                    Min
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 items-stretch">
          <div className={`${metricCardShell} border-purple-200`}>
            <div className="flex items-start justify-between gap-2">
              <Target className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
              <div className="text-right min-w-0 flex-1">
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-gray-800 tabular-nums">
                      {displayRecovery != null
                        ? Number(displayRecovery).toFixed(1)
                        : "-"}
                    </div>
                    <div className="text-sm font-medium text-purple-600">%</div>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-800 font-bold">
              Recovery Rate
            </p>
          </div>

          <div className={`${metricCardShell} border-emerald-200`}>
            {useFoFactoryMetrics && factoryRollup?.field_score_distribution ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Gauge className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">
                    Score
                  </span>
                </div>
                {foCardsLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="space-y-1 w-full">
                    <MetricListRow
                      label=">80%"
                      value={Number(
                        factoryRollup.field_score_distribution.above_80 ?? 0,
                      )}
                      tone="text-emerald-600"
                    />
                    <MetricListRow
                      label="60-80%"
                      value={Number(
                        factoryRollup.field_score_distribution.between_60_80 ??
                          0,
                      )}
                      tone="text-emerald-600"
                    />
                    <MetricListRow
                      label="40-60%"
                      value={Number(
                        factoryRollup.field_score_distribution.between_40_60 ??
                          0,
                      )}
                      tone="text-emerald-600"
                    />
                    <MetricListRow
                      label="<40%"
                      value={Number(
                        factoryRollup.field_score_distribution.below_40 ?? 0,
                      )}
                      tone="text-emerald-600"
                    />
                  </div>
                )}
                <p className="text-xs text-gray-800 font-bold">
                  Field Score
                  {factoryRollup.field_score_distribution
                    ?.plots_with_field_score != null ? (
                    <span className="text-gray-400 font-normal">
                      {" "}
                      -{" "}
                      {Number(
                        factoryRollup.field_score_distribution
                          .plots_with_field_score,
                      )}{" "}
                      plots
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Gauge className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-right min-w-0">
                    {useFoFactoryMetrics ? (
                      foCardsLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                      ) : displayFieldScore != null ? (
                        <>
                          <div className="text-2xl font-bold text-gray-800 tabular-nums">
                            {Number(displayFieldScore).toFixed(1)}
                          </div>
                          <div className="text-sm font-medium text-emerald-600">
                            %
                          </div>
                        </>
                      ) : (
                        "-"
                      )
                    ) : !selectedPlotId ? (
                      <div className="text-2xl font-bold text-gray-800">0</div>
                    ) : loadingData ||
                      (metrics.fieldScore === null &&
                        loadingSections.irrigation) ? (
                      <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-gray-800 tabular-nums">
                          {(metrics.fieldScore ?? 0).toFixed(1)}
                        </div>
                        <div className="text-sm font-medium text-emerald-600">
                          %
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-800 font-bold">Field Score</p>
              </>
            )}
          </div>

          <div className={`${metricCardShell} border-indigo-200`}>
            {useFoFactoryMetrics &&
            factoryRollup?.expected_yield_distribution ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-600 shrink-0" />
                  <span className="text-[10px] text-indigo-600 font-medium uppercase tracking-wide">
                    T/h
                  </span>
                </div>
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="space-y-1 w-full">
                    <MetricListRow
                      label=">100"
                      value={Number(
                        factoryRollup.expected_yield_distribution.above_100 ??
                          0,
                      )}
                      tone="text-indigo-600"
                    />
                    <MetricListRow
                      label="75-100"
                      value={Number(
                        factoryRollup.expected_yield_distribution
                          .between_75_100 ?? 0,
                      )}
                      tone="text-indigo-600"
                    />
                    <MetricListRow
                      label="50-75"
                      value={Number(
                        factoryRollup.expected_yield_distribution
                          .between_50_75 ?? 0,
                      )}
                      tone="text-indigo-600"
                    />
                    <MetricListRow
                      label="<50"
                      value={Number(
                        factoryRollup.expected_yield_distribution.below_50 ?? 0,
                      )}
                      tone="text-indigo-600"
                    />
                  </div>
                )}
                <p className="text-xs text-gray-800 font-bold">
                  Expected Yield
                  {factoryRollup.expected_yield_distribution.plots_with_yield !=
                  null ? (
                    <span className="text-gray-400 font-normal">
                      {" "}
                      -{" "}
                      {Number(
                        factoryRollup.expected_yield_distribution
                          .plots_with_yield,
                      )}{" "}
                      plots
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <BarChart3 className="w-6 h-6 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="text-right min-w-0">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                      <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-gray-800 tabular-nums">
                          {displayExpectedYield != null
                            ? Number(displayExpectedYield).toFixed(1)
                            : "-"}
                        </div>
                        <div className="text-sm font-medium text-indigo-600">
                          {useFoFactoryMetrics ? "T/hectare" : "T/acre"}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  <p className="font-bold shrink-0 text-gray-800">Expected Yield</p>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-semibold text-red-600 text-sm tabular-nums leading-tight">
                        {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                          ? "-"
                          : displayExpectedYieldMax != null
                            ? Number(displayExpectedYieldMax).toFixed(1)
                            : "-"}
                      </div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
                        Max
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-green-600 text-sm tabular-nums leading-tight">
                        {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                          ? "-"
                          : displayExpectedYieldMin != null
                            ? Number(displayExpectedYieldMin).toFixed(1)
                            : "-"}
                      </div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
                        Min
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {(() => {
            const factoryCci = useFoFactoryMetrics
              ? factoryRollup?.cci_avg ?? null
              : null;
            const cciStyle = cropConditionStyleFromCci(
              selectedPlotId ? metrics.cropConditionValue : null,
            );
            const showPlotCci =
              selectedPlotId &&
              !loadingSections.waterStress &&
              metrics.cropConditionValue != null;

            return (
              <div className={`${metricCardShell} border-emerald-200`}>
                <div className="flex items-start justify-between gap-2">
                  <Sprout className="w-6 h-6 shrink-0 text-emerald-600 mt-0.5" />
                  <div className="text-right min-w-0 flex-1">
                    <div className="text-2xl font-bold text-gray-800 tabular-nums">
                      {selectedPlotId ? (
                        loadingSections.waterStress ? (
                          <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                        ) : (
                          (metrics.cropConditionValue ?? 0).toFixed(1)
                        )
                      ) : foCardsLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                      ) : factoryCci != null ? (
                        Number(factoryCci).toFixed(1)
                      ) : (
                        "-"
                      )}
                    </div>
                    <div
                      className="text-sm font-medium leading-tight max-w-[7.5rem] ml-auto truncate"
                      style={{
                        color: showPlotCci
                          ? (cciStyle?.textColor ?? "#6b7280")
                          : "#059669",
                      }}
                      title={
                        showPlotCci
                          ? (cciStyle?.label ?? metrics.cropConditionLabel ?? "")
                          : factoryCci != null
                            ? "Factory CCI average"
                            : undefined
                      }
                    >
                      {selectedPlotId
                        ? loadingSections.waterStress
                          ? "CCI"
                          : (cciStyle?.label ??
                            metrics.cropConditionLabel ??
                            "CCI")
                        : "CCI avg"}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-800 font-bold">
                  Crop Condition Index
                  {!selectedPlotId && factoryCci != null ? (
                    <span className="text-gray-400 font-normal"> - 0-100</span>
                  ) : null}
                </p>
              </div>
            );
          })()}

          <div className={`${metricCardShell} border-red-200`}>
            <div className="flex items-start justify-between gap-2">
              <Activity className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div className="text-right min-w-0 flex-1">
                <div className="text-2xl font-bold text-gray-800 tabular-nums">
                  {!selectedPlotId ? (
                    "0"
                  ) : loadingSections.waterStress ? (
                    <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                  ) : (
                    metrics.stressCount ?? 0
                  )}
                </div>
                <div className="text-sm font-medium text-red-600">
                  {!selectedPlotId || loadingSections.waterStress
                    ? "Total days"
                    : `${metrics.stressTotalDays ?? 0} days`}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-800 font-bold">
              Stress Events
            </p>
          </div>

          <div className={`${metricCardShell} border-pink-200`}>
            <div className="flex items-start justify-between gap-2">
              <Activity className="w-6 h-6 text-pink-600 shrink-0 mt-0.5" />
              <div className="text-right min-w-0">
                {foCardsLoading || (!useFoFactoryMetrics && loadingData) ? (
                  <Loader2 className="w-5 h-5 animate-spin ml-auto" />
                ) : (
                  <div className="text-2xl font-bold text-gray-800 flex items-baseline gap-1 justify-end tabular-nums">
                    {displayBiomassAvg !== null
                      ? Number(displayBiomassAvg).toFixed(1)
                      : "-"}
                    <span className="text-sm font-medium text-pink-600">
                      T/acre
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
              <p className="font-bold shrink-0 text-gray-800">Avg Biomass</p>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="font-semibold text-red-600 text-sm tabular-nums leading-tight">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                      ? "-"
                      : displayBiomassMax != null
                        ? Number(displayBiomassMax).toFixed(1)
                        : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
                    Max
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-green-600 text-sm tabular-nums leading-tight">
                    {foCardsLoading || (!useFoFactoryMetrics && loadingData)
                      ? "-"
                      : displayBiomassMin != null
                        ? Number(displayBiomassMin).toFixed(1)
                        : "-"}
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">
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

              {/* Loading overlay when switching farmer/plot */}
              {isFarmerDataLoading && selectedPlotId ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 backdrop-blur-[1px] pointer-events-none">
                  <div className="bg-white/90 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 border border-white/60">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    <div className="text-sm text-gray-800">
                      <div className="font-semibold">
                        Loading data for {selectedFarmerNameForUi}
                      </div>
                      <div className="text-xs text-gray-600">
                        Plot: {selectedPlotId}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <MapCropStatusOverlay
                growthStage={
                  useFoFactoryMetrics
                    ? displayCropStatus
                    : metrics.growthStage
                }
                plantationDate={displayPlantationDate}
                plantationType={displayPlantationType}
                loading={
                  useFoFactoryMetrics
                    ? foCardsLoading && !displayCropStatus
                    : Boolean(
                        (loadingData || isFarmerDataLoading) &&
                          !metrics.growthStage,
                      )
                }
              />

              <MapContainer
                key={`owner-farm-map-${selectedFieldOfficerId || "none"}-${selectedPlotId || "none"}-${mapKey}`}
                center={mapCenter}
                zoom={
                  selectedPlotId && plotCoordinates.length > 0
                    ? 17
                    : foMapPlots.length > 0
                      ? 12
                      : 15
                }
                minZoom={8}
                maxZoom={20}
                className="w-full h-full z-0"
                style={{
                  height: "100%",
                  width: "100%",
                  borderRadius: "inherit",
                  position: "relative",
                }}
              >
                {selectedPlotId && plotCoordinates.length > 0 ? (
                  <FitPlotPositions positions={plotCoordinates} maxZoom={18} />
                ) : foMapPlots.length > 0 ? (
                  <FitFoMapPlots plots={foMapPlots} />
                ) : (
                  <MapAutoCenter center={mapCenter} zoom={15} />
                )}
                <TileLayer
                  url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                  attribution="� Google"
                  maxZoom={20}
                  maxNativeZoom={18}
                  minZoom={8}
                  tileSize={256}
                  zoomOffset={0}
                  updateWhenZooming={false}
                  updateWhenIdle={true}
                />
                {growthOverlayUrl &&
                  growthOverlayBounds &&
                  selectedPlotId &&
                  plotCoordinates.length > 0 && (
                    <Pane name="ownerGrowthOverlay" style={{ zIndex: 450 }}>
                      <ClipOwnerGrowthPane
                        paneName="ownerGrowthOverlay"
                        positions={plotCoordinates}
                        enabled={plotCoordinates.length >= 3}
                      />
                      {isStoredAnalysisPngUrl(growthOverlayUrl) ? (
                        <ImageOverlay
                          key={`growth-png-${selectedPlotId}-${growthOverlayUrl}`}
                          url={growthOverlayUrl}
                          bounds={growthOverlayBounds}
                          opacity={0.85}
                          pane="ownerGrowthOverlay"
                          zIndex={450}
                        />
                      ) : isXyzTileTemplate(growthOverlayUrl) ? (
                        <TileLayer
                          key={`growth-xyz-${selectedPlotId}-${growthOverlayUrl}`}
                          url={growthOverlayUrl}
                          opacity={0.85}
                          maxZoom={22}
                          minZoom={1}
                          tileSize={256}
                          pane="ownerGrowthOverlay"
                          zIndex={450}
                        />
                      ) : null}
                    </Pane>
                  )}
                <Pane name="ownerPlotBorder" style={{ zIndex: 560 }}>
                {selectedPlotId && plotCoordinates.length > 0 ? (
                  <Polygon
                    key={`owner-plot-fill-${selectedPlotId}-${plotCoordinates.length}`}
                    positions={plotCoordinates}
                    pathOptions={getPlotBorderStyle()}
                  >
                    <LeafletTooltip
                      direction="top"
                      offset={[0, -10]}
                      opacity={0.9}
                      sticky
                    >
                      <div className="text-sm">
                        <p>
                          <strong>Plot:</strong> {selectedPlotId}
                        </p>
                        <p>
                          <strong>Status:</strong>{" "}
                          {metrics.growthStage ?? "Loading..."}
                        </p>
                        <p>
                          <strong>Area:</strong>{" "}
                          {metrics.area ?? "Loading..."} Ha
                        </p>
                      </div>
                    </LeafletTooltip>
                  </Polygon>
                ) : foMapPlots.length > 0 ? (
                  foMapPlots.map((plot) => (
                      <Polygon
                        key={`fo-plot-${plot.plotId}-${plot.positions.length}`}
                        positions={plot.positions}
                        pathOptions={getFoPlotBorderStyle(plot.plotId)}
                      >
                        <LeafletTooltip
                          direction="top"
                          offset={[0, -10]}
                          opacity={0.9}
                          sticky
                        >
                          <div className="text-sm">
                            <p>
                              <strong>Plot:</strong> {plot.plotId}
                            </p>
                            <p>
                              <strong>Status:</strong>{" "}
                              {plot.status ?? displayCropStatus ?? "�"}
                            </p>
                            {plot.areaAcres != null && (
                              <p>
                                <strong>Area:</strong>{" "}
                                {plot.areaAcres.toFixed(2)} acre
                              </p>
                            )}
                          </div>
                        </LeafletTooltip>
                      </Polygon>
                    ))
                ) : null}
                </Pane>
              </MapContainer>
            </div>
          </div>

          {/* Performance Gauges */}
          <div className="space-y-3">
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Target className="w-4 h-4 shrink-0 text-purple-600" />
                <h3 className="text-sm font-semibold text-gray-800">
                  Sugarcane Yield Projection
                </h3>
              </div>
              <div
                className="flex items-center justify-center"
                style={{ height: GAUGE_CHART_HEIGHT }}
              >
                <PieChartWithNeedle
                  value={displayExpectedYield || 0}
                  max={
                    useFoFactoryMetrics
                      ? Math.max(
                          Number(displayExpectedYieldMax) || 0,
                          Number(displayExpectedYield) || 0,
                          100,
                        ) * 1.05
                      : metrics.sugarYieldMax || 400
                  }
                  title="Sugarcane Yield Forecast"
                  unit=" T/acre"
                  width={GAUGE_ARC_WIDTH}
                />
              </div>
              <div className="mt-1 text-center">
                <p className="mb-1 text-xs font-medium text-gray-600">
                  Sugarcane Yield Forecast
                </p>
                <div className="grid grid-cols-1 gap-y-0.5 text-xs sm:grid-cols-3 sm:gap-x-2">
                  <div className="flex items-center justify-center gap-1">
                    <div className="h-2 w-2 rounded bg-red-500" />
                    <span className="font-semibold text-red-700">
                      min:{" "}
                      {(
                        displayExpectedYieldMin ??
                        (useFoFactoryMetrics
                          ? displayExpectedYield
                          : metrics.sugarYieldMin) ??
                        0
                      ).toFixed(1)}{" "}
                      T/acre
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <div className="h-2 w-2 rounded bg-purple-500" />
                    <span className="font-semibold text-purple-700">
                      mean: {(displayExpectedYield || 0).toFixed(1)} T/acre
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <div className="h-2 w-2 rounded bg-green-500" />
                    <span className="font-semibold text-green-700">
                      max:{" "}
                      {(
                        displayExpectedYieldMax ??
                        (useFoFactoryMetrics
                          ? displayExpectedYield
                          : metrics.sugarYieldMax) ??
                        0
                      ).toFixed(1)}{" "}
                      T/acre
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  Performance:{" "}
                  {useFoFactoryMetrics
                    ? "FO factory rollup"
                    : metrics.sugarYieldMax
                      ? (
                          ((metrics.expectedYield || 0) /
                            metrics.sugarYieldMax) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                  {useFoFactoryMetrics ? "" : "% of optimal yield"}
                </div>
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Activity className="w-4 h-4 shrink-0 text-green-600" />
                <h3 className="text-sm font-semibold text-gray-800">
                  Biomass Performance
                </h3>
              </div>
              <div
                className="flex items-center justify-center"
                style={{ height: GAUGE_CHART_HEIGHT }}
              >
                {foCardsLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-green-600" />
                  </div>
                ) : useFoFactoryMetrics && foBiomassAvg == null ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-xs text-gray-500">No biomass data</p>
                  </div>
                ) : (
                  <PieChartWithNeedle
                    value={totalBiomass || 0}
                    max={Math.max(
                      totalBiomass || 0,
                      currentBiomass || 0,
                      100,
                    ) * 1.05}
                    title="Biomass Forecast"
                    unit=" T/acre"
                    width={GAUGE_ARC_WIDTH}
                  />
                )}
              </div>
              {!(useFoFactoryMetrics && foBiomassAvg == null) &&
              !foCardsLoading ? (
                <div className="mt-1 text-center">
                  <p className="mb-1 text-xs font-medium text-gray-600">
                    Biomass Forecast
                  </p>
                  <div className="grid grid-cols-1 gap-y-0.5 text-xs sm:grid-cols-3 sm:gap-x-2">
                    <div className="flex items-center justify-center gap-1">
                      <div className="h-2 w-2 rounded bg-blue-500" />
                      <span className="font-semibold text-blue-700">
                        Total: {(totalBiomass || 0).toFixed(1)} T/acre
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-1">
                      <div className="h-2 w-2 rounded bg-purple-500" />
                      <span className="font-semibold text-purple-700">
                        mean: {(totalBiomass || 0).toFixed(1)} T/acre
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-1">
                      <div className="h-2 w-2 rounded bg-green-500" />
                      <span className="font-semibold text-green-700">
                        Underground: {(currentBiomass || 0).toFixed(1)} T/acre
                      </span>
                    </div>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Performance:{" "}
                    {useFoFactoryMetrics
                      ? "FO factory rollup"
                      : totalBiomass > 0
                        ? (
                            (currentBiomass / totalBiomass) *
                            100
                          ).toFixed(1)
                        : "0.0"}
                    {useFoFactoryMetrics ? "" : "% underground"}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Recovery Rate Comparison */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-3">
                <div className="flex items-center gap-2 mb-2 lg:mb-0">
                  <Users className="w-5 h-5 text-blue-600" />
                  <h3 className="text-sm font-semibold text-gray-800">
                    Recovery Rate Comparison
                  </h3>
                </div>
              </div>
              <div className="h-36 flex items-center justify-center">
                {foCardsLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                ) : recoveryComparisonData.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No recovery comparison data
                  </p>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={recoveryComparisonData}
                    margin={{ top: 1, right: 5, left: -20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9 }}
                      height={18}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 8 }}
                      domain={[0, Math.ceil(recoveryYMax * 1.15) || 10]}
                    />
                    <Tooltip
                      formatter={(value: number, _name, item) => [
                        `${Number(value).toFixed(1)}%`,
                        (item?.payload as { label?: string })?.label ||
                          "Recovery Rate",
                      ]}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]}>
                      {recoveryComparisonData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
              <div className="mt-2 text-center text-xs text-gray-600">
                {useFoFactoryMetrics ? (
                  <>
                    <span className="font-semibold text-blue-700">
                      Regional:{" "}
                      {factoryRecoveryPeers?.factoryAvg != null
                        ? `${factoryRecoveryPeers.factoryAvg.toFixed(1)}%`
                        : "�"}
                    </span>
                    {" � "}
                    <span className="font-semibold text-green-700">
                      Top 25:{" "}
                      {factoryRecoveryPeers?.top25Avg != null
                        ? `${factoryRecoveryPeers.top25Avg.toFixed(1)}%`
                        : "�"}
                    </span>
                    {factoryRecoveryPeers?.similarPct != null ? (
                      <>
                        {" � "}
                        <span className="font-semibold text-amber-700">
                          Similar plots:{" "}
                          {`${factoryRecoveryPeers.similarPct.toFixed(1)}%`}
                          <span className="font-normal text-gray-500">
                            {" "}
                            (share within tolerance)
                          </span>
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-green-700">
                      Your Farm: {(metrics.recovery ?? 0).toFixed(1)}%
                    </span>
                    {" vs "}
                    <span className="font-semibold text-blue-700">
                      Regional Avg:{" "}
                      {OTHER_FARMERS_RECOVERY.regional_average.toFixed(1)}%
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Field Indices Analysis Chart */}
        <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-2 sm:p-4">
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

                {/* Performance zone annotations - Dynamic based on visible indices */}
                {(() => {
                  // Define ranges for each index type
                  const indexRanges = {
                    water: { good: [0.4, 0.8], bad: [-0.3, -0.75] },
                    moisture: { good: [-0.25, 0.8], bad: [-0.6, -0.75] },
                    growth: { good: [0.2, 0.8], bad: [0.15, -0.75] },
                    stress: { good: [0.35, 0.8], bad: [0.2, -0.75] },
                  };

                  // Count visible indices
                  const visibleCount = Object.values(visibleLines).filter(
                    (v) => v,
                  ).length;

                  let goodRange: [number, number] = [0.3, 0.6]; // Default values
                  let badRange: [number, number] = [-0.1, 0.1]; // Default values
                  let labelText = "Average";

                  if (visibleCount === 1) {
                    // Single index selected - use its specific range
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
                  } else {
                    // Multiple or no indices - use averaged ranges
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
                    labelText = "Average";
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
                              Average
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
      </div>
    </div>
  );
};

export default OwnerFarmDash;
