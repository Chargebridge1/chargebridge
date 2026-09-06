# One-Maneuver Navigation Evidence Capture — Design Review

**Date:** 2026-08-20  
**Status:** Design only — implementation and TestFlight build require approval  
**Purpose:** Capture the causal boundary for one late highway a3 maneuver without
changing navigation behavior.

---

## Decision

**Do not reuse `NavDebugOverlay` unchanged for the evidence build.**

It is a useful source of existing diagnostic inputs, but it is neither a safe
enough execution path nor a complete evidence interface for this investigation.
The proposed replacement is a small, conditionally mounted, one-record capture
panel. It is active only after a tester explicitly arms it during navigation.

No code is changed by this review.

---

## Existing component review

### What can be reused safely as data sources

`app/(tabs)/map.tsx` already computes the values required for an a3 voice-zone
decision:

- `Location.LocationObject` provides GPS timestamp, latitude, longitude,
  accuracy, and speed.
- The voice-zone block computes the active route-arc distance
  (`routeArcDistM`) and direct haversine distance to the maneuver.
- `navState.currentStepIdx` and the a1/a2/a3 blocks identify the active
  maneuver and zone.
- `navSpeak()` already defines the app-level speech boundaries:
  entry timestamp, actual `Speech.speak()` dispatch, and `onDone`.

These computations are already in the normal navigation path. The diagnostic
will read their local values and copy one immutable snapshot; it will not
recalculate a route, match a position, or change a speech decision.

### Why the existing overlay is not sufficient unchanged

`components/NavDebugOverlay.tsx` currently:

1. Is instantiated whenever `MapScreen` mounts, even when hidden.
2. Calls `buildSnapshot()` during that mount.
3. Starts a 500 ms React state interval when opened.
4. Is toggled through the Build #212 long-press path, which also invokes
   `Haptics.impactAsync`.
5. Displays live, rounded ref values rather than preserving the values that
   belonged to a specific `navSpeak()` invocation.
6. Does not display GPS latitude/longitude, GPS accuracy, current step index,
   the exact maneuver coordinate, or separate timestamps for navSpeak, TTS
   dispatch, and TTS completion.

The Build #212 Apple crash report is still unavailable. The prior source review
found no proven overlay crash mechanism, but it also explicitly concluded that
no Build #212 change can be certified safe without the crashed-thread stack.
Therefore, an existing Build #212 render/mount/polling/long-press path must not
be treated as safe merely because it has no file I/O or new dependency.

---

## Minimal proposed diagnostic

### Test-build enablement

Use a public build-time flag such as
`EXPO_PUBLIC_NAV_EVIDENCE_CAPTURE=1`, set only for the single approved
diagnostic TestFlight build.

This is deliberately not `__DEV__`. When the flag is absent, no evidence
control, panel, GPS capture write, or diagnostic state update is active.

### Tester flow

1. Start ordinary driving navigation.
2. Tap **Capture next a3** in the turn banner during the highway approach.
3. The capture arms exactly one a3 maneuver.
4. On that maneuver, the app freezes the GPS/route/zone values at the
   `navSpeak()` boundary.
5. The panel updates once when `Speech.speak()` is dispatched and once when
   the utterance finishes.
6. The tester screenshots the completed panel. There is no export, share
   sheet, console, background task, or end-of-navigation operation.

The control and panel exist only while navigation is active. They are removed
when navigation ends.

### Single immutable capture record

The capture record is created only for an armed a3 call and contains:

| Field | Source at capture |
|---|---|
| `gpsTimestampMs` | `Location.LocationObject.timestamp` |
| `gpsReceivedAtMs` | `Date.now()` in the location callback |
| `gpsIntervalMs` / `gpsFixAgeMs` | Existing tick timing calculation |
| `latitude` / `longitude` | Current `pos.coords` |
| `accuracyM` / `speedMs` | Current `pos.coords` |
| `routeArcDistanceM` | Current `distToNextM` used by the a3 condition |
| `straightDistanceM` | Current haversine distance to the same maneuver |
| `maneuverLatitude` / `maneuverLongitude` | `steps[nextIdx].coordinate` |
| `stepIndex` / `routeVersion` | Current zone evaluation state |
| `zone` | Literal `"a3"` |
| `navSpeakAtMs` | Entry to the a3 `navSpeak()` call |
| `ttsDispatchAtMs` | Immediately before the corresponding `Speech.speak()` |
| `ttsCompletedAtMs` | Matching `onDone` callback |
| `ttsOutcome` | `completed`, `stopped`, or `error` |

The panel derives, without changing any runtime behavior:

- vehicle road distance from the maneuver when `navSpeak()` fired:
  `routeArcDistanceM`
- direct distance for geometry comparison: `straightDistanceM`
- app-level speech delay:
  `ttsDispatchAtMs - navSpeakAtMs`
- total speech completion time:
  `ttsCompletedAtMs - navSpeakAtMs`

This measures app-level dispatch, not native audible onset. Expo Speech does
not provide an audible-onset callback. The record will state that limitation
instead of mislabeling dispatch as audible playback.

### State and rendering rules

- The GPS handler makes no React state update.
- While unarmed, it does no diagnostic capture write.
- While armed, it stores only the current a3 context needed to create the
  one immutable record.
- React state changes at most four times: tester arms, a3 `navSpeak` is
  captured, TTS dispatch is captured, and terminal TTS outcome is captured.
- The panel has no interval, no `useEffect`, no timer, and no native module
  invocation.
- A per-capture token ensures callbacks from another utterance cannot overwrite
  the selected maneuver's timestamps.

---

## Crash-risk review

### Avoided Build #211 mechanisms

The design does not add a package, native pod, file write, async teardown task,
share sheet, or arrival/stop-navigation callback. It therefore avoids the
known Build #211 candidate mechanisms:

- `expo-file-system/legacy`
- file output at navigation teardown
- `Sharing.shareAsync`
- duplicate share-sheet presentation

### Reduced Build #212 overlap

The diagnostic build will not render or toggle `NavDebugOverlay`; its existing
unconditional mount and long-press handler will be removed from the diagnostic
path. The new panel is not mounted on Map mount, does not poll refs, and does
not call haptics.

This does **not** claim the Build #212 crash root cause is known. The Apple
crash stack remains required to establish that cause. It does mean the proposed
diagnostic avoids the Build #212 overlay execution paths that cannot currently
be certified.

The remaining implementation touches are plain JavaScript object copies and
React text rendering. They cannot introduce the Build #211 native file/share
mechanism and do not invoke `Speech.stop()` or `Speech.speak()` beyond the
existing navigation behavior.

---

## Exact implementation surface after approval

| File | Planned change |
|---|---|
| `app/(tabs)/map.tsx` | Remove the existing overlay render/toggle from the diagnostic build path; add an explicitly armed, a3-only evidence context; copy it at `navSpeak`, dispatch, and terminal TTS callbacks; conditionally render the capture control only during active navigation and only when the public flag is enabled. |
| `components/NavEvidenceCapturePanel.tsx` | New presentational `View`/`Text` panel that displays one immutable record and derived timings. No effects, timers, polling, native calls, storage, or I/O. |
| `utils/navEvidenceCapture.ts` | New small pure type/transition helper for arm, capture, dispatch, and terminal outcome operations. It assigns and verifies the capture token. |
| `__tests__/navEvidenceCapture.test.ts` | New pure regression tests showing that an unarmed session records nothing, one a3 record preserves the exact speak-time values, and mismatched/stale callbacks cannot overwrite it. |

The public flag will be supplied only to the approved diagnostic build
environment. It is not a secret and does not require a new native dependency.

---

## Explicit non-changes

The implementation will not change:

- a1/a2/a3 thresholds or zone conditions
- `routeArcDistM`
- route geometry or position matching
- step-advance logic
- reroute or off-route logic
- GPS watch accuracy, cadence, or throttling configuration
- `scheduleForcedSpeak`, settle timing, `Speech.stop()`, or `Speech.speak()`
  behavior
- voice settings or audio-session configuration
- production data, storage, APIs, native dependencies, or build number

No TestFlight build will be created until this design is approved. The
diagnostic build's sole purpose will be to capture one real affected maneuver;
after that evidence is reviewed, navigation logic remains frozen.