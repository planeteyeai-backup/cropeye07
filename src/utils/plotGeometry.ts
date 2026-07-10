import L from "leaflet";

const SQUARE_METERS_PER_ACRE = 4046.8564224;

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

/** Convert GeoJSON [lng, lat] ring → Leaflet [lat, lng] coords. */
export function boundaryToLeafletCoords(
  boundary: GeoJsonPolygon | null | undefined,
): [number, number][] {
  const ring = boundary?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [];

  return ring
    .filter((pt) => Array.isArray(pt) && pt.length >= 2)
    .map(([lng, lat]) => [lat, lng] as [number, number]);
}

/** Convert Leaflet [lat, lng] ring → GeoJSON Polygon. */
export function leafletRingToGeoJsonBoundary(
  coords: [number, number][],
): GeoJsonPolygon | null {
  if (!Array.isArray(coords) || coords.length < 3) return null;

  const ring = coords.map(([lat, lng]) => [lng, lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

/** Center point from polygon boundary (lng, lat). */
export function centerFromBoundary(
  boundary: GeoJsonPolygon | null | undefined,
): GeoJsonPoint | null {
  const leafletCoords = boundaryToLeafletCoords(boundary);
  if (leafletCoords.length === 0) return null;

  const bounds = L.latLngBounds(leafletCoords.map(([lat, lng]) => [lat, lng]));
  const c = bounds.getCenter();
  return {
    type: "Point",
    coordinates: [c.lng, c.lat],
  };
}

/** Area in acres / hectares from a GeoJSON polygon. */
export function calculateAreaMetricsFromGeometry(
  geometry: GeoJsonPolygon | null | undefined,
): { acres: number; hectares: number; squareMeters: number } | null {
  const leafletCoords = boundaryToLeafletCoords(geometry);
  if (leafletCoords.length < 3) return null;

  try {
    const polygon = L.polygon(leafletCoords);
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
    if (!Array.isArray(latlngs) || latlngs.length < 3) return null;

    // Spherical excess approximation via Leaflet's geodesic area helper when available
    const squareMeters =
      typeof (L.GeometryUtil as any)?.geodesicArea === "function"
        ? (L.GeometryUtil as any).geodesicArea(latlngs)
        : leafletPolygonAreaSqM(latlngs);

    if (!Number.isFinite(squareMeters) || squareMeters <= 0) return null;

    const acres = squareMeters / SQUARE_METERS_PER_ACRE;
    const hectares = squareMeters / 10000;
    return { acres, hectares, squareMeters };
  } catch {
    return null;
  }
}

/** Fallback ring area in m² (equirectangular). */
function leafletPolygonAreaSqM(latlngs: L.LatLng[]): number {
  if (latlngs.length < 3) return 0;

  const R = 6378137; // earth radius meters
  let area = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    const lng1 = (p1.lng * Math.PI) / 180;
    const lng2 = (p2.lng * Math.PI) / 180;
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = (area * R * R) / 2;
  return Math.abs(area);
}
