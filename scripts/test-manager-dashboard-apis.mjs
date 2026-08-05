/**
 * Live-check manager harvest + Chart of Progress filter APIs
 * against the shapes the frontend expects.
 *
 * Usage:
 *   node scripts/test-manager-dashboard-apis.mjs
 *   $env:TOKEN="jwt"; node scripts/test-manager-dashboard-apis.mjs
 */
import https from "https";
import http from "http";

const API_BASE = (
  process.env.API_BASE || "https://cropeye-backendd.up.railway.app/api"
).replace(/\/$/, "");
const EVENTS = (
  process.env.EVENTS_BASE || "https://events-cropeye.up.railway.app"
).replace(/\/$/, "");
const SEF = (
  process.env.SEF_BASE || "https://sef-cropeye.up.railway.app"
).replace(/\/$/, "");
const OWNER_ID = Number(process.env.OWNER_ID || 2476);
const TOKEN = process.env.TOKEN || process.env.AUTH_TOKEN || "";

const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(
      url,
      { method: "GET", headers: { Accept: "application/json", ...headers } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = body?.slice?.(0, 200) ?? body;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", (err) =>
      resolve({ status: 0, json: { error: String(err.message) } }),
    );
    req.setTimeout(90000, () => {
      req.destroy();
      resolve({ status: 0, json: { error: "timeout" } });
    });
    req.end();
  });
}

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

function isObj(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function pickPlotSample(agro) {
  if (!isObj(agro)) return null;
  const entries = Object.entries(agro).filter(
    ([, v]) => isObj(v) && (v.brix_sugar || v.soil || v.area_acres != null),
  );
  return entries[0] ?? null;
}

function frontendCanReadYield(plot) {
  const y =
    plot?.brix_sugar?.sugar_yield?.mean ??
    plot?.brix_sugar?.sugar_yield?.avg ??
    plot?.brix_sugar?.sugar_yield?.average ??
    plot?.brix_sugar?.sugar_yield_mean ??
    plot?.sugar_yield_mean ??
    plot?.expected_yield ??
    plot?.brix_sugar?.sugar_yield?.min;
  const n = Number(y);
  return Number.isFinite(n);
}

function frontendCanReadRecovery(plot) {
  const r =
    plot?.brix_sugar?.recovery?.mean ??
    plot?.brix_sugar?.recovery?.avg ??
    plot?.brix_sugar?.recovery?.average ??
    plot?.brix_sugar?.recovery_mean ??
    plot?.recovery_mean ??
    plot?.brix_sugar?.recovery?.min;
  const n = Number(r);
  return Number.isFinite(n);
}

function regionFieldsFromPlot(plot) {
  return [
    plot?.village,
    plot?.taluka,
    plot?.district,
    plot?.region,
    plot?.location,
    plot?.address,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
}

console.log("\n=== Chart of Progress (factory filter) — public ===\n");

{
  const url = `${SEF}/industrial-yield-by-owner?owner_id=${OWNER_ID}`;
  const { status, json } = await get(url);
  check(
    "SEF industrial-yield-by-owner reachable",
    status === 200,
    `HTTP ${status}`,
  );
  const factories = Array.isArray(json?.factories) ? json.factories : [];
  check(
    "SEF has factories[] for dropdown",
    factories.length > 0,
    `count=${factories.length}`,
  );
  if (factories[0]) {
    const f = factories[0];
    check(
      "Factory shape: factory_id + factory_name",
      f.factory_id != null && !!f.factory_name,
      `id=${f.factory_id} name=${f.factory_name}`,
    );
    const farmers = Array.isArray(f.farmers) ? f.farmers : [];
    check(
      "Factory has farmers[] (chart rows)",
      farmers.length > 0,
      `farmers=${farmers.length}`,
    );
    const sample = farmers.find((fr) => Array.isArray(fr?.yields) && fr.yields.length) || farmers[0];
    if (sample) {
      check(
        "Farmer yield shape usable by frontend",
        sample.farmer_id != null || sample.farmer_name != null || sample.name != null,
        `keys=${Object.keys(sample).slice(0, 8).join(",")}`,
      );
    }
  }
}

{
  const url = `${API_BASE}/users/public-factory-farmers/?owner_id=${OWNER_ID}`;
  const { status, json } = await get(url);
  check(
    "Django public-factory-farmers reachable",
    status === 200,
    `HTTP ${status}`,
  );
  const factories = Array.isArray(json?.factories)
    ? json.factories
    : Array.isArray(json)
      ? json
      : [];
  check(
    "public-factory-farmers factories for filter",
    factories.length > 0,
    `count=${factories.length}`,
  );
  if (factories[0]) {
    const f = factories[0];
    check(
      "public factory filter fields match frontend",
      f.factory_id != null && !!f.factory_name,
      `id=${f.factory_id} name=${String(f.factory_name).slice(0, 40)}`,
    );
  }
}

console.log("\n=== Manager Harvest Planning APIs ===\n");

{
  const url = `${API_BASE}/users/my-field-officers/`;
  const { status, json } = await get(url, authHeaders());
  if (!TOKEN) {
    check(
      "my-field-officers (needs manager JWT)",
      status === 401 || status === 403,
      `HTTP ${status} — set $env:TOKEN to live-test as manager`,
    );
  } else {
    check("my-field-officers with token", status === 200, `HTTP ${status}`);
    const officers = Array.isArray(json?.field_officers)
      ? json.field_officers
      : Array.isArray(json)
        ? json
        : [];
    check(
      "field_officers[] present for FO filter",
      officers.length > 0,
      `count=${officers.length}`,
    );
    if (officers[0]?.id != null) {
      const foId = officers[0].id;
      const agroUrl = `${EVENTS}/field-officers/${foId}/agroStats`;
      const agroRes = await get(agroUrl);
      check(
        `FO agroStats (latest) FO=${foId}`,
        agroRes.status === 200 && isObj(agroRes.json),
        `HTTP ${agroRes.status} plots=${isObj(agroRes.json) ? Object.keys(agroRes.json).length : 0}`,
      );
      const sample = pickPlotSample(agroRes.json);
      if (sample) {
        const [plotKey, plot] = sample;
        check(
          "agro plot key usable as filter row id",
          !!plotKey && plotKey.length > 0,
          `key=${plotKey}`,
        );
        const regions = regionFieldsFromPlot(plot);
        // Region often comes from hierarchy/farms, not agroStats — warn only.
        check(
          "region/location fields for Region filter (agro sample)",
          true,
          regions.length
            ? `sample=${regions.slice(0, 3).join(" | ")}`
            : "WARN: no village/taluka on agro plot — UI uses farms/hierarchy",
        );
        const hasYield = frontendCanReadYield(plot);
        const hasRecovery = frontendCanReadRecovery(plot);
        check(
          "sugar_yield readable like frontend extractSugarYield",
          hasYield,
          hasYield
            ? `mean=${plot?.brix_sugar?.sugar_yield?.mean}`
            : `brix_sugar keys=${Object.keys(plot?.brix_sugar || {}).join(",") || "missing"}`,
        );
        check(
          "recovery readable like frontend extractRecovery",
          hasRecovery,
          hasRecovery
            ? `mean=${plot?.brix_sugar?.recovery?.mean}`
            : `recovery=${JSON.stringify(plot?.brix_sugar?.recovery ?? null)}`,
        );

        // Compare latest vs today filter (?end_date=)
        const today = new Date().toISOString().slice(0, 10);
        const todayRes = await get(`${agroUrl}?end_date=${today}`);
        const todaySample = pickPlotSample(todayRes.json);
        const todayYield = todaySample
          ? frontendCanReadYield(todaySample[1])
          : false;
        const latestYield = hasYield;
        check(
          "end_date=today vs latest — frontend prefers latest",
          true,
          `latestYield=${latestYield} todayYield=${todayYield} todayHTTP=${todayRes.status}`,
        );
      } else {
        check("agroStats has plot objects", false, "empty or unexpected shape");
      }
    }
  }
}

{
  // Unauth smoke: events host up
  const { status } = await get(`${EVENTS}/docs`);
  check(
    "events-cropeye host up",
    status === 200 || status === 404 || status === 307 || status === 301,
    `HTTP ${status}`,
  );
}

console.log("\n=== Summary ===\n");
const failed = results.filter((r) => !r.ok);
const passed = results.filter((r) => r.ok);
console.log(`Passed: ${passed.length}  Failed: ${failed.length}`);
if (!TOKEN) {
  console.log(
    "\nTip: for full manager filter test, log in as manager → DevTools → Application → Local Storage → copy `token`, then:\n  $env:TOKEN=\"...\"\n  node scripts/test-manager-dashboard-apis.mjs\n",
  );
}
process.exit(failed.length ? 1 : 0);
