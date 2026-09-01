/**
 * Keep a farm's last successful PATCH values until GET /farms/my-profile/
 * returns them. After a refresh, that GET often still has the previous plot's
 * nested farm object, so the form must overlay what we already saved.
 */

const STORAGE_PREFIX = "cropeye:farm-save:";
const LAST_FARM_ID_KEY = "cropeye:last-farm-id";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export const FARM_FIELDS_UPDATED_EVENT = "cropeye:farm-fields-updated";

type PendingEntry = {
  savedAt: number;
  fields: Record<string, string>;
};

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${String(id).trim()}`;
}

function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function asFields(fields: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

export function persistSavedFarmFields(id: string, fields: object): void {
  const store = readStorage();
  if (!store || !String(id).trim()) return;
  try {
    const entry: PendingEntry = { savedAt: Date.now(), fields: asFields(fields) };
    store.setItem(storageKey(id), JSON.stringify(entry));
    if (!String(id).startsWith("plot:") && !String(id).startsWith("plotkey:")) {
      store.setItem(LAST_FARM_ID_KEY, String(id).trim());
    }
  } catch {
    // Storage full or blocked — in-memory merge still covers this session.
  }
}

export function readLastSavedFarmId(): string {
  const store = readStorage();
  if (!store) return "";
  try {
    return String(store.getItem(LAST_FARM_ID_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function readSavedFarmFields(id: string): Record<string, string> | null {
  const store = readStorage();
  if (!store || !String(id).trim()) return null;
  try {
    const raw = store.getItem(storageKey(id));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PendingEntry;
    if (!entry?.fields || typeof entry.fields !== "object") return null;
    if (!Number.isFinite(entry.savedAt) || Date.now() - entry.savedAt > PENDING_TTL_MS) {
      store.removeItem(storageKey(id));
      return null;
    }
    return entry.fields;
  } catch {
    return null;
  }
}

export function listSavedFarmFieldEntries(): Array<{
  id: string;
  fields: Record<string, string>;
}> {
  const store = readStorage();
  if (!store) return [];
  const out: Array<{ id: string; fields: Record<string, string> }> = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const id = key.slice(STORAGE_PREFIX.length);
    const fields = readSavedFarmFields(id);
    if (fields) out.push({ id, fields });
  }
  return out;
}

export function clearSavedFarmFields(id: string): void {
  const store = readStorage();
  if (!store || !String(id).trim()) return;
  try {
    store.removeItem(storageKey(id));
  } catch {
    // Entry expires via PENDING_TTL_MS.
  }
}

function toApiPlantationType(display: string): string {
  const v = (display ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (v === "pre_seasonal" || v === "preseasonal") return "pre-seasonal";
  return display?.trim() || v;
}

function toApiPlantingMethod(display: string): string {
  const v = (display ?? "").trim().toLowerCase();
  if (v.includes("stip")) return "1_bud_stip";
  if (v.startsWith("3")) return "3_bud";
  if (v.startsWith("2")) return "2_bud";
  if (v.startsWith("1")) return "1_bud";
  return v.replace(/\s+/g, "_");
}

function applyFormFieldsToFarm(farm: any, fields: Record<string, string>): any {
  const irrigation = (fields.irrigation_type ?? "").trim().toLowerCase();
  const prevIrr = Array.isArray(farm?.irrigations) ? farm.irrigations[0] ?? {} : {};
  const crop =
    farm?.crop_type && typeof farm.crop_type === "object" && !Array.isArray(farm.crop_type)
      ? farm.crop_type
      : {};
  const nextIrrigation = {
    ...prevIrr,
    irrigation_type_code: irrigation || prevIrr.irrigation_type_code,
    irrigation_type_name: irrigation || prevIrr.irrigation_type_name,
    irrigation_type: irrigation || prevIrr.irrigation_type,
    flow_rate_lph: fields.flow_rate_liter_per_hour || prevIrr.flow_rate_lph,
    emitters_count: fields.emitters_per_plant || prevIrr.emitters_count,
    motor_horsepower: fields.motor_horsepower || prevIrr.motor_horsepower,
    pipe_width_inches: fields.pipe_width_inches || prevIrr.pipe_width_inches,
    distance_motor_to_plot_m:
      fields.distance_motor_to_plot_m || prevIrr.distance_motor_to_plot_m,
  };
  return {
    ...farm,
    address: fields.address ?? farm?.address,
    area_size: fields.area_size ?? farm?.area_size,
    plantation_date: fields.plantation_date ?? farm?.plantation_date,
    crop_variety: fields.crop_variety ?? farm?.crop_variety,
    variety_type: fields.variety_type ?? farm?.variety_type,
    variety_subtype: fields.variety_subtype ?? farm?.variety_subtype,
    plantation_type: toApiPlantationType(fields.variety_type || fields.plantation_type || ""),
    planting_method: toApiPlantingMethod(fields.variety_subtype || fields.planting_method || ""),
    spacing_a: fields.spacing_a ?? farm?.spacing_a,
    spacing_b: fields.spacing_b ?? farm?.spacing_b,
    irrigation_type: irrigation || farm?.irrigation_type,
    flow_rate_liter_per_hour: fields.flow_rate_liter_per_hour ?? farm?.flow_rate_liter_per_hour,
    flow_rate_lph: fields.flow_rate_liter_per_hour ?? farm?.flow_rate_lph,
    emitters_per_plant: fields.emitters_per_plant ?? farm?.emitters_per_plant,
    emitters_count: fields.emitters_per_plant ?? farm?.emitters_count,
    sugarcane_type: fields.sugarcane_type ?? farm?.sugarcane_type,
    sugarcane_yield: fields.sugarcane_yield ?? farm?.sugarcane_yield,
    plants_in_field: fields.plants_in_field ?? farm?.plants_in_field,
    irrigations: Array.isArray(farm?.irrigations)
      ? [nextIrrigation, ...farm.irrigations.slice(1)]
      : [nextIrrigation],
    crop_type: {
      ...crop,
      crop_variety: fields.crop_variety ?? crop.crop_variety,
      plantation_type: toApiPlantationType(
        fields.variety_type || fields.plantation_type || crop.plantation_type || "",
      ),
      planting_method: toApiPlantingMethod(
        fields.variety_subtype || fields.planting_method || crop.planting_method || "",
      ),
    },
  };
}

function farmMatches(
  farm: any,
  plot: any,
  id: string,
): boolean {
  const token = String(id);
  if (token.startsWith("plot:")) {
    const plotId = token.slice(5);
    return (
      (plot?.id != null && String(plot.id) === plotId) ||
      (farm?.plot_id != null && String(farm.plot_id) === plotId)
    );
  }
  if (token.startsWith("plotkey:")) {
    const key = token.slice(8).toLowerCase();
    const candidates = [
      plot?.fastapi_plot_id,
      plot?.id,
      farm?.id,
      farm?.farm_uid,
      plot?.gat_number && plot?.plot_number
        ? `${plot.gat_number}_${plot.plot_number}`
        : "",
      plot?.gat_number && plot?.plot_number
        ? `${plot.gat_number}/${plot.plot_number}`
        : "",
    ]
      .filter(Boolean)
      .map((value) =>
        String(value).trim().toLowerCase().replace(/\//g, "_").replace(/\s+/g, "_"),
      );
    return candidates.includes(key);
  }
  return farm?.id != null && String(farm.id) === token;
}

function patchFarms(farms: any[], plot: any, id: string, fields: Record<string, string>) {
  return farms.map((farm: any) =>
    farmMatches(farm, plot, id) ? applyFormFieldsToFarm(farm, fields) : farm,
  );
}

/**
 * Replay locally saved farm fields onto a my-profile payload so refresh does
 * not show pre-PATCH values while GET is still stale.
 */
export function overlaySavedFarmsOnProfile(data: any): any {
  if (!data) return data;
  const entries = listSavedFarmFieldEntries();
  if (!entries.length) return data;

  let next = { ...data };
  for (const { id, fields } of entries) {
    if (Array.isArray(next.plots)) {
      next.plots = next.plots.map((plot: any) => {
        const patched = { ...plot };
        if (Array.isArray(plot?.farms)) {
          patched.farms = patchFarms(plot.farms, plot, id, fields);
        }
        if (plot?.farm && typeof plot.farm === "object") {
          patched.farm = farmMatches(plot.farm, plot, id)
            ? applyFormFieldsToFarm(plot.farm, fields)
            : plot.farm;
        }
        return patched;
      });
    }
    if (Array.isArray(next.farms)) {
      next.farms = patchFarms(next.farms, next.plot ?? null, id, fields);
    }
    if (next.farm && farmMatches(next.farm, next.plot ?? next.farm?.plot, id)) {
      next.farm = applyFormFieldsToFarm(next.farm, fields);
    }
    // GET ?farm_id= can return the farm object at the root (id + crop_type).
    if (!Array.isArray(next.plots) && next.id != null && farmMatches(next, next.plot ?? null, id)) {
      next = applyFormFieldsToFarm(next, fields);
    }
  }
  return next;
}

export function notifyFarmFieldsUpdated(profilePayload: unknown): void {
  window.dispatchEvent(
    new CustomEvent(FARM_FIELDS_UPDATED_EVENT, { detail: profilePayload }),
  );
}
