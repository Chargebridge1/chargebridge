# Navigation Root Cause Determination — Controlled Build #207 Fixture

**Status:** Test-only evidence. No production navigation behavior was changed.  
**Build status:** Build #213 remains blocked.  
**Crash status:** The Build #212 Apple crash report is still required; this document does
not identify a crash cause.

## Executive conclusion

The controlled fixture reproduces a **PRE-NAVSPEAK** delay in a source-faithful
Build #207 highway geometry:

- Corrected forward-arc calculation reaches the first a3-eligible 1 Hz GPS tick at
  **355.43 m (1,166 ft)** from the maneuver.
- Build #207's legacy route-arc calculation does not invoke `navSpeak()` for a3
  until **181.29 m (595 ft)** from the maneuver.
- The difference is **174.14 m (571 ft), or 5.99 seconds at 65 mph**.
- In the fixture, `scheduleForcedSpeak()` dispatches the forced a3 speech at
  **0 ms after `navSpeak()`** because no utterance is active. It contributes no
  app-level post-`navSpeak()` delay in this replay.

This classifies **the simulated Build #207 scenario** as **PRE-NAVSPEAK**.

It does **not** establish that the same condition caused the reported physical-device
delay. The actual route geometry, GPS fixes, and native TTS onset data from that drive
were not retained, and Build #208's physical test reportedly did not improve the
observed symptom after the forward-arc correction. Therefore:

> **The root cause of the physical-device incident remains unconfirmed. No new
> production correction is proposed or authorized from this fixture alone.**

## A. Baseline

| Item | Value |
|---|---|
| Controlled source baseline | Build #207, commit `9062008` |
| Legacy path reproduced | Private `routeArcDistM()` implementation in Build #207 `map.tsx` |
| Fixture / characterization test | `__tests__/fixtures/build207HighwayVoiceFixture.ts`, `__tests__/build207HighwayVoiceFixture.test.ts` |
| Production behavior changed | No |
| Native dependency / device diagnostic added | No |

The baseline `routeArcDistM()` walked from the interpolated vehicle position
**backward** to the start of its current segment, then traversed the same distance
forward again. This makes the computed arc distance exceed physical distance by
approximately twice the distance already travelled within that segment.

## B. Reproduction

The fixture uses an intentionally simple, fully deterministic highway approach:

| Input | Value |
|---|---|
| Maneuver | “Turn right onto Fixture Exit” at 3,000 m north of origin |
| Route geometry | Straight northbound polyline, 0–3,000 m in 200 m segments |
| Vehicle speed | 65 mph / 29.056 m/s |
| GPS cadence | One fix per 1,000 ms |
| GPS accuracy | 5 m on every fix |
| Route state | All fixes are on-route; no reroute event fires |
| Navigation steps | Start (index 0), maneuver (index 1) |
| TTS adapter completion | Deterministic 1,200 ms fake-adapter lifecycle only; **not** native audible-onset evidence |

The 200 m geometry is significant: once the vehicle enters a segment, the Build #207
arc calculation adds the already-travelled portion of that segment twice. The false
distance stays high until the next segment is entered.

## C. Trigger analysis

All values below are fixture output from the Build #207 replay.

| Event | Fixture time | Physical / straight distance | Build #207 `routeArcDistM` | Result |
|---|---:|---:|---:|---|
| a1 | 21 s | 2,387.12 m | 2,407.48 m | Fires |
| a2 | 62 s | 1,197.13 m | 1,200.17 m | Fires |
| **Corrected-path first a3-eligible GPS tick** | **91 s** | **355.43 m / 1,166 ft** | **355.43 m** | Would fire a3 |
| Build #207 a3 | 97 s | **181.29 m / 595 ft** | **218.26 m** | `navSpeak(..., true)` fires |
| Step advance | 102 s | 36.17 m | — | Index 0 → 1 |

### Exact a3 failure boundary

At the corrected first a3-eligible tick (91 s), the vehicle is 355.43 m from the
maneuver. Build #207 instead reports 443.67 m of route arc because of the backwards
walk. The 13-second a3 immediate-trigger condition is therefore not met.

At 97 s, after crossing into the next 200 m segment:

- physical / straight distance: **181.29 m**
- legacy route arc: **218.26 m**
- legacy computed time to maneuver: **7.51 seconds**
- a3 finally fires

The source-faithful delay is **174.14 m / 571 ft / 5.99 seconds**.

Step advancement happens only later, at 36.17 m, so it does not cause this fixture's
a3 delay. The simulated GPS is on-route at every tick, so off-route detection produces
no reroute events.

## D. TTS analysis

| Measurement | Value |
|---|---:|
| a3 `navSpeak()` timestamp | `1,700,000,097,000` ms |
| a3 app-level `Speech.speak()` dispatch timestamp | `1,700,000,097,000` ms |
| App-level navSpeak → dispatch delay | **0 ms** |
| Forced settle delay | **0 ms** (TTS was idle) |
| Deterministic fake-adapter completion timestamp | `1,700,000,098,200` ms |
| Fake-adapter dispatch → completion duration | 1,200 ms |

The a3 path uses the real `scheduleForcedSpeak()` production helper. Its callback is
flushed with Jest fake timers. The fixture therefore verifies application scheduling
through `Speech.speak()` dispatch.

It cannot determine when iOS begins audible playback after that dispatch. Native audio
session latency remains outside a JavaScript-only deterministic fixture and requires
separate device-level evidence.

## E. Classification

| Scope | Classification |
|---|---|
| Controlled Build #207 fixture | **PRE-NAVSPEAK** |
| Reported physical-device incident | **Unresolved — insufficient route/GPS/native-audio evidence** |

The physical incident must not be reclassified merely because this fixture reproduces
one source-level failure mode. A correct causal report for the device incident requires
its actual route geometry and GPS sequence, or equivalent reproducible input.

## F. Root cause

### Proven in the fixture

The Build #207 `routeArcDistM()` backward traversal condition double-counts the segment
already behind the interpolated vehicle position. That falsely inflates `distToNextM`,
holds the a3 zone condition false, and delays the `navSpeak()` call until after a
subsequent segment boundary.

### Not proven for the reported drive

No exact production root cause is determined for the physical-device report. The
Build #208 forward-only arc correction already addresses the fixture's failure mode,
yet the reported physical test did not show improvement. This leaves open different
geometry, GPS cadence/age, voice-zone state, or post-dispatch native audio behavior.

## G. Proposed correction

**None.**

The fixture validates a historical Build #207 issue already addressed by the Build #208
forward-arc implementation. Proposing another navigation-code change would be
speculative and is expressly blocked.

Before any production correction is proposed, a fixture must be rerun with an actual
reported incident's route geometry and GPS timestamps, then show whether:

1. `navSpeak()` crosses its intended boundary late,
2. app-level dispatch is late, or
3. native audible onset is late after application dispatch.

## H. Regression test

`__tests__/build207HighwayVoiceFixture.test.ts` provides:

1. A passing characterization test that records all required inputs and events:
   vehicle position, straight and arc distance, zones, step advance, `navSpeak`,
   dispatch, modeled completion, and reroute state.
2. A `test.failing` historical invariant: a3 should fire on the first 13-second
   lead-time GPS tick. It fails under the frozen Build #207 algorithm while keeping
   the normal suite green.

This is a **historical baseline regression**, not the final production regression for
the physical-device incident. It must be replaced or parameterized with actual incident
inputs before a new production correction is approved.

## Safety check

- No `map.tsx` production logic changed.
- No thresholds, route-arc behavior, step advancement, rerouting, off-route behavior,
  TTS timers, queue behavior, or GPS throttling changed.
- No TestFlight diagnostics, console/file/share-sheet logging, debug overlay additions,
  or native dependencies were added.
- No new build was created.