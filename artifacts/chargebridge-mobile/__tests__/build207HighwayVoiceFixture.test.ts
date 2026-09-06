/**
 * Controlled Build #207 voice-timing characterization.
 *
 * This suite does not mount MapScreen or talk to a device. It replays a
 * deterministic, on-route 65 mph highway approach to isolate where the
 * application invokes navSpeak and where the app-level TTS scheduler dispatches.
 */

import {
  BUILD_207_BASELINE_SHA,
  GPS_ACCURACY_M,
  GPS_CADENCE_MS,
  HIGHWAY_SPEED_MPH,
  SIMULATED_TTS_DURATION_MS,
  runBuild207HighwayVoiceFixture,
} from "./fixtures/build207HighwayVoiceFixture";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("controlled Build #207 highway voice fixture", () => {
  it("pins the requested Build #207 source baseline and deterministic GPS inputs", () => {
    const result = runBuild207HighwayVoiceFixture();

    expect(result.baselineSha).toBe(BUILD_207_BASELINE_SHA);
    expect(result.speedMph).toBe(HIGHWAY_SPEED_MPH);
    expect(result.gpsCadenceMs).toBe(GPS_CADENCE_MS);
    expect(result.gpsAccuracyM).toBe(GPS_ACCURACY_M);
    expect(result.routeGeometry).toHaveLength(16); // 0 m → 3,000 m in 200 m segments
    expect(result.rerouteTimestampsMs).toEqual([]); // every deterministic GPS fix is on-route
  });

  it("records a1/a2/a3, step advance, navSpeak, dispatch, and fake-adapter completion", () => {
    const result = runBuild207HighwayVoiceFixture();
    jest.advanceTimersByTime(0); // dispatch the real scheduleForcedSpeak() zero-settle timer

    expect(result.voiceEvents.map((event) => event.zone)).toEqual(["a1", "a2", "a3"]);
    expect(result.ticks.some((tick) => tick.didAdvanceStep)).toBe(true);

    for (const event of result.voiceEvents) {
      expect(event.navSpeakAtMs).toEqual(expect.any(Number));
      expect(event.ttsDispatchAtMs).toEqual(expect.any(Number));
      expect(event.ttsCompletionAtMs).toEqual(
        (event.ttsDispatchAtMs as number) + SIMULATED_TTS_DURATION_MS,
      );
    }
  });

  it("establishes the boundary: the synthetic Build #207 replay is PRE-NAVSPEAK, not app-level post-dispatch delay", () => {
    const result = runBuild207HighwayVoiceFixture();
    jest.advanceTimersByTime(0);
    const a3 = result.voiceEvents.find((event) => event.zone === "a3");

    expect(a3).toBeDefined();
    expect(a3?.ttsDispatchAtMs).toBe(a3?.navSpeakAtMs);
    expect(a3?.settleMs).toBe(0);
    expect(result.preNavSpeakDelayM).toBeGreaterThan(140);
    expect(result.preNavSpeakDelayM).toBeLessThan(180);
  });

  /**
   * Historical red test: this asserts the intended a3 boundary against the
   * Build #207 algorithm. It is deliberately marked `failing` so CI stays
   * green while preserving the exact pre-correction expectation. It must not
   * be promoted to the final production regression until a real incident route
   * supplies its GPS trace/geometry and the causal production condition is known.
   */
  it.failing("historical regression: a3 should fire on the first 13-second lead-time GPS tick", () => {
    const result = runBuild207HighwayVoiceFixture();
    expect(result.build207A3DistanceM).toBeGreaterThanOrEqual(result.expectedCorrectedA3DistanceM - 1);
  });
});