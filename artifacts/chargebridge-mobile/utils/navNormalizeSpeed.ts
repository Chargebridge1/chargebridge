/**
 * Normalize a raw GPS speed reading to a safe number.
 *
 * iOS and Android GPS occasionally omit the speed field, returning null.
 * expo-location types `LocationObject.coords.speed` as `number | null`.
 * Passing null or undefined directly into arithmetic (e.g. null * 2.237)
 * produces 0 for null (JS coerces null to 0) but NaN for undefined, making
 * navStepThreshold comparisons unreliable and the fallback bucket implicit.
 *
 * Using this helper in every caller makes the fallback to 0 m/s (stationary
 * bucket, 25 m threshold) explicit and uniform regardless of whether the GPS
 * platform returns null or omits the field entirely.
 *
 * Called in:
 *   - tasks/backgroundNav.ts  (pos.speed → normalizeSpeed)
 *   - utils/navStepAdvance.ts  (speedMs parameter contract documented here)
 *
 * @param speed  Raw GPS speed in m/s as returned by expo-location
 *               (LocationObject.coords.speed).  May be null or undefined.
 * @returns      Speed in m/s, guaranteed to be a finite number ≥ 0.
 */
export function normalizeSpeed(speed: number | null | undefined): number {
  return speed ?? 0;
}
