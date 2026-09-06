/**
 * Step-advance helpers shared between the foreground GPS handler (map.tsx)
 * and the background navigation task (backgroundNav.ts).
 *
 * Extracting these into a testable module ensures that any change to the
 * advance condition or threshold in either caller is caught by the integration
 * tests in __tests__/backgroundNavThreshold.test.ts.
 *
 * Design notes:
 *  - foregroundAdvanceStepIdx advances AT MOST one step per GPS tick (the
 *    foreground handler owns sequential step updates and fires voice).
 *  - backgroundAdvanceStepIdx advances through ALL consecutive in-threshold
 *    steps in a single location update (batched background locations can jump
 *    multiple steps at once; a while-loop ensures the notification reflects the
 *    current furthest-reached step).
 *
 * Both use navStepThreshold() for the motorised distance boundary so a change
 * to that helper propagates identically to both callers.
 */

import { navStepThreshold } from "@/utils/navSpeedThreshold";

export type LatLng = { latitude: number; longitude: number };
export type NavStep = { coordinate: LatLng };

/**
 * Haversine distance in metres between two WGS-84 coordinates.
 * Exported so callers (backgroundNav.ts, map.tsx) and tests all use the
 * same implementation.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Compute the step-advance / missed-turn distance threshold for the current
 * navigation mode.  This is the single source of truth for:
 *   - foregroundAdvanceStepIdx   (step-advance gate in map.tsx)
 *   - the missed-turn zone calc  (map.tsx: nearZone = threshold × 3.5,
 *                                          wasCloseZone = threshold × 1.5)
 *
 * Walking:  20 m  (pedestrian pace)
 * Cycling:  25 m  (bike pace)
 * Motorised: speed-adaptive via navStepThreshold() (25–65 m)
 */
export function navMissedTurnThreshold(
  speedMs: number,
  isWalking = false,
  isCycling = false,
): number {
  return isWalking ? 20 : isCycling ? 25 : navStepThreshold(speedMs);
}

/**
 * Foreground step-advance: returns the new step index after at most ONE
 * advance (matching the foreground GPS handler in map.tsx which processes
 * one GPS tick at a time and fires voice for each step sequentially).
 *
 * @param currentIdx  Current step index (navState.currentStepIdx)
 * @param steps       Full route step array
 * @param loc         Current GPS coordinate
 * @param speedMs     GPS speed in m/s (coords.speed ?? 0)
 * @param isWalking   True when the navigation mode is walking
 * @param isCycling   True when the navigation mode is cycling
 * @returns           New step index (unchanged if no advance)
 */
export function foregroundAdvanceStepIdx(
  currentIdx: number,
  steps: NavStep[],
  loc: LatLng,
  speedMs: number,
  isWalking = false,
  isCycling = false,
): number {
  const next = currentIdx + 1;
  if (next >= steps.length) return currentIdx;
  const distM = haversineMeters(loc, steps[next].coordinate);
  const threshold = navMissedTurnThreshold(speedMs, isWalking, isCycling);
  return distM < threshold ? next : currentIdx;
}

/**
 * Background step-advance: returns the new step index after advancing
 * through ALL consecutive steps whose maneuver points are within the
 * activity-aware threshold (matching the while-loop in backgroundNav.ts).
 *
 * Walking and cycling sessions use the same fixed thresholds as the
 * foreground handler (20 m and 25 m respectively).  Motorised sessions
 * remain speed-adaptive via navStepThreshold() (25–65 m).
 *
 * The background task reads isWalking/isCycling from navState.travelMode
 * and passes them here so a background location update during a walking
 * session does not erroneously use a 25–65 m motorised threshold.
 *
 * @param currentIdx  Current step index (navState.currentStepIdx)
 * @param steps       Full route step array
 * @param loc         Current GPS coordinate
 * @param speedMs     GPS speed in m/s (pos.speed ?? 0)
 * @param isWalking   True when the navigation mode is walking
 * @param isCycling   True when the navigation mode is cycling
 * @returns           New step index (may advance by more than one)
 */
export function backgroundAdvanceStepIdx(
  currentIdx: number,
  steps: NavStep[],
  loc: LatLng,
  speedMs: number,
  isWalking = false,
  isCycling = false,
): number {
  const threshold = navMissedTurnThreshold(speedMs, isWalking, isCycling);
  let idx = currentIdx;
  while (idx + 1 < steps.length) {
    const d = haversineMeters(loc, steps[idx + 1].coordinate);
    if (d < threshold) idx++;
    else break;
  }
  return idx;
}
