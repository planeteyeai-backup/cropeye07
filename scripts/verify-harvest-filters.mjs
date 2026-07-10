/**
 * Verify harvest filter mapping logic (no login required).
 * Run: node scripts/verify-harvest-filters.mjs
 */

function isRoleLikeDisplayName(name) {
  return /^(field\s*officer|manager|farmer|owner|admin|representative)$/i.test(
    name.trim(),
  );
}

function personDisplayName(user) {
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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (["null", "undefined", "unknown", "n/a", "-"].includes(lower)) continue;
    return text;
  }
  return "";
}

function resolvePersonLabel(...values) {
  for (const value of values) {
    const text = firstNonEmpty(value);
    if (!text || isRoleLikeDisplayName(text)) continue;
    return text;
  }
  return "Unknown";
}

function formatPlantationLabel(raw) {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels = {
    pre_seasonal: "Pre-Seasonal",
    preseasonal: "Pre-Seasonal",
    adsali: "Adsali",
    suru: "Suru",
    ratoon: "Ratoon",
  };
  if (labels[key]) return labels[key];
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function filterHarvestRows(rows, filters) {
  return rows.filter((row) => {
    const managerMatch =
      filters.manager === "All" || row.Manager === filters.manager;
    const repMatch =
      filters.representative === "All" ||
      row.representative === filters.representative;
    const regionMatch =
      filters.region === "All" || row.Region === filters.region;
    const typeMatch =
      filters.sugarcaneType === "All" ||
      row["Sugarcane Type"] === filters.sugarcaneType;
    const varietyMatch =
      filters.variety === "All" || row.Variety === filters.variety;
    return managerMatch && repMatch && regionMatch && typeMatch && varietyMatch;
  });
}

// Simulated rows after buildOwnerHarvestRows + our fixes
const rows = [
  {
    id: "p1-f1",
    Manager: resolvePersonLabel("ICPL Sugar Factory Vijayapura", "Manager"),
    representative: resolvePersonLabel(
      personDisplayName({
        first_name: "Field",
        last_name: "Officer",
        username: "fo_vijayapura_1",
      }),
      "Field Officer",
    ),
    Region: "Vijayapura",
    "Sugarcane Type": formatPlantationLabel("adsali"),
    Variety: "Co-86032",
  },
  {
    id: "p2-f2",
    Manager: resolvePersonLabel("ICPL Sugar Factory Vijayapura", "Manager"),
    representative: resolvePersonLabel(
      personDisplayName({
        first_name: "Field",
        last_name: "Officer",
        username: "fo_vijayapura_2",
      }),
      "Field Officer",
    ),
    Region: "Indi",
    "Sugarcane Type": formatPlantationLabel("suru"),
    Variety: "Co-0238",
  },
];

const options = {
  managers: [...new Set(rows.map((r) => r.Manager))],
  representatives: [...new Set(rows.map((r) => r.representative))],
  regions: [...new Set(rows.map((r) => r.Region))],
  sugarcaneTypes: [...new Set(rows.map((r) => r["Sugarcane Type"]))],
};

let passed = 0;
let failed = 0;

function assert(condition, label, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== 1. personDisplayName ===");
assert(
  personDisplayName({ first_name: "Field", last_name: "Officer", username: "fo_vijayapura_1" }) ===
    "fo_vijayapura_1",
  "Field Officer + username → username",
);
assert(
  personDisplayName({ first_name: "Field", last_name: "Officer", id: 202 }) === "User-202",
  "Field Officer + id → User-202",
);
assert(
  personDisplayName({ first_name: "ICPL Sugar Factory", last_name: "Vijayapura" }) ===
    "ICPL Sugar Factory Vijayapura",
  "Real manager name preserved",
);

console.log("\n=== 2. Dropdown options (no role-like labels) ===");
assert(
  !options.representatives.includes("Field Officer"),
  `No 'Field Officer' in reps (got: ${options.representatives.join(", ")})`,
);
assert(
  options.representatives.includes("fo_vijayapura_1") &&
    options.representatives.includes("fo_vijayapura_2"),
  "Two distinct representatives",
);
assert(options.managers[0] === "ICPL Sugar Factory Vijayapura", "Manager name correct");
assert(options.sugarcaneTypes.includes("Adsali"), "Adsali formatted");

console.log("\n=== 3. Filter: Manager + Adsali ===");
const adsali = filterHarvestRows(rows, {
  manager: "ICPL Sugar Factory Vijayapura",
  region: "All",
  representative: "All",
  sugarcaneType: "Adsali",
  variety: "All",
});
assert(adsali.length === 1, `Adsali → 1 row (got ${adsali.length})`);
assert(adsali[0].representative === "fo_vijayapura_1", "Correct rep on Adsali row");

console.log("\n=== 4. Filter: specific representative ===");
const repOnly = filterHarvestRows(rows, {
  manager: "ICPL Sugar Factory Vijayapura",
  region: "All",
  representative: "fo_vijayapura_2",
  sugarcaneType: "All",
  variety: "All",
});
assert(repOnly.length === 1, `fo_vijayapura_2 → 1 row (got ${repOnly.length})`);
assert(repOnly[0].Region === "Indi", "Indi plot only");

console.log("\n=== 5. Filter: Manager + Region + Adsali (your screenshot combo) ===");
const combo = filterHarvestRows(rows, {
  manager: "ICPL Sugar Factory Vijayapura",
  region: "All",
  representative: "fo_vijayapura_1",
  sugarcaneType: "Adsali",
  variety: "All",
});
assert(combo.length === 1, `Full combo → 1 row (got ${combo.length})`);

console.log("\n=== 6. Old bug: filtering by 'Field Officer' would match ALL ===");
const oldBug = filterHarvestRows(
  rows.map((r) => ({ ...r, representative: "Field Officer" })),
  {
    manager: "All",
    region: "All",
    representative: "Field Officer",
    sugarcaneType: "All",
    variety: "All",
  },
);
assert(oldBug.length === 2, "Old bug: 'Field Officer' matches both rows (wrong)");
const fixed = filterHarvestRows(rows, {
  manager: "All",
  region: "All",
  representative: "Field Officer",
  sugarcaneType: "All",
  variety: "All",
});
assert(fixed.length === 0, "Fixed: 'Field Officer' filter matches 0 rows");

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log("All harvest filter checks passed.\n");
