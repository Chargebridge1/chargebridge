/**
 * Shared polyline geometry utilities used by the foreground GPS handler
 * (map.tsx) and the background off-route detection path (backgroundNav.ts via
 * navOffRouteDetect.ts).
 *
 * Extracting the perpendicular-projection formula here ensures that any
 * change to the geometry propagates to both callers simultaneously and is
 * caught by the integration tests in __tests__/backgroundNavOffRoute.test.ts.
 */

import { haversineMeters, LatLng } from "@/utils/navStepAdvance";

export type { LatLng };

/**
 * Projects `pos` perpendicularly onto the nearest segment of `coords`
 * and returns the interpolated point on the polyline.
 *
 * Algorithm: for each segment A–B, clamp the scalar projection t to [0, 1]
 * and compute the projected point in degree-space.  haversineMeters is then
 * used to rank segments — degree-space arithmetic is an approximation, but
 * the haversine ranking is exact and the approximation error is negligible at
 * nav-relevant scales (< 2 km segments).
 *
 * Performance: O(n) full scan.  The background task fires at most 1 Hz and
 * route polylines are finite in length, so the optimization hint used by the
 * foreground's closestRoutePoint() is unnecessary here.
 *
 * @param coords  Route polyline as an ordered array of WGS-84 coordinates.
 * @param pos     Current GPS position to project.
 * @returns       The nearest point on the polyline (interpolated).
 */
export function closestPointOnPolyline(coords: LatLng[], pos: LatLng): LatLng {
  if (coords.length === 0) return pos;
  if (coords.length === 1) return coords[0];

  let bestDist = Infinity;
  let bestInterp: LatLng = coords[0];

  for (let i = 0; i < coords.length - 1; i++) {
    const A = coords[i];
    const B = coords[i + 1];
    const ax = A.longitude, ay = A.latitude;
    const bx = B.longitude, by = B.latitude;
    const px = pos.longitude, py = pos.latitude;
    const abx = bx - ax, aby = by - ay;
    const abLen2 = abx * abx + aby * aby;
    let t = abLen2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / abLen2;
    t = Math.max(0, Math.min(1, t));
    const interp: LatLng = { latitude: ay + t * aby, longitude: ax + t * abx };
    const d = haversineMeters(interp, pos);
    if (d < bestDist) {
      bestDist = d;
      bestInterp = interp;
    }
  }

  return bestInterp;
}
