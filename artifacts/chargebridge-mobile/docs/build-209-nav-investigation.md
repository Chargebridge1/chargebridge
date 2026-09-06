# Build #209 — Navigation Delay Investigation

**Date:** 2026-08-09  
**Status:** DIAGNOSTIC BUILD SUBMITTED — awaiting physical-device session  
**Objective:** Identify exactly where the ~500-foot announcement delay is introduced in the runtime pipeline  
**Previous outcome:** Build #208 `routeArcDistM` fix → NO IMPROVEMENT — hypothesis disproved as primary cause

## Build Identity — Required for Evidence Integrity

| Item | Value |
|---|---|
| **buildNumber** | 209 |
| **Source commit (nav behavior baseline)** | `94b3642516b94235d9279ca0a0042bfbab270457` |
| **Diagnostic commit (this build)** | `6e795c9b` — "Build #209 — diagnostic-only: [NavGPS][TRACE] + [NavVoice][DIST] instrumentation" |
| **Navigation code vs Build #208** | Identical — no behavioral changes |
| **New diagnostic code** | `[NavGPS][TRACE]` and `[NavVoice][DIST]` blocks, both `__DEV__`-gated |
| **EAS build ID** | `2ac2c22f-2855-4545-b266-aa767da6adc0` |
| **TestFlight build** | #209 (diagnostics silently disabled — see Build #210) |

## Build #210 Correction

| Item | Value |
|---|---|
| **buildNumber** | 210 |
| **Source commit** | `e5c65594b374b13906ee6060d0cf0c8630bd11c1` |
| **Correction** | Removed `__DEV__` guard from all three diagnostic blocks |
| **EAS build ID** | `4bf038cc-301b-4d37-9733-5c5c846d59d1` |

**Root cause of Build #209 failure:** `__DEV__ = false` in EAS `preview` production bundle. All `if (__DEV__)` blocks are dead code in TestFlight. Fix: unconditional log blocks (no `__DEV__` prefix).

**Console.app filter for Build #210 session:**
- **Process:** `ChargeBridge` (not `navd` — that is Apple's Core Location daemon)
- **Subsystem:** `app.replit.chargebridge`

| TestFlight build** | #210 |

> The source commit and diagnostic commit are recorded here so there is no ambiguity about what code the physical-device session is testing. A session run against a different binary does not count as evidence for this investigation.

---

## Observed Facts

| Fact | Source |
|---|---|
| Voice instructions fire ~500 ft behind the maneuver | Build #207 physical-device test |
| No improvement after `routeArcDistM` backward-step correction | Build #208 physical-device test |
| Delay present at all speeds — highway worst | Build #207 and #208 physical-device tests |
| Simulation showed correct 12s lead times on both builds | Synthetic dense-polyline route (misleading — positions are never stale in simulation) |
| `closestRoutePoint` runs synchronously and updates `navInterpRef` before the voice zone block | Code review — `map.tsx` lines 3619–3626 |
| Foreground GPS watcher configured: `timeInterval: 0, distanceInterval: 0` (fastest possible) | Code review — `map.tsx` line 3571–3578 |
| Background nav task does NOT do voice — only push notifications | Code review — `backgroundNav.ts` |
| `navSpeak` already logs `_tSpeak` (call time) and `Speech.speak(forced) since_navSpeak=Xms` | Code review — `map.tsx` lines 2568–2694 |
| `[NavVoice][ARC]` diagnostic logs (arc vs straight distance per tick) are present in Build #208 | Code review — `map.tsx` line 3907–3917 |

---

## Previous Hypothesis — DISPROVED AS SUFFICIENT

**Hypothesis:** `routeArcDistM` backward-step error overcounted the arc distance by up to `2 × d_back` on long highway polyline segments, suppressing a3 until the car crossed the next polyline vertex.

**Why it seemed correct:** The error was real, proportional to segment length (highways worst), and matched the symptom pattern.

**Why it is not sufficient:** Build #208 applied the correct forward-step arc computation. Physical-device testing showed identical delay. The measured arc distance is now accurate, but the announcement timing has not changed.

**What this rules out:**
- Any hypothesis that depends solely on incorrect arc distance measurement
- Polyline segment density as a primary factor

**What this does NOT rule out:**
- A separate upstream cause that makes the engine use a stale or wrong position
- A downstream cause in TTS latency between `navSpeak()` and audible speech

---

## Critical Unanswered Question

**Does the ~500-foot delay occur before `navSpeak()` or after `navSpeak()`?**

If `navSpeak()` is called at the correct distance (~348m at 65 mph) but the driver hears speech 150m later:
→ **Problem is in TTS/speech execution** — `Speech.stop()`, settle delay, `Speech.speak()`, iOS audio session, or AVSpeechSynthesizer startup

If `navSpeak()` itself is not called until the car is within 200m or less:
→ **Problem is upstream** — GPS position age, tick interval throttling, voice-zone evaluation frequency, or position matching

The existing `[NavVoice][TRACE]` logs in the code CAN answer this — **but the Build #208 tester session did not capture and report these log values.** The new investigation must collect them.

---

## Pipeline Stage-by-Stage Latency Analysis

```
① iOS GPS hardware captures position → assigns pos.coords.timestamp
② CoreLocation fuses GPS+cell+wifi → delivers to app → _posHandler fires
   GAP A: Date.now() - pos.coords.timestamp  ← [UNKNOWN — not currently logged]
③ _posHandler: stationary filter, setUserLoc, speed display (synchronous, <1ms)
④ closestRoutePoint(routeCoordRef, loc, hint) → navInterpRef.current = interp
   (synchronous O(50) scan, <1ms)
⑤ routeArcDistM(polyline, prevProgressIdx, navInterp, maneuverCoord) → distToNextM
   (synchronous, corrected in Build #208, <1ms)
⑥ Voice zone: distToNextM < a3Hi → navSpeak(text, true)
   [NavVoice][TRACE] navSpeak called at _tSpeak — ALREADY LOGGED ✅
⑦ scheduleForcedSpeak: Speech.stop() + settleMs → Speech.speak()
   [NavVoice][TRACE] Speech.speak(forced) since_navSpeak=Xms — ALREADY LOGGED ✅
⑧ iOS AVSpeechSynthesizer: audio session setup → TTS begins
   GAP B: time from Speech.speak() call to audible first word ← [UNKNOWN — not logged]
```

**GAP A** (position age) + **tick interval** are the missing measurements.  
**GAP B** (TTS startup to audible audio) requires the tester to time it with a stopwatch.

The pipeline stages ③–⑦ are synchronous within a single `_posHandler` invocation and take <5ms combined. The delay must be in GAP A, tick interval, or GAP B.

---

## Candidate Hypotheses

### Hypothesis A — GPS position age (most likely primary cause)

iOS CoreLocation delivers fixes with a `coords.timestamp` that may be 0.5–3 seconds before `Date.now()` when `_posHandler` fires. The nav engine processes `loc = { latitude, longitude }` from this timestamp — the car's position at time T-Δ, not the current position at time T.

At 65 mph (29 m/s):
- Δ = 0.5s → 14m of invisible forward travel
- Δ = 1s → 29m of invisible forward travel  
- Δ = 3s → 87m of invisible forward travel

**Effect on voice zone:** If the delivered position says the car is at 360m arc from the maneuver but the actual car is at 300m (due to 60m position lag), `distToNextM = 360 > a3Hi = 348` — a3 is suppressed. On the next tick the delivered position is at 300m, a3 fires, but the actual car is now at 240m. If TTS takes another 1–2s to audibly start (GAP B), the driver hears the announcement at 180–210m — which is ~500ft late.

**Distinguishing evidence:** `posAge = Date.now() - pos.coords.timestamp` on the tick navSpeak fired.

---

### Hypothesis B — GPS tick interval throttling

Despite `timeInterval: 0` requesting the fastest possible updates, iOS may deliver ticks every 2–3s instead of ~1s under:
- Thermal throttling (warm device on a summer day)
- High CPU load (map rendering + polyline animation + camera animation all on main thread)
- Low power mode

At 65 mph with a 3s tick interval:
- The voice zone is evaluated at position P₀ (distToNextM = 435m, a3 not triggered)
- The next tick fires 3s later at position P₁ (delivered distance = 348m, a3 fires)
- The actual car is at 435 − (3×29) = 348m when the tick fires — but if the fix fires on the tick where distToNextM drops below 348m, the car has already been in the zone for ~3s of undetected travel

**Effect when combined with Hypothesis A:** If tick interval is 3s AND posAge is 1s, the voice zone fires when the car is at 348m − 87m = 261m — already 87m inside the zone. With 2s TTS startup, the driver hears it at 261 − 58 = 203m ≈ 665ft. Combined with normal variation this matches the observed 500ft delay.

**Distinguishing evidence:** Consecutive `[NavGPS][TRACE]` interval values — if routinely >1500ms, throttling is confirmed.

---

### Hypothesis C — TTS audio startup latency (contributing factor)

`Speech.speak()` on iOS invokes `AVSpeechSynthesizer`. When an audio session is already active (music, podcast, previous TTS), iOS must:
1. Interrupt or duck the existing session
2. Reinitialize the synthesizer
3. Buffer and render TTS audio
4. Begin playback

This can take 500–2000ms on some device+iOS combinations. The `[NavVoice][TRACE] Speech.speak(forced) since_navSpeak=Xms` log captures the time from `navSpeak()` to `Speech.speak()` call — but NOT the time from `Speech.speak()` call to audible audio (GAP B).

At 65 mph, 2s TTS startup = 58m of car travel between `Speech.speak()` call and the driver hearing the first word. This alone cannot account for 150m but could account for 30–60m on top of Hypothesis A or B.

**Distinguishing evidence:** Tester uses a stopwatch to measure time from `Speech.speak(forced) t=X` in the log (exact ms timestamp) to audible first word. Requires correlating device clock to the log timestamp.

---

### Hypothesis D — Voice zone not evaluating on every GPS tick (unlikely but verifiable)

The voice zone block at line 3870 is gated: `if (nextIdx < steps.length)`. If `navState.currentStepIdx` advances past the last step due to a race with the background task or step-advance block, `nextIdx` would be out of bounds and the voice zone would be silently skipped.

**Distinguishing evidence:** Consecutive `[NavVoice][ARC]` logs — if there are large gaps (e.g., log fires once, then doesn't fire for 5+ ticks), the voice zone is being skipped.

---

## Required Diagnostic Instrumentation (Build #209)

**Objective:** Answer the two-part question — (1) what is `posAge` and `tickInterval` at the moment of each GPS delivery, and (2) what distance did the engine compute when `navSpeak` fired?

### Instrument 1 — `[NavGPS][TRACE]` at the top of `_posHandler`

**What it adds:** Two values, every GPS tick, for the duration of a nav session:
- `posAge` = milliseconds between when iOS captured the position and when `_posHandler` processed it
- `interval` = milliseconds since the previous GPS tick (actual update rate)

**Lines changing:** Add `lastGpsTickMsRef = useRef(0)` near the other nav refs (~line 1854), and add a 5-line `__DEV__`-gated log block at the very top of `_posHandler` before any nav processing.

**Sample output:**
```
[NavGPS][TRACE] posAge=847ms interval=1042ms spd=64mph acc=4m
[NavGPS][TRACE] posAge=1203ms interval=1038ms spd=65mph acc=5m
[NavGPS][TRACE] posAge=2891ms interval=1051ms spd=65mph acc=6m   ← position 2.9s old
```

If `posAge` is routinely >500ms, Hypothesis A is confirmed.  
If `interval` is routinely >1500ms, Hypothesis B is confirmed.

### Instrument 2 — `[NavVoice][DIST]` pre-announcement distance series

**What it adds:** On every GPS tick inside the voice zone, logs `prevDist` (distance from the previous tick) alongside the current `distToNextM`. This shows the car's position history leading up to the announcement — revealing how far inside the zone the car was before the a3 condition triggered.

**Lines changing:** Add a `prevDistToNextMRef = useRef(-1)` ref, log `[NavVoice][DIST] prev=Xm cur=Ym a3Hi=Zm` inside the existing voice zone block, update `prevDistToNextMRef` after evaluation.

**Sample output (correctly working at 65 mph, 1Hz GPS):**
```
[NavVoice][DIST] prev=-1m cur=420m a3Hi=348m step=2        ← a3 not yet triggered
[NavVoice][DIST] prev=420m cur=390m a3Hi=348m step=2       ← 30m/tick = correct 1Hz
[NavVoice][DIST] prev=390m cur=361m a3Hi=348m step=2
[NavVoice][DIST] prev=361m cur=332m a3Hi=348m step=2  ← a3 triggers here (navSpeak fires)
```

**Sample output (throttled GPS at 65 mph, 3s ticks):**
```
[NavVoice][DIST] prev=-1m cur=420m a3Hi=348m step=2        ← a3 not triggered
[NavVoice][DIST] prev=420m cur=247m a3Hi=348m step=2  ← a3 triggers here (3s gap = 87m jump + posAge)
```
The second sample shows 173m between ticks — immediately revealing the throttle.

---

## Tester Data Collection Protocol (Build #209)

Filter strings (run simultaneously):
```
[NavGPS][TRACE]      — GPS delivery timing (new)
[NavVoice][DIST]     — distance series per tick (new)
[NavVoice][ARC]      — arc vs straight-line (Build #208, retained)
navSpeak             — announcement call timestamp (existing)
Speech.speak(forced) — TTS dispatch timestamp (existing)
```

For one clean maneuver at each speed, capture and report:

| Data point | Filter line | Value |
|---|---|---|
| posAge at announcement tick | `[NavGPS][TRACE]` | ms |
| tickInterval at announcement tick | `[NavGPS][TRACE]` | ms |
| prevDist on tick before announcement | `[NavVoice][DIST]` | m |
| distToNextM on announcement tick | `[NavVoice][DIST]` | m |
| arc distance at announcement | `[NavVoice][ARC]` | m |
| straight-line distance at announcement | `[NavVoice][ARC]` | m |
| `navSpeak` call timestamp | `navSpeak called` | ms epoch |
| `Speech.speak` dispatch timestamp | `Speech.speak(forced) t=` | ms epoch |
| `since_navSpeak` value | `Speech.speak(forced) since_navSpeak=` | ms |
| Audible TTS start (stopwatch) | N/A — tester measures | seconds after navSpeak log |
| Road type | Tester notes | Highway / urban / residential |
| Speed | `[NavGPS][TRACE] spd=` | mph |

---

## Files Changing (Diagnostic Only — No Nav Logic)

| File | Change | Nav logic affected? |
|---|---|---|
| `app/(tabs)/map.tsx` | Add `lastGpsTickMsRef = useRef(0)` (~line 1855) | No |
| `app/(tabs)/map.tsx` | Add `[NavGPS][TRACE]` 5-line block at top of `_posHandler` | No |
| `app/(tabs)/map.tsx` | Add `prevDistToNextMRef = useRef(-1)` (~line 1856) | No |
| `app/(tabs)/map.tsx` | Add `[NavVoice][DIST]` log + ref update inside voice zone block | No |

All four changes are `__DEV__`-gated. Zero nav logic changes. All existing announcement thresholds, conditions, and timing are untouched.

---

## What the Logs Will Determine

| If logs show | Conclusion | Next action |
|---|---|---|
| `posAge` consistently >1000ms | GPS position age is primary cause (Hypothesis A) | Investigate using `pos.coords.timestamp` for position-corrected distance |
| `interval` consistently >2000ms | GPS throttling is primary cause (Hypothesis B) | Investigate main-thread CPU load / thermal state |
| Large `prevDist→cur` jumps (>80m/tick) | Either A or B confirmed | Check which (posAge or interval) |
| Small jumps (<35m/tick) but navSpeak fires late | Problem is post-navSpeak (Hypothesis C) | Measure GAP B (Speech.speak → audible) |
| `since_navSpeak` >1500ms | TTS dispatch delay is significant | Investigate scheduleForcedSpeak settle window |
| All values look correct, tester reports early audio | No delay — may be perception/expectation issue | Re-verify with phone mounted and stopwatch |

---

## Required Evidence — Device Session Is Not Complete Without These

Per the navigation investigation policy (see `docs/verification-stages.md` §"Navigation Investigation Policy"), a Build #209 device session is not Runtime Verified until ALL of the following are recorded for at least one maneuver at each speed tested:

| Required item | Filter string | Values to record |
|---|---|---|
| GPS position age at announcement tick | `[NavGPS][TRACE]` | `posAge=` value (ms) |
| GPS tick interval at announcement tick | `[NavGPS][TRACE]` | `interval=` value (ms) |
| Last 3 tick intervals before announcement | `[NavGPS][TRACE]` | `interval=` values (ms) — confirms throttling pattern |
| Distance on tick before announcement | `[NavVoice][DIST]` | `prev=` value (m) |
| Distance on announcement tick | `[NavVoice][DIST]` | `cur=` value (m) |
| Arc distance at announcement | `[NavVoice][ARC]` | `arc=` value (m) |
| Straight-line distance at announcement | `[NavVoice][ARC]` | `straight=` value (m) |
| navSpeak call timestamp | `navSpeak` log line | `t=` value (ms epoch) |
| TTS dispatch delay | `Speech.speak(forced)` log line | `since_navSpeak=` value (ms) |
| Audible TTS start (stopwatch) | N/A — tester measures | seconds after `navSpeak` log |
| Road type | Tester notes | Highway / urban / residential |
| Speed | `[NavGPS][TRACE] spd=` | mph |

A session where any row above is blank does not count.

## Awaiting Approval

No code changes have been made. This document describes the proposed diagnostic instrumentation for Build #209. Approval needed before any code is written.

After approval:
1. Add the four diagnostic blocks to `map.tsx` (no nav logic changes)
2. Run 326/326 test suite
3. Run TypeScript check
4. Bump buildNumber to 209 in `app.json`
5. Commit and trigger EAS build
