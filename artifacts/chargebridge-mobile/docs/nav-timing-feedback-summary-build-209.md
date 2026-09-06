# Build #209 — Nav Timing Feedback Summary

**Build:** #209  
**Feedback window:** TestFlight preview channel — physical-device session  
**Triage owner:** Engineering  
**Summary last updated:** 2026-08-11 — device session completed; diagnostic logs not emitted  
**Source commit:** `84457e0460d3ff11e654519052bf729b2021a6ad`  
**EAS build ID:** `2ac2c22f-2855-4545-b266-aa767da6adc0`

---

## Process Note — Implementation Error: `__DEV__` Guard Disabled All Diagnostics

**This session does not qualify as Runtime Verified.**

Build #209 was a diagnostic-only build whose entire purpose was to capture
`[NavGPS][TRACE]` and `[NavVoice][DIST]` log data during a physical-device navigation
session. The device session was completed; Console.app was active and connected.

**Root cause of missing logs:** All three diagnostic log blocks in `map.tsx` were
wrapped in `if (__DEV__)` guards. In React Native / Expo, `__DEV__` is `false` in any
EAS build that does not use the `development` profile with `developmentClient: true`.
The `preview` profile is a production-mode JavaScript bundle — `__DEV__ = false` at
bundle time. Every diagnostic block was dead code in the installed binary.

**What the tester saw:** Apple's Core Location daemon (`navd`) logs in Console.app —
`CLConnectionClient::sendMessage(cache)`, `container_copy_object`, etc. These are
system-level GPS hardware logs, not ChargeBridge application logs. No `[NavGPS][TRACE]`,
`[NavVoice][DIST]`, `[NavVoice][ARC]`, `navSpeak`, or `Speech.speak(forced)` entries
were emitted.

**Note on `console.log()` stripping:** Babel `babel.config.js` does NOT configure
`babel-plugin-transform-remove-console`. Plain `console.log()` calls fire in
TestFlight builds. The `__DEV__` guard is the sole reason for the missing output.

**Correct Console.app filter for future sessions:**
- Process: `ChargeBridge`  (or subsystem `app.replit.chargebridge`)
- NOT `navd` — that is Apple's Core Location daemon, a separate system process

**Fix applied in Build #210:** All three `if (__DEV__)` guards removed from diagnostic
blocks. `[NavGPS][TRACE]` now fires whenever `isNavigatingRef.current` is true (no
`__DEV__` prefix). `[NavVoice][DIST]` and `[NavVoice][ARC]` are unconditional blocks.

---

## Result Tables

### Turn Announcement Lead Time (Section 1)

| Tester / Device | Overall timing | Highway delay | Missing announcements | Back-to-back ok? | Regression? |
|---|---|---|---|---|---|
| Physical device — Build #209 TestFlight | ❌ Not captured — all diagnostic logs silently disabled | N/A | N/A | N/A | ❌ P1 blocker continues |

**Required diagnostic logs captured:** ❌ NO — `__DEV__` guard disabled all instrumentation in TestFlight binary  
**Session qualifies as Runtime Verified:** ❌ NO — implementation error prevented any data capture

**Conclusion:** No nav behavior change in Build #209 (diagnostic-only build). Root cause
investigation not advanced. Build #210 removes the `__DEV__` guard so logs fire in TestFlight.

---

### Off-Route Detection (Section 2)

| Tester / Device | Rerouting delay | False triggers | Regression? |
|---|---|---|---|
| Physical device — Build #209 TestFlight | Not evaluated | Not evaluated | Unknown — same code as Build #208 |

---

### Arrival Gate (Section 3)

| Tester / Device | Result |
|---|---|
| Physical device — Build #209 TestFlight | Not evaluated — session ended once diagnostic logs confirmed absent |

---

## Regression Status

| Task ref | Title | Evidence from Build #209 | Status |
|---|---|---|---|
| #672 | Prevent turn announcements firing too early on curved highway on-ramps | Not evaluated — no diagnostic data | PROPOSED — carry to Build #210 |
| #702 | Confirm no duplicate arrival notification on stale background batch | Not evaluated | PROPOSED — carry to Build #210 |
| #703 | Foregrounding reroute picks correct last-known location | Not evaluated | PROPOSED — carry to Build #210 |
| #711 | Reroute resets step index at different speed bucket | Not evaluated | PROPOSED — carry to Build #210 |
| #712 | Off-route detection falls back to stationary threshold when GPS speed missing | Not evaluated | PROPOSED — carry to Build #210 |

**Primary failure: All diagnostic instrumentation silently disabled by `__DEV__ = false` in TestFlight builds.
Build #210 removes the `__DEV__` guard. Nav behavior unchanged from Build #208.**

---

## Distribution checklist

- [x] Physical-device session completed (Build #209)
- [x] Root cause of missing logs identified: `__DEV__ = false` in EAS preview builds
- [x] Fix committed in Build #210: `__DEV__` guard removed from all three diagnostic blocks
- [x] Console.app process name confirmed: `ChargeBridge` (not `navd`)
- [ ] Build #210 device session pending — diagnostics will fire this time
