/**
 * Owner Overview helpers — normalise owner → manager → field officer → farmer → plot
 * hierarchy (team-connect / owner-hierarchy) into flat, typed records, then derive
 * the bird's-eye metrics, trends (past vs current) and issue diagnostics the
 * OwnerOverviewDash renders.
 */
import {
  personDisplayName,
  getFieldOfficersForManager,
  normalizeSugarcaneStatus,
  type TeamConnectHierarchy,
} from "./teamConnectHarvest";
import {
  flattenAgroStatsPlots,
  type FactoryDashboardFactory,
} from "./factoryOwnerDashboard";
import { normalizePlotKey, sanitizePlotName } from "./plotName";

/* ═══════════════════════════ Types ═══════════════════════════ */

export type CropStage = "Harvest Maturity" | "Grand Growth" | "Tillering" | "Other";

export type OverviewPlot = {
  key: string;
  label: string;
  farmerId: string;
  farmerName: string;
  fieldOfficerId: string;
  fieldOfficerName: string;
  managerId: string;
  areaAcres: number | null;
  positions: [number, number][];
  point: [number, number] | null;
  village: string;
  variety: string;
  plantationDate: string | null;
  daysSincePlantation: number | null;
  stage: CropStage;
  status: string;
  expectedYield: number | null;
  brix: number | null;
  recovery: number | null;
  daysToHarvest: number | null;
  biomass: number | null;
  /** 0–100 when present in agroStats; enriched later from SEF for small scopes. */
  fieldScore: number | null;
  /** 0–100 Crop Condition Index when present in agroStats. */
  cci: number | null;
};

export type OverviewFarmer = {
  id: string;
  name: string;
  phone: string;
  village: string;
  fieldOfficerId: string;
  fieldOfficerName: string;
  plots: OverviewPlot[];
};

export type OverviewFieldOfficer = {
  id: string;
  name: string;
  phone: string;
  region: string;
  farmers: OverviewFarmer[];
  unassignedPlots?: OverviewPlot[];
};

export type OverviewManager = {
  id: string;
  name: string;
  username: string;
  phone: string;
  email: string;
  region: string;
  industryName: string;
  raw: any;
  fieldOfficers: OverviewFieldOfficer[];
  farmersCount: number;
  plotsCount: number;
  areaAcres: number;
};

/** Per-plot data fetched lazily (indices, NDRE stress, SEF field score, SAR CCI). */
export type IndexPoint = {
  date: string;
  growth: number | null;
  stress: number | null;
  water: number | null;
  moisture: number | null;
};

export type PlotExtra = {
  indices?: IndexPoint[] | null;
  stressEvents?: number | null;
  stressDays?: number | null;
  fieldScore?: number | null;
  cci?: number | null;
};

export type Stat = { avg: number | null; min: number | null; max: number | null; n: number };

export type ScopeMetrics = {
  plots: number;
  area: number | null;
  stage: { harvest_maturity: number; grand_growth: number; tillering: number; other: number; total: number };
  dth: { d15: number; d30: number; d45: number; d90: number; d120: number; above: number; total: number };
  brix: Stat;
  recovery: Stat;
  waterIndex: Stat;
  fieldScore: { above_80: number; b60_80: number; b40_60: number; below_40: number; total: number; avg: number | null };
  yieldDist: { above_100: number; b75_100: number; b50_75: number; below_50: number; total: number };
  yield: Stat;
  biomass: Stat;
  cci: { avg: number | null; n: number };
  stress: { events: number | null; days: number | null; plots: number };
  /** Which metric groups came from the factory rollup (vs. per-plot aggregation). */
  fromRollup: Set<string>;
  /** Which metrics come from district-wide endpoints. */
  fromDistrict: Set<string>;
};

export type IssueSeverity = "critical" | "warning" | "info" | "good";

export type Issue = {
  id: string;
  severity: IssueSeverity;
  title: string;
  metric: string;
  cause: string;
  action: string;
  plotKeys: string[];
  category: "Crop Health" | "Yield" | "Water & Stress" | "Harvest" | "Quality" | "Field Team" | "Data";
};

/* ═══════════════════════════ Small utils ═══════════════════════════ */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const pos = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

const str = (...values: unknown[]): string => {
  for (const v of values) {
    if (v == null || typeof v === "object") continue;
    const s = String(v).trim();
    if (s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return s;
  }
  return "";
};

export const userId = (u: any): string => str(u?.id, u?.user_id, u?.farmer_id);

export const normKey = (k: string) => normalizePlotKey(k);

export function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function stat(values: Array<number | null | undefined>): Stat {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { avg: null, min: null, max: null, n: 0 };
  return {
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    n: nums.length,
  };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function initials(name: string): string {
  const parts = name.replace(/[_.-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/* ═══════════════════════════ Geometry / keys ═══════════════════════════ */

function ringFrom(raw: any): [number, number][] {
  const candidates = [
    raw?.boundary?.coordinates?.[0],
    raw?.coordinates?.boundary?.coordinates?.[0],
    raw?.geometry?.coordinates?.[0],
    raw?.polygon?.coordinates?.[0],
    raw?.plot?.boundary?.coordinates?.[0],
  ];
  for (const ring of candidates) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const out: [number, number][] = [];
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const lng = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5) continue;
      out.push([lat, lng]);
    }
    if (out.length >= 3) return out;
  }
  return [];
}

function pointFrom(raw: any, ring: [number, number][]): [number, number] | null {
  const c =
    raw?.location?.coordinates ??
    raw?.coordinates?.location?.coordinates ??
    raw?.plot?.location?.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return [lat, lng];
    }
  }
  const lat = num(raw?.latitude ?? raw?.lat);
  const lng = num(raw?.longitude ?? raw?.lng ?? raw?.lon);
  if (lat != null && lng != null && (lat !== 0 || lng !== 0)) return [lat, lng];
  if (ring.length >= 3) {
    const sum = ring.reduce((a, [la, ln]) => [a[0] + la, a[1] + ln], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return null;
}

function plotKey(raw: any): string {
  const fastapi = str(raw?.fastapi_plot_id, raw?.plot?.fastapi_plot_id);
  if (fastapi) return sanitizePlotName(fastapi);
  const gat = str(raw?.gat_number, raw?.plot?.gat_number);
  const pn = str(raw?.plot_number, raw?.plot?.plot_number);
  if (gat && pn) return `${gat}_${pn}`;
  return str(raw?.plot_name, raw?.plot_id, raw?.id, raw?.plot?.id);
}

function plotLabel(raw: any, key: string): string {
  const gat = str(raw?.gat_number, raw?.plot?.gat_number);
  const pn = str(raw?.plot_number, raw?.plot?.plot_number);
  if (gat && pn) return `${gat}/${pn}`;
  return key.replace(/_/g, "/");
}

function farmsOf(raw: any): any[] {
  return Array.isArray(raw?.farms) ? raw.farms : [];
}

function rawPlotsOfFarmer(farmer: any): any[] {
  const out: any[] = [];
  if (Array.isArray(farmer?.plots)) out.push(...farmer.plots);
  if (!out.length && Array.isArray(farmer?.farms)) {
    for (const farm of farmer.farms) {
      if (farm?.plot && typeof farm.plot === "object") {
        out.push({ ...farm.plot, farms: [farm] });
      }
    }
  }
  return out;
}

/* ═══════════════════════════ Crop stage ═══════════════════════════ */

export function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Industry stage buckets used by the factory rollup (Tillering / Grand Growth /
 * Harvest Maturity / Other). Day ranges follow bud.json (2-bud): Germination
 * 0–30 + Tillering 31–90 → Tillering, 91–210 → Grand Growth, >210 → Maturity.
 */
export function cropStageBucket(agroStage: unknown, plantationDays: number | null): CropStage {
  const s = typeof agroStage === "string" ? agroStage.toLowerCase() : "";
  if (s) {
    if (s.includes("matur") || s.includes("ripen") || s.includes("harvest")) return "Harvest Maturity";
    if (s.includes("grand")) return "Grand Growth";
    if (s.includes("tiller") || s.includes("germin")) return "Tillering";
  }
  if (plantationDays == null) return "Other";
  if (plantationDays <= 90) return "Tillering";
  if (plantationDays <= 210) return "Grand Growth";
  return "Harvest Maturity";
}

/* ═══════════════════════════ agroStats ═══════════════════════════ */

export function buildAgroIndex(agroStats: Record<string, unknown> | null | undefined) {
  const flat = flattenAgroStatsPlots(agroStats);
  const index = new Map<string, Record<string, any>>();
  for (const [k, v] of Object.entries(flat)) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, any>;
    const variants = [
      k,
      row.fastapi_plot_id,
      row.plot_name,
      row.gat_number && row.plot_number ? `${row.gat_number}_${row.plot_number}` : null,
    ];
    for (const variant of variants) {
      if (variant == null) continue;
      const nk = normalizePlotKey(String(variant).replace(/^"|"$/g, ""));
      if (nk && !index.has(nk)) index.set(nk, row);
    }
  }
  return index;
}

export function agroMetrics(agro: Record<string, any> | null | undefined) {
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const n = num(v);
      if (n != null) return n;
    }
    return null;
  };
  if (!agro) {
    return {
      status: "",
      expectedYield: null,
      brix: null,
      recovery: null,
      daysToHarvest: null,
      biomass: null,
      fieldScore: null,
      cci: null,
      agroStage: null as unknown,
    };
  }
  const bs = agro.brix_sugar ?? {};
  const cciRaw = pick(agro?.cci?.value_percent, agro.cci_avg, agro.cci_percent);
  const cci10 = pick(agro?.cci?.value, typeof agro.cci === "number" ? agro.cci : null);
  return {
    status: normalizeSugarcaneStatus(
      agro.Sugarcane_Status ?? agro.sugarcane_status ?? agro.harvest_status ?? "",
    ),
    expectedYield: pick(
      bs?.sugar_yield?.mean,
      bs?.sugar_yield?.avg,
      bs?.sugar_yield_mean,
      agro.sugar_yield_mean,
      agro.expected_yield,
    ),
    brix: pick(bs?.brix?.mean, bs?.brix?.avg, typeof bs?.brix === "number" ? bs.brix : null),
    recovery: pick(
      bs?.recovery?.mean,
      bs?.recovery?.avg,
      bs?.recovery_mean,
      agro.recovery_mean,
      typeof bs?.recovery === "number" ? bs.recovery : null,
    ),
    daysToHarvest: pick(agro.days_to_harvest, bs?.days_to_harvest, agro?.harvest?.days_to_harvest),
    biomass: pick(agro?.biomass?.mean, agro?.biomass_avg_t_per_acre),
    fieldScore: pick(
      agro.field_score,
      agro.field_score_pct,
      agro?.field_score?.value,
      agro.overall_health,
      agro.health_score,
    ),
    cci: cciRaw ?? (cci10 != null ? cci10 * 10 : null),
    agroStage: agro.crop_stage ?? agro.growth_stage ?? agro.stage ?? agro.crop_status,
  };
}

function buildPlot(
  raw: any,
  farmer: { id: string; name: string },
  fo: { id: string; name: string },
  managerId: string,
  agroIndex: Map<string, Record<string, any>>,
): OverviewPlot | null {
  const key = plotKey(raw);
  if (!key) return null;
  const farm = farmsOf(raw)[0] ?? null;
  const ring = ringFrom(raw);
  const agro = agroIndex.get(normalizePlotKey(key)) ?? null;
  const agroRing = agro ? ringFrom(agro) : [];
  const positions = ring.length >= 3 ? ring : agroRing;
  const { agroStage, ...m } = agroMetrics(agro);
  const plantationDate =
    str(farm?.plantation_date, farm?.crop_type?.plantation_date, raw?.plantation_date, agro?.plantation_date) || null;
  const dsp = daysSince(plantationDate);
  return {
    key,
    label: plotLabel(raw, key),
    farmerId: farmer.id,
    farmerName: farmer.name,
    fieldOfficerId: fo.id,
    fieldOfficerName: fo.name,
    managerId,
    areaAcres:
      pos(raw?.area_acres) ??
      pos(farm?.area_size_numeric) ??
      pos(farm?.area_size) ??
      pos(raw?.area_size) ??
      pos(agro?.area_acres) ??
      pos(agro?.soil?.area_acres),
    positions,
    point: pointFrom(raw, positions) ?? (agro ? pointFrom(agro, agroRing) : null),
    village: str(raw?.village, raw?.taluka, farm?.village, agro?.village, agro?.taluka),
    variety: str(
      farm?.crop_type?.crop_variety,
      farm?.crop_variety,
      farm?.crop_type?.plantation_type_display,
      farm?.crop_type?.plantation_type,
      farm?.plantation_type,
      agro?.plantation_type_display,
      agro?.plantation_type,
    ),
    plantationDate,
    daysSincePlantation: dsp,
    stage: cropStageBucket(agroStage, dsp),
    ...m,
  };
}

/* ═══════════════════════════ Hierarchy → tree ═══════════════════════════ */

export function buildOverviewManagers(
  hierarchy: TeamConnectHierarchy,
  agroStats: Record<string, unknown> | null,
  industryName = "",
): OverviewManager[] {
  const agroIndex = buildAgroIndex(agroStats);

  return (hierarchy.managers || []).map((m: any) => {
    const managerId = userId(m);
    const fos = getFieldOfficersForManager(hierarchy, managerId);
    const fieldOfficers: OverviewFieldOfficer[] = fos.map((fo: any) => {
      const foRef = { id: userId(fo), name: personDisplayName(fo) };
      const farmers: OverviewFarmer[] = (Array.isArray(fo?.farmers) ? fo.farmers : []).map(
        (f: any) => {
          const farmerRef = { id: userId(f), name: personDisplayName(f) };
          const plots = rawPlotsOfFarmer(f)
            .map((p) => buildPlot(p, farmerRef, foRef, managerId, agroIndex))
            .filter(Boolean) as OverviewPlot[];
          return {
            ...farmerRef,
            phone: str(f?.phone_number, f?.phone, f?.mobile),
            village: str(f?.village, f?.taluka, f?.address, plots[0]?.village),
            fieldOfficerId: foRef.id,
            fieldOfficerName: foRef.name,
            plots,
          };
        },
      );
      return {
        ...foRef,
        phone: str(fo?.phone_number, fo?.phone),
        region: str(fo?.taluka, fo?.region, fo?.district, fo?.village),
        farmers,
      };
    });

    const farmers = fieldOfficers.flatMap((fo) => fo.farmers);
    const plots = farmers.flatMap((f) => f.plots);
    return {
      id: managerId,
      name: personDisplayName(m),
      username: str(m?.username),
      phone: str(m?.phone_number, m?.phone),
      email: str(m?.email),
      region: str(m?.district, m?.taluka, m?.state, fieldOfficers[0]?.region),
      industryName: str(m?.industry?.name, m?.industry_name, m?.factory_name, industryName),
      raw: m,
      fieldOfficers,
      farmersCount: farmers.length,
      plotsCount: plots.length,
      areaAcres: plots.reduce((s, p) => s + (p.areaAcres ?? 0), 0),
    };
  });
}

/** agroStats plots for an FO that the hierarchy omitted — keep the map complete. */
export function orphanAgroPlotsForOfficer(
  agroStats: Record<string, unknown> | null,
  fo: OverviewFieldOfficer,
  managerId: string,
  knownKeys: Set<string>,
): OverviewPlot[] {
  const flat = flattenAgroStatsPlots(agroStats);
  const out: OverviewPlot[] = [];
  for (const [k, v] of Object.entries(flat)) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, any>;
    if (String(row.field_officer_id ?? "") !== fo.id) continue;
    const key = sanitizePlotName(String(row.fastapi_plot_id ?? k).replace(/^"|"$/g, ""));
    if (!key || knownKeys.has(normalizePlotKey(key))) continue;
    const ring = ringFrom(row);
    const farmerId = str(row.farmer_id, row.farmer?.id);
    const farmer = fo.farmers.find((f) => f.id === farmerId);
    const { agroStage, ...m } = agroMetrics(row);
    const plantationDate = str(row.plantation_date) || null;
    const dsp = daysSince(plantationDate);
    out.push({
      key,
      label: plotLabel(row, key),
      farmerId: farmerId || `agro-${key}`,
      farmerName: farmer?.name ?? str(row.farmer_name, row.farmer?.name, "Unassigned"),
      fieldOfficerId: fo.id,
      fieldOfficerName: fo.name,
      managerId,
      areaAcres: pos(row.area_acres) ?? pos(row?.soil?.area_acres),
      positions: ring,
      point: pointFrom(row, ring),
      village: str(row.village, row.taluka),
      variety: str(row.plantation_type_display, row.plantation_type),
      plantationDate,
      daysSincePlantation: dsp,
      stage: cropStageBucket(agroStage, dsp),
      ...m,
    });
  }
  return out;
}

/* ═══════════════════════════ Scope metrics ═══════════════════════════ */

/** Apply lazily fetched extras (SEF field score, SAR CCI) onto plots. */
export function withExtras(plots: OverviewPlot[], extras: Record<string, PlotExtra>): OverviewPlot[] {
  return plots.map((p) => {
    const e = extras[normKey(p.key)];
    if (!e) return p;
    return {
      ...p,
      fieldScore: p.fieldScore ?? e.fieldScore ?? null,
      cci: p.cci ?? e.cci ?? null,
    };
  });
}

export function metricsFromPlots(plots: OverviewPlot[], extras: Record<string, PlotExtra>): ScopeMetrics {
  const stage = { harvest_maturity: 0, grand_growth: 0, tillering: 0, other: 0, total: plots.length };
  const dth = { d15: 0, d30: 0, d45: 0, d90: 0, d120: 0, above: 0, total: 0 };
  const fs = { above_80: 0, b60_80: 0, b40_60: 0, below_40: 0, total: 0, avg: null as number | null };
  const yd = { above_100: 0, b75_100: 0, b50_75: 0, below_50: 0, total: 0 };
  let stressEvents = 0;
  let stressDays = 0;
  let stressPlots = 0;
  const fsVals: number[] = [];

  for (const p of plots) {
    if (p.stage === "Harvest Maturity") stage.harvest_maturity += 1;
    else if (p.stage === "Grand Growth") stage.grand_growth += 1;
    else if (p.stage === "Tillering") stage.tillering += 1;
    else stage.other += 1;

    const d = p.daysToHarvest;
    if (d != null) {
      dth.total += 1;
      if (d <= 15) dth.d15 += 1;
      if (d <= 30) dth.d30 += 1;
      if (d <= 45) dth.d45 += 1;
      if (d <= 90) dth.d90 += 1;
      if (d <= 120) dth.d120 += 1;
      if (d > 120) dth.above += 1;
    }

    if (p.fieldScore != null) {
      fs.total += 1;
      fsVals.push(p.fieldScore);
      if (p.fieldScore > 80) fs.above_80 += 1;
      else if (p.fieldScore >= 60) fs.b60_80 += 1;
      else if (p.fieldScore >= 40) fs.b40_60 += 1;
      else fs.below_40 += 1;
    }

    const y = p.expectedYield;
    if (y != null) {
      yd.total += 1;
      if (y > 100) yd.above_100 += 1;
      else if (y >= 75) yd.b75_100 += 1;
      else if (y >= 50) yd.b50_75 += 1;
      else yd.below_50 += 1;
    }

    const e = extras[normKey(p.key)];
    if (e && (e.stressEvents != null || e.stressDays != null)) {
      stressPlots += 1;
      stressEvents += e.stressEvents ?? 0;
      stressDays += e.stressDays ?? 0;
    }
  }
  fs.avg = avg(fsVals);
  const areaSum = plots.reduce((s, p) => s + (p.areaAcres ?? 0), 0);
  const latestWaterIndices = plots.map((plot) => {
    const points = extras[normKey(plot.key)]?.indices ?? [];
    return [...points]
      .filter((point) => point.water != null && Number.isFinite(point.water))
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.water ?? null;
  });

  return {
    plots: plots.length,
    area: areaSum || null,
    stage,
    dth,
    brix: stat(plots.map((p) => p.brix)),
    recovery: stat(plots.map((p) => p.recovery)),
    waterIndex: stat(latestWaterIndices),
    fieldScore: fs,
    yieldDist: yd,
    yield: stat(plots.map((p) => p.expectedYield)),
    biomass: stat(plots.map((p) => p.biomass)),
    cci: { avg: avg(plots.map((p) => p.cci)), n: plots.filter((p) => p.cci != null).length },
    stress: stressPlots
      ? { events: stressEvents, days: stressDays || null, plots: stressPlots }
      : { events: null, days: null, plots: 0 },
    fromRollup: new Set(),
    fromDistrict: new Set(),
  };
}

const n0 = (v: unknown) => {
  const n = num(v);
  return n == null ? 0 : n;
};

/**
 * Manager-wide view: prefer the Events factory rollup (same numbers the Farm
 * Crop Status dashboard shows) and fill any gaps from per-plot aggregation.
 */
export function mergeRollup(base: ScopeMetrics, f: FactoryDashboardFactory | null): ScopeMetrics {
  if (!f) return base;
  const out: ScopeMetrics = { ...base, fromRollup: new Set(), fromDistrict: new Set() };
  const mark = (k: string) => out.fromRollup.add(k);

  if (num(f.total_field_area_acres) != null) {
    out.area = num(f.total_field_area_acres);
    mark("area");
  }
  if (num(f.plot_count) != null) out.plots = Math.max(out.plots, n0(f.plot_count));

  const c = f.crop_status?.counts;
  if (c && n0(c.total_plots) > 0) {
    out.stage = {
      harvest_maturity: n0(c.harvest_maturity),
      grand_growth: n0(c.grand_growth),
      tillering: n0(c.tillering),
      other: n0(c.other_or_unknown),
      total: n0(c.total_plots),
    };
    mark("stage");
  }
  const d = f.days_to_harvest;
  if (d && n0(d.plots_with_days_to_harvest) > 0) {
    const within15 = n0(d.within_15_days);
    const within30 = n0(d.within_1_month);
    const within45 = n0(d.within_45_days);
    const within90 = n0(d.within_90_days);
    const within120 = n0(d.within_120_days);
    out.dth = {
      d15: within15,
      d30: within30,
      d45: within45,
      d90: within90,
      d120: within120,
      above: n0(d.above_120_days),
      total: n0(d.plots_with_days_to_harvest),
    };
    mark("dth");
  }
  if (num(f.brix_avg) != null) {
    out.brix = { avg: num(f.brix_avg), min: num(f.brix_min), max: num(f.brix_max), n: out.plots };
    mark("brix");
  }
  if (num(f.recovery?.factory_avg_pct) != null) {
    out.recovery = {
      avg: num(f.recovery?.factory_avg_pct),
      min: base.recovery.min,
      max: base.recovery.max,
      n: n0(f.recovery?.plots_with_recovery),
    };
    mark("recovery");
  }
  const fsd = f.field_score_distribution;
  if (fsd && n0(fsd.plots_with_field_score) > 0) {
    out.fieldScore = {
      above_80: n0(fsd.above_80),
      b60_80: n0(fsd.between_60_80),
      b40_60: n0(fsd.between_40_60),
      below_40: n0(fsd.below_40),
      total: n0(fsd.plots_with_field_score),
      avg: num(f.field_score_avg) ?? base.fieldScore.avg,
    };
    mark("fieldScore");
  }
  const yd = f.expected_yield_distribution;
  if (yd && n0(yd.plots_with_yield) > 0) {
    out.yieldDist = {
      above_100: n0(yd.above_100),
      b75_100: n0(yd.between_75_100),
      b50_75: n0(yd.between_50_75),
      below_50: n0(yd.below_50),
      total: n0(yd.plots_with_yield),
    };
    mark("yieldDist");
  }
  const ya = num(f.expected_yield_avg_t_per_acre) ?? num(f.expected_yield_t_per_acre);
  if (ya != null) {
    out.yield = {
      avg: ya,
      min: num(f.expected_yield_min_t_per_acre) ?? base.yield.min,
      max: num(f.expected_yield_max_t_per_acre) ?? base.yield.max,
      n: out.plots,
    };
    mark("yield");
  }
  if (num(f.biomass_avg_t_per_acre) != null) {
    out.biomass = {
      avg: num(f.biomass_avg_t_per_acre),
      min: num(f.biomass_min_t_per_acre) ?? base.biomass.min,
      max: num(f.biomass_max_t_per_acre) ?? base.biomass.max,
      n: out.plots,
    };
    mark("biomass");
  }
  if (num(f.cci_avg) != null) {
    out.cci = { avg: num(f.cci_avg), n: out.plots };
    mark("cci");
  }
  return out;
}

/* ═══════════════════════════ Health score ═══════════════════════════ */

export function healthScore(m: ScopeMetrics): { score: number | null; grade: string; tone: "good" | "fair" | "poor" } {
  const parts: Array<[number, number]> = []; // [value 0-100, weight]
  if (m.fieldScore.total > 0) {
    const t = m.fieldScore.total;
    parts.push([
      (m.fieldScore.above_80 * 90 + m.fieldScore.b60_80 * 70 + m.fieldScore.b40_60 * 50 + m.fieldScore.below_40 * 25) / t,
      0.3,
    ]);
  }
  if (m.cci.avg != null) parts.push([Math.max(0, Math.min(100, m.cci.avg)), 0.3]);
  if (m.yieldDist.total > 0) {
    const t = m.yieldDist.total;
    parts.push([
      (m.yieldDist.above_100 * 100 + m.yieldDist.b75_100 * 85 + m.yieldDist.b50_75 * 62 + m.yieldDist.below_50 * 35) / t,
      0.3,
    ]);
  }
  if (m.stress.plots > 0 && m.stress.events != null) {
    const perPlot = m.stress.events / m.stress.plots;
    parts.push([Math.max(0, 100 - perPlot * 25), 0.1]);
  }
  if (!parts.length) return { score: null, grade: "No data", tone: "fair" };
  const w = parts.reduce((s, [, wt]) => s + wt, 0);
  const score = parts.reduce((s, [v, wt]) => s + v * wt, 0) / w;
  if (score >= 75) return { score, grade: "Healthy", tone: "good" };
  if (score >= 55) return { score, grade: "Needs watch", tone: "fair" };
  return { score, grade: "At risk", tone: "poor" };
}

/* ═══════════════════════════ Indices: past vs current ═══════════════════════════ */

export type Period = "daily" | "weekly" | "monthly" | "yearly";

const INDEX_KEYS = ["growth", "stress", "water", "moisture"] as const;
export type IndexKey = (typeof INDEX_KEYS)[number];

function bucketKey(date: string, period: Period): string {
  const d = new Date(date);
  if (period === "daily") return date.slice(0, 10);
  if (period === "monthly") return date.slice(0, 7);
  if (period === "yearly") return date.slice(0, 4);
  const day = (d.getUTCDay() + 6) % 7; // Monday start
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, period: Period): string {
  if (period === "yearly") return key;
  if (period === "monthly") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  return new Date(key).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export type TrendRow = {
  key: string;
  label: string;
  plots: number;
  growth: number | null;
  growthBand: [number, number] | null;
  stress: number | null;
  water: number | null;
  moisture: number | null;
};

/**
 * Cumulative trend across many plots: average each plot within the bucket
 * first (so dense plots don't dominate), then take the mean + p10–p90 band.
 */
export function aggregateIndexSeries(series: IndexPoint[][], period: Period): TrendRow[] {
  const buckets = new Map<string, Array<Record<IndexKey, number[]>>>();
  series.forEach((pts, plotIdx) => {
    const perPlot = new Map<string, Record<IndexKey, number[]>>();
    for (const p of pts) {
      if (!p?.date) continue;
      const k = bucketKey(p.date, period);
      const acc = perPlot.get(k) ?? { growth: [], stress: [], water: [], moisture: [] };
      for (const ik of INDEX_KEYS) {
        const v = p[ik];
        if (typeof v === "number" && Number.isFinite(v)) acc[ik].push(v);
      }
      perPlot.set(k, acc);
    }
    for (const [k, acc] of perPlot) {
      const list = buckets.get(k) ?? [];
      list[plotIdx] = acc;
      buckets.set(k, list);
    }
  });

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, perPlot]) => {
      const plotMeans: Record<IndexKey, number[]> = { growth: [], stress: [], water: [], moisture: [] };
      let plots = 0;
      for (const acc of perPlot) {
        if (!acc) continue;
        plots += 1;
        for (const ik of INDEX_KEYS) {
          const m = avg(acc[ik]);
          if (m != null) plotMeans[ik].push(m);
        }
      }
      const g = [...plotMeans.growth].sort((a, b) => a - b);
      const lo = quantile(g, 0.1);
      const hi = quantile(g, 0.9);
      return {
        key,
        label: bucketLabel(key, period),
        plots,
        growth: avg(plotMeans.growth),
        growthBand: lo != null && hi != null ? ([lo, hi] as [number, number]) : null,
        stress: avg(plotMeans.stress),
        water: avg(plotMeans.water),
        moisture: avg(plotMeans.moisture),
      };
    });
}

function windowMean(series: IndexPoint[][], ik: IndexKey, from: number, to: number): number | null {
  const plotMeans: number[] = [];
  for (const pts of series) {
    const vals = pts
      .filter((p) => {
        const t = new Date(p.date).getTime();
        return t >= from && t < to;
      })
      .map((p) => p[ik])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const m = avg(vals);
    if (m != null) plotMeans.push(m);
  }
  return avg(plotMeans);
}

function nearestHistoricalMean(
  series: IndexPoint[][],
  ik: IndexKey,
  target: number,
  toleranceDays: number,
  latest: number,
): number | null {
  const tolerance = toleranceDays * 86_400_000;
  const plotValues = series.flatMap((points) => {
    const nearest = points
      .filter((point) => {
        const timestamp = Date.parse(point.date);
        const value = point[ik];
        return Number.isFinite(timestamp) && timestamp <= latest &&
          typeof value === "number" && Number.isFinite(value) &&
          Math.abs(timestamp - target) <= tolerance;
      })
      .sort((a, b) => Math.abs(Date.parse(a.date) - target) - Math.abs(Date.parse(b.date) - target))[0];
    return nearest ? [nearest[ik] as number] : [];
  });
  return avg(plotValues);
}

export type WindowCompare = {
  key: IndexKey;
  now: number | null;
  prev: number | null;
  lastSeason: number | null;
  dPrevPct: number | null;
  dSeasonPct: number | null;
};

const pct = (a: number | null, b: number | null) =>
  a == null || b == null || Math.abs(b) < 1e-6 ? null : ((a - b) / Math.abs(b)) * 100;

/** Now (last 30 d) vs previous 30 d vs the same 30-day window last season. */
export function compareWindows(series: IndexPoint[][]): { latest: string | null; rows: WindowCompare[] } {
  let latest = 0;
  for (const pts of series) for (const p of pts) latest = Math.max(latest, new Date(p.date).getTime() || 0);
  if (!latest) return { latest: null, rows: [] };
  const D = 86_400_000;
  const end = latest + D;
  const rows = INDEX_KEYS.map((key) => {
    const now = windowMean(series, key, end - 30 * D, end);
    const previousWindow = windowMean(series, key, end - 60 * D, end - 30 * D);
    const prev = previousWindow ?? nearestHistoricalMean(series, key, latest - 30 * D, 15, latest);
    const lastSeasonWindow = windowMean(series, key, end - 395 * D, end - 365 * D);
    const lastSeason = lastSeasonWindow ?? nearestHistoricalMean(series, key, latest - 365 * D, 30, latest);
    return {
      key,
      now,
      prev,
      lastSeason,
      dPrevPct: pct(now, prev),
      dSeasonPct: pct(now, lastSeason),
    };
  });
  return { latest: new Date(latest).toISOString().slice(0, 10), rows };
}

/** % of plots in NDVI health bands per month — the cumulative "condition" history. */
export function healthBandsByMonth(series: IndexPoint[][]) {
  const months = new Map<string, number[]>();
  for (const pts of series) {
    const perMonth = new Map<string, number[]>();
    for (const p of pts) {
      if (typeof p.growth !== "number") continue;
      const k = p.date.slice(0, 7);
      perMonth.set(k, [...(perMonth.get(k) ?? []), p.growth]);
    }
    for (const [k, vals] of perMonth) {
      const m = avg(vals);
      if (m != null) months.set(k, [...(months.get(k) ?? []), m]);
    }
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, vals]) => {
      const t = vals.length || 1;
      const good = vals.filter((v) => v >= 0.5).length;
      const moderate = vals.filter((v) => v >= 0.3 && v < 0.5).length;
      const poor = vals.filter((v) => v < 0.3).length;
      return {
        key: k,
        label: bucketLabel(k, "monthly"),
        Healthy: Math.round((good / t) * 100),
        Moderate: Math.round((moderate / t) * 100),
        Poor: Math.round((poor / t) * 100),
        plots: vals.length,
      };
    });
}

/** Latest growth (NDVI) and change vs ~30 days earlier for one plot. */
export function plotGrowthTrend(pts: IndexPoint[] | null | undefined): { now: number | null; delta: number | null; spark: number[] } {
  if (!pts?.length) return { now: null, delta: null, spark: [] };
  const sorted = [...pts].filter((p) => typeof p.growth === "number").sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { now: null, delta: null, spark: [] };
  const last = sorted[sorted.length - 1];
  const lastT = new Date(last.date).getTime();
  const past = [...sorted].reverse().find((p) => lastT - new Date(p.date).getTime() >= 25 * 86_400_000);
  const spark = sorted.slice(-24).map((p) => p.growth as number);
  return {
    now: last.growth,
    delta: past?.growth != null && last.growth != null ? last.growth - past.growth : null,
    spark,
  };
}

/* ═══════════════════════════ Farmer condition ═══════════════════════════ */

export type FarmerRow = {
  farmer: OverviewFarmer;
  area: number;
  stage: string;
  yieldAvg: number | null;
  brixAvg: number | null;
  recoveryAvg: number | null;
  daysToHarvest: number | null;
  fieldScore: number | null;
  growthNow: number | null;
  growthDelta: number | null;
  spark: number[];
  stressEvents: number | null;
  risk: number;
  condition: "Healthy" | "Watch" | "Critical";
  reasons: string[];
};

export function buildFarmerRows(farmers: OverviewFarmer[], extras: Record<string, PlotExtra>): FarmerRow[] {
  return farmers.map((f) => {
    const plots = withExtras(f.plots, extras);
    const trends = plots.map((p) => plotGrowthTrend(extras[normKey(p.key)]?.indices));
    const growthNow = avg(trends.map((t) => t.now));
    const growthDelta = avg(trends.map((t) => t.delta));
    const spark = trends.find((t) => t.spark.length)?.spark ?? [];
    const stressVals = plots.map((p) => extras[normKey(p.key)]?.stressEvents).filter((v): v is number => v != null);
    const stressEvents = stressVals.length ? stressVals.reduce((a, b) => a + b, 0) : null;
    const yieldAvg = avg(plots.map((p) => p.expectedYield));
    const fieldScore = avg(plots.map((p) => p.fieldScore));
    const dthVals = plots.map((p) => p.daysToHarvest).filter((v): v is number => v != null);
    const stages = plots.map((p) => p.stage);
    const stage = stages.sort((a, b) => stages.filter((s) => s === b).length - stages.filter((s) => s === a).length)[0] ?? "Other";

    const reasons: string[] = [];
    let risk = 0;
    if (yieldAvg != null && yieldAvg < 50) {
      risk += 30;
      reasons.push(`Low yield ${yieldAvg.toFixed(0)} T/acre`);
    }
    if (fieldScore != null && fieldScore < 40) {
      risk += 30;
      reasons.push(`Field score ${fieldScore.toFixed(0)}%`);
    } else if (fieldScore != null && fieldScore < 60) {
      risk += 12;
      reasons.push(`Field score ${fieldScore.toFixed(0)}%`);
    }
    if (growthDelta != null && growthDelta < -0.05) {
      risk += 25;
      reasons.push(`Growth ↓ ${Math.abs(growthDelta).toFixed(2)} in 30 d`);
    }
    if (growthNow != null && growthNow < 0.3) {
      risk += 15;
      reasons.push("Weak canopy (NDVI < 0.3)");
    }
    if (stressEvents != null && stressEvents > 0) {
      risk += Math.min(20, stressEvents * 6);
      reasons.push(`${stressEvents} stress event${stressEvents > 1 ? "s" : ""}`);
    }
    if (dthVals.length && Math.min(...dthVals) <= 30) reasons.push(`Harvest due in ${Math.min(...dthVals)} d`);

    return {
      farmer: f,
      area: plots.reduce((s, p) => s + (p.areaAcres ?? 0), 0),
      stage,
      yieldAvg,
      brixAvg: avg(plots.map((p) => p.brix)),
      recoveryAvg: avg(plots.map((p) => p.recovery)),
      daysToHarvest: dthVals.length ? Math.min(...dthVals) : null,
      fieldScore,
      growthNow,
      growthDelta,
      spark,
      stressEvents,
      risk,
      condition: risk >= 45 ? "Critical" : risk >= 20 ? "Watch" : "Healthy",
      reasons,
    };
  });
}

/* ═══════════════════════════ Issue diagnosis ═══════════════════════════ */

export function diagnoseIssues(ctx: {
  metrics: ScopeMetrics;
  plots: OverviewPlot[];
  extras: Record<string, PlotExtra>;
  compare: WindowCompare[];
  officers: OverviewFieldOfficer[];
  recoveryTop25: number | null;
  sampledPlots: number;
}): Issue[] {
  const { metrics: m, plots, extras, compare } = ctx;
  const issues: Issue[] = [];
  const share = (n: number, t: number) => (t > 0 ? (n / t) * 100 : 0);

  // Field score
  if (m.fieldScore.total > 0) {
    const low = m.fieldScore.below_40;
    const mid = m.fieldScore.b40_60;
    const lowShare = share(low, m.fieldScore.total);
    const weakShare = share(low + mid, m.fieldScore.total);
    if (lowShare >= 10 || weakShare >= 25) {
      issues.push({
        id: "fieldscore",
        severity: lowShare >= 10 ? "critical" : "warning",
        category: "Crop Health",
        title: `${plural(low + mid, "plot")} with weak field score`,
        metric: `${low} below 40% · ${mid} at 40–60% (${weakShare.toFixed(0)}% of scored plots)`,
        cause: "Patchy canopy / uneven growth detected by the field-score model — typically gap filling, nutrient deficiency or weed pressure.",
        action: "Ask the field officers to visit these plots, check plant population and apply the stage-wise fertiliser dose.",
        plotKeys: m.fromRollup.has("fieldScore")
          ? []
          : plots.filter((p) => p.fieldScore != null && p.fieldScore < 60).map((p) => p.key),
      });
    }
  }

  // Yield
  if (m.yieldDist.total > 0) {
    const low = m.yieldDist.below_50;
    const lowShare = share(low, m.yieldDist.total);
    if (lowShare >= 20) {
      issues.push({
        id: "yield",
        severity: lowShare >= 40 ? "critical" : "warning",
        category: "Yield",
        title: `${plural(low, "plot")} with yield estimate below 50 T/acre`,
        metric: `${m.fromRollup.has("yieldDist") ? "Factory yield estimate" : "Plot yield estimates"} · ${low} of ${m.yieldDist.total} below 50 T/acre · scope avg ${m.yield.avg?.toFixed(1) ?? "—"} T/acre`,
        cause: "Low biomass accumulation for the crop age — usually late planting, water shortage in grand growth, or poor ratoon management.",
        action: "Prioritise irrigation scheduling and top-dressing for these plots; review ratoon plots for gap filling.",
        plotKeys: m.fromRollup.has("yieldDist")
          ? []
          : plots.filter((p) => p.expectedYield != null && p.expectedYield < 50).map((p) => p.key),
      });
    }
  }

  // CCI
  if (m.cci.avg != null && m.cci.avg < 65) {
    issues.push({
      id: "cci",
      severity: m.cci.avg < 45 ? "critical" : "warning",
      category: "Crop Health",
      title: `Crop Condition Index low (${m.cci.avg.toFixed(1)})`,
      metric: "Healthy command areas stay above 65",
      cause: "SAR-based condition index shows moisture/vigour stress across the area.",
      action: "Cross-check with the water-stress trend below and verify canal / borewell availability.",
      plotKeys: m.fromRollup.has("cci")
        ? []
        : plots.filter((p) => p.cci != null && p.cci < 60).map((p) => p.key),
    });
  }

  // Trend: growth / water vs last month and last season
  const g = compare.find((c) => c.key === "growth");
  const w = compare.find((c) => c.key === "water");
  const declining = plots.filter((p) => {
    const t = plotGrowthTrend(extras[normKey(p.key)]?.indices);
    return t.delta != null && t.delta < -0.05;
  });
  if (g?.dPrevPct != null && g.dPrevPct <= -8) {
    issues.push({
      id: "growth-trend",
      severity: g.dPrevPct <= -15 ? "critical" : "warning",
      category: "Crop Health",
      title: `Growth index down ${Math.abs(g.dPrevPct).toFixed(0)}% vs last month`,
      metric: `${declining.length} of ${ctx.sampledPlots} monitored plots declining`,
      cause: "Canopy vigour (NDVI) is falling — early sign of water stress, pest/disease or senescence before harvest.",
      action: "Inspect the declining plots highlighted on the map; if they are not near harvest, check pest & irrigation status.",
      plotKeys: declining.map((p) => p.key),
    });
  } else if (declining.length >= Math.max(2, ctx.sampledPlots * 0.25)) {
    issues.push({
      id: "growth-plots",
      severity: "warning",
      category: "Crop Health",
      title: `${plural(declining.length, "plot")} losing vigour`,
      metric: "NDVI fell by more than 0.05 in the last 30 days",
      cause: "Localised decline while the area average is stable — plot-level stress (irrigation gap, pest, lodging).",
      action: "Send these plots to the responsible field officers for a visit.",
      plotKeys: declining.map((p) => p.key),
    });
  }
  if (w?.dPrevPct != null && w.dPrevPct <= -12) {
    issues.push({
      id: "water-trend",
      severity: w.dPrevPct <= -25 ? "critical" : "warning",
      category: "Water & Stress",
      title: `Water index down ${Math.abs(w.dPrevPct).toFixed(0)}% vs last month`,
      metric: `Now ${w.now?.toFixed(3) ?? "—"} · previous ${w.prev?.toFixed(3) ?? "—"}`,
      cause: "Canopy water content is dropping — irrigation intervals are too long or rainfall deficit.",
      action: "Shorten irrigation intervals; prioritise plots in grand growth (highest water demand).",
      plotKeys: [],
    });
  }
  if (g?.dSeasonPct != null && g.dSeasonPct <= -10) {
    issues.push({
      id: "season",
      severity: "warning",
      category: "Yield",
      title: `NDVI average ${Math.abs(g.dSeasonPct).toFixed(0)}% lower vs the prior-year window`,
      metric: `Current 30-day mean ${g.now?.toFixed(3) ?? "—"} · prior-year mean ${g.lastSeason?.toFixed(3) ?? "—"}`,
      cause: "This season's crop is behind last year's — later planting or weaker establishment.",
      action: "Expect lower tonnage; revise the crushing plan and focus extension on lagging villages.",
      plotKeys: [],
    });
  } else if (g?.dSeasonPct != null && g.dSeasonPct >= 5) {
    issues.push({
      id: "season-good",
      severity: "good",
      category: "Yield",
      title: `Growth ${g.dSeasonPct.toFixed(0)}% ahead of last season`,
      metric: `Now ${g.now?.toFixed(3) ?? "—"} vs ${g.lastSeason?.toFixed(3) ?? "—"}`,
      cause: "Crop vigour is better than the same time last year.",
      action: "Keep the current irrigation and nutrient schedule.",
      plotKeys: [],
    });
  }

  // Stress events
  if (m.stress.events != null && m.stress.events > 0) {
    const stressed = plots.filter((p) => (extras[normKey(p.key)]?.stressEvents ?? 0) > 0);
    issues.push({
      id: "stress",
      severity: m.stress.events / Math.max(1, m.stress.plots) >= 1 ? "critical" : "warning",
      category: "Water & Stress",
      title: `${plural(m.stress.events, "NDRE threshold event")}`,
      metric: `${stressed.length} of ${m.stress.plots} monitored plots with returned stress events${m.stress.days ? ` · ${m.stress.days} event-days` : ""}`,
      cause: "NDRE dropped below the 0.15 stress threshold — nitrogen / chlorophyll stress or moisture deficit.",
      action: "Check nitrogen top-dressing and irrigation for the affected plots.",
      plotKeys: stressed.map((p) => p.key),
    });
  }

  // Harvest pipeline
  const due45 = m.dth.d45;
  if (due45 > 0) {
    issues.push({
      id: "harvest",
      severity: "info",
      category: "Harvest",
      title: `${plural(due45, "plot")} with estimated harvest within 45 days`,
      metric: `${m.fromRollup.has("dth") ? "Factory harvest estimate" : "Plot harvest estimates"} · ≤15 days: ${m.dth.d15} · ≤30 days: ${m.dth.d30} · ≤45 days: ${m.dth.d45}`,
      cause: "The harvest endpoint reports estimated days remaining; these are estimates, not confirmed harvest dates.",
      action: "Plan harvesting gangs, transport and crushing slots.",
      plotKeys: m.fromRollup.has("dth")
        ? []
        : plots.filter((p) => p.daysToHarvest != null && p.daysToHarvest <= 45).map((p) => p.key),
    });
  } else if (m.dth.total > 0 && m.stage.harvest_maturity === 0) {
    issues.push({
      id: "harvest-none",
      severity: "info",
      category: "Harvest",
      title: "No plots ready for harvest yet",
      metric: `${plural(m.dth.above, "plot")} more than 120 days from harvest`,
      cause: "Most of the crop is still in tillering / grand growth.",
      action: "No crushing supply from this manager in the next 4 months — plan cane from other areas.",
      plotKeys: [],
    });
  }

  // Sugar quality
  if (m.recovery.avg == null) {
    issues.push({
      id: "recovery-missing",
      severity: "info",
      category: "Quality",
      title: "Recovery data not available",
      metric: "No plot has a recovery % estimate yet",
      cause: "Recovery is estimated near maturity; young crop or missing brix sampling.",
      action: "Start brix sampling on the oldest plots to unlock recovery estimates.",
      plotKeys: [],
    });
  } else if (ctx.recoveryTop25 != null && ctx.recoveryTop25 - m.recovery.avg >= 1) {
    issues.push({
      id: "recovery-gap",
      severity: "warning",
      category: "Quality",
      title: `Recovery ${(ctx.recoveryTop25 - m.recovery.avg).toFixed(1)} pts below top 25 farmers`,
      metric: `Scope ${m.recovery.avg.toFixed(2)}% vs top-25 ${ctx.recoveryTop25.toFixed(2)}%`,
      cause: "Sugar recovery lags the best farmers — harvest timing or variety mix.",
      action: "Harvest by brix ranking and share top farmers' practices with the rest.",
      plotKeys: plots.filter((p) => p.recovery != null && p.recovery < (ctx.recoveryTop25 as number) - 1).map((p) => p.key),
    });
  }
  if (m.brix.avg != null && m.brix.avg < 18 && m.stage.harvest_maturity > 0) {
    issues.push({
      id: "brix",
      severity: "warning",
      category: "Quality",
      title: `Average Brix low (${m.brix.avg.toFixed(1)}°)`,
      metric: "Mature cane usually reads 20°+",
      cause: "Immature harvest or excess late irrigation diluting sugar.",
      action: "Stop irrigation ~3 weeks before harvest and harvest by brix ranking.",
      plotKeys: plots.filter((p) => p.brix != null && p.brix < 18).map((p) => p.key),
    });
  }

  // Field-officer hotspot (share of low-yield plots)
  let worst: { fo: OverviewFieldOfficer; share: number; n: number; keys: string[] } | null = null;
  for (const fo of ctx.officers) {
    const fp = fo.farmers.flatMap((f) => f.plots).filter((p) => p.expectedYield != null);
    if (fp.length < 3) continue;
    const lowKeys = fp.filter((p) => (p.expectedYield as number) < 50).map((p) => p.key);
    const s = share(lowKeys.length, fp.length);
    if (!worst || s > worst.share) worst = { fo, share: s, n: lowKeys.length, keys: lowKeys };
  }
  if (worst && worst.share >= 35 && ctx.officers.length > 1) {
    issues.push({
      id: "fo-hotspot",
      severity: "warning",
      category: "Field Team",
      title: `Hotspot: ${worst.fo.name}`,
      metric: `${plural(worst.n, "low-yield plot")} (${worst.share.toFixed(0)}% of their plots)`,
      cause: "Problems are concentrated under one field officer — local water source, soil or advisory gap.",
      action: `Review ${worst.fo.name}'s visit schedule and village-level irrigation.`,
      plotKeys: worst.keys,
    });
  }

  // Data coverage
  const noMap = plots.filter((p) => p.positions.length < 3 && !p.point).length;
  const noPlant = plots.filter((p) => !p.plantationDate).length;
  if (plots.length && (noMap > 0 || noPlant / plots.length > 0.2)) {
    issues.push({
      id: "data",
      severity: "info",
      category: "Data",
      title: "Incomplete plot records",
      metric: `${plural(noMap, "plot")} without boundary · ${noPlant} without plantation date`,
      cause: "Missing boundary or plantation date lowers the accuracy of stage and yield estimates.",
      action: "Ask the field officers to update these plots in the app.",
      plotKeys: plots.filter((p) => !p.plantationDate).map((p) => p.key),
    });
  }

  const order: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ═══════════════════════════ Colours ═══════════════════════════ */

export const STAGE_COLORS: Record<CropStage, string> = {
  "Harvest Maturity": "#f59e0b",
  "Grand Growth": "#22c55e",
  Tillering: "#84cc16",
  Other: "#94a3b8",
};

export const STATUS_COLORS: Record<string, string> = {
  Growing: "#22c55e",
  "Ready to Harvest": "#f59e0b",
  "Partially Harvested": "#3b82f6",
  Harvested: "#a855f7",
  Unknown: "#94a3b8",
};

export const statusColor = (status: string) => STATUS_COLORS[status || "Unknown"] ?? STATUS_COLORS.Unknown;

export const INDEX_META: Record<IndexKey, { label: string; color: string; source: string }> = {
  growth: { label: "Growth Index", color: "#22c55e", source: "NDVI" },
  stress: { label: "Stress Index", color: "#ef4444", source: "NDMI" },
  water: { label: "Water Index", color: "#3b82f6", source: "NDWI" },
  moisture: { label: "Moisture Index", color: "#f59e0b", source: "NDRE" },
};
