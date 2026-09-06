/**
 * Background off-route detection tick helper.
 *
 * Extracted from backgroundNav.ts so the detection logic is independently
 * testable without importing expo-task-manager or React Native modules.
 *
 * Both the foreground GPS handler (map.tsx) and the background location task
 * (backgroundNav.ts) call navOffRouteThreshold() for their distance/count
 * boundaries; this helper encapsulates the stateful counting logic that the
 * background task uses so that any change to the detection condition is
 * visible to the integration tests in __tests__/backgroundNavOffRoute.test.ts.
 *
 * Design mirrors the step-advance helpers in navStepAdvance.ts: stateful data
 * is passed in as a mutable `state` object that the caller persists across
 * ticks (stored in navState for the background task).
 */

import { haversineMeters, LatLng } from "@/utils/navStepAdvance";
import { closestPointOnPolyline } from "@/utils/navPolyline";
import { navOffRouteThreshold } from "@/utils/navOffRouteThreshold";

export type { LatLng };

/**
 * Mutable per-session state for the background off-route counter.
 * Stored in navState and reset when navigation starts or a new route loads.
 */
export interface OffRouteTickState {
  /** Number of consecutive GPS readings that exceeded offDistM. */
  count: number;
  /** Timestamp (ms) of the first reading in the current off-route streak. */
  startMs: number;
  /** Timestamp (ms) of the last background-triggered reroute (cooldown gate). */
  lastRecalcMs: number;
}

/**
 * Consume the background off-route signal exactly once on an active-transition.
 *
 * When the app returns to the foreground, the AppState "active" handler calls
 * this function.  If the background task recorded `offRouteDetected = true`
 * while the app was backgrounded, this function clears the flag and invokes
 * `onReroute` — which should trigger the established foreground reroute fetch.
 * The flag is cleared BEFORE calling `onReroute` so that a racing background
 * tick arriving between the clear and the fetch start does not see a stale
 * signal.
 *
 * @param state      Object with an `offRouteDetected` boolean field (navState).
 * @param onReroute  Callback invoked when the signal was set.  Should initiate
 *                   the foreground reroute fetch.
 * @returns          True if the signal was consumed and `onReroute` was called.
 */
export function consumeBgOffRoute(
  state: { offRouteDetected: boolean },
  onReroute: () => void,
): boolean {
  if (!state.offRouteDetected) return false;
  state.offRouteDetected = false; // clear before callback to prevent double-trigger
  onReroute();
  return true;
}

/**
 * Process one GPS location tick for background off-route detection.
 *
 * Finds the perpendicular distance from `loc` to the nearest segment of
 * `routeCoords`, then applies the same speed-adaptive thresholds as the
 * foreground GPS handler (both call navOffRouteThreshold()).  Mutates
 * `state` in place so the caller can persist the counter across ticks.
 *
 * @param loc          Current GPS coordinate.
 * @param speedMs      GPS speed in m/s (coords.speed ?? 0).
 * @param isWalking    True when travelMode is "walking".
 * @param isCycling    True when travelMode is "cycling".
 * @param sensitivity  Recalc sensitivity multiplier (1.0 in background — the
 *                     adaptive learning is foreground-only).
 * @param routeCoords  Full route polyline.  Must have ≥ 2 points.
 * @param state        Mutable counter state (persisted in navState).
 * @param nowMs        Current timestamp in milliseconds (Date.now()).
 * @returns            True when the reroute condition has been met this tick.
 */
export function backgroundOffRouteTick(
  loc: LatLng,
  speedMs: number,
  isWalking: boolean,
  isCycling: boolean,
  sensitivity: number,
  routeCoords: LatLng[],
  state: OffRouteTickState,
  nowMs: number,
): boolean {
  if (routeCoords.length < 2) return false;

  const interp = closestPointOnPolyline(routeCoords, loc);
  const distToPolyM = haversineMeters(loc, interp);
  const { offDistM, offCount, offCooldown, minOffRouteMs } =
    navOffRouteThreshold(speedMs, isWalking, isCycling, sensitivity);

  if (distToPolyM > offDistM) {
    if (state.count === 0) state.startMs = nowMs;
    state.count += 1;
  } else {
    state.count = 0;
    state.startMs = 0;
  }

  if (
    state.count >= offCount &&
    nowMs - state.startMs >= minOffRouteMs &&
    nowMs - state.lastRecalcMs > offCooldown
  ) {
    state.count = 0;
    state.lastRecalcMs = nowMs;
    return true;
  }

  return false;
}
