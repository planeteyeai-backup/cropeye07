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

export function calculateAreaMetricsFromGeometry(geometry: GeoJsonPolygon) {
  const coordinates = geometry.coordinates?.[0];
  if (!coordinates || coordinates.length < 4) return null;

  const projectedPoints = coordinates
    .map((coordinate) => {
      if (!coordinate || coordinate.length < 2) return null;
      const [lng, lat] = coordinate;
      const projected = L.CRS.EPSG3857.project(L.latLng(lat, lng));
      return [projected.x, projected.y] as [number, number];
    })
    .filter(Boolean) as Array<[number, number]>;

  if (projectedPoints.length < 4) return null;

  let areaSqMeters = 0;
  for (let i = 0; i < projectedPoints.length; i++) {
    const [x1, y1] = projectedPoints[i];
    const [x2, y2] = projectedPoints[(i + 1) % projectedPoints.length];
    areaSqMeters += x1 * y2 - x2 * y1;
  }

  const areaSqm = Math.abs(areaSqMeters) / 2;
  return {
    sqm: areaSqm,
    ha: areaSqm / 10_000,
    acres: areaSqm / SQUARE_METERS_PER_ACRE,
  };
}
