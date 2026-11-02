/** Pure geo helpers (no I/O). Distances in km, WGS84 degrees. */

export type LatLng = { lat: number; lng: number };

export const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = 111.32;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (haversine). Matches the SQL in matching.repository. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Axis-aligned box that contains every point within `radiusKm` (index prefilter). */
export function boundingBox(center: LatLng, radiusKm: number) {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cos = Math.max(Math.cos(toRad(center.lat)), 1e-6);
  const dLng = radiusKm / (KM_PER_DEG_LAT * cos);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

/** Moves a point by km north/east (seed + tests). */
export function offsetKm(p: LatLng, northKm: number, eastKm = 0): LatLng {
  return {
    lat: p.lat + northKm / KM_PER_DEG_LAT,
    lng: p.lng + eastKm / (KM_PER_DEG_LAT * Math.cos(toRad(p.lat))),
  };
}

/** Rounds to 2 decimals (~1.1 km) so leads never expose the exact location. */
export function roundCoord(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function maskLocation(p: LatLng): LatLng {
  return { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
}

/** Distance shown to workers before acceptance: nearest 0.5 km. */
export function approxDistanceKm(km: number): number {
  return Math.max(0.5, Math.round(km * 2) / 2);
}
