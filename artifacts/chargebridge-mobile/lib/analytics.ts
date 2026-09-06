import PostHog, { PostHogProvider } from "posthog-react-native";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";

const KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY as string | undefined;

// Build metadata captured once at module init and re-registered after reset()
// so events fired after sign-out still carry these properties.
const _appVersion = Constants.expoConfig?.version ?? "unknown";
const _buildNumber =
  Constants.expoConfig?.ios?.buildNumber ??
  String(Constants.expoConfig?.android?.versionCode ?? "unknown");

let _client: PostHog | null = null;

if (KEY) {
  _client = new PostHog(KEY, {
    host: "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });

  // Register build metadata as super-properties so every event carries them.
  // build_number is the iOS buildNumber / Android versionCode string.
  _client.register({ app_version: _appVersion, build_number: _buildNumber });
} else if (typeof __DEV__ !== "undefined" && __DEV__) {
  // Warn in dev/staging so a misconfigured EAS secret is caught before release.
  // Metro always defines __DEV__; the typeof guard keeps Jest tests that don't
  // set it from throwing a ReferenceError.
  console.warn(
    "[analytics] EXPO_PUBLIC_POSTHOG_API_KEY is not set — all analytics calls " +
      "will be no-ops. If this is a production or staging build, check your EAS secrets.",
  );
}

/** Async SHA-256 hex of any raw identifier. Returns "anonymous" for null/undefined. */
export async function hashId(raw: string | number | null | undefined): Promise<string> {
  if (raw == null) return "anonymous";
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      String(raw),
    );
  } catch {
    return "anonymous";
  }
}

/**
 * Fire-and-forget event capture.
 * No-op when EXPO_PUBLIC_POSTHOG_API_KEY is absent.
 */
export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    _client?.capture(event, properties as any);
  } catch {
    // swallow — analytics must never crash the app
  }
}

/**
 * Identify the current user with a SHA-256 hashed Clerk user ID.
 * Call this after sign-in.
 */
export function identifyUser(clerkUserId: string | null | undefined): void {
  if (!_client || !clerkUserId) return;
  hashId(clerkUserId)
    .then((hash) => _client?.identify(hash))
    .catch(() => {});
}

/**
 * Reset identity on sign-out.
 * Re-registers build metadata immediately after reset() so events fired before
 * the next app launch still carry app_version and build_number.
 */
export function resetUser(): void {
  try {
    _client?.reset();
    // PostHog reset() clears all super-properties. Re-register build metadata
    // so the next track() call (in the same app session) still carries them.
    if (_client) {
      _client.register({ app_version: _appVersion, build_number: _buildNumber });
    }
  } catch {
    // swallow
  }
}

export { _client as posthogClient, PostHogProvider };
