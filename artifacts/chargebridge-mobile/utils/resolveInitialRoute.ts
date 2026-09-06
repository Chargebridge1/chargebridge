// ─────────────────────────────────────────────────────────────────────────────
// resolveInitialRoute — centralized post-authentication landing decision.
//
// Priority order:
//   1. Pending deep link  (stored by DeepLinkHandler when user wasn't authed)
//   2. Cold-start deep link  (initial URL from Linking.getInitialURL())
//   3. Incomplete onboarding  (/onboarding)
//   4. Driver Dashboard  (/(tabs)/home)  ← default landing
//
// Active charging sessions are surfaced as an ActiveSessionBanner card at the
// top of the Home screen rather than redirecting away from it. This keeps Home
// as the stable post-auth destination and avoids forceful navigation.
//
// Call this once per auth completion (sign-in, sign-up, complete-profile) and
// pass the result directly to router.replace().
// ─────────────────────────────────────────────────────────────────────────────

import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { consumePendingRoute } from "./pendingRoute";
import { track } from "@/lib/analytics";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Matches onboarding.tsx: ONBOARDING_KEY */
const ONBOARDING_STORAGE_KEY = "@chargebridge/onboarding_done";

// ── Cold-start URL guard ──────────────────────────────────────────────────────
// Linking.getInitialURL() returns the same URL for the entire app lifetime.
// Without this flag, a sign-out → sign-in in the same session after a
// deep-link cold-start would incorrectly re-route to the linked screen.
let _initialUrlConsumed = false;

// ── URL → route helper (shared with DeepLinkHandler) ─────────────────────────

/**
 * Extract the in-app route from a deep-link URL.
 * Returns null if the URL is not a recognised ChargeBridge deep link.
 *
 * Handles:
 *   chargebridge-mobile://station/123
 *   https://chargebridgeapp.com/station/123
 */
export function urlToRoute(url: string | null): string | null {
  if (!url) return null;
  try {
    const path = url.replace(
      /^(chargebridge-mobile:\/\/|https?:\/\/[^/]+)/,
      "",
    );
    const stationMatch = path.match(/^\/?station\/([^/?#]+)/);
    if (stationMatch) return `/station/${stationMatch[1]}`;
  } catch {}
  return null;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

type Reason =
  | "pending_deep_link"
  | "cold_start_deep_link"
  | "onboarding"
  | "home";

/**
 * Resolve the correct landing route after an authentication event.
 *
 * This is the ONLY place that decides where to send the user post-auth —
 * all auth screens (sign-in, sign-up, complete-profile) call this and pass
 * the result to `router.replace()`.
 */
export async function resolveInitialRoute(): Promise<string> {
  let destination: string;
  let reason: Reason;

  // ── Priority 1: Pending deep link (set by listener while user was on auth screen) ──
  const pending = consumePendingRoute();
  if (pending) {
    destination = pending;
    reason = "pending_deep_link";
  }

  // ── Priority 2: Cold-start deep link (app opened via URL before auth) ────────
  else {
    let deepLinkRoute: string | null = null;
    if (!_initialUrlConsumed) {
      const initialUrl = await Linking.getInitialURL();
      deepLinkRoute = urlToRoute(initialUrl);
      if (deepLinkRoute) _initialUrlConsumed = true;
    }
    if (deepLinkRoute) {
      destination = deepLinkRoute;
      reason = "cold_start_deep_link";
    }

    // ── Priority 3: Incomplete onboarding ─────────────────────────────────────
    else {
      const onboarded = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
      if (!onboarded) {
        destination = "/onboarding";
        reason = "onboarding";
      }

      // ── Priority 4: Default — Driver Dashboard ────────────────────────────
      // Active sessions surface as an ActiveSessionBanner card at the top of
      // the Home screen (see components/dashboard/ActiveSessionBanner in
      // dashboard.tsx). No redirect needed.
      else {
        destination = "/(tabs)/home";
        reason = "home";
      }
    }
  }

  // Analytics: record the routing decision for funnel analysis
  track("initial_route_resolved", { destination, reason });

  return destination;
}
