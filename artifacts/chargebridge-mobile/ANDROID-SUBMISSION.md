# Android — First Submission to Google Play Internal Track

Use this runbook to build and submit ChargeBridge to the Google Play internal track for the first time.

## Prerequisites

| Item | Status |
|---|---|
| EAS CLI ≥ 21.x (`eas --version`) | Required — v19.x causes submission failures |
| Logged in as project owner | `eas login` (account: `iblackett`) |
| `google-play-service-account.json` present | Already at `artifacts/chargebridge-mobile/google-play-service-account.json` |
| Google Play Console — app created | App must exist in Play Console before first submission |
| Android keystore — EAS remote credentials | Created on first build; EAS manages it automatically |

> **Service account key is already configured.**  
> `google-play-service-account.json` is present and excluded from git.  
> `eas.json` already points to it: `"serviceAccountKeyPath": "./google-play-service-account.json"`

---

## Step 0 — Verify Play Console app exists

Before submitting, confirm the app is created in [Google Play Console](https://play.google.com/console):
- Package name: `com.chargebridgeapp.app`
- If not yet created: **Create app** → Android → Free → accept policies.

You must upload the first AAB manually via Play Console if the app has never had any release before — Google requires the first upload to be done through the web UI. After that, EAS submit can push subsequent builds automatically.

---

## Step 1 — Trigger the Android production build

Run from `artifacts/chargebridge-mobile/`:

```bash
eas build --platform android --profile production
```

This uploads source to EAS cloud and builds a signed AAB.  
On first run, EAS will prompt you to create an Android keystore — choose **Generate new keystore** and let EAS manage it.

**What to expect:**
- Build takes ~10–20 minutes on EAS cloud
- Build result: `.aab` file (App Bundle) suitable for Play Store
- EAS stores the keystore remotely under your account

**Verify the build:**
- Visit https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/builds
- Confirm status is ✅ Finished

---

## Step 2 — (First time only) Upload the AAB manually via Play Console

Google Play requires the very first release to be uploaded through the web interface.

1. Download the `.aab` from the EAS build details page.
2. Open [Play Console](https://play.google.com/console) → **ChargeBridge** → **Internal testing** → **Create new release**.
3. Upload the `.aab`.
4. Add release notes (e.g. "Initial internal release for Android testers").
5. **Review and roll out** → confirm.

After this first manual upload, EAS submit will handle all future submissions automatically.

---

## Step 3 — (Subsequent builds) Submit via EAS

Once the first release exists in Play Console, use EAS submit for all future builds:

```bash
eas submit --platform android --profile production --latest
```

This automatically picks the most recent production build and submits it to the `internal` track.

**If you want to submit a specific build:**
```bash
eas submit --platform android --profile production --id <build-id>
```

---

## Step 4 — Add testers in Play Console

1. Open Play Console → **ChargeBridge** → **Internal testing** → **Testers**.
2. Create or select a testers list.
3. Add tester email addresses.
4. Copy the **opt-in link** and send it to testers.

Testers must:
1. Open the opt-in link on their Android device.
2. Accept the tester invitation.
3. Install the app from the Play Store.

---

## Version numbers

| Field | Current value | File |
|---|---|---|
| `version` | `1.0.0` | `app.json` |
| `android.versionCode` | `21` | `app.json` |

Increment `versionCode` for every new build uploaded to Play Console (Play rejects duplicate version codes).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `eas submit` fails with "No releases found" | Upload the first AAB manually via Play Console (Step 2) |
| `eas submit` fails with service account error | Verify `google-play-service-account.json` is in `artifacts/chargebridge-mobile/` and the service account has **Release Manager** role in Play Console |
| Build fails on first run (keystore) | Run `eas credentials` to check/create Android credentials |
| Play Console rejects AAB | Confirm `versionCode` is higher than any previously uploaded build |

---

## Related

- `RELEASE-CHECKLIST.md` — full pre-release checklist
- `eas.json` — submit config (serviceAccountKeyPath, track)
- `app.json` — android.package, android.versionCode
