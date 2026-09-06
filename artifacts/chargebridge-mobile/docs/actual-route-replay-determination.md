# Actual Affected-Route Replay and Root-Cause Determination

**Date:** 2026-08-20  
**Scope:** Follow-up #781 only  
**Baseline fixture:** Build #207 source state, commit `9062008`  
**Status:** Actual-route replay blocked by missing route/GPS evidence

---

## 1. Scope and safety decision

This follow-up was limited to replaying the actual affected highway route through
the existing deterministic Build #207 fixture.

No production navigation logic was changed. No navigation correction was
proposed or implemented. Build #213 was not created.

The synthetic fixture result is not being promoted to a physical-device root
cause.

---

## 2. Evidence audit

The workspace was checked for:

- GPX, FIT, TCX, KML, GeoJSON, CSV, or other route exports
- timestamped latitude/longitude and accuracy samples
- route-history or navigation-session exports
- completed Build #207 or Build #212 feedback forms
- `[NavGPS]`, `[NavVoice]`, or `[NavRoute]` runtime log exports
- `navSpeak`, `Speech.speak`, `ttsOnDone`, or audible-onset measurements
- archived artifacts containing a route trace or device log
- prior tracked Git artifacts containing actual route data

No usable actual-drive dataset was found in the project workspace or its tracked
history. No connected device/TestFlight data source is available to this
workspace.

### What does exist

| Source | What it establishes | Why it cannot be replayed |
|---|---|---|
| Build #207 physical-device feedback | Qualitative report of approximately 500 ft late highway announcements | No GPS positions, timestamps, route geometry, maneuver coordinate, zone, or TTS timing |
| Build #208 physical-device feedback | Same delay and no material improvement after the `routeArcDistM` change | Explicitly records that required diagnostic logs were not captured |
| Build #209 feedback | Device session completed | `__DEV__` disabled all diagnostic blocks in the EAS preview build |
| Build #210 feedback | Device session completed on the same highway route | No ChargeBridge runtime logs appeared in Console.app |
| Build #211 feedback | Device build crashed | No diagnostic file or timing data was captured |
| Build #207 / #212 feedback templates | Required fields and measurement protocol | Templates are blank; they are not route evidence |
| Synthetic Build #207 fixture | Deterministic characterization of the reconstructed highway geometry | It is not the affected physical route |

The existing reports therefore contain observations and test instructions, not
the actual route/GPS inputs required by this follow-up.

---

## 3. Actual-route replay status

**Replay executed:** No.

There is no actual sequence to feed into the fixture. In particular, the
following required inputs are absent:

| Required input | Available? |
|---|---|
| Vehicle latitude/longitude at each GPS tick | No |
| GPS timestamp and cadence | No |
| GPS accuracy at each tick | No |
| Route polyline/geometry | No |
| Maneuver coordinate | No |
| Vehicle speed at each tick | No |
| Active step index at each tick | No |
| Actual route arc distance | No |
| Straight-line distance | No |
| Active a1/a2/a3 zone | No |
| Exact `navSpeak()` trigger point | No |
| TTS dispatch timing | No |
| Native audible-onset timing | No |

Consequently, no actual-route values have been fabricated or inferred from the
qualitative “approximately 500 ft late” report.

---

## 4. Comparison with the synthetic Build #207 result

| Result | Synthetic Build #207 replay | Actual affected route |
|---|---:|---|
| Route geometry | Straight 0–3,000 m polyline, 200 m segments | Not available |
| GPS cadence | 1,000 ms | Not available |
| Speed | 29.056 m/s / 65 mph | Only qualitative highway-speed report |
| Maneuver location | 3,000 m | Not available |
| Corrected-path a3 eligibility | 355.43 m | Not available |
| Legacy Build #207 a3 `navSpeak()` | 181.29 m | Not available |
| Legacy-vs-corrected difference | 174.14 m / 571 ft / 5.99 s | Not available |
| App TTS dispatch after `navSpeak()` | 0 ms in the fake idle speech model | Not available |
| Reroutes | None | Not available |

The synthetic result demonstrates a possible PRE-NAVSPEAK failure under the
reconstructed geometry. It does not establish that the affected drive had the
same geometry, GPS cadence, route matching state, or step state.

---

## 5. Required answers

### A. Does the actual route reproduce the same PRE-NAVSPEAK failure?

**Indeterminate.**

The actual route could not be replayed because its GPS trace and route geometry
are absent. The qualitative report that the voice was approximately 500 ft late
does not identify whether the vehicle was late at `navSpeak()` or only became
audible later.

### B. If yes, is `routeArcDistM` demonstrably responsible?

**Not applicable; no actual-route PRE-NAVSPEAK result exists.**

`routeArcDistM` is not demonstrably responsible for the physical incident.
Additionally, the existing Build #208 physical-device result—no material
improvement after the forward-step correction—disproves it as a sufficient
root-cause explanation based on the evidence currently available.

That physical result is still not a complete pipeline diagnosis because it did
not capture the actual `navSpeak()` boundary.

### C. If no, what part of the actual navigation pipeline produces the delay?

**Cannot be determined from the available evidence.**

There is no actual-route timestamp chain separating:

`GPS received → position matching → step selection → distance calculation →
zone evaluation → navSpeak → TTS dispatch → audible onset`.

No GPS, step-advance, zone-threshold, route-geometry, TTS, or audio-stage cause
can be selected without those measurements.

### D. Is there evidence of a separate GPS, step-advance, zone-threshold, or route-geometry issue?

**No actual-route evidence establishes any of those causes.**

The synthetic replay exposes one route-geometry/arc-distance failure mode in the
reconstructed Build #207 scenario. The physical-drive records do not show that
the affected route had the same polyline structure or that the same
calculation produced the late trigger.

The following remain hypotheses only:

- stale or low-cadence GPS delivery
- position/map-matching lag
- step index advancing or remaining stale at the wrong point
- zone threshold evaluation using an incorrect distance
- route geometry or interpolation mismatch
- post-`navSpeak()` speech scheduling or audio onset delay

---

## 6. Root-cause determination

**Actual physical-device root cause: undetermined.**

The strongest supported conclusions are:

1. A synthetic Build #207 route can reproduce a 174.14 m / 571 ft
   pre-`navSpeak()` difference between the legacy and corrected arc calculations.
2. The synthetic fixture's fake speech layer adds 0 ms after `navSpeak()`, so
   that replay is PRE-NAVSPEAK.
3. The actual affected route is not present and therefore has not been
   replayed.
4. Build #208's no-improvement result means the `routeArcDistM` correction is
   not sufficient evidence for the physical incident.
5. No production correction is justified by the available actual-route
   evidence.

This investigation stops here as approved. A future replay requires an
exported route polyline plus timestamped GPS samples and, ideally, the
`navSpeak`/TTS timing records from the same maneuver.