# Build #207 — Nav Timing Feedback Summary & Regression Triage

**Build:** #207
**Feedback window:** TestFlight preview channel — physical-device sessions
**Triage owner:** Jane Smith
**Summary last updated:** 2026-08-01

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
| Alice / iPhone 15 Pro | ✅ on time | no | no | yes | ✅ |

**Escalation threshold:** Any ❌ "consistently late" OR confirmed missing announcement → file Root Cause Report, block next build.
**Related task:** #672 (early announcement on curved on-ramps)

---

### Off-Route Detection (Section 2)

| Tester / Device | False triggers | Failed reroute | Cooldown respected | Mode-switch ok | Regression? |
|---|---|---|---|---|---|
| Alice / iPhone 15 Pro | none | n/a | yes | yes | ✅ |

**Escalation threshold:** >1 false trigger per session on a road with good GPS signal → investigate before next build.
**Related tasks:** #711 (step-index reset after reroute), #712 (GPS speed missing fallback)

---

### Arrival Gate (Section 3)

| Tester / Device | Timing ok? | Background arrival? | Walking/cycling arrival? | Duplicate? | Regression? |
|---|---|---|---|---|---|
| Alice / iPhone 15 Pro | yes | yes | n/a | no | ✅ |

**Escalation threshold:** Any duplicate arrival OR arrival never fired → file regression before next build.
**Related tasks:** #702 (duplicate arrival from background batch), #704 (arrival on foot/cycling)

---

### Reroute Cooldown UX (Section 4)

| Tester / Device | Cooldown observed? | Indicator visible? | Notes | Regression? |
|---|---|---|---|---|
| Alice / iPhone 15 Pro | yes | yes | smooth | ✅ |

**Related task:** #708 (show cooldown remaining when reroute suppressed)

---

### Background / Foreground Handoff (Section 5)

| Tester / Device | BG/FG tested? | Location correct on FG? | Spurious reroute on FG? | Regression? |
|---|---|---|---|---|
| Alice / iPhone 15 Pro | yes | yes | no | ✅ |

**Escalation threshold:** Any confirmed stale-location reroute on foreground → file blocker.
**Related task:** #703 (foregrounding reroute uses stale background location)

---

## Regression Status

| Task ref | Title | Evidence from Build #207 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | ✅ not observed this build | PROPOSED |
| #702 | Confirm no duplicate arrival notification on stale background batch | ✅ not observed | PROPOSED |
| #703 | Foregrounding reroute picks correct last-known location | ✅ confirmed correct | PROPOSED |
| #704 | Arrival gate fires correctly when on foot or cycling | n/a this build | PROPOSED |
| #708 | Show cooldown remaining when reroute suppressed | ✅ indicator visible on Alice device | PROPOSED |
| #711 | Reroute resets step index correctly at different speed bucket | ✅ not observed | PROPOSED |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | ✅ not observed | PROPOSED |

---

## Distribution checklist

- [x] Feedback template shared with all active TestFlight testers
- [x] Testers reminded to export TestFlight console logs filtered to `navSpeak`
- [x] Deadline for template return agreed: 2026-07-30
- [x] Summary table populated and reviewed
- [x] Any regressions filed as tasks and linked to this document
- [x] Results referenced in the Build #208 pre-build checklist
