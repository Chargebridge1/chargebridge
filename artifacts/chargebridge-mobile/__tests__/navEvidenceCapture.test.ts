import {
  armNextA3Capture,
  captureArmedA3,
  createNavEvidenceCaptureState,
  dispatchToCompletionMs,
  navSpeakToDispatchMs,
  recordEvidenceTtsDispatch,
  recordEvidenceTtsOutcome,
  resetNavEvidenceCaptureSession,
  type NavEvidenceA3Context,
} from "@/utils/navEvidenceCapture";

const CONTEXT: NavEvidenceA3Context = {
  gpsTimestampMs: 1_700_000_000_000,
  gpsReceivedAtMs: 1_700_000_000_180,
  gpsIntervalMs: 970,
  gpsFixAgeMs: 180,
  latitude: 33.942501,
  longitude: -118.408056,
  accuracyM: 4.2,
  speedMs: 29.06,
  routeArcDistanceM: 346.7,
  straightDistanceM: 280.4,
  maneuverLatitude: 33.940001,
  maneuverLongitude: -118.400001,
  maneuverInstruction: "Turn right onto CA-1 South",
  stepIndex: 7,
  routeVersion: 3,
  zone: "a3",
};

describe("nav evidence capture", () => {
  it("records nothing until the tester arms the next a3", () => {
    const initial = createNavEvidenceCaptureState();
    expect(captureArmedA3(initial, CONTEXT, 1_700_000_001_000, true)).toBe(initial);
  });

  it("does not execute while navigation is inactive or mutate navigation inputs", () => {
    const armed = armNextA3Capture(createNavEvidenceCaptureState());
    const sourceState = { ...armed };
    const sourceContext = { ...CONTEXT };

    expect(captureArmedA3(armed, CONTEXT, 1_700_000_001_000, false)).toBe(armed);
    expect(armed).toEqual(sourceState);
    expect(CONTEXT).toEqual(sourceContext);
  });

  it("copies the exact a3 context once and preserves it through TTS updates", () => {
    const armed = armNextA3Capture(createNavEvidenceCaptureState());
    const captured = captureArmedA3(armed, CONTEXT, 1_700_000_001_000, true);

    expect(captured.armed).toBe(false);
    expect(captured.record).toMatchObject({
      ...CONTEXT,
      captureToken: 1,
      navSpeakAtMs: 1_700_000_001_000,
      ttsDispatchAtMs: null,
      ttsCompletedAtMs: null,
      ttsOutcome: null,
    });

    const dispatched = recordEvidenceTtsDispatch(captured, 1, 1_700_000_001_120);
    const completed = recordEvidenceTtsOutcome(dispatched, 1, 1_700_000_003_400, "completed");

    expect(navSpeakToDispatchMs(completed.record!)).toBe(120);
    expect(dispatchToCompletionMs(completed.record!)).toBe(2_280);
    expect(completed.record).toMatchObject({
      ...CONTEXT,
      captureToken: 1,
      navSpeakAtMs: 1_700_000_001_000,
      ttsDispatchAtMs: 1_700_000_001_120,
      ttsCompletedAtMs: 1_700_000_003_400,
      ttsOutcome: "completed",
    });
  });

  it("rejects stale callbacks and cannot arm a second record in the same session", () => {
    const captured = captureArmedA3(
      armNextA3Capture(createNavEvidenceCaptureState()),
      CONTEXT,
      1_700_000_001_000,
      true,
    );

    expect(recordEvidenceTtsDispatch(captured, 2, 1_700_000_001_120)).toBe(captured);
    expect(recordEvidenceTtsOutcome(captured, 1, 1_700_000_003_400, "completed")).toBe(captured);
    expect(armNextA3Capture(captured)).toBe(captured);

    const dispatched = recordEvidenceTtsDispatch(captured, 1, 1_700_000_001_120);
    const completed = recordEvidenceTtsOutcome(dispatched, 1, 1_700_000_003_400, "error");
    expect(recordEvidenceTtsOutcome(completed, 1, 1_700_000_004_000, "completed")).toBe(completed);
  });

  it("records a synchronous Speech invocation failure without claiming a dispatch", () => {
    const captured = captureArmedA3(
      armNextA3Capture(createNavEvidenceCaptureState()),
      CONTEXT,
      1_700_000_001_000,
      true,
    );
    const errored = recordEvidenceTtsOutcome(captured, 1, 1_700_000_001_001, "error");

    expect(errored.record).toMatchObject({
      captureToken: 1,
      ttsDispatchAtMs: null,
      ttsCompletedAtMs: 1_700_000_001_001,
      ttsOutcome: "error",
    });
    expect(recordEvidenceTtsOutcome(captured, 1, 1_700_000_001_001, "completed")).toBe(captured);
  });

  it("allows a fresh, unarmed diagnostic session after navigation restarts", () => {
    const captured = captureArmedA3(
      armNextA3Capture(createNavEvidenceCaptureState()),
      CONTEXT,
      1_700_000_001_000,
      true,
    );
    const reset = resetNavEvidenceCaptureSession(captured);

    expect(reset).toEqual({ armed: false, nextCaptureToken: 2, record: null });
    expect(armNextA3Capture(reset).armed).toBe(true);
  });
});