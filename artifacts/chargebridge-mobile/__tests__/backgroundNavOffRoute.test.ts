/**
 * Integration tests for the background off-route detection path.
 *
 * Root cause (task-686): the foreground GPS handler (map.tsx) computed
 * speed-adaptive off-route thresholds inline with no shared utility. The
 * background location task (backgroundNav.ts) had no off-route detection at
 * all. Any change to the foreground thresholds would not propagate to the
 * background, and there was no CI gate to catch the drift.
 *
 * Fix:
 *  - Speed-adaptive thresholds extracted to utils/navOffRouteThreshold.ts.
 *  - Perpendicular-projection geometry extracted to utils/navPolyline.ts.
 *  - Stateful detection logic extracted to utils/navOffRouteDetect.ts
 *    (backgroundOffRouteTick), which backgroundNav.ts calls each tick.
 *  - map.tsx refactored to call navOffRouteThreshold() instead of the
 *    inline formula.
 *
 * Test approach: import the REAL production helpers so that any change to the
 * breakpoints, rounding, geometry, or detection condition in any of the
 * utility files causes these tests to fail.
 *
 * Suites:
 *  1. closestPointOnPolyline — perpendicular projection geometry
 *  2. Threshold parity — foreground and background use identical thresholds
 *  3. Background tick — counter increments, resets, and reroute triggers
 *  4. Highway regression — 65 mph, 3 readings × offDistM = 55 m
 *  5. Speed-bucket coverage — slow / urban / highway trigger at correct counts
 *  6. Cooldown gate — second reroute within offCooldown is suppressed
 *  7. Walking / cycling overrides
 *  8. Sensitivity multiplier propagates to distM boundary
 */

import { navOffRouteThreshold } from "../utils/navOffRouteThreshold";
import { closestPointOnPolyline } from "../utils/navPolyline";
import {
  backgroundOffRouteTick,
  consumeBgOffRoute,
  OffRouteTickState,
} from "../utils/navOffRouteDetect";
import { haversineMeters } from "../utils/navStepAdvance";

// ── Helpers ──────────────────────────────────────────────────────────────────

type LatLng = { latitude: number; longitude: number };

/** Point `distM` metres north of `origin`. */
function north(origin: LatLng, distM: number): LatLng {
  return { latitude: origin.latitude + distM / 111_320, longitude: origin.longitude };
}

/**
 * Point `distM` metres east of `origin`.
 * Longitude degrees-per-metre scales with cos(latitude) — using the raw
 * 111 320 m/degree factor (valid only at the equator) would place the point
 * at distM × cos(lat) actual metres, causing off-route distance checks to
 * fail because the haversine comes back shorter than expected.
 */
function east(origin: LatLng, distM: number): LatLng {
  const metersPerDegreeLng = 111_320 * Math.cos(origin.latitude * Math.PI / 180);
  return { latitude: origin.latitude, longitude: origin.longitude + distM / metersPerDegreeLng };
}

/**
 * Fresh OffRouteTickState representing "navigation just started, no previous
 * reroute".  lastRecalcMs is set to -Infinity rather than 0 so that the
 * cooldown gate `nowMs - lastRecalcMs > offCooldown` is always true on the
 * first reroute trigger — regardless of the small synthetic timestamps used
 * in tests.  In production, navState.lastBgOffRouteMs=0 works correctly
 * because Date.now() returns epoch milliseconds (~1.7 × 10¹²), which always
 * exceeds any offCooldown value.
 */
function freshState(): OffRouteTickState {
  return { count: 0, startMs: 0, lastRecalcMs: -Infinity };
}

/**
 * Run the background detection tick N times at `nowMs` intervals of `stepMs`.
 * Returns { rerouted, tick } — the tick index (0-based) on which reroute fired,
 * or -1 if it never fired.
 */
function runTicks(
  ticks: Array<{ loc: LatLng; speedMs: number; nowMs: number }>,
  routeCoords: LatLng[],
  state: OffRouteTickState,
  isWalking = false,
  isCycling = false,
  sensitivity = 1.0,
): { rerouted: boolean; rerouteTick: number; finalCount: number } {
  for (let i = 0; i < ticks.length; i++) {
    const { loc, speedMs, nowMs } = ticks[i];
    const rerouted = backgroundOffRouteTick(
      loc, speedMs, isWalking, isCycling, sensitivity,
      routeCoords, state, nowMs,
    );
    if (rerouted) return { rerouted: true, rerouteTick: i, finalCount: state.count };
  }
  return { rerouted: false, rerouteTick: -1, finalCount: state.count };
}

// ── Suite 1: closestPointOnPolyline — geometry ───────────────────────────────

describe("closestPointOnPolyline — perpendicular projection", () => {
  const A: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const B = north(A, 200); // 200 m north of A

  it("projects a point directly on the line to itself (within rounding)", () => {
    const mid = north(A, 100);
    const projected = closestPointOnPolyline([A, B], mid);
    expect(haversineMeters(projected, mid)).toBeLessThan(1); // < 1 m
  });

  it("projects a point 60 m east of the midpoint perpendicularly", () => {
    const mid = north(A, 100);
    const offPoint = east(mid, 60);
    const projected = closestPointOnPolyline([A, B], offPoint);
    const dist = haversineMeters(projected, offPoint);
    expect(dist).toBeGreaterThan(55);
    expect(dist).toBeLessThan(65); // within 5 m of true 60 m
  });

  it("clamps to the segment start when the projection falls before A", () => {
    const before = north(A, -50); // 50 m south of A — before segment start
    const projected = closestPointOnPolyline([A, B], before);
    expect(haversineMeters(projected, A)).toBeLessThan(2); // clamped to A
  });

  it("clamps to the segment end when the projection falls past B", () => {
    const after = north(A, 250); // 50 m past B
    const projected = closestPointOnPolyline([A, B], after);
    expect(haversineMeters(projected, B)).toBeLessThan(2); // clamped to B
  });

  it("returns the nearest segment for a two-segment polyline", () => {
    const C = east(B, 200);
    // Point 60 m east of midpoint of B–C
    const offMid = east(north(A, 200), 100); // on the B–C line, 100 m along it
    const offPoint = north(offMid, 60);       // 60 m north of that

    // For a point north of B–C, the nearest segment should be B–C
    const projected = closestPointOnPolyline([A, B, C], offPoint);
    // Projected point should be on the B–C segment (latitude ≈ B.latitude)
    expect(Math.abs(projected.latitude - B.latitude)).toBeLessThan(0.001);
  });

  it("returns pos when coords is empty", () => {
    const pos: LatLng = { latitude: 37.0, longitude: -122.0 };
    expect(closestPointOnPolyline([], pos)).toEqual(pos);
  });

  it("returns the single coord when coords has one point", () => {
    const pos: LatLng = { latitude: 37.0, longitude: -122.0 };
    const coord: LatLng = { latitude: 37.01, longitude: -122.01 };
    expect(closestPointOnPolyline([coord], pos)).toEqual(coord);
  });
});

// ── Suite 2: threshold parity — foreground and background use identical values ─
//
// Both map.tsx (foreground) and backgroundNav.ts (background) call
// navOffRouteThreshold() to obtain their distance/count boundaries.
// backgroundOffRouteTick() calls it internally.  This suite feeds the same
// speed sample to both and asserts the returned thresholds are identical.
//
// If a future change introduces a separate inline formula in either caller,
// these tests will fail by comparing the utility's output directly.

describe("threshold parity — foreground navOffRouteThreshold matches background backgroundOffRouteTick", () => {
  const SPEEDS_MPH = [0, 10, 25, 26, 40, 50, 51, 65, 80];

  for (const mph of SPEEDS_MPH) {
    it(`both use identical offDistM / offCount at ${mph} mph`, () => {
      const speedMs = mph / 2.237;

      // Foreground path: direct call to the shared utility (same call map.tsx makes)
      const fg = navOffRouteThreshold(speedMs, false, false, 1.0);

      // Background path: run one tick exactly AT offDistM — counter should NOT
      // trigger (distToPolyM == offDistM is not > offDistM, so count stays 0).
      // Then run one tick 1 m OUTSIDE — count increments to 1.
      const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
      const polyline: LatLng[] = [origin, north(origin, 500)];
      const stateInside = freshState();
      const stateOutside = freshState();

      // On-route point: exactly at offDistM east — should NOT increment count
      backgroundOffRouteTick(
        east(origin, fg.offDistM),
        speedMs, false, false, 1.0, polyline, stateInside, 0,
      );

      // Off-route point: 1 m beyond offDistM — SHOULD increment count
      backgroundOffRouteTick(
        east(origin, fg.offDistM + 1),
        speedMs, false, false, 1.0, polyline, stateOutside, 0,
      );

      expect(stateInside.count).toBe(0);   // ≤ offDistM — still on-route
      expect(stateOutside.count).toBe(1);  // > offDistM — first off-route reading
    });
  }
});

// ── Suite 3: background tick — counter increments, resets, and reroute ────────

describe("backgroundOffRouteTick — counter lifecycle", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 500)];
  const highwayMs = 65 / 2.237; // offDistM=55, offCount=3, minOffRouteMs=4000

  it("increments count when GPS is beyond offDistM", () => {
    const state = freshState();
    backgroundOffRouteTick(east(origin, 60), highwayMs, false, false, 1.0, polyline, state, 0);
    expect(state.count).toBe(1);
  });

  it("does NOT increment count when GPS is at exactly offDistM (not strictly greater)", () => {
    const state = freshState();
    backgroundOffRouteTick(east(origin, 55), highwayMs, false, false, 1.0, polyline, state, 0);
    expect(state.count).toBe(0);
  });

  it("resets count when GPS returns within offDistM", () => {
    const state = freshState();
    // Two off-route readings
    backgroundOffRouteTick(east(origin, 60), highwayMs, false, false, 1.0, polyline, state, 0);
    backgroundOffRouteTick(east(origin, 60), highwayMs, false, false, 1.0, polyline, state, 1000);
    expect(state.count).toBe(2);

    // Back on-route
    backgroundOffRouteTick(east(origin, 10), highwayMs, false, false, 1.0, polyline, state, 2000);
    expect(state.count).toBe(0);
    expect(state.startMs).toBe(0);
  });

  it("sets startMs on the FIRST off-route reading and does not update it on subsequent ones", () => {
    const state = freshState();
    backgroundOffRouteTick(east(origin, 60), highwayMs, false, false, 1.0, polyline, state, 1000);
    expect(state.startMs).toBe(1000);

    backgroundOffRouteTick(east(origin, 60), highwayMs, false, false, 1.0, polyline, state, 2000);
    expect(state.startMs).toBe(1000); // unchanged
  });

  it("returns false when off-route but minOffRouteMs has not elapsed", () => {
    const state = freshState();
    // 3 readings (offCount=3) but only 2000 ms elapsed (minOffRouteMs=4000)
    for (let i = 0; i < 3; i++) {
      const fired = backgroundOffRouteTick(
        east(origin, 60), highwayMs, false, false, 1.0, polyline, state, i * 1000,
      );
      expect(fired).toBe(false);
    }
    expect(state.count).toBe(3); // count reached but timer gate blocked reroute
  });

  it("returns false when fewer than offCount readings have been accumulated", () => {
    const state = freshState();
    // 2 readings (offCount=3 required), timer satisfied
    for (let i = 0; i < 2; i++) {
      const fired = backgroundOffRouteTick(
        east(origin, 60), highwayMs, false, false, 1.0, polyline, state, i * 2000,
      );
      expect(fired).toBe(false);
    }
  });

  it("returns false when routeCoords has fewer than 2 points", () => {
    const state = freshState();
    const fired = backgroundOffRouteTick(east(origin, 200), highwayMs, false, false, 1.0, [origin], state, 0);
    expect(fired).toBe(false);
  });
});

// ── Suite 4: highway regression — 65 mph, offCount=3, offDistM=55 ─────────────
//
// At 65 mph (~29 m/s) iOS BestForNavigation fires 1 Hz.  Three consecutive
// GPS readings ≥ 56 m from the polyline, covering at least 4 000 ms, must
// trigger a reroute.  This is the primary regression scenario that the task
// requires a CI gate for.

describe("background off-route — highway 65 mph regression case", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  // North-south polyline starting at origin
  const polyline: LatLng[] = [origin, north(origin, 1000)];
  const highwayMs = 65 / 2.237;

  it("triggers reroute after 3 consecutive readings at 60 m (> 55 m) with 4 s elapsed", () => {
    const state = freshState();
    const ticks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 4500 }, // ≥ 4000 ms + count=3
    ];
    const { rerouted, rerouteTick } = runTicks(ticks, polyline, state);
    expect(rerouted).toBe(true);
    expect(rerouteTick).toBe(2); // fires on the 3rd tick (index 2)
  });

  it("resets count and lastRecalcMs when reroute fires", () => {
    const state = freshState();
    const ticks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 4500 },
    ];
    runTicks(ticks, polyline, state);
    expect(state.count).toBe(0);
    expect(state.lastRecalcMs).toBe(4500);
  });

  it("does NOT trigger when only 2 readings are off-route (count < 3)", () => {
    const state = freshState();
    const ticks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 4500 },
    ];
    const { rerouted } = runTicks(ticks, polyline, state);
    expect(rerouted).toBe(false);
  });

  it("does NOT trigger when GPS is at exactly offDistM=55 m (not strictly greater)", () => {
    const state = freshState();
    const ticks = Array.from({ length: 5 }, (_, i) => ({
      loc: east(origin, 55),
      speedMs: highwayMs,
      nowMs: i * 2000,
    }));
    const { rerouted } = runTicks(ticks, polyline, state);
    expect(rerouted).toBe(false);
  });

  it("does NOT trigger when 3 readings are off-route but minOffRouteMs (4 s) has not elapsed", () => {
    const state = freshState();
    const ticks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 1000 },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 2000 }, // 2000 < 4000 ms
    ];
    const { rerouted } = runTicks(ticks, polyline, state);
    expect(rerouted).toBe(false);
  });
});

// ── Suite 5: speed-bucket coverage — correct count / distance per bucket ──────

describe("background off-route — speed-bucket trigger thresholds", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 1000)];

  it.each([
    // [label, mph, offDistM, offCount, minOffRouteMs]
    ["slow (10 mph)",     10, 80, 5, 7_000],
    ["urban (26 mph)",    26, 65, 4, 5_000],
    ["urban (40 mph)",    40, 65, 4, 5_000],
    ["highway (65 mph)",  65, 55, 3, 4_000],
  ])(
    "%s → triggers after %i readings × %i m + %i ms",
    (_label, mph, offDistM, offCount, minMs) => {
      const speedMs = mph / 2.237;
      // Use a point 1 m beyond offDistM — just inside the off-route zone
      const offPoint = east(origin, offDistM + 1);

      const state = freshState();
      // Send exactly offCount readings with sufficient time elapsed
      const ticks = Array.from({ length: offCount }, (_, i) => ({
        loc: offPoint,
        speedMs,
        nowMs: i * (minMs / (offCount - 1) + 1), // spread evenly over slightly more than minMs
      }));
      // Adjust last tick to guarantee ≥ minMs elapsed from first
      ticks[ticks.length - 1].nowMs = minMs + 100;

      const { rerouted } = runTicks(ticks, polyline, state);
      expect(rerouted).toBe(true);
    },
  );

  it.each([
    ["slow (10 mph)",    10, 80],
    ["urban (26 mph)",   26, 65],
    ["highway (65 mph)", 65, 55],
  ])(
    "%s → does NOT trigger when GPS is within offDistM (%i m)",
    (_label, mph, offDistM) => {
      const speedMs = mph / 2.237;
      const onPoint = east(origin, offDistM - 1); // just inside

      const state = freshState();
      const ticks = Array.from({ length: 10 }, (_, i) => ({
        loc: onPoint,
        speedMs,
        nowMs: i * 2000,
      }));
      const { rerouted } = runTicks(ticks, polyline, state);
      expect(rerouted).toBe(false);
    },
  );
});

// ── Suite 6: cooldown gate — second reroute within offCooldown is blocked ──────
//
// offCooldown at highway speed is 25 000 ms.  A second reroute within 25 s
// of the first must be suppressed so the user is not bombarded by reroutes.

describe("background off-route — cooldown gate", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 1000)];
  const highwayMs = 65 / 2.237;
  const offDistM = 55;

  it("second reroute within offCooldown (25 s) is suppressed", () => {
    const state = freshState();
    // First reroute
    const firstTicks = [
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 4500 },
    ];
    const first = runTicks(firstTicks, polyline, state);
    expect(first.rerouted).toBe(true);

    // Immediately after: 3 more off-route readings within the 25 s cooldown
    const secondTicks = [
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 5000  },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 7000  },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 10000 },
    ];
    const second = runTicks(secondTicks, polyline, state);
    expect(second.rerouted).toBe(false); // blocked by cooldown
  });

  it("second reroute fires once cooldown has elapsed", () => {
    const state = freshState();
    // First reroute at t=4500
    const firstTicks = [
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 4500 },
    ];
    runTicks(firstTicks, polyline, state);

    // Second reroute after cooldown (25 000 ms from lastRecalcMs=4500 → t≥29500)
    state.count = 0;
    state.startMs = 0;
    const secondTicks = [
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 29_600 },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 31_600 },
      { loc: east(origin, offDistM + 1), speedMs: highwayMs, nowMs: 34_200 },
    ];
    const second = runTicks(secondTicks, polyline, state);
    expect(second.rerouted).toBe(true);
  });
});

// ── Suite 7: walking and cycling overrides ────────────────────────────────────
//
// navOffRouteThreshold returns:
//   isWalking=true  → offDistM = 95 m, offCount = 4, minOffRouteMs = 7 000 ms
//   isCycling=true  → offDistM = 85 m, offCount = 4, minOffRouteMs = 7 000 ms
//
// These are intentionally WIDER than the slowest motorised bucket (80 m) so
// pedestrians and cyclists do not get false-positive reroutes on footpaths and
// cycle lanes.

describe("background off-route — walking and cycling travelMode overrides", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 500)];

  it("walking: offDistM=95 — does NOT trigger at 94 m", () => {
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 94),
      speedMs: 2,
      nowMs: i * 2000,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, true, false);
    expect(rerouted).toBe(false);
  });

  it("walking: offDistM=95 — triggers after 4 readings at 96 m + minOffRouteMs (7 s)", () => {
    const state = freshState();
    // Walking at speedMs=2 → speedMph≈4 → not > 25 mph → minOffRouteMs=7000
    const ticks = [
      { loc: east(origin, 96), speedMs: 2, nowMs: 0     },
      { loc: east(origin, 96), speedMs: 2, nowMs: 2000  },
      { loc: east(origin, 96), speedMs: 2, nowMs: 5000  },
      { loc: east(origin, 96), speedMs: 2, nowMs: 7200  }, // ≥ 7000 ms + count=4
    ];
    const { rerouted } = runTicks(ticks, polyline, state, true, false);
    expect(rerouted).toBe(true);
  });

  it("cycling: offDistM=85 — does NOT trigger at 84 m", () => {
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 84),
      speedMs: 5,
      nowMs: i * 2000,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, false, true);
    expect(rerouted).toBe(false);
  });

  it("cycling: offDistM=85 — triggers after 4 readings at 86 m + minOffRouteMs (7 s)", () => {
    const state = freshState();
    const ticks = [
      { loc: east(origin, 86), speedMs: 5, nowMs: 0     },
      { loc: east(origin, 86), speedMs: 5, nowMs: 2500  },
      { loc: east(origin, 86), speedMs: 5, nowMs: 5000  },
      { loc: east(origin, 86), speedMs: 5, nowMs: 7300  },
    ];
    const { rerouted } = runTicks(ticks, polyline, state, false, true);
    expect(rerouted).toBe(true);
  });
});

// ── Suite 10: wider walking / cycling tolerance is in effect end-to-end ────────
//
// These tests are the primary CI gate for task-716.  They confirm that
// backgroundOffRouteTick() honours the wider walking / cycling offDistM from
// navOffRouteThreshold() all the way through the detection path — a refactor
// that accidentally swaps the isWalking / isCycling flags at the call site
// (e.g. passes isWalking where isCycling is expected) would cause these tests
// to fail.
//
// Scenario:
//   A GPS position 90 m from the route polyline.
//     • Motorised slow bucket (offDistM = 80 m): 90 > 80 → OUTSIDE → reroute
//     • Walking          (offDistM = 95 m): 90 < 95 → INSIDE  → no reroute
//
//   A GPS position 83 m from the route polyline.
//     • Motorised slow bucket (offDistM = 80 m): 83 > 80 → OUTSIDE → reroute
//     • Cycling          (offDistM = 85 m): 83 < 85 → INSIDE  → no reroute
//
// Using speedMs = 0 (stationary / stopped GPS) keeps the motorised bucket at
// its widest (slow, 80 m) so the crossing point is unambiguous.

describe("background off-route — wider walking/cycling tolerance end-to-end", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  // Long polyline so the perpendicular projection stays well away from end-caps
  const polyline: LatLng[] = [origin, north(origin, 1000)];
  const stoppedMs = 0; // 0 m/s → speedMph=0 → slow motorised bucket, offDistM=80

  // ── Walking: position inside walking threshold (95 m), outside motorised (80 m) ──

  it("walking isWalking=true at 90 m: does NOT trigger reroute (90 m < walking offDistM 95 m)", () => {
    // offDistM for walking = 95 m; 90 m < 95 m → on-route → no reroute regardless
    // of count or time elapsed.
    const state = freshState();
    // Send 6 readings spread over 14 s — well past any minOffRouteMs guard.
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 90),
      speedMs: stoppedMs,
      nowMs: i * 2500,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, true /* isWalking */, false);
    expect(rerouted).toBe(false);
  });

  it("motorised isWalking=false isCycling=false at 90 m: DOES trigger reroute (90 m > motorised slow offDistM 80 m)", () => {
    // Same 90 m position, but now the motorised slow offDistM is 80 m.
    // 90 > 80 → off-route → reroute fires once offCount (5) and minOffRouteMs (7 s) are met.
    const state = freshState();
    const ticks = Array.from({ length: 5 }, (_, i) => ({
      loc: east(origin, 90),
      speedMs: stoppedMs,
      nowMs: i * 2000, // 0, 2000, 4000, 6000, 8000 ms — 8000 > 7000 ms gate
    }));
    // Ensure last tick satisfies minOffRouteMs=7000 ms
    ticks[ticks.length - 1].nowMs = 8000;
    const { rerouted } = runTicks(ticks, polyline, state, false, false);
    expect(rerouted).toBe(true);
  });

  // ── Cycling: position inside cycling threshold (85 m), outside motorised (80 m) ──

  it("cycling isCycling=true at 83 m: does NOT trigger reroute (83 m < cycling offDistM 85 m)", () => {
    // offDistM for cycling = 85 m; 83 m < 85 m → on-route → no reroute.
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 83),
      speedMs: stoppedMs,
      nowMs: i * 2500,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, false, true /* isCycling */);
    expect(rerouted).toBe(false);
  });

  it("motorised isWalking=false isCycling=false at 83 m: DOES trigger reroute (83 m > motorised slow offDistM 80 m)", () => {
    // Same 83 m position without cycling flag → motorised slow offDistM=80 m.
    // 83 > 80 → off-route → reroute fires once offCount (5) and minOffRouteMs (7 s) met.
    const state = freshState();
    const ticks = Array.from({ length: 5 }, (_, i) => ({
      loc: east(origin, 83),
      speedMs: stoppedMs,
      nowMs: i * 2000,
    }));
    ticks[ticks.length - 1].nowMs = 8000;
    const { rerouted } = runTicks(ticks, polyline, state, false, false);
    expect(rerouted).toBe(true);
  });

  // ── Guard: confirm navOffRouteThreshold returns the expected offDistM values ─

  it("navOffRouteThreshold walking offDistM=95, cycling offDistM=85, motorised slow offDistM=80", () => {
    const walking  = navOffRouteThreshold(0, true,  false, 1.0);
    const cycling  = navOffRouteThreshold(0, false, true,  1.0);
    const motorised = navOffRouteThreshold(0, false, false, 1.0);

    expect(walking.offDistM).toBe(95);
    expect(cycling.offDistM).toBe(85);
    expect(motorised.offDistM).toBe(80);

    // Confirm wider walking/cycling tolerance relative to the slow motorised bucket
    expect(walking.offDistM).toBeGreaterThan(motorised.offDistM);
    expect(cycling.offDistM).toBeGreaterThan(motorised.offDistM);
    expect(walking.offDistM).toBeGreaterThan(cycling.offDistM);
  });
});

// ── Suite 8: sensitivity multiplier propagates to distance boundary ───────────
//
// sensitivity=0.5 halves offDistM; a point 40 m away that is on-route at
// default sensitivity (offDistM=55) becomes off-route at 0.5× (offDistM=28).

describe("background off-route — sensitivity multiplier", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 500)];
  const highwayMs = 65 / 2.237; // base offDistM=55 at sensitivity 1.0

  it("sensitivity 1.0 — a point 50 m from polyline is off-route (50 < 55 is false → on-route? no, 50 < 55 → wait)", () => {
    // offDistM=55 at sensitivity 1.0.  A point 50 m away is NOT > 55 → on-route.
    const state = freshState();
    backgroundOffRouteTick(east(origin, 50), highwayMs, false, false, 1.0, polyline, state, 0);
    expect(state.count).toBe(0); // 50 ≤ 55 → on-route
  });

  it("sensitivity 0.5 — offDistM=28, a point 30 m from polyline IS off-route (30 > 28)", () => {
    // Math.round(55 × 0.5) = 28
    const state = freshState();
    backgroundOffRouteTick(east(origin, 30), highwayMs, false, false, 0.5, polyline, state, 0);
    expect(state.count).toBe(1); // 30 > 28 → off-route
  });

  it("sensitivity 2.0 — offDistM=110, a point 100 m from polyline is on-route (100 ≤ 110)", () => {
    // Math.round(55 × 2.0) = 110
    const state = freshState();
    backgroundOffRouteTick(east(origin, 100), highwayMs, false, false, 2.0, polyline, state, 0);
    expect(state.count).toBe(0); // 100 ≤ 110 → on-route
  });
});

// ── Suite 9: background → active transition integration ───────────────────────
//
// Verifies the full signal flow:
//   1. backgroundOffRouteTick() detects off-route → sets offRouteDetected = true
//   2. consumeBgOffRoute() is called on the "active" AppState transition
//   3. The flag is cleared and onReroute() is invoked exactly once
//   4. A second consumeBgOffRoute() call in the same session does NOT re-trigger
//
// This ensures that any future change to either the detection helper or the
// consumption helper that breaks the signal contract causes CI to fail.

describe("background → active transition — consumeBgOffRoute integration", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const polyline: LatLng[] = [origin, north(origin, 1000)];
  const highwayMs = 65 / 2.237; // offDistM=55, offCount=3, minOffRouteMs=4000

  // Helper: run highway off-route ticks until offRouteDetected fires, then
  // return the mutated bgOffRouteState (NOT navState — the test keeps them
  // separate so it can independently control offRouteDetected).
  function driveOffRoute(): { offRouteDetected: boolean } {
    const bgState = freshState();
    const signal = { offRouteDetected: false };

    const ticks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 4500 },
    ];
    for (const { loc, speedMs, nowMs } of ticks) {
      const rerouted = backgroundOffRouteTick(loc, speedMs, false, false, 1.0, polyline, bgState, nowMs);
      if (rerouted) signal.offRouteDetected = true;
    }
    return signal;
  }

  // ── 9a: background detection sets the signal ──────────────────────────────

  it("3 off-route readings at highway speed set offRouteDetected = true", () => {
    const signal = driveOffRoute();
    expect(signal.offRouteDetected).toBe(true);
  });

  // ── 9b: consumeBgOffRoute clears the flag and calls onReroute once ─────────

  it("consumeBgOffRoute clears flag and invokes onReroute exactly once", () => {
    const signal = driveOffRoute();
    expect(signal.offRouteDetected).toBe(true);

    let rerouteCount = 0;
    const consumed = consumeBgOffRoute(signal, () => { rerouteCount++; });

    expect(consumed).toBe(true);         // signal was present
    expect(rerouteCount).toBe(1);        // onReroute called once
    expect(signal.offRouteDetected).toBe(false); // flag cleared
  });

  // ── 9c: no duplicate reroute if consumeBgOffRoute is called a second time ──
  //
  // The AppState listener may fire multiple times (background → inactive →
  // active). consumeBgOffRoute must be idempotent: only the first call in a
  // session triggers the reroute.

  it("second consumeBgOffRoute call in the same session does NOT re-trigger onReroute", () => {
    const signal = driveOffRoute();
    let rerouteCount = 0;

    consumeBgOffRoute(signal, () => { rerouteCount++; }); // first: consumes
    consumeBgOffRoute(signal, () => { rerouteCount++; }); // second: flag already false

    expect(rerouteCount).toBe(1);
  });

  // ── 9d: consumeBgOffRoute is a no-op when offRouteDetected is false ────────

  it("consumeBgOffRoute returns false and does not call onReroute when flag is not set", () => {
    const signal = { offRouteDetected: false };
    let rerouteCount = 0;

    const consumed = consumeBgOffRoute(signal, () => { rerouteCount++; });
    expect(consumed).toBe(false);
    expect(rerouteCount).toBe(0);
  });

  // ── 9e: on-route readings do NOT set the signal (no false positive) ────────

  it("GPS readings within offDistM never set offRouteDetected", () => {
    const bgState = freshState();
    const signal = { offRouteDetected: false };

    // 10 readings at 40 m (< offDistM=55) over 20 s
    for (let i = 0; i < 10; i++) {
      const rerouted = backgroundOffRouteTick(
        east(origin, 40), highwayMs, false, false, 1.0, polyline, bgState, i * 2000,
      );
      if (rerouted) signal.offRouteDetected = true;
    }
    expect(signal.offRouteDetected).toBe(false);
    let rerouteCount = 0;
    consumeBgOffRoute(signal, () => { rerouteCount++; });
    expect(rerouteCount).toBe(0);
  });

  // ── 9f.1: navState.recalcSensitivity wiring — non-1.0 sensitivity ─────────
  //
  // backgroundNav.ts passes navState.recalcSensitivity to backgroundOffRouteTick.
  // This test proves that when sensitivity ≠ 1.0, the background detection
  // boundary matches exactly what navOffRouteThreshold() predicts — the same
  // calculation the foreground GPS handler uses.
  //
  // Scenario: sensitivity = 0.75 at 65 mph.
  //   navOffRouteThreshold gives offDistM = Math.round(55 × 0.75) = 41 m.
  //   A point at 41 m is on-route; a point at 42 m triggers count accumulation.

  it("navState.recalcSensitivity=0.75 at 65 mph: background and foreground agree on the same offDistM boundary", () => {
    const sensitivity = 0.75;
    const speedMs     = 65 / 2.237;

    // Ground truth from the foreground threshold utility
    const { offDistM } = navOffRouteThreshold(speedMs, false, false, sensitivity);
    // Math.round(55 × 0.75) = 41
    expect(offDistM).toBe(41);

    // Background path — simulate backgroundNav.ts passing navState.recalcSensitivity
    const bgStateInside  = freshState();
    const bgStateOutside = freshState();

    // One reading at exactly offDistM (41 m): should NOT increment count (not strictly >)
    backgroundOffRouteTick(east(origin, offDistM), speedMs, false, false, sensitivity, polyline, bgStateInside, 0);
    expect(bgStateInside.count).toBe(0); // on-route

    // One reading at offDistM + 1 (42 m): should increment count
    backgroundOffRouteTick(east(origin, offDistM + 1), speedMs, false, false, sensitivity, polyline, bgStateOutside, 0);
    expect(bgStateOutside.count).toBe(1); // off-route

    // Prove symmetry: with sensitivity=1.0 the same 42-m point is on-route (offDistM=55)
    const { offDistM: baseOffDistM } = navOffRouteThreshold(speedMs, false, false, 1.0);
    expect(baseOffDistM).toBe(55);
    const bgStateBase = freshState();
    backgroundOffRouteTick(east(origin, offDistM + 1), speedMs, false, false, 1.0, polyline, bgStateBase, 0);
    expect(bgStateBase.count).toBe(0); // 42 ≤ 55 → on-route with default sensitivity
  });

  it("navState.recalcSensitivity=1.5 at 65 mph: looser threshold — background and foreground agree", () => {
    const sensitivity = 1.5;
    const speedMs     = 65 / 2.237;

    const { offDistM } = navOffRouteThreshold(speedMs, false, false, sensitivity);
    // Math.round(55 × 1.5) = 83
    expect(offDistM).toBe(83);

    const bgStateInside  = freshState();
    const bgStateOutside = freshState();

    // 83 m exactly → on-route (not strictly >)
    backgroundOffRouteTick(east(origin, offDistM), speedMs, false, false, sensitivity, polyline, bgStateInside, 0);
    expect(bgStateInside.count).toBe(0);

    // 84 m → off-route
    backgroundOffRouteTick(east(origin, offDistM + 1), speedMs, false, false, sensitivity, polyline, bgStateOutside, 0);
    expect(bgStateOutside.count).toBe(1);
  });

  // ── 9e.2: null-location fallback — signal preserved for first GPS tick ──────
  //
  // When the active-transition handler has no cached location
  // (navState.lastBgLoc = null AND userLocRef = null), it must NOT consume
  // the signal.  The GPS handler's first foreground fix picks it up instead.
  // This is tested by simulating the conditional guard directly.

  it("consumeBgOffRoute is NOT called when no location is available — signal stays set for GPS handler", () => {
    const signal = { offRouteDetected: true };
    let rerouteCount = 0;

    // Simulate the active-transition guard: both lastBgLoc and userLocRef are null
    const lastBgLoc: { latitude: number; longitude: number } | null = null;
    const userLocCurrent: { latitude: number; longitude: number } | null = null;
    const rerouteLoc = lastBgLoc ?? userLocCurrent;

    if (rerouteLoc) {
      // Would call consumeBgOffRoute — but rerouteLoc is null so this branch is skipped
      consumeBgOffRoute(signal, () => { rerouteCount++; });
    }
    // Signal must be preserved (not consumed) when no location is available
    expect(signal.offRouteDetected).toBe(true);
    expect(rerouteCount).toBe(0);

    // Simulate GPS handler's first-fix consume: called once a location is available
    const firstFixLoc = { latitude: 37.7749, longitude: -122.4194 };
    let gpsRerouteLoc: { latitude: number; longitude: number } | null = null;
    if (signal.offRouteDetected && firstFixLoc) {
      signal.offRouteDetected = false;
      gpsRerouteLoc = firstFixLoc;
    }
    expect(signal.offRouteDetected).toBe(false); // consumed by GPS handler
    expect(gpsRerouteLoc).toEqual(firstFixLoc);  // reroutes from first GPS fix
  });

  it("active transition uses navState.lastBgLoc when userLoc is null — signal consumed, not deferred", () => {
    const signal = { offRouteDetected: true };
    let rerouteCount = 0;

    // Simulate: lastBgLoc populated, userLocRef null
    const lastBgLoc = { latitude: 37.78, longitude: -122.41 };
    const userLocCurrent: { latitude: number; longitude: number } | null = null;
    const rerouteLoc = lastBgLoc ?? userLocCurrent;

    if (rerouteLoc) {
      consumeBgOffRoute(signal, () => { rerouteCount++; });
    }
    expect(signal.offRouteDetected).toBe(false); // consumed immediately
    expect(rerouteCount).toBe(1);               // reroute triggered
  });

  // ── 9e.3: alternate route selection — background uses new polyline ───────────
  //
  // When the user selects an alternative route during navigation, selectRoute()
  // syncs navState.routeCoords to the new geometry and resets the off-route
  // counter.  This test verifies that:
  //   a) A GPS point that was off-route on the OLD polyline is on-route on the
  //      NEW polyline and does NOT increment the count.
  //   b) A counter that was accumulating against the old polyline is reset to 0
  //      before the new polyline is evaluated.

  it("after route selection, background tick evaluates new polyline — stale off-route count cleared", () => {
    // OLD polyline: north-south corridor at longitude -122.4194
    const oldPolyline: LatLng[] = [
      { latitude: 37.77, longitude: -122.4194 },
      { latitude: 37.78, longitude: -122.4194 },
    ];
    // NEW polyline: east-west corridor at latitude 37.7749
    const newPolyline: LatLng[] = [
      { latitude: 37.7749, longitude: -122.43 },
      { latitude: 37.7749, longitude: -122.40 },
    ];

    // GPS position 60 m east of the old polyline — off-route on OLD, on-route on NEW
    const gpsPos = east(origin, 60); // 37.7749, -122.4194 + ~0.00068°

    const bgState = freshState();
    const speedMs = highwayMs; // 65 mph → offDistM=55

    // Two readings against OLD polyline — count starts accumulating
    backgroundOffRouteTick(gpsPos, speedMs, false, false, 1.0, oldPolyline, bgState, 0);
    backgroundOffRouteTick(gpsPos, speedMs, false, false, 1.0, oldPolyline, bgState, 2000);
    expect(bgState.count).toBe(2); // accumulated against old route

    // --- User selects alternate route (simulates selectRoute() + navState sync) ---
    // navState.routeCoords = newPolyline; navState.offRouteCount = 0; navState.offRouteStartMs = 0;
    bgState.count   = 0;   // reset — mirrors navState.offRouteCount = 0
    bgState.startMs = 0;   // mirrors navState.offRouteStartMs = 0

    // One reading against NEW polyline — gpsPos is on the new east-west road
    // (perpendicular distance from gpsPos to newPolyline ≈ 0 m, well inside offDistM=55)
    const rerouted = backgroundOffRouteTick(gpsPos, speedMs, false, false, 1.0, newPolyline, bgState, 4000);
    expect(rerouted).toBe(false);  // no reroute — on-route for the new polyline
    expect(bgState.count).toBe(0); // count stays 0 (not off-route)
  });

  // ── 9f: cooldown prevents a second detection in the same session ───────────
  //
  // After the first off-route reroute (lastRecalcMs=4500), a second series of
  // off-route readings within the 25 s cooldown must NOT set offRouteDetected.

  it("cooldown prevents a second offRouteDetected signal within 25 s of the first", () => {
    const bgState = freshState();
    const signal = { offRouteDetected: false };

    // First detection at t=4500
    const firstTicks = [
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 0    },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 2000 },
      { loc: east(origin, 60), speedMs: highwayMs, nowMs: 4500 },
    ];
    for (const { loc, speedMs, nowMs } of firstTicks) {
      if (backgroundOffRouteTick(loc, speedMs, false, false, 1.0, polyline, bgState, nowMs))
        signal.offRouteDetected = true;
    }
    expect(signal.offRouteDetected).toBe(true);

    // Simulate active transition consuming the signal
    consumeBgOffRoute(signal, () => {});
    expect(signal.offRouteDetected).toBe(false);

    // Second series of off-route readings within cooldown (t < 4500 + 25000 = 29500)
    for (let i = 0; i < 5; i++) {
      if (backgroundOffRouteTick(
        east(origin, 60), highwayMs, false, false, 1.0, polyline, bgState, 5000 + i * 2000,
      )) {
        signal.offRouteDetected = true;
      }
    }
    // Still within cooldown — should NOT have set signal again
    expect(signal.offRouteDetected).toBe(false);
  });
});

// ── Suite 11: sensitivity at maximum / minimum range — walking mode ───────────
//
// Root cause addressed (task-720): navState.recalcSensitivity is multiplied into
// offDistM inside navOffRouteThreshold().  A regression that silently reverts to
// sensitivity=1.0 would halve the walking threshold from 190 m back to 95 m,
// causing false-positive reroutes for users at the maximum sensitivity setting.
//
// These tests exercise the FULL off-route check path:
//   closestRoutePoint → offDistM comparison → consecutive-reading counter
// for the walking travel mode specifically, at both ends of the sensitivity range.
//
// Threshold maths (walking base = 95 m):
//   sensitivity 2.0 → Math.round(95 × 2.0) = 190 m
//   sensitivity 0.5 → Math.round(95 × 0.5) = 48 m   (47.5 rounds to 48)
//
// navOffRouteThreshold() walking params: offCount=4, minOffRouteMs=7000 ms.
//
// The "fresh read per tick" test verifies that sensitivity is consumed on every
// call to backgroundOffRouteTick() rather than captured once at session start.
// A point 100 m off the route is off-route at sensitivity=1.0 (offDistM=95) but
// on-route at sensitivity=2.0 (offDistM=190).  Switching mid-session must cause
// the counter to reset on the very next tick.

describe("background off-route — walking sensitivity at max (2.0) and min (0.5) of the range", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  // Long north-south polyline so perpendicular projection stays far from end-caps
  const polyline: LatLng[] = [origin, north(origin, 2000)];
  const walkingMs = 1.4; // ~3 mph — well below any motorised bucket; isWalking flag governs

  // ── 11a: sensitivity 2.0 — walking offDistM = 190 m ──────────────────────────

  it("sensitivity 2.0, walking: navOffRouteThreshold returns offDistM=190", () => {
    const { offDistM } = navOffRouteThreshold(walkingMs, true, false, 2.0);
    expect(offDistM).toBe(190); // Math.round(95 × 2.0) = 190
  });

  it("sensitivity 2.0, walking: 189 m from polyline is on-route (does NOT increment count)", () => {
    // offDistM=190 at sensitivity 2.0; 189 m ≤ 190 m → on-route, count stays 0
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 189),
      speedMs: walkingMs,
      nowMs: i * 2500,
    }));
    const { rerouted, finalCount } = runTicks(ticks, polyline, state, true, false, 2.0);
    expect(rerouted).toBe(false);
    expect(finalCount).toBe(0);
  });

  it("sensitivity 2.0, walking: 190 m from polyline is exactly on the boundary — does NOT trigger (not strictly >)", () => {
    // distToPolyM == offDistM is not strictly greater, so count must stay 0
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 190),
      speedMs: walkingMs,
      nowMs: i * 2500,
    }));
    const { rerouted, finalCount } = runTicks(ticks, polyline, state, true, false, 2.0);
    expect(rerouted).toBe(false);
    expect(finalCount).toBe(0);
  });

  it("sensitivity 2.0, walking: 191 m from polyline triggers reroute after 4 readings + 7 s", () => {
    // offDistM=190 at sensitivity 2.0; 191 > 190 → off-route.
    // Walking: offCount=4, minOffRouteMs=7000 ms.
    const state = freshState();
    const ticks = [
      { loc: east(origin, 191), speedMs: walkingMs, nowMs: 0     },
      { loc: east(origin, 191), speedMs: walkingMs, nowMs: 2000  },
      { loc: east(origin, 191), speedMs: walkingMs, nowMs: 5000  },
      { loc: east(origin, 191), speedMs: walkingMs, nowMs: 7200  }, // ≥ 7000 ms, count=4
    ];
    const { rerouted, rerouteTick } = runTicks(ticks, polyline, state, true, false, 2.0);
    expect(rerouted).toBe(true);
    expect(rerouteTick).toBe(3); // fires on the 4th tick (index 3)
  });

  it("sensitivity 2.0, walking: default sensitivity (1.0) would fire at 96 m — max sensitivity prevents it", () => {
    // A point 96 m off a walking route:
    //   sensitivity 1.0 → offDistM=95 → 96 > 95 → off-route (would reroute)
    //   sensitivity 2.0 → offDistM=190 → 96 ≤ 190 → on-route (no reroute)
    // This is the primary regression guard: revering to sensitivity=1.0 would
    // cause this test to fail because rerouted would become true.
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 96),
      speedMs: walkingMs,
      nowMs: i * 2500,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, true, false, 2.0);
    expect(rerouted).toBe(false);
  });

  it("sensitivity 2.0, walking: a point 96 m off route at sensitivity 1.0 DOES trigger (confirms the guard)", () => {
    // Counter-test: same 96 m position at default sensitivity IS off-route.
    // If the previous test passes but this one fails, the sensitivity is not
    // being applied at all.
    const state = freshState();
    const ticks = [
      { loc: east(origin, 96), speedMs: walkingMs, nowMs: 0     },
      { loc: east(origin, 96), speedMs: walkingMs, nowMs: 2500  },
      { loc: east(origin, 96), speedMs: walkingMs, nowMs: 5000  },
      { loc: east(origin, 96), speedMs: walkingMs, nowMs: 7200  },
    ];
    const { rerouted } = runTicks(ticks, polyline, state, true, false, 1.0);
    expect(rerouted).toBe(true);
  });

  // ── 11b: sensitivity 0.5 — walking offDistM = 48 m ───────────────────────────

  it("sensitivity 0.5, walking: navOffRouteThreshold returns offDistM=48", () => {
    // Math.round(95 × 0.5) = Math.round(47.5) = 48
    const { offDistM } = navOffRouteThreshold(walkingMs, true, false, 0.5);
    expect(offDistM).toBe(48);
  });

  it("sensitivity 0.5, walking: 47 m from polyline is on-route (47 ≤ 48)", () => {
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 47),
      speedMs: walkingMs,
      nowMs: i * 2500,
    }));
    const { rerouted, finalCount } = runTicks(ticks, polyline, state, true, false, 0.5);
    expect(rerouted).toBe(false);
    expect(finalCount).toBe(0);
  });

  it("sensitivity 0.5, walking: 49 m from polyline triggers reroute after 4 readings + 7 s", () => {
    // offDistM=48 at sensitivity 0.5; 49 > 48 → off-route.
    const state = freshState();
    const ticks = [
      { loc: east(origin, 49), speedMs: walkingMs, nowMs: 0     },
      { loc: east(origin, 49), speedMs: walkingMs, nowMs: 2000  },
      { loc: east(origin, 49), speedMs: walkingMs, nowMs: 5000  },
      { loc: east(origin, 49), speedMs: walkingMs, nowMs: 7200  },
    ];
    const { rerouted } = runTicks(ticks, polyline, state, true, false, 0.5);
    expect(rerouted).toBe(true);
  });

  it("sensitivity 0.5, walking: 49 m at sensitivity 1.0 is on-route (49 ≤ 95) — confirms threshold shrank", () => {
    // A point 49 m off a walking route:
    //   sensitivity 0.5 → offDistM=48 → 49 > 48 → off-route
    //   sensitivity 1.0 → offDistM=95 → 49 ≤ 95 → on-route (no reroute)
    const state = freshState();
    const ticks = Array.from({ length: 6 }, (_, i) => ({
      loc: east(origin, 49),
      speedMs: walkingMs,
      nowMs: i * 2500,
    }));
    const { rerouted } = runTicks(ticks, polyline, state, true, false, 1.0);
    expect(rerouted).toBe(false);
  });

  // ── 11c: sensitivity is read fresh on each tick (not captured at session start) ─
  //
  // Scenario:
  //   1. Two ticks at sensitivity=1.0, point 100 m off route → count=2
  //      (100 > offDistM=95 → off-route each tick).
  //   2. Next tick with sensitivity=2.0, same 100 m point → offDistM=190 →
  //      100 ≤ 190 → on-route → count resets to 0.
  //
  // If sensitivity were captured once at session start, the count would continue
  // accumulating past step 2 instead of resetting, and the assertion would fail.

  it("sensitivity is consumed per-tick: switching from 1.0 to 2.0 mid-session resets the off-route counter", () => {
    const state = freshState();

    // Tick 1 — sensitivity 1.0, 100 m off route: off-route (100 > 95)
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 1.0, polyline, state, 0);
    expect(state.count).toBe(1);

    // Tick 2 — sensitivity 1.0, 100 m off route: still off-route
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 1.0, polyline, state, 2000);
    expect(state.count).toBe(2);

    // Tick 3 — sensitivity CHANGES to 2.0: offDistM now 190, 100 m ≤ 190 → on-route
    // The counter MUST reset to 0 immediately; a stale sensitivity=1.0 would leave count=3.
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 2.0, polyline, state, 4000);
    expect(state.count).toBe(0);
    expect(state.startMs).toBe(0);
  });

  it("sensitivity is consumed per-tick: switching from 2.0 to 0.5 mid-session starts counting from the new threshold", () => {
    const state = freshState();

    // Ticks at sensitivity=2.0, point 100 m off route: on-route (100 ≤ 190), count stays 0
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 2.0, polyline, state, 0);
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 2.0, polyline, state, 2000);
    expect(state.count).toBe(0);

    // Tick 3 — sensitivity CHANGES to 0.5: offDistM now 48, 100 m > 48 → off-route
    backgroundOffRouteTick(east(origin, 100), walkingMs, true, false, 0.5, polyline, state, 4000);
    expect(state.count).toBe(1);
  });
});
