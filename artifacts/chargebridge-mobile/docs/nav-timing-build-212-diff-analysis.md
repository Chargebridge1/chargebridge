# Build #212 vs Build #210 — Complete Diff Analysis

**Status:** Build #213 BLOCKED pending the Build #212 Apple crash report.  
**Purpose:** Catalogue every code change introduced in Build #212 relative to the last known
stable build (#210), and identify precisely when each change can execute on device.  
**Policy:** No item below is labelled a root cause. The crash stack is required evidence.

---

## How to Read the Execution-Context Column

| Label | Meaning |
|---|---|
| **App launch** | Runs during JS engine initialisation, before any screen is rendered. |
| **Map mount** | Runs when the Map tab component is first rendered (initial `useRef`, `useState`, `useEffect` with `[]`). The Map tab may mount at launch if it is the default tab, or on first tab switch. |
| **Navigation start** | Runs when the user taps "Start navigation" and `isNavigatingRef.current` flips to `true`. |
| **Active navigation** | Runs on every GPS tick (`watchPositionAsync` callback) while `isNavigatingRef.current === true`. |
| **Overlay opening** | Runs when the user long-presses the mute button and `navDebugVisible` flips to `true`. |

---

## 1 — The 8 New `useRef` Declarations (`map.tsx`)

```tsx
const navDebugPosAgeRef        = useRef(0);
const navDebugIntervalRef      = useRef(0);
const navDebugDistRef          = useRef(0);
const navDebugDistPrevRef      = useRef(-1);
const navDebugStraightRef      = useRef(0);
const navDebugZoneRef          = useRef('—');
const navDebugSinceNavSpeakRef = useRef<number | null>(null);
const navDebugTtsElapsedRef    = useRef<number | null>(null);
```

**Execution context: Map mount.**

`useRef` calls are synchronous and run during the component's render phase, the first time
`MapScreen` is rendered. They allocate a plain JS object `{ current: <initial> }` and nothing
else. No side effects, no timers, no async work.

These declarations are structurally identical to the 6 debug refs already present in Build #210
(`navDebugSpeedMsRef`, `navDebugLastSpeakRef`, etc.). The initial values are all primitives or
`null`.

---

## 2 — The 8 New Ref Write Sites (`map.tsx`)

### 2a — `navDebugPosAgeRef` and `navDebugIntervalRef`

```tsx
// Inside _posHandler — the watchPositionAsync callback
navDebugPosAgeRef.current  = _posAge;       // ms since GPS fix was stamped
navDebugIntervalRef.current = _interval;    // ms since previous _posHandler call
```

**Execution context: Active navigation.**

`_posHandler` runs on every GPS tick. These two writes are gated by the same condition that
existed in Build #210: `if (isNavigatingRef.current)` (implicit via the early-return structure
of the handler). They are plain property assignments — synchronous, no allocation.

In Build #210 these values were only formatted into a `console.log` string. In Build #212 they
are additionally written to refs. The actual computation (`_posAge`, `_interval`) was already
present in Build #210.

### 2b — `navDebugDistPrevRef`, `navDebugDistRef`, `navDebugStraightRef`

```tsx
// Inside the voice-zone distance block (active navigation, every GPS tick)
navDebugDistPrevRef.current  = navDebugDistRef.current;  // snapshot previous before overwrite
navDebugDistRef.current      = Math.round(distToNextM);
navDebugStraightRef.current  = _straight;
```

**Execution context: Active navigation.**

These three writes sit immediately after the `routeArcDistM` call that was already present in
Build #210. `distToNextM` and `_straight` are local variables computed earlier in the same
conditional block; the writes are pure assignments.

`navDebugDistPrevRef` is seeded with `-1` at mount. On the first GPS tick during navigation
`navDebugDistPrevRef.current` will be `navDebugDistRef.current` at that point (which is `0`
from mount), so the first displayed delta will be `0 → actual`. This is a display quirk, not
a logic error.

### 2c — `navDebugZoneRef` (three write sites)

```tsx
// Zone a1 fires
navDebugZoneRef.current = 'a1';

// Zone a2 fires
navDebugZoneRef.current = 'a2';

// Zone a3 fires
navDebugZoneRef.current = 'a3';
```

**Execution context: Active navigation.**

Each write is inside one of the three `if (!voiceAnnouncedRef.current[nextIdx].has('a1'))` /
`'a2'` / `'a3'` blocks that were already present in Build #210. They execute only when a zone
threshold is crossed for the first time for a given step. Plain string assignment.

`navDebugZoneRef` is never reset between steps or reroutes in Build #212 — it holds the most
recent zone that fired across the entire session. This is intentional for overlay display
(shows what the last firing was) and has no effect on navigation logic.

### 2d — `navDebugSinceNavSpeakRef` — forced-speak path

```tsx
// Inside scheduleForcedSpeak callback, immediately before Speech.speak()
navDebugSinceNavSpeakRef.current = _tSpeakForced - _tSpeak;
```

**Execution context: Active navigation.**

`_tSpeakForced` is `Date.now()` captured at the moment the `setTimeout` callback fires.
`_tSpeak` is `Date.now()` captured when `navSpeak()` was originally called (closure variable).
Their difference is the settle delay plus any scheduler jitter.

This write only executes when `force === true` AND the settle-delay `setTimeout` has fired.
The forced path is used after a reroute and on the initial navigation-start announcement.

### 2e — `navDebugSinceNavSpeakRef` — non-forced path

```tsx
// Inside navSpeak(), non-forced branch, immediately before Speech.speak()
navDebugSinceNavSpeakRef.current = _tSpeakNonForced - _tSpeak;
```

**Execution context: Active navigation.**

`_tSpeakNonForced` is `Date.now()` at the direct `Speech.speak()` call site.
`_tSpeak` is `Date.now()` captured at the top of `navSpeak()`.
The difference reflects only the synchronous path through `navSpeak()` (queue check, interrupt
check, option construction) — expected to be in the low single-digit milliseconds when TTS is
idle.

### 2f — `navDebugTtsElapsedRef`

```tsx
// Inside ttsOnDone callback — the Speech onDone handler
navDebugTtsElapsedRef.current = Date.now() - _tSpeak;
```

**Execution context: Active navigation.**

`ttsOnDone` is the `onDone` handler registered in `Speech.speak()`. It fires when the native
TTS engine finishes speaking the utterance. `_tSpeak` is the same closure variable as in 2d/2e
— the timestamp when `navSpeak()` was called. This ref therefore captures total wall time from
navSpeak call to utterance completion.

This callback is asynchronous and executes on the JS thread after the native TTS engine
reports completion.

---

## 3 — `NavDebugOverlay` — `__DEV__` Gate Removed from Render (`map.tsx`)

**Build #210:**
```tsx
{__DEV__ && (
  <NavDebugOverlay
    visible={navDebugVisible}
    speedMsRef={navDebugSpeedMsRef}
    navModeRef={navModeRef}
    offRouteCountRef={offRouteCountRef}
    lastRecalcTimeRef={lastRecalcTimeRef}
    recalcSensitivityRef={recalcSensitivityRef}
    lastNavSpeakRef={navDebugLastSpeakRef}
  />
)}
```

**Build #212:**
```tsx
<NavDebugOverlay
  visible={navDebugVisible}
  speedMsRef={navDebugSpeedMsRef}
  navModeRef={navModeRef}
  offRouteCountRef={offRouteCountRef}
  lastRecalcTimeRef={lastRecalcTimeRef}
  recalcSensitivityRef={recalcSensitivityRef}
  lastNavSpeakRef={navDebugLastSpeakRef}
  posAgeRef={navDebugPosAgeRef}
  gpsIntervalRef={navDebugIntervalRef}
  distRef={navDebugDistRef}
  distPrevRef={navDebugDistPrevRef}
  straightRef={navDebugStraightRef}
  lastZoneRef={navDebugZoneRef}
  sinceNavSpeakRef={navDebugSinceNavSpeakRef}
  ttsElapsedRef={navDebugTtsElapsedRef}
/>
```

**Execution context of the removal itself: Map mount.**

In a Hermes production bundle, `__DEV__` is `false` at compile time. The Hermes AOT compiler
dead-strips `false && <expr>` — the component was never instantiated in any TestFlight build
from #207 through #211. In Build #212 the wrapper is gone: `<NavDebugOverlay>` is
unconditionally instantiated on Map mount.

**What "unconditionally instantiated" means in practice:**

- React calls the `NavDebugOverlay` function component.
- `buildSnapshot(props)` is called once as the `useState` initialiser (see §4).
- The `useEffect([], [props.visible])` hook is registered (see §5).
- The component returns `null` (because `visible` is `false` at mount — it starts hidden).
- No UI is rendered. No interval is running.

**The 8 new props** passed at this site are ref objects already allocated in §1. Passing refs
as props is a synchronous operation — React stores the prop values in the fiber node.

---

## 4 — `buildSnapshot()` Called as `useState` Initialiser (`NavDebugOverlay.tsx`)

```tsx
// NavDebugOverlay — line executed at component mount
const [snap, setSnap] = useState<DebugSnapshot>(() => buildSnapshot(props));
```

**Execution context: Map mount (once, synchronously).**

React calls the initialiser function exactly once during the first render. `buildSnapshot`
reads `.current` from all 8 new refs plus the 6 existing refs. At mount time every new ref
holds its initial value (`0`, `-1`, `'—'`, or `null`). `buildSnapshot` performs:

- Arithmetic on `speedMs` (`Math.max(0, …)`, `* 2.237`, `Math.round`)
- A call to `navStepThreshold(speedMs, isWalking, isCycling)` — a pure function
- A call to `navOffRouteThreshold(speedMs, isWalking, isCycling)` — a pure function
- `Date.now()` subtraction for elapsed-time fields (against refs that hold `0` or `null`,
  producing `0`-relative values that are meaningless but numerically safe)

No async operations, no native calls, no file I/O. `buildSnapshot` is a pure-ish synchronous
function that produces a plain JS object. At mount the result is a snapshot of default/zero
values — it is only displayed to the user if they open the overlay immediately at mount
(which requires starting navigation first, since the mute button is only visible then).

---

## 5 — The 500 ms `setInterval` (`NavDebugOverlay.tsx`)

```tsx
useEffect(() => {
  if (!props.visible) return;
  const id = setInterval(() => setSnap(buildSnapshot(props)), 500);
  return () => clearInterval(id);
}, [props.visible]);
```

**Execution context: Overlay opening.**

The effect runs after every render in which `props.visible` has changed. The interval only
starts when `props.visible === true`. When `visible` returns to `false`, the cleanup function
runs `clearInterval(id)` immediately.

**At Map mount:** `props.visible` is `false`. The effect runs, hits `if (!props.visible) return`,
and exits without creating an interval. No interval is running at mount or during navigation
before the overlay is opened.

**At overlay opening:** `setNavDebugVisible(true)` is called in the long-press handler (§6),
which causes a re-render of `MapScreen` with `navDebugVisible = true`, which propagates
`visible={true}` to `NavDebugOverlay`, which causes the effect to re-run and start the
interval. From this point `buildSnapshot(props)` executes every 500 ms, reading `.current`
from all 14 refs and calling `setSnap` with the result.

**Interval teardown:** `clearInterval` is called synchronously in the effect cleanup, which
runs before the next effect or on component unmount. There is no scenario in which the interval
outlives the `visible === true` phase.

---

## 6 — `__DEV__` Gate Removed from Long-Press Handler (`map.tsx`)

**Build #210:**
```tsx
onLongPress={__DEV__ ? () => {
  setNavDebugVisible((v) => !v);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
} : undefined}
```

**Build #212:**
```tsx
onLongPress={() => {
  setNavDebugVisible((v) => !v);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}}
```

**Execution context: Active navigation (user-initiated).**

The mute button that hosts this `onLongPress` is only rendered inside the turn-by-turn nav
banner, which is only visible when `isNavigating === true`. The handler cannot be triggered
before navigation starts.

In Build #210 the Hermes AOT compiler reduced `__DEV__ ? fn : undefined` to `undefined` in
production, making the long-press permanently inert in TestFlight. In Build #212 the handler
is always present. Triggering it calls `setNavDebugVisible` (a React `useState` setter) and
`Haptics.impactAsync` (a native module call that is already used elsewhere in the app).

---

## 7 — Console Log Refactoring (`map.tsx`)

Across multiple sites, inline template-literal arguments to `console.log(...)` were extracted
into `const _*Line = \`...\`` local variables, with `console.log(_*Line)` on the next line.

**Example:**
```tsx
// Build #210
console.log(`[NavVoice][TRACE] ttsOnDone elapsed=${Date.now() - _tSpeak}ms ...`);

// Build #212
const _ttsOnDoneLine = `[NavVoice][TRACE] ttsOnDone elapsed=${Date.now() - _tSpeak}ms ...`;
console.log(_ttsOnDoneLine);
```

**Execution context:** Identical to the original `console.log` calls — active navigation,
inside the same conditional blocks.

This is a cosmetic refactor. The template literal is still evaluated at the same point in
execution. The additional local variable binding has no observable runtime difference. Hermes
silences `console.log` in production bundles regardless of whether the argument is inline or
via a variable.

---

## 8 — Style Constant Changes (`NavDebugOverlay.tsx`)

| Property | Build #210 | Build #212 |
|---|---|---|
| `container.backgroundColor` | `rgba(10,15,25,0.88)` | `rgba(10,15,25,0.92)` |
| `container.borderColor` | `rgba(0,255,136,0.25)` | `rgba(0,255,136,0.3)` |
| `container.gap` | `3` | `2` |
| `header.fontSize` | `11` | `10` |
| `header.marginBottom` | `4` | `2` |
| `header.letterSpacing` | `0.5` | `0.4` |
| `label.width` | `110` | `120` |
| `divider.marginVertical` | `3` | `2` |

Plus one new style rule added: `section` (for the section-header rows in the expanded overlay).

**Execution context:** These are static JS objects defined at module evaluation time (before
any component mounts). They do not execute at runtime in the sense of producing side effects —
`StyleSheet.create()` is called once when the module is first imported.

---

## 9 — `NavDebugOverlay.tsx` — New Props Interface and `buildSnapshot` Body

The 8 new props added to `NavDebugOverlayProps` and the corresponding reads inside
`buildSnapshot` are detailed in §§1–2 above. The expanded `DebugSnapshot` interface adds 8
new fields (`posAgeMs`, `intervalMs`, `distM`, `distPrevM`, `straightM`, `lastZone`,
`sinceNavSpeakMs`, `ttsElapsedMs`), all primitives or `null`.

The overlay JSX was expanded with new `<Row>` entries and a `<SectionHeader>` component to
display these fields. These render only when `visible === true` and only affect the UI of the
overlay itself — they have no effect on map rendering or navigation logic.

---

## 10 — Comment and Header Changes

The file-level JSDoc comment in `NavDebugOverlay.tsx` was rewritten to describe the Build #212
purpose and the `since_navSpeak` diagnostic metric. No executable code.

---

## Summary Table

| Change | Earliest execution point | Can execute before navigation starts? | New native calls? |
|---|---|---|---|
| 8 `useRef` declarations | Map mount | Yes | No |
| `posAgeRef` / `gpsIntervalRef` writes | Active navigation | No | No |
| `distPrevRef` / `distRef` / `straightRef` writes | Active navigation | No | No |
| `lastZoneRef` writes (a1/a2/a3) | Active navigation | No | No |
| `sinceNavSpeakRef` write — forced path | Active navigation | No | No |
| `sinceNavSpeakRef` write — non-forced path | Active navigation | No | No |
| `ttsElapsedRef` write | Active navigation | No | No |
| `<NavDebugOverlay>` unconditional mount | Map mount | Yes | No |
| `buildSnapshot()` as `useState` initialiser | Map mount | Yes | No |
| `setInterval` (500 ms) | Overlay opening | No | No |
| `clearInterval` (cleanup) | Overlay closing / unmount | — | No |
| Long-press handler — `__DEV__` gate removed | Active navigation (user-triggered) | No | No |
| Console log local-variable refactor | Same as prior `console.log` sites | Varies | No |
| Style constant changes | Module evaluation (pre-mount) | Yes | No |

---

## What Requires the Crash Report to Determine

The table above establishes the *earliest* point each change can execute. It does not
establish which, if any, of these changes caused the Build #212 crash. The following
questions can only be answered from the Apple crash report:

1. **At what point did the crash occur?** (launch, Map mount, navigation start, active
   navigation, overlay interaction)
2. **Which thread crashed?** (JS/Hermes thread, main thread, a background thread)
3. **What is the exception type?** (EXC_BAD_ACCESS, EXC_CRASH, NSException, Hermes fault, …)
4. **What is the top ChargeBridge frame in the crashed thread's stack?**

Until those four facts are known, no item in this document should be named a root cause.

---

*Generated from `git diff e5c6559 ffbdd4a` (Build #210 → #212). Build #213 remains blocked.*
