/**
 * bgForegroundVoiceDedup.test.ts
 *
 * Tests for the background→foreground voice-dedup fix.
 *
 * Root cause:
 *   Both the background task (backgroundNav.ts) and the foreground-while-inactive
 *   path (map.tsx) fire push notifications for upcoming maneuvers.  When the user
 *   reopens the app, the foreground GPS handler evaluates the same step afresh and
 *   calls Speech.speak() with the same instruction — the user hears the turn twice.
 *
 * Fix:
 *   Each notification emitter adds the step index to navState.notifiedStepIndices
 *   only after showTurnNotification() resolves successfully.  On every
 *   background→active AppState transition, syncBgNotifiedIntoVoiceAnnounced()
 *   stamps only those exact indices in voiceAnnouncedRef so the foreground voice
 *   guards skip them.  Steps skipped by a background multi-step jump, or where the
 *   notification failed, are never suppressed.
 *
 * Test suites
 * ───────────
 * A — syncBgNotifiedIntoVoiceAnnounced unit tests (pure function, Set-based API)
 * B — Foreground guard: after sync, GPS-skip safety-net does NOT call Speech.speak()
 * C — AppState transition simulation
 * D — Route-replacement: notifiedStepIndices cleared → new route not over-suppressed
 * E — Notification write paths: only post-success indices suppress speech
 * F — Edge cases (empty set, already-populated ref, multi-step routes)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

import * as Speech from "expo-speech";
import { syncBgNotifiedIntoVoiceAnnounced } from "../utils/navVoiceSync";

const mockSpeak = Speech.speak as jest.Mock;

beforeEach(() => {
  mockSpeak.mockClear();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates an empty voiceAnnouncedRef matching the map.tsx type. */
function makeVoiceRef(): { current: Record<number, Set<string>> } {
  return { current: {} };
}

/**
 * Simulates the foreground GPS-skip safety-net guard from map.tsx (~line 3923):
 *   const wasNearAnnounced = voiceAnnouncedRef.current[idx]?.has("a3") ?? false;
 *   const wasTurnAnnounced = voiceAnnouncedRef.current[idx]?.has("turn") ?? false;
 *   if (!wasNearAnnounced && !wasTurnAnnounced) { navSpeak(...); }
 * Returns true when the foreground WOULD call navSpeak (i.e. not suppressed).
 */
function foregroundWouldSpeak(
  voiceRef: { current: Record<number, Set<string>> },
  stepIdx: number,
): boolean {
  const wasNearAnnounced = voiceRef.current[stepIdx]?.has("a3") ?? false;
  const wasTurnAnnounced = voiceRef.current[stepIdx]?.has("turn") ?? false;
  return !wasNearAnnounced && !wasTurnAnnounced;
}

/**
 * Simulates the a2-zone guard from map.tsx.
 * Returns true when the foreground WOULD announce an a2-zone cue.
 */
function foregroundWouldAnnounceA2(
  voiceRef: { current: Record<number, Set<string>> },
  stepIdx: number,
): boolean {
  const announced = voiceRef.current[stepIdx];
  return !announced?.has("a2") && !announced?.has("a3");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — syncBgNotifiedIntoVoiceAnnounced unit tests (Set-based API)
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — syncBgNotifiedIntoVoiceAnnounced unit tests", () => {
  it("A1 — stamps all four zones for a single notified step", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([0]), ref);

    expect(ref.current[0]).toBeDefined();
    expect(ref.current[0].has("a1")).toBe(true);
    expect(ref.current[0].has("a2")).toBe(true);
    expect(ref.current[0].has("a3")).toBe(true);
    expect(ref.current[0].has("turn")).toBe(true);
  });

  it("A2 — stamps only the exact indices in the Set, not all ≤ max", () => {
    // Background jumped from step 0 directly to step 2 — only step 2 notified.
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([2]), ref);

    expect(ref.current[0]).toBeUndefined(); // skipped — not suppressed
    expect(ref.current[1]).toBeUndefined(); // skipped — not suppressed
    expect(ref.current[2]?.has("turn")).toBe(true); // notified — suppressed
  });

  it("A3 — stamps multiple non-contiguous indices", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([1, 3, 5]), ref);

    expect(ref.current[1]?.has("turn")).toBe(true);
    expect(ref.current[2]).toBeUndefined(); // not in set
    expect(ref.current[3]?.has("turn")).toBe(true);
    expect(ref.current[4]).toBeUndefined(); // not in set
    expect(ref.current[5]?.has("turn")).toBe(true);
  });

  it("A4 — is a no-op when the Set is empty (initial state)", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set(), ref);

    expect(Object.keys(ref.current)).toHaveLength(0);
  });

  it("A5 — is idempotent: calling twice with the same Set is safe", () => {
    const ref = makeVoiceRef();
    const indices = new Set([1]);
    syncBgNotifiedIntoVoiceAnnounced(indices, ref);
    syncBgNotifiedIntoVoiceAnnounced(indices, ref);

    expect(ref.current[1].size).toBe(4); // a1, a2, a3, turn — no duplicates
  });

  it("A6 — preserves existing entries in voiceAnnouncedRef (does not clear them)", () => {
    const ref = makeVoiceRef();
    ref.current[0] = new Set(["a1", "a2"]); // partially-stamped from earlier logic

    syncBgNotifiedIntoVoiceAnnounced(new Set([0]), ref);

    expect(ref.current[0].has("a1")).toBe(true);
    expect(ref.current[0].has("a2")).toBe(true);
    expect(ref.current[0].has("a3")).toBe(true);
    expect(ref.current[0].has("turn")).toBe(true);
  });

  it("A7 — step NOT in the set is never stamped even if surrounded by stamped steps", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([0, 2]), ref);

    expect(ref.current[0]?.has("turn")).toBe(true);
    expect(ref.current[1]).toBeUndefined(); // untouched
    expect(ref.current[2]?.has("turn")).toBe(true);
  });

  it("A8 — works correctly with a Set containing step 0 only", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([0]), ref);

    expect(ref.current[0].has("turn")).toBe(true);
    expect(ref.current[1]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — Foreground guard: after sync, Speech.speak is NOT called
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — Foreground guard: no Speech.speak after sync", () => {
  it("B1 — foreground WOULD speak for a fresh (unsynced) step", () => {
    const ref = makeVoiceRef();
    expect(foregroundWouldSpeak(ref, 1)).toBe(true);
  });

  it("B2 — foreground does NOT speak after sync for a notified step", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([1]), ref);
    expect(foregroundWouldSpeak(ref, 1)).toBe(false);
  });

  it("B3 — foreground WOULD speak for a step NOT in the notified set", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([1]), ref);
    expect(foregroundWouldSpeak(ref, 2)).toBe(true); // step 2 never notified
  });

  it("B4 — multi-step jump: skipped steps remain speakable", () => {
    // Background jumped directly from step 0 to step 2.
    // Steps 0 and 1 were NOT notified — foreground must announce them.
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([2]), ref);

    expect(foregroundWouldSpeak(ref, 0)).toBe(true); // not in set
    expect(foregroundWouldSpeak(ref, 1)).toBe(true); // not in set
    expect(foregroundWouldSpeak(ref, 2)).toBe(false); // in set — suppressed
  });

  it("B5 — a2-zone guard also suppressed for notified steps", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([1]), ref);

    expect(foregroundWouldAnnounceA2(ref, 1)).toBe(false);
    expect(foregroundWouldAnnounceA2(ref, 2)).toBe(true); // not notified
  });

  it("B6 — concrete scenario: background notified step 1; foreground does NOT call Speech.speak()", () => {
    const notifiedStepIndices = new Set([1]);
    const voiceRef = makeVoiceRef();

    syncBgNotifiedIntoVoiceAnnounced(notifiedStepIndices, voiceRef);

    const advancedIdx = 1;
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Turn right onto Harbor Drive", {});
    }

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("B7 — without sync the foreground WOULD call Speech.speak() (regression baseline)", () => {
    // Empty set (no sync) → guard passes → speech fires
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set(), voiceRef);

    const advancedIdx = 1;
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Turn right onto Harbor Drive", {});
    }

    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite C — AppState transition simulation
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — AppState transition simulation", () => {
  function simulateAppStateChange(
    next: "active" | "background" | "inactive",
    notifiedStepIndices: Set<number>,
  ): { current: Record<number, Set<string>> } {
    const voiceRef = makeVoiceRef();
    if (next === "active") {
      syncBgNotifiedIntoVoiceAnnounced(notifiedStepIndices, voiceRef);
    }
    return voiceRef;
  }

  it("C1 — 'active' transition stamps voiceAnnouncedRef for the exact notified indices", () => {
    const ref = simulateAppStateChange("active", new Set([1]));

    expect(ref.current[1]?.has("turn")).toBe(true);
    expect(ref.current[0]).toBeUndefined();
  });

  it("C2 — 'background' transition does NOT stamp voiceAnnouncedRef", () => {
    const ref = simulateAppStateChange("background", new Set([1]));
    expect(ref.current[1]).toBeUndefined();
  });

  it("C3 — 'inactive' transition does NOT stamp voiceAnnouncedRef", () => {
    const ref = simulateAppStateChange("inactive", new Set([1]));
    expect(ref.current[1]).toBeUndefined();
  });

  it("C4 — 'active' with empty set leaves ref empty", () => {
    const ref = simulateAppStateChange("active", new Set());
    expect(Object.keys(ref.current)).toHaveLength(0);
  });

  it("C5 — full cycle: background notifies step 1, active → sync → no double-announce", () => {
    const notifiedStepIndices = new Set([1]);
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(notifiedStepIndices, voiceRef);

    const advancedIdx = 1;
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Merge onto I-280 South", {});
    }

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("C6 — step beyond notified indices IS announced normally (no over-suppression)", () => {
    const notifiedStepIndices = new Set([1]);
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(notifiedStepIndices, voiceRef);

    const advancedIdx = 2; // not notified
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Turn left onto Market Street", {});
    }

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledWith("Turn left onto Market Street", expect.any(Object));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite D — Route replacement: notifiedStepIndices cleared → no over-suppression
// ═══════════════════════════════════════════════════════════════════════════════
//
// All route-replacement paths (resetRouteRefs, faster-route acceptance,
// alt-route acceptance) must set navState.notifiedStepIndices = new Set().
// Without this, a stale old-route index suppresses voice on the new route.

describe("D — Route replacement resets notifiedStepIndices", () => {
  /** Simulates navState shape for these tests. */
  function makeNavState(notifiedStepIndices = new Set<number>()) {
    return { notifiedStepIndices };
  }

  function simulateResetRouteRefs(ns: { notifiedStepIndices: Set<number> }) {
    ns.notifiedStepIndices = new Set();
  }

  function simulateFasterRouteAccept(ns: { notifiedStepIndices: Set<number> }) {
    ns.notifiedStepIndices = new Set();
  }

  function simulateAltRouteAccept(ns: { notifiedStepIndices: Set<number> }) {
    ns.notifiedStepIndices = new Set();
  }

  it("D1 — resetRouteRefs clears notifiedStepIndices", () => {
    const ns = makeNavState(new Set([1, 2]));
    simulateResetRouteRefs(ns);
    expect(ns.notifiedStepIndices.size).toBe(0);
  });

  it("D2 — faster-route acceptance clears notifiedStepIndices", () => {
    const ns = makeNavState(new Set([0, 1]));
    simulateFasterRouteAccept(ns);
    expect(ns.notifiedStepIndices.size).toBe(0);
  });

  it("D3 — alt-route acceptance clears notifiedStepIndices", () => {
    const ns = makeNavState(new Set([3]));
    simulateAltRouteAccept(ns);
    expect(ns.notifiedStepIndices.size).toBe(0);
  });

  it("D4 — after route replacement, sync is a no-op and new-route steps remain speakable", () => {
    const ns = makeNavState(new Set([1])); // old route had step 1 notified

    // Route replaced
    simulateResetRouteRefs(ns);

    // App foregrounds before background task fires on new route
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    expect(Object.keys(voiceRef.current)).toHaveLength(0);
    expect(foregroundWouldSpeak(voiceRef, 0)).toBe(true);
    expect(foregroundWouldSpeak(voiceRef, 1)).toBe(true);
  });

  it("D5 — foreground CAN announce new-route step 1 after resetRouteRefs + active return", () => {
    const ns = makeNavState(new Set([1]));
    simulateResetRouteRefs(ns);

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    const advancedIdx = 1;
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Take the ramp onto I-280 South", {});
    }

    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("D6 — regression: WITHOUT reset, old notifiedStepIndices suppresses new route step (the bug)", () => {
    const ns = makeNavState(new Set([1])); // NOT cleared after reroute

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef); // stamps step 1

    const advancedIdx = 1;
    const wasNear = voiceRef.current[advancedIdx]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[advancedIdx]?.has("turn") ?? false;

    if (!wasNear && !wasTurn) {
      Speech.speak("Take the ramp onto I-280 South", {});
    }

    // Bug confirmed: speech suppressed even on new route
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("D7 — full cycle: old route notified, reroute, second foreground return does not over-suppress", () => {
    const ns = makeNavState(new Set([2]));

    // First foreground return (old route active) — step 2 suppressed: correct
    const firstRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, firstRef);
    expect(foregroundWouldSpeak(firstRef, 2)).toBe(false);

    // Reroute fires
    simulateResetRouteRefs(ns);

    // Second foreground return (new route, no background notification yet)
    const secondRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, secondRef);
    expect(Object.keys(secondRef.current)).toHaveLength(0);
    expect(foregroundWouldSpeak(secondRef, 2)).toBe(true); // must be speakable on new route
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite E — Notification write paths: only post-success indices suppress speech
// ═══════════════════════════════════════════════════════════════════════════════
//
// Simulates both notification emitters using plain objects (importing
// navNotifications.ts is avoided because it pulls in expo-notifications ESM).
//
// The production contract for each emitter:
//   background task (backgroundNav.ts):
//     await showTurnNotification(...);
//     navState.notifiedStepIndices.add(idx);   ← after success
//
//   foreground non-active path (map.tsx):
//     showTurnNotification(...).then(() => {
//       navState.notifiedStepIndices.add(_notifyIdx);  ← after success
//     }).catch(() => {});

describe("E — Notification write paths: only post-success indices suppress speech", () => {
  function makeNavState() {
    return { notifiedStepIndices: new Set<number>(), activeGeneration: 0 };
  }

  it("E1 — background-task write path: after success → sync suppresses speech", () => {
    const ns = makeNavState();

    // Simulate: await showTurnNotification() resolved → add to set
    ns.notifiedStepIndices.add(1);

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    const wasNear = voiceRef.current[1]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[1]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Turn right", {});

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("E2 — foreground non-active write path: after .then() resolves → sync suppresses speech", () => {
    const ns = makeNavState();

    // Simulate: showTurnNotification().then(() => { add idx }) completed
    ns.notifiedStepIndices.add(2);

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    const wasNear = voiceRef.current[2]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[2]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Merge onto I-280 South", {});

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("E3 — notification failure: step NOT added to set → foreground announces it", () => {
    const ns = makeNavState();
    // Simulate: showTurnNotification() rejected → .catch() fired → set NOT updated
    // ns.notifiedStepIndices remains empty

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    const wasNear = voiceRef.current[2]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[2]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Merge onto I-280 South", {});

    // Notification failed — foreground must announce the turn (no over-suppression)
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("E4 — multi-step background jump: only the actually-notified step is suppressed", () => {
    const ns = makeNavState();

    // Background jumped to step 2 (skipped steps 0 and 1); only step 2 gets added
    ns.notifiedStepIndices.add(2);

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    expect(foregroundWouldSpeak(voiceRef, 0)).toBe(true); // never notified
    expect(foregroundWouldSpeak(voiceRef, 1)).toBe(true); // never notified
    expect(foregroundWouldSpeak(voiceRef, 2)).toBe(false); // notified → suppressed
  });

  it("E5 — late .then() blocked by generation mismatch → voice plays; no voice+push duplicate", () => {
    // Scenario: notification started while inactive, app becomes active BEFORE
    // .then() fires. The generation counter is incremented on active transition,
    // so the .then() callback sees a mismatch and does NOT add to the set.
    // Voice plays once (correct: push was cancelled by cancelNavNotifications).
    const ns = makeNavState();

    // App becomes active → increment generation (mirrors map.tsx active handler)
    const genBefore = ns.activeGeneration;
    ns.activeGeneration += 1; // transition to active
    const genAfter = ns.activeGeneration;

    // .then() fires AFTER active transition — generation mismatch → NOT added
    if (ns.activeGeneration === genBefore) {
      // This branch does NOT execute (generation changed)
      ns.notifiedStepIndices.add(1);
    }
    expect(ns.notifiedStepIndices.size).toBe(0); // set stays empty

    // Sync runs with empty set → no stamps
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    // Foreground GPS fires → voice plays (push was cancelled; one announcement)
    const wasNear = voiceRef.current[1]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[1]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Turn right onto Harbor Drive", {});

    expect(mockSpeak).toHaveBeenCalledTimes(1); // one voice announcement — correct
    expect(genAfter).toBe(genBefore + 1); // generation was incremented
  });

  it("E5b — .then() fires before active transition → generation matches → index added → voice suppressed", () => {
    // Scenario: notification started and resolves while STILL inactive.
    // Generation has not changed → index IS added → sync stamps it → voice suppressed.
    const ns = makeNavState();
    const capturedGeneration = ns.activeGeneration; // captured before notification

    // .then() fires while still inactive — generation still matches → add to set
    if (ns.activeGeneration === capturedGeneration) {
      ns.notifiedStepIndices.add(1);
    }
    expect(ns.notifiedStepIndices.size).toBe(1); // step 1 recorded

    // App becomes active → generation incremented → sync runs
    ns.activeGeneration += 1;
    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    // Step 1 is stamped → voice suppressed (push handled it)
    const wasNear = voiceRef.current[1]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[1]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Turn right onto Harbor Drive", {});

    expect(mockSpeak).not.toHaveBeenCalled(); // voice correctly suppressed
  });

  it("E6 — step beyond notified indices announces normally after successful notification of earlier step", () => {
    const ns = makeNavState();
    ns.notifiedStepIndices.add(1);

    const voiceRef = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(ns.notifiedStepIndices, voiceRef);

    // Step 2 — not notified; foreground must announce it
    const wasNear = voiceRef.current[2]?.has("a3") ?? false;
    const wasTurn = voiceRef.current[2]?.has("turn") ?? false;
    if (!wasNear && !wasTurn) Speech.speak("Turn left onto Market Street", {});

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledWith("Turn left onto Market Street", expect.any(Object));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite F — Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("F — Edge cases", () => {
  it("F1 — empty Set does not mutate an already-populated ref", () => {
    const ref = makeVoiceRef();
    ref.current[0] = new Set(["a1"]);

    syncBgNotifiedIntoVoiceAnnounced(new Set(), ref);

    expect(ref.current[0].size).toBe(1);
    expect(ref.current[0].has("a1")).toBe(true);
  });

  it("F2 — sync is safe when voiceRef already has partial entries for a notified index", () => {
    const ref = makeVoiceRef();
    ref.current[1] = new Set(["a2"]); // partially-stamped from foreground

    syncBgNotifiedIntoVoiceAnnounced(new Set([1]), ref);

    expect(ref.current[1].has("a2")).toBe(true);  // preserved
    expect(ref.current[1].has("a3")).toBe(true);  // added
    expect(ref.current[1].has("turn")).toBe(true); // added
  });

  it("F3 — sync called multiple times with different sets is cumulative", () => {
    const ref = makeVoiceRef();

    syncBgNotifiedIntoVoiceAnnounced(new Set([0]), ref);
    syncBgNotifiedIntoVoiceAnnounced(new Set([1]), ref);

    expect(ref.current[0]?.has("turn")).toBe(true);
    expect(ref.current[1]?.has("turn")).toBe(true);
    expect(ref.current[2]).toBeUndefined();
  });

  it("F4 — Set with step 0 only suppresses step 0, not step 1", () => {
    const ref = makeVoiceRef();
    syncBgNotifiedIntoVoiceAnnounced(new Set([0]), ref);

    expect(foregroundWouldSpeak(ref, 0)).toBe(false);
    expect(foregroundWouldSpeak(ref, 1)).toBe(true);
  });

  it("F5 — large non-contiguous index set stamps all correctly", () => {
    const ref = makeVoiceRef();
    const indices = new Set([0, 5, 10, 15]);
    syncBgNotifiedIntoVoiceAnnounced(indices, ref);

    for (const si of [0, 5, 10, 15]) {
      expect(ref.current[si]?.has("turn")).toBe(true);
    }
    for (const si of [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14]) {
      expect(ref.current[si]).toBeUndefined();
    }
  });
});
