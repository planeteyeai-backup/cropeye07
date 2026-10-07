import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Factory,
  History,
  LayoutGrid,
  Layers,
  Lock,
  MapPin,
  ShieldCheck,
  Sprout,
  Stethoscope,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import api, {
  fetchDistrictTotalPlotArea,
  fetchOwnerDistrictsTotalPlotAreaSum,
  getCurrentUser,
  getFarmsByFarmerId,
  getFieldOfficerAgroStats,
  getTeamConnect,
  OWNER_HARVEST_DISTRICT_SLUGS,
  resolveManagerDistrictForEventsApi,
  type DistrictTotalPlotAreaResponse,
  type OwnerDistrictsTotalPlotAreaSum,
} from "../api";
import {
  parseOwnerHierarchyResponse,
  parseTeamConnectHierarchy,
  pickBestHierarchy,
  type TeamConnectHierarchy,
} from "../utils/teamConnectHarvest";
import { factoryDashboardEndDate, factoryRecoveryPeersFromRollup, type FactoryDashboardFactory } from "../utils/factoryOwnerDashboard";
import { getUserData, getUserRole } from "../utils/auth";
import { getCache, setCache } from "../utils/cache";
import {
  buildFarmerRows,
  buildOverviewManagers,
  compareWindows,
  diagnoseIssues,
  healthScore,
  initials,
  mergeRollup,
  metricsFromPlots,
  normKey,
  orphanAgroPlotsForOfficer,
  plotGrowthTrend,
  withExtras,
  type IndexPoint,
  type Issue,
  type OverviewFarmer,
  type OverviewManager,
  type OverviewPlot,
  type PlotExtra,
  type ScopeMetrics,
} from "../utils/ownerOverview";
import {
  fetchAllFarmersByFieldOfficer,
  fetchManagerRollup,
  fetchPlotCondition,
  fetchPlotFieldScore,
  fetchPlotIndices,
  fetchPlotStress,
  runQueue,
  sampleAcrossOfficers,
} from "../utils/ownerOverviewApi";
import { CountUp, fmt, Panel, RingScore, SectionTitle, SelectBox } from "./ownerOverview/ui";
import BirdEyeCards from "./ownerOverview/BirdEyeCards";
import OverviewMap, { type ColorMode } from "./ownerOverview/OverviewMap";
import IssueDiagnosis from "./ownerOverview/IssueDiagnosis";
import ConditionTrends from "./ownerOverview/ConditionTrends";
import PerformancePanels from "./ownerOverview/PerformancePanels";
import FarmerConditionTable from "./ownerOverview/FarmerConditionTable";
import ManagerPicker from "./ownerOverview/ManagerPicker";

const HIERARCHY_CACHE_KEY = "ownerOverviewHierarchy_v3";
const HIERARCHY_TTL_MS = 30 * 60 * 1000;
/** Plots whose history is pulled per scope (sampled round-robin across FOs). */
const HISTORY_SAMPLE = { manager: 24, officer: 40, farmer: 20 };

const SECTIONS = [
  { id: "ov-params", label: "Parameters", icon: LayoutGrid },
  { id: "ov-map", label: "Map", icon: MapPin },
  { id: "ov-issues", label: "Diagnosis", icon: Stethoscope },
  { id: "ov-trends", label: "Past vs Current", icon: History },
  { id: "ov-farmers", label: "Farmers", icon: Sprout },
];

type Focus = { label: string; keys: Set<string>; issueId?: string } | null;
type ManagerCardSnapshot = {
  managerId: string;
  metrics: ScopeMetrics;
  plots: OverviewPlot[];
  top25Recovery: number | null;
  areaPlotCount?: number;
};

const OwnerOverviewDash: React.FC<{ onMenuClick?: (menu: string) => void }> = ({ onMenuClick }) => {
  const isOwner = getUserRole() === "owner";

  const [hierarchy, setHierarchy] = useState<TeamConnectHierarchy | null>(null);
  const [industryName, setIndustryName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerDistrictArea, setOwnerDistrictArea] = useState<OwnerDistrictsTotalPlotAreaSum | null>(null);
  const [ownerDistrictAreaLoading, setOwnerDistrictAreaLoading] = useState(true);

  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [selectedFoId, setSelectedFoId] = useState("");
  const [selectedFarmerId, setSelectedFarmerId] = useState("");
  const [selectedPlotKey, setSelectedPlotKey] = useState("");

  const [agroByManager, setAgroByManager] = useState<Record<string, Record<string, unknown>>>({});
  const [agroLoading, setAgroLoading] = useState(false);
  const [rollups, setRollups] = useState<Record<string, FactoryDashboardFactory | null>>({});
  const [managerDistrictAreas, setManagerDistrictAreas] = useState<Record<string, DistrictTotalPlotAreaResponse | null>>({});
  const [rollupLoading, setRollupLoading] = useState(false);
  const [farmerFarms, setFarmerFarms] = useState<Record<string, OverviewPlot[]>>({});
  const [extras, setExtras] = useState<Record<string, PlotExtra>>({});
  const [history, setHistory] = useState({ loading: false, done: 0, total: 0 });

  const [focus, setFocus] = useState<Focus>(null);
  const [managerCardSnapshot, setManagerCardSnapshot] = useState<ManagerCardSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<ColorMode>("stage");
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  const agroReqRef = useRef(0);
  const rollupRequestedRef = useRef<Set<string>>(new Set());
  const managerDistrictAreaRequestedRef = useRef<Set<string>>(new Set());
  const requestedRef = useRef<Set<string>>(new Set());
  const detailRequestedRef = useRef<Set<string>>(new Set());
  const extrasRef = useRef(extras);
  extrasRef.current = extras;

  /* ── Hierarchy (team-connect + owner-hierarchy, richest wins) ── */
  const loadHierarchy = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const ud = getUserData();
      let me: any = null;
      try {
        me = (await getCurrentUser())?.data ?? null;
      } catch {
        me = null;
      }
      const ind = me?.industry ?? ud?.industry;
      setIndustryName(
        String(
          (typeof ind === "object" ? ind?.name ?? ind?.industry_name : null) ??
            me?.industry_name ??
            ud?.industry_name ??
            "Karnataka Sugar Industries",
        ),
      );
      setOwnerName(
        `${me?.first_name ?? ud?.first_name ?? ""} ${me?.last_name ?? ud?.last_name ?? ""}`.trim() ||
          String(me?.username ?? ud?.username ?? "Owner"),
      );

      if (!force) {
        const cached = getCache(HIERARCHY_CACHE_KEY, HIERARCHY_TTL_MS) as TeamConnectHierarchy | null;
        if (cached?.managers?.length) {
          setHierarchy(cached);
          return;
        }
      }
      const industryId = me?.industry_id ?? me?.industry?.id ?? me?.industry?.industry_id ?? me?.industryId;
      const [teamSettled, ownerSettled] = await Promise.allSettled([getTeamConnect(industryId), api.get("/users/owner-hierarchy/")]);
      const empty = { managers: [], fieldOfficers: [], farmers: [] };
      const team = teamSettled.status === "fulfilled" ? parseTeamConnectHierarchy(teamSettled.value?.data) : empty;
      const owner = ownerSettled.status === "fulfilled" ? parseOwnerHierarchyResponse(ownerSettled.value?.data) : empty;
      let best = pickBestHierarchy(team, owner);
      if (!best.managers.length) best = owner.managers.length ? owner : team;
      if (!best.managers.length && teamSettled.status === "rejected" && ownerSettled.status === "rejected") {
        throw teamSettled.reason ?? ownerSettled.reason;
      }

      let farmerLookupFailures = 0;
      const farmersByOfficer = await Promise.all(
        best.fieldOfficers.map(async (fo: any) => {
          const fieldOfficerId = fo?.id ?? fo?.user_id;
          if (fieldOfficerId == null) return { id: "", farmers: null };
          try {
            const farmers = await fetchAllFarmersByFieldOfficer(fieldOfficerId);
            return { id: String(fieldOfficerId), farmers };
          } catch (lookupError) {
            farmerLookupFailures += 1;
            console.warn(`Could not load farmers for field officer ${fieldOfficerId}; retaining hierarchy data.`, lookupError);
            return { id: String(fieldOfficerId), farmers: null };
          }
        }),
      );
      const emptyResponseIds = new Set(
        farmersByOfficer
          .filter((result) => result.farmers?.length === 0)
          .map((result) => result.id),
      );
      farmerLookupFailures += best.fieldOfficers.filter((fo: any) => {
        const id = String(fo?.id ?? fo?.user_id ?? "");
        return emptyResponseIds.has(id) && Array.isArray(fo?.farmers) && fo.farmers.length > 0;
      }).length;
      const farmersByOfficerId = new Map(
        farmersByOfficer
          .filter((result): result is { id: string; farmers: any[] } => result.farmers !== null && result.farmers.length > 0)
          .map((result) => [result.id, result.farmers]),
      );
      best = {
        ...best,
        fieldOfficers: best.fieldOfficers.map((fo: any) => {
          const id = String(fo?.id ?? fo?.user_id ?? "");
          const endpointFarmers = farmersByOfficerId.get(id);
          if (!endpointFarmers) return fo;
          const hierarchyFarmers = new Map(
            (Array.isArray(fo.farmers) ? fo.farmers : [])
              .map((farmer: any) => [String(farmer?.id ?? farmer?.user_id ?? farmer?.farmer_id ?? ""), farmer] as const)
              .filter(([farmerId]) => farmerId !== ""),
          );
          const farmers = endpointFarmers.map((farmer) => {
            const farmerId = String(farmer?.id ?? farmer?.user_id ?? farmer?.farmer_id ?? "");
            const existing = hierarchyFarmers.get(farmerId);
            if (!existing) return farmer;
            return {
              ...existing,
              ...farmer,
              plots: Array.isArray(farmer?.plots) && farmer.plots.length ? farmer.plots : existing.plots,
              farms: Array.isArray(farmer?.farms) && farmer.farms.length ? farmer.farms : existing.farms,
            };
          });
          return { ...fo, farmers, farmers_count: farmers.length };
        }),
      };
      best.farmers = best.fieldOfficers.flatMap((fo: any) => fo.farmers ?? []);
      setHierarchy(best);
      if (!farmerLookupFailures) setCache(HIERARCHY_CACHE_KEY, best);
      if (farmerLookupFailures) {
        setError(`Could not refresh farmer lists for ${farmerLookupFailures} field officer${farmerLookupFailures === 1 ? "" : "s"}; showing the available hierarchy data for those officers.`);
      }
    } catch (e: any) {
      setError(e?.message ? `Could not load team hierarchy: ${e.message}` : "Could not load team hierarchy.");
      setHierarchy({ managers: [], fieldOfficers: [], farmers: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOwner) void loadHierarchy();
  }, [isOwner, loadHierarchy]);

  useEffect(() => {
    if (!isOwner) {
      setOwnerDistrictAreaLoading(false);
      return;
    }
    let cancelled = false;
    fetchOwnerDistrictsTotalPlotAreaSum()
      .then((result) => {
        if (cancelled) return;
        if (result.districts.length !== OWNER_HARVEST_DISTRICT_SLUGS.length) {
          console.warn(
            `Owner Overview acreage is incomplete: ${result.districts.length} of ${OWNER_HARVEST_DISTRICT_SLUGS.length} district totals were returned.`,
          );
          setOwnerDistrictArea(null);
          return;
        }
        setOwnerDistrictArea(result);
      })
      .catch((areaError) => {
        if (cancelled) return;
        console.warn("Could not load owner district acreage; using registered plot acreage.", areaError);
        setOwnerDistrictArea(null);
      })
      .finally(() => {
        if (!cancelled) setOwnerDistrictAreaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  /* ── Managers ── */
  const baseManagers = useMemo<OverviewManager[]>(
    () => (hierarchy ? buildOverviewManagers(hierarchy, null, industryName) : []),
    [hierarchy, industryName],
  );
  const ownerTotals = useMemo(
    () => ({
      managers: baseManagers.length,
      fos: baseManagers.reduce((s, m) => s + m.fieldOfficers.length, 0),
      farmers: baseManagers.reduce((s, m) => s + m.farmersCount, 0),
      plots: baseManagers.reduce((s, m) => s + m.plotsCount, 0),
      area: baseManagers.reduce((s, m) => s + m.areaAcres, 0),
    }),
    [baseManagers],
  );

  const selectedManager = useMemo<OverviewManager | null>(() => {
    if (!selectedManagerId || !hierarchy) return null;
    const agro = agroByManager[selectedManagerId] ?? null;
    const built = buildOverviewManagers(hierarchy, agro, industryName).find((m) => m.id === selectedManagerId);
    if (!built) return null;
    const known = new Set<string>();
    built.fieldOfficers.forEach((fo) => fo.farmers.forEach((f) => f.plots.forEach((p) => known.add(normKey(p.key)))));
    built.fieldOfficers = built.fieldOfficers.map((fo) => {
      const farmers = fo.farmers.map((f) => {
        if (f.plots.length || !farmerFarms[f.id]) return f;
        const extra = farmerFarms[f.id].map((p) => {
          known.add(normKey(p.key));
          return { ...p, fieldOfficerId: fo.id, fieldOfficerName: fo.name, managerId: built.id };
        });
        return { ...f, plots: extra };
      });
      const orphans = orphanAgroPlotsForOfficer(agro, { ...fo, farmers }, built.id, known);
      if (!orphans.length) return { ...fo, farmers };
      const byFarmer = new Map<string, OverviewFarmer>(farmers.map((f) => [f.id, { ...f, plots: [...f.plots] }]));
      const unassignedPlots = [...(fo.unassignedPlots ?? [])];
      for (const p of orphans) {
        known.add(normKey(p.key));
        const target = byFarmer.get(p.farmerId);
        if (target) target.plots.push(p);
        else unassignedPlots.push(p);
      }
      return { ...fo, farmers: [...byFarmer.values()], unassignedPlots };
    });
    const farmers = built.fieldOfficers.flatMap((fo) => fo.farmers);
    const plots = [
      ...farmers.flatMap((f) => f.plots),
      ...built.fieldOfficers.flatMap((fo) => fo.unassignedPlots ?? []),
    ];
    return { ...built, farmersCount: farmers.length, plotsCount: plots.length, areaAcres: plots.reduce((s, p) => s + (p.areaAcres ?? 0), 0) };
  }, [selectedManagerId, hierarchy, agroByManager, farmerFarms, industryName]);

  /* ── Manager-specific rollups (Events factory dashboard) ── */
  useEffect(() => {
    const pending = baseManagers.filter(
      (manager) => !(manager.id in rollups) && !rollupRequestedRef.current.has(manager.id),
    );
    if (!pending.length) return;
    pending.forEach((manager) => rollupRequestedRef.current.add(manager.id));
    setRollupLoading(true);
    void Promise.allSettled(
      pending.map((manager) =>
        fetchManagerRollup(manager.raw, manager.fieldOfficers.map((officer) => officer.id)),
      ),
    ).then((results) => {
      const updates: Record<string, FactoryDashboardFactory | null> = {};
      results.forEach((result, index) => {
        updates[pending[index].id] = result.status === "fulfilled" ? result.value.factory : null;
      });
      setRollups((current) => ({ ...current, ...updates }));
      setRollupLoading(false);
    });
  }, [baseManagers, rollups]);

  useEffect(() => {
    const pending = baseManagers.filter(
      (manager) => !(manager.id in managerDistrictAreas) && !managerDistrictAreaRequestedRef.current.has(manager.id),
    );
    if (!pending.length) return;
    pending.forEach((manager) => managerDistrictAreaRequestedRef.current.add(manager.id));
    void Promise.allSettled(
      pending.map(async (manager) => {
        const district = resolveManagerDistrictForEventsApi(
          null,
          manager.fieldOfficers.map((officer) => ({ district: officer.region })),
          manager.raw,
          manager.raw?.industry,
        );
        return district ? fetchDistrictTotalPlotArea(district) : null;
      }),
    ).then((results) => {
      const updates: Record<string, DistrictTotalPlotAreaResponse | null> = {};
      results.forEach((result, index) => {
        updates[pending[index].id] = result.status === "fulfilled" ? result.value : null;
        if (result.status === "rejected") {
          console.warn(`Could not load district acreage for manager ${pending[index].name}.`, result.reason);
        }
      });
      setManagerDistrictAreas((current) => ({ ...current, ...updates }));
    });
  }, [baseManagers, managerDistrictAreas]);

  /* ── agroStats for the manager's FOs (per-plot metrics + geometry) ── */
  useEffect(() => {
    if (!selectedManagerId || !hierarchy || agroByManager[selectedManagerId]) return;
    const mgr = baseManagers.find((m) => m.id === selectedManagerId);
    if (!mgr || !mgr.fieldOfficers.length) return;
    const reqId = ++agroReqRef.current;
    const endDate = factoryDashboardEndDate();
    setAgroLoading(true);
    void Promise.allSettled(
      mgr.fieldOfficers.map(async (fo) => {
        const raw = (await getFieldOfficerAgroStats(fo.id, endDate)) as Record<string, any> | null;
        if (!raw || typeof raw !== "object") return {};
        const src = (raw.plots && typeof raw.plots === "object" ? raw.plots : raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw) as Record<string, any>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(src)) {
          if (v && typeof v === "object" && !Array.isArray(v)) out[k] = { ...v, field_officer_id: v.field_officer_id ?? fo.id };
        }
        return out;
      }),
    ).then((results) => {
      if (reqId !== agroReqRef.current) return;
      const merged: Record<string, unknown> = {};
      results.forEach((r) => r.status === "fulfilled" && Object.assign(merged, r.value));
      setAgroByManager((prev) => ({ ...prev, [selectedManagerId]: merged }));
      setAgroLoading(false);
    });
  }, [selectedManagerId, hierarchy, baseManagers, agroByManager]);

  /* ── Lazy plots for a farmer the hierarchy left empty ── */
  useEffect(() => {
    if (!selectedFarmerId || !selectedManager || farmerFarms[selectedFarmerId]) return;
    const farmer = selectedManager.fieldOfficers.flatMap((fo) => fo.farmers).find((f) => f.id === selectedFarmerId);
    if (!farmer || farmer.plots.length) return;
    let cancelled = false;
    getFarmsByFarmerId(selectedFarmerId)
      .then((res) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(res?.data?.results) ? res.data.results : Array.isArray(res?.data) ? res.data : [];
        const temp = buildOverviewManagers(
          { managers: [{ id: "tmp" }], fieldOfficers: [{ id: "tmpfo", manager_id: "tmp", farmers: [{ id: selectedFarmerId, first_name: farmer.name, farms: rows }] }], farmers: [] },
          agroByManager[selectedManagerId] ?? null,
        );
        setFarmerFarms((prev) => ({ ...prev, [selectedFarmerId]: temp[0]?.fieldOfficers[0]?.farmers[0]?.plots ?? [] }));
      })
      .catch(() => !cancelled && setFarmerFarms((prev) => ({ ...prev, [selectedFarmerId]: [] })));
    return () => {
      cancelled = true;
    };
  }, [selectedFarmerId, selectedManager, farmerFarms, agroByManager, selectedManagerId]);

  /* ── Scope ── */
  const { officers, scopedOfficers, farmersInScope, scopedFarmers, plotsInScope, rawScopedPlots } = useMemo(() => {
    const officers = selectedManager?.fieldOfficers ?? [];
    const scopedOfficers = selectedFoId ? officers.filter((o) => o.id === selectedFoId) : officers;
    const farmersInScope = scopedOfficers.flatMap((o) => o.farmers);
    const scopedFarmers = selectedFarmerId ? farmersInScope.filter((f) => f.id === selectedFarmerId) : farmersInScope;
    const plotsInScope = [
      ...scopedFarmers.flatMap((f) => f.plots),
      ...(selectedFarmerId ? [] : scopedOfficers.flatMap((o) => o.unassignedPlots ?? [])),
    ];
    const rawScopedPlots = selectedPlotKey ? plotsInScope.filter((p) => p.key === selectedPlotKey) : plotsInScope;
    return { officers, scopedOfficers, farmersInScope, scopedFarmers, plotsInScope, rawScopedPlots };
  }, [selectedManager, selectedFoId, selectedFarmerId, selectedPlotKey]);
  const scopedPlots = useMemo(() => withExtras(rawScopedPlots, extras), [rawScopedPlots, extras]);
  const managerCardPlots = useMemo(() => {
    if (!selectedManager) return [];
    const plots = [
      ...selectedManager.fieldOfficers.flatMap((officer) => [
        ...officer.farmers.flatMap((farmer) => farmer.plots),
        ...(officer.unassignedPlots ?? []),
      ]),
    ];
    return withExtras(plots, extras);
  }, [selectedManager, extras]);
  const managerScope = !selectedFoId && !selectedFarmerId && !selectedPlotKey;
  const showManagerCards =
    !!selectedFoId && !selectedFarmerId && !selectedPlotKey;
  const smallScope = !!selectedFarmerId || !!selectedPlotKey;
  const rollup = selectedManagerId ? rollups[selectedManagerId] ?? null : null;
  const selectedManagerDistrictArea = selectedManagerId ? managerDistrictAreas[selectedManagerId] : null;

  const scopeLabel = selectedPlotKey
    ? `Plot ${scopedPlots[0]?.label ?? selectedPlotKey}`
    : selectedFarmerId
      ? `Farmer ${scopedFarmers[0]?.name ?? ""}`
      : selectedFoId
        ? `Field officer ${scopedOfficers[0]?.name ?? ""}`
        : `Manager ${selectedManager?.name ?? ""}`;

  /* ── History sample for the scope ── */
  const monitored = useMemo(() => {
    if (selectedPlotKey || selectedFarmerId) return rawScopedPlots.slice(0, HISTORY_SAMPLE.farmer);
    return sampleAcrossOfficers(rawScopedPlots, selectedFoId ? HISTORY_SAMPLE.officer : HISTORY_SAMPLE.manager);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawScopedPlots.map((p) => p.key).join("|"), selectedFoId, selectedFarmerId, selectedPlotKey]);

  useEffect(() => {
    if (!selectedManager) return;
    const todo = monitored.filter((p) => !requestedRef.current.has(normKey(p.key)));
    const detailTodo = smallScope ? monitored.filter((p) => !detailRequestedRef.current.has(normKey(p.key))) : [];
    if (!todo.length && !detailTodo.length) {
      setHistory((h) => ({ ...h, loading: false }));
      return;
    }
    let cancelled = false;
    todo.forEach((p) => requestedRef.current.add(normKey(p.key)));
    detailTodo.forEach((p) => detailRequestedRef.current.add(normKey(p.key)));
    setHistory({ loading: true, done: 0, total: todo.length + detailTodo.length });
    const bump = () => setHistory((h) => ({ ...h, done: h.done + 1 }));

    const historyJob = runQueue(
      todo,
      async (p) => {
        const [indices, stress] = await Promise.all([fetchPlotIndices(p.key), fetchPlotStress(p.key)]);
        return { indices, stress };
      },
      6,
      (p, r) => {
        if (!r.indices?.some((point) => point.growth != null && Number.isFinite(point.growth))) {
          requestedRef.current.delete(normKey(p.key));
        }
        setExtras((prev) => ({
          ...prev,
          [normKey(p.key)]: {
            ...prev[normKey(p.key)],
            indices: r.indices,
            stressEvents: r.stress?.events ?? prev[normKey(p.key)]?.stressEvents ?? null,
            stressDays: r.stress?.days ?? prev[normKey(p.key)]?.stressDays ?? null,
          },
        }));
        bump();
      },
      () => cancelled,
    );
    // Farmer / plot scope: SEF field score + SAR crop condition (slow APIs, few plots).
    const detailJob = runQueue(
      detailTodo,
      async (p) => {
        const [score, cond] = await Promise.all([
          p.fieldScore == null ? fetchPlotFieldScore(p.key) : Promise.resolve(p.fieldScore),
          p.cci == null ? fetchPlotCondition(p.key, p.plantationDate) : Promise.resolve(null),
        ]);
        return { score, cond };
      },
      3,
      (p, r) => {
        setExtras((prev) => ({
          ...prev,
          [normKey(p.key)]: {
            ...prev[normKey(p.key)],
            fieldScore: r.score ?? prev[normKey(p.key)]?.fieldScore ?? null,
            cci: r.cond?.cci ?? prev[normKey(p.key)]?.cci ?? null,
            stressEvents: prev[normKey(p.key)]?.stressEvents ?? r.cond?.stressEvents ?? null,
            stressDays: prev[normKey(p.key)]?.stressDays ?? r.cond?.stressDays ?? null,
          },
        }));
        bump();
      },
      () => cancelled,
    );
    void Promise.all([historyJob, detailJob]).then(() => !cancelled && setHistory((h) => ({ ...h, loading: false })));
    return () => {
      cancelled = true;
      // Allow a retry if the scope changes before these finished.
      todo.forEach((p) => {
        if (!extrasRef.current[normKey(p.key)]?.indices) requestedRef.current.delete(normKey(p.key));
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitored, selectedManager?.id, smallScope]);

  /* ── Derived analytics ── */
  const metrics = useMemo(() => {
    const base = metricsFromPlots(scopedPlots, extras);
    const merged = managerScope ? mergeRollup(base, rollup) : base;
    if (managerScope && selectedManagerDistrictArea) {
      return {
        ...merged,
        area: selectedManagerDistrictArea.total_area_acres,
        fromDistrict: new Set([...merged.fromDistrict, "area"]),
      };
    }
    return merged;
  }, [scopedPlots, extras, managerScope, rollup, selectedManagerDistrictArea]);
  const managerCardMetrics = useMemo(() => {
    const base = metricsFromPlots(managerCardPlots, extras);
    const merged = mergeRollup(base, rollup);
    if (!selectedManagerDistrictArea) return merged;
    return {
      ...merged,
      area: selectedManagerDistrictArea.total_area_acres,
      fromDistrict: new Set([...merged.fromDistrict, "area"]),
    };
  }, [managerCardPlots, extras, rollup, selectedManagerDistrictArea]);
  const health = useMemo(() => healthScore(metrics), [metrics]);
  const series = useMemo(
    () => monitored.map((p) => extras[normKey(p.key)]?.indices).filter((s): s is IndexPoint[] => Array.isArray(s) && s.length > 0),
    [monitored, extras],
  );
  const compare = useMemo(() => compareWindows(series).rows, [series]);
  const growthHistory = useMemo(() => {
    const deltas = series.flatMap((points) => {
      const sorted = points
        .filter((point) => point.growth != null && Number.isFinite(point.growth) && Number.isFinite(Date.parse(point.date)))
        .sort((a, b) => a.date.localeCompare(b.date));
      const current = sorted[sorted.length - 1];
      if (!current || current.growth == null) return [];
      const currentTime = Date.parse(current.date);
      const previous = [...sorted].reverse().find((point) => {
        const ageDays = (currentTime - Date.parse(point.date)) / 86_400_000;
        return ageDays >= 25 && ageDays <= 45;
      });
      return previous?.growth == null ? [] : [current.growth - previous.growth];
    });
    return {
      delta: deltas.length ? deltas.reduce((total, delta) => total + delta, 0) / deltas.length : null,
      plots: deltas.length,
      availablePlots: series.filter((points) => points.some((point) => point.growth != null && Number.isFinite(point.growth))).length,
    };
  }, [series]);
  const peers = useMemo(() => factoryRecoveryPeersFromRollup(rollup), [rollup]);
  const activeManagerCardSnapshot =
    selectedFoId &&
    !selectedFarmerId &&
    !selectedPlotKey &&
    managerCardSnapshot?.managerId === selectedManagerId
      ? managerCardSnapshot
      : null;
  const cardMetrics = activeManagerCardSnapshot
    ? activeManagerCardSnapshot.metrics
    : showManagerCards
      ? managerCardMetrics
      : metrics;
  const cardPlots = activeManagerCardSnapshot
    ? activeManagerCardSnapshot.plots
    : showManagerCards
      ? managerCardPlots
      : scopedPlots;
  const cardTop25Recovery = activeManagerCardSnapshot
    ? activeManagerCardSnapshot.top25Recovery
    : peers.top25Avg;
  const cardAreaPlotCount = activeManagerCardSnapshot
    ? activeManagerCardSnapshot.areaPlotCount
    : showManagerCards
      ? selectedManagerDistrictArea?.plot_count ?? rollup?.plot_count
      : undefined;
  const issues = useMemo(
    () =>
      selectedManager
        ? diagnoseIssues({ metrics, plots: scopedPlots, extras, compare, officers: scopedOfficers, recoveryTop25: peers.top25Avg, sampledPlots: series.length })
        : [],
    [selectedManager, metrics, scopedPlots, extras, compare, scopedOfficers, peers.top25Avg, series.length],
  );
  const farmerRows = useMemo(() => buildFarmerRows(scopedFarmers, extras), [scopedFarmers, extras]);
  const growthNow = compare.find((c) => c.key === "growth");

  /* ── Navigation helpers ── */
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    if (!selectedManager) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveSection(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [selectedManager?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const resetBelow = (level: "manager" | "fo" | "farmer") => {
    if (level === "manager") setSelectedFoId("");
    if (level !== "farmer") setSelectedFarmerId("");
    setSelectedPlotKey("");
    setFocus(null);
  };

  const pickManager = (id: string) => {
    setSelectedManagerId(id);
    setManagerCardSnapshot(null);
    resetBelow("manager");
    setMapMode("stage");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const backToManagers = () => {
    setSelectedManagerId("");
    setManagerCardSnapshot(null);
    resetBelow("manager");
  };

  const onFocusBucket = (label: string, test: (p: OverviewPlot) => boolean) => {
    const keys = new Set(scopedPlots.filter(test).map((p) => normKey(p.key)));
    if (!keys.size) {
      setToast(`No plot-level data for “${label}” in this selection yet — the count comes from the factory rollup.`);
      return;
    }
    setFocus({ label, keys });
    scrollTo("ov-map");
  };
  const onShowIssue = (issue: Issue) => {
    if (!issue.plotKeys.length) {
      setFocus(null);
      setToast("This alert has no individually identified plots. Showing all mapped plots in this selection.");
      scrollTo("ov-map");
      return;
    }
    if (focus?.issueId === issue.id) {
      setFocus(null);
      return;
    }
    setFocus({ label: issue.title, keys: new Set(issue.plotKeys.map(normKey)), issueId: issue.id });
    if (issue.id.startsWith("growth")) setMapMode("trend");
    scrollTo("ov-map");
  };

  const fitKey = `${selectedManagerId}|${selectedFoId}|${selectedFarmerId}|${selectedPlotKey}|${scopedPlots.filter((p) => p.positions.length >= 3 || p.point).length}`;
  const ringColor = health.tone === "good" ? "#bef264" : health.tone === "fair" ? "#fde047" : "#fda4af";
  const selectedPlot = selectedPlotKey ? scopedPlots[0] : null;
  const selectedPlotTrend = selectedPlot ? plotGrowthTrend(extras[normKey(selectedPlot.key)]?.indices) : null;

  if (!isOwner) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4">
            <Lock className="w-7 h-7 text-rose-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800">Owner access only</h2>
          <p className="text-sm text-gray-500 mt-2">The Owner Overview dashboard is available to factory owners. Please sign in with an owner account.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-gray-50 via-emerald-50/40 to-blue-50 ${selectedManager ? "min-h-screen pb-4" : "pb-2"}`}>
      <div className={`max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 ${selectedManager ? "pt-3 space-y-4" : "pt-2 space-y-2.5"}`}>
        {/* ═════ Hero ═════ */}
        <motion.div layout className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-700 via-green-600 to-teal-600 text-white shadow-xl">
          <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-40 -bottom-16 w-48 h-48 rounded-full bg-lime-300/20 blur-2xl" />
          <div className={`relative ${selectedManager ? "p-5 sm:p-7" : "p-3 sm:p-5"}`}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {selectedManager ? (
                  <button onClick={backToManagers} className="w-14 h-14 shrink-0 rounded-2xl bg-white/15 hover:bg-white/25 ring-1 ring-white/30 flex items-center justify-center transition" title="Back to managers">
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                ) : (
                  <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-white/15 ring-1 ring-white/30 flex items-center justify-center">
                    <Factory className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-emerald-100 text-[10px] sm:text-xs font-semibold uppercase tracking-widest">
                    <ShieldCheck className="w-3.5 h-3.5" /> Owner Overview {selectedManager ? "· Bird's-eye view" : ""}
                  </div>
                  <h1 className={`font-extrabold leading-tight truncate ${selectedManager ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"}`}>
                    {selectedManager ? selectedManager.name : industryName || "Owner Overview"}
                  </h1>
                  <p className={`text-emerald-50/90 truncate ${selectedManager ? "text-sm" : "text-xs sm:text-sm"}`}>
                    {selectedManager
                      ? `${selectedManager.industryName || industryName} · Manager${selectedManager.region ? ` · ${selectedManager.region}` : ""}${selectedManager.phone ? ` · ${selectedManager.phone}` : ""}`
                      : `Welcome, ${ownerName} · select a manager to see every crop parameter, issues and history`}
                  </p>
                </div>
              </div>
              {selectedManager && (
                <div className="flex items-center gap-3 bg-white/10 rounded-2xl pl-2 pr-4 py-2 ring-1 ring-white/20">
                  <RingScore value={health.score} color={ringColor} label="health" size={80} />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-emerald-100">Command-area health</div>
                    <div className="text-lg font-extrabold">{health.grade}</div>
                    <div className="text-[11px] text-emerald-50/90">
                      {issues.filter((i) => i.severity === "critical").length} critical · {issues.filter((i) => i.severity === "warning").length} warnings
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={`grid ${selectedManager ? "grid-cols-2 sm:grid-cols-4 gap-3 mt-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-4"}`}>
              {(selectedManager
                ? [
                    { label: "Field Officers", value: <CountUp value={officers.length} />, icon: Users },
                    { label: "Farmers", value: <CountUp value={selectedManager.farmersCount} />, icon: Sprout },
                    { label: "Plots", value: <CountUp value={selectedManager.plotsCount} />, icon: Layers },
                    {
                      label: "Field Area",
                      value: (selectedManagerDistrictArea?.total_area_acres ?? rollup?.total_field_area_acres) != null
                        ? <><CountUp value={selectedManagerDistrictArea?.total_area_acres ?? rollup?.total_field_area_acres ?? null} digits={1} /> ac</>
                        : rollupLoading ? "…" : "—",
                      icon: MapPin,
                      title: selectedManagerDistrictArea
                        ? `District total-plot-area endpoint: ${selectedManagerDistrictArea.district}`
                        : "Manager factory dashboard field-area total",
                    },
                  ]
                : [
                    { label: "Managers", value: <CountUp value={ownerTotals.managers} />, icon: UserCheck },
                    { label: "Field Officers", value: <CountUp value={ownerTotals.fos} />, icon: Users },
                    { label: "Total Farmers", value: <CountUp value={ownerTotals.farmers} />, icon: Sprout },
                    {
                      label: "Total Plots",
                      value: <CountUp value={ownerTotals.plots} />,
                      icon: Layers,
                      title: "Count of plots in the loaded owner hierarchy",
                    },
                    {
                      label: "Total Field Area",
                      value: ownerDistrictAreaLoading
                        ? "…"
                        : ownerDistrictArea
                          ? <><CountUp value={ownerDistrictArea.total_area_acres} digits={1} /> ac</>
                          : "—",
                      icon: MapPin,
                      title: ownerDistrictArea
                        ? `Sum of district total-plot-area endpoints (${ownerDistrictArea.districts.length} districts; real plots only)`
                        : "District acreage endpoint totals are unavailable",
                    },
                  ]
              ).map((s) => (
                <div key={s.label} title={"title" in s ? s.title : undefined} className={`min-w-0 overflow-hidden bg-white/10 backdrop-blur rounded-2xl ring-1 ring-white/20 ${selectedManager ? "p-3" : "p-2 sm:p-2.5"}`}>
                  <div className={`flex min-w-0 items-start gap-2 text-emerald-50 font-medium ${selectedManager ? "text-xs" : "text-[10px] sm:text-xs"}`}>
                    <s.icon className="w-4 h-4 shrink-0" />
                    <span className="min-w-0 leading-tight break-words">{s.label}</span>
                  </div>
                  <div className={`min-w-0 font-extrabold mt-0.5 tabular-nums break-words ${selectedManager ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"}`}>{loading ? "Loading…" : s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {error && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}

        <AnimatePresence mode="wait">
          {!selectedManager ? (
            <motion.div key="pick" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -10 }} transition={{ duration: 0.3 }}>
              <ManagerPicker managers={baseManagers} rollups={rollups} districtAreas={managerDistrictAreas} loading={loading} industryName={industryName} totalFarmers={ownerTotals.farmers} onPick={pickManager} onMenuClick={onMenuClick} />
            </motion.div>
          ) : (
            <motion.div key="detail" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.35 }} className="space-y-5">
              {/* Sticky filters + section nav */}
              <div className="sticky top-0 z-[600] -mx-3 sm:mx-0 px-3 sm:px-0 pt-1">
                <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100 p-3 sm:p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white flex items-center justify-center font-extrabold shadow">
                        {initials(selectedManager.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase text-gray-400 font-semibold">Manager</div>
                        <div className="font-bold text-gray-800 text-sm truncate">{selectedManager.name}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 min-w-0">
                      <SelectBox
                        step={1}
                        label="Field Officer"
                        icon={Users}
                        count={officers.length}
                        value={selectedFoId}
                        placeholder="All field officers"
                        options={officers.map((o) => ({ value: o.id, label: `${o.name} (${o.farmers.length} farmers)` }))}
                        onChange={(v) => {
                          if (
                            !selectedFoId &&
                            v &&
                            !selectedFarmerId &&
                            !selectedPlotKey &&
                            !agroLoading &&
                            !rollupLoading
                          ) {
                            setManagerCardSnapshot({
                              managerId: selectedManagerId,
                              metrics,
                              plots: scopedPlots,
                              top25Recovery: peers.top25Avg,
                              areaPlotCount:
                                selectedManagerDistrictArea?.plot_count ??
                                rollup?.plot_count,
                            });
                          } else if (!v) {
                            setManagerCardSnapshot(null);
                          }
                          setSelectedFoId(v);
                          resetBelow("fo");
                        }}
                      />
                      <SelectBox
                        step={2}
                        label="Farmer"
                        icon={Sprout}
                        count={farmersInScope.length}
                        value={selectedFarmerId}
                        placeholder="All farmers"
                        options={farmersInScope.map((f) => ({ value: f.id, label: `${f.name}${f.plots.length ? ` (${f.plots.length} plot${f.plots.length > 1 ? "s" : ""})` : ""}` }))}
                        onChange={(v) => {
                          setSelectedFarmerId(v);
                          setSelectedPlotKey("");
                          setFocus(null);
                        }}
                        disabled={!farmersInScope.length}
                      />
                      <SelectBox
                        step={3}
                        label="Plot No."
                        icon={MapPin}
                        count={plotsInScope.length}
                        value={selectedPlotKey}
                        placeholder={
                          !selectedFarmerId
                            ? "Select a farmer first"
                            : plotsInScope.length === 1
                              ? plotsInScope[0].label
                              : "All plots"
                        }
                        options={plotsInScope.map((p) => ({ value: p.key, label: `${p.label}${p.areaAcres ? ` · ${fmt(p.areaAcres, 2)} ac` : ""}` }))}
                        onChange={(v) => {
                          setSelectedPlotKey(v);
                          setFocus(null);
                        }}
                        disabled={!selectedFarmerId || !plotsInScope.length}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3 overflow-x-auto">
                    {SECTIONS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => scrollTo(s.id)}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                          activeSection === s.id ? "bg-emerald-600 text-white shadow" : "text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        <s.icon className="w-3.5 h-3.5" /> {s.label}
                        {s.id === "ov-issues" && issues.some((i) => i.severity === "critical" || i.severity === "warning") && (
                          <span className={`ml-0.5 text-[9px] font-bold rounded-full px-1.5 ${activeSection === s.id ? "bg-white/25" : "bg-rose-100 text-rose-700"}`}>
                            {issues.filter((i) => i.severity === "critical" || i.severity === "warning").length}
                          </span>
                        )}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-gray-500 whitespace-nowrap pl-3">
                      Scope: <b className="text-gray-700">{scopeLabel}</b>
                      {(agroLoading || rollupLoading) && <span className="ml-2 text-emerald-600">loading data…</span>}
                    </span>
                  </div>
                </div>
              </div>

              {/* Parameters */}
              <section id="ov-params" className="scroll-mt-44 space-y-3">
                <BirdEyeCards
                  m={cardMetrics}
                  plots={cardPlots}
                  areaPlotCount={cardAreaPlotCount}
                  top25Recovery={cardTop25Recovery}
                  loading={agroLoading || rollupLoading}
                  stressLoading={history.loading}
                  onFocus={onFocusBucket}
                />
              </section>

              {/* Map + performance */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <Panel id="ov-map" className="xl:col-span-2 scroll-mt-44">
                  <SectionTitle
                    icon={MapPin}
                    title="Farmers & Plots Map"
                    subtitle={`${scopedFarmers.length} farmers · ${scopedPlots.filter((p) => p.positions.length >= 3 || p.point).length} of ${scopedPlots.length} plots located · click a plot to drill in`}
                  />
                  <OverviewMap
                    plots={scopedPlots}
                    extras={extras}
                    metrics={metrics}
                    focus={focus}
                    onClearFocus={() => setFocus(null)}
                    selectedPlotKey={selectedPlotKey}
                    selectedFarmerId={selectedFarmerId}
                    onPick={(p) => {
                      setSelectedFoId(p.fieldOfficerId);
                      setSelectedFarmerId(p.farmerId);
                      setSelectedPlotKey(p.key);
                      setFocus(null);
                    }}
                    mode={mapMode}
                    onMode={setMapMode}
                    fitKey={fitKey}
                    loadingNote={agroLoading ? "Loading plot boundaries…" : undefined}
                  />
                </Panel>
                <div className="space-y-4">
                  <IssueSummary issues={issues} onShow={onShowIssue} onAll={() => scrollTo("ov-issues")} />
                  {selectedPlot && (
                    <Panel className="bg-gradient-to-br from-emerald-600 to-teal-600 text-white border-0">
                      <div className="flex items-center justify-between">
                        <div className="font-bold">Plot {selectedPlot.label}</div>
                        <button onClick={() => setSelectedPlotKey("")} className="hover:text-amber-200">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-xs text-emerald-50 mb-2">{selectedPlot.farmerName} · FO {selectedPlot.fieldOfficerName}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          ["Area", `${fmt(selectedPlot.areaAcres, 2)} ac`],
                          ["Stage", selectedPlot.stage],
                          ["Plantation", selectedPlot.plantationDate ? new Date(selectedPlot.plantationDate).toLocaleDateString("en-IN") : "—"],
                          ["Crop age", selectedPlot.daysSincePlantation != null ? `${selectedPlot.daysSincePlantation} d` : "—"],
                          ["Harvest in", selectedPlot.daysToHarvest != null ? `${selectedPlot.daysToHarvest} d` : "—"],
                          ["Exp. yield", `${fmt(selectedPlot.expectedYield, 1)} T/ac`],
                          ["Brix / Rec.", `${fmt(selectedPlot.brix, 1)}° / ${fmt(selectedPlot.recovery, 2)}%`],
                          ["Field score", selectedPlot.fieldScore != null ? `${fmt(selectedPlot.fieldScore, 0)}%` : history.loading ? "…" : "—"],
                          ["CCI", selectedPlot.cci != null ? fmt(selectedPlot.cci, 1) : history.loading ? "…" : "—"],
                          ["Growth now", selectedPlotTrend?.now != null ? `${fmt(selectedPlotTrend.now, 2)} (${selectedPlotTrend.delta != null ? `${selectedPlotTrend.delta >= 0 ? "+" : ""}${fmt(selectedPlotTrend.delta, 2)}` : "—"})` : "—"],
                        ].map(([k, v]) => (
                          <div key={k} className="bg-white/15 rounded-lg px-2 py-1.5">
                            <div className="text-[9px] uppercase text-emerald-50">{k}</div>
                            <div className="font-bold truncate">{v}</div>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}
                </div>
              </div>

              <PerformancePanels m={metrics} recovery={{ regional: peers.factoryAvg, top25: peers.top25Avg, topFarmers: peers.topFarmers }} scopeLabel={scopeLabel} />

              <IssueDiagnosis issues={issues} loadingHistory={history.loading} onShow={onShowIssue} activeId={focus?.issueId ?? null} />

              <ConditionTrends series={series} monitored={series.length || monitored.length} total={rawScopedPlots.length} loading={history.loading} progress={history} scopeLabel={scopeLabel} />

              <FarmerConditionTable
                rows={farmerRows}
                selectedFarmerId={selectedFarmerId}
                title={`Farmer Condition Tracker — ${selectedFoId ? scopedOfficers[0]?.name ?? "officer" : selectedManager.name}`}
                onSelect={(r) => {
                  setSelectedFoId(r.farmer.fieldOfficerId);
                  setSelectedFarmerId(r.farmer.id === selectedFarmerId ? "" : r.farmer.id);
                  setSelectedPlotKey("");
                  setFocus(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[1300] bg-gray-900 text-white text-sm rounded-xl px-4 py-2.5 shadow-xl max-w-md text-center"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Compact "top issues" card beside the map. */
const IssueSummary: React.FC<{ issues: Issue[]; onShow: (i: Issue) => void; onAll: () => void }> = ({ issues, onShow, onAll }) => {
  const top = issues.filter((i) => i.severity !== "good").slice(0, 4);
  const tone: Record<string, string> = { critical: "bg-rose-500", warning: "bg-amber-500", info: "bg-sky-500", good: "bg-emerald-500" };
  return (
    <Panel>
      <SectionTitle icon={Stethoscope} title="Top issues right now" subtitle="Click to view an alert or highlight its plots" right={<button onClick={onAll} className="text-[11px] font-semibold text-emerald-700 hover:underline">View all {issues.length}</button>} />
      {top.length === 0 ? (
        <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3">No issues detected.</div>
      ) : (
        <div className="space-y-2">
          {top.map((i) => (
            <button key={i.id} onClick={() => onShow(i)} className="w-full text-left flex items-start gap-2 rounded-xl border border-gray-100 hover:border-emerald-300 hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 p-2.5 transition">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${tone[i.severity]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-gray-800">{i.title}</div>
                <div className="text-[11px] text-gray-500 line-clamp-2">{i.cause || i.metric}</div>
              </div>
              {i.plotKeys.length > 0 && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5 shrink-0">{i.plotKeys.length} plot{i.plotKeys.length === 1 ? "" : "s"}</span>}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
};

export default OwnerOverviewDash;
