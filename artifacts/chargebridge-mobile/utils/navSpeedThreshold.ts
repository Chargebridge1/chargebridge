/**
 * Speed-adaptive step-advance threshold shared by the foreground GPS handler
 * (map.tsx) and the background navigation task (backgroundNav.ts).
 *
 * Mirrors the breakpoints in the foreground handler exactly, including the
 * Math.round() normalisation that converts raw m/s to an integer mph value
 * before comparing against the thresholds.  Both paths must call this helper
 * so a change to the breakpoints propagates to both simultaneously.
 *
 * Breakpoints (tuned so the advance happens ~2–3 s before the maneuver):
 *   > 50 mph → 65 m   (highway, ~29 m/tick at 1 Hz)
 *   > 30 mph → 50 m   (urban arterial)
 *   > 15 mph → 35 m   (residential / suburban)
 *   else     → 25 m   (slow / stationary)
 *
 * Walking and cycling overrides are handled by the foreground caller (which
 * has activity-type context); this helper covers motorised speeds only.
 *
 * @param speedMs  Raw speed in m/s as returned by expo-location
 *                 (LocationObject.coords.speed).  Pass `pos.speed ?? 0` or
 *                 `pos.coords.speed ?? 0` directly — null/undefined is
 *                 treated as 0 m/s.
 * @returns        Threshold in metres.
 */
export function navStepThreshold(speedMs: number): number {
  const speedMph = Math.round(speedMs * 2.237);
  return speedMph > 50 ? 65
       : speedMph > 30 ? 50
       : speedMph > 15 ? 35
       : 25;
}
