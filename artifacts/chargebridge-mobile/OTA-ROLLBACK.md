# OTA Rollback Runbook — Preview Channel

Use this runbook when a bad OTA update has been pushed to the `preview` channel
and you need to stop it reaching more testers or restore a known-good state.

---

## Prerequisites

- EAS CLI ≥ 21.x installed locally (`eas --version`)
- Logged in as the project owner: `eas login` (account: `iblackett`)
- Access to the EAS dashboard: https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates

---

## Step 1 — Stop the bad update immediately

Republish the last known-good update over the `preview` channel.  
This makes EAS serve the good bundle to any tester who hasn't yet downloaded the bad one.

```bash
cd artifacts/chargebridge-mobile

# List recent updates on the preview channel to find the last good ID
eas update:list --channel preview --limit 10

# Republish the good update (replace <GOOD_UPDATE_GROUP_ID> with the ID from the list above)
eas update:republish --group <GOOD_UPDATE_GROUP_ID> --channel preview --message "rollback: revert bad update"
```

> **How to find the good update ID**
> - Run `eas update:list --channel preview` and look for the update just *before* the one you want to roll back.
> - Or open the EAS dashboard → Updates → Preview channel → copy the group ID of the last stable update.

---

## Step 2 — Verify testers receive the rollback

### iOS testers (TestFlight)

1. Ask at least one tester to force-quit and reopen the app.
2. Have them check **Profile → Build Info → OTA Update Status**.
3. Confirm the **Update ID** and **Published at** timestamp match the known-good update, not the bad one.
4. The hero badge should show **OTA ✓** (teal).

### Android testers (Google Play internal track)

1. Ask at least one tester to force-quit and reopen the app (`checkAutomatically: "ON_LOAD"` fetches the rollback bundle on the next cold start).
2. Have them check **Profile → Build Info → OTA Update Status**.
3. Confirm the **Update ID** row shows the UUID of the known-good update — **not** `embedded (no OTA applied)` and not the bad update's ID.
4. Confirm the **Published at** timestamp matches the known-good update push.
5. Confirm the **Channel** row reads **preview** and the **Platform** badge reads **Android**.

> **Important — binary APK updates reset the source badge:**  
> If the tester recently installed a newer APK from the Play internal track, `isEmbeddedLaunch`
> resets to `true` and the hero badge will show **Embedded** (amber) even before the bad OTA arrived.
> Do **not** rely on the source badge alone to confirm rollback success.  
> **Always check the Update ID row** — it shows the exact update group UUID and is the reliable
> indicator. The badge will flip to **OTA ✓** only after the republished bundle has been applied.

---

## Step 3 — Quarantine the bad update (optional but recommended)

On the EAS dashboard you can mark the bad update as **"Deleted"** so it can never be accidentally republished:

1. Go to https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates
2. Find the bad update group, open it, and delete it.

---

## Staged rollout — limiting blast radius on future pushes

To reduce exposure when you're unsure about an update, publish to a percentage of testers first:

```bash
# Push to only 20% of preview-channel devices
eas update --channel preview --rollout-percentage 20 --message "feat: my risky change (staged 20%)"

# After confirming it's healthy, promote to 100%
eas update --channel preview --rollout-percentage 100 --message "feat: my risky change (full rollout)"
```

> Devices that haven't yet received the staged update will continue running their current bundle.
> If the staged update looks bad, run the `eas update:republish` command in Step 1 before widening the rollout.

---

## Quick reference

| Action | Command |
|---|---|
| List recent updates | `eas update:list --channel preview --limit 10` |
| Roll back to a known-good update | `eas update:republish --group <ID> --channel preview` |
| Staged push (20%) | `eas update --channel preview --rollout-percentage 20 --message "..."` |
| Full rollout after confirmation | `eas update --channel preview --rollout-percentage 100 --message "..."` |

| Config reference | Value |
|---|---|
| EAS Project ID | `22d4532c-5b24-49bf-ac70-0c27ec1265a8` |
| Preview channel | `preview` |
| Runtime version policy | `appVersion` → `1.0.0` |
| EAS dashboard | https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates |

---

## Troubleshooting — Android rollback

**Android tester's Update ID still shows the bad update after reopening**
- Force-quit fully (swipe away from recents) and reopen — a background restart does not trigger `ON_LOAD`.
- If still showing the bad update, check the EAS dashboard to confirm `eas update:republish` completed and the known-good group is now the active update on the `preview` channel.
- Wait 60 s for CDN propagation, then cold-start again.

**Android tester sees `embedded (no OTA applied)` instead of the known-good Update ID**
- The tester's APK was built from a different EAS profile (e.g. `development` or `production`) and is not on the `preview` channel.
- Open **Profile → Build Info → OTA Update Status → Channel** row. If it shows anything other than `preview`, the APK is on the wrong channel and **cannot receive the republished update at all**.
- Fix: ask the tester to install the correct preview APK from the Play internal track (built with `eas build --profile preview --platform android`), then reopen the app — the known-good OTA bundle will be fetched automatically on the next cold start.

**`isEmbeddedLaunch` is `true` after rollback, but the Update ID row looks correct**
- A tester who installed a new binary APK after the rollback was published will see `isEmbeddedLaunch: true` because binary installs reset the embedded-launch flag, even when the app subsequently loads an OTA bundle.
- This is expected behavior. Confirm the rollback by checking the **Update ID** row, not the source badge.
- The hero badge will switch from **Embedded** (amber) to **OTA ✓** (teal) only after the *next* `eas update` push following the new APK install.

**`eas update:republish` succeeded but no Android device picked it up within 5 minutes**
- Confirm the known-good update group contained an Android bundle. Run `eas update:list --channel preview` and look for `platform: android` in the group's entries.
- If the original good update was iOS-only, republish an update that explicitly includes both platforms: push a new `eas update --channel preview --platform all` from the last known-good commit.

---

## Related docs

- [OTA-ROLLBACK-PRODUCTION.md](./OTA-ROLLBACK-PRODUCTION.md) — production-channel rollback runbook (higher blast radius, staged rollout required)
- [OTA-SMOKE-TEST.md](./OTA-SMOKE-TEST.md) — end-to-end smoke test for a healthy push
- EAS Update docs: https://docs.expo.dev/eas-update/rollouts/
