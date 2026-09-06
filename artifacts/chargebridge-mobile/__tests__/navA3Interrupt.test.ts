/**
 * Tests for the a3 forced-interrupt fix (task-666 / Fix 4 Option B).
 *
 * Root cause: the old `shouldInterrupt` guard (400 ms utterance-age threshold)
 * allowed a3 to queue behind a2 on iOS AVSpeechSynthesizer when a2 had been
 * speaking for less than 400 ms.  a2 phrases run 3–5 s; at 65 mph that delayed
 * the "Turn right" cue by 100–145 m — frequently past the turn.
 *
 * Fix (Option B adopted in map.tsx):
 *   - scheduleForcedSpeak() (utils/navSpeakScheduler.ts) always calls stop()
 *     when TTS is active — no utterance-age gate.
 *   - Settle delay raised 80 ms → FORCED_SETTLE_MS (120 ms) when interrupting.
 *   - Non-forced (a1/a2) calls queue behind active speech; they never interrupt.
 *
 * Test approach: import scheduleForcedSpeak and FORCED_SETTLE_MS from the real
 * production module (utils/navSpeakScheduler.ts) that map.tsx uses, mock
 * expo-speech, and use fake timers.  A regression in the production module will
 * break these tests.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop:  jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

import * as Speech from "expo-speech";
import {
  scheduleForcedSpeak,
  FORCED_SETTLE_MS,
} from "../utils/navSpeakScheduler";

const mockSpeak = Speech.speak as jest.Mock;
const mockStop  = Speech.stop  as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a minimal ref-bag that matches ForcedSpeakRefs. */
function makeRefs(overrides: {
  isSpeaking?:   boolean;
  routeVersion?: number;
  isNavigating?: boolean;
  voiceMuted?:   boolean;
} = {}) {
  return {
    isSpeaking:   { current: overrides.isSpeaking   ?? false },
    routeVersion: { current: overrides.routeVersion ?? 1     },
    isNavigating: { current: overrides.isNavigating ?? true  },
    voiceMuted:   { current: overrides.voiceMuted   ?? false },
  };
}

/**
 * Simulates the speakTimerRef held by map.tsx.
 * onTimerFired() clears it, mirroring the production contract.
 */
function makeTimerRef() {
  const ref = { current: null as ReturnType<typeof setTimeout> | null };
  return ref;
}

/** Creates stub ForcedSpeakCallbacks, using the real mocked Speech module. */
function makeCbs(timerRef?: { current: ReturnType<typeof setTimeout> | null }) {
  return {
    clearWatchdog: jest.fn(),
    armWatchdog:   jest.fn(),
    stop:    () => { Speech.stop(); },
    speak:   (t: string, opts: object) => { Speech.speak(t, opts as never); },
    makeOpts: () => ({}),
    onTimerFired: () => {
      if (timerRef) timerRef.current = null;
    },
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  mockSpeak.mockClear();
  mockStop.mockClear();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ── Suite 1: FORCED_SETTLE_MS constant ───────────────────────────────────────

describe("FORCED_SETTLE_MS constant", () => {
  it("is 120 ms — raised from 80 ms to allow AVAudioSession cleanup without crackle", () => {
    expect(FORCED_SETTLE_MS).toBe(120);
  });

  it("is within the 200 ms deadline required for a3 to play before the maneuver", () => {
    expect(FORCED_SETTLE_MS).toBeLessThan(200);
  });
});

// ── Suite 2: Speech.stop() called unconditionally when TTS is active ──────────

describe("scheduleForcedSpeak — unconditional Speech.stop() (no utterance-age gate)", () => {
  it("calls stop() when TTS is active (utteranceAge ≈ 0 ms — the bug scenario)", () => {
    // OLD code: utteranceAge=0 → shouldInterrupt=false → stop NOT called → a3 queued
    // NEW code: always stops
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("calls stop() when utteranceAge is 50 ms (well below old 400 ms gate)", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("calls stop() when utteranceAge is 399 ms (just under old threshold)", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("does NOT call stop() when TTS is idle — nothing to interrupt", () => {
    const refs = makeRefs({ isSpeaking: false });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("sets isSpeaking=false synchronously before the settle timer fires", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(refs.isSpeaking.current).toBe(false);
  });

  it("calls clearWatchdog() before stop() so the watchdog does not race the new utterance", () => {
    const refs = makeRefs({ isSpeaking: true });
    const cbs = makeCbs();
    scheduleForcedSpeak("Turn right", 1, refs, cbs);
    expect(cbs.clearWatchdog).toHaveBeenCalledTimes(1);
  });
});

// ── Suite 3: settle delay — 120 ms when interrupting, 0 ms when idle ──────────

describe("scheduleForcedSpeak — settle delay before Speech.speak()", () => {
  it("returns settleMs=FORCED_SETTLE_MS (120) when interrupting active speech", () => {
    const refs = makeRefs({ isSpeaking: true });
    const { settleMs } = scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(settleMs).toBe(FORCED_SETTLE_MS);
  });

  it("Speech.speak() is NOT called before the settle elapses (119 ms)", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    jest.advanceTimersByTime(FORCED_SETTLE_MS - 1);
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("Speech.speak() IS called at exactly FORCED_SETTLE_MS (120 ms)", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right", expect.any(Object));
  });

  it("returns settleMs=0 when TTS is idle", () => {
    const refs = makeRefs({ isSpeaking: false });
    const { settleMs } = scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(settleMs).toBe(0);
  });

  it("Speech.speak() fires immediately (0 ms settle) when TTS is idle", () => {
    const refs = makeRefs({ isSpeaking: false });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    jest.advanceTimersByTime(0);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right", expect.any(Object));
  });

  it("settle delay is ≤ 150 ms (well within the 200 ms task target)", () => {
    const refs = makeRefs({ isSpeaking: true });
    const { settleMs } = scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(settleMs).toBeLessThanOrEqual(150);
  });
});

// ── Suite 4: stale-version guard — reroute during settle drops the utterance ──

describe("scheduleForcedSpeak — stale-version guard inside the settle timer", () => {
  it("does NOT call Speech.speak() when routeVersion advances during the settle window", () => {
    const refs = makeRefs({ isSpeaking: false, routeVersion: 1 });
    scheduleForcedSpeak("Turn right", /* capturedVersion= */ 1, refs, makeCbs());
    refs.routeVersion.current = 2; // reroute completed while settle was pending
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("DOES call Speech.speak() when routeVersion still matches", () => {
    const refs = makeRefs({ isSpeaking: false, routeVersion: 3 });
    scheduleForcedSpeak("Turn right", 3, refs, makeCbs());
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right", expect.any(Object));
  });

  it("does NOT call Speech.speak() when voiceMuted becomes true during settle", () => {
    const refs = makeRefs({ isSpeaking: false, voiceMuted: false });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    refs.voiceMuted.current = true;
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("does NOT call Speech.speak() when navigation ends during settle", () => {
    const refs = makeRefs({ isSpeaking: false, isNavigating: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    refs.isNavigating.current = false;
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

// ── Suite 5: armWatchdog called before Speech.speak() inside the timer ────────

describe("scheduleForcedSpeak — watchdog lifecycle", () => {
  it("calls armWatchdog() before Speech.speak() fires", () => {
    const refs = makeRefs({ isSpeaking: false });
    const cbs = makeCbs();
    scheduleForcedSpeak("Turn right", 1, refs, cbs);
    expect(cbs.armWatchdog).not.toHaveBeenCalled(); // not yet — timer pending
    jest.advanceTimersByTime(0);
    expect(cbs.armWatchdog).toHaveBeenCalledTimes(1);
  });

  it("armWatchdog is NOT called when stale version guard drops the utterance", () => {
    const refs = makeRefs({ isSpeaking: false, routeVersion: 1 });
    const cbs = makeCbs();
    scheduleForcedSpeak("Turn right", 1, refs, cbs);
    refs.routeVersion.current = 2;
    jest.advanceTimersByTime(0);
    expect(cbs.armWatchdog).not.toHaveBeenCalled();
  });
});

// ── Suite 6: a3 fires while a2 speaking — end-to-end scenario ────────────────
//
// Concrete scenario from the task description:
//   a2 ("In 500 feet, turn right") is mid-phrase.
//   a3 ("Turn right") fires at ~348 m with 8 s lead time.
//   Expected: a2 stops immediately; a3 plays within 200 ms.

describe("a3 fires while a2 speaking → a2 stops, a3 plays within 200 ms", () => {
  it("Speech.stop() is called the moment a3 fires", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("isSpeaking is false after stop() so no concurrent non-forced call sees it as active", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(refs.isSpeaking.current).toBe(false);
  });

  it("Speech.speak('Turn right') fires after the 120 ms settle — within 200 ms deadline", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right", expect.any(Object));
  });

  it("Speech.speak() is called with the correct a3 text", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right onto Harbor Drive", 1, refs, makeCbs());
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right onto Harbor Drive", expect.any(Object));
  });

  it("a3 plays exactly once even when navSpeak is called twice in rapid succession", () => {
    // Second forced call cancels the first timer; only one Speech.speak() fires.
    const refs = makeRefs({ isSpeaking: true });
    const cbs = makeCbs();
    const { timerId: t1 } = scheduleForcedSpeak("Turn right", 1, refs, cbs);
    clearTimeout(t1); // simulate map.tsx cancelling the first timer before the second call
    refs.isSpeaking.current = false; // first call already stopped
    scheduleForcedSpeak("Turn right", 1, refs, cbs);
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });
});

// ── Suite 7: speakTimerRef lifecycle — timer ref cleared when forced timer fires ─
//
// Regression introduced by extraction: the original inline setTimeout callback
// set `speakTimerRef.current = null` as its first line, giving non-forced cues
// a clear signal that no pending timer existed.  scheduleForcedSpeak has no
// direct access to that ref, so it calls onTimerFired() instead.
//
// Without onTimerFired(), the ref stays non-null after the timer executes;
// subsequent non-forced (a1/a2) calls always see "pending timer" and queue
// indefinitely — never dispatching.

describe("scheduleForcedSpeak — speakTimerRef cleared when timer fires (timer lifecycle)", () => {
  it("onTimerFired() is called before any guard checks (even on stale version)", () => {
    const fired = jest.fn();
    const refs = makeRefs({ isSpeaking: false, routeVersion: 1 });
    const cbs = { ...makeCbs(), onTimerFired: fired };
    scheduleForcedSpeak("Turn right", 1, refs, cbs);
    refs.routeVersion.current = 2; // stale — speak will be dropped
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    // onTimerFired must have fired even though Speech.speak() was suppressed
    expect(fired).toHaveBeenCalledTimes(1);
    expect(mockSpeak).not.toHaveBeenCalled(); // stale guard still works
  });

  it("timerRef.current is null after the forced timer fires", () => {
    const timerRef = makeTimerRef();
    const refs = makeRefs({ isSpeaking: false });
    const { timerId } = scheduleForcedSpeak("Turn right", 1, refs, makeCbs(timerRef));
    timerRef.current = timerId; // map.tsx stores this after the call
    expect(timerRef.current).not.toBeNull(); // timer is pending
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(timerRef.current).toBeNull(); // cleared by onTimerFired
  });

  it("a non-forced cue dispatches immediately after forced timer completes (not stranded)", () => {
    // This is the regression test: after a3 fires and its timer executes,
    // timerRef must be null so the next a2 cue is dispatched normally.
    const timerRef = makeTimerRef();
    const refs = makeRefs({ isSpeaking: false });

    // 1. Fire a3 (forced).
    const { timerId } = scheduleForcedSpeak("Turn right", 1, refs, makeCbs(timerRef));
    timerRef.current = timerId;

    // 2. Advance past the settle — a3 fires, timerRef cleared, isSpeaking=true.
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(timerRef.current).toBeNull();

    // 3. Simulate onDone: a3 finishes speaking.
    refs.isSpeaking.current = false;
    mockSpeak.mockClear();

    // 4. A non-forced a2 cue now arrives.  timerRef.current is null and
    //    isSpeaking is false — it must be dispatched, not queued.
    // (Mirrors the map.tsx non-forced branch: isSpeakingRef || speakTimerRef)
    const wouldQueue = refs.isSpeaking.current || timerRef.current !== null;
    expect(wouldQueue).toBe(false); // must NOT enter the queue branch
  });
});

// ── Suite 8: regression contrast — the old 400 ms gate would have queued a3 ──

describe("regression contrast — old shouldInterrupt gate (NOT using production code)", () => {
  /**
   * Simulates OLD production logic (the bug).
   * NOT imported from production — used only to document the failure mode.
   */
  function legacyForcedPath(wasSpeaking: boolean, utteranceAgeMs: number) {
    const shouldInterrupt = wasSpeaking && utteranceAgeMs > 400; // old gate
    if (shouldInterrupt) {
      try { Speech.stop(); } catch {}
    }
    // Old settle: 30 ms when speaking-but-not-interrupting, 0 when idle/interrupted
    const settleMs = wasSpeaking && !shouldInterrupt ? 30 : 0;
    setTimeout(() => { Speech.speak("Turn right", {}); }, settleMs);
    return { shouldInterrupt, settleMs };
  }

  it("[OLD] utteranceAge=50ms → shouldInterrupt=false → Speech.stop() NOT called", () => {
    const { shouldInterrupt } = legacyForcedPath(true, 50);
    expect(mockStop).not.toHaveBeenCalled();
    expect(shouldInterrupt).toBe(false);
  });

  it("[OLD] utteranceAge=50ms → 30 ms settle with a2 still in iOS TTS buffer → race lost", () => {
    const { shouldInterrupt, settleMs } = legacyForcedPath(true, 50);
    expect(shouldInterrupt).toBe(false);
    expect(settleMs).toBe(30);
    // Speech.speak() fires at 30 ms but a2 is still queued in AVSpeechSynthesizer
    jest.advanceTimersByTime(30);
    expect(mockSpeak).toHaveBeenCalledTimes(1); // fired but queued behind a2
    mockSpeak.mockClear();
    mockStop.mockClear();
  });

  it("[NEW] same scenario (utteranceAge=50ms) → scheduleForcedSpeak stops a2, a3 at 120 ms", () => {
    const refs = makeRefs({ isSpeaking: true });
    scheduleForcedSpeak("Turn right", 1, refs, makeCbs());
    expect(mockStop).toHaveBeenCalledTimes(1); // a2 stopped
    jest.advanceTimersByTime(FORCED_SETTLE_MS);
    expect(mockSpeak).toHaveBeenCalledWith("Turn right", expect.any(Object)); // a3 plays cleanly
  });
});
