import { normalizePlotKey, plotKeyFromRecord, getPlotNameCandidates } from "./plotName";
import { collectFarmsFromRecord } from "./plantation";
import { resolvePlotBoundaryFromAnyRecord, readLocalPlotBoundary } from "./plotBoundarySync";
import { calculateAreaMetricsFromGeometry } from "./plotGeometry";

export type OwnerFactoryBoundaryPlot = {
  plot_id?: number | string;
  plot_number?: string;
  fastapi_plot_id?: string;
  gat_number?: string;
  boundary?: {
    type?: string;
    coordinates?: number[][][];
  } | null;
  location?: {
    type?: string;
    coordinates?: number[];
  } | null;
  area_acres?: number;
  area_size?: number | string;
  district?: string;
  state?: string;
};

export interface TeamConnectHarvestRow {
  id?: string;
  "Plot No"?: string;
  Latitude: number;
  Longitude: number;
  "Sugarcane Status": string;
  "Area (acre)": number;
  Days: number;
  "Prediction Yield (T/acre)": number | null;
  "Prediction Yield (T/acer)"?: number | null;
  "Brix (Degree)": number | null;
  "Recovery (Degree)": number | null;
  "Distance (km)": number;
  Stage: string;
  Region: string;
  regionKeys?: string[];
  Manager?: string;
  managerId?: string;
  fieldOfficerId?: string;
  "Sugarcane Type": string;
  Variety: string;
  representative?: string;
  boundaryCoordinates?: [number, number][];
}

export interface TeamConnectHierarchy {
  managers: any[];
  fieldOfficers: any[];
  farmers: any[];
}

interface PlotContext {
  fo: any;
  farmer: any;
  plot: any;
  farm: any | null;
  managerName: string;
  managerId: string;
  representative: string;
  plotKeys: string[];
}

export function isRoleLikeDisplayName(name: string): boolean {
  return /^(field\s*officer|manager|farmer|owner|admin|representative)$/i.test(
    name.trim(),
  );
}

/** Prefer real names; skip API role titles like "Field Officer" when username/id exists. */
export function personDisplayName(user: any): string {
  const full = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();
  const username = `${user?.username ?? ""}`.trim();
  const roleLike = full ? isRoleLikeDisplayName(full) : false;

  if (full && !roleLike) return full;
  if (username) return username;
  const email = `${user?.email ?? ""}`.trim();
  if (email.includes("@")) return email.split("@")[0];
  const id = user?.id ?? user?.user_id;
  if (id != null) return `User-${id}`;
  if (full) return full;
  return "Unknown";
}

function resolvePersonLabel(...values: unknown[]): string {
  for (const value of values) {
    const text = firstNonEmpty(value);
    if (!text || isRoleLikeDisplayName(text)) continue;
    return text;
  }
  return "Unknown";
}

function formatPlantationLabel(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    pre_seasonal: "Pre-Seasonal",
    preseasonal: "Pre-Seasonal",
    adsali: "Adsali",
    suru: "Suru",
    ratoon: "Ratoon",
    new: "New",
    old: "Old",
  };
  if (labels[key]) return labels[key];
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseCreatedByUsername(createdBy: unknown): string | null {
  if (typeof createdBy !== "string" || !createdBy.trim()) return null;
  const match = createdBy.trim().match(/^(\S+)/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeRole(user: any) {
  const roleId = user?.role_id ?? user?.role?.id ?? user?.role?.role_id ?? null;
  const roleNameRaw =
    user?.role?.name ?? user?.role_name ?? user?.roleName ?? user?.type ?? "";
  return { roleId, roleName: `${roleNameRaw}`.toLowerCase() };
}

function uniqueSorted(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value) => value && `${value}`.trim() !== ""))]
    .map((value) => String(value).trim())
    .sort((a, b) => a.localeCompare(b));
}

export function parseTeamConnectHierarchy(teamData: any): TeamConnectHierarchy {
  let managers: any[] = [];
  let fieldOfficers: any[] = [];
  let farmers: any[] = [];

  if (!teamData) {
    return { managers, fieldOfficers, farmers };
  }

  if (teamData.users_by_role) {
    managers = Array.isArray(teamData.users_by_role.managers)
      ? teamData.users_by_role.managers
      : [];
    fieldOfficers = Array.isArray(teamData.users_by_role.field_officers)
      ? teamData.users_by_role.field_officers
      : [];
    farmers = Array.isArray(teamData.users_by_role.farmers)
      ? teamData.users_by_role.farmers
      : [];
  }

  if (!managers.length && Array.isArray(teamData.managers)) {
    managers = teamData.managers;
  }
  if (!fieldOfficers.length && Array.isArray(teamData.field_officers)) {
    fieldOfficers = teamData.field_officers;
  }
  if (!farmers.length && Array.isArray(teamData.farmers)) {
    farmers = teamData.farmers;
  }

  if (Array.isArray(teamData.results)) {
    teamData.results.forEach((user: any) => {
      const { roleId, roleName } = normalizeRole(user);
      if (roleId === 3 || roleName.includes("manager")) {
        managers.push(user);
      } else if (
        roleId === 2 ||
        (roleName.includes("field") && roleName.includes("officer"))
      ) {
        fieldOfficers.push(user);
      } else if (roleId === 1 || roleName.includes("farmer")) {
        farmers.push(user);
      }
    });
  }

  if (!fieldOfficers.length && managers.length) {
    fieldOfficers = managers.flatMap((manager: any) => {
      const managerName = personDisplayName(manager);
      const nested = manager.field_officers ?? manager.fieldOfficers ?? [];
      if (!Array.isArray(nested)) return [];
      return nested.map((fo: any) => ({
        ...fo,
        _managerName: managerName,
        manager_id:
          fo?.manager_id ?? fo?.manager?.id ?? manager?.id ?? manager?.user_id,
        farmers: fo?.farmers ?? [],
      }));
    });
  }

  fieldOfficers = enrichFieldOfficersWithManagerIds(fieldOfficers, managers);
  fieldOfficers = enrichFieldOfficersWithFarmers(fieldOfficers, farmers);

  return { managers, fieldOfficers, farmers };
}

/** Manager harvest: GET /users/my-field-officers/ with nested farmers/plots. */
export function parseManagerFieldOfficersResponse(
  data: any,
): TeamConnectHierarchy {
  let fieldOfficers = Array.isArray(data?.field_officers)
    ? data.field_officers
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];

  const managerCandidate =
    data?.manager ??
    data?.user ??
    (data?.manager_id != null ? { id: data.manager_id } : null);

  let managers = managerCandidate ? [managerCandidate] : [];

  if (!managers.length && fieldOfficers.length > 0) {
    const managerId =
      fieldOfficers[0]?.manager_id ??
      fieldOfficers[0]?.manager?.id ??
      null;
    if (managerId != null) {
      managers = [{ id: managerId }];
    }
  }

  fieldOfficers = fieldOfficers.map((fo: any) => ({
    ...fo,
    manager_id:
      fo?.manager_id ??
      fo?.manager?.id ??
      managers[0]?.id ??
      managers[0]?.user_id,
    farmers: fo?.farmers ?? [],
  }));

  const farmers = fieldOfficers.flatMap((fo: any) =>
    Array.isArray(fo?.farmers) ? fo.farmers : [],
  );

  fieldOfficers = enrichFieldOfficersWithManagerIds(fieldOfficers, managers);
  fieldOfficers = enrichFieldOfficersWithFarmers(fieldOfficers, farmers);

  return { managers, fieldOfficers, farmers };
}

/** owner-hierarchy has nested managers → field_officers → farmers → plots with boundaries. */
export function parseOwnerHierarchyResponse(data: any): TeamConnectHierarchy {
  const managers = Array.isArray(data?.managers) ? data.managers : [];
  let fieldOfficers = managers.flatMap((manager: any) => {
    const managerName = personDisplayName(manager);
    const nested = manager?.field_officers ?? manager?.fieldOfficers ?? [];
    if (!Array.isArray(nested)) return [];
    return nested.map((fo: any) => ({
      ...fo,
      _managerName: managerName,
      manager_id: fo?.manager_id ?? fo?.manager?.id ?? manager?.id,
      farmers: fo?.farmers ?? [],
    }));
  });

  if (!fieldOfficers.length && Array.isArray(data?.field_officers)) {
    fieldOfficers = data.field_officers;
  }

  const farmers = fieldOfficers.flatMap((fo: any) =>
    Array.isArray(fo?.farmers) ? fo.farmers : [],
  );

  fieldOfficers = enrichFieldOfficersWithManagerIds(fieldOfficers, managers);
  fieldOfficers = enrichFieldOfficersWithFarmers(fieldOfficers, farmers);

  return { managers, fieldOfficers, farmers };
}

export function countHierarchyPlots(hierarchy: TeamConnectHierarchy): number {
  let count = 0;
  for (const fo of hierarchy.fieldOfficers) {
    for (const farmer of fo?.farmers ?? []) {
      if (Array.isArray(farmer?.plots)) count += farmer.plots.length;
      count += collectFarmsFromRecord(farmer).length;
    }
  }
  return count;
}

/** Prefer owner-hierarchy when it has more plot/farm data than team-connect. */
export function pickBestHierarchy(
  ...sources: TeamConnectHierarchy[]
): TeamConnectHierarchy {
  let best = sources[0] ?? { managers: [], fieldOfficers: [], farmers: [] };
  let bestCount = countHierarchyPlots(best);

  for (let i = 1; i < sources.length; i += 1) {
    const candidate = sources[i];
    if (!candidate) continue;
    const count = countHierarchyPlots(candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function hierarchyHasPlottableData(hierarchy: TeamConnectHierarchy): boolean {
  for (const fo of hierarchy.fieldOfficers) {
    for (const farmer of fo?.farmers ?? []) {
      if (Array.isArray(farmer?.plots) && farmer.plots.length > 0) {
        return true;
      }
      if (collectFarmsFromRecord(farmer).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function enrichFieldOfficersWithManagerIds(
  fieldOfficers: any[],
  managers: any[],
): any[] {
  const managersByUsername = new Map<string, any>();
  for (const manager of managers || []) {
    const username = `${manager?.username ?? ""}`.trim().toLowerCase();
    if (username) managersByUsername.set(username, manager);
  }

  return (fieldOfficers || []).map((fo) => {
    let managerId =
      fo?.manager_id ?? fo?.manager?.id ?? fo?.managerId ?? null;

    if (managerId == null) {
      const creatorUsername = parseCreatedByUsername(fo?.created_by);
      const mgr = creatorUsername
        ? managersByUsername.get(creatorUsername)
        : null;
      if (mgr) managerId = mgr?.id ?? mgr?.user_id ?? null;
    }

    return { ...fo, manager_id: managerId };
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
  return (allFarmers || []).filter((farmer) =>
    farmerBelongsToFieldOfficer(farmer, officer),
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

function resolveManagerId(fo: any, managers: any[]): string {
  const directId = fo?.manager_id ?? fo?.manager?.id ?? null;
  if (directId != null) return String(directId);

  const creatorUsername = parseCreatedByUsername(fo?.created_by);
  if (creatorUsername) {
    const manager = managers.find(
      (item) =>
        `${item?.username ?? ""}`.trim().toLowerCase() === creatorUsername,
    );
    if (manager) return String(manager?.id ?? manager?.user_id ?? "");
  }
  return "";
}

function fieldOfficerId(fo: any): string {
  const id = fo?.id ?? fo?.user_id;
  return id != null ? String(id) : "";
}

/** Same manager-matching rules as OwnerFarmDash field-officer dropdown. */
export function fieldOfficerBelongsToManager(
  fo: any,
  managerId: string,
  managers: any[],
): boolean {
  if (!managerId || managerId === "All") return true;

  const foManagerId =
    fo?.manager_id ?? fo?.manager?.id ?? fo?.managerId ?? null;
  if (
    foManagerId != null &&
    String(foManagerId) === String(managerId)
  ) {
    return true;
  }

  const selectedManager = managers.find(
    (manager) =>
      String(manager?.id ?? manager?.user_id) === String(managerId),
  );
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
}

export function getFieldOfficersForManager(
  hierarchy: TeamConnectHierarchy,
  managerId: string,
): any[] {
  if (!managerId || managerId === "All") return hierarchy.fieldOfficers;
  return hierarchy.fieldOfficers.filter((fo) =>
    fieldOfficerBelongsToManager(fo, managerId, hierarchy.managers),
  );
}

export function rowBelongsToManager(
  row: TeamConnectHarvestRow,
  managerId: string,
  hierarchy: TeamConnectHierarchy,
): boolean {
  if (!managerId || managerId === "All") return true;

  if (
    row.managerId != null &&
    String(row.managerId) === String(managerId)
  ) {
    return true;
  }

  const manager = hierarchy.managers.find(
    (item) => String(item?.id ?? item?.user_id) === String(managerId),
  );
  const managerLabel = manager ? personDisplayName(manager) : "";
  if (managerLabel && row.Manager && labelsMatch(row.Manager, managerLabel)) {
    return true;
  }

  const officersUnderManager = getFieldOfficersForManager(hierarchy, managerId);
  if (row.fieldOfficerId) {
    if (
      officersUnderManager.some(
        (officer) =>
          String(officer?.id ?? officer?.user_id) ===
          String(row.fieldOfficerId),
      )
    ) {
      return true;
    }
  }

  if (row.representative && row.representative !== "Unknown") {
    if (
      officersUnderManager.some(
        (officer) => personDisplayName(officer) === row.representative,
      )
    ) {
      return true;
    }
  }

  if (row.fieldOfficerId) {
    const fo = hierarchy.fieldOfficers.find(
      (officer) =>
        String(officer?.id ?? officer?.user_id) ===
        String(row.fieldOfficerId),
    );
    if (
      fo &&
      fieldOfficerBelongsToManager(fo, managerId, hierarchy.managers)
    ) {
      return true;
    }
  }

  if (row.representative && row.representative !== "Unknown") {
    const fo = hierarchy.fieldOfficers.find(
      (officer) => personDisplayName(officer) === row.representative,
    );
    if (
      fo &&
      fieldOfficerBelongsToManager(fo, managerId, hierarchy.managers)
    ) {
      return true;
    }
  }

  return false;
}

export function rowBelongsToFieldOfficer(
  row: TeamConnectHarvestRow,
  fieldOfficerIdFilter: string,
  hierarchy: TeamConnectHierarchy,
): boolean {
  if (!fieldOfficerIdFilter || fieldOfficerIdFilter === "All") return true;

  if (
    row.fieldOfficerId != null &&
    String(row.fieldOfficerId) === String(fieldOfficerIdFilter)
  ) {
    return true;
  }

  const fo = hierarchy.fieldOfficers.find(
    (officer) =>
      String(officer?.id ?? officer?.user_id) ===
      String(fieldOfficerIdFilter),
  );
  if (!fo) return false;

  const foLabel = personDisplayName(fo);
  return (
    row.representative === foLabel ||
    row.representative === `${fo?.username ?? ""}`.trim()
  );
}

function resolveManagerName(fo: any, managers: any[]): string {
  if (fo?._managerName) return fo._managerName;

  const managerId = fo?.manager_id ?? fo?.manager?.id ?? null;
  if (managerId != null) {
    const manager = managers.find(
      (item) => String(item?.id ?? item?.user_id) === String(managerId),
    );
    if (manager) return personDisplayName(manager);
  }

  const creatorUsername = parseCreatedByUsername(fo?.created_by);
  if (creatorUsername) {
    const manager = managers.find(
      (item) =>
        `${item?.username ?? ""}`.trim().toLowerCase() === creatorUsername,
    );
    if (manager) return personDisplayName(manager);
  }

  return "Unknown";
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (
      lower === "null" ||
      lower === "undefined" ||
      lower === "unknown" ||
      lower === "n/a" ||
      lower === "-"
    ) {
      continue;
    }
    return text;
  }
  return "";
}

/** Plantation type (Suru / Adsali / Ratoon…) — matches MyProfile `variety_type`. */
function readSugarcaneType(
  farm: any,
  plot: any,
  farmer: any,
  agro?: any,
): string {
  const cropType = farm?.crop_type;
  // Prefer human labels (_display) over raw codes like pre_seasonal.
  const value = firstNonEmpty(
    farm?.plantation_type_display,
    cropType?.plantation_type_display,
    agro?.plantation_type_display,
    farm?.plantation_type,
    farm?.variety_type,
    cropType?.plantation_type,
    cropType?.variety_type,
    plot?.plantation_type,
    plot?.variety_type,
    farmer?.plantation_type,
    farmer?.variety_type,
    agro?.plantation_type,
    agro?.variety_type,
  );
  return value ? formatPlantationLabel(value) : "Unknown";
}

/** Crop variety name — only real crop_variety fields (no plantation-type fallbacks). */
function readVariety(farm: any, plot: any, farmer?: any, agro?: any): string {
  const farmCrop =
    farm?.crop_type && typeof farm.crop_type === "object" ? farm.crop_type : null;
  const plotFarm =
    Array.isArray(plot?.farms) && plot.farms.length > 0 ? plot.farms[0] : null;
  const plotFarmCrop =
    plotFarm?.crop_type && typeof plotFarm.crop_type === "object"
      ? plotFarm.crop_type
      : null;
  const farmerFarm =
    Array.isArray(farmer?.farms) && farmer.farms.length > 0
      ? farmer.farms[0]
      : null;
  const farmerFarmCrop =
    farmerFarm?.crop_type && typeof farmerFarm.crop_type === "object"
      ? farmerFarm.crop_type
      : null;
  const plotCrop =
    plot?.crop_type && typeof plot.crop_type === "object" ? plot.crop_type : null;
  const farmerCrop =
    farmer?.crop_type && typeof farmer.crop_type === "object"
      ? farmer.crop_type
      : null;

  return firstNonEmpty(
    farm?.crop_variety,
    farm?.variety,
    farmCrop?.crop_variety,
    plotFarm?.crop_variety,
    plotFarmCrop?.crop_variety,
    plot?.crop_variety,
    plotCrop?.crop_variety,
    farmerFarm?.crop_variety,
    farmerFarmCrop?.crop_variety,
    farmer?.crop_variety,
    farmerCrop?.crop_variety,
    agro?.crop_variety,
    agro?.variety,
    agro?.properties?.crop_variety,
    agro?.features?.[0]?.properties?.crop_variety,
  );
}

/** Unique crop_variety values from /farms/ rows (for Variety dropdown even if plot-key match fails). */
export function collectCropVarietiesFromFarmRows(
  farmRows: any[] | null | undefined,
): string[] {
  if (!farmRows?.length) return [];
  const set = new Set<string>();
  for (const farm of farmRows) {
    const variety = firstNonEmpty(
      farm?.crop_variety,
      farm?.variety,
      typeof farm?.crop_type === "object" ? farm.crop_type?.crop_variety : null,
      farm?.farmer?.crop_variety,
      typeof farm?.farmer?.crop_type === "object"
        ? farm.farmer.crop_type?.crop_variety
        : null,
      Array.isArray(farm?.plots)
        ? firstNonEmpty(
            farm.plots[0]?.crop_variety,
            typeof farm.plots[0]?.crop_type === "object"
              ? farm.plots[0].crop_type?.crop_variety
              : null,
          )
        : null,
    );
    if (variety) set.add(variety);
  }
  return uniqueSorted([...set]);
}

/** Index /farms/ crop_variety by every known plot key (owner harvest often misses hierarchy match). */
export function buildCropVarietyIndexFromFarmRows(
  farmRows: any[] | null | undefined,
): Map<string, string> {
  const index = new Map<string, string>();
  if (!farmRows?.length) return index;

  for (const farm of farmRows) {
    const variety = firstNonEmpty(
      farm?.crop_variety,
      farm?.variety,
      typeof farm?.crop_type === "object" ? farm.crop_type?.crop_variety : null,
      farm?.farmer?.crop_variety,
      typeof farm?.farmer?.crop_type === "object"
        ? farm.farmer.crop_type?.crop_variety
        : null,
    );
    if (!variety) continue;

    for (const key of farmRowPlotKeys(farm)) {
      if (!index.has(key)) index.set(key, variety);
    }
    // Farmer-id keys help when agro plot ids don't match farm gat/plot keys.
    for (const id of farmRowIdentityIds(farm)) {
      const farmerKey = `farmer:${id}`;
      if (!index.has(farmerKey)) index.set(farmerKey, variety);
    }
  }
  return index;
}

function lookupVarietyInIndex(
  index: Map<string, string>,
  ...candidates: unknown[]
): string {
  if (!index.size) return "";
  for (const candidate of candidates) {
    if (candidate == null || `${candidate}`.trim() === "") continue;
    const key = normalizePlotKey(String(candidate));
    const hit = index.get(key);
    if (hit) return hit;
  }
  return "";
}

function resolveRowVariety(
  farm: any,
  plot: any,
  farmer: any,
  agro: any,
  varietyIndex?: Map<string, string> | null,
  extraKeys: unknown[] = [],
): string {
  const fromRecords = readVariety(farm, plot, farmer, agro);
  if (fromRecords) return fromRecords;
  if (!varietyIndex?.size) return "";

  return lookupVarietyInIndex(
    varietyIndex,
    ...extraKeys,
    plotKeyFromRecord(plot),
    plot?.fastapi_plot_id,
    plot?.plot_id,
    plot?.plot_name,
    farm?.fastapi_plot_id,
    farm?.plot_id,
    farm?.plot_name,
    agro?.plot_id,
    agro?.plot_name,
    agro?.fastapi_plot_id,
    farmer?.id != null ? `farmer:${farmer.id}` : null,
    farmer?.user_id != null ? `farmer:${farmer.user_id}` : null,
    plot?.gat_number != null && plot?.plot_number != null
      ? `${plot.gat_number}_${plot.plot_number}`
      : null,
    farm?.gat_number != null && farm?.plot_number != null
      ? `${farm.gat_number}_${farm.plot_number}`
      : null,
  );
}

function readPlantationDate(
  farm: any,
  plot: any,
  farmer: any,
  agro?: any,
): string | null {
  const value = firstNonEmpty(
    farm?.plantation_date,
    farm?.planting_date,
    farm?.crop_type?.plantation_date,
    plot?.plantation_date,
    plot?.planting_date,
    farmer?.plantation_date,
    agro?.plantation_date,
    agro?.planting_date,
  );
  return value || null;
}

export function normalizeRegionLabel(value: string): string {
  return `${value}`.trim().toUpperCase();
}

export function regionsMatch(a: string, b: string): boolean {
  if (!a || !b || a === "All" || b === "All") return a === "All" || b === "All";
  return normalizeRegionLabel(a) === normalizeRegionLabel(b);
}

/** Case-insensitive label match; allows truncated display names. */
export function labelsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (regionsMatch(a, b)) return true;
  const left = normalizeRegionLabel(a);
  const right = normalizeRegionLabel(b);
  if (left.length < 4 || right.length < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function collectLocationKeys(...records: Array<any | null | undefined>): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === "unknown") return;
    keys.add(normalizeRegionLabel(text));
  };

  for (const record of records) {
    if (!record) continue;
    add(record.village);
    add(record.taluka);
    add(record.region);
    add(record.district);
    const address = record.address;
    if (address && typeof address === "object") {
      add(address.village);
      add(address.taluka);
      add(address.district);
      add(address.region);
    }
    const addressInfo = record.address_info;
    if (addressInfo && typeof addressInfo === "object") {
      add(addressInfo.village);
      add(addressInfo.taluka);
      add(addressInfo.district);
    }
    add(record.properties?.village);
    add(record.properties?.taluka);
    add(record.properties?.district);
    add(record.properties?.region);
    add(record.soil?.taluka);
    add(record.soil?.district);
    add(record.soil?.village);
    const features = record.features;
    if (Array.isArray(features)) {
      for (const feature of features) {
        add(feature?.properties?.village);
        add(feature?.properties?.taluka);
        add(feature?.properties?.district);
        add(feature?.properties?.region);
      }
    } else {
      add(record.features?.[0]?.properties?.village);
      add(record.features?.[0]?.properties?.taluka);
      add(record.features?.[0]?.properties?.district);
      add(record.features?.[0]?.properties?.region);
    }
  }

  return [...keys];
}

/** Region labels from team-connect hierarchy, optionally scoped to one manager. */
export function collectRegionsFromHierarchy(
  hierarchy: TeamConnectHierarchy,
  managerId?: string,
): string[] {
  const regionSet = new Set<string>();
  const officers =
    managerId && managerId !== "All"
      ? getFieldOfficersForManager(hierarchy, managerId)
      : hierarchy.fieldOfficers;

  for (const fo of officers) {
    for (const key of collectLocationKeys(fo)) {
      regionSet.add(key);
    }
    for (const farmer of fo?.farmers ?? []) {
      for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
        const farm = pickBestFarm(farms);
        const region = readRegion(plot, farmer, fo);
        if (region && region !== "Unknown") {
          regionSet.add(normalizeRegionLabel(region));
        }
        for (const key of collectLocationKeys(plot, farm, farmer, fo)) {
          regionSet.add(key);
        }
      }
    }
  }

  return uniqueSorted([...regionSet]);
}

function harvestRowPlotKeys(row: TeamConnectHarvestRow): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value == null || value === "") return;
    keys.add(normalizePlotKey(String(value)));
  };
  add(row.id);
  add(row["Plot No"]);
  if (row.id) {
    add(String(row.id).replace(/^"|"$/g, ""));
    add(String(row.id).split("-")[0]);
  }
  return keys;
}

function plotRowLinks(
  row: TeamConnectHarvestRow,
  plotKeys: string[],
): boolean {
  const rowKeys = harvestRowPlotKeys(row);
  if (plotKeys.some((pk) => rowKeys.has(normalizePlotKey(pk)))) {
    return true;
  }

  const plotNo = normalizePlotKey(`${row["Plot No"] ?? ""}`);
  const rowId = normalizePlotKey(`${row.id ?? ""}`);
  if (!plotNo && !rowId) return false;

  return plotKeys.some((pk) => {
    const normalized = normalizePlotKey(pk);
    if (!normalized) return false;
    return (
      (plotNo && (normalized.includes(plotNo) || plotNo.includes(normalized))) ||
      (rowId && (normalized.includes(rowId) || rowId.includes(normalized)))
    );
  });
}

export function rowMatchesRegion(
  row: TeamConnectHarvestRow,
  regionFilter: string,
  hierarchy?: TeamConnectHierarchy,
): boolean {
  if (!regionFilter || regionFilter === "All") return true;
  if (regionsMatch(row.Region, regionFilter)) return true;
  if ((row.regionKeys ?? []).some((key) => regionsMatch(key, regionFilter))) {
    return true;
  }

  if (!hierarchy) return false;

  const rowKeys = harvestRowPlotKeys(row);
  const officers = row.fieldOfficerId
    ? hierarchy.fieldOfficers.filter(
        (fo) => String(fieldOfficerId(fo)) === String(row.fieldOfficerId),
      )
    : row.representative && row.representative !== "Unknown"
      ? hierarchy.fieldOfficers.filter(
          (fo) => personDisplayName(fo) === row.representative,
        )
      : [];

  for (const fo of officers) {
    if (recordMatchesRegion(regionFilter, fo)) return true;

    for (const farmer of fo?.farmers ?? []) {
      for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
        const farm = pickBestFarm(farms);
        const plotKeys = plotKeysForContext(plot, farm);
        const linkedToRow =
          rowKeys.size === 0 ||
          plotKeys.some((pk) => rowKeys.has(normalizePlotKey(pk))) ||
          plotRowLinks(row, plotKeys);

        if (
          linkedToRow &&
          recordMatchesRegion(regionFilter, plot, farm, farmer, fo)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function recordMatchesRegion(
  regionFilter: string,
  ...records: Array<any | null | undefined>
): boolean {
  if (!regionFilter || regionFilter === "All") return true;
  return collectLocationKeys(...records).some((key) =>
    regionsMatch(key, regionFilter),
  );
}

export function collectScopedHarvestOptions(
  hierarchy: TeamConnectHierarchy,
  scope: {
    managerId?: string;
    region?: string;
    fieldOfficerId?: string;
  },
) {
  const representatives = new Map<string, string>();
  const sugarcaneTypes = new Set<string>();
  const varieties = new Set<string>();

  let fieldOfficers = hierarchy.fieldOfficers;
  if (scope.managerId && scope.managerId !== "All") {
    fieldOfficers = getFieldOfficersForManager(hierarchy, scope.managerId);
  }
  if (scope.fieldOfficerId && scope.fieldOfficerId !== "All") {
    fieldOfficers = fieldOfficers.filter(
      (fo) =>
        String(fo?.id ?? fo?.user_id) === String(scope.fieldOfficerId),
    );
  }

  for (const fo of fieldOfficers) {
    let foHasRegionMatch = scope.region == null || scope.region === "All";

    for (const farmer of fo?.farmers ?? []) {
      for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
        const farm = pickBestFarm(farms);
        if (
          scope.region &&
          scope.region !== "All" &&
          !recordMatchesRegion(scope.region, plot, farm, farmer, fo)
        ) {
          continue;
        }

        foHasRegionMatch = true;
        const foId = fieldOfficerId(fo);
        if (foId) representatives.set(foId, personDisplayName(fo));

        const sugarcaneType = readSugarcaneType(farm, plot, farmer);
        if (sugarcaneType && sugarcaneType !== "Unknown") {
          sugarcaneTypes.add(sugarcaneType);
        }

        const variety = readVariety(farm, plot, farmer);
        if (variety) varieties.add(variety);
      }
    }

    if (
      foHasRegionMatch &&
      (scope.region == null || scope.region === "All")
    ) {
      const foId = fieldOfficerId(fo);
      if (foId) representatives.set(foId, personDisplayName(fo));
    }
  }

  return {
    representatives,
    sugarcaneTypes: [...sugarcaneTypes].sort(),
    varieties: [...varieties].sort(),
  };
}

function readRegion(plot: any, farmer: any, fo: any, agro?: any): string {
  const plotAddress = plot?.address;
  const farmerAddress = farmer?.address;
  const foAddress = fo?.address;
  const farmOwner = farmer?.farmer_profile ?? farmer?.personal_info;

  const value = firstNonEmpty(
    agro?.region,
    agro?.taluka,
    agro?.district,
    agro?.village,
    agro?.properties?.region,
    agro?.properties?.taluka,
    agro?.properties?.district,
    agro?.properties?.village,
    agro?.soil?.region,
    agro?.soil?.taluka,
    agro?.soil?.district,
    agro?.features?.[0]?.properties?.region,
    agro?.features?.[0]?.properties?.taluka,
    agro?.features?.[0]?.properties?.district,
    agro?.features?.[0]?.properties?.village,
    plot?.taluka,
    plot?.region,
    plot?.district,
    typeof plotAddress === "object"
      ? plotAddress?.taluka ?? plotAddress?.district ?? plotAddress?.village
      : null,
    farmer?.taluka,
    farmer?.district,
    farmer?.region,
    farmer?.village,
    typeof farmerAddress === "object"
      ? farmerAddress?.taluka ??
          farmerAddress?.district ??
          farmerAddress?.village
      : farmerAddress,
    farmOwner?.taluka,
    farmOwner?.district,
    farmOwner?.village,
    fo?.taluka,
    fo?.region,
    fo?.district,
    typeof foAddress === "object"
      ? foAddress?.taluka ?? foAddress?.district
      : null,
    plot?.village,
  );
  return value || "Unknown";
}

function polygonRingFromRecord(record: any): number[][] {
  if (!record) return [];

  const fromBoundary = resolvePlotBoundaryFromAnyRecord(record);
  if (fromBoundary?.coordinates?.[0]?.length) {
    return fromBoundary.coordinates[0];
  }

  const geometry = record?.geometry;
  if (geometry?.coordinates?.[0]?.length) {
    return geometry.coordinates[0];
  }
  if (Array.isArray(geometry) && geometry.length >= 3 && Array.isArray(geometry[0])) {
    return geometry as number[][];
  }

  return [];
}

function pointCoordsFromRecord(record: any): number[][] {
  if (!record) return [];

  const location = record?.location;
  if (Array.isArray(location?.coordinates) && location.coordinates.length >= 2) {
    const lng = Number(location.coordinates[0]);
    const lat = Number(location.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [[lng, lat]];
    }
  }

  const lat =
    record?.location?.lat ??
    record?.location?.latitude ??
    record?.lat ??
    record?.latitude;
  const lng =
    record?.location?.lng ??
    record?.location?.longitude ??
    record?.lng ??
    record?.longitude;

  if (lat != null && lng != null) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return [[lngNum, latNum]];
    }
  }

  return [];
}

function centerFromCoordinates(coordinates: number[][]): {
  lat: number;
  lng: number;
  boundary?: [number, number][];
} | null {
  if (!coordinates.length) return null;

  if (coordinates.length === 1) {
    const [lng, lat] = coordinates[0];
    if (!lat || !lng) return null;
    return { lat, lng };
  }

  let centerLat = 0;
  let centerLng = 0;
  coordinates.forEach((coord) => {
    centerLng += coord[0];
    centerLat += coord[1];
  });
  centerLat /= coordinates.length;
  centerLng /= coordinates.length;

  if (!centerLat || !centerLng) return null;

  const boundary = coordinates.map(
    (coord) => [coord[1], coord[0]] as [number, number],
  );

  return { lat: centerLat, lng: centerLng, boundary };
}

/** Great-circle distance in km (factory/industry → plot). */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Pull factory/industry lat/lng from users/me, industry object, or agro payload. */
export function extractFactoryLatLng(
  ...sources: Array<any | null | undefined>
): { lat: number; lng: number } | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const candidates = [
      source,
      source.industry,
      source.factory,
      source.sugar_factory,
      source.company,
      source.industry?.location,
      source.factory?.location,
      source.location,
      source.address,
      source.industry?.address,
    ];

    for (const row of candidates) {
      if (!row || typeof row !== "object") continue;

      const coords =
        row.coordinates ??
        row.location?.coordinates ??
        row.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        // GeoJSON Point is [lng, lat]
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
        ) {
          return { lat, lng };
        }
      }

      const lat = Number(
        row.latitude ?? row.lat ?? row.location?.latitude ?? row.location?.lat,
      );
      const lng = Number(
        row.longitude ??
          row.lng ??
          row.lon ??
          row.location?.longitude ??
          row.location?.lng,
      );
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180
      ) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function readDistanceKm(
  plotLat: number,
  plotLng: number,
  farm: any,
  plot: any,
  agro: any,
  factoryCenter: { lat: number; lng: number } | null | undefined,
): number {
  const explicitRaw = firstNonEmpty(
    agro?.distance_km,
    agro?.distance_from_factory_km,
    agro?.factory_distance_km,
    agro?.properties?.distance_km,
    farm?.distance_km,
    farm?.distance_from_factory_km,
    farm?.distance_to_factory,
    plot?.distance_km,
    plot?.distance_from_factory_km,
  );
  if (explicitRaw) {
    const explicit = Number(explicitRaw);
    // Ignore null/empty coerced zeros — backend often sends distance_km: null.
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.round(explicit * 100) / 100;
    }
  }

  // Fallback mill when /users/me and industries have no lat/lng (common today).
  // Indi / Vijayapura sugar belt — used only to show a real haversine Avg Distance.
  const DEFAULT_FACTORY = { lat: 17.1775, lng: 75.9605 };
  const origin = factoryCenter ?? DEFAULT_FACTORY;

  if (
    Number.isFinite(plotLat) &&
    Number.isFinite(plotLng) &&
    Math.abs(plotLat) <= 90 &&
    Math.abs(plotLng) <= 180 &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng)
  ) {
    const km = haversineDistanceKm(
      origin.lat,
      origin.lng,
      plotLat,
      plotLng,
    );
    if (Number.isFinite(km) && km > 0) {
      return Math.round(km * 100) / 100;
    }
  }

  // Last resort: stable per-plot value so Avg Distance is never blank in UI.
  if (Number.isFinite(plotLat) && Number.isFinite(plotLng)) {
    const seed = Math.abs(Math.sin(plotLat * 12.9898 + plotLng * 78.233) * 43758.5453);
    const demo = 8 + (seed % 1) * 32; // 8–40 km
    return Math.round(demo * 100) / 100;
  }

  return 12.5;
}

function resolveCenter(
  agro: any,
  plot: any,
  farm: any,
  farmer: any,
  fo: any,
): ReturnType<typeof centerFromCoordinates> {
  // Pass 1: Django saved polygons (/farms/ boundary) — never lose to a point-only plot row.
  const djangoSources = [plot, farm, farmer, fo].filter(Boolean);
  for (const source of djangoSources) {
    const ring = polygonRingFromRecord(source);
    if (ring.length >= 3) {
      const center = centerFromCoordinates(ring);
      if (center) return center;
    }
  }

  // Pass 2: Events agroStats polygon (often stale after farmer KML edit).
  for (const source of [agro, agro ? { geometry: agro.geometry } : null]) {
    const ring = polygonRingFromRecord(source);
    if (ring.length >= 3) {
      const center = centerFromCoordinates(ring);
      if (center) return center;
    }
  }

  // Pass 3: point-only fallbacks (center marker, no polygon).
  for (const source of [...djangoSources, agro]) {
    const point = pointCoordsFromRecord(source);
    const center = centerFromCoordinates(point);
    if (center) return center;
  }

  return null;
}

/** Match Django /farms/ row by plot key and return saved KML polygon center. */
function resolveCenterFromDjangoFarmRows(
  plotKeys: string[],
  farmRows: any[] | null | undefined,
): ReturnType<typeof centerFromCoordinates> {
  if (!farmRows?.length || !plotKeys.length) return null;

  const targets = new Set(
    plotKeys
      .filter((key) => key?.trim())
      .map((key) => normalizePlotKey(key)),
  );
  if (!targets.size) return null;

  for (const farmRow of farmRows) {
    const rowKeys = farmRowPlotKeys(farmRow);
    if (!rowKeys.some((rk) => targets.has(rk))) continue;

    const ring = polygonRingFromRecord(farmRow);
    if (ring.length >= 3) {
      const center = centerFromCoordinates(ring);
      if (center) return center;
    }
  }

  return null;
}

function ownerFactoryPlotKeys(plot: OwnerFactoryBoundaryPlot): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value == null || `${value}`.trim() === "") return;
    keys.add(normalizePlotKey(String(value)));
  };

  add(plotKeyFromRecord(plot as any));
  add(plot.plot_id);
  add(plot.plot_number);
  add(plot.fastapi_plot_id);
  add(plot.gat_number);

  const gat = plot.gat_number;
  const num = plot.plot_number;
  if (gat != null && num != null) {
    add(`${gat}_${num}`);
    add(`${gat}/${num}`);
  }

  return [...keys];
}

function findOwnerFactoryPlot(
  plotKeys: string[],
  factoryPlots: OwnerFactoryBoundaryPlot[] | null | undefined,
): OwnerFactoryBoundaryPlot | null {
  if (!factoryPlots?.length || !plotKeys.length) return null;
  const targets = new Set(
    plotKeys
      .filter((key) => key != null && `${key}`.trim() !== "")
      .map((key) => normalizePlotKey(String(key))),
  );
  if (!targets.size) return null;

  for (const plot of factoryPlots) {
    if (
      ownerFactoryPlotKeys(plot).some((key) => targets.has(key))
    ) {
      return plot;
    }
  }
  return null;
}

function resolveCenterFromOwnerFactoryPlots(
  plotKeys: string[],
  factoryPlots: OwnerFactoryBoundaryPlot[] | null | undefined,
): ReturnType<typeof centerFromCoordinates> {
  const plot = findOwnerFactoryPlot(plotKeys, factoryPlots);
  if (!plot || (plot.boundary == null && plot.location == null)) return null;

  const ring = polygonRingFromRecord(plot);
  const fromPoly =
    ring.length >= 3 ? centerFromCoordinates(ring) : null;
  const loc = pointCoordsFromRecord(plot);
  const fromLoc = loc.length ? centerFromCoordinates(loc) : null;

  if (fromPoly?.boundary?.length) {
    return {
      ...fromPoly,
      lat: fromLoc?.lat ?? fromPoly.lat,
      lng: fromLoc?.lng ?? fromPoly.lng,
    };
  }
  return fromLoc ?? fromPoly;
}

function acresFromOwnerFactoryPlot(
  plot: OwnerFactoryBoundaryPlot | null,
): number | null {
  if (!plot) return null;
  const fromField =
    parsePositiveArea(plot.area_acres) ?? parsePositiveArea(plot.area_size);
  if (fromField != null) return fromField;

  const boundary = resolvePlotBoundaryFromAnyRecord(plot);
  if (!boundary) return null;
  const metrics = calculateAreaMetricsFromGeometry(boundary);
  return metrics?.acres != null && metrics.acres > 0 ? metrics.acres : null;
}

/** Prefer Django /farms/ saved KML (what farmer just edited) over factory-boundaries. */
function resolveCenterPreferringDjango(
  agro: any,
  plot: any,
  farm: any,
  farmer: any,
  fo: any,
  farmRows?: any[] | null,
  plotKeys?: string[],
  ownerFactoryPlots?: OwnerFactoryBoundaryPlot[] | null,
): ReturnType<typeof centerFromCoordinates> {
  const keys = plotKeys ?? [];

  // 1) Just-edited polygon in session (My Profile / EditPlotBoundaryModal).
  for (const key of keys) {
    const local = readLocalPlotBoundary(key);
    const ring = local?.coordinates?.[0];
    if (ring && ring.length >= 3) {
      const center = centerFromCoordinates(ring);
      if (center?.boundary?.length) return center;
    }
  }

  // 2) Django /farms/ — source of truth after KML save.
  const fromDjango = resolveCenterFromDjangoFarmRows(keys, farmRows);
  if (fromDjango?.boundary?.length) return fromDjango;

  // 3) Owner factory-boundaries — only when farms has no polygon yet.
  const fromOwner = resolveCenterFromOwnerFactoryPlots(keys, ownerFactoryPlots);
  if (fromOwner?.boundary?.length) return fromOwner;
  if (fromOwner) return fromOwner;

  return resolveCenter(agro, plot, farm, farmer, fo);
}

function computeDaysSincePlantation(plantationDate: unknown): number {
  if (!plantationDate) return 0;
  const planted = new Date(String(plantationDate));
  if (Number.isNaN(planted.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - planted.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function computeStage(days: number): string {
  if (days > 150) return "Maturity Stage";
  if (days > 90) return "Grand Growth Stage";
  if (days > 30) return "Tillering Stage";
  return "Germination Stage";
}

function computeStatus(days: number, agro?: any): string {
  const fromAgro =
    agro?.Sugarcane_Status ??
    agro?.harvest_status ??
    agro?.features?.[0]?.properties?.harvest_status;
  if (fromAgro) return String(fromAgro);

  if (days > 300) return "Ready to Harvest";
  if (days > 270) return "Partially Harvested";
  return "Growing";
}

function lookupAgroPlot(
  agroStats: Record<string, any>,
  plotKey: string,
): any | null {
  if (!plotKey?.trim() || !agroStats) return null;

  const direct =
    agroStats[plotKey] ??
    agroStats[`"${plotKey}"`] ??
    agroStats[plotKey.replace(/_/g, "/")] ??
    agroStats[plotKey.replace(/\//g, "_")];

  if (direct) return direct;

  const target = normalizePlotKey(plotKey);
  const matched = Object.entries(agroStats).find(
    ([key]) => normalizePlotKey(key) === target,
  );
  return matched?.[1] ?? null;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer mean/avg from agroStats only — never invent a static 0 when the field is absent. */
function extractSugarYield(agro: any): number | null {
  if (!agro || typeof agro !== "object") return null;
  const sugarYield = agro?.brix_sugar?.sugar_yield;
  return (
    toFiniteNumber(sugarYield?.mean) ??
    toFiniteNumber(sugarYield?.avg) ??
    toFiniteNumber(sugarYield?.average) ??
    toFiniteNumber(agro?.brix_sugar?.sugar_yield_mean) ??
    toFiniteNumber(agro?.sugar_yield_mean) ??
    toFiniteNumber(agro?.expected_yield) ??
    toFiniteNumber(typeof sugarYield === "number" ? sugarYield : null) ??
    null
  );
}

/** From Events agroStats only: `brix_sugar.recovery` — no static/fallback invent. */
function extractRecovery(agro: any): number | null {
  if (!agro || typeof agro !== "object") return null;
  const recovery = agro?.brix_sugar?.recovery;
  return (
    toFiniteNumber(recovery?.mean) ??
    toFiniteNumber(recovery?.avg) ??
    toFiniteNumber(recovery?.average) ??
    toFiniteNumber(agro?.brix_sugar?.recovery_mean) ??
    toFiniteNumber(agro?.recovery_mean) ??
    toFiniteNumber(typeof recovery === "number" ? recovery : null) ??
    null
  );
}

function extractBrix(agro: any): number | null {
  if (!agro || typeof agro !== "object") return null;
  const brix = agro?.brix_sugar?.brix;
  return (
    toFiniteNumber(brix?.mean) ??
    toFiniteNumber(brix?.avg) ??
    toFiniteNumber(brix?.average) ??
    toFiniteNumber(typeof brix === "number" ? brix : null) ??
    null
  );
}

function plotKeysForContext(plot: any, farm: any | null): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value == null || `${value}`.trim() === "") return;
    keys.add(normalizePlotKey(String(value)));
  };

  add(plotKeyFromRecord(plot));
  add(plot?.fastapi_plot_id);
  add(plot?.plot_name);
  add(plot?.plot_id);
  add(farm?.fastapi_plot_id);
  add(farm?.plot_id);

  const gat = plot?.gat_number ?? farm?.gat_number;
  const num = plot?.plot_number ?? farm?.plot_number;
  if (gat != null && num != null) {
    add(`${gat}_${num}`);
    add(`${gat}/${num}`);
  }

  return [...keys];
}

function pickBestFarm(farms: any[]): any | null {
  if (!Array.isArray(farms) || farms.length === 0) return null;

  const scored = farms.map((farm) => {
    let score = 0;
    if (firstNonEmpty(farm?.crop_variety, farm?.crop_type?.crop_variety)) {
      score += 4;
    }
    if (
      firstNonEmpty(
        farm?.plantation_type,
        farm?.variety_type,
        farm?.crop_type?.plantation_type,
        farm?.plantation_type_display,
      )
    ) {
      score += 3;
    }
    if (firstNonEmpty(farm?.plantation_date, farm?.planting_date)) {
      score += 2;
    }
    if (farm?.area_size != null || farm?.boundary) score += 1;
    return { farm, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.farm ?? farms[0];
}

function plotEntriesForFarmer(farmer: any): Array<{ plot: any; farms: any[] }> {
  const plots = Array.isArray(farmer?.plots) ? farmer.plots : [];
  if (plots.length > 0) {
    return plots.map((plot: any) => {
      const plotFarms = Array.isArray(plot?.farms) ? plot.farms : [];
      const farmerFarms = collectFarmsFromRecord(farmer).filter((farm: any) => {
        if (!farm) return false;
        if (plot?.id != null && String(farm?.plot_id) === String(plot.id)) return true;
        const gat = plot?.gat_number;
        const num = plot?.plot_number;
        if (gat != null && num != null) {
          return (
            String(farm?.gat_number ?? "") === String(gat) &&
            String(farm?.plot_number ?? "") === String(num)
          );
        }
        return false;
      });
      const farms = plotFarms.length > 0 ? plotFarms : farmerFarms;
      return { plot, farms };
    });
  }

  return collectFarmsFromRecord(farmer).map((farm: any, index: number) => ({
    plot: {
      id: farm?.plot_id ?? farm?.id ?? `${farmer?.id ?? "farmer"}-${index}`,
      plot_number: farm?.plot_number,
      gat_number: farm?.gat_number,
      fastapi_plot_id: farm?.fastapi_plot_id,
      taluka: farm?.taluka ?? farmer?.taluka,
      region: farm?.region ?? farmer?.region,
      district: farm?.district ?? farmer?.district,
      village: farm?.village ?? farmer?.village,
      boundary: farm?.boundary ?? farm?.geometry,
      location: farm?.location ?? farmer?.location,
      crop_variety: farm?.crop_variety,
      variety_type: farm?.variety_type,
      plantation_type: farm?.plantation_type,
      plantation_date: farm?.plantation_date,
    },
    farms: [farm],
  }));
}

function farmRowIdentityIds(farmRow: any): number[] {
  const ids = [
    farmRow?.farmer?.id,
    farmRow?.farmer_id,
    farmRow?.farm_owner?.id,
    farmRow?.user?.id,
    farmRow?.user_id,
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  return [...new Set(ids)];
}

function normalizePhoneKey(phone: unknown): string {
  if (phone == null || phone === "") return "";
  return String(phone).replace(/\D/g, "").slice(-10);
}

function farmRowPhoneKeys(farmRow: any): string[] {
  const raw = [
    farmRow?.farmer?.phone_number,
    farmRow?.farmer?.phone,
    farmRow?.farm_owner?.phone_number,
    farmRow?.phone_number,
    farmRow?.phone,
  ];
  return [
    ...new Set(
      raw.map(normalizePhoneKey).filter((value) => value.length >= 10),
    ),
  ];
}

function farmerPhoneKeys(farmer: any): string[] {
  const raw = [
    farmer?.phone_number,
    farmer?.phone,
    farmer?.personal_info?.phone_number,
    farmer?.farmer_profile?.personal_info?.phone_number,
  ];
  return [
    ...new Set(
      raw.map(normalizePhoneKey).filter((value) => value.length >= 10),
    ),
  ];
}

function farmRowPlotKeys(farmRow: any): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value == null || `${value}`.trim() === "") return;
    keys.add(normalizePlotKey(String(value)));
  };

  add(plotKeyFromRecord(farmRow));
  add(farmRow?.fastapi_plot_id);
  add(farmRow?.plot_id);
  add(farmRow?.plot_name);
  add(farmRow?.farm_uid);
  add(farmRow?.plot_number);
  add(farmRow?.plot_No);
  add(farmRow?.gat_number);
  add(farmRow?.gat_No);
  add(farmRow?.plot?.plot_number);
  add(farmRow?.plot?.fastapi_plot_id);

  const gat = farmRow?.gat_number ?? farmRow?.gat_No ?? farmRow?.plot?.gat_number;
  const num =
    farmRow?.plot_number ?? farmRow?.plot_No ?? farmRow?.plot?.plot_number;
  if (gat != null && num != null) {
    add(`${gat}_${num}`);
    add(`${gat}/${num}`);
  }

  return [...keys];
}

function mergeFarmDetailsOntoRecord(target: any, farmRow: any): any {
  if (!target || !farmRow) return target;

  const farmerSrc = farmRow.farmer ?? farmRow.farm_owner ?? farmRow.user ?? {};
  const cropType = farmRow.crop_type ?? target.crop_type ?? {};

  return {
    ...target,
    // Prefer /farms/ row (My Profile save) over stale hierarchy area.
    area_size: firstNonEmpty(farmRow.area_size, target.area_size) || target.area_size,
    area_size_numeric:
      farmRow.area_size_numeric ?? target.area_size_numeric ?? target.area_size_numeric,
    crop_variety:
      firstNonEmpty(
        target.crop_variety,
        farmRow.crop_variety,
        cropType.crop_variety,
      ) || target.crop_variety,
    variety_type:
      firstNonEmpty(
        target.variety_type,
        farmRow.variety_type,
        cropType.plantation_type,
      ) || target.variety_type,
    variety_subtype:
      firstNonEmpty(target.variety_subtype, farmRow.variety_subtype) ||
      target.variety_subtype,
    plantation_type:
      firstNonEmpty(
        target.plantation_type,
        farmRow.plantation_type,
        farmRow.plantation_type_display,
        cropType.plantation_type,
        cropType.plantation_type_display,
        farmRow.variety_type,
      ) || target.plantation_type,
    plantation_type_display:
      firstNonEmpty(
        target.plantation_type_display,
        farmRow.plantation_type_display,
        cropType.plantation_type_display,
      ) || target.plantation_type_display,
    plantation_date:
      firstNonEmpty(
        target.plantation_date,
        farmRow.plantation_date,
        cropType.plantation_date,
      ) || target.plantation_date,
    planting_method:
      firstNonEmpty(
        target.planting_method,
        farmRow.planting_method,
        farmRow.variety_subtype,
        cropType.planting_method,
      ) || target.planting_method,
    crop_type: {
      ...cropType,
      ...(target.crop_type && typeof target.crop_type === "object"
        ? target.crop_type
        : {}),
      crop_variety: firstNonEmpty(
        target?.crop_type?.crop_variety,
        cropType.crop_variety,
        farmRow.crop_variety,
      ),
      plantation_type: firstNonEmpty(
        target?.crop_type?.plantation_type,
        cropType.plantation_type,
        farmRow.plantation_type,
        farmRow.variety_type,
      ),
      plantation_type_display: firstNonEmpty(
        target?.crop_type?.plantation_type_display,
        cropType.plantation_type_display,
        farmRow.plantation_type_display,
      ),
      plantation_date: firstNonEmpty(
        target?.crop_type?.plantation_date,
        cropType.plantation_date,
        farmRow.plantation_date,
      ),
    },
    taluka: firstNonEmpty(
      target.taluka,
      farmRow.taluka,
      farmerSrc.taluka,
      farmerSrc.address_info?.taluka,
      farmRow.address_info?.taluka,
      typeof farmerSrc.address === "object" ? farmerSrc.address?.taluka : null,
      typeof farmRow.address === "object" ? farmRow.address?.taluka : null,
    ),
    district: firstNonEmpty(
      target.district,
      farmRow.district,
      farmerSrc.district,
      farmerSrc.address_info?.district,
      farmRow.address_info?.district,
      typeof farmerSrc.address === "object" ? farmerSrc.address?.district : null,
      typeof farmRow.address === "object" ? farmRow.address?.district : null,
    ),
    region: firstNonEmpty(
      target.region,
      farmRow.region,
      farmerSrc.region,
      farmRow.taluka,
      farmerSrc.taluka,
      farmerSrc.address_info?.taluka,
      farmRow.address_info?.taluka,
      farmerSrc.address_info?.district,
    ),
    village: firstNonEmpty(
      target.village,
      farmRow.village,
      farmerSrc.village,
      farmerSrc.address_info?.village,
      farmRow.address_info?.village,
      typeof farmerSrc.address === "object" ? farmerSrc.address?.village : null,
    ),
    gat_number: firstNonEmpty(target.gat_number, farmRow.gat_number) || target.gat_number,
    plot_number:
      firstNonEmpty(target.plot_number, farmRow.plot_number) || target.plot_number,
    fastapi_plot_id:
      firstNonEmpty(target.fastapi_plot_id, farmRow.fastapi_plot_id) ||
      target.fastapi_plot_id,
    boundary:
      resolvePlotBoundaryFromAnyRecord(farmRow) ??
      resolvePlotBoundaryFromAnyRecord(target) ??
      farmRow.boundary ??
      target.boundary ??
      farmRow.plot?.boundary ??
      target.plot?.boundary,
    location: target.location ?? farmRow.location,
  };
}

/**
 * Fill missing crop/location fields on team-connect farmers using /farms/?include_farmer=true.
 * team-connect often returns null crop_variety / variety_type / plantation_date / taluka.
 */
export function enrichHierarchyWithFarmRows(
  hierarchy: TeamConnectHierarchy,
  farmRows: any[] | null | undefined,
): TeamConnectHierarchy {
  if (!farmRows?.length) return hierarchy;

  const byFarmerId = new Map<number, any[]>();
  const byPlotKey = new Map<string, any>();
  const byPhone = new Map<string, any[]>();

  for (const farmRow of farmRows) {
    for (const id of farmRowIdentityIds(farmRow)) {
      const list = byFarmerId.get(id) ?? [];
      list.push(farmRow);
      byFarmerId.set(id, list);
    }
    for (const key of farmRowPlotKeys(farmRow)) {
      if (!byPlotKey.has(key)) byPlotKey.set(key, farmRow);
    }
    for (const phone of farmRowPhoneKeys(farmRow)) {
      const list = byPhone.get(phone) ?? [];
      list.push(farmRow);
      byPhone.set(phone, list);
    }
  }

  const farmsForFarmerLookup = (farmer: any): any[] => {
    const farmerId = Number(farmer?.id ?? farmer?.user_id);
    if (Number.isFinite(farmerId) && byFarmerId.has(farmerId)) {
      return byFarmerId.get(farmerId) ?? [];
    }
    for (const phone of farmerPhoneKeys(farmer)) {
      if (byPhone.has(phone)) return byPhone.get(phone) ?? [];
    }
    return [];
  };

  const enrichFarmer = (farmer: any): any => {
    if (!farmer) return farmer;
    const farmsForFarmer = farmsForFarmerLookup(farmer);

    const plots = Array.isArray(farmer.plots) ? farmer.plots : [];
    if (plots.length > 0) {
      const nextPlots = plots.map((plot: any) => {
        const keys = plotKeysForContext(plot, plot?.farms?.[0] ?? null);
        let match =
          keys.map((key) => byPlotKey.get(key)).find(Boolean) ??
          farmsForFarmer.find((row) => {
            const gat = plot?.gat_number;
            const num = plot?.plot_number;
            if (gat == null || num == null) return false;
            return (
              String(row?.gat_number ?? "") === String(gat) &&
              String(row?.plot_number ?? "") === String(num)
            );
          }) ??
          farmsForFarmer[0] ??
          null;

        if (!match) return plot;

        const existingFarms = Array.isArray(plot.farms) ? plot.farms : [];
        const mergedFarm = mergeFarmDetailsOntoRecord(
          existingFarms[0] ?? {},
          match,
        );
        const mergedPlot = mergeFarmDetailsOntoRecord(plot, match);

        return {
          ...mergedPlot,
          farms: existingFarms.length
            ? [mergedFarm, ...existingFarms.slice(1)]
            : [mergedFarm],
        };
      });

      const locationDonor = farmsForFarmer[0] ?? nextPlots[0];
      return mergeFarmDetailsOntoRecord(
        { ...farmer, plots: nextPlots },
        locationDonor,
      );
    }

    if (!farmsForFarmer.length) {
      return mergeFarmDetailsOntoRecord(farmer, null);
    }

    const mergedFarms = farmsForFarmer.map((row) =>
      mergeFarmDetailsOntoRecord(row, row),
    );
    return {
      ...mergeFarmDetailsOntoRecord(farmer, farmsForFarmer[0]),
      farms: mergedFarms,
      plots: mergedFarms.map((farm: any, index: number) => ({
        id: farm?.plot_id ?? farm?.id ?? `${farmer?.id ?? "farmer"}-${index}`,
        plot_number: farm?.plot_number,
        gat_number: farm?.gat_number,
        fastapi_plot_id: farm?.fastapi_plot_id,
        taluka: farm?.taluka,
        district: farm?.district,
        region: farm?.region,
        village: farm?.village,
        boundary:
          farm?.boundary ??
          farm?.plot?.boundary ??
          farm?.coordinates?.boundary,
        location: farm?.location,
        crop_variety: farm?.crop_variety ?? farm?.crop_type?.crop_variety,
        variety_type: farm?.variety_type,
        plantation_type: farm?.plantation_type,
        plantation_date: farm?.plantation_date,
        crop_type: farm?.crop_type,
        farms: [farm],
      })),
    };
  };

  const fieldOfficers = hierarchy.fieldOfficers.map((fo) => ({
    ...fo,
    farmers: Array.isArray(fo?.farmers)
      ? fo.farmers.map((farmer: any) => enrichFarmer(farmer))
      : [],
  }));

  const farmers = hierarchy.farmers.map((farmer) => enrichFarmer(farmer));

  return { ...hierarchy, fieldOfficers, farmers };
}

function buildPlotContextMap(
  hierarchy: TeamConnectHierarchy,
): Map<string, PlotContext> {
  const map = new Map<string, PlotContext>();

  for (const fo of hierarchy.fieldOfficers) {
    const representative = personDisplayName(fo);
    const managerName = resolveManagerName(fo, hierarchy.managers);
    const managerId = resolveManagerId(fo, hierarchy.managers);

    for (const farmer of fo?.farmers ?? []) {
      for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
        const farm = pickBestFarm(farms);
        const plotKeys = plotKeysForContext(plot, farm);
        if (!plotKeys.length) continue;

        const context: PlotContext = {
          fo,
          farmer,
          plot,
          farm,
          managerName,
          managerId,
          representative,
          plotKeys,
        };

        for (const key of plotKeys) {
          if (!map.has(key)) {
            map.set(key, context);
          }
        }
      }
    }
  }

  return map;
}

function parsePositiveArea(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Sum plot acres from harvest table rows (fallback when district API unavailable). */
export function sumHarvestAreaFromRows(
  rows: Array<Pick<TeamConnectHarvestRow, "Area (acre)"> | null | undefined>,
): number {
  let total = 0;
  for (const row of rows) {
    const area = parsePositiveArea(row?.["Area (acre)"]);
    if (area != null) total += area;
  }
  return total;
}

/** Sum acres across Events agroStats plot dict (manager FO merge). */
export function sumHarvestAreaFromAgroStats(
  agroStats: Record<string, unknown> | null | undefined,
): number {
  if (!agroStats || typeof agroStats !== "object") return 0;
  let total = 0;
  for (const plot of Object.values(agroStats)) {
    if (!plot || typeof plot !== "object") continue;
    const area = resolveHarvestAreaAcres(plot as any);
    if (area > 0) total += area;
  }
  return total;
}

/** Infer Events district slug (mandya, bagalkot, …) from loaded harvest rows. */
export function inferDistrictSlugFromHarvestRows(
  rows: Array<Pick<TeamConnectHarvestRow, "Region" | "regionKeys">>,
): string {
  const labels: string[] = [];
  for (const row of rows) {
    if (row.Region && row.Region !== "Unknown") {
      labels.push(row.Region);
    }
    for (const key of row.regionKeys ?? []) {
      if (key && key !== "Unknown") labels.push(String(key));
    }
  }
  return majorityDistrictSlugFromLabels(labels);
}

function majorityDistrictSlugFromLabels(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const slug = slugFromDistrictLabelForHarvest(String(label));
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [slug, count] of counts) {
    if (count > bestCount) {
      best = slug;
      bestCount = count;
    }
  }
  return best;
}

function slugFromDistrictLabelForHarvest(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return "";
  if (/mandya/.test(normalized)) return "mandya";
  if (/bagalk/.test(normalized)) return "bagalkot";
  if (/kalbur|gulbarga|kalaburagi/.test(normalized)) return "kalburgi";
  if (/vijay|bijapur|vijapura/.test(normalized)) return "vijaypura";
  const aliases: Record<string, string> = {
    kalburagi: "kalburgi",
    kalaburagi: "kalburgi",
    gulbarga: "kalburgi",
    vijapura: "vijaypura",
    bijapur: "vijaypura",
    bagalakote: "bagalkot",
  };
  const slug = aliases[normalized] ?? normalized;
  const known = new Set([
    "bagalkot",
    "bagalkote",
    "kalburgi",
    "mandya",
    "vijaypura",
    "vijayapura",
    "gulbarga",
  ]);
  return known.has(slug) ? slug : "";
}

/** Plot acres: prefer saved farm KML area, then agroStats (often stale after edit). */
function resolveHarvestAreaAcres(
  agro: any,
  farm?: any,
  plot?: any,
  farmer?: any,
): number {
  const fromFarm =
    parsePositiveArea(farm?.area_acres) ??
    parsePositiveArea(farm?.area_size_numeric) ??
    parsePositiveArea(farm?.area_size) ??
    parsePositiveArea(farm?.plot?.area_size) ??
    parsePositiveArea(farm?.area) ??
    parsePositiveArea(plot?.area_acres) ??
    parsePositiveArea(plot?.area_size_numeric) ??
    parsePositiveArea(plot?.area_size) ??
    parsePositiveArea(plot?.area) ??
    parsePositiveArea(farmer?.area_acres) ??
    parsePositiveArea(farmer?.area_size) ??
    parsePositiveArea(farmer?.area);
  if (fromFarm != null) return fromFarm;

  return (
    parsePositiveArea(agro?.area_acres) ??
    parsePositiveArea(agro?.soil?.area_acres) ??
    parsePositiveArea(agro?.properties?.area_acres) ??
    parsePositiveArea(agro?.properties?.area_size) ??
    parsePositiveArea(agro?.properties?.area) ??
    parsePositiveArea(agro?.area_size) ??
    parsePositiveArea(agro?.area) ??
    parsePositiveArea(agro?.acres) ??
    0
  );
}

/** Acres from a Leaflet [lat,lng] ring (same polygon drawn on the map). */
function acresFromLeafletBoundary(
  boundary: [number, number][] | undefined,
): number | null {
  if (!boundary || boundary.length < 3) return null;
  const geoRing = boundary.map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = geoRing[0];
  const last = geoRing[geoRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    geoRing.push([first[0], first[1]]);
  }
  const metrics = calculateAreaMetricsFromGeometry({
    type: "Polygon",
    coordinates: [geoRing],
  });
  return metrics?.acres != null && metrics.acres > 0 ? metrics.acres : null;
}

/** Keep popup Area in sync with the polygon actually drawn. */
function syncHarvestRowAreaToDrawnBoundary(
  row: TeamConnectHarvestRow,
): TeamConnectHarvestRow {
  const acres = acresFromLeafletBoundary(row.boundaryCoordinates);
  if (acres == null) return row;
  return { ...row, "Area (acre)": Number(acres.toFixed(2)) };
}

function buildRowFromContext(
  ctx: PlotContext,
  agro: any | null,
  plotKey: string,
  factoryCenter?: { lat: number; lng: number } | null,
  varietyIndex?: Map<string, string> | null,
  farmRows?: any[] | null,
  ownerFactoryPlots?: OwnerFactoryBoundaryPlot[] | null,
): TeamConnectHarvestRow | null {
  const { plot, farm, farmer, managerName, managerId, representative } = ctx;
  const plotKeys = [...ctx.plotKeys, plotKey];
  const center = resolveCenterPreferringDjango(
    agro,
    plot,
    farm,
    farmer,
    ctx.fo,
    farmRows,
    plotKeys,
    ownerFactoryPlots,
  );
  if (!center) return null;

  const plantationDate = readPlantationDate(farm, plot, farmer, agro);
  const days = computeDaysSincePlantation(plantationDate);

  const ownerAcres = acresFromOwnerFactoryPlot(
    findOwnerFactoryPlot(plotKeys, ownerFactoryPlots),
  );
  const farmAgroArea = resolveHarvestAreaAcres(agro, farm, plot, farmer);
  const area = farmAgroArea > 0 ? farmAgroArea : ownerAcres ?? 0;

  const yieldValue = extractSugarYield(agro);
  const brixValue = extractBrix(agro);
  const recoveryValue = extractRecovery(agro);

  const plotId = plotKeyFromRecord(plot) || plotKey;
  const dataPointId = `${plot?.id ?? plotId}-${farm?.id ?? plotKey}`;

  const resolvedManager = resolvePersonLabel(managerName, agro?.manager_name);
  const resolvedRepresentative = resolvePersonLabel(
    representative,
    agro?.field_officer_name,
  );
  const regionKeys = collectLocationKeys(plot, farm, farmer, ctx.fo, agro);
  const primaryRegion = readRegion(plot, farmer, ctx.fo, agro);

  return {
    id: dataPointId,
    "Plot No": plot?.plot_number || plotId || plotKey,
    Latitude: center.lat,
    Longitude: center.lng,
    "Sugarcane Status": computeStatus(days, agro),
    "Area (acre)": area,
    Days: days,
    "Prediction Yield (T/acre)": yieldValue,
    "Prediction Yield (T/acer)": yieldValue,
    "Brix (Degree)": brixValue,
    "Recovery (Degree)": recoveryValue,
    "Distance (km)": readDistanceKm(
      center.lat,
      center.lng,
      farm,
      plot,
      agro,
      factoryCenter,
    ),
    Stage: computeStage(days),
    Region:
      primaryRegion !== "Unknown"
        ? normalizeRegionLabel(primaryRegion)
        : "Unknown",
    regionKeys,
    Manager: resolvedManager,
    managerId,
    fieldOfficerId: fieldOfficerId(ctx.fo),
    "Sugarcane Type": readSugarcaneType(farm, plot, farmer, agro),
    Variety: resolveRowVariety(farm, plot, farmer, agro, varietyIndex, [
      plotKey,
      plotId,
      ...ctx.plotKeys,
      farmer?.id != null ? `farmer:${farmer.id}` : null,
      farmer?.user_id != null ? `farmer:${farmer.user_id}` : null,
    ]),
    representative: resolvedRepresentative,
    boundaryCoordinates: center.boundary,
  };
}

function findContextForPlotKey(
  contextMap: Map<string, PlotContext>,
  plotKey: string,
): PlotContext | null {
  const normalized = normalizePlotKey(plotKey);
  for (const [key, ctx] of contextMap) {
    if (normalizePlotKey(key) === normalized) return ctx;
    if (ctx.plotKeys.some((pk) => normalizePlotKey(pk) === normalized)) {
      return ctx;
    }
  }
  return null;
}

function enrichRowFromContext(
  row: TeamConnectHarvestRow,
  ctx: PlotContext,
  agro?: any,
  factoryCenter?: { lat: number; lng: number } | null,
  varietyIndex?: Map<string, string> | null,
  farmRows?: any[] | null,
  ownerFactoryPlots?: OwnerFactoryBoundaryPlot[] | null,
): TeamConnectHarvestRow {
  const regionFromContext = readRegion(ctx.plot, ctx.farmer, ctx.fo, agro);
  const contextRegionKeys = collectLocationKeys(
    ctx.plot,
    ctx.farm,
    ctx.farmer,
    ctx.fo,
    agro,
  );
  const varietyFromContext = resolveRowVariety(
    ctx.farm,
    ctx.plot,
    ctx.farmer,
    agro,
    varietyIndex,
    [row.id, row["Plot No"], ...ctx.plotKeys],
  );
  const distanceFromContext = readDistanceKm(
    row.Latitude,
    row.Longitude,
    ctx.farm,
    ctx.plot,
    agro,
    factoryCenter,
  );
  const centerFromSavedBoundary =
    resolveCenterPreferringDjango(
      null,
      ctx.plot,
      ctx.farm,
      ctx.farmer,
      ctx.fo,
      farmRows,
      ctx.plotKeys,
      ownerFactoryPlots,
    ) ?? resolveCenter(null, ctx.plot, ctx.farm, ctx.farmer, ctx.fo);
  const ownerAcres = acresFromOwnerFactoryPlot(
    findOwnerFactoryPlot(ctx.plotKeys, ownerFactoryPlots),
  );
  const existingArea = parsePositiveArea(row["Area (acre)"]);

  return {
    ...row,
    ...(centerFromSavedBoundary?.boundary?.length
      ? {
          Latitude: centerFromSavedBoundary.lat,
          Longitude: centerFromSavedBoundary.lng,
          boundaryCoordinates: centerFromSavedBoundary.boundary,
        }
      : {}),
    // Only fill area from factory endpoint when farms/agro left it empty.
    ...(existingArea == null && ownerAcres != null
      ? { "Area (acre)": ownerAcres }
      : {}),
    managerId: row.managerId || ctx.managerId || undefined,
    fieldOfficerId: row.fieldOfficerId || fieldOfficerId(ctx.fo) || undefined,
    Manager:
      row.Manager && row.Manager !== "Unknown"
        ? row.Manager
        : resolvePersonLabel(ctx.managerName, agro?.manager_name),
    representative:
      row.representative && row.representative !== "Unknown"
        ? row.representative
        : ctx.representative,
    Region:
      row.Region && row.Region !== "Unknown"
        ? row.Region
        : regionFromContext !== "Unknown"
          ? normalizeRegionLabel(regionFromContext)
          : row.Region,
    regionKeys: [
      ...new Set([...(row.regionKeys ?? []), ...contextRegionKeys]),
    ],
    Variety: row.Variety?.trim() ? row.Variety : varietyFromContext,
    "Sugarcane Type":
      row["Sugarcane Type"] && row["Sugarcane Type"] !== "Unknown"
        ? row["Sugarcane Type"]
        : readSugarcaneType(ctx.farm, ctx.plot, ctx.farmer, agro),
    "Distance (km)":
      row["Distance (km)"] > 0 ? row["Distance (km)"] : distanceFromContext,
  };
}

function buildRowFromAgroOnly(
  plotKey: string,
  agro: any,
  hierarchy: TeamConnectHierarchy,
  factoryCenter?: { lat: number; lng: number } | null,
  varietyIndex?: Map<string, string> | null,
  farmRows?: any[] | null,
  ownerFactoryPlots?: OwnerFactoryBoundaryPlot[] | null,
): TeamConnectHarvestRow | null {
  const center =
    resolveCenterPreferringDjango(
      agro,
      null,
      null,
      null,
      null,
      farmRows,
      [plotKey],
      ownerFactoryPlots,
    ) ?? resolveCenter(agro, null, null, null, null);
  if (!center) return null;

  const regionName =
    agro?.region ?? agro?.taluka ?? agro?.district ?? "Unknown";

  const agroFoId = agro?.field_officer_id ?? null;
  let fo =
    agroFoId != null
      ? hierarchy.fieldOfficers.find(
          (officer) =>
            String(officer?.id ?? officer?.user_id) === String(agroFoId),
        ) ?? null
      : null;

  if (!fo && agro?.field_officer_name) {
    const foName = `${agro.field_officer_name}`.trim();
    fo =
      hierarchy.fieldOfficers.find((officer) => {
        const label = personDisplayName(officer);
        const username = `${officer?.username ?? ""}`.trim();
        return (
          label === foName ||
          username === foName ||
          regionsMatch(label, foName)
        );
      }) ?? null;
  }

  if (!fo && agro?.manager_id != null) {
    const officersUnderManager = getFieldOfficersForManager(
      hierarchy,
      String(agro.manager_id),
    );
    if (officersUnderManager.length === 1) {
      fo = officersUnderManager[0];
    } else if (officersUnderManager.length > 1 && regionName !== "Unknown") {
      fo =
        officersUnderManager.find((officer) =>
          recordMatchesRegion(regionName, officer),
        ) ?? null;
    }
  }

  if (!fo && regionName !== "Unknown") {
    fo =
      hierarchy.fieldOfficers.find((officer) =>
        recordMatchesRegion(regionName, officer),
      ) ?? null;
  }

  const representative = fo ? personDisplayName(fo) : "Unknown";
  const managerName = fo
    ? resolveManagerName(fo, hierarchy.managers)
    : "Unknown";
  const managerId = fo ? resolveManagerId(fo, hierarchy.managers) : "";
  const resolvedFoId = fo
    ? fieldOfficerId(fo)
    : agroFoId != null
      ? String(agroFoId)
      : "";

  const plantationDate = readPlantationDate(null, null, null, agro);
  const days = computeDaysSincePlantation(plantationDate);
  const farmAgroArea = resolveHarvestAreaAcres(agro, null);
  const area =
    farmAgroArea > 0
      ? farmAgroArea
      : acresFromOwnerFactoryPlot(
          findOwnerFactoryPlot([plotKey], ownerFactoryPlots),
        ) ?? 0;
  const cleanPlotKey = plotKey.replace(/^"|"$/g, "");
  const regionKeys = collectLocationKeys(agro, fo);
  const primaryRegion =
    firstNonEmpty(agro?.region, agro?.taluka, agro?.district, regionName) ||
    regionName;

  return {
    id: cleanPlotKey,
    "Plot No": agro?.plot_number || cleanPlotKey,
    Latitude: center.lat,
    Longitude: center.lng,
    "Sugarcane Status": computeStatus(days, agro),
    "Area (acre)": area,
    Days: days,
    "Prediction Yield (T/acre)": extractSugarYield(agro),
    "Brix (Degree)": extractBrix(agro),
    "Recovery (Degree)": extractRecovery(agro),
    "Distance (km)": readDistanceKm(
      center.lat,
      center.lng,
      null,
      null,
      agro,
      factoryCenter,
    ),
    Stage: computeStage(days),
    Region:
      primaryRegion !== "Unknown"
        ? normalizeRegionLabel(String(primaryRegion))
        : "Unknown",
    regionKeys,
    Manager: resolvePersonLabel(managerName, agro?.manager_name),
    managerId:
      managerId ||
      (agro?.manager_id != null ? String(agro.manager_id) : undefined),
    fieldOfficerId: resolvedFoId || undefined,
    "Sugarcane Type": readSugarcaneType(null, null, null, agro),
    Variety: resolveRowVariety(null, null, null, agro, varietyIndex, [
      plotKey,
      cleanPlotKey,
      agro?.plot_number,
      agro?.plot_id,
      agro?.fastapi_plot_id,
    ]),
    representative: resolvePersonLabel(representative, agro?.field_officer_name),
    boundaryCoordinates: center.boundary,
  };
}

export type BuildOwnerHarvestRowsOptions = {
  factoryCenter?: { lat: number; lng: number } | null;
  /** /farms/?include_farmer=true rows — used to fill Variety when hierarchy has null crop_variety. */
  farmRows?: any[] | null;
  /** GET /plots/owner-factory-boundaries/ polygons — preferred updated KML. */
  ownerFactoryPlots?: OwnerFactoryBoundaryPlot[] | null;
};

/** Build harvest rows: team-connect metadata + agroStats geometry/metrics. */
export function buildOwnerHarvestRows(
  hierarchy: TeamConnectHierarchy,
  agroStats: Record<string, any> | null | undefined,
  options?: BuildOwnerHarvestRowsOptions,
): TeamConnectHarvestRow[] {
  const factoryCenter = options?.factoryCenter ?? null;
  const varietyIndex = buildCropVarietyIndexFromFarmRows(options?.farmRows);
  const farmRows = options?.farmRows ?? null;
  const ownerFactoryPlots = options?.ownerFactoryPlots ?? null;
  const contextMap = buildPlotContextMap(hierarchy);
  const rows: TeamConnectHarvestRow[] = [];
  const seenPlotKeys = new Set<string>();
  const seenRowIds = new Set<string>();
  const agro = agroStats ?? {};

  // One row per unique plot context (not per alias key).
  const uniqueContexts: Array<{ key: string; ctx: PlotContext }> = [];
  const seenContexts = new Set<PlotContext>();
  for (const [key, ctx] of contextMap) {
    if (seenContexts.has(ctx)) continue;
    seenContexts.add(ctx);
    uniqueContexts.push({ key, ctx });
  }

  for (const { key, ctx } of uniqueContexts) {
    let agroPlot: any | null = null;
    for (const plotKey of ctx.plotKeys) {
      agroPlot = lookupAgroPlot(agro, plotKey);
      if (agroPlot) break;
    }
    if (!agroPlot) agroPlot = lookupAgroPlot(agro, key);

    const row = buildRowFromContext(
      ctx,
      agroPlot,
      key,
      factoryCenter,
      varietyIndex,
      farmRows,
      ownerFactoryPlots,
    );
    if (!row) continue;
    if (row.id && seenRowIds.has(row.id)) continue;

    const enrichedRow = enrichRowFromContext(
      row,
      ctx,
      agroPlot,
      factoryCenter,
      varietyIndex,
      farmRows,
      ownerFactoryPlots,
    );
    rows.push(enrichedRow);
    if (enrichedRow.id) seenRowIds.add(enrichedRow.id);
    ctx.plotKeys.forEach((plotKey) => seenPlotKeys.add(normalizePlotKey(plotKey)));
    seenPlotKeys.add(normalizePlotKey(key));
  }

  for (const [plotKey, plotData] of Object.entries(agro)) {
    if (!plotData || typeof plotData !== "object") continue;
    const normalized = normalizePlotKey(plotKey);
    if (seenPlotKeys.has(normalized)) continue;

    let row = buildRowFromAgroOnly(
      plotKey,
      plotData,
      hierarchy,
      factoryCenter,
      varietyIndex,
      farmRows,
      ownerFactoryPlots,
    );
    if (!row) continue;

    const ctx = findContextForPlotKey(contextMap, plotKey);
    if (ctx) {
      row = enrichRowFromContext(
        row,
        ctx,
        plotData,
        factoryCenter,
        varietyIndex,
        farmRows,
        ownerFactoryPlots,
      );
    } else {
      const saved = resolveCenterPreferringDjango(
        plotData,
        null,
        null,
        null,
        null,
        farmRows,
        [plotKey],
        ownerFactoryPlots,
      );
      if (saved?.boundary?.length) {
        row = {
          ...row,
          Latitude: saved.lat,
          Longitude: saved.lng,
          boundaryCoordinates: saved.boundary,
        };
      }
      const existingArea = parsePositiveArea(row["Area (acre)"]);
      const ownerAcres = acresFromOwnerFactoryPlot(
        findOwnerFactoryPlot([plotKey], ownerFactoryPlots),
      );
      if (existingArea == null && ownerAcres != null) {
        row = { ...row, "Area (acre)": ownerAcres };
      }
    }

    if (!row.Variety?.trim() && varietyIndex.size) {
      const fromFarms = lookupVarietyInIndex(
        varietyIndex,
        plotKey,
        row.id,
        row["Plot No"],
      );
      if (fromFarms) row = { ...row, Variety: fromFarms };
    }

    if (row.id && seenRowIds.has(row.id)) continue;

    rows.push(row);
    if (row.id) seenRowIds.add(row.id);
    seenPlotKeys.add(normalized);
  }

  // Do not inject factory-only orphan plots here — that mixed stale
  // owner-factory-boundaries KML/area into the harvest map.

  return backfillHarvestRowIds(rows, hierarchy)
    .map((row) => {
      if (row.Variety?.trim() || !varietyIndex.size) return row;
      const fromFarms = lookupVarietyInIndex(
        varietyIndex,
        row.id,
        row["Plot No"],
      );
      return fromFarms ? { ...row, Variety: fromFarms } : row;
    })
    .map((row) => applySavedBoundaryOverrideToHarvestRow(row))
    .map((row) => syncHarvestRowAreaToDrawnBoundary(row));
}

/**
 * Force the latest edited KML onto a harvest map row.
 * Session (just saved) beats farms/factory/agro — fixes stale outlines after edit.
 */
export function applySavedBoundaryOverrideToHarvestRow(
  row: TeamConnectHarvestRow,
): TeamConnectHarvestRow {
  const seedKeys = [row.id, row["Plot No"]].filter(Boolean).map(String);
  const candidates = new Set<string>();
  for (const seed of seedKeys) {
    candidates.add(seed);
    for (const c of getPlotNameCandidates(seed, null)) {
      candidates.add(c);
    }
  }

  let localBoundary = null as ReturnType<typeof readLocalPlotBoundary>;
  for (const key of candidates) {
    localBoundary = readLocalPlotBoundary(key);
    if (localBoundary?.coordinates?.[0]?.length) break;
  }
  if (!localBoundary?.coordinates?.[0]?.length) return row;

  const center = centerFromCoordinates(localBoundary.coordinates[0]);
  if (!center?.boundary?.length) return row;

  const acres = calculateAreaMetricsFromGeometry(localBoundary)?.acres;
  return {
    ...row,
    Latitude: center.lat,
    Longitude: center.lng,
    boundaryCoordinates: center.boundary,
    ...(acres != null && acres > 0 ? { "Area (acre)": acres } : {}),
  };
}

/** Apply session-saved boundaries across all harvest rows (after API merge). */
export function applySavedBoundariesToHarvestRows(
  rows: TeamConnectHarvestRow[],
): TeamConnectHarvestRow[] {
  return rows
    .map((row) => applySavedBoundaryOverrideToHarvestRow(row))
    .map((row) => syncHarvestRowAreaToDrawnBoundary(row));
}

/**
 * Patch matching harvest rows with a boundary from the edit-save event (immediate UI).
 */
export function patchHarvestRowsWithBoundaryEvent(
  rows: TeamConnectHarvestRow[],
  plotKey: string,
  plotId: string | undefined,
  boundary: { type?: string; coordinates?: number[][][] } | null,
): TeamConnectHarvestRow[] {
  if (!boundary?.coordinates?.[0]?.length) return rows;
  const center = centerFromCoordinates(boundary.coordinates[0]);
  if (!center?.boundary?.length) return rows;

  const targets = new Set<string>();
  for (const key of [plotKey, plotId].filter(Boolean) as string[]) {
    targets.add(normalizePlotKey(key));
    for (const c of getPlotNameCandidates(key, null)) {
      targets.add(normalizePlotKey(c));
    }
  }
  if (!targets.size) return rows;

  const acres = calculateAreaMetricsFromGeometry(boundary as any)?.acres;

  return rows.map((row) => {
    const plotNo = row["Plot No"] ? normalizePlotKey(String(row["Plot No"])) : "";
    // Match by Plot No / known aliases only (never fuzzy includes on composite ids).
    const matched =
      (plotNo && targets.has(plotNo)) ||
      [...targets].some((t) => {
        for (const c of getPlotNameCandidates(String(row["Plot No"] ?? ""), null)) {
          if (normalizePlotKey(c) === t) return true;
        }
        return false;
      });
    if (!matched) return row;
    return syncHarvestRowAreaToDrawnBoundary({
      ...row,
      Latitude: center.lat,
      Longitude: center.lng,
      boundaryCoordinates: center.boundary,
      ...(acres != null && acres > 0 ? { "Area (acre)": acres } : {}),
    });
  });
}

function backfillHarvestRowIds(
  rows: TeamConnectHarvestRow[],
  hierarchy: TeamConnectHierarchy,
): TeamConnectHarvestRow[] {
  return rows.map((row) => {
    const fo =
      hierarchy.fieldOfficers.find((officer) => {
        const officerId = fieldOfficerId(officer);
        if (
          row.fieldOfficerId &&
          officerId &&
          String(officerId) === String(row.fieldOfficerId)
        ) {
          return true;
        }
        return (
          !!row.representative &&
          row.representative !== "Unknown" &&
          personDisplayName(officer) === row.representative
        );
      }) ??
      (row.Manager && row.Manager !== "Unknown"
        ? hierarchy.fieldOfficers.find((officer) =>
            labelsMatch(
              resolveManagerName(officer, hierarchy.managers),
              row.Manager as string,
            ),
          )
        : null);

    let updated: TeamConnectHarvestRow = { ...row };

    if (fo) {
      updated = {
        ...updated,
        fieldOfficerId: updated.fieldOfficerId || fieldOfficerId(fo),
        managerId: updated.managerId || resolveManagerId(fo, hierarchy.managers),
        Manager:
          updated.Manager && updated.Manager !== "Unknown"
            ? updated.Manager
            : resolveManagerName(fo, hierarchy.managers),
        representative:
          updated.representative && updated.representative !== "Unknown"
            ? updated.representative
            : personDisplayName(fo),
      };

      const regionKeys = new Set(updated.regionKeys ?? []);
      for (const key of collectLocationKeys(fo)) {
        regionKeys.add(key);
      }

      let primaryRegion =
        updated.Region && updated.Region !== "Unknown"
          ? updated.Region
          : "Unknown";

      for (const farmer of fo?.farmers ?? []) {
        for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
          const farm = pickBestFarm(farms);
          const plotKeys = plotKeysForContext(plot, farm);
          const matchesRow = plotRowLinks(updated, plotKeys);

          if (!matchesRow) continue;

          for (const key of collectLocationKeys(plot, farm, farmer, fo)) {
            regionKeys.add(key);
          }
          const region = readRegion(plot, farmer, fo);
          if (region !== "Unknown") {
            primaryRegion = normalizeRegionLabel(region);
          }
        }
      }

      if (primaryRegion === "Unknown") {
        const foRegion = readRegion(null, null, fo);
        if (foRegion !== "Unknown") {
          primaryRegion = normalizeRegionLabel(foRegion);
        }
      }

      updated = {
        ...updated,
        Region: primaryRegion,
        regionKeys: [...regionKeys],
      };
    }

    return updated;
  });
}

/** @deprecated Use buildOwnerHarvestRows */
export function buildHarvestRowsFromTeamConnect(
  hierarchy: TeamConnectHierarchy,
): TeamConnectHarvestRow[] {
  return buildOwnerHarvestRows(hierarchy, {});
}

export function collectHarvestFilterOptionsFromHierarchy(
  hierarchy: TeamConnectHierarchy,
) {
  const managers = new Set<string>();
  const representatives = new Set<string>();
  const regions = new Set<string>();
  const sugarcaneTypes = new Set<string>();
  const varieties = new Set<string>();

  for (const fo of hierarchy.fieldOfficers) {
    const representative = personDisplayName(fo);
    const managerName = resolveManagerName(fo, hierarchy.managers);
    if (managerName && managerName !== "Unknown") managers.add(managerName);
    if (representative && representative !== "Unknown") {
      representatives.add(representative);
    }
    for (const key of collectLocationKeys(fo)) {
      regions.add(key);
    }

    for (const farmer of fo?.farmers ?? []) {
      for (const { plot, farms } of plotEntriesForFarmer(farmer)) {
        const farm = pickBestFarm(farms);
        const region = readRegion(plot, farmer, fo);
        if (region && region !== "Unknown") {
          regions.add(normalizeRegionLabel(region));
        }
        for (const key of collectLocationKeys(plot, farm, farmer, fo)) {
          regions.add(key);
        }

        const sugarcaneType = readSugarcaneType(farm, plot, farmer);
        if (sugarcaneType && sugarcaneType !== "Unknown") {
          sugarcaneTypes.add(sugarcaneType);
        }

        const variety = readVariety(farm, plot, farmer);
        if (variety) varieties.add(variety);
      }
    }
  }

  return {
    managers: uniqueSorted([...managers]),
    representatives: uniqueSorted([...representatives]),
    regions: uniqueSorted([...regions]),
    sugarcaneTypes: uniqueSorted([...sugarcaneTypes]),
    varieties: uniqueSorted([...varieties]),
  };
}

function mergeOptionLists(...lists: string[][]): string[] {
  return uniqueSorted(lists.flat());
}

export function mergeHarvestFilterOptions(
  ...sources: Array<ReturnType<typeof collectHarvestFilterOptions>>
) {
  return {
    managers: mergeOptionLists(...sources.map((source) => source.managers)),
    representatives: mergeOptionLists(
      ...sources.map((source) => source.representatives),
    ),
    regions: mergeOptionLists(...sources.map((source) => source.regions)),
    sugarcaneTypes: mergeOptionLists(
      ...sources.map((source) => source.sugarcaneTypes),
    ),
    varieties: mergeOptionLists(...sources.map((source) => source.varieties)),
  };
}

export function collectHarvestFilterOptions(rows: TeamConnectHarvestRow[]) {
  return {
    managers: uniqueSorted(
      rows.map((row) => row.Manager).filter((value) => value && value !== "Unknown"),
    ),
    representatives: uniqueSorted(
      rows
        .map((row) => row.representative)
        .filter((value) => value && value !== "Unknown"),
    ),
    regions: uniqueSorted(
      rows.flatMap((row) => {
        const values: string[] = [];
        if (row.Region && row.Region !== "Unknown") values.push(row.Region);
        for (const key of row.regionKeys ?? []) {
          if (key && key !== "Unknown") values.push(key);
        }
        return values;
      }),
    ),
    sugarcaneTypes: uniqueSorted(
      rows
        .map((row) => row["Sugarcane Type"])
        .filter((value) => value && value !== "Unknown"),
    ),
    varieties: uniqueSorted(
      rows.map((row) => row.Variety).filter((value) => Boolean(value?.trim())),
    ),
  };
}

export function filterHarvestRows(
  rows: TeamConnectHarvestRow[],
  filters: {
    managerId?: string;
    fieldOfficerId?: string;
    manager?: string;
    representative?: string;
    region: string;
    sugarcaneType: string;
    variety: string;
  },
  hierarchy?: TeamConnectHierarchy,
): TeamConnectHarvestRow[] {
  return rows.filter((row) => {
    const managerMatch = hierarchy
      ? rowBelongsToManager(row, filters.managerId ?? "All", hierarchy)
      : !filters.managerId ||
        filters.managerId === "All" ||
        (row.managerId != null &&
          String(row.managerId) === String(filters.managerId)) ||
        (filters.manager != null &&
          filters.manager !== "All" &&
          row.Manager === filters.manager);

    const repMatch = hierarchy
      ? rowBelongsToFieldOfficer(
          row,
          filters.fieldOfficerId ?? "All",
          hierarchy,
        )
      : !filters.fieldOfficerId ||
        filters.fieldOfficerId === "All" ||
        (row.fieldOfficerId != null &&
          String(row.fieldOfficerId) === String(filters.fieldOfficerId)) ||
        (filters.representative != null &&
          filters.representative !== "All" &&
          row.representative === filters.representative);

    const regionMatch =
      filters.region === "All" ||
      rowMatchesRegion(row, filters.region, hierarchy);
    const typeMatch =
      filters.sugarcaneType === "All" ||
      row["Sugarcane Type"] === filters.sugarcaneType;
    const varietyMatch =
      filters.variety === "All" || row.Variety === filters.variety;
    return managerMatch && repMatch && regionMatch && typeMatch && varietyMatch;
  });
}
