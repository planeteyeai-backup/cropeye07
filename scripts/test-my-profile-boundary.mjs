/**
 * Test PATCH /api/farms/my-profile/ for plot boundary (farmer token required).
 *
 * Usage (PowerShell):
 *   $env:FARMER_TOKEN="your_jwt_access_token"
 *   node scripts/test-my-profile-boundary.mjs
 *
 * Optional:
 *   $env:API_BASE_URL="https://cropeye-backendd.up.railway.app/api"
 */

const API_BASE_URL = (
  process.env.API_BASE_URL || "https://cropeye-backendd.up.railway.app/api"
).replace(/\/$/, "");

const TOKEN = process.env.FARMER_TOKEN || process.env.ACCESS_TOKEN || "";

const PATCH_BODY = {
  plot: {
    location: {
      type: "Point",
      coordinates: [74.25, 19.25],
    },
    boundary: {
      type: "Polygon",
      coordinates: [
        [
          [74.2, 19.2],
          [74.3, 19.2],
          [74.3, 19.3],
          [74.2, 19.3],
          [74.2, 19.2],
        ],
      ],
    },
  },
};

function authHeaders() {
  if (!TOKEN) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };
}

function pickBoundary(data) {
  const plot =
    data?.plot ??
    data?.plots?.[0] ??
    data?.farm?.plot ??
    null;
  return (
    plot?.boundary ??
    plot?.coordinates?.boundary ??
    null
  );
}

function pickLocation(data) {
  const plot =
    data?.plot ??
    data?.plots?.[0] ??
    data?.farm?.plot ??
    null;
  return (
    plot?.location ??
    plot?.coordinates?.location ??
    null
  );
}

async function request(method, path, body) {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: res.status, ok: res.ok, json };
}

async function main() {
  console.log("API:", API_BASE_URL);
  console.log("Token:", TOKEN ? `${TOKEN.slice(0, 12)}...` : "(missing)");

  if (!TOKEN) {
    console.error(
      "\nSet FARMER_TOKEN first (farmer JWT from browser localStorage after login).",
    );
    console.error('Example: $env:FARMER_TOKEN="eyJ..."');
    process.exit(1);
  }

  console.log("\n--- 1) GET /farms/my-profile/ (before) ---");
  const before = await request("GET", "/farms/my-profile/");
  console.log("Status:", before.status);
  if (!before.ok) {
    console.log("Response:", JSON.stringify(before.json, null, 2));
    process.exit(1);
  }
  console.log("Boundary before:", JSON.stringify(pickBoundary(before.json)));
  console.log("Location before:", JSON.stringify(pickLocation(before.json)));

  console.log("\n--- 2) PATCH /farms/my-profile/ ---");
  console.log("Body:", JSON.stringify(PATCH_BODY, null, 2));
  const patched = await request("PATCH", "/farms/my-profile/", PATCH_BODY);
  console.log("Status:", patched.status);
  console.log("Response:", JSON.stringify(patched.json, null, 2));

  if (!patched.ok) {
    console.error("\nPATCH failed. Common causes:");
    console.error("  401/403 — not logged in as farmer, or token expired");
    console.error("  400 — invalid geometry or missing plot on profile");
    process.exit(1);
  }

  console.log("\n--- 3) GET /farms/my-profile/ (after) ---");
  const after = await request("GET", "/farms/my-profile/");
  console.log("Status:", after.status);
  console.log("Boundary after:", JSON.stringify(pickBoundary(after.json)));
  console.log("Location after:", JSON.stringify(pickLocation(after.json)));

  const afterBoundary = JSON.stringify(pickBoundary(after.json));
  const expectedRing = JSON.stringify(PATCH_BODY.plot.boundary.coordinates[0]);
  const saved = afterBoundary.includes("74.2") && afterBoundary.includes("74.3");

  console.log("\n--- Result ---");
  if (saved) {
    console.log("OK: Boundary appears saved on my-profile.");
  } else {
    console.log("WARN: PATCH returned success but boundary may not match expected ring.");
    console.log("Expected ring includes:", expectedRing.slice(0, 80), "...");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
