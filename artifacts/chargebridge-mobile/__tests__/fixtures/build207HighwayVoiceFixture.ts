/**
 * Deterministic replay of the Build #207 highway voice path.
 *
 * This is test-only code. It is not imported by the Expo app and does not
 * change production navigation behavior. The legacy arc function below is a
 * source-faithful transcription of commit 9062008, where routeArcDistM was
 * private to map.tsx and therefore not importable by a unit test.
 *
 * The fixture deliberately separates:
 *   - physical/straight distance,
 *   - the Build #207 computed route-arc distance,
 *   - navSpeak invocation,
 *   - app-level Speech.speak dispatch.
 *
 * It cannot measure native audible onset; the completion time is a deterministic
 * fake-adapter lifecycle value, not a measurement of AVSpeechSynthesizer.
 */

import {
  foregroundAdvanceStepIdx,
  haversineMeters,
  type LatLng,
} from "../../utils/navStepAdvance";
import {
  FORCED_SETTLE_MS,
  scheduleForcedSpeak,
} from "../../utils/navSpeakScheduler";
import { backgroundOffRouteTick, type OffRouteTickState } from "../../utils/navOffRouteDetect";
import { navOffRouteThreshold } from "../../utils/navOffRouteThreshold";
import type { NavZone } from "../../utils/navZoneLog";

export const BUILD_207_BASELINE_SHA = "9062008" as const;
export const HIGHWAY_SPEED_MPH = 65 as const;
export const HIGHWAY_SPEED_MS = HIGHWAY_SPEED_MPH / 2.237;
export const GPS_CADENCE_MS = 1_000 as const;
export const GPS_ACCURACY_M = 5 as const;
export const SIMULATED_TTS_DURATION_MS = 1_200 as const;

const METERS_PER_DEGREE_LAT = 111_320;
const ROUTE_SEGMENT_M = 200;
const MANEUVER_DISTANCE_M = 3_000;
const START_TIMESTAMP_MS = 1_700_000_000_000;

export interface HighwayVoiceTick {
  timestampMs: number;
  gpsAccuracyM: number;
  speedMs: number;
  vehiclePosition: LatLng;
  physicalDistanceToManeuverM: number;
  straightLineDistanceM: number;
  routeArcDistM: number;
  correctedRouteArcDistM: number;
  activeVoiceZone: NavZone | null;
  stepIdxBefore: number;
  stepIdxAfter: number;
  didAdvanceStep: boolean;
  didReroute: boolean;
}

export interface HighwayVoiceEvent {
  zone: NavZone;
  force: boolean;
  physicalDistanceToManeuverM: number;
  routeArcDistM: number;
  navSpeakAtMs: number;
  ttsDispatchAtMs: number | null;
  ttsCompletionAtMs: number | null;
  settleMs: number;
}

export interface Build207HighwayFixtureResult {
  baselineSha: typeof BUILD_207_BASELINE_SHA;
  speedMph: number;
  speedMs: number;
  gpsCadenceMs: number;
  gpsAccuracyM: number;
  routeGeometry: LatLng[];
  maneuver: LatLng;
  offRouteThresholdM: number;
  ticks: HighwayVoiceTick[];
  voiceEvents: HighwayVoiceEvent[];
  rerouteTimestampsMs: number[];
  expectedCorrectedA3DistanceM: number;
  build207A3DistanceM: number;
  preNavSpeakDelayM: number;
}

function north(origin: LatLng, metres: number): LatLng {
  return {
    latitude: origin.latitude + metres / METERS_PER_DEGREE_LAT,
    longitude: origin.longitude,
  };
}

/**
 * Exact Build #207 routeArcDistM behavior from map.tsx at 9062008.
 *
 * It first walks backward from the perpendicular interpolation to the segment
 * start, then forward again. On a long segment this double-counts the part of
 * the segment the vehicle has already travelled.
 */
function build207RouteArcDistM(
  polyline: LatLng[],
  fromIdx: number,
  fromInterp: LatLng,
  toCoord: LatLng,
): number {
  if (polyline.length === 0) return haversineMeters(fromInterp, toCoord);
  const clampedFrom = Math.max(0, Math.min(fromIdx, polyline.length - 1));
  const searchEnd = Math.min(polyline.length - 1, clampedFrom + 600);
  let toIdx = clampedFrom;
  let minDist = haversineMeters(polyline[clampedFrom], toCoord);
  for (let i = clampedFrom + 1; i <= searchEnd; i++) {
    const dist = haversineMeters(polyline[i], toCoord);
    if (dist < minDist) {
      minDist = dist;
      toIdx = i;
    }
  }
  let metres = haversineMeters(fromInterp, polyline[clampedFrom]);
  for (let i = clampedFrom; i < toIdx; i++) {
    metres += haversineMeters(polyline[i], polyline[i + 1]);
  }
  metres += haversineMeters(polyline[toIdx], toCoord);
  return metres;
}

/** Build #208's forward-only equivalent, retained only for boundary comparison. */
function correctedRouteArcDistM(
  polyline: LatLng[],
  fromIdx: number,
  fromInterp: LatLng,
  toCoord: LatLng,
): number {
  if (polyline.length === 0) return haversineMeters(fromInterp, toCoord);
  const clampedFrom = Math.max(0, Math.min(fromIdx, polyline.length - 1));
  const searchEnd = Math.min(polyline.length - 1, clampedFrom + 600);
  let toIdx = clampedFrom;
  let minDist = haversineMeters(polyline[clampedFrom], toCoord);
  for (let i = clampedFrom + 1; i <= searchEnd; i++) {
    const dist = haversineMeters(polyline[i], toCoord);
    if (dist < minDist) {
      minDist = dist;
      toIdx = i;
    }
  }
  if (toIdx <= clampedFrom) return haversineMeters(fromInterp, toCoord);
  let metres = haversineMeters(fromInterp, polyline[clampedFrom + 1]);
  for (let i = clampedFrom + 1; i < toIdx; i++) {
    metres += haversineMeters(polyline[i], polyline[i + 1]);
  }
  metres += haversineMeters(polyline[toIdx], toCoord);
  return metres;
}

function voiceZoneForBuild207(
  routeArcM: number,
  speedMs: number,
  announced: Set<NavZone>,
): NavZone | null {
  const timeToNextS = speedMs > 1.5 ? routeArcM / speedMs : 999;
  const a3Hi = timeToNextS < 13 && speedMs > 2
    ? routeArcM + 1
    : Math.min(500, Math.max(speedMs * 12, 60));
  const a2Hi = Math.min(1800, Math.max(speedMs * 44, 200));
  const a1Hi = Math.min(6000, Math.max(speedMs * 85, 400));

  if (routeArcM < a1Hi && routeArcM >= a2Hi && !announced.has("a1")) return "a1";
  if (routeArcM < a2Hi && routeArcM >= a3Hi && !announced.has("a2")) return "a2";
  if (routeArcM < a3Hi && routeArcM > 15 && !announced.has("a3")) return "a3";
  return null;
}

function segmentIndexFor(positionM: number, polylineLength: number): number {
  return Math.min(Math.floor(positionM / ROUTE_SEGMENT_M), polylineLength - 2);
}

/**
 * Run the controlled baseline replay. The final a3 forced speech dispatch is
 * scheduled through the real scheduleForcedSpeak() helper; callers using Jest
 * fake timers must advance timers by zero milliseconds before inspecting the
 * event's ttsDispatchAtMs field.
 */
export function runBuild207HighwayVoiceFixture(): Build207HighwayFixtureResult {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const routeGeometry = Array.from(
    { length: MANEUVER_DISTANCE_M / ROUTE_SEGMENT_M + 1 },
    (_, index) => north(origin, index * ROUTE_SEGMENT_M),
  );
  const maneuver = north(origin, MANEUVER_DISTANCE_M);
  const steps = [
    { coordinate: origin },
    { coordinate: maneuver },
  ];
  const announced = new Set<NavZone>();
  const ticks: HighwayVoiceTick[] = [];
  const voiceEvents: HighwayVoiceEvent[] = [];
  const rerouteTimestampsMs: number[] = [];
  const offRouteState: OffRouteTickState = {
    count: 0,
    startMs: 0,
    lastRecalcMs: Number.NEGATIVE_INFINITY,
  };
  const refs = {
    isSpeaking: { current: false },
    routeVersion: { current: 1 },
    isNavigating: { current: true },
    voiceMuted: { current: false },
  };
  let currentStepIdx = 0;
  let currentCompletionMs = 0;
  let correctedA3DistanceM: number | null = null;

  for (
    let second = 0;
    HIGHWAY_SPEED_MS * second <= MANEUVER_DISTANCE_M;
    second += 1
  ) {
    const timestampMs = START_TIMESTAMP_MS + second * GPS_CADENCE_MS;
    const positionM = HIGHWAY_SPEED_MS * second;
    const vehiclePosition = north(origin, positionM);
    const fromIdx = segmentIndexFor(positionM, routeGeometry.length);
    const routeArcM = build207RouteArcDistM(routeGeometry, fromIdx, vehiclePosition, maneuver);
    const correctedArcM = correctedRouteArcDistM(routeGeometry, fromIdx, vehiclePosition, maneuver);
    const physicalDistanceM = haversineMeters(vehiclePosition, maneuver);

    if (correctedA3DistanceM === null) {
      const correctedZone = voiceZoneForBuild207(correctedArcM, HIGHWAY_SPEED_MS, new Set<NavZone>());
      if (correctedZone === "a3") correctedA3DistanceM = physicalDistanceM;
    }

    if (timestampMs >= currentCompletionMs) refs.isSpeaking.current = false;
    const activeVoiceZone = voiceZoneForBuild207(routeArcM, HIGHWAY_SPEED_MS, announced);
    if (activeVoiceZone) {
      announced.add(activeVoiceZone);
      const event: HighwayVoiceEvent = {
        zone: activeVoiceZone,
        force: activeVoiceZone === "a3",
        physicalDistanceToManeuverM: physicalDistanceM,
        routeArcDistM: routeArcM,
        navSpeakAtMs: timestampMs,
        ttsDispatchAtMs: null,
        ttsCompletionAtMs: null,
        settleMs: 0,
      };

      if (activeVoiceZone === "a3") {
        let settleMs = 0;
        const scheduled = scheduleForcedSpeak(
          "Turn right onto Fixture Exit",
          refs.routeVersion.current,
          refs,
          {
            clearWatchdog: () => undefined,
            armWatchdog: () => undefined,
            stop: () => undefined,
            speak: () => {
              event.ttsDispatchAtMs = event.navSpeakAtMs + settleMs;
              event.ttsCompletionAtMs = (event.ttsDispatchAtMs ?? event.navSpeakAtMs)
                + SIMULATED_TTS_DURATION_MS;
              currentCompletionMs = event.ttsCompletionAtMs;
            },
            makeOpts: () => ({}),
            onTimerFired: () => undefined,
          },
        );
        settleMs = scheduled.settleMs;
        event.settleMs = settleMs;
      } else {
        refs.isSpeaking.current = true;
        event.ttsDispatchAtMs = timestampMs;
        event.ttsCompletionAtMs = timestampMs + SIMULATED_TTS_DURATION_MS;
        currentCompletionMs = event.ttsCompletionAtMs;
      }
      voiceEvents.push(event);
    }

    const stepIdxBefore = currentStepIdx;
    currentStepIdx = foregroundAdvanceStepIdx(
      currentStepIdx,
      steps,
      vehiclePosition,
      HIGHWAY_SPEED_MS,
    );
    const didReroute = backgroundOffRouteTick(
      vehiclePosition,
      HIGHWAY_SPEED_MS,
      false,
      false,
      1,
      routeGeometry,
      offRouteState,
      timestampMs,
    );
    if (didReroute) rerouteTimestampsMs.push(timestampMs);

    ticks.push({
      timestampMs,
      gpsAccuracyM: GPS_ACCURACY_M,
      speedMs: HIGHWAY_SPEED_MS,
      vehiclePosition,
      physicalDistanceToManeuverM: physicalDistanceM,
      straightLineDistanceM: physicalDistanceM,
      routeArcDistM: routeArcM,
      correctedRouteArcDistM: correctedArcM,
      activeVoiceZone,
      stepIdxBefore,
      stepIdxAfter: currentStepIdx,
      didAdvanceStep: currentStepIdx !== stepIdxBefore,
      didReroute,
    });

    if (currentStepIdx === 1) break;
  }

  const a3 = voiceEvents.find((event) => event.zone === "a3");
  if (!a3 || correctedA3DistanceM === null) {
    throw new Error("Controlled highway fixture did not reach a3 in both baseline and corrected paths.");
  }

  return {
    baselineSha: BUILD_207_BASELINE_SHA,
    speedMph: HIGHWAY_SPEED_MPH,
    speedMs: HIGHWAY_SPEED_MS,
    gpsCadenceMs: GPS_CADENCE_MS,
    gpsAccuracyM: GPS_ACCURACY_M,
    routeGeometry,
    maneuver,
    offRouteThresholdM: navOffRouteThreshold(HIGHWAY_SPEED_MS, false, false).offDistM,
    ticks,
    voiceEvents,
    rerouteTimestampsMs,
    expectedCorrectedA3DistanceM: correctedA3DistanceM,
    build207A3DistanceM: a3.physicalDistanceToManeuverM,
    preNavSpeakDelayM: correctedA3DistanceM - a3.physicalDistanceToManeuverM,
  };
}