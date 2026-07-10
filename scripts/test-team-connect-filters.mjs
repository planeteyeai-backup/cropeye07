/**
 * Test team-connect response → harvest filter mapping.
 *
 * Usage (PowerShell):
 *   $env:TOKEN="paste_your_bearer_token_here"
 *   node scripts/test-team-connect-filters.mjs
 *
 * Optional:
 *   $env:INDUSTRY_ID="5"
 */
import https from "https";

const TOKEN = process.env.TOKEN || process.env.AUTH_TOKEN || "";
const INDUSTRY_ID = process.env.INDUSTRY_ID || "5";
const BASE =
  process.env.API_BASE || "https://cropeye-backendd.up.railway.app/api";

if (!TOKEN) {
  console.error(
    "Missing TOKEN. In browser DevTools → Application → Local Storage → copy value of key `token`, then:\n" +
      '  $env:TOKEN="YOUR_TOKEN"\n' +
      "  node scripts/test-team-connect-filters.mjs",
  );
  process.exit(1);
}

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE.endsWith("/") ? BASE : `${BASE}/`);
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = body;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text && text.toLowerCase() !== "null") return text;
  }
  return "";
}

function personDisplayName(user) {
  const full = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();
  const username = `${user?.username ?? ""}`.trim();
  const roleLike =
    /^(field\s*officer|manager|farmer|owner|admin|representative)$/i.test(full);
  if (full && !roleLike) return full;
  if (username) return username;
  if (full) return full;
  return "Unknown";
}

function readSugarcaneType(farm, plot, farmer) {
  const cropType = farm?.crop_type;
  return (
    firstNonEmpty(
      farm?.plantation_type_display,
      cropType?.plantation_type_display,
      farm?.plantation_type,
      farm?.variety_type,
      cropType?.plantation_type,
      plot?.plantation_type,
      farmer?.plantation_type,
    ) || "Unknown"
  );
}

function readVariety(farm, plot, farmer) {
  const cropType = farm?.crop_type;
  return firstNonEmpty(
    farm?.crop_variety,
    cropType?.crop_variety,
    farm?.variety,
    cropType?.variety,
    plot?.crop_variety,
    farmer?.crop_variety,
  );
}

function collectFarms(farmer) {
  const farms = [];
  if (Array.isArray(farmer?.farms)) farms.push(...farmer.farms);
  if (Array.isArray(farmer?.plots)) {
    for (const plot of farmer.plots) {
      if (Array.isArray(plot?.farms)) farms.push(...plot.farms);
    }
  }
  return farms;
}

function walkHierarchy(data) {
  const managers = [];
  const fieldOfficers = [];
  const farmers = [];

  if (data?.users_by_role) {
    managers.push(...(data.users_by_role.managers || []));
    fieldOfficers.push(...(data.users_by_role.field_officers || []));
    farmers.push(...(data.users_by_role.farmers || []));
  }
  if (Array.isArray(data?.managers)) managers.push(...data.managers);
  if (Array.isArray(data?.field_officers)) fieldOfficers.push(...data.field_officers);
  if (Array.isArray(data?.farmers)) farmers.push(...data.farmers);

  if (!fieldOfficers.length && managers.length) {
    for (const m of managers) {
      for (const fo of m.field_officers || m.fieldOfficers || []) {
        fieldOfficers.push({ ...fo, _managerName: personDisplayName(m) });
      }
    }
  }

  // Attach flat farmers under FOs when nested farmers missing
  if (farmers.length) {
    for (const fo of fieldOfficers) {
      if (Array.isArray(fo.farmers) && fo.farmers.length) continue;
      const foId = fo.id;
      fo.farmers = farmers.filter(
        (f) =>
          f.created_by === foId ||
          f.field_officer_id === foId ||
          String(f.created_by || "").includes(fo.username || "__none__"),
      );
    }
  }

  return { managers, fieldOfficers, farmers };
}

const { status, json } = await get(
  `users/team-connect/?industry_id=${encodeURIComponent(INDUSTRY_ID)}`,
);

console.log("\n=== team-connect status ===");
console.log("HTTP", status);
if (status !== 200) {
  console.log(JSON.stringify(json, null, 2));
  process.exit(1);
}

const hierarchy = walkHierarchy(json);
const managerNames = new Set();
const repNames = new Set();
const regions = new Set();
const types = new Set();
const varieties = new Set();
let farmCount = 0;
let nullCropVariety = 0;
let nullVarietyType = 0;
let nullPlantationDate = 0;
const samples = [];

for (const fo of hierarchy.fieldOfficers) {
  const rep = personDisplayName(fo);
  repNames.add(rep);
  managerNames.add(fo._managerName || "Unknown");

  for (const farmer of fo.farmers || []) {
    const farms = collectFarms(farmer);
    const plots = Array.isArray(farmer.plots) ? farmer.plots : [];

    if (!farms.length && !plots.length) {
      samples.push({
        farmer: personDisplayName(farmer),
        note: "no farms/plots",
      });
      continue;
    }

    const targets =
      plots.length > 0
        ? plots.map((p) => ({
            plot: p,
            farm: (p.farms && p.farms[0]) || farms[0] || null,
          }))
        : farms.map((f) => ({ plot: f, farm: f }));

    for (const { plot, farm } of targets) {
      farmCount += 1;
      if (!farm?.crop_variety && !farm?.crop_type?.crop_variety) nullCropVariety += 1;
      if (!farm?.variety_type && !farm?.plantation_type && !farm?.crop_type?.plantation_type) {
        nullVarietyType += 1;
      }
      if (!farm?.plantation_date && !farm?.crop_type?.plantation_date) {
        nullPlantationDate += 1;
      }

      const type = readSugarcaneType(farm, plot, farmer);
      const variety = readVariety(farm, plot, farmer);
      const region =
        firstNonEmpty(plot?.taluka, farmer?.taluka, fo?.taluka, farmer?.district) ||
        "Unknown";

      types.add(type);
      if (variety) varieties.add(variety);
      regions.add(region);

      if (samples.length < 8) {
        samples.push({
          farmer: personDisplayName(farmer),
          representative: rep,
          region,
          sugarcaneType: type,
          variety: variety || "(empty)",
          raw: {
            crop_variety: farm?.crop_variety ?? null,
            variety_type: farm?.variety_type ?? null,
            plantation_type: farm?.plantation_type ?? null,
            plantation_type_display: farm?.plantation_type_display ?? null,
            plantation_date: farm?.plantation_date ?? null,
          },
        });
      }
    }
  }
}

console.log("\n=== hierarchy counts ===");
console.log({
  managers: hierarchy.managers.length,
  fieldOfficers: hierarchy.fieldOfficers.length,
  flatFarmers: hierarchy.farmers.length,
  nestedFarmerSlots: hierarchy.fieldOfficers.reduce(
    (n, fo) => n + (fo.farmers?.length || 0),
    0,
  ),
  farmOrPlotRows: farmCount,
});

console.log("\n=== filter values frontend would show ===");
console.log({
  managers: [...managerNames].sort(),
  representatives: [...repNames].sort(),
  regions: [...regions].sort(),
  sugarcaneTypes: [...types].sort(),
  varieties: varieties.size ? [...varieties].sort() : ["(none — crop_variety is null)"],
});

console.log("\n=== null-field rates (why Variety=All) ===");
console.log({
  nullCropVariety: `${nullCropVariety}/${farmCount}`,
  nullVarietyTypeOrPlantationType: `${nullVarietyType}/${farmCount}`,
  nullPlantationDate: `${nullPlantationDate}/${farmCount}`,
});

console.log("\n=== sample mapped rows ===");
console.log(JSON.stringify(samples, null, 2));

console.log(
  "\nVerdict:\n" +
    "- If representatives include 'Field Officer', API user first/last name is role-like (now remapped to username).\n" +
    "- If varieties empty, API really returns crop_variety:null — frontend cannot invent variety filter options.\n" +
    "- Manager/Region/Sugarcane Type values above are what dropdowns should list from this response.\n",
);
