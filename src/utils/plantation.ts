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

export const getFarmerUserIdFromFarmRow = (farmRow: any): number | null => {
  const id =
    farmRow?.farmer?.id ??
    farmRow?.farmer_id ??
    farmRow?.farm_owner?.id ??
    farmRow?.user?.id ??
    farmRow?.user_id;

  if (id == null || id === '') return null;
  const numeric = Number(id);
  return Number.isNaN(numeric) ? null : numeric;
};

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

export type FarmerEnrichment = {
  email?: string;
  address?: string;
  plantation_date?: string;
  plantation_type?: string;
};

export type FarmerEnrichmentLookup = {
  byId: Map<number, FarmerEnrichment>;
  byPhone: Map<string, FarmerEnrichment>;
};

const normalizePhone = (phone?: string | null): string => {
  if (phone == null || phone === '') return '';
  return String(phone).replace(/\D/g, '').slice(-10);
};

const mergeEnrichmentValues = (
  existing: FarmerEnrichment,
  next: FarmerEnrichment,
): FarmerEnrichment => ({
  email: existing.email?.trim() || next.email?.trim() || undefined,
  address: existing.address?.trim() || next.address?.trim() || undefined,
  plantation_date:
    existing.plantation_date && existing.plantation_date !== 'N/A'
      ? existing.plantation_date
      : next.plantation_date,
  plantation_type:
    existing.plantation_type && existing.plantation_type !== 'N/A'
      ? existing.plantation_type
      : next.plantation_type,
});

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
};

export const formatRecordAddress = (record: any, farm?: any): string => {
  const parts: string[] = [];
  appendAddressParts(parts, record);
  appendAddressParts(parts, farm);
  appendAddressParts(parts, record?.farmer);
  appendAddressParts(parts, record?.farm_owner);
  appendAddressParts(parts, record?.user);
  appendAddressParts(parts, record?.address_info);
  appendAddressParts(parts, record?.personal_info);

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

export const extractUserRoleName = (user: any): string => {
  if (typeof user?.role === 'string') return user.role;
  if (user?.role?.name) return String(user.role.name);
  if (user?.role_name) return String(user.role_name);
  return '';
};

export const isFarmerUser = (user: any): boolean =>
  extractUserRoleName(user).toLowerCase().includes('farmer');

export const pickDisplayEmail = (
  user: any,
  enrichment?: FarmerEnrichment,
): string => {
  const email =
    enrichment?.email?.trim() ||
    user?.email?.trim() ||
    user?.farmer?.email?.trim() ||
    user?.user?.email?.trim() ||
    '';
  return email;
};

export const pickDisplayAddress = (
  user: any,
  enrichment?: FarmerEnrichment,
): string => {
  const enriched = enrichment?.address?.trim();
  if (enriched) return enriched;

  const fromRecord = formatRecordAddress(user);
  return fromRecord || '';
};

export const buildEnrichmentFromUserRecord = (record: any): FarmerEnrichment => {
  const farms = collectFarmsFromRecord(record);
  const plantation = getPlantationFromRecord(record);
  const firstFarm = farms[0];

  const email =
    record?.email ??
    record?.farmer?.email ??
    record?.farm_owner?.email ??
    record?.user?.email ??
    firstFarm?.farmer?.email ??
    '';

  const address = formatRecordAddress(record, firstFarm);

  return {
    email: email ? String(email).trim() : undefined,
    address: address || undefined,
    plantation_date: plantation.plantation_date,
    plantation_type: plantation.plantation_type,
  };
};

export const collectFarmerIdentityIds = (farmer: any, row?: any): number[] => {
  const raw = [
    farmer?.id,
    farmer?.user_id,
    row?.farmer_id,
    row?.user_id,
    row?.id,
    row?.farmer?.id,
    row?.farm_owner?.id,
    row?.user?.id,
  ];

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of raw) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isNaN(numeric) || seen.has(numeric)) continue;
    seen.add(numeric);
    ids.push(numeric);
  }
  return ids;
};

const registerEnrichment = (
  lookup: FarmerEnrichmentLookup,
  enrichment: FarmerEnrichment,
  ids: number[],
  phone?: string,
) => {
  for (const id of ids) {
    const existing = lookup.byId.get(id);
    lookup.byId.set(
      id,
      existing ? mergeEnrichmentValues(existing, enrichment) : enrichment,
    );
  }

  if (phone) {
    const existing = lookup.byPhone.get(phone);
    lookup.byPhone.set(
      phone,
      existing ? mergeEnrichmentValues(existing, enrichment) : enrichment,
    );
  }
};

export const buildFarmerEnrichmentLookupFromFarmerProfiles = (
  profiles: any[],
): FarmerEnrichmentLookup => {
  const lookup: FarmerEnrichmentLookup = {
    byId: new Map(),
    byPhone: new Map(),
  };

  for (const profile of profiles ?? []) {
    const enrichment = buildEnrichmentFromUserRecord(profile);
    const ids = collectFarmerIdentityIds(profile, profile);
    const phone = normalizePhone(
      profile?.phone_number ?? profile?.phone ?? profile?.farmer?.phone_number,
    );
    registerEnrichment(lookup, enrichment, ids, phone || undefined);
  }

  return lookup;
};

export const buildFarmerEnrichmentLookupFromFarmRows = (
  farmRows: any[],
): FarmerEnrichmentLookup => {
  const lookup: FarmerEnrichmentLookup = {
    byId: new Map(),
    byPhone: new Map(),
  };

  for (const row of farmRows ?? []) {
    const enrichment = buildEnrichmentFromUserRecord(row);
    const ids = collectFarmerIdentityIds(row?.farmer ?? row?.farm_owner ?? row?.user, row);
    const phone = normalizePhone(
      row?.farmer?.phone_number ??
        row?.farmer?.phone ??
        row?.phone_number ??
        row?.phone,
    );
    registerEnrichment(lookup, enrichment, ids, phone || undefined);
  }

  return lookup;
};

export const extractFarmersFromTeamConnect = (teamData: any): any[] => {
  if (!teamData) return [];

  const farmers: any[] = [];
  const pushUnique = (user: any) => {
    if (!user) return;
    const id = user.id ?? user.user_id;
    if (id != null && farmers.some((item) => (item.id ?? item.user_id) === id)) return;
    farmers.push(user);
  };

  if (Array.isArray(teamData.users_by_role?.farmers)) {
    teamData.users_by_role.farmers.forEach(pushUnique);
  }
  if (Array.isArray(teamData.farmers)) {
    teamData.farmers.forEach(pushUnique);
  }

  const managers = [
    ...(Array.isArray(teamData.users_by_role?.managers) ? teamData.users_by_role.managers : []),
    ...(Array.isArray(teamData.managers) ? teamData.managers : []),
  ];
  const fieldOfficers = [
    ...(Array.isArray(teamData.users_by_role?.field_officers)
      ? teamData.users_by_role.field_officers
      : []),
    ...(Array.isArray(teamData.field_officers) ? teamData.field_officers : []),
    ...managers.flatMap((manager: any) =>
      Array.isArray(manager?.field_officers) ? manager.field_officers : [],
    ),
  ];

  for (const officer of fieldOfficers) {
    const nestedFarmers = officer?.farmers ?? officer?.farmer_list ?? [];
    if (Array.isArray(nestedFarmers)) {
      nestedFarmers.forEach(pushUnique);
    }
  }

  if (Array.isArray(teamData.results)) {
    teamData.results.forEach((user: any) => {
      const role = extractUserRoleName(user).toLowerCase();
      if (role.includes('farmer')) pushUnique(user);
    });
  }

  return farmers;
};

export const extractFieldOfficersFromTeamConnect = (teamData: any): any[] => {
  if (!teamData) return [];

  const officers: any[] = [];
  const pushUnique = (user: any) => {
    if (!user) return;
    const id = user.id ?? user.user_id;
    if (id != null && officers.some((item) => (item.id ?? item.user_id) === id)) return;
    officers.push(user);
  };

  if (Array.isArray(teamData.users_by_role?.field_officers)) {
    teamData.users_by_role.field_officers.forEach(pushUnique);
  }
  if (Array.isArray(teamData.field_officers)) {
    teamData.field_officers.forEach(pushUnique);
  }

  const managers = [
    ...(Array.isArray(teamData.users_by_role?.managers) ? teamData.users_by_role.managers : []),
    ...(Array.isArray(teamData.managers) ? teamData.managers : []),
  ];

  for (const manager of managers) {
    const nested = manager?.field_officers ?? manager?.fieldOfficers ?? [];
    if (Array.isArray(nested)) {
      nested.forEach(pushUnique);
    }
  }

  if (Array.isArray(teamData.results)) {
    teamData.results.forEach((user: any) => {
      const role = extractUserRoleName(user).toLowerCase();
      if (role.includes('field') && role.includes('officer')) pushUnique(user);
    });
  }

  return officers;
};

export const buildFarmerEnrichmentLookup = (
  teamData: any,
): FarmerEnrichmentLookup =>
  buildFarmerEnrichmentLookupFromFarmerProfiles(extractFarmersFromTeamConnect(teamData));

export const mergeFarmerEnrichmentLookups = (
  ...lookups: FarmerEnrichmentLookup[]
): FarmerEnrichmentLookup => {
  const byId = new Map<number, FarmerEnrichment>();
  const byPhone = new Map<string, FarmerEnrichment>();

  const apply = (
    enrichment: FarmerEnrichment,
    farmerId?: number,
    phoneKey?: string,
  ) => {
    if (farmerId != null && !Number.isNaN(farmerId)) {
      const existing = byId.get(farmerId);
      byId.set(
        farmerId,
        existing ? mergeEnrichmentValues(existing, enrichment) : enrichment,
      );
    }
    if (phoneKey) {
      const existing = byPhone.get(phoneKey);
      byPhone.set(
        phoneKey,
        existing ? mergeEnrichmentValues(existing, enrichment) : enrichment,
      );
    }
  };

  for (const lookup of lookups) {
    lookup.byId.forEach((enrichment, id) => apply(enrichment, id));
    lookup.byPhone.forEach((enrichment, phone) => apply(enrichment, undefined, phone));
  }

  return { byId, byPhone };
};

export const getFarmerEnrichment = (
  user: any,
  lookup: FarmerEnrichmentLookup,
): FarmerEnrichment | undefined => {
  const byId = lookup.byId.get(user?.id);
  if (byId) return byId;

  const phone = normalizePhone(user?.phone_number ?? user?.phone);
  if (phone) {
    return lookup.byPhone.get(phone);
  }

  return undefined;
};
