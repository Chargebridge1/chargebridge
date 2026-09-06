# Build #208 — Nav Timing Feedback Summary

**Build:** #208  
**Feedback window:** TestFlight preview channel — physical-device session  
**Triage owner:** Engineering  
**Summary last updated:** 2026-08-09 — physical-device test complete, hypothesis disproved  
**Source commit:** `d5828df3099f9e9a660fbc61983f25c6a88d889e`

---

## Process Note — Required Evidence NOT Captured

**This session does not qualify as Runtime Verified.**

Per the navigation investigation policy (added to `docs/verification-stages.md` on 2026-08-09):
a physical-device navigation session is not complete until all diagnostic evidence identified
as necessary to distinguish competing root causes has been captured and recorded.

Build #208 contained `[NavVoice][TRACE]` logs (`navSpeak` call timestamp,
`Speech.speak(forced) since_navSpeak=Xms`, `ttsOnDone elapsed=`) that would have answered
the critical question — **does the delay occur before or after `navSpeak()`?** — in one
session. These logs were present in the app but were not listed as required evidence in the
tester feedback form, so they were not captured.

As a result, the `routeArcDistM` hypothesis was proposed and approved on code analysis alone,
without runtime confirmation that the delay was pre-`navSpeak()`. The fix had no effect.

This failure has been documented and the policy has been corrected. Build #209 contains the
`[NavGPS][TRACE]` and `[NavVoice][DIST]` instrumentation and a Required Evidence table that
must be fully completed before the session is considered done.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Highway delay | Missing announcements | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #208 TestFlight | ❌ Same as Build #207 — no improvement | ❌ Still delayed ~500 ft | Some missed | Not evaluated | ❌ P1 blocker — hypothesis disproved |

**Required diagnostic logs captured:** ❌ NO — `[NavVoice][TRACE]` present in app but not listed as required; `navSpeak` timestamp and `since_navSpeak` not reported  
**Session qualifies as Runtime Verified:** ❌ NO — required evidence not captured (process failure, now corrected)

**Conclusion:** `routeArcDistM` backward-step fix was correct but not the primary cause of the delay. Root cause investigation continues in Build #209. See `docs/build-208-nav-root-cause.md`.

---

### Off-Route Detection (Section 2)

| Tester / Device | Rerouting delay | False triggers | Regression? |
|---|---|---|---|
| Physical device — Build #208 TestFlight | ⚠️ Still slow — unchanged from Build #207 | Not confirmed | ⚠️ Under investigation |

**Required diagnostic logs captured:** ❌ NO — `[NavRoute][TRACE]` reroute timing not reported

---

### Arrival Gate (Section 3)

| Tester / Device | Result |
|---|---|
| Physical device — Build #208 TestFlight | Not evaluated — session ended due to voice timing P1 |

---

## Regression Status

| Task ref | Title | Evidence from Build #208 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | Not evaluated (timing failure dominated) | PROPOSED — carry to Build #209 |
| #702 | Confirm no duplicate arrival notification on stale background batch | Not evaluated | PROPOSED — carry to Build #209 |
| #703 | Foregrounding reroute picks correct last-known location | Not evaluated | PROPOSED — carry to Build #209 |
| #711 | Reroute resets step index correctly at different speed bucket | Not evaluated | PROPOSED — carry to Build #209 |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | Not evaluated | PROPOSED — carry to Build #209 |

**Primary failure: routeArcDistM hypothesis disproved — NO IMPROVEMENT from Build #207 timing fix. Build #209 is a diagnostic-only build to identify where the delay actually occurs in the runtime pipeline.**

---

## Distribution checklist

- [x] Physical-device session completed (Build #208)
- [x] Result recorded: NO IMPROVEMENT — hypothesis disproved
- [x] Root cause report updated with disproved addendum (`docs/build-208-nav-root-cause.md`)
- [x] Build #209 investigation plan written (`docs/build-209-nav-investigation.md`)
- [x] Policy corrected: required diagnostic evidence now a hard gate (`docs/verification-stages.md`)
- [ ] Build #209 device session pending — see Required Evidence table in investigation doc
