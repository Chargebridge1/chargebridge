# ChargeBridge Mobile — Release Checklist

Use this checklist before triggering an EAS build for the `preview` or
`production` profile.  Work through each section top-to-bottom; do not submit
to the store until every item is checked.

---

## 0. Pre-push hook (new clone setup)

The root `package.json` postinstall runs `simple-git-hooks`, which writes a
`pre-push` hook into `.git/hooks/`.  On every `git push` that hook runs:

```
node artifacts/chargebridge-mobile/scripts/run-nav-timing-gate.cjs
```

The gate is identical to the EAS `eas-build-post-install` check but fires on
the developer's machine, before a build slot is consumed.

**On a new clone**, install the hook by running `pnpm install` from the repo
root (as usual).  `simple-git-hooks` handles hook installation automatically.
To verify the hook is active:

```sh
cat .git/hooks/pre-push   # should contain run-nav-timing-gate.cjs
```

If the file is missing, re-run `pnpm install` from the repo root, or run
`npx simple-git-hooks` directly.

**After resetting git config (or if you suspect the hook is being silently skipped):**

Git respects a `core.hooksPath` override — if one is set (globally or locally)
git looks in *that* directory instead of `.git/hooks/`, completely bypassing
the hook `simple-git-hooks` installed.  Confirm no such override is active:

```sh
# Check for a local (repo-level) override — should print nothing
git config --list --local | grep hooksPath

# Check for a global override — should print nothing, or a path you control
# that also contains a pre-push hook pointing to run-nav-timing-gate.cjs
git config --list --global | grep hooksPath
```

If either command returns a `core.hookspath` entry that redirects away from
`.git/hooks/`, unset it with:

```sh
# Remove a repo-level override
git config --unset core.hooksPath

# Remove a global override (only if safe to do so across all repos)
git config --global --unset core.hooksPath
```

Then re-run `pnpm install` from the repo root to reinstall the hook.

> **Hotfix escape hatch:** Set `NAV_TIMING_GATE_SKIP=<reason>` to bypass the
> pre-push gate for an emergency hotfix push:
>
> ```sh
> NAV_TIMING_GATE_SKIP="hotfix: auth crash in prod" git push
> ```
>
> The gate prints a loud warning and exits 0; the reason is written to the
> terminal so it appears in any CI push log.
>
> **Policy — when this is appropriate:**
> - A production crash or security vulnerability requires an immediate patch.
> - There is no time to collect and fill in tester timing feedback before push.
> - The incomplete summary will be filled in before the *next* regular build.
>
> **Mandatory follow-up (within 24 h of the hotfix push):**
> 1. Open (or update) a task referencing the skipped summary and the hotfix commit.
> 2. Fill in the skipped summary before triggering the next non-hotfix build.
> 3. Confirm the EAS build for this hotfix passed — the escape hatch is **not**
>    honoured inside EAS builds (`EAS_BUILD=true`), so the build itself still
>    enforces the gate regardless of the env var.
>
> **`git push --no-verify` is strongly discouraged** — it bypasses *all* hooks,
> including unrelated safety checks.  Use `NAV_TIMING_GATE_SKIP` instead so only
> this one gate is skipped and a reason is recorded.

---

## 1. EAS Secrets

| Secret | Required for | How to verify |
|---|---|---|
| `EXPO_PUBLIC_POSTHOG_API_KEY` | `preview`, `production` | EAS build logs show `✓ EXPO_PUBLIC_POSTHOG_API_KEY is set` |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `preview`, `production` | Visible in EAS project secrets dashboard |
| `SENTRY_DSN` (if added) | `preview`, `production` | EAS project secrets dashboard |

> **Analytics gap check (automated)**
>
> The `eas-build-post-install` hook runs
> `scripts/check-analytics-env.cjs` automatically on every EAS build.
> For `preview` and `production` profiles it **fails the build** when
> `EXPO_PUBLIC_POSTHOG_API_KEY` is absent, printing a clearly visible
> error box in the EAS build log.  You do not need to check this manually
> — a successful build confirms the key was present.
>
> To add or rotate the secret:
> 1. Open expo.dev → your project → **Secrets**.
> 2. Add/update `EXPO_PUBLIC_POSTHOG_API_KEY` (value: `phc_…`).
> 3. Re-trigger the build.

---

## 2. OTA / Update channels

- [ ] Confirm the build targets the correct EAS channel (`preview` or `production`).
- [ ] Any pending OTA updates on that channel have been reviewed and are intentional.

---

## 3. Version bump

- [ ] `app.json` / `app.config.js` version string incremented if this is a store submission.
- [ ] `ios.buildNumber` / `android.versionCode` incremented.

---

## 3a. Previous build nav-timing summary gate

Before triggering this build, confirm the **previous** build's feedback summary is fully populated.

> **Automated gate (EAS builds — iOS and Android)**
>
> The `eas-build-post-install` hook automatically runs
> `scripts/run-nav-timing-gate.cjs`, which finds the most recent
> `docs/nav-timing-feedback-summary-build-NNN.md` and pipes it through
> `scripts/check-nav-timing-summary.cjs`.  **A build fails immediately**
> when the summary contains any unfilled `*(fill in)*` cells or any
> unresolved ❌ row whose regression has not been triaged.  A clear error
> is printed to the EAS build log.
>
> **Android enforcement:** `eas-build-post-install` is a platform-agnostic
> EAS Build lifecycle hook — EAS runs it for every build regardless of
> platform.  All three profiles in `eas.json` (`development`, `preview`,
> `production`) include an `android` section and none specifies a
> `platform: "ios"` constraint.  The nav-timing gate therefore runs
> identically for Android APK / AAB builds and for iOS builds; there is no
> separate Android hook required and no Android bypass path.
>
> If no prior summary file exists (first-ever build) the gate is skipped
> automatically — no manual override required.
>
> You do **not** need to run the check manually for EAS builds — a
> successful build confirms the gate passed.  To run the gate locally:
> ```
> node scripts/run-nav-timing-gate.cjs
> ```

> **⚠️ Summary files must be committed and pushed before triggering the next
> EAS build.**  EAS builds run against a clean git checkout — only committed
> files are visible to the build.  If a summary file exists on your local
> machine but has not been committed and pushed, the EAS build will not see
> it.  The gate detects this situation: it checks git history on EAS and
> exits 1 with a clear error when git shows prior committed summaries but no
> summary file is present in the clean checkout.  The authoritative
> verification is the EAS build itself passing — a successful build confirms
> the gate found and accepted the committed summary.
>
> To commit and push the summary:
> ```sh
> git add docs/nav-timing-feedback-summary-build-NNN.md
> git commit -m "docs: add nav-timing summary for build NNN"
> git push
> ```

- [ ] Locate `docs/nav-timing-feedback-summary-build-NNN.md` for the immediately preceding build number.
- [ ] **Commit and push the summary file** before triggering this build (see note above).
- [ ] *(EAS: automated — see above)* Confirm it contains no unfilled `*(fill in)*` cells.
- [ ] *(EAS: automated — see above)* Confirm it contains no unresolved ❌ rows (all regressions either resolved or a blocking task filed and linked).

> **First build ever?** Skip this section and note "first build — no prior summary" in the checklist.  The automated gate will also skip automatically.
>
> **Hotfix / patch build?** Use the `NAV_TIMING_GATE_SKIP` escape hatch (see
> § 0 above) if the summary cannot be filled in before the push.  The EAS
> build gate is always strict — `NAV_TIMING_GATE_SKIP` is ignored inside EAS,
> so the build itself requires a complete summary even for hotfixes.  Fill in
> the summary before triggering the EAS build or use `git push --no-verify`
> only as a last resort (see the bypass policy in § 0).

---

## 4. Pre-build smoke test (staging / preview)

- [ ] Launch the app from TestFlight / internal track on a physical device.
- [ ] Sign in via Clerk — confirm no auth errors.
- [ ] Open the map and load at least one station.
- [ ] Verify PostHog receives at least one event (check PostHog Live Events dashboard).
- [ ] Check **Profile → Build Info** to confirm the correct `commitSha` and `buildTimestamp`.

---

## 4a. Navigation performance (every build)

Run the standard route defined in `docs/nav-performance-report.md` and fill in the new build row.

- [ ] Voice timing accuracy ≥ 90% (no missing a3 announcements).
- [ ] Reroute detection lag 5–12 s; recovery cue ≤ 800 ms.
- [ ] Zero missed maneuvers on the standard route.
- [ ] GPS p95 update interval ≤ 4 s; no gap > 10 s.
- [ ] All route-progression sub-checks pass (startup cue, 600 ms next-step cue, arrival, BG/FG race guard, no reset).
- [ ] TTS p95 excess latency ≤ 800 ms; zero watchdog fires.
- [ ] Back-to-back maneuvers: both a3 announcements fire, no silent gap.
- [ ] Highway: a3 fires ≥ 150 m before exits; zero false off-route on curves.
- [ ] Urban: a3 fires 15–60 m before turns; zero false step advances while stationary.

**Any ❌ against the escalation thresholds in `docs/nav-performance-report.md` blocks submission.** Open a Root Cause Report before proceeding.

### Tester timing feedback (every build — build captain action required)

`docs/nav-timing-feedback-template.md` is the canonical tester feedback template and
`docs/nav-timing-feedback-summary.md` is the canonical per-build summary.  Follow these
steps for **every** build; do not skip even for patch/hotfix builds.

1. **Copy the template** — duplicate `docs/nav-timing-feedback-template.md` and rename the
   copy to `docs/nav-timing-feedback-build-NNN.md`.  Then find-and-replace every occurrence of
   `BUILD_NUMBER` in the new file with the actual build number, and replace every occurrence of
   `OPEN_TASK_LIST` with a short comma-separated list of the open nav-timing task numbers
   relevant to this build (e.g. `#672, #711`).  (The source file uses `BUILD_NUMBER` and
   `OPEN_TASK_LIST` as placeholders throughout — a single global replace for each covers them
   all.)

2. **Copy the summary** — duplicate `docs/nav-timing-feedback-summary.md` and rename the copy
   to `docs/nav-timing-feedback-summary-build-NNN.md`.  In the new file, **first** replace the
   literal `(NNN+1)` with the actual next build number (e.g. `208` when the current build is
   `207`), then find-and-replace every remaining occurrence of `NNN` with the current build
   number.  This order matters: a global `NNN` replace done first would turn `(NNN+1)` into
   `(208+1)` and the second step would fail to match.

3. **Commit and push the template** — before distributing the file to testers, commit it so
   the copy testers receive is always tracked in git:

   ```sh
   git add docs/nav-timing-feedback-build-NNN.md
   git commit -m "docs: add nav-timing feedback template for build NNN"
   git push
   ```

   > **Why commit first?** The pre-push gate warns when the template file exists on disk but
   > has not been committed (see § 0).  An uncommitted template can be lost if the branch is
   > reset or the worktree cleaned before all feedback arrives; a committed copy is the
   > authoritative record.

4. **Distribute** — share `docs/nav-timing-feedback-build-NNN.md` with all active TestFlight
   testers via the eng channel before the build goes live.  **Require** testers to attach a
   TestFlight console log captured during a nav session.  The minimum required filter strings are:
   `navSpeak`, `Speech.speak(forced)`, and (if a timing investigation is active) any additional
   filter strings listed in the current build's root cause or investigation document.  "Attach
   where possible" is not acceptable — if a tester cannot capture logs, they cannot complete
   a nav timing session for the purposes of Runtime Verified sign-off.

5. **Set a deadline** — agree a return date with testers and record it in the summary's
   *Distribution checklist* section.

6. **Populate the summary** — once feedback arrives, paste tester results into
   `docs/nav-timing-feedback-summary-build-NNN.md` and resolve any ❌ / ⚠️ rows by filing or
   updating the linked task before triggering the next build.

- [ ] Template copied and renamed for this build number.
- [ ] Summary copied and renamed for this build number.
- [ ] **Template committed and pushed** (`git add docs/nav-timing-feedback-build-NNN.md && git commit && git push`) before distributing.
- [ ] Template distributed to all active TestFlight testers.
- [ ] Feedback deadline agreed and recorded in the summary.
- [ ] Summary populated and all regressions triaged before next build is triggered.
- [ ] **All diagnostic log values required by the current investigation (listed in the build's root cause / investigation doc) captured and recorded in the summary.** A session without required log evidence does not count toward Runtime Verified.

---

## 5. OTA smoke test (if an OTA update was pushed alongside the build)

Follow `OTA-SMOKE-TEST.md`.

---

## 6. Store submission (production only)

- [ ] EAS CLI ≥ 21.x (`eas --version`).  Version 19.x causes Apple 500 errors.
- [ ] `google-play-service-account.json` present and valid (already in place, excluded from git).
- [ ] Metadata (screenshots, description) up to date in App Store Connect / Play Console.

**Step 1 — Trigger builds for both platforms** (run from `artifacts/chargebridge-mobile/`):

```sh
pnpm run eas:build:ios
pnpm run eas:build:android
```

Both scripts pass `--no-wait` so they queue immediately and return.
Monitor progress in the EAS dashboard; do **not** proceed to submission until both builds show **Finished**.

- [ ] iOS build finished in EAS dashboard.
- [ ] Android build finished in EAS dashboard.

**Step 2 — Submit to stores** (after both builds are finished):

- [ ] **iOS:** `eas submit --platform ios --profile production --latest`
- [ ] **Android (subsequent releases):** `eas submit --platform android --profile production --latest`
- [ ] **Android (first-ever release):** Manual AAB upload via Play Console — see `ANDROID-SUBMISSION.md`.  Do **not** run `eas submit` for Android on the first release; Play Console requires the AAB to be uploaded manually to create the app listing.
- [ ] Android internal-track testers have received the opt-in link from Play Console.

---

## Related runbooks

- `OTA-ROLLBACK.md` — roll back a bad preview OTA
- `OTA-ROLLBACK-PRODUCTION.md` — roll back a bad production OTA
- `OTA-SMOKE-TEST.md` — verify an OTA update end-to-end
- `ANDROID-SUBMISSION.md` — first-time Android build and Play Store submission guide
- `docs/nav-performance-report.md` — navigation performance thresholds and build-over-build comparison table
