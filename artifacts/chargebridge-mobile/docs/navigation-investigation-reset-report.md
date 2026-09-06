# Navigation Investigation Reset Report

**Date:** 2026-08-12  
**Builds covered:** #207 – #211  
**Status:** Investigation frozen pending crash root cause confirmation  

---

## 1. Original Problem

Turn-by-turn voice announcements fire approximately **500 feet late** on highway drives.
The issue is worst at highway speed (~65 mph) and is consistent across sessions — not
intermittent. Some announcements are missed entirely. The problem was first confirmed
on a physical device in Build #207 and has been present in every build since.

**The key unanswered question, then and now:**  
Does the delay occur *before* `navSpeak()` is called (wrong trigger distance/zone), or
*after* `navSpeak()` is called (TTS scheduling, queuing, or Speech.speak latency)?

---

## 2. What Has Actually Been Proven

| Fact | Source | Confidence |
|---|---|---|
| Announcements are consistently ~500 ft late at highway speed | Physical device, Build #207 | ✅ Confirmed |
| `routeArcDistM` backward-step bug existed in code | Source analysis | ✅ Confirmed |
| Fixing `routeArcDistM` produced **no improvement** | Physical device, Build #208 | ✅ Confirmed |
| `__DEV__` is `false` in EAS `preview` profile builds | Source analysis + two sessions | ✅ Confirmed |
| `console.log()` does **not** appear in Console.app in RN 0.86 Hermes production builds | Physical device, Builds #209 and #210 | ✅ Confirmed (two independent sessions) |
| Build #211 crashed on device | Tester report | ✅ Confirmed |

---

## 3. What Has Been Disproven

| Hypothesis | Disproved by | Notes |
|---|---|---|
| `routeArcDistM` overcounting is the primary cause of the ~500 ft delay | Physical device, Build #208 | No improvement after fix — not the root cause |

---

## 4. What Remains Unknown

| Question | Why Unknown |
|---|---|
| Does the delay occur before or after `navSpeak()` is called? | **The original question.** Five builds have not produced a single runtime data point that answers it. |
| Is the delay in zone threshold calculation, GPS arc distance computation, or TTS scheduling? | No runtime data. |
| What caused the Build #211 crash? | Actual crash log not yet obtained. Exception type, crashed thread, and stack trace required. |
| Whether the `routeArcDistM` fix (Build #208) introduced any side effects | No clean runtime data post-#208 |

---

## 5. All Navigation Changes Since the Original Problem

| Build | Change | Type | Outcome |
|---|---|---|---|
| #208 | Added `routeArcDistM` forward-step arc distance to zone threshold calculations | **Navigation logic change** | No improvement. Hypothesis disproved. |
| #209 | Added `[NavGPS][TRACE]`, `[NavVoice][DIST]`, `[NavVoice][ARC]` logs inside `if (__DEV__)` | Diagnostic only | All logs were dead code in TestFlight. No data captured. |
| #210 | Removed `if (__DEV__)` guards from all three diagnostic blocks | Diagnostic only | `console.log()` confirmed unreliable in Console.app for this build config. No data captured. |
| #211 | Added `navDiagLogger.ts` (file-based logger) + `expo-file-system` dependency + `Sharing.shareAsync` at nav end | Diagnostic only + new native dependency | Build crashed on device. No data captured. |

**Navigation logic changes: 1 (Build #208 `routeArcDistM`)**  
**Diagnostic-only changes: 3 (Builds #209, #210, #211)**  
**Runtime data captured: 0 bytes across all 5 builds**

---

## 6. Which Changes Demonstrably Improved the Problem

**None.** No change across Builds #207–#211 has produced a measurable improvement in
announcement timing. The `routeArcDistM` fix (the only navigation logic change) was
tested and produced no improvement.

---

## 7. Which Changes Did Not Improve the Problem

| Build | Change | Result |
|---|---|---|
| #208 | `routeArcDistM` forward-step correction | Tested on device. No improvement. |
| #209 | Diagnostic logs (dead code) | Not testable — `__DEV__` guard disabled all output |
| #210 | Diagnostic logs (no `__DEV__` guard) | Console.log confirmed invisible in Console.app |
| #211 | File-based logging | Build crashed. Not testable. |

---

## 8. Build #211 Crash Root Cause

### What the source diff shows

The complete delta from Build #210 → Build #211:

1. **New file:** `utils/navDiagLogger.ts` — imports `expo-file-system/legacy`, buffers log lines in a JS array, writes to `documentDirectory` on session end
2. **New dependency:** `expo-file-system: ^57.0.2` — not present in any prior build; adds a new native pod (`ExpoFileSystem`)
3. **`map.tsx` additions only:** `diagStartSession()` at nav start; `diagLog()` alongside every existing `console.log()`; `diagEndSession().then(Sharing.shareAsync)` at **two locations** (arrival detection and `stopNavigation`)
4. No navigation logic changed

### Candidate crash vectors (from static analysis)

**Vector A — `expo-file-system/legacy` Metro resolution (startup crash)**  
The `expo-file-system/legacy` subpath export resolves to `./src/legacy/index.ts` — raw
TypeScript source, not compiled JS. Metro's package-exports support (`unstable_enablePackageExports`,
enabled by default in SDK 57) should resolve this. If it fails, the bundle throws a
module-not-found error at startup, before navigation begins. **If the crash happened at
app launch, this is the primary suspect.**

**Vector B — `Sharing.shareAsync()` presented during navigation teardown (mid-session crash)**  
`diagEndSession().then((diagPath) => Sharing.shareAsync(...))` fires asynchronously
during navigation teardown — either at arrival detection (inside the GPS position
handler) or inside `stopNavigation`. `Sharing.shareAsync` presents `UIActivityViewController`
on iOS. The existing PDF sharing call in the app is triggered from a stable, user-initiated
button press. Presenting a modal view controller during an active navigation state transition
can produce `NSInternalInconsistencyException` if the view hierarchy is mid-animation or
the presenting controller is not in the window hierarchy at the moment the `.then()` resolves.
**If the crash happened during or at the end of a navigation session, this is the primary suspect.**

**Vector C — Double share-sheet invocation (mid-session crash)**  
Two call sites for `diagEndSession().then(Sharing.shareAsync)` exist: the arrival GPS
handler and `stopNavigation`. In normal use both fire in the same session — auto-arrival
triggers the first; the user tapping the end-navigation button triggers the second. The
`_active` flag prevents writing twice, but both calls reach `Sharing.shareAsync` (the
second with `_lastPath`). iOS does not permit presenting `UIActivityViewController` over
an already-presented one; the second call raises an ObjC exception that RN 0.86 converts
to a fatal bridge error at the JSI boundary. **If both arrival and stop fired, this is
likely what crashed.**

**Vector D — `ExponentFileSystem` native module not linked**  
The fingerprint changed (`d4d7c41c` vs Build #210's `3ff54ad9`), confirming EAS ran a
fresh native build with `pod install`. The pod should have been linked. If absent, the
`requireOptionalNativeModule` shim returns null, `documentDirectory` is null, and the
`?? ""` fallback produces a bare filename that `writeAsStringAsync` rejects — caught by
`try/catch`, returns null, `Sharing.shareAsync` is never called. **This path cannot crash.
Listed for completeness; assessed low likelihood.**

### What is NOT available from this environment

The actual crash log — exception type, crashed thread, and stack trace — is not accessible
from the EAS CLI or this environment. It must be retrieved from:

- **Xcode Organizer:** Window → Organizer → Crashes → filter ChargeBridge → select Build #211 crash
- **TestFlight crash dashboard:** App Store Connect → TestFlight → ChargeBridge → Crashes → Build 211
- **Device Console.app:** Filter process `ChargeBridge`; crash timestamp + `NSException` message visible without Xcode

**The single most useful triage question before reading the full log:**  
Did the crash occur at **app launch** (before any navigation started), or during/after
**a navigation session ended**? That one answer eliminates either Vector A or Vectors B/C.

### Root cause verdict

**Cannot be confirmed without the actual crash log.** Static analysis yields three
viable candidates. The crash log is required to distinguish between them.

---

## 9. Recommended Path to Resolution

### Immediate (no build)

1. **Obtain the Build #211 crash log** from Xcode Organizer or TestFlight. Provide the
   exception type, crashed thread, and first application-owned frame. This confirms the
   crash root cause at zero cost and no new build.

2. **Review the original question** once the crash is understood. The fundamental
   problem — announcements ~500 ft late at highway speed — has never been instrumented
   successfully. Five builds, zero data points. The next diagnostic attempt must be
   radically simpler.

### Structural constraint on the next diagnostic approach

Any future diagnostic must satisfy all three of these:

- **No new native dependencies.** `expo-file-system` added a native pod that was not
  present before and introduced the crash. The diagnostic layer must be zero-native.
- **No async I/O at navigation teardown.** Async operations fired during navigation
  state transitions are the most likely crash mechanism. End-of-session callbacks are
  a hazardous moment to present native UI.
- **No new call sites that can fire twice.** Arrival + stopNavigation is a known double-fire
  pattern. Any session-end handler must tolerate being called from both paths without
  producing two concurrent native UI presentations.

### The smallest change that can actually answer the original question

The two `[NavVoice][TRACE]` log lines already in the codebase capture `navSpeak`
timestamp and `since_navSpeak` elapsed (time from `navSpeak()` call to `Speech.speak()`
entry). These two numbers answer whether the delay is pre- or post-`navSpeak()` in one
drive. The only unsolved problem is getting those numbers off the device without
`console.log` → Console.app (confirmed broken) and without file I/O (crash risk).

An in-UI display — a small fixed overlay in the nav panel that holds the last N log
lines as React state — requires zero native dependencies, zero async I/O, zero new
libraries, and is visible to the tester directly on screen. It can be dismissed or
hidden by default in a non-nav build. This is the direction worth evaluating, not
a decision or a code change.

---

## Gate: Build #212 Prerequisites

Build #212 **must not proceed** until all of the following are complete:

- [ ] Build #211 crash log obtained (exception type + stack trace from Xcode Organizer or TestFlight)
- [ ] Build #211 crash root cause confirmed (not hypothesized)
- [ ] This reset report reviewed and the path forward explicitly approved
- [ ] `nav-timing-feedback-summary-build-211.md` committed (✅ done — committed alongside this document)
- [ ] The next diagnostic approach satisfies all three structural constraints above
