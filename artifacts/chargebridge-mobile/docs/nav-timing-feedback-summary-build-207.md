# Build #207 — Nav Timing Feedback Summary & Regression Triage

**Build:** #207  
**Feedback window:** TestFlight preview channel — physical-device sessions  
**Triage owner:** Engineering  
**Summary last updated:** 2026-08-09 — physical-device test complete, root cause identified

---

## How to use this document

1. Collect completed copies of `docs/nav-timing-feedback-build-207.md` from each tester.
2. Paste a one-line result per tester into the tables below.
3. If any row contains a ❌ or ⚠️, open or update the linked task with the tester's device log attached.
4. Update the **Regression Status** column when a task is filed or closed.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Early on curved on-ramp? | Missing announcements? | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #207 TestFlight | ❌ Consistently late (~500 ft behind maneuver) | No | Some missed entirely | Not tested (timing failure blocks useful B2B data) | ❌ YES — P1 blocker |

**Escalation threshold:** Any ❌ "consistently late" OR confirmed missing announcement → file Root Cause Report, block next build.  
**Related task:** #672 (early announcement on curved on-ramps)  
**Action taken:** Root cause identified — `routeArcDistM` backward-step bug. Fix in Build #208.

---

### Off-Route Detection (Section 2)

| Tester / Device | False triggers | Failed reroute | Cooldown respected | Mode-switch ok | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #207 TestFlight | Not confirmed | ⚠️ Rerouting slow to initiate | Unknown | Not tested | ⚠️ Rerouting delay — under investigation |

**Escalation threshold:** >1 false trigger per session on a road with good GPS signal → investigate before next build.  
**Related tasks:** #711 (step-index reset after reroute), #712 (GPS speed missing fallback)

---

### Arrival Gate (Section 3)

| Tester / Device | Timing ok? | Background arrival? | Walking/cycling arrival? | Duplicate? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #207 TestFlight | Not evaluated (session ended due to voice timing P1) | Not tested | Not tested | Not observed | Not evaluated |

**Escalation threshold:** Any duplicate arrival OR arrival never fired → file regression before next build.  
**Related tasks:** #702 (duplicate arrival from background batch), #704 (arrival on foot/cycling)

---

### Reroute Cooldown UX (Section 4)

| Tester / Device | Cooldown observed? | Indicator visible? | Notes | Regression? |
|---|---|---|---|---|
| Physical device — Build #207 TestFlight | Not confirmed | No indicator | Session focus was voice timing P1 | Not evaluated |

**Related task:** #708 (show cooldown remaining when reroute suppressed)

---

### Background / Foreground Handoff (Section 5)

| Tester / Device | BG/FG tested? | Location correct on FG? | Spurious reroute on FG? | Regression? |
|---|---|---|---|---|
| Physical device — Build #207 TestFlight | No — session ended early | N/A | N/A | Not evaluated |

**Escalation threshold:** Any confirmed stale-location reroute on foreground → file blocker.  
**Related task:** #703 (foregrounding reroute uses stale background location)

---

## Regression Status

| Task ref | Title | Evidence from Build #207 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | Not confirmed (timing failure prevented useful on-ramp data) | PROPOSED — carry to Build #208 |
| #702 | Confirm no duplicate arrival notification on stale background batch | Not evaluated — session ended early | PROPOSED — carry to Build #208 |
| #703 | Foregrounding reroute picks correct last-known location | Not tested | PROPOSED — carry to Build #208 |
| #704 | Arrival gate fires correctly when on foot or cycling | Not tested | PROPOSED — carry to Build #208 |
| #708 | Show cooldown remaining when reroute is suppressed | Not evaluated | PROPOSED — carry to Build #208 |
| #711 | Reroute resets step index correctly at different speed bucket | Not evaluated | PROPOSED — carry to Build #208 |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | Not evaluated | PROPOSED — carry to Build #208 |

**Primary failure: voice ~500 ft behind maneuver (all roads, worst highway). Root cause: `routeArcDistM` overcounting bug. Fix targeted in Build #208.**

---

## Nav Timing Thresholds (Build #207 reference)

*These constants are baked into `app/(tabs)/map.tsx` and `tasks/backgroundNav.ts` at commit `9062008`.*

| Parameter | Value | Notes |
|---|---|---|
| Arrival gate | 60 m | Must remain < max step-advance threshold (65 m highway) |
| Step-advance: highway (>50 mph) | 65 m | ~2–3 s lead at highway speed |
| Step-advance: urban arterial (>30 mph) | 50 m | |
| Step-advance: residential (>15 mph) | 35 m | |
| Step-advance: slow / stationary | 25 m | |
| Voice zone a3: highway (65 mph) | ~350 m intended | Buggy routeArcDistM caused suppression until next polyline vertex |
| Voice zone a3: fast urban (45 mph) | ~244 m intended | Same bug — less severe on denser urban polylines |
| Voice zone a3: arterial (30 mph) | ~164 m intended | Same bug |
| Voice zone a3: residential (15 mph) | ~85 m intended | Same bug — less severe on short segments |
| Off-route distance: highway >50 mph | 55 m | × sensitivity [0.5–2.0] |
| Off-route distance: urban >25 mph | 65 m | |
| Off-route distance: slow | 80 m | |
| Off-route distance: walking | 95 m | Wider to allow footpaths |
| Off-route distance: cycling | 85 m | |
| Reroute cooldown: >40 mph | 25 s | |
| Reroute cooldown: ≤40 mph | 35 s | |
| TTS forced-settle delay | 120 ms | Between Speech.stop() and Speech.speak() |

---

## Distribution checklist

- [x] Feedback template (`nav-timing-feedback-build-207.md`) shared with all active TestFlight testers
- [x] Physical-device session completed
- [x] Root cause identified and documented — see `docs/build-208-nav-root-cause.md`
- [x] P1 regression filed — fix targeted in Build #208
- [ ] Results referenced in the Build #208 pre-build checklist (RELEASE-CHECKLIST.md §4a)
