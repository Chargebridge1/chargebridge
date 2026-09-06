# Build #NNN — Nav Timing Feedback Summary & Regression Triage

**Build:** #NNN  
**Feedback window:** TestFlight preview channel — physical-device sessions  
**Triage owner:** *(assign before sharing with testers)*  
**Summary last updated:** *(fill in when results arrive)*

---

## How to use this document

1. Collect completed copies of `docs/nav-timing-feedback-build-NNN.md` from each tester.
2. Paste a one-line result per tester into the tables below.
3. If any row contains a ❌ or ⚠️, open or update the linked task with the tester's device log attached.
4. Update the **Regression Status** column when a task is filed or closed.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Early on curved on-ramp? | Missing announcements? | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| *(paste)* | | | | | |

**Escalation threshold:** Any ❌ "consistently late" OR confirmed missing announcement → file Root Cause Report, block next build.  
**Related task:** #672 (early announcement on curved on-ramps)

---

### Off-Route Detection (Section 2)

| Tester / Device | False triggers | Failed reroute | Cooldown respected | Mode-switch ok | Regression? |
|---|---|---|---|---|---|
| *(paste)* | | | | | |

**Escalation threshold:** >1 false trigger per session on a road with good GPS signal → investigate before next build.  
**Related tasks:** #711 (step-index reset after reroute), #712 (GPS speed missing fallback)

---

### Arrival Gate (Section 3)

| Tester / Device | Timing ok? | Background arrival? | Walking/cycling arrival? | Duplicate? | Regression? |
|---|---|---|---|---|---|
| *(paste)* | | | | | |

**Escalation threshold:** Any duplicate arrival OR arrival never fired → file regression before next build.  
**Related tasks:** #702 (duplicate arrival from background batch), #704 (arrival on foot/cycling)

---

### Reroute Cooldown UX (Section 4)

| Tester / Device | Cooldown observed? | Indicator visible? | Notes | Regression? |
|---|---|---|---|---|
| *(paste)* | | | | |

**Related task:** #708 (show cooldown remaining when reroute suppressed)

---

### Background / Foreground Handoff (Section 5)

| Tester / Device | BG/FG tested? | Location correct on FG? | Spurious reroute on FG? | Regression? |
|---|---|---|---|---|
| *(paste)* | | | | |

**Escalation threshold:** Any confirmed stale-location reroute on foreground → file blocker.  
**Related task:** #703 (foregrounding reroute uses stale background location)

---

## Regression Status

| Task ref | Title | Evidence from Build #NNN | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | *(fill in)* | PROPOSED |
| #702 | Confirm no duplicate arrival notification on stale background batch | *(fill in)* | PROPOSED |
| #703 | Foregrounding reroute picks correct last-known location | *(fill in)* | PROPOSED |
| #704 | Arrival gate fires correctly when on foot or cycling | *(fill in)* | PROPOSED |
| #711 | Reroute resets step index correctly at different speed bucket | *(fill in)* | PROPOSED |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | *(fill in)* | PROPOSED |

---

## Nav Timing Thresholds (Build #NNN reference)

| Parameter | Value | Notes |
|---|---|---|
| Arrival gate | 60 m | Must remain < max step-advance threshold (65 m highway) |
| Step-advance: highway (>50 mph) | 65 m | ~2–3 s lead at highway speed |
| Step-advance: urban arterial (>30 mph) | 50 m | |
| Step-advance: residential (>15 mph) | 35 m | |
| Step-advance: slow / stationary | 25 m | |
| Off-route distance: highway >50 mph | 55 m | × sensitivity [0.5–2.0] |
| Off-route distance: urban >25 mph | 65 m | |
| Off-route distance: slow | 80 m | |
| Off-route distance: walking | 95 m | Wider to allow footpaths |
| Off-route distance: cycling | 85 m | |
| Off-route consecutive readings: highway | 3 | |
| Off-route consecutive readings: urban / walk / cycle | 4 | |
| Off-route consecutive readings: slow | 5 | |
| Reroute cooldown: >40 mph | 25 s | |
| Reroute cooldown: ≤40 mph | 35 s | |
| TTS forced-settle delay | 120 ms | Between Speech.stop() and Speech.speak() |

---

## Distribution checklist

- [ ] Feedback template (`nav-timing-feedback-build-NNN.md`) shared with all active TestFlight testers
- [ ] Testers reminded to export TestFlight console logs filtered to `navSpeak` before closing the session
- [ ] Deadline for template return agreed: _______________
- [ ] Summary table populated and reviewed
- [ ] Any regressions filed as tasks and linked to this document
- [ ] Results referenced in the Build #(NNN+1) pre-build checklist (RELEASE-CHECKLIST.md §4a)
