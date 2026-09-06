# Build #212 — Nav Timing Feedback Summary

**Build:** #212  
**Session status:** **NO VALID RUNTIME EVIDENCE / SESSION INVALID**  
**Runtime verification status:** **Not Runtime Verified**

---

## Session Validity

Build #212 was deployed and attempted on a physical device. The session did
not produce usable navigation telemetry, and the app crashed during the
attempt.

The physical-device session therefore does not qualify as Runtime Verified.
No valid navigation timing measurements can truthfully be reported from
Build #212.

---

## Required Navigation Evidence

| Evidence item | Build #212 result | Status |
|---|---|---|
| GPS position | No GPS telemetry was captured | Not captured |
| GPS accuracy | No GPS telemetry was captured | Not captured |
| Vehicle speed | No GPS telemetry was captured | Not captured |
| GPS age / interval | No GPS telemetry was captured | Not captured |
| Route telemetry | No route telemetry was captured | Not captured |
| Distance from maneuver at `navSpeak()` | No navSpeak distance evidence was captured | Not captured |
| `routeArcDistM` | No navSpeak distance evidence was captured | Not captured |
| Straight-line distance | No navSpeak distance evidence was captured | Not captured |
| `navSpeak()` timestamp | No navSpeak timestamp evidence was captured | Not captured |
| Pre- versus post-`navSpeak()` delay classification | No valid evidence was captured to make this determination | Cannot determine |

No valid pre-`navSpeak()` or post-`navSpeak()` determination is possible from
the Build #212 session.

---

## Crash Status

The crash remains separately unresolved because the Apple crash report has not
been obtained. The available session facts establish that the app crashed and
that usable navigation evidence was not produced; they do not establish the
crash exception, thread, stack, or root cause.

No navigation behavior conclusion or navigation fix is authorized from this
session.

---

## Synthetic Fixture Boundary

The Build #207 synthetic fixture result remains synthetic test evidence only.
It is not physical-device telemetry, is not Build #212 runtime evidence, and
is not used to populate any Build #212 measurement or timing result.

---

## Runtime Verification Conclusion

**Build #212 does not qualify as Runtime Verified.**

The session is explicitly classified as **NO VALID RUNTIME EVIDENCE /
SESSION INVALID**. No estimated values, synthetic fixture values, or Build
#207 replay values are entered anywhere as Build #212 results.

---

## Regression Status

Navigation regression status cannot be evaluated from Build #212 because the
session produced no valid navigation telemetry. Navigation investigation
remains frozen pending valid evidence and the separate Apple crash report.

---

## Distribution Checklist

- Build #212 deployment/attempt: recorded
- Physical-device session: invalid
- Valid GPS or route telemetry: not captured
- Valid navSpeak distance or timestamp evidence: not captured
- Valid pre/post-navSpeak classification: not possible
- Apple crash report: not obtained
- Runtime Verified: no