# OTA Rollback Runbook — Production Channel

Use this runbook when a bad OTA update has been pushed to the `production` channel and you need to stop it reaching more App Store users or restore a known-good state.

> **⚠ Higher blast radius than preview.** Production users do not reinstall from TestFlight — they will keep running the bad bundle until the rollback propagates. Act quickly. The window before CDN edge nodes fully cache a new update is roughly 5–15 minutes; after that, every new launch pulls the bad bundle until you republish.

---

## Prerequisites

- EAS CLI ≥ 21.x installed locally (`eas --version`)
- Logged in as the project owner: `eas login` (account: `iblackett`)
- Access to the EAS dashboard: https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates

---

## Step 1 — Stop the bad update immediately

Republish the last known-good update over the `production` channel.  
This makes EAS serve the good bundle to any user who hasn't yet downloaded the bad one.

```bash
cd artifacts/chargebridge-mobile

# List recent updates on the production channel to find the last good group ID
eas update:list --channel production --limit 10

# Republish the good update (replace <GOOD_UPDATE_GROUP_ID> with the ID from the list above)
eas update:republish --group <GOOD_UPDATE_GROUP_ID> --channel production --message "rollback: revert bad update"
```

> **How to find the good update ID**
> - Run `eas update:list --channel production` and look for the update just *before* the one you want to roll back.
> - Or open the EAS dashboard → Updates → Production channel → copy the group ID of the last stable update.

The republish is **immediate on the EAS side** — new app launches and background update checks will receive the good bundle within seconds of the command completing. Users already running the bad bundle will pick up the fix the next time the app is foregrounded (because `checkAutomatically: "ON_LOAD"` fires on every cold start).

---

## Step 2 — Verify real users receive the rollback

Unlike the preview channel (where you can ask a named tester), production verification relies on indirect signals:

1. **Build Info screen** — if you have a way to reach a known production user, ask them to force-quit and reopen the app, then check **Profile → Build Info → OTA Update Status** and confirm the Update ID matches the known-good group.
2. **EAS dashboard** — watch the update's install count. After a successful republish the bad update's install count should plateau while the good update's count climbs.
3. **Crash dashboards** — monitor your error-reporting service (PostHog / Sentry) for a drop in the crash rate that triggered the rollback. Allow 10–30 minutes for signal.

> **No TestFlight equivalent.** You cannot push a silent "check for update" request to production devices the way TestFlight can re-download a build. Rollback propagation is entirely pull-based: the device checks on next cold start. Plan to leave the rollback in place for at least 24 hours before pushing a follow-up fix.

---

## Step 3 — Quarantine the bad update (optional but recommended)

On the EAS dashboard you can mark the bad update as **"Deleted"** so it can never be accidentally republished:

1. Go to https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates
2. Find the bad update group, open it, and delete it.

---

## Step 4 — File an incident report

For any production rollback, document the incident before closing the loop:

- What was the bad update? (group ID, message, publish timestamp)
- When was it noticed? How many users were affected?
- What was the rollback group ID and publish timestamp?
- Root cause and fix summary
- Were any users permanently stuck on the bad bundle? (users who never cold-started the app during the window would need a native App Store build to recover)

---

## Staged rollout policy — REQUIRED for all production pushes

**Never push a production OTA at 100% without staging first.** The standard ramp is:

```bash
# Stage 1 — push to 10% of production devices
eas update --channel production --rollout-percentage 10 \
  --message "feat: my change (staged 10%)"

# Wait at least 30 minutes. Check crash dashboards and error rates.

# Stage 2 — widen to 50% if Stage 1 is clean
eas update --channel production --rollout-percentage 50 \
  --message "feat: my change (staged 50%)"

# Wait at least 60 minutes. Check again.

# Stage 3 — full rollout
eas update --channel production --rollout-percentage 100 \
  --message "feat: my change (full rollout)"
```

> Devices that haven't yet received the staged update continue running their current bundle.
> If a staged update looks bad at any percentage, run the `eas update:republish` command in Step 1 **before** widening the rollout — the blast radius is still limited.

### Minimum observation periods

| Stage | Rollout % | Min wait before widening |
|---|---|---|
| Stage 1 | 10% | 30 minutes |
| Stage 2 | 50% | 60 minutes |
| Stage 3 | 100% | — (final) |

For high-risk changes (new payment flows, auth changes, native bridge calls), extend Stage 1 to 24 hours.

---

## Key differences from the preview-channel runbook

| | Preview channel | Production channel |
|---|---|---|
| Who is affected | Internal TestFlight testers | Real App Store users |
| Rollback command | `--channel preview` | `--channel production` |
| Rollback verification | Ask a named tester directly | Indirect: EAS install counts + crash rate |
| Recovery if stuck | Tester can reinstall from TestFlight | User must reinstall from App Store (rare) |
| Staged rollout | Recommended | **Required** |
| Incident report | Not required | Required |
| Rollout start percentage | 20% is fine | Start at 10% maximum |

---

## Quick reference

| Action | Command |
|---|---|
| List recent updates | `eas update:list --channel production --limit 10` |
| Roll back to a known-good update | `eas update:republish --group <ID> --channel production --message "rollback: ..."` |
| Staged push (10%) | `eas update --channel production --rollout-percentage 10 --message "..."` |
| Widen to 50% | `eas update --channel production --rollout-percentage 50 --message "..."` |
| Full rollout | `eas update --channel production --rollout-percentage 100 --message "..."` |

| Config reference | Value |
|---|---|
| EAS Project ID | `22d4532c-5b24-49bf-ac70-0c27ec1265a8` |
| Production channel | `production` |
| Runtime version policy | `appVersion` → `1.0.0` |
| Update check timing | `ON_LOAD` (every cold start) |
| EAS dashboard | https://expo.dev/accounts/iblackett/projects/chargebridge-mobile/updates |

---

## Related docs

- [OTA-ROLLBACK.md](./OTA-ROLLBACK.md) — preview-channel rollback runbook
- [OTA-SMOKE-TEST.md](./OTA-SMOKE-TEST.md) — end-to-end smoke test for a healthy push
- EAS Update docs: https://docs.expo.dev/eas-update/rollouts/
- EAS Update staged rollouts: https://docs.expo.dev/eas-update/rollouts/#staged-rollouts
