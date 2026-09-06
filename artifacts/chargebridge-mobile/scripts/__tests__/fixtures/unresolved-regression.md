# Build #207 — Nav Timing Feedback Summary & Regression Triage

**Build:** #207
**Summary last updated:** 2026-08-01

---

## How to use this document

If any row contains a ❌ or ⚠️, open or update the linked task.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Early on curved on-ramp? | Missing announcements? | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Alice / iPhone 15 Pro | ❌ consistently late | yes | no | yes | ❌ |

**Escalation threshold:** Any ❌ "consistently late" → file Root Cause Report.
**Related task:** #672 (early announcement on curved on-ramps)

---

## Regression Status

| Task ref | Title | Evidence from Build #207 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | *(fill in)* | PROPOSED |
