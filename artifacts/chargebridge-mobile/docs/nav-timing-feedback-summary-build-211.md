# Build #211 — Nav Timing Feedback Summary

**Build:** #211  
**Feedback window:** TestFlight preview channel — physical-device session  
**Triage owner:** Engineering  
**Summary last updated:** 2026-08-12 — crash confirmed on device; no diagnostic data captured  
**Source commit:** `609443d`  
**EAS build ID:** *(Build #211 — fingerprint `d4d7c41cd3171120743c110ea322a22780a6547e`)*

---

## Process Note — Build #211 Crashed on Device

**This session does not qualify as Runtime Verified.**

Build #211 was a diagnostic-only build whose purpose was to capture nav timing data via
file-based logging (`navDiagLogger.ts` + `expo-file-system/legacy` + `expo-sharing`).
The build crashed on device. The nav diagnostic file was not written and no timing data
was captured.

**Root cause of crash:** Not confirmed from source analysis alone. Actual crash log
(exception type, crashed thread, stack trace) is required from Xcode Organizer or the
TestFlight crash dashboard. See `docs/navigation-investigation-reset-report.md` for
the full static-analysis triage of candidate crash vectors.

**Conclusion:** The file-based logging approach introduced a device crash. No nav
behavior changed in Build #211; all changes were diagnostic infrastructure only.

**Gate status for Build #212:** This document satisfies the pre-build gate requirement
for Build #211. Build #212 cannot proceed until the Build #211 crash root cause is
confirmed from the actual crash log AND the navigation-investigation-reset-report is
reviewed and a path forward is approved.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Highway delay | Missing announcements | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #211 TestFlight | ❌ Not captured — build crashed before diagnostic data written | Unknown | Unknown | Unknown | ❌ P1 blocker continues |

**Required diagnostic logs captured:** ❌ NO — build crashed on device  
**Session qualifies as Runtime Verified:** ❌ NO — crash prevented all data capture

---

## Regression Status

| Task ref | Title | Evidence from Build #211 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | Not captured — build crashed | PROPOSED — carry forward |
| #702 | Confirm no duplicate arrival notification on stale background batch | Not captured | PROPOSED — carry forward |
| #703 | Foregrounding reroute picks correct last-known location | Not captured | PROPOSED — carry forward |
| #711 | Reroute resets step index correctly at different speed bucket | Not captured | PROPOSED — carry forward |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | Not captured | PROPOSED — carry forward |

**Primary failure: device crash. Secondary failure: five consecutive builds (207–211) have
produced zero runtime diagnostic data. Navigation investigation frozen pending crash root
cause confirmation and investigation reset.**

---

## Distribution checklist

- [ ] Actual crash log obtained from Xcode Organizer or TestFlight crash dashboard
- [ ] Crash root cause confirmed (not just hypothesized from code analysis)
- [ ] Navigation investigation reset report reviewed
- [ ] Path forward approved before Build #212 proceeds
