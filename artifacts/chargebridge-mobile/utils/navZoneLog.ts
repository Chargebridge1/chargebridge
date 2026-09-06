/**
 * navZoneLog.ts
 *
 * Pure utilities for the [NavVoice][TRACE] zone announce log lines emitted by
 * the foreground GPS handler in map.tsx.
 *
 * Extracting them here allows:
 *   - Unit tests to import and exercise the real guard + format logic.
 *   - The format strings and the `nextIdx < steps.length` guard to be covered
 *     by tests; any change to either causes the test suite to fail before the
 *     build reaches TestFlight.
 *
 * Zone log lines covered (map.tsx at time of writing):
 *   ~3847  zone=a1  [NavVoice][TRACE] routeVersion=…  stepIdx=…  maneuver=…
 *   ~3865  zone=a2  [NavVoice][TRACE] routeVersion=…  stepIdx=…  maneuver=…
 *   ~3873  zone=a3  [NavVoice][TRACE] routeVersion=…  stepIdx=…  maneuver=…
 */

/** Subset of RouteStep fields needed for zone logging. */
export interface NavZoneStep {
  instruction: string;
}

export type NavZone = "a1" | "a2" | "a3";

/**
 * Builds the [NavVoice][TRACE] zone announce log line, or returns `null` when
 * there is no next step to announce (guard: `nextIdx < steps.length`).
 *
 * This mirrors the production guard in map.tsx:
 *
 *   const nextIdx = curIdx + 1;
 *   if (nextIdx < steps.length) {
 *     ...
 *     console.log(`[NavVoice][TRACE] routeVersion=… stepIdx=${nextIdx} maneuver="…" …`);
 *   }
 *
 * @param steps        The current route step array (routeStepsRef.current in map.tsx).
 * @param curIdx       The current step index (navState.currentStepIdx).
 * @param distToNextM  Pre-computed distance in metres to the next step waypoint.
 * @param zone         Which announce zone fired ("a1" | "a2" | "a3").
 * @param routeVersion The current route version counter (routeVersionRef.current).
 * @param gpsTs        GPS timestamp (LocationObject.timestamp).
 * @param zoneTs       Wall-clock ms at the moment the zone fired (Date.now()).
 * @returns The formatted log string, or `null` if the guard prevents logging.
 */
export function buildNavZoneLogLine(
  steps: NavZoneStep[],
  curIdx: number,
  distToNextM: number,
  zone: NavZone,
  routeVersion: number,
  gpsTs: number,
  zoneTs: number,
): string | null {
  const nextIdx = curIdx + 1;
  if (nextIdx >= steps.length) return null; // mirrors: if (nextIdx < steps.length)
  return (
    `[NavVoice][TRACE] routeVersion=${routeVersion} stepIdx=${nextIdx}` +
    ` maneuver="${steps[nextIdx].instruction.slice(0, 50)}"` +
    ` dist=${Math.round(distToNextM)}m` +
    ` zone=${zone} gpsTs=${gpsTs} zoneTs=${zoneTs}`
  );
}

/**
 * Builds the [NavVoice][TRACE] navSpeak log line.
 *
 * Mirrors the production format in map.tsx ~2514:
 *   `[NavVoice][TRACE] navSpeak t=… force=… routeVersion=… stepIdx=… text="…"`
 *
 * @param t            Wall-clock ms when navSpeak was called (Date.now()).
 * @param force        Whether the speak call is forced (a3 near-turn interrupt).
 * @param routeVersion Captured routeVersionRef.current at call time.
 * @param stepIdx      Captured navVoiceTraceRef.current.stepIdx at call time.
 * @param text         The utterance text passed to Speech.speak().
 */
export function buildNavSpeakLogLine(
  t: number,
  force: boolean,
  routeVersion: number,
  stepIdx: number,
  text: string,
): string {
  return (
    `[NavVoice][TRACE] navSpeak t=${t} force=${force}` +
    ` routeVersion=${routeVersion} stepIdx=${stepIdx}` +
    ` text="${text.slice(0, 60)}"`
  );
}
