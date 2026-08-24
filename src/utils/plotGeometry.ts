const SQUARE_METERS_PER_ACRE = 4046.8564224;
const EARTH_RADIUS_METERS = 6378137;

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

export function resolveGeoJsonPoint(
  source: any,
): GeoJsonPoint | null {
  const candidates = [
    source,
    source?.location,
    source?.coordinates?.location,
  ];

  for (const raw of candidates) {
    if (
      raw?.type === "Point" &&
      Array.isArray(raw.coordinates) &&
      raw.coordinates.length >= 2
    ) {
      const lng = Number(raw.coordinates[0]);
      const lat = Number(raw.coordinates[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        return { type: "Point", coordinates: [lng, lat] };
      }
    }
  }

  return null;
}

export function pointToLeafletLatLng(
  point: GeoJsonPoint | null | undefined,
): [number, number] | null {
  if (!point?.coordinates?.length) return null;
  const [lng, lat] = point.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lat, lng];
}

export function leafletLatLngToPoint(lat: number, lng: number): GeoJsonPoint {
  return { type: "Point", coordinates: [lng, lat] };
}

export function boundaryToLeafletCoords(
  boundary: GeoJsonPolygon | null | undefined,
): [number, number][] {
  const ring = boundary?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [];

  return ring
    .filter((pt) => Array.isArray(pt) && pt.length >= 2)
    .map(([lng, lat]) => [lat, lng] as [number, number]);
}

export function leafletRingToGeoJsonBoundary(
  coords: [number, number][],
): GeoJsonPolygon | null {
  if (coords.length < 3) return null;

  const apiRing = coords.map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = apiRing[0];
  const last = apiRing[apiRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    apiRing.push([first[0], first[1]]);
  }

  return {
    type: "Polygon",
    coordinates: [apiRing],
  };
}

export function centerFromBoundary(boundary: GeoJsonPolygon): GeoJsonPoint {
  const ring = boundary.coordinates[0] ?? [];
  const points =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;

  const sum = points.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 },
  );
  const count = Math.max(points.length, 1);

  return {
    type: "Point",
    coordinates: [sum.lng / count, sum.lat / count],
  };
}

/**
 * Geodesic ring area in m². Web Mercator (EPSG3857) shoelace inflates area by
 * ~1/cos²(latitude) (about +9% at 17°N), so it must not be used for acres.
 */
export function geodesicAreaSqMeters(ring: number[][]): number {
  const points = ring.filter((pt) => Array.isArray(pt) && pt.length >= 2);
  if (points.length < 3) return 0;

  const first = points[0];
  const last = points[points.length - 1];
  const closed =
    first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
  if (closed.length < 3) return 0;

  const toRad = Math.PI / 180;
  let total = 0;

  for (let i = 0; i < closed.length; i++) {
    const [lng1, lat1] = closed[i];
    const [lng2, lat2] = closed[(i + 1) % closed.length];
    if (![lng1, lat1, lng2, lat2].every((n) => Number.isFinite(Number(n)))) {
      return 0;
    }
    total +=
      (Number(lng2) - Number(lng1)) *
      toRad *
      (2 + Math.sin(Number(lat1) * toRad) + Math.sin(Number(lat2) * toRad));
  }

  return Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
}

export function calculateAreaMetricsFromGeometry(geometry: GeoJsonPolygon) {
  const coordinates = geometry.coordinates?.[0];
  if (!coordinates || coordinates.length < 4) return null;

  const areaSqm = geodesicAreaSqMeters(coordinates);
  if (!(areaSqm > 0)) return null;

  return {
    sqm: areaSqm,
    ha: areaSqm / 10_000,
    acres: areaSqm / SQUARE_METERS_PER_ACRE,
  };
}

/** Axis-aligned bbox intersection-over-union for two GeoJSON polygons (lng/lat rings). */
export function polygonBboxIou(
  a: GeoJsonPolygon | null | undefined,
  b: GeoJsonPolygon | null | undefined,
): number {
  const box = (g: GeoJsonPolygon | null | undefined) => {
    const ring = g?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const lng = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    if (!Number.isFinite(minLng) || minLng > maxLng || minLat > maxLat) return null;
    return { minLng, minLat, maxLng, maxLat };
  };

  const A = box(a);
  const B = box(b);
  if (!A || !B) return 0;

  const interMinLng = Math.max(A.minLng, B.minLng);
  const interMinLat = Math.max(A.minLat, B.minLat);
  const interMaxLng = Math.min(A.maxLng, B.maxLng);
  const interMaxLat = Math.min(A.maxLat, B.maxLat);
  const interW = Math.max(0, interMaxLng - interMinLng);
  const interH = Math.max(0, interMaxLat - interMinLat);
  const inter = interW * interH;
  const areaA = Math.max(0, A.maxLng - A.minLng) * Math.max(0, A.maxLat - A.minLat);
  const areaB = Math.max(0, B.maxLng - B.minLng) * Math.max(0, B.maxLat - B.minLat);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

/** True when Admin analysis polygon still looks like the pre-edit plot. */
export function isAnalysisGeometryStale(
  saved: GeoJsonPolygon | null | undefined,
  analysis: GeoJsonPolygon | null | undefined,
  minIou = 0.45,
): boolean {
  if (!saved?.coordinates?.[0] || !analysis?.coordinates?.[0]) return false;
  try {
    if (JSON.stringify(saved.coordinates) === JSON.stringify(analysis.coordinates)) {
      return false;
    }
  } catch {
    // continue with IoU
  }
  return polygonBboxIou(saved, analysis) < minIou;
}
