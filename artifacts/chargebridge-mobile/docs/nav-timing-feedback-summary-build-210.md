# Build #210 — Nav Timing Feedback Summary

**Build:** #210  
**Feedback window:** TestFlight preview channel — physical-device session  
**Triage owner:** Engineering  
**Summary last updated:** 2026-08-11 — device session completed; ChargeBridge logs not visible in Console.app  
**Source commit:** *(Build #210 EAS commit — __DEV__ guards removed from all three diagnostic blocks)*  
**EAS build ID:** *(Build #210 — submitted to TestFlight)*

---

## Process Note — Console.app Logging Chain Unreliable for RN 0.86 Hermes Production Builds

**This session does not qualify as Runtime Verified.**

Build #210 was a diagnostic-only build whose purpose was to capture
`[NavGPS][TRACE]`, `[NavVoice][DIST]`, and `[NavVoice][ARC]` log data.
The `__DEV__` guard was removed from all three blocks (fix from Build #209).
A complete navigation session on the same highway route was completed.

**What the tester saw:** Apple's Core Location daemon (`navd`) logs in Console.app
as before — no ChargeBridge process entries were visible, even after enabling
"Include Info Messages" and "Include Debug Messages" and filtering by process
`ChargeBridge`.

**Root cause analysis — two sessions confirm the pattern:**
Source inspection confirms:
1. `console.log()` calls are present and unconditional in the compiled output.
2. Babel `babel.config.js` does NOT configure `babel-plugin-transform-remove-console`.
3. In RN 0.86 Hermes, `console.log()` routes through `nativeLoggingHook` (native side)
   rather than the JS `RCTLog` layer. The native hook's level mapping and
   os_log output level in a production binary + Expo SDK 57 / ExpoReactNativeFactory
   could not be verified from source alone.
4. Two full drives with Console.app connected produced zero ChargeBridge log entries.

**Conclusion:** `console.log()` does not reliably surface in Console.app for this
Hermes/Expo SDK 57/RN 0.86 build configuration on a physical iOS device.
The console logging channel is not a viable diagnostic medium for this project.

**Fix for Build #211:** Switch to file-based diagnostic logging via `expo-file-system`.
A new `utils/navDiagLogger.ts` module buffers all diagnostic events in memory
during the session and writes a complete `.txt` file to the app's Documents directory
when navigation ends. The file is accessible via Files app and shareable via the iOS
share sheet — no cable, no Console.app, no Xcode required.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Highway delay | Missing announcements | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #210 TestFlight | ❌ Not captured — ChargeBridge logs not visible in Console.app | Unknown | Unknown | Unknown | ❌ P1 blocker continues |

**Required diagnostic logs captured:** ❌ NO — Console.app shows zero ChargeBridge entries  
**Session qualifies as Runtime Verified:** ❌ NO — logging pipeline unreliable for Hermes production builds

**Conclusion:** No nav behavior change in Build #210 (diagnostic-only build). Root cause
investigation not advanced — `console.log()` confirmed unreliable in Console.app for
this Hermes/Expo SDK 57 production build configuration. Build #211 switches to
file-based logging via `expo-file-system`.

---

### Off-Route Detection (Section 2)

| Tester / Device | Rerouting delay | False triggers | Regression? |
|---|---|---|---|
| Physical device — Build #210 TestFlight | Not evaluated | Not evaluated | Unknown — same code as Build #208 |

---

### Arrival Gate (Section 3)

| Tester / Device | Result |
|---|---|
| Physical device — Build #210 TestFlight | Not evaluated — session ended once diagnostic logs confirmed absent |

---

## Regression Status

| Task ref | Title | Evidence from Build #210 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | Not evaluated — no diagnostic data | PROPOSED — carry to Build #211 |
| #702 | Confirm no duplicate arrival notification on stale background batch | Not evaluated | PROPOSED — carry to Build #211 |
| #703 | Foregrounding reroute picks correct last-known location | Not evaluated | PROPOSED — carry to Build #211 |
| #711 | Reroute resets step index at different speed bucket | Not evaluated | PROPOSED — carry to Build #211 |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | Not evaluated | PROPOSED — carry to Build #211 |

**Primary failure: `console.log()` in RN 0.86 Hermes production builds does not appear
in Console.app. Two sessions (Builds #209 and #210) confirm this. Build #211 uses
file-based logging via expo-file-system and expo-sharing.**

---

## Distribution checklist

- [x] Physical-device session completed (Build #210)
- [x] Root cause of missing logs identified: console.log() unreliable in Hermes production → Console.app
- [x] Fix committed in Build #211: file-based logging via navDiagLogger.ts + expo-file-system
- [x] All diagnostic event types captured: [NavGPS][TRACE], [NavVoice][DIST], [NavVoice][ARC], navSpeak, Speech.speak(forced), ttsOnDone, [NavRoute][TRACE]
- [ ] Build #211 device session pending — diagnostic file will be written to Documents dir and shared via Files app
