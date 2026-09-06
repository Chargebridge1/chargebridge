# Build #207 — Nav Timing Tester Feedback Template

**Build:** #207 (TestFlight preview channel)  
**Session date:** _______________  
**Tester name / device model:** _______________  
**iOS version:** _______________  
**Route driven (rough description or start → end):** _______________  
**Total drive time (approx.):** _______________  
**Transport mode:** ☐ Driving  ☐ Walking  ☐ Cycling

Return completed forms to the eng channel or attach to the relevant task thread.

**Required:** Attach a TestFlight console log export captured during this session.
Minimum filter strings: `navSpeak` and `Speech.speak(forced)`.
If a timing investigation is active for this build, also capture every filter string
listed in the build's root cause or investigation document.
A session without these log values does not qualify as Runtime Verified evidence.

---

## Section 1 — Turn Announcement Lead Time

*Expected: voice cues fire ~2–3 s before the maneuver point.*
*Speed-adaptive thresholds in Build #207: >50 mph → 65 m step-advance, >30 mph → 50 m, >15 mph → 35 m, ≤15 mph → 25 m. Voice zone a3 scales dynamically: ~85 m at 15 mph, ~165 m at 30 mph, ~245 m at 45 mph, ~350 m at 65 mph.*

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
*Thresholds in Build #207: >50 mph → 55 m, >25 mph → 65 m, slow → 80 m, walking → 95 m, cycling → 85 m.*

### 2a. Did you experience any false off-route triggers (app rerouted when you were actually on the route)?
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

### 2c. After a reroute, did the app immediately reroute again (cooldown not respected)?
*(Relates to task #711 — step index reset after reroute at different speed bucket)*  
☐ Yes  ☐ No  ☐ Not observed

**Details:**
```
 
```

### 2d. Did you switch modes (driving → walking, or similar) mid-session?
☐ Yes — did off-route sensitivity feel appropriate after the switch?  
☐ No

**Notes:**
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

### 3c. Walking or cycling session: did arrival fire correctly?
*(Relates to task #704 — arrival gate on foot / cycling)*  
☐ Yes  ☐ No  ☐ Not applicable (driving only)

**Details:**
```
 
```

---

## Section 4 — Reroute Cooldown UX

*Expected: if a reroute is suppressed (cooldown active), the app should give the tester a visible indication of how long remains.*
*(Relates to task #708)*

### 4a. Did you notice a reroute being suppressed during the session?
☐ Yes  ☐ No

### 4b. If yes — was there any visible indicator showing the cooldown remaining?
☐ Yes, clearly visible  ☐ Yes, but hard to notice  ☐ No indicator shown  ☐ N/A

**Notes:**
```
 
```

---

## Section 5 — Background / Foreground Handoff

*(Relates to task #703 — foregrounding reroute using stale background location)*

### 5a. Did you background the app mid-route and bring it back to the foreground?
☐ Yes  ☐ No

### 5b. If yes — did the app pick up the correct current location immediately on foreground?
☐ Yes, snapped to my real position  
☐ No, appeared to be at my position from several seconds ago  
☐ No, triggered an unexpected reroute on foreground  

**Details:**
```
 
```

---

## Section 6 — General Observations

### 6a. GPS signal quality during the session
☐ Strong throughout  ☐ Some gaps (tunnels, urban canyons)  ☐ Frequent gaps

### 6b. Any other timing or nav behaviour that felt off?
```
 
```

### 6c. Severity rating for this session
☐ No regressions observed — timing felt solid  
☐ Minor issues — nothing blocking  
☐ Moderate issues — worth a fix before the next build  
☐ Blocker — navigation is unreliable for real use

---

*Thank you for testing. Completed templates feed directly into the regression triage in `docs/nav-timing-feedback-summary-build-207.md`.*
