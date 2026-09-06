# Build #212 — Nav Timing Tester Feedback Template

**Build:** #212 (TestFlight preview channel)  
**Session date:** _______________  
**Tester name / device model:** _______________  
**iOS version:** _______________  
**Route driven (rough description or start → end):** _______________  
**Total drive time (approx.):** _______________  
**Transport mode:** ☐ Driving  ☐ Walking  ☐ Cycling

Return completed forms to the eng channel or attach to the relevant task thread.

**Build #212 primary objective:** Capture NavDebugOverlay values during one problematic maneuver to answer:
> **Does the ~500-foot voice announcement delay occur before or after `navSpeak()` is called?**

No console log export is required for this build. Instead, record the **NavDebugOverlay screen values** directly below.

To show the overlay: **long-press the voice mute button** in the turn-by-turn banner during active navigation.

---

## Section 0 — NavDebugOverlay Capture (Required)

*Capture these values at the moment of a late or correctly-timed announcement. Freeze your memory at the instant the voice cue fires — read the overlay immediately after.*

### 0a. Was the overlay visible during navigation?
☐ Yes — long-press on mute button showed the overlay  
☐ No — long-press did not trigger the overlay  
☐ Not tested

### 0b. GPS section values at the moment of the announcement

| Field | Value |
|---|---|
| posAge (ms) | ___ |
| interval (ms) | ___ |

**posAge** > 2000 ms suggests CoreLocation delivered a stale fix. **interval** > 1500 ms suggests the GPS watcher was throttled.

### 0c. Route section values at the moment of the announcement

| Field | Value |
|---|---|
| prev dist (m) | ___ |
| cur dist (m) | ___ |
| straight (m) | ___ |
| zone | ___ (a1 / a2 / a3) |

**cur dist** is the arc distance to the next maneuver when the announcement fired.
**straight** is the haversine (direct line) distance — a large gap vs arc suggests a curve inflated the arc distance.

### 0d. Voice section values

| Field | Value |
|---|---|
| since navSpeak (ms) | ___ |
| TTS elapsed (ms) | ___ |

**This is the decisive measurement:**
- **since navSpeak < 250 ms** → delay is *before* `navSpeak()` — the zone threshold fired at the wrong distance. Fix: zone thresholds or arc distance calculation.
- **since navSpeak > 500 ms** → delay is *after* `navSpeak()` — TTS scheduling or iOS audio session latency. Fix: `scheduleForcedSpeak`, settle delay, or audio session.

### 0e. Was the announcement late, early, or about right for the captured reading?
☐ Late (~500 ft past where it should have fired)  
☐ About right  
☐ Early  
☐ Not sure

### 0f. Describe the specific maneuver where you captured the overlay values
*(road type, approx. speed, highway vs. surface street, straight vs. curved approach)*
```
 
```

### 0g. Any other overlay readings captured during the session (optional — as many rows as useful)

| Time in session | posAge | interval | cur dist | zone | since navSpeak | TTS elapsed | Timing impression |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

---

## Section 1 — Turn Announcement Lead Time

*Expected: voice cues fire ~2–3 s before the maneuver point.*
*Speed-adaptive thresholds in Build #212: unchanged from Build #211 — >50 mph → 65 m step-advance, >30 mph → 50 m, >15 mph → 35 m, ≤15 mph → 25 m. Voice zone a3 scales dynamically: ~85 m at 15 mph, ~165 m at 30 mph, ~245 m at 45 mph, ~350 m at 65 mph.*

### 1a. Overall timing impression
☐ Consistently early (announced well before the turn)  
☐ About right (comfortable reaction time)  
☐ Consistently late (announced at or after the turn)  
☐ Inconsistent (sometimes early, sometimes late)

### 1b. Did any announcement fire noticeably early on a curved highway on-ramp or interchange?
*(Relates to task #672 — false step advance on curves)*  
☐ Yes — describe below  ☐ No  ☐ Not applicable (no highway driving)

**Details (road type, approximate speed, what was said):**
```
 
```

### 1c. Were any turn announcements completely silent / missing?
☐ Yes — describe below  ☐ No

**Which maneuvers were missed, and at what speed:**
```
 
```

### 1d. Did back-to-back close maneuvers (< ~150 m apart) both announce correctly?
☐ Yes, both fired  ☐ First only  ☐ Second only  ☐ Neither  ☐ Not observed

**Additional notes:**
```
 
```

---

## Section 2 — Off-Route Detection

*Expected: off-route alert + reroute after 3–5 consecutive GPS readings exceed the distance threshold, with a cooldown of 25 s (>40 mph) or 35 s (slower).*

### 2a. Did you experience any false off-route triggers?
☐ Yes — describe below  ☐ No

**Context (road type, speed, straight vs. curve, GPS signal quality):**
```
 
```

**Approx. number of false triggers during the session:** ___

### 2b. Were there any genuine wrong-turn situations where the app *failed* to reroute?
☐ Yes — describe below  ☐ No

**Details:**
```
 
```

---

## Section 3 — Arrival Gate

*Expected: arrival notification fires within ~60 m of the destination, navigation ends cleanly.*

### 3a. Did the arrival notification fire at a reasonable distance from your destination?
☐ Yes, felt about right  
☐ Too early (still clearly far away)  
☐ Too late (had already pulled in / parked)  
☐ Never fired  
☐ Fired twice (duplicate)

**Approx. distance from destination when it fired (if you can estimate):** ___ m

### 3b. If the app was backgrounded during the final approach, did arrival still trigger correctly?
*(Relates to task #702 — duplicate arrival from stale background batch)*  
☐ Yes  ☐ No — describe what happened  ☐ Not tested (stayed in foreground)

**Details:**
```
 
```

---

## Section 4 — General Observations

### 4a. GPS signal quality during the session
☐ Strong throughout  ☐ Some gaps (tunnels, urban canyons)  ☐ Frequent gaps

### 4b. Any other timing or nav behaviour that felt off?
```
 
```

### 4c. Severity rating for this session
☐ No regressions observed — timing felt solid  
☐ Minor issues — nothing blocking  
☐ Moderate issues — worth a fix before the next build  
☐ Blocker — navigation is unreliable for real use

---

*Thank you for testing. Return this completed template to the eng channel. The Section 0 overlay values are the primary data point for this build — everything else is secondary.*
