export type NavEvidenceTtsOutcome = "completed" | "stopped" | "error";

export interface NavEvidenceA3Context {
  gpsTimestampMs: number;
  gpsReceivedAtMs: number;
  gpsIntervalMs: number;
  gpsFixAgeMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMs: number | null;
  routeArcDistanceM: number;
  straightDistanceM: number;
  maneuverLatitude: number;
  maneuverLongitude: number;
  maneuverInstruction: string;
  stepIndex: number;
  routeVersion: number;
  zone: "a3";
}

export interface NavEvidenceCaptureRecord extends NavEvidenceA3Context {
  captureToken: number;
  navSpeakAtMs: number;
  ttsDispatchAtMs: number | null;
  ttsCompletedAtMs: number | null;
  ttsOutcome: NavEvidenceTtsOutcome | null;
}

export interface NavEvidenceCaptureState {
  armed: boolean;
  nextCaptureToken: number;
  record: NavEvidenceCaptureRecord | null;
}

export function createNavEvidenceCaptureState(): NavEvidenceCaptureState {
  return { armed: false, nextCaptureToken: 1, record: null };
}

export function resetNavEvidenceCaptureSession(
  state: NavEvidenceCaptureState,
): NavEvidenceCaptureState {
  return {
    armed: false,
    nextCaptureToken: state.nextCaptureToken,
    record: null,
  };
}

export function armNextA3Capture(
  state: NavEvidenceCaptureState,
): NavEvidenceCaptureState {
  if (state.armed || state.record) return state;
  return { ...state, armed: true };
}

export function captureArmedA3(
  state: NavEvidenceCaptureState,
  context: NavEvidenceA3Context,
  navSpeakAtMs: number,
  isNavigationActive: boolean,
): NavEvidenceCaptureState {
  if (!isNavigationActive || !state.armed || state.record) return state;

  const captureToken = state.nextCaptureToken;
  return {
    armed: false,
    nextCaptureToken: captureToken + 1,
    record: {
      ...context,
      captureToken,
      navSpeakAtMs,
      ttsDispatchAtMs: null,
      ttsCompletedAtMs: null,
      ttsOutcome: null,
    },
  };
}

export function navSpeakToDispatchMs(
  record: NavEvidenceCaptureRecord,
): number | null {
  return record.ttsDispatchAtMs == null
    ? null
    : record.ttsDispatchAtMs - record.navSpeakAtMs;
}

export function dispatchToCompletionMs(
  record: NavEvidenceCaptureRecord,
): number | null {
  return record.ttsDispatchAtMs == null || record.ttsCompletedAtMs == null
    ? null
    : record.ttsCompletedAtMs - record.ttsDispatchAtMs;
}

export function recordEvidenceTtsDispatch(
  state: NavEvidenceCaptureState,
  captureToken: number,
  ttsDispatchAtMs: number,
): NavEvidenceCaptureState {
  if (!state.record || state.record.captureToken !== captureToken || state.record.ttsDispatchAtMs != null) {
    return state;
  }

  return {
    ...state,
    record: { ...state.record, ttsDispatchAtMs },
  };
}

export function recordEvidenceTtsOutcome(
  state: NavEvidenceCaptureState,
  captureToken: number,
  ttsCompletedAtMs: number,
  ttsOutcome: NavEvidenceTtsOutcome,
): NavEvidenceCaptureState {
  if (
    !state.record
    || state.record.captureToken !== captureToken
    || state.record.ttsCompletedAtMs != null
    || (state.record.ttsDispatchAtMs == null && ttsOutcome !== "error")
  ) {
    return state;
  }

  return {
    ...state,
    record: { ...state.record, ttsCompletedAtMs, ttsOutcome },
  };
}