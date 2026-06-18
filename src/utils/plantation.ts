export const formatPlantationDate = (raw: unknown): string => {
  if (raw == null || raw === '') return 'N/A';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/** Collect farm rows from a farmer user, plot, or /farms/ list item. */
export const collectFarmsFromRecord = (record: any): any[] => {
  const farms: any[] = [];
  if (!record) return farms;

  const isFarmRow =
    record.plantation_date != null ||
    record.area_size != null ||
    record.farm_uid != null ||
    record.crop_type != null;

  if (isFarmRow) {
    farms.push(record);
  }

  if (Array.isArray(record.farms)) {
    farms.push(...record.farms);
  }

  if (Array.isArray(record.plots)) {
    for (const plot of record.plots) {
      if (Array.isArray(plot?.farms)) {
        farms.push(...plot.farms);
      }
    }
  }

  return farms;
};

export const getPlantationFromFarm = (farm: any) => {
  if (!farm) {
    return { plantation_date: 'N/A', plantation_type: 'N/A' };
  }

  const cropType = farm.crop_type;
  const plantationDateRaw =
    farm.plantation_date ??
    farm.planting_date ??
    cropType?.plantation_date;

  const plantationTypeRaw =
    cropType?.plantation_type_display ??
    cropType?.plantation_type ??
    farm.plantation_type_display ??
    farm.plantation_type ??
    farm.planting_method ??
    cropType?.planting_method_display;

  return {
    plantation_date: formatPlantationDate(plantationDateRaw),
    plantation_type: plantationTypeRaw ? String(plantationTypeRaw) : 'N/A',
  };
};

export const getPlantationFromRecord = (record: any) => {
  const farms = collectFarmsFromRecord(record);

  for (const farm of farms) {
    const info = getPlantationFromFarm(farm);
    if (info.plantation_date !== 'N/A' || info.plantation_type !== 'N/A') {
      return info;
    }
  }

  return farms.length > 0
    ? getPlantationFromFarm(farms[0])
    : { plantation_date: 'N/A', plantation_type: 'N/A' };
};

/** All user/farmer IDs that may refer to the same person across APIs. */
export const collectFarmerIdentityIds = (farmer: any, row?: any): number[] => {
  const raw = [
    farmer?.id,
    farmer?.user_id,
    farmer?.user?.id,
    row?.farmer_id,
    row?.user_id,
    row?.farmer?.user_id,
    row?.farmer?.user?.id,
  ];
  const unique = new Set<number>();
  for (const value of raw) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) unique.add(numeric);
  }
  return [...unique];
};

export const extractUserRoleName = (user: any): string => {
  const candidates = [
    user?.role,
    user?.role_name,
    user?.role_display,
    user?.user_role,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'object') {
      const name = candidate.name ?? candidate.display_name;
      if (name) return String(name).trim();
    }
  }
  return '';
};

export const isFarmerUser = (user: any): boolean => {
  const roleId = user?.role_id ?? user?.role?.id;
  if (roleId === 1 || roleId === '1') return true;
  return extractUserRoleName(user).toLowerCase().includes('farmer');
};

export const isPlaceholderEmail = (email: unknown): boolean => {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value || value === 'n/a') return true;
  if (/^\d{8,}@/.test(value)) return true;
  if (/@.*\.local$/.test(value)) return true;
  return false;
};

export const getFarmerUserIdFromFarmRow = (farmRow: any): number | null => {
  const ids = collectFarmerIdentityIds(
    farmRow?.farmer ?? farmRow?.farm_owner ?? farmRow?.user,
    farmRow,
  );
  return ids[0] ?? null;
};

export const pickDisplayEmail = (
  user: any,
  enrichment?: { email?: string } | null,
): string => {
  const raw = String(user?.email ?? '').trim();
  const enriched = String(enrichment?.email ?? '').trim();

  if (enriched && !isPlaceholderEmail(enriched)) {
    if (!raw || isPlaceholderEmail(raw)) return enriched;
    return raw;
  }
  if (raw && !isPlaceholderEmail(raw)) return raw;
  return '';
};

const isShortAddress = (value: string): boolean =>
  !value || (!value.includes(',') && value.length < 48);

export const buildFarmerPlantationMapFromFarmRows = (
  farmRows: any[],
): Map<number, { plantation_date: string; plantation_type: string }> => {
  const map = new Map<number, { plantation_date: string; plantation_type: string }>();

  for (const row of farmRows) {
    const farmerId = getFarmerUserIdFromFarmRow(row);
    if (farmerId == null) continue;

    const next = getPlantationFromRecord(row);
    const existing = map.get(farmerId);

    if (!existing) {
      map.set(farmerId, next);
      continue;
    }

    map.set(farmerId, {
      plantation_date:
        existing.plantation_date !== 'N/A' ? existing.plantation_date : next.plantation_date,
      plantation_type:
        existing.plantation_type !== 'N/A' ? existing.plantation_type : next.plantation_type,
    });
  }

  return map;
};

const appendAddressParts = (target: string[], source: any) => {
  if (!source) return;

  if (source.full_address) {
    target.push(String(source.full_address).trim());
  }

  const addressField = source.address;
  if (typeof addressField === 'string' && addressField.trim()) {
    target.push(addressField.trim());
  } else if (addressField && typeof addressField === 'object') {
    if (addressField.full_address) {
      target.push(String(addressField.full_address).trim());
    }
    for (const key of [
      'address',
      'line1',
      'line2',
      'village',
      'taluka',
      'district',
      'state',
      'pin_code',
    ]) {
      if (addressField[key]) {
        target.push(String(addressField[key]).trim());
      }
    }
  }

  for (const key of ['village', 'taluka', 'district', 'state', 'pin_code']) {
    if (source[key]) {
      target.push(String(source[key]).trim());
    }
  }

  if (Array.isArray(source.plots)) {
    for (const plot of source.plots) {
      appendAddressParts(target, plot);
      if (plot?.address) appendAddressParts(target, plot.address);
    }
  }
};

export const formatRecordAddress = (record: any, farm?: any): string => {
  const parts: string[] = [];
  appendAddressParts(parts, record);
  if (farm && farm !== record) {
    appendAddressParts(parts, farm);
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }

  return unique.join(', ');
};

/** Prefer full address from team-connect / farm data over short village-only text from /users/. */
export const pickDisplayAddress = (
  user: any,
  enrichment?: { address?: string } | null,
): string => {
  const enriched = enrichment?.address?.trim() || '';
  const composite = formatRecordAddress(user).trim();
  const raw =
    typeof user?.address === 'string' ? user.address.trim() : '';

  if (enriched) {
    if (!raw && !composite) return enriched;
    if (isShortAddress(raw) && !isShortAddress(enriched)) return enriched;
    if (isShortAddress(composite) && !isShortAddress(enriched)) return enriched;
    if (enriched.length > raw.length && enriched.length > composite.length) {
      return enriched;
    }
    if (
      raw &&
      raw.split(',').length === 1 &&
      enriched.toLowerCase().includes(raw.toLowerCase())
    ) {
      return enriched;
    }
  }

  if (composite) return composite;
  return raw;
};

export const formatFarmerDisplayName = (record: any): string => {
  const fullName = [record?.first_name, record?.last_name]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ');

  if (fullName) return fullName;

  const username = record?.username ? String(record.username).trim() : '';
  if (username && !/^\d{8,}$/.test(username)) return username;

  return record?.phone_number ? String(record.phone_number) : username || 'N/A';
};

export const extractFarmersFromTeamConnect = (data: any): any[] => {
  const farmers: any[] = [];
  const seen = new Set<number | string>();

  const pushFarmer = (farmer: any) => {
    if (!farmer) return;
    const key = farmer?.id ?? farmer?.user_id ?? farmer?.username;
    if (key != null) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    farmers.push(farmer);
  };

  const pushAll = (list: any[]) => {
    for (const item of list || []) {
      pushFarmer(item);
    }
  };

  pushAll(data?.users_by_role?.farmers);
  pushAll(data?.farmers);

  const fieldOfficers =
    data?.users_by_role?.field_officers ??
    data?.field_officers ??
    data?.fieldOfficers ??
    [];

  for (const officer of fieldOfficers) {
    pushAll(officer?.farmers);
  }

  return farmers;
};

export const extractFieldOfficersFromTeamConnect = (data: any): any[] => {
  const officers: any[] = [];
  const seen = new Set<number | string>();

  const pushOfficer = (officer: any) => {
    if (!officer?.id) return;
    if (seen.has(officer.id)) return;
    seen.add(officer.id);
    officers.push(officer);
  };

  const lists = [
    data?.users_by_role?.field_officers,
    data?.field_officers,
    data?.fieldOfficers,
  ];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const officer of list) pushOfficer(officer);
    }
  }

  return officers;
};

export type FarmerEnrichment = {
  email: string;
  address: string;
  plantation_date: string | null;
  plantation_type: string | null;
};

export type FarmerEnrichmentLookup = {
  byId: Map<number, FarmerEnrichment>;
  byPhone: Map<string, FarmerEnrichment>;
};

const normalizePhoneKey = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

export const getFarmerEnrichment = (
  user: any,
  lookup: FarmerEnrichmentLookup,
): FarmerEnrichment | undefined => {
  const userId = user?.id;
  if (userId != null) {
    const numericId = Number(userId);
    const direct =
      lookup.byId.get(numericId) ??
      lookup.byId.get(userId as number);
    if (direct) return direct;

    for (const [id, enrichment] of lookup.byId) {
      if (String(id) === String(userId)) return enrichment;
    }
  }

  const phoneKey = normalizePhoneKey(
    user?.phone_number ?? user?.phone ?? user?.username,
  );
  if (phoneKey) {
    const byPhone = lookup.byPhone.get(phoneKey);
    if (byPhone) return byPhone;

    if (phoneKey.length >= 10) {
      const last10 = phoneKey.slice(-10);
      for (const [key, enrichment] of lookup.byPhone) {
        if (key.slice(-10) === last10) return enrichment;
      }
    }
  }

  return undefined;
};

export const buildEnrichmentFromUserRecord = (user: any): FarmerEnrichment => {
  const plantation = getPlantationFromRecord(user);
  return {
    email: String(user?.email ?? '').trim(),
    address: formatRecordAddress(user),
    plantation_date:
      plantation.plantation_date !== 'N/A' ? plantation.plantation_date : null,
    plantation_type:
      plantation.plantation_type !== 'N/A' ? plantation.plantation_type : null,
  };
};

const pickBetterEmail = (a: string, b: string): string => {
  const left = a.trim();
  const right = b.trim();
  const leftOk = left && !isPlaceholderEmail(left);
  const rightOk = right && !isPlaceholderEmail(right);
  if (leftOk && !rightOk) return left;
  if (rightOk && !leftOk) return right;
  if (leftOk && rightOk) return left;
  return left || right;
};

const pickBetterAddress = (a: string, b: string): string => {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (isShortAddress(left) && !isShortAddress(right)) return right;
  if (isShortAddress(right) && !isShortAddress(left)) return left;
  return left.length >= right.length ? left : right;
};

const mergeEnrichmentValues = (
  existing: FarmerEnrichment,
  next: FarmerEnrichment,
): FarmerEnrichment => ({
  email: pickBetterEmail(existing.email, next.email),
  address: pickBetterAddress(existing.address, next.address),
  plantation_date: existing.plantation_date || next.plantation_date,
  plantation_type: existing.plantation_type || next.plantation_type,
});

const registerEnrichmentInLookup = (
  lookup: FarmerEnrichmentLookup,
  enrichment: FarmerEnrichment,
  farmer: any,
  row?: any,
) => {
  for (const farmerId of collectFarmerIdentityIds(farmer, row)) {
    const existing = lookup.byId.get(farmerId);
    lookup.byId.set(
      farmerId,
      existing ? mergeEnrichmentValues(existing, enrichment) : enrichment,
    );
  }

  const phoneKey = normalizePhoneKey(
    farmer?.phone_number ??
      farmer?.phone ??
      farmer?.username ??
      row?.phone_number ??
      row?.farmer_phone ??
      row?.username,
  );
  if (phoneKey) {
    const existingPhone = lookup.byPhone.get(phoneKey);
    lookup.byPhone.set(
      phoneKey,
      existingPhone ? mergeEnrichmentValues(existingPhone, enrichment) : enrichment,
    );
  }
};

export const buildFarmerEnrichmentLookupFromFarmerProfiles = (
  farmers: any[],
): FarmerEnrichmentLookup => {
  const byId = new Map<number, FarmerEnrichment>();
  const byPhone = new Map<string, FarmerEnrichment>();

  for (const farmer of farmers) {
    if (!farmer) continue;
    const enrichment = buildEnrichmentFromUserRecord(farmer);
    registerEnrichmentInLookup({ byId, byPhone }, enrichment, farmer);
  }

  return { byId, byPhone };
};

export const buildFarmerEnrichmentLookup = (
  teamData: any,
): FarmerEnrichmentLookup => {
  const byId = new Map<number, FarmerEnrichment>();
  const byPhone = new Map<string, FarmerEnrichment>();

  for (const farmer of extractFarmersFromTeamConnect(teamData)) {
    if (!farmer) continue;

    const farms = collectFarmsFromRecord(farmer);
    const firstFarm = farms[0] ?? null;
    const plantation = getPlantationFromRecord(farmer);
    const enrichment: FarmerEnrichment = {
      email: farmer?.email ? String(farmer.email).trim() : '',
      address: formatRecordAddress(farmer, firstFarm),
      plantation_date:
        plantation.plantation_date !== 'N/A' ? plantation.plantation_date : null,
      plantation_type:
        plantation.plantation_type !== 'N/A' ? plantation.plantation_type : null,
    };

    registerEnrichmentInLookup({ byId, byPhone }, enrichment, farmer);
  }

  return { byId, byPhone };
};

export const mergeFarmerEnrichmentLookups = (
  ...lookups: FarmerEnrichmentLookup[]
): FarmerEnrichmentLookup => {
  const byId = new Map<number, FarmerEnrichment>();
  const byPhone = new Map<string, FarmerEnrichment>();

  const apply = (enrichment: FarmerEnrichment, farmerId?: number, phoneKey?: string) => {
    if (farmerId != null && !Number.isNaN(farmerId)) {
      const existing = byId.get(farmerId);
      byId.set(farmerId, existing ? mergeEnrichmentValues(existing, enrichment) : enrichment);
    }
    if (phoneKey) {
      const existing = byPhone.get(phoneKey);
      byPhone.set(phoneKey, existing ? mergeEnrichmentValues(existing, enrichment) : enrichment);
    }
  };

  for (const lookup of lookups) {
    for (const [id, enrichment] of lookup.byId) {
      apply(enrichment, id);
    }
    for (const [phone, enrichment] of lookup.byPhone) {
      apply(enrichment, undefined, phone);
    }
  }

  return { byId, byPhone };
};

/** Build enrichment from /farms/?include_farmer=true rows (works for manager login). */
export const buildFarmerEnrichmentLookupFromFarmRows = (
  farmRows: any[],
): FarmerEnrichmentLookup => {
  const byId = new Map<number, FarmerEnrichment>();
  const byPhone = new Map<string, FarmerEnrichment>();

  for (const row of farmRows) {
    const farmer = row?.farmer ?? row?.farm_owner ?? row?.user ?? row?.farm_owner?.user ?? {};
    const identityIds = collectFarmerIdentityIds(farmer, row);
    if (identityIds.length === 0) continue;

    const mergedFarmer = { ...farmer, ...row };
    const plantation = getPlantationFromFarm(row);
    const enrichment: FarmerEnrichment = {
      email: String(
        farmer?.email ?? row?.farmer_email ?? row?.email ?? '',
      ).trim(),
      address: formatRecordAddress(mergedFarmer, row),
      plantation_date:
        plantation.plantation_date !== 'N/A' ? plantation.plantation_date : null,
      plantation_type:
        plantation.plantation_type !== 'N/A' ? plantation.plantation_type : null,
    };

    registerEnrichmentInLookup({ byId, byPhone }, enrichment, mergedFarmer, row);
  }

  return { byId, byPhone };
};

/** @deprecated Use buildFarmerEnrichmentLookup */
export const buildFarmerEnrichmentMap = (
  teamData: any,
): Map<number, FarmerEnrichment> => buildFarmerEnrichmentLookup(teamData).byId;
