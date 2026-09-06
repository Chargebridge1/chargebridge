# Build #207 — Nav Timing Feedback Summary & Regression Triage

**Build:** #207
**Summary last updated:** 2026-08-01

---

## How to use this document

1. Collect completed copies from each tester.
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

## Regression Status

| Task ref | Title | Evidence from Build #207 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | ✅ not observed this build | PROPOSED |
