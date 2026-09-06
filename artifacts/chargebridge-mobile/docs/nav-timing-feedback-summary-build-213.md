# Build #213 — Crash-Only Predecessor Record

**Build:** #213  
**Session status:** **BUILD #213 — CRASH-ONLY / NO VALID NAVIGATION SESSION**  
**Runtime verification status:** **Not Runtime Verified**

---

## Session Validity

Build #213 was submitted to TestFlight and crashed before the application
opened. It therefore produced no valid navigation session and no navigation
timing evidence.

This document is a factual predecessor record for the next build gate. It is
not a navigation-timing result.

---

## Required Navigation Evidence

All navigation measurements for Build #213 are explicitly classified as:

**NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION**

| Evidence item | Build #213 result | Status |
|---|---|---|
| GPS position | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| GPS accuracy | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| Vehicle speed | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| GPS age / interval | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| Route telemetry | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| Distance from maneuver at `navSpeak()` | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| `routeArcDistM` | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| Straight-line distance | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| `navSpeak()` timestamp | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Not captured |
| Pre- versus post-`navSpeak()` delay classification | NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION | Cannot determine |

No estimates, synthetic values, or reconstructed measurements are entered as
Build #213 results.

---

## Crash Status

Apple identified the Build #213 crash as a native dynamic-linking failure
involving `ExpoFileSystem.framework` and `ExpoModulesCore.framework`.

The incompatible dependency pair was:

- `expo-file-system` `57.0.2`
- `expo-modules-core` `57.0.6`

Build #210 is the last known stable binary. Its relevant dependency graph was:

- `expo` `57.0.7`
- `expo-modules-core` `57.0.6`
- `expo-file-system` `57.0.1`

---

## Synthetic Fixture Boundary

The Build #207 synthetic fixture must not be represented as Build #213
runtime evidence. It is not used to populate any Build #213 measurement or
timing result.

---

## Runtime Verification Conclusion

**Build #213 does not qualify as Runtime Verified.**

Build #213 produced no valid navigation session. GPS and navigation timing
measurements were not captured. No conclusion about the original navigation
timing problem can be drawn from Build #213.

---

## Regression Status

Navigation regression status cannot be evaluated from Build #213 because the
application crashed before navigation. The navigation investigation remains a
separate phase after launch stability has been established.

---

## Distribution Checklist

- Build #213 submitted to TestFlight: recorded
- Application opened: no
- Native dynamic-linking failure: recorded by Apple
- Valid navigation session: none
- GPS or route telemetry: NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION
- Valid `navSpeak()` distance or timestamp evidence: NOT CAPTURED — BUILD CRASHED BEFORE NAVIGATION
- Build #207 synthetic fixture used as Build #213 evidence: no
- Runtime Verified: no