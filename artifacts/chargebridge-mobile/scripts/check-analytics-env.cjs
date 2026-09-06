'use strict';
/**
 * check-analytics-env.cjs
 *
 * EAS build hook: verify EXPO_PUBLIC_POSTHOG_API_KEY is set for every
 * non-development build profile.
 *
 * Run automatically via the root eas-build-post-install hook so it executes
 * before the JS bundle is compiled, making the gap visible in EAS build logs
 * rather than only in device console output.
 *
 * Exit codes:
 *   0 — key present, or profile explicitly excluded from the check (development)
 *   1 — key absent for a profile that requires it (fails the EAS build)
 */

const PROFILE = process.env.EAS_BUILD_PROFILE ?? '';

// Only check when running inside an EAS build.  If EAS_BUILD_PROFILE is
// absent we are running locally (e.g. during pnpm install) — skip silently.
if (!PROFILE) {
  process.exit(0);
}

// Development builds deliberately omit the key — the __DEV__ console.warn
// in analytics.ts is sufficient for local iteration.
const SKIPPED_PROFILES = ['development'];

if (SKIPPED_PROFILES.includes(PROFILE)) {
  console.log(
    `[check-analytics-env] Profile "${PROFILE}" is excluded from the analytics key check — skipping.`,
  );
  process.exit(0);
}

const KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

if (KEY && KEY.trim().length > 0) {
  console.log(
    `[check-analytics-env] ✓ EXPO_PUBLIC_POSTHOG_API_KEY is set for profile "${PROFILE}".`,
  );
  process.exit(0);
}

// Key is missing for a non-development profile — fail loudly.
console.error('');
console.error('╔══════════════════════════════════════════════════════════════════╗');
console.error('║  ANALYTICS CONFIG ERROR — BUILD BLOCKED                         ║');
console.error('╠══════════════════════════════════════════════════════════════════╣');
console.error(`║  Profile : ${PROFILE.padEnd(55)}║`);
console.error('║  Missing : EXPO_PUBLIC_POSTHOG_API_KEY                           ║');
console.error('╠══════════════════════════════════════════════════════════════════╣');
console.error('║  All analytics calls will be silent no-ops in this build.        ║');
console.error('║                                                                  ║');
console.error('║  Fix: add the secret in EAS dashboard →                          ║');
console.error('║    expo.dev → Project → Secrets → EXPO_PUBLIC_POSTHOG_API_KEY   ║');
console.error('║  or pass it via --env flag:                                      ║');
console.error('║    eas build --profile preview \\                                 ║');
console.error('║      --env EXPO_PUBLIC_POSTHOG_API_KEY=phc_...                   ║');
console.error('╚══════════════════════════════════════════════════════════════════╝');
console.error('');

process.exit(1);
