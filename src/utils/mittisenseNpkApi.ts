/**
 * Mittisense NPK recommendation (SEF).
 * GET /mittisense-npk/recommendation/{plot_name}
 */
import { getPlotNameCandidates, type PlotRef } from "./plotName";

const SEF_BASE =
  String(import.meta.env.VITE_DEV_FIELD_API_URL ?? "")
    .trim()
    .replace(/\/$/, "") || "https://sef-cropeye.up.railway.app";

export type MittisenseProductDose = {
  product: string;
  kg: number;
};

export type MittisenseRecommendation = {
  plot_id?: string;
  headline?: string;
  stage?: string;
  stage_window?: string;
  days_after_sowing?: number;
  products?: string[];
  product_doses?: MittisenseProductDose[];
  /** Recommendation-tab nutrient targets (kg/acre). */
  N?: number;
  P?: number;
  K?: number;
  /** In-chemical nutrient totals from satellite bags (no boost). */
  inchemical_N?: number;
  inchemical_P?: number;
  inchemical_K?: number;
  urea_kg?: number;
  mop_kg?: number;
  dap_kg?: number;
  ssp_kg?: number;
  fym_kg?: number;
  fert_191919_kg?: number;
  fert_130045_kg?: number;
  sop_kg?: number;
  actions?: string[];
  note?: string;
  conversion?: {
    dap_N_frac?: number;
    dap_P_frac?: number;
    ssp_P_frac?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type MittisenseSoilAnalysis = {
  plot_id?: string;
  headline?: string;
  note?: string;
  stage?: string;
  stage_window?: string;
  /** Soil N/P/K — may be number or "less than 10". */
  N?: number | string | null;
  P?: number | string | null;
  K?: number | string | null;
  peak_N?: number | null;
  peak_P?: number | null;
  peak_K?: number | null;
  soil_baseline?: { N?: number; P?: number; K?: number };
  products?: string[];
  product_doses?: MittisenseProductDose[];
  [key: string]: unknown;
};

const inFlight = new Map<string, Promise<MittisenseRecommendation | null>>();
const soilAnalysisInFlight = new Map<
  string,
  Promise<MittisenseSoilAnalysis | null>
>();

/** Display helper: API may return number or "less than 10". */
export function mittisenseNutrientDisplay(
  value: unknown,
): number | string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /less\s*than/i.test(value)) {
    return value.trim();
  }
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const text = String(value).trim();
  return text || null;
}

/** Numeric value for gauges when display is "less than 10". */
export function mittisenseNutrientNumeric(value: unknown): number | null {
  const display = mittisenseNutrientDisplay(value);
  if (display == null) return null;
  if (typeof display === "number") return display;
  if (/less\s*than/i.test(display)) return 5;
  const n = Number(display);
  return Number.isFinite(n) ? n : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /less\s*than/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasProduct(
  data: MittisenseRecommendation,
  name: string,
): boolean {
  const want = name.trim().toLowerCase();
  if ((data.products ?? []).some((p) => String(p).toLowerCase().includes(want))) {
    return true;
  }
  if (
    (data.product_doses ?? []).some((d) =>
      String(d?.product ?? "")
        .toLowerCase()
        .includes(want),
    )
  ) {
    return true;
  }
  return false;
}

function productKg(
  data: MittisenseRecommendation,
  name: string,
  fieldKg?: number | null,
): number {
  if (fieldKg != null && Number.isFinite(fieldKg) && fieldKg > 0) return fieldKg;
  const want = name.trim().toLowerCase();
  const dose = (data.product_doses ?? []).find((d) =>
    String(d?.product ?? "")
      .toLowerCase()
      .includes(want),
  );
  const kg = num(dose?.kg);
  return kg != null && kg > 0 ? kg : 0;
}

export function parseMittisenseRecommendation(
  raw: unknown,
): MittisenseRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  return {
    ...data,
    plot_id: data.plot_id != null ? String(data.plot_id) : undefined,
    headline: data.headline != null ? String(data.headline) : undefined,
    stage: data.stage != null ? String(data.stage) : undefined,
    products: Array.isArray(data.products)
      ? data.products.map((p) => String(p))
      : [],
    product_doses: Array.isArray(data.product_doses)
      ? data.product_doses.map((row: any) => ({
          product: String(row?.product ?? ""),
          kg: Number(row?.kg) || 0,
        }))
      : [],
    N: num(data.N) ?? 0,
    P: num(data.P) ?? 0,
    K: num(data.K) ?? 0,
    inchemical_N: num(data.inchemical_N) ?? 0,
    inchemical_P: num(data.inchemical_P) ?? 0,
    inchemical_K: num(data.inchemical_K) ?? 0,
    urea_kg: num(data.urea_kg) ?? 0,
    mop_kg: num(data.mop_kg) ?? 0,
    dap_kg: num(data.dap_kg) ?? 0,
    ssp_kg: num(data.ssp_kg) ?? 0,
    fym_kg: num(data.fym_kg) ?? 0,
    fert_191919_kg: num(data.fert_191919_kg) ?? 0,
    fert_130045_kg: num(data.fert_130045_kg) ?? 0,
    sop_kg: num(data.sop_kg) ?? 0,
    actions: Array.isArray(data.actions)
      ? data.actions.map((a) => String(a))
      : [],
    note: data.note != null ? String(data.note) : undefined,
    conversion:
      data.conversion && typeof data.conversion === "object"
        ? (data.conversion as MittisenseRecommendation["conversion"])
        : undefined,
  };
}

/**
 * In-chemical cards from mittisense recommendation:
 * - Only products that appear in products / product_doses / actions (or kg > 0)
 * - Urea only when urea is actually available
 * - FYM kg → tons/acre (÷ 1000)
 * - Apply line taken from matching `actions` entry when present
 */
export type ChemicalNutrientCard = {
  name: string;
  symbol: string;
  value: number;
  unit: string;
  applyHeadline?: string;
};

function findActionLine(
  actions: string[] | undefined,
  product: string,
): string | undefined {
  if (!actions?.length) return undefined;
  const want = product.trim().toLowerCase();
  const hit = actions.find((a) => String(a).toLowerCase().includes(want));
  if (!hit) return undefined;
  // Prefer the short "Apply …" line
  const applyMatch = hit.match(/Apply\s+[\d.]+\s*kg\s+[A-Za-z0-9:]+/i);
  if (applyMatch) return applyMatch[0];
  return hit.startsWith("Apply") ? hit : `Apply ${product}`;
}

function isProductAvailable(
  data: MittisenseRecommendation,
  name: string,
  fieldKg?: number | null,
): boolean {
  if (fieldKg != null && Number.isFinite(fieldKg) && fieldKg > 0) return true;
  if (hasProduct(data, name)) return true;
  const want = name.trim().toLowerCase();
  return (data.actions ?? []).some((a) => String(a).toLowerCase().includes(want));
}

export function buildInChemicalCards(
  data: MittisenseRecommendation | null,
): ChemicalNutrientCard[] {
  if (!data) return [];

  const cards: ChemicalNutrientCard[] = [];

  const pushProduct = (
    name: string,
    symbol: string,
    kg: number,
    opts?: { unit?: string; convertTons?: boolean },
  ) => {
    if (!isProductAvailable(data, name, kg) && !(kg > 0)) return;
    const useTons = Boolean(opts?.convertTons);
    const value = useTons ? Number((kg / 1000).toFixed(2)) : kg;
    const unit = opts?.unit ?? (useTons ? "tons/acre" : "kg");
    const apply =
      findActionLine(data.actions, name) ||
      (kg > 0
        ? useTons
          ? `Apply ${value} tons ${name}`
          : `Apply ${kg} kg ${name}`
        : undefined);
    cards.push({
      name,
      symbol,
      value,
      unit,
      applyHeadline: apply,
    });
  };

  const ureaKg = productKg(data, "urea", data.urea_kg);
  const mopKg = productKg(data, "mop", data.mop_kg);
  const dapKg = productKg(data, "dap", data.dap_kg);
  const fymKg = productKg(data, "fym", data.fym_kg);
  const sspKg = productKg(data, "ssp", data.ssp_kg);
  const sopKg = productKg(data, "sop", data.sop_kg);
  const fert1919 = productKg(data, "19:19:19", data.fert_191919_kg);
  const fert130045 = productKg(data, "13:00:45", data.fert_130045_kg);

  // Urea — only when urea is actually in this advisory
  if (ureaKg > 0 || hasProduct(data, "urea")) {
    pushProduct("Urea", "N", ureaKg);
  }

  // DAP — product kg when present
  if (dapKg > 0 || hasProduct(data, "dap")) {
    pushProduct("DAP", "DAP", dapKg);
  }

  // FYM — convert kg → tons/acre
  if (fymKg > 0 || hasProduct(data, "fym")) {
    pushProduct("FYM", "FYM", fymKg, { convertTons: true });
  }

  // SSP
  if (sspKg > 0 || hasProduct(data, "ssp")) {
    pushProduct("SSP", "P", sspKg);
  }

  // MOP
  if (mopKg > 0 || hasProduct(data, "mop")) {
    pushProduct("MOP", "K", mopKg);
  }

  // SOP / complex fertilizers when present
  if (sopKg > 0 || hasProduct(data, "sop")) {
    pushProduct("SOP", "K", sopKg);
  }
  if (fert1919 > 0 || hasProduct(data, "19:19:19")) {
    pushProduct("19:19:19", "NPK", fert1919);
  }
  if (fert130045 > 0 || hasProduct(data, "13:00:45")) {
    pushProduct("13:00:45", "NK", fert130045);
  }

  // Remaining product_doses not already covered
  const covered = [
    "urea",
    "dap",
    "mop",
    "fym",
    "ssp",
    "sop",
    "19:19:19",
    "13:00:45",
  ];
  for (const dose of data.product_doses ?? []) {
    const label = String(dose.product ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (covered.some((c) => key.includes(c))) continue;
    if (!(dose.kg > 0)) continue;
    pushProduct(label, label.slice(0, 3).toUpperCase(), dose.kg);
  }

  return cards;
}

/** Row payloads for Fertilizer Schedule (N / P / K) from mittisense recommendation. */
export type FertilizerScheduleMittisense = {
  headline: string;
  /** First headline product qty for that nutrient card (not API N/P/K totals). */
  N: number;
  P: number;
  K: number;
  /** Chemical column lines — same product→card map as Soil Recommendation. */
  chemicalN: string[];
  chemicalP: string[];
  chemicalK: string[];
  /** Organic — FYM on N row only. */
  organicN: string[];
  organicP: string[];
  organicK: string[];
};

type HeadlineProduct = { product: string; kg: number };

function parseHeadlineProducts(text: string): HeadlineProduct[] {
  if (!text) return [];
  const out: HeadlineProduct[] = [];
  const re = /(\d+(?:\.\d+)?)\s*kg\s+([A-Za-z0-9:]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kg = Number(m[1]);
    const product = String(m[2]).trim();
    if (!product || !Number.isFinite(kg) || kg <= 0) continue;
    out.push({ product, kg });
  }
  return out;
}

/** Same map as Soil Recommendation cards. */
function cardsForHeadlineProduct(product: string): Array<"N" | "P" | "K"> {
  const p = product.trim().toLowerCase();
  if (/urea/.test(p)) return ["N"];
  if (/dap/.test(p)) return ["N", "P"];
  if (/ssp|super\s*phos/.test(p)) return ["P"];
  if (/mop|potash/.test(p)) return ["K"];
  if (/fym/.test(p)) return ["N"];
  if (/19\s*:\s*19\s*:\s*19/.test(p)) return ["N"];
  if (/35\s*:\s*00\s*:\s*52|13\s*:\s*00\s*:\s*45/.test(p)) return ["K"];
  return [];
}

function formatHeadlineApply(row: HeadlineProduct): string {
  if (/fym/i.test(row.product)) {
    const tons = Number((row.kg / 1000).toFixed(2));
    return `Apply ${tons} tons/acre FYM`;
  }
  return `Apply ${row.kg} kg ${row.product}`;
}

function formatChemicalLine(row: HeadlineProduct): string {
  if (/fym/i.test(row.product)) {
    const tons = Number((row.kg / 1000).toFixed(2));
    return `FYM: ${tons} tons/acre`;
  }
  return `${row.product}: ${row.kg} kg`;
}

/**
 * Fertilizer Schedule from mittisense — same Recommendation logic:
 * headline products → N/P/K rows; gate by inchemical_* === 0.
 */
export function buildFertilizerScheduleFromMittisense(
  data: MittisenseRecommendation | null,
): FertilizerScheduleMittisense | null {
  if (!data) return null;

  const headline =
    (data.headline && String(data.headline).trim()) ||
    (data.note && String(data.note).trim()) ||
    "";

  let products = parseHeadlineProducts(headline);
  if (!products.length) {
    const doses = data.product_doses ?? [];
    products = doses
      .filter((d) => d.kg > 0 && String(d.product ?? "").trim())
      .map((d) => ({ product: String(d.product).trim(), kg: d.kg }));
  }
  if (!products.length) {
    const fields: Array<[string, number | undefined]> = [
      ["Urea", data.urea_kg],
      ["DAP", data.dap_kg],
      ["FYM", data.fym_kg],
      ["SSP", data.ssp_kg],
      ["MOP", data.mop_kg],
      ["19:19:19", data.fert_191919_kg],
      ["13:00:45", data.fert_130045_kg],
    ];
    products = fields
      .filter(([, kg]) => kg != null && kg > 0)
      .map(([product, kg]) => ({ product, kg: kg as number }));
  }

  const inN = data.inchemical_N ?? 0;
  const inP = data.inchemical_P ?? 0;
  const inK = data.inchemical_K ?? 0;

  type Slot = {
    value: number;
    chemical: string[];
    organic: string[];
    applies: string[];
  };
  const slots: Record<"N" | "P" | "K", Slot> = {
    N: { value: 0, chemical: [], organic: [], applies: [] },
    P: { value: 0, chemical: [], organic: [], applies: [] },
    K: { value: 0, chemical: [], organic: [], applies: [] },
  };

  for (const row of products) {
    const targets = cardsForHeadlineProduct(row.product);
    if (!targets.length) continue;
    const isFym = /fym/i.test(row.product);
    const displayValue = isFym ? Number((row.kg / 1000).toFixed(2)) : row.kg;
    const apply = formatHeadlineApply(row);
    const chemLine = formatChemicalLine(row);

    for (const symbol of targets) {
      const slot = slots[symbol];
      if (slot.value === 0) slot.value = displayValue;

      if (isFym) {
        // FYM → N organic only (not chemical / not P/K)
        if (symbol === "N" && !slot.organic.includes(chemLine)) {
          slot.organic.push(chemLine);
        }
        continue;
      }

      if (!slot.applies.includes(apply)) slot.applies.push(apply);
      if (!slot.chemical.includes(chemLine)) slot.chemical.push(chemLine);
    }
  }

  // Gate: inchemical 0 → nothing recommended on that row
  const emptyIf = (on: boolean, slot: Slot): Slot =>
    on
      ? slot
      : { value: 0, chemical: [], organic: [], applies: [] };

  const nSlot = emptyIf(inN > 0, slots.N);
  const pSlot = emptyIf(inP > 0, slots.P);
  const kSlot = emptyIf(inK > 0, slots.K);

  // Prefer Apply lines in chemical column when present (matches Recommendation under-card text)
  const chemOrApply = (slot: Slot): string[] => {
    if (slot.applies.length) return slot.applies;
    return slot.chemical;
  };

  return {
    headline,
    N: nSlot.value,
    P: pSlot.value,
    K: kSlot.value,
    chemicalN: chemOrApply(nSlot),
    chemicalP: chemOrApply(pSlot),
    chemicalK: chemOrApply(kSlot),
    organicN: nSlot.organic,
    organicP: [],
    organicK: [],
  };
}

async function fetchOne(
  plotName: string,
  asOf?: string,
): Promise<MittisenseRecommendation | null> {
  const encoded = encodeURIComponent(plotName);
  const qs = asOf ? `?as_of=${encodeURIComponent(asOf)}` : "";
  const url = `${SEF_BASE}/mittisense-npk/recommendation/${encoded}${qs}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return parseMittisenseRecommendation(json);
}

export async function fetchMittisenseRecommendation(
  plotId: string,
  plots?: PlotRef[] | null,
  asOf?: string,
): Promise<MittisenseRecommendation | null> {
  if (!plotId?.trim()) return null;
  const candidates = getPlotNameCandidates(plotId, plots);
  if (!candidates.length) return null;

  const dedupeKey = `${candidates.join("|")}|${asOf ?? "today"}`;
  const existing = inFlight.get(dedupeKey);
  if (existing) return existing;

  const pending = (async () => {
    for (const name of candidates) {
      try {
        const data = await fetchOne(name, asOf);
        if (data) return data;
      } catch {
        // try next plot-name form
      }
    }
    return null;
  })().finally(() => {
    inFlight.delete(dedupeKey);
  });

  inFlight.set(dedupeKey, pending);
  return pending;
}

export function parseMittisenseSoilAnalysis(
  raw: unknown,
): MittisenseSoilAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const baseline =
    data.soil_baseline && typeof data.soil_baseline === "object"
      ? (data.soil_baseline as { N?: number; P?: number; K?: number })
      : undefined;
  return {
    ...data,
    plot_id: data.plot_id != null ? String(data.plot_id) : undefined,
    headline: data.headline != null ? String(data.headline) : undefined,
    note: data.note != null ? String(data.note) : undefined,
    stage: data.stage != null ? String(data.stage) : undefined,
    stage_window:
      data.stage_window != null ? String(data.stage_window) : undefined,
    N: mittisenseNutrientDisplay(data.N),
    P: mittisenseNutrientDisplay(data.P),
    K: mittisenseNutrientDisplay(data.K),
    peak_N: num(data.peak_N) ?? num(data.peak_n_kg_acre),
    peak_P: num(data.peak_P) ?? num(data.peak_p_kg_acre),
    peak_K: num(data.peak_K) ?? num(data.peak_k_kg_acre),
    soil_baseline: baseline,
    products: Array.isArray(data.products)
      ? data.products.map((p) => String(p))
      : [],
    product_doses: Array.isArray(data.product_doses)
      ? data.product_doses.map((row: any) => ({
          product: String(row?.product ?? ""),
          kg: Number(row?.kg) || 0,
        }))
      : [],
  };
}

async function fetchSoilAnalysisOne(
  plotName: string,
  asOf?: string,
): Promise<MittisenseSoilAnalysis | null> {
  const encoded = encodeURIComponent(plotName);
  const qs = asOf ? `?as_of=${encodeURIComponent(asOf)}` : "";
  const url = `${SEF_BASE}/mittisense-npk/soil-analysis/${encoded}${qs}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return parseMittisenseSoilAnalysis(json);
}

export async function fetchMittisenseSoilAnalysis(
  plotId: string,
  plots?: PlotRef[] | null,
  asOf?: string,
): Promise<MittisenseSoilAnalysis | null> {
  if (!plotId?.trim()) return null;
  const candidates = getPlotNameCandidates(plotId, plots);
  if (!candidates.length) return null;

  const dedupeKey = `soil|${candidates.join("|")}|${asOf ?? "today"}`;
  const existing = soilAnalysisInFlight.get(dedupeKey);
  if (existing) return existing;

  const pending = (async () => {
    for (const name of candidates) {
      try {
        const data = await fetchSoilAnalysisOne(name, asOf);
        if (data) return data;
      } catch {
        // try next plot-name form
      }
    }
    return null;
  })().finally(() => {
    soilAnalysisInFlight.delete(dedupeKey);
  });

  soilAnalysisInFlight.set(dedupeKey, pending);
  return pending;
}
