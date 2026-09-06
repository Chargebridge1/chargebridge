# Build #207 — Nav Timing Feedback Summary & Regression Triage

**Build:** #207
**Summary last updated:** 2026-08-01

---

## How to use this document

If any row contains a ❌ or ⚠️, open or update the linked task.

---

## Result Tables

### Arrival Gate (Section 3)

| Tester / Device | Timing ok? | Background arrival? | Walking/cycling arrival? | Duplicate? | Regression? |
|---|---|---|---|---|---|
| Alice / iPhone 15 Pro | yes | yes | ❌ never fired | no | ❌ |

**Escalation threshold:** Any duplicate arrival OR arrival never fired → file regression before next build.
**Related tasks:** #702 (duplicate arrival from background batch), #704 (arrival on foot/cycling)

---

## Regression Status

| Task ref | Title | Evidence from Build #207 | Status |
|---|---|---|---|
| #702 | Confirm no duplicate arrival notification on stale background batch | ✅ not observed this build | PROPOSED |
| #704 | Arrival gate fires correctly when on foot or cycling | *(fill in)* | PROPOSED |
