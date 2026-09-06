# OTA Smoke Test — Preview Channel

This runbook confirms the full end-to-end OTA flow works for the preview channel on **both platforms**:
**build → `eas update` push → tester receives update without reinstalling from TestFlight or Google Play**.

Both iOS and Android preview builds share the same `channel: "preview"` in `eas.json`, so a single
`eas update` push reaches both platforms simultaneously.

---

## Prerequisites

**iOS tester**
- Preview build installed from **TestFlight** (built with `eas build --profile preview`)

**Android tester**
- Preview APK installed from **Google Play internal track** (built with `eas build --profile preview --platform android`)
- The preview profile produces an **APK** (`android.buildType: "apk"`) distributed to the Play internal track

**Both testers need:**
- The installed app must have `expo-updates` baked in with `channel: "preview"` — confirm in Build Info → OTA Update Status → Channel row
- EAS CLI ≥ 21.x installed locally (`eas --version`) *(for the person pushing the update)*
- Logged in: `eas login` (account: `iblackett`)

---

## Step 1 — Make a visible change

The OTA status card added to **Build Info → OTA Update Status** is the smoke-test change.  
It shows:

| Field | Before update | After update |
|---|---|---|
| "Embedded build" banner | shown (yellow) | replaced by "OTA update" (teal) |
| Update ID | `embedded (no OTA applied)` | a real UUID |
| Published at | `—` | the UTC timestamp of the push |
| Hero badge | `Embedded` (amber) | `OTA ✓` (teal) |

If you want a second human-visible change, edit `CHANGES` in `app/build-info.tsx`
(e.g., add a new item to the list). Do **not** change native code, native dependencies,
or `runtimeVersion` in `app.json` — that breaks the OTA compatibility.

---

## Step 2 — Push the OTA update

```bash
cd artifacts/chargebridge-mobile

# Push to the preview channel — reaches iOS and Android simultaneously
eas update --channel preview --message "OTA smoke test — build-info OTA card"
```

EAS will:
1. Bundle the JS for both platforms (Metro, Hermes)
2. Upload the bundle to `https://u.expo.dev/22d4532c-5b24-49bf-ac70-0c27ec1265a8`
3. Associate it with `runtimeVersion` = `1.0.0` (from `app.json` `version`)

To push to only one platform during debugging:

```bash
# iOS only
eas update --channel preview --platform ios --message "OTA smoke test (iOS)"

# Android only
eas update --channel preview --platform android --message "OTA smoke test (Android)"
```

---

## Step 3 — iOS tester verification (TestFlight)

**On a device running the TestFlight preview build:**

1. Close and reopen the app (`checkAutomatically: "ON_LOAD"` downloads the update on next cold start)
2. Navigate to **Profile → Build Info**
3. Confirm the **OTA Update Status** card shows:
   - `OTA update` banner (teal) instead of `Embedded build`
   - A real Update ID (not `embedded (no OTA applied)`)
   - `Published at` shows the push timestamp
4. Confirm the hero badge shows **OTA ✓** (teal) instead of **Embedded** (amber)

You can also tap **"Check for OTA update"** manually — it will show "Up to date ✓" once the update is already applied.

**Share the build report** (share icon, top right) and paste it here to confirm.

---

## Step 4 — Android tester verification (Google Play internal track)

**On a device running the APK from Google Play internal track:**

1. Close and reopen the app (`checkAutomatically: "ON_LOAD"` downloads the update on next cold start)
2. Navigate to **Profile → Build Info**
3. Confirm the **OTA Update Status** card shows:
   - `Channel` row reads **preview**
   - `OTA update` banner (teal) instead of `Embedded build`
   - A real Update ID (not `embedded (no OTA applied)`)
   - `Published at` shows the push timestamp
4. Confirm the hero badge shows **OTA ✓** (teal) instead of **Embedded** (amber)
5. Confirm the **Platform** badge in the hero reads **Android**

> **Why the Channel row matters for Android:** Unlike TestFlight, Play internal track does not
> display a channel label externally. The in-app Channel row is the only way to confirm the
> installed APK is actually on the `preview` channel and will receive OTA pushes.

**Share the build report** (share icon, top right) and paste it here to confirm.

---

### Step 4a — Interrupted-download simulation (Android only)

Android's battery optimisation and memory-pressure policies can force-stop the app mid-lifecycle,
including while the `ON_LOAD` update check is in progress. This step confirms the app recovers
cleanly and never silently stays on the stale bundle.

**How expo-updates recovers automatically:**  
`checkAutomatically: "ON_LOAD"` fires on _every_ cold start. If the process is killed during a
download, the partial bundle is discarded. On the next cold start expo-updates starts a fresh check
from scratch — no manual retry or code change is required.

**Steps to simulate an interrupted download:**

1. Ensure a new `eas update` push is available but **not yet applied** to the device
   (OTA card → "Embedded build" banner still showing, or Update ID still the old value).
2. Cold-start the app — the `ON_LOAD` check begins immediately in the background.
3. **Within 2–3 seconds** of the app launching, go to  
   **Android Settings → Apps → ChargeBridge → Force Stop**  
   *(The goal is to kill the process while the bundle download is in progress.  
   You may need to repeat the attempt a few times to hit the window.)*
4. Reopen ChargeBridge (tap the icon — this is a fresh cold start).
5. Navigate to **Profile → Build Info** and check the OTA Update Status card:

   | Expected outcome | What you see |
   |---|---|
   | ✅ Auto-recovered | `OTA update` banner (teal), new Update ID, new `Published at` timestamp |
   | ✅ Clean retry in progress | `Embedded build` banner — tap **"Check for OTA update"** to confirm a new check runs and succeeds |
   | ❌ Stuck on old bundle with no retry | OTA card shows `Embedded build` and tapping "Check for OTA update" returns an error — file a bug |

6. If the card still shows `Embedded build` after the second cold start, tap **"Check for OTA update"**
   manually. A successful manual check that downloads the update and switches the badge to `OTA ✓`
   is also an acceptable outcome — it means expo-updates recovered but the automatic download window
   was missed during the kill.

> **Expected behaviour:** expo-updates discards any partial download when the process is killed and
> re-runs the full check on the next cold start. No user action is required beyond reopening the app.
> This is the normal, correct behaviour for `checkAutomatically: "ON_LOAD"`.

**Record the result** (one of the three outcomes above) alongside the Step 4 build report.

---

## Configuration reference

| Key | Value |
|---|---|
| EAS Project ID | `22d4532c-5b24-49bf-ac70-0c27ec1265a8` |
| Updates URL | `https://u.expo.dev/22d4532c-5b24-49bf-ac70-0c27ec1265a8` |
| Preview channel | `preview` |
| Runtime version policy | `appVersion` → resolves to `1.0.0` |
| Check mode | `ON_LOAD` (every cold start) |
| iOS distribution | TestFlight (App Store Connect internal testing) |
| Android distribution | Google Play internal track (APK, `android.buildType: "apk"`) |

---

## Troubleshooting

**"Update not available" after pushing (either platform)**
- Confirm the build's `Updates.channel` is `preview` (visible in OTA card → Channel row)
- Confirm `Updates.runtimeVersion` matches `app.json` → `version` (both must be `1.0.0`)
- Wait 60 s for CDN propagation and reopen the app

**"isEmbeddedLaunch" still true after cold-start (either platform)**
- Force-quit and reopen again — `fallbackToCacheTimeout: 0` means the app waits for the check before showing the app
- If still embedded, check the EAS dashboard to confirm the update is marked "active" for the `preview` channel

**Channel mismatch (update published but device doesn't receive it)**
- The device's installed build must have been built with `eas build --profile preview`
- A build made with `--profile production` will be on the `production` channel and will never receive a `preview` push
- A build made with `--profile development` is a dev client — it doesn't use `expo-updates` OTA at all

**Android-specific: APK not receiving updates**
- Confirm the installed APK came from **Google Play internal track**, not a direct sideload of a development build
- Sideloaded APKs built with `--profile development` have `developmentClient: true` and ignore OTA updates
- Open Build Info → OTA Update Status → verify Channel = `preview` and Platform = `Android`
- If Channel shows `—`, the APK was built with the wrong profile — rebuild with `eas build --profile preview --platform android`

**Android-specific: Play internal track shows a newer binary version but OTA still shows Embedded**
- Binary updates via Play (new APK) reset `isEmbeddedLaunch` to `true` — this is expected
- The OTA badge will flip to "OTA ✓" only after the *next* `eas update` push following the new APK install

**Android-specific: app was force-stopped during an update check (Step 4a)**
- expo-updates discards any partial download automatically when the process is killed
- On the next cold start `checkAutomatically: "ON_LOAD"` runs a fresh check from scratch — no manual intervention needed
- If the OTA card still shows `Embedded build` after the second cold start, tap **"Check for OTA update"** manually; a successful manual check is an acceptable recovery
- If _both_ the automatic and manual checks fail after a force-stop, note the error message shown in the OTA card and file a bug — this indicates expo-updates left a corrupted cache entry that prevents retries

---

## Session-safe reloads

OTA updates must never interrupt an active charging session. The app enforces
this automatically via `guardedOTAReload` in `utils/otaReloadGuard.ts`:

- If the user taps **"Apply update"** while a charge session is open, the download
  completes but `Updates.reloadAsync()` is **not** called immediately.
- The **OTA Update Status** card shows a yellow banner:  
  *"Update ready — will install automatically once your charging session ends."*
- The **"Check for OTA update"** button is disabled and shows **"Update queued…"**.
- As soon as the session ends (stop charging → summary screen reached),
  the reload fires automatically — no user action required.

**To verify session-safety during a smoke test:**

1. Start a charge session (tap a station → begin charging → active-session screen appears).
2. While the session is running, navigate to **Profile → Build Info** and tap
   **"Check for OTA update"** → if an update is available, tap **"Apply update"**.
3. Confirm the teal card switches to the yellow deferred-reload indicator —
   **`reloadAsync` must NOT fire mid-session**.
4. Stop the charging session (tap Stop → reach the summary screen).
5. Confirm the app reloads automatically, and the OTA badge switches to **OTA ✓**.

---

## If the update is bad — rollback

See **[OTA-ROLLBACK.md](./OTA-ROLLBACK.md)** for the full rollback runbook, including:
- Rolling back with `eas update:republish` to a known-good update ID
- Using `--rollout-percentage` to stage future pushes and limit blast radius
