/**
 * Speed-adaptive off-route detection thresholds shared by the foreground GPS
 * handler (map.tsx) and any background path that performs off-route checks.
 *
 * Mirrors the inline breakpoints in map.tsx exactly, including the Math.round()
 * normalisation that converts raw m/s to an integer mph value before comparing
 * against the thresholds.  Extracting them here means a change to any breakpoint
 * propagates to both the foreground and background simultaneously — a drift
 * between the two paths now causes the integration tests to fail.
 *
 * Breakpoints (motorised, sensitivity = 1.0):
 *   > 50 mph → 55 m distance / 3 readings / 4 s min  (highway)
 *   > 25 mph → 65 m distance / 4 readings / 5 s min  (urban)
 *   else     → 80 m distance / 5 readings / 7 s min  (slow / stationary)
 *
 * Walking: 95 m / 4 readings    Cycling: 85 m / 4 readings
 *
 * Walking and cycling thresholds are intentionally LARGER than the slowest
 * motorised bucket (80 m) because pedestrians and cyclists naturally deviate
 * from road-centred routes via footpaths and cycle lanes.  A wider cross-track
 * distance prevents false-positive reroutes on these modes.
 * Cooldown (time between reroutes): > 40 mph → 25 s, else → 35 s
 *
 * @param speedMs     Raw speed in m/s (LocationObject.coords.speed). Pass
 *                    `pos.coords.speed ?? 0` — null/undefined treated as 0.
 * @param isWalking   True when the active transport mode is walking.
 * @param isCycling   True when the active transport mode is cycling.
 * @param sensitivity Multiplier applied to offDistM (recalcSensitivity, default
 *                    1.0).  Must be clamped to [0.5, 2.0] by the caller before
 *                    passing here.
 * @returns Object with all four threshold values needed by the off-route check.
 */
export interface NavOffRouteThresholds {
  /** Perpendicular distance from the route polyline that counts as "off-route". */
  offDistM: number;
  /** Number of consecutive GPS readings that must exceed offDistM. */
  offCount: number;
  /** Minimum ms between two consecutive reroutes (cooldown). */
  offCooldown: number;
  /** Minimum wall-clock ms the user must be continuously off-route. */
  minOffRouteMs: number;
}

export function navOffRouteThreshold(
  speedMs: number,
  isWalking: boolean,
  isCycling: boolean,
  sensitivity = 1.0,
): NavOffRouteThresholds {
  const speedMph = Math.round(speedMs * 2.237);

  const rawDistM = isWalking   ? 95
                 : isCycling   ? 85
                 : speedMph > 50 ? 55
                 : speedMph > 25 ? 65
                 :               80;

  const offDistM    = Math.round(rawDistM * sensitivity);
  const offCount    = isWalking || isCycling ? 4
                    : speedMph > 50          ? 3
                    : speedMph > 25          ? 4
                    :                          5;
  const offCooldown = speedMph > 40 ? 25_000 : 35_000;
  const minOffRouteMs = speedMph > 50 ? 4_000
                      : speedMph > 25 ? 5_000
                      :                 7_000;

  return { offDistM, offCount, offCooldown, minOffRouteMs };
}
