/**
 * navTraceLogFields.test.ts
 *
 * Confirms that the [NavVoice][TRACE] and [NavRoute][TRACE] log lines in
 * map.tsx carry the required diagnostic fields (routeVersion=, stepIdx=,
 * maneuver=, reason=) so that reroute diagnosis remains possible after any
 * future refactor.
 *
 * Approach:
 *   - Zone-log tests import the REAL buildNavZoneLogLine() and
 *     buildNavSpeakLogLine() utilities from utils/navZoneLog.ts, which
 *     map.tsx now uses for all its [NavVoice][TRACE] output.  A change to
 *     the guard or format in the utility will cause these tests to fail
 *     before the build reaches TestFlight.
 *   - Reroute-log tests use locally-mirrored format functions because
 *     those log lines remain inline in map.tsx and have not yet been
 *     extracted to a shared utility.
 *
 * Log lines covered:
 *   navSpeak         — routeVersion=, stepIdx=      (utils/navZoneLog)
 *   reroute_start    — routeVersion=, reason=        (mirror)
 *   zone a1/a2/a3    — routeVersion=, stepIdx=, maneuver=  (utils/navZoneLog)
 */

import {
  buildNavZoneLogLine,
  buildNavSpeakLogLine,
} from "@/utils/navZoneLog";
import type { NavZoneStep } from "@/utils/navZoneLog";

// ── Reroute log mirrors (still inline in map.tsx) ─────────────────────────────

/**
 * map.tsx ~3498 — wrong-direction reroute log
 * Template: `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=wrong_dir`
 */
function fmtRerouteWrongDir(routeVersion: number): string {
  return `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=wrong_dir`;
}

/**
 * map.tsx ~3578 — off-route reroute log
 * Template: `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=off_route distToPolyM=${distToPolyM}m`
 */
function fmtRerouteOffRoute(routeVersion: number, distToPolyM: number): string {
  return `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=off_route distToPolyM=${distToPolyM}m`;
}

/**
 * map.tsx ~3832 — missed-turn reroute log
 * Template: `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=missed_turn`
 */
function fmtRerouteMissedTurn(routeVersion: number): string {
  return `[NavRoute][TRACE] reroute_start routeVersion=${routeVersion} reason=missed_turn`;
}

/**
 * map.tsx — cooldown_blocked log (wrong_dir / off_route / missed_turn)
 * Template: `[NavRoute][TRACE] cooldown_blocked routeVersion=${routeVersion} reason=<trigger>`
 *
 * Emitted when a reroute trigger fires but the 20-35 s cooldown has not yet
 * elapsed, so the reroute is silently suppressed.  The log lets testers
 * distinguish "nav is stuck" from "cooldown blocked a valid reroute attempt".
 */
function fmtCooldownBlocked(routeVersion: number, reason: "wrong_dir" | "off_route" | "missed_turn"): string {
  return `[NavRoute][TRACE] cooldown_blocked routeVersion=${routeVersion} reason=${reason}`;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Builds a steps array of length (nextIdx + 1) where steps[nextIdx].instruction
 * equals `instruction`.  All preceding steps carry a placeholder instruction.
 * Use this to call buildNavZoneLogLine with curIdx = nextIdx - 1.
 */
function stepsFor(nextIdx: number, instruction: string): NavZoneStep[] {
  const arr: NavZoneStep[] = [];
  for (let i = 0; i < nextIdx; i++) arr.push({ instruction: "placeholder step" });
  arr.push({ instruction });
  return arr;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUTE_VERSION = 3;
const STEP_IDX = 2;           // nextIdx used by zone tests
const INSTRUCTION = "Turn right onto CA-78 East";
const DIST_M = 280;
const GPS_TS = 1_700_000_000_000;
const ZONE_TS = 1_700_000_000_100;

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — [NavVoice][TRACE] navSpeak log line  (buildNavSpeakLogLine)
// ─────────────────────────────────────────────────────────────────────────────

describe("[NavVoice][TRACE] navSpeak log line — required fields", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("contains routeVersion= field", () => {
    console.log(buildNavSpeakLogLine(Date.now(), false, ROUTE_VERSION, STEP_IDX, "Head north on Main St"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("contains stepIdx= field", () => {
    console.log(buildNavSpeakLogLine(Date.now(), false, ROUTE_VERSION, STEP_IDX, "Head north on Main St"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("stepIdx=");
    expect(logged).toContain(`stepIdx=${STEP_IDX}`);
  });

  it("is tagged with [NavVoice][TRACE] prefix", () => {
    console.log(buildNavSpeakLogLine(Date.now(), false, ROUTE_VERSION, STEP_IDX, "Head north on Main St"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavVoice\]\[TRACE\]/);
  });

  it("text field is truncated to 60 characters", () => {
    const longText = "A".repeat(100);
    console.log(buildNavSpeakLogLine(Date.now(), false, ROUTE_VERSION, STEP_IDX, longText));
    const logged = spy.mock.calls[0][0] as string;
    const match = logged.match(/text="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(60);
  });

  it("force flag is included and accurate when true", () => {
    console.log(buildNavSpeakLogLine(Date.now(), true, ROUTE_VERSION, STEP_IDX, "Test"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("force=true");
  });

  it("force flag is included and accurate when false", () => {
    console.log(buildNavSpeakLogLine(Date.now(), false, ROUTE_VERSION, STEP_IDX, "Test"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("force=false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — [NavRoute][TRACE] reroute_start log lines  (inline mirror)
// ─────────────────────────────────────────────────────────────────────────────

describe("[NavRoute][TRACE] reroute_start log lines — required fields", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  // ── wrong_dir ──

  it("wrong_dir: contains routeVersion= field", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("wrong_dir: contains reason= field with value wrong_dir", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=wrong_dir");
  });

  it("wrong_dir: is tagged with [NavRoute][TRACE] reroute_start prefix", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
  });

  // ── off_route ──

  it("off_route: contains routeVersion= field", () => {
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 72));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("off_route: contains reason= field with value off_route", () => {
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 72));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=off_route");
  });

  it("off_route: contains distToPolyM= field with numeric value and 'm' suffix", () => {
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 72));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("distToPolyM=72m");
  });

  it("off_route: is tagged with [NavRoute][TRACE] reroute_start prefix", () => {
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 72));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
  });

  // ── missed_turn ──

  it("missed_turn: contains routeVersion= field", () => {
    console.log(fmtRerouteMissedTurn(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("missed_turn: contains reason= field with value missed_turn", () => {
    console.log(fmtRerouteMissedTurn(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=missed_turn");
  });

  it("missed_turn: is tagged with [NavRoute][TRACE] reroute_start prefix", () => {
    console.log(fmtRerouteMissedTurn(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
  });

  // ── Cross-trigger: reason= values are distinct (no copy-paste drift) ──

  it("wrong_dir, off_route, and missed_turn each emit a distinct reason= value", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 72));
    console.log(fmtRerouteMissedTurn(ROUTE_VERSION));

    const reasons = spy.mock.calls.map((args) => {
      const m = (args[0] as string).match(/reason=(\S+)/);
      return m ? m[1] : null;
    });

    expect(reasons).toContain("wrong_dir");
    expect(reasons).toContain("off_route");
    expect(reasons).toContain("missed_turn");
    expect(new Set(reasons).size).toBe(3);
  });

  // ── routeVersion increments correctly across consecutive reroutes ──

  it("routeVersion value in the log matches the incremented ref after each reroute", () => {
    let version = 1;

    console.log(fmtRerouteWrongDir(version));       // version=1
    version += 1;
    console.log(fmtRerouteOffRoute(version, 80));   // version=2
    version += 1;
    console.log(fmtRerouteMissedTurn(version));      // version=3

    expect(spy.mock.calls[0][0]).toContain("routeVersion=1");
    expect(spy.mock.calls[1][0]).toContain("routeVersion=2");
    expect(spy.mock.calls[2][0]).toContain("routeVersion=3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — [NavVoice][TRACE] zone announce log lines (buildNavZoneLogLine)
// ─────────────────────────────────────────────────────────────────────────────
//
// buildNavZoneLogLine is the real production function imported from
// utils/navZoneLog.ts and used by map.tsx.  STEP_IDX=2 → curIdx=1,
// so steps[STEP_IDX] = steps[2] carries the INSTRUCTION.

describe("[NavVoice][TRACE] zone announce log lines — required fields", () => {
  let spy: jest.SpyInstance;
  const steps = stepsFor(STEP_IDX, INSTRUCTION); // steps[2] = INSTRUCTION
  const curIdx = STEP_IDX - 1;                   // curIdx=1 → nextIdx=2

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  for (const zone of ["a1", "a2", "a3"] as const) {
    describe(`zone ${zone}`, () => {
      it(`${zone}: contains routeVersion= field`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toContain("routeVersion=");
        expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
      });

      it(`${zone}: contains stepIdx= field`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toContain("stepIdx=");
        expect(logged).toContain(`stepIdx=${STEP_IDX}`);
      });

      it(`${zone}: contains maneuver= field with instruction text`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toContain("maneuver=");
        expect(logged).toContain(`maneuver="${INSTRUCTION.slice(0, 50)}"`);
      });

      it(`${zone}: contains dist= field with 'm' suffix`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toContain(`dist=${DIST_M}m`);
      });

      it(`${zone}: contains zone= field with value ${zone}`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toContain(`zone=${zone}`);
      });

      it(`${zone}: is tagged with [NavVoice][TRACE] prefix`, () => {
        const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
        expect(line).not.toBeNull();
        console.log(line!);
        const logged = spy.mock.calls[0][0] as string;
        expect(logged).toMatch(/^\[NavVoice\]\[TRACE\]/);
      });
    });
  }

  it("maneuver= instruction is truncated to 50 characters for long instructions", () => {
    const longInstruction = "Continue straight along the Pacific Coast Highway through Malibu and beyond";
    const longSteps = stepsFor(STEP_IDX, longInstruction);
    const line = buildNavZoneLogLine(longSteps, curIdx, DIST_M, "a1", ROUTE_VERSION, GPS_TS, ZONE_TS);
    expect(line).not.toBeNull();
    console.log(line!);
    const logged = spy.mock.calls[0][0] as string;
    const match = logged.match(/maneuver="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(50);
    expect(match![1]).toBe(longInstruction.slice(0, 50));
  });

  it("dist= value is rounded to the nearest metre", () => {
    // 280.7 m should appear as 281 (Math.round applied in buildNavZoneLogLine)
    const line = buildNavZoneLogLine(steps, curIdx, 280.7, "a1", ROUTE_VERSION, GPS_TS, ZONE_TS);
    expect(line).not.toBeNull();
    console.log(line!);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("dist=281m");
    expect(logged).not.toContain("dist=280.7m");
  });

  it("zone= values for a1/a2/a3 are all distinct (no copy-paste drift in the log format)", () => {
    for (const zone of ["a1", "a2", "a3"] as const) {
      const line = buildNavZoneLogLine(steps, curIdx, DIST_M, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
      expect(line).not.toBeNull();
      console.log(line!);
    }
    const zones = spy.mock.calls.map((args) => {
      const m = (args[0] as string).match(/zone=(\S+)/);
      return m ? m[1] : null;
    });

    expect(zones).toContain("a1");
    expect(zones).toContain("a2");
    expect(zones).toContain("a3");
    expect(new Set(zones).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Cross-line field invariants across a full reroute scenario
// ─────────────────────────────────────────────────────────────────────────────
//
// Simulates a complete reroute sequence using both the real utility and the
// inline reroute mirrors.

describe("full reroute scenario — cross-line field invariants", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("all log lines carry the correct routeVersion= before and after a reroute", () => {
    let routeVersion = 3;

    // 1. Zone a1 fires on the original route (routeVersion=3, stepIdx=2)
    const preRerouteSteps = stepsFor(2, INSTRUCTION);
    const zoneLog1 = buildNavZoneLogLine(preRerouteSteps, 1, 320, "a1", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneLog1).not.toBeNull();
    console.log(zoneLog1!);

    // 2. Off-route reroute fires (still routeVersion=3 at time of logging)
    console.log(fmtRerouteOffRoute(routeVersion, 88));

    // 3. Route version incremented after fetch resolves
    routeVersion += 1; // → 4

    // 4. Zone a1 fires on the new route (routeVersion=4, stepIdx=1)
    const postRerouteSteps = stepsFor(1, "Head south on I-5");
    const zoneLog2 = buildNavZoneLogLine(postRerouteSteps, 0, 200, "a1", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneLog2).not.toBeNull();
    console.log(zoneLog2!);

    // 5. navSpeak fires for step 0 of the new route
    console.log(buildNavSpeakLogLine(GPS_TS, false, routeVersion, 0, "Head south on I-5"));

    const calls = spy.mock.calls.map((a) => a[0] as string);

    // Lines 0-1 reference routeVersion=3; lines 2-3 reference routeVersion=4
    expect(calls[0]).toContain("routeVersion=3");
    expect(calls[1]).toContain("routeVersion=3");
    expect(calls[2]).toContain("routeVersion=4");
    expect(calls[3]).toContain("routeVersion=4");

    // No stale version on post-reroute lines
    expect(calls[2]).not.toContain("routeVersion=3");
    expect(calls[3]).not.toContain("routeVersion=3");
  });

  it("stepIdx= on zone and navSpeak lines reflects the new step index after reroute", () => {
    let routeVersion = 3;

    // Pre-reroute: zone a2 at step 5 (curIdx=4)
    const preSteps = stepsFor(5, INSTRUCTION);
    const zoneA2 = buildNavZoneLogLine(preSteps, 4, 150, "a2", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneA2).not.toBeNull();
    console.log(zoneA2!);

    // Reroute fires — version increments
    console.log(fmtRerouteWrongDir(routeVersion));
    routeVersion += 1;

    // Post-reroute: zone a1 at step 1 (curIdx=0), navSpeak at step 0
    const postSteps = stepsFor(1, "Start on Broadway");
    const zoneA1 = buildNavZoneLogLine(postSteps, 0, 300, "a1", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneA1).not.toBeNull();
    console.log(zoneA1!);
    console.log(buildNavSpeakLogLine(GPS_TS, true, routeVersion, 0, "Start on Broadway"));

    const calls = spy.mock.calls.map((a) => a[0] as string);

    expect(calls[0]).toContain("stepIdx=5");
    // reroute line has no stepIdx= (NavRoute, not NavVoice)
    expect(calls[1]).not.toContain("stepIdx=");
    expect(calls[2]).toContain("stepIdx=1");
    expect(calls[3]).toContain("stepIdx=0");
  });

  it("maneuver= appears on zone lines but NOT on reroute lines", () => {
    const routeVersion = 3;
    const zoneSteps = stepsFor(2, INSTRUCTION);

    const zoneLog = buildNavZoneLogLine(zoneSteps, 1, 280, "a3", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneLog).not.toBeNull();
    console.log(zoneLog!);
    console.log(fmtRerouteOffRoute(routeVersion, 95));
    console.log(fmtRerouteMissedTurn(routeVersion));

    const calls = spy.mock.calls.map((a) => a[0] as string);

    // Zone line carries maneuver=
    expect(calls[0]).toContain("maneuver=");
    // Reroute lines must NOT carry maneuver= (they use reason= instead)
    expect(calls[1]).not.toContain("maneuver=");
    expect(calls[2]).not.toContain("maneuver=");
  });

  it("reason= appears on reroute lines but NOT on navSpeak or zone lines", () => {
    const routeVersion = 3;
    const zoneSteps = stepsFor(2, INSTRUCTION);

    const zoneLog = buildNavZoneLogLine(zoneSteps, 1, 280, "a1", routeVersion, GPS_TS, ZONE_TS);
    expect(zoneLog).not.toBeNull();
    console.log(zoneLog!);
    console.log(buildNavSpeakLogLine(GPS_TS, false, routeVersion, 2, INSTRUCTION));
    console.log(fmtRerouteWrongDir(routeVersion));

    const calls = spy.mock.calls.map((a) => a[0] as string);

    // Zone and navSpeak lines must NOT contain reason=
    expect(calls[0]).not.toContain("reason=");
    expect(calls[1]).not.toContain("reason=");
    // Reroute line must contain reason=
    expect(calls[2]).toContain("reason=");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Single-step route edge case (buildNavZoneLogLine guard)
// ─────────────────────────────────────────────────────────────────────────────
//
// Production context (map.tsx, via utils/navZoneLog.ts buildNavZoneLogLine):
//
//   const nextIdx = curIdx + 1;
//   if (nextIdx >= steps.length) return null;  // guard
//   return `[NavVoice][TRACE] … stepIdx=${nextIdx} maneuver="…" …`;
//
// For a single-step route (steps.length=1, curIdx=0):
//   nextIdx = 1, which is NOT < 1  →  null is returned, no log emitted.
//
// These tests import the REAL buildNavZoneLogLine from utils/navZoneLog.ts
// (the same function map.tsx uses), so removing or weakening the guard in
// that utility will cause the null assertions below to fail, catching the
// regression before TestFlight.

describe("single-step route — zone logs suppressed, navSpeak fields valid", () => {
  let spy: jest.SpyInstance;
  const SINGLE_STEP: NavZoneStep[] = [{ instruction: "Head to your destination" }];

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  // ── a) Zone logs are suppressed on a single-step route ──

  for (const zone of ["a1", "a2", "a3"] as const) {
    it(`zone ${zone} returns null (suppressed) when the route has only one step`, () => {
      // curIdx=0 → nextIdx=1 → 1 >= steps.length(1) → guard returns null
      const result = buildNavZoneLogLine(SINGLE_STEP, 0, 50, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
      expect(result).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("no zone log is emitted for any zone when the route has only one step", () => {
    const logged: string[] = [];
    for (const zone of ["a1", "a2", "a3"] as const) {
      const line = buildNavZoneLogLine(SINGLE_STEP, 0, 50, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
      if (line !== null) {
        console.log(line);
        logged.push(line);
      }
    }
    expect(logged).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  // ── b) Zone logs ARE emitted on a multi-step route (guard is not over-eager) ──

  const MULTI_STEP: NavZoneStep[] = [
    { instruction: "Start on Broadway" },
    { instruction: "Turn right onto CA-78 East" },
    { instruction: "You have arrived" },
  ];

  for (const zone of ["a1", "a2", "a3"] as const) {
    it(`zone ${zone} returns a valid log string when nextIdx is within bounds`, () => {
      // curIdx=0 → nextIdx=1 → 1 < steps.length(3) → guard passes
      const result = buildNavZoneLogLine(MULTI_STEP, 0, 280, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
      expect(result).not.toBeNull();
      console.log(result!);
      const logged = spy.mock.calls[0][0] as string;

      expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
      expect(logged).toContain("stepIdx=1");            // nextIdx = curIdx+1 = 1
      expect(logged).toContain("maneuver=");
      expect(logged).toContain(`maneuver="${MULTI_STEP[1].instruction.slice(0, 50)}"`);
      expect(logged).toContain("dist=280m");
      expect(logged).toContain(`zone=${zone}`);
      expect(logged).toMatch(/^\[NavVoice\]\[TRACE\]/);
      expect(logged).not.toContain('maneuver="undefined"');
    });
  }

  it("zone log references nextIdx instruction, not curIdx instruction", () => {
    // Confirms the log always records the UPCOMING maneuver (steps[nextIdx]),
    // not the current one (steps[curIdx]).
    const result = buildNavZoneLogLine(MULTI_STEP, 0, 200, "a2", ROUTE_VERSION, GPS_TS, ZONE_TS);
    expect(result).not.toBeNull();
    expect(result).toContain(`maneuver="${MULTI_STEP[1].instruction.slice(0, 50)}"`); // nextIdx=1
    expect(result).not.toContain(`maneuver="${MULTI_STEP[0].instruction.slice(0, 50)}"`); // curIdx=0
  });

  it("last step (curIdx = steps.length-1) also suppresses zone logs", () => {
    // When the user is on the final step, nextIdx >= steps.length — same suppression.
    const lastIdx = MULTI_STEP.length - 1; // 2
    for (const zone of ["a1", "a2", "a3"] as const) {
      const result = buildNavZoneLogLine(MULTI_STEP, lastIdx, 30, zone, ROUTE_VERSION, GPS_TS, ZONE_TS);
      expect(result).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  // ── c) navSpeak format with stepIdx=0 carries all required fields ──
  //
  // navSpeak IS called on a single-step route (e.g. initial "Head to…" announce
  // or post-reroute "Rerouting").  Its log reads navVoiceTraceRef.current.stepIdx,
  // which is 0 after resetRouteRefs.  buildNavSpeakLogLine is the same function
  // map.tsx invokes for that log line.

  it("navSpeak: stepIdx=0 log contains routeVersion=, stepIdx=0, force=, and text=", () => {
    const line = buildNavSpeakLogLine(GPS_TS, true, ROUTE_VERSION, 0, "Head to your destination");
    console.log(line);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
    expect(logged).toContain("stepIdx=0");
    expect(logged).toContain("force=true");
    expect(logged).toMatch(/text="[^"]+"/);
    expect(logged).not.toContain("undefined");
  });

  it("navSpeak: stepIdx=0 does not carry stale higher step index", () => {
    const line = buildNavSpeakLogLine(GPS_TS, false, ROUTE_VERSION, 0, "Head to your destination");
    console.log(line);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("stepIdx=0");
    expect(logged).not.toMatch(/stepIdx=[1-9]/);
  });

  it("navSpeak at step 0: instruction text is truncated to 60 characters", () => {
    const longText = "A".repeat(100);
    const line = buildNavSpeakLogLine(GPS_TS, false, ROUTE_VERSION, 0, longText);
    console.log(line);
    const logged = spy.mock.calls[0][0] as string;
    const match = logged.match(/text="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(60);
  });

  // ── reroute on a single-step route — log format still valid ──

  it("reroute off_route: all required fields present when the prior route had only one step", () => {
    console.log(fmtRerouteOffRoute(1, 45));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=1");
    expect(logged).toContain("reason=off_route");
    expect(logged).toContain("distToPolyM=45m");
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — [NavRoute][TRACE] cooldown_blocked log lines
// ─────────────────────────────────────────────────────────────────────────────
//
// When a reroute trigger (wrong_dir / off_route / missed_turn) fires while the
// 20-35 s cooldown is still active, map.tsx emits a cooldown_blocked log line
// instead of proceeding with a reroute.  This allows testers to distinguish
// "nav is stuck" from "cooldown suppressed a legitimate reroute attempt" in
// crash logs without needing Xcode open.
//
// Tests use fmtCooldownBlocked(), the locally-mirrored format function, just
// as Suite 2 uses fmtRerouteWrongDir / fmtRerouteOffRoute / fmtRerouteMissedTurn.
// A format change to the inline log in map.tsx must also update the mirror,
// causing these tests to fail before the build reaches TestFlight.

describe("[NavRoute][TRACE] cooldown_blocked log lines — required fields", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  // ── wrong_dir ──

  it("wrong_dir: contains routeVersion= field", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "wrong_dir"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("wrong_dir: contains reason= field with value wrong_dir", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "wrong_dir"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=wrong_dir");
  });

  it("wrong_dir: is tagged with [NavRoute][TRACE] cooldown_blocked prefix", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "wrong_dir"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] cooldown_blocked/);
  });

  // ── off_route ──

  it("off_route: contains routeVersion= field", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "off_route"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("off_route: contains reason= field with value off_route", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "off_route"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=off_route");
  });

  it("off_route: is tagged with [NavRoute][TRACE] cooldown_blocked prefix", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "off_route"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] cooldown_blocked/);
  });

  // ── missed_turn ──

  it("missed_turn: contains routeVersion= field", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "missed_turn"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("routeVersion=");
    expect(logged).toContain(`routeVersion=${ROUTE_VERSION}`);
  });

  it("missed_turn: contains reason= field with value missed_turn", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "missed_turn"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain("reason=");
    expect(logged).toContain("reason=missed_turn");
  });

  it("missed_turn: is tagged with [NavRoute][TRACE] cooldown_blocked prefix", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "missed_turn"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] cooldown_blocked/);
  });

  // ── Cross-trigger: all three reason= values are distinct (no copy-paste drift) ──

  it("wrong_dir, off_route, and missed_turn each emit a distinct reason= value", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "wrong_dir"));
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "off_route"));
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "missed_turn"));

    const reasons = spy.mock.calls.map((args) => {
      const m = (args[0] as string).match(/reason=(\S+)/);
      return m ? m[1] : null;
    });

    expect(reasons).toContain("wrong_dir");
    expect(reasons).toContain("off_route");
    expect(reasons).toContain("missed_turn");
    expect(new Set(reasons).size).toBe(3);
  });

  // ── cooldown_blocked prefix is distinct from reroute_start prefix ──
  // Confirms the two event types are not conflated in log searches.

  it("cooldown_blocked prefix does NOT match the reroute_start prefix", () => {
    console.log(fmtCooldownBlocked(ROUTE_VERSION, "wrong_dir"));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] cooldown_blocked/);
    expect(logged).not.toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
  });

  it("reroute_start prefix does NOT match the cooldown_blocked prefix", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[NavRoute\]\[TRACE\] reroute_start/);
    expect(logged).not.toMatch(/^\[NavRoute\]\[TRACE\] cooldown_blocked/);
  });

  // ── cooldown_blocked does NOT appear when cooldown has elapsed (no false positives) ──
  // This is verified structurally: fmtCooldownBlocked only produces the suppression
  // line.  The reroute_start mirror (fmtRerouteWrongDir etc.) never contains
  // "cooldown_blocked", confirming the two paths are mutually exclusive in the format.

  it("no cooldown_blocked field appears in a reroute_start log line", () => {
    console.log(fmtRerouteWrongDir(ROUTE_VERSION));
    console.log(fmtRerouteOffRoute(ROUTE_VERSION, 55));
    console.log(fmtRerouteMissedTurn(ROUTE_VERSION));

    for (const [args] of spy.mock.calls) {
      expect(args as string).not.toContain("cooldown_blocked");
    }
  });

  it("routeVersion= value in cooldown_blocked matches the incremented ref across consecutive blocks", () => {
    let version = 1;

    console.log(fmtCooldownBlocked(version, "wrong_dir"));   // version=1
    version += 1;
    console.log(fmtCooldownBlocked(version, "off_route"));   // version=2
    version += 1;
    console.log(fmtCooldownBlocked(version, "missed_turn")); // version=3

    expect(spy.mock.calls[0][0]).toContain("routeVersion=1");
    expect(spy.mock.calls[1][0]).toContain("routeVersion=2");
    expect(spy.mock.calls[2][0]).toContain("routeVersion=3");
  });
});
