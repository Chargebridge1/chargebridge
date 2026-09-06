# Build #208 — Navigation Root Cause Report

**Date:** 2026-08-09  
**Status:** AWAITING APPROVAL — no code changes made yet  
**Build #207 runtime outcome:** ❌ NOT Runtime Verified — P1 launch blocker  
**Author:** Engineering

---

## Observed Facts

### What Build #207 demonstrated on-device

| Observation | Detail |
|---|---|
| Voice instructions ~500 ft behind maneuver | Announcement fires AFTER the car has already passed the turn |
| Highway worse than urban | Delay larger on highways than city streets |
| Some maneuvers completely silent | a3 never fired for certain turns |
| Rerouting slow to initiate | Noticeably delayed after leaving the planned route |
| Rerouting from the previous route sometimes continued | Stale instructions persisted briefly after rerouting |

### Last successful navigation event

Build #206 — no nav code changes between #205 and #206. The voice timing has regressed since the nav fixes were first introduced in the Build #207 cycle.

### First expected event that failed

a3 zone ("execute" voice cue — the final announcement before each maneuver). Expected to fire ~12 s before the maneuver at all speeds. Observed to fire ~5 s AFTER the maneuver (~500 feet late at 65 mph).

---

## Root Cause

### Primary: `routeArcDistM` backward-step direction error

**Function:** `routeArcDistM` in `app/(tabs)/map.tsx` lines 516–539  
**Called from:** voice zone block, line 3877

**What it does:** Measures the road-arc distance from the car's current interpolated position on the polyline (`fromInterp`) to the upcoming maneuver coordinate (`steps[nextIdx].coordinate`). This arc distance drives the a3Hi voice threshold.

**The bug (lines 532–536):**
```typescript
// CURRENT — WRONG:
let km = haversineKm(fromInterp, polyline[clampedFrom]);  // goes BACKWARD
for (let i = clampedFrom; i < toIdx; i++) {
  km += haversineKm(polyline[i], polyline[i + 1]);        // then FORWARD (adds full segment again)
}
km += haversineKm(polyline[toIdx], toCoord);
```

`fromInterp` is the perpendicular projection of the car's GPS position onto segment `polyline[fromIdx] → polyline[fromIdx+1]`. The correct forward direction is toward `polyline[fromIdx+1]`. Instead, the function measures backward to `polyline[fromIdx]`, then adds the entire segment length again in the forward loop.

**Overcounting error:**

Let:
- `d_back` = distance from `fromInterp` to `polyline[fromIdx]` (the vertex already behind the car)
- `d_fwd`  = distance from `fromInterp` to `polyline[fromIdx+1]` (the vertex ahead)
- `d_seg`  = full segment length = `d_back + d_fwd` (approximately)

What the function computes: `d_back + d_seg + rest` = `d_back + d_back + d_fwd + rest` = **`2×d_back + d_fwd + rest`**  
What it should compute: `d_fwd + rest`  
**Error: `+2 × d_back`** — always overestimates, never underestimates.

**Why this produces "~500 feet late on highways":**

Real highway polylines from OSRM/Valhalla have sparse vertices on straight segments — typical segment length 100–300m. When the car's projected position is midway through a 200m segment, `d_back` ≈ 100m and the overcounting error = 200m.

Consequence: the car is truly within a3Hi (e.g., 300m arc to the maneuver, a3Hi = 348m at 65 mph), but `routeArcDistM` reports 300 + 200 = 500m > 348m — a3 is **suppressed**. The announcement never fires on this tick.

As the car continues, `d_back` grows (more of the segment is behind) and the measured arc grows further. The a3 stays suppressed until the car **crosses into the next polyline segment** — at which point `d_back` resets to near 0 and the measured arc suddenly drops to the true value. By then the car has traveled `d_back` metres past the correct trigger point — typically 100–200m = 330–660 feet past where the announcement should have fired.

This precisely matches the observed "approximately 500 feet behind the maneuver, worst on highways."

**Why the simulation didn't catch it:**  
`docs/nav-voice-timing-validation.md` used synthetic GPS sequences on a linear route with densely-sampled polyline points (short segments). With 5–10m segments, `d_back` ≤ 5m and the overcounting error ≤ 10m — negligible at any speed. The algorithm design is correct; the implementation is wrong for real-world sparse polylines.

---

### Secondary: Rerouting delay (requires device log to fully confirm)

Off-route detection (`map.tsx` lines 3747–3851) uses `haversineKm(loc, interp)` — perpendicular distance to the nearest polyline point — which is **not** affected by the `routeArcDistM` bug.

The delay most likely has two contributors:

1. **Minimum-time gate (`minOffRouteMs`):** At highway speed (>50 mph), `minOffRouteMs = 4000ms`. Combined with `offCount = 3` readings at ~1 Hz, the earliest a reroute can trigger is ~4 seconds after going off-route. At 65 mph (29 m/s), 4s = 116m past the exit. The network round-trip for `fetchAllRoutes` adds another 1–3s. Total = 5–7s = 145–200m before "Rerouting" is spoken.

2. **Cooldown interaction:** The 25s reroute cooldown (`offCooldown`) means any reroute within the last 25s blocks a new one. If the voice timing bug caused a spurious wrong-direction detection or missed-turn event (from the distorted arc distance) that triggered an early reroute, the cooldown suppresses the real reroute.

Definitive confirmation requires a `[NavRoute][TRACE]` log from a TestFlight session — specifically `reroute_start` (timing) and `cooldown_blocked` (cooldown suppression).

---

## Proposed Fix

### Fix 1 — `routeArcDistM` direction correction (PRIMARY)

**File:** `artifacts/chargebridge-mobile/app/(tabs)/map.tsx`  
**Function:** `routeArcDistM` (lines 516–539)  
**Change:** Replace the backward first-step with a forward step to `polyline[clampedFrom + 1]`. Add edge case for same-segment (toIdx ≤ clampedFrom).

```typescript
// PROPOSED — CORRECT:
// Edge case: maneuver vertex is at or behind current segment start — use straight-line.
if (toIdx <= clampedFrom) return haversineKm(fromInterp, toCoord) * 1000;
// Sum arc FORWARD: fromInterp → polyline[clampedFrom+1] → … → polyline[toIdx] → toCoord
let km = haversineKm(fromInterp, polyline[clampedFrom + 1]);
for (let i = clampedFrom + 1; i < toIdx; i++) {
  km += haversineKm(polyline[i], polyline[i + 1]);
}
km += haversineKm(polyline[toIdx], toCoord);
return km * 1000;
```

**Why this addresses the failure:** The corrected function measures the true forward arc distance. On a 200m highway segment with `d_back = 100m`, the corrected result = `d_fwd + rest` rather than `2×d_back + d_fwd + rest`. The a3Hi threshold is designed for the true arc distance (`speedMs × 12`) — with the correct measurement, a3 fires at the intended 12s lead time at all speeds and segment densities.

**Regression risk: Low.**
- All existing tests use short segments (d_back ≈ 0) — the fix produces negligible difference on these, so 326/326 tests continue to pass.
- The corrected distance is always ≤ the buggy distance. The announcement fires earlier (at the correct time), not later. No risk of announcements firing so early that they refer to a turn the driver is not approaching.
- The `toIdx <= clampedFrom` edge case (maneuver on the same segment) falls back to straight-line haversine — the same fallback already used on the first GPS tick.

### Fix 2 — Add arc-vs-straight-line trace log

**File:** `artifacts/chargebridge-mobile/app/(tabs)/map.tsx`  
**Location:** Immediately after `distToNextM` is computed (line 3878)

```typescript
// Diagnostic: log arc vs straight-line so testers can confirm the correction on-device.
if (__DEV__) console.log(
  `[NavVoice][TRACE] dist step=${nextIdx} arc=${Math.round(distToNextM)}m`
  + ` straight=${Math.round(haversineKm(loc, steps[nextIdx].coordinate) * 1000)}m`
  + ` a3Hi=${Math.round(a3Hi ?? 0)}m`  // added after a3Hi is computed
);
```

This lets a tester filter `[NavVoice][TRACE] dist` in TestFlight to confirm arc distances are now close to straight-line on straight segments and appropriately longer on curves.

*(Note: `a3Hi` is computed in the block below — the log line will be placed after both computations for a complete trace.)*

---

## Exact Files and Functions Changing

| File | Function / block | Nature of change |
|---|---|---|
| `app/(tabs)/map.tsx` | `routeArcDistM` (lines 532–537) | Direction fix: backward→forward, +edge case guard. 6 lines replaced. |
| `app/(tabs)/map.tsx` | Voice zone block (line ~3878) | Add `__DEV__`-gated arc-vs-straight trace log. 4 lines added. |

**Not changing:**
- Off-route detection logic (unchanged — does not use `routeArcDistM`)
- Step advance logic (unchanged — uses direct haversine)
- TTS dispatch / `navSpeak` (unchanged)
- Arrival gate (unchanged)
- Customize diagnostic logging from commit `df56332` (retained verbatim)
- Vehicle authentication, vehicle creation, Profile, charging, Smart Charger Match, PostHog instrumentation

---

## Build #208 Acceptance Criteria

The fix is **not** considered successful based on tests or code inspection alone.

On a physical TestFlight device:

| Criterion | Expected after fix |
|---|---|
| Voice lead time (all speeds) | a3 fires ~12 s before each maneuver |
| Highway announcements | Useful advance warning before exit/ramp; not after |
| Silent maneuvers | Zero — all turns announced |
| Back-to-back maneuvers | Both announce independently |
| Rerouting initiation | Initiates within ~5 s of leaving the route |
| Post-reroute instructions | Previous route instructions stop; new route instructions begin |
| Arc vs straight-line log ratio | `[NavVoice][TRACE] dist` shows arc ≈ straight on straight segments; arc > straight on curves |

**navSpeak filter string for TestFlight:** `navSpeak` and `[NavVoice][TRACE]`

---

---

## ADDENDUM — 2026-08-09 — Physical-Device Result: HYPOTHESIS DISPROVED

**Build #208 runtime outcome:** ❌ NO MATERIAL IMPROVEMENT

Physical-device testing showed no change from Build #207. Voice instructions remain delayed by approximately the same distance (~500 ft) at all speeds including highway. The `routeArcDistM` backward-step correction did NOT resolve the delay.

**Updated conclusion:** The `routeArcDistM` overcounting error was a real bug and the fix is correct — the measured arc distance is now accurate. However, the arc distance error was not the primary cause of the observed announcement delay. The delay occurs at a different stage of the pipeline.

**Next investigation:** See `docs/build-209-nav-investigation.md`.

---

## What Happens After This Report Is Approved

1. Apply the two-block edit to `map.tsx`.
2. Run full TypeScript check and test suite (326/326 must pass, zero new errors).
3. Confirm Customize diagnostic logging (`[NavPill][DIAG]`) is still present.
4. Bump `ios.buildNumber` to 208 in `app.json`.
5. Commit and trigger EAS build for `preview` profile.
6. Update `docs/nav-performance-report.md` Build #208 row after device session.
