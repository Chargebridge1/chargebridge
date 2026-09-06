/**
 * Factory that creates the `onSessionExpired` callback passed to
 * runSavePillLayout from NavPillProvider.
 *
 * Extracted so the Alert wiring can be unit-tested without a full React
 * rendering environment (which would pull in Expo's ESM-only virtual modules).
 */

import { Alert } from "react-native";

export interface SessionExpiredRouter {
  push: (path: string) => void;
}

/**
 * Returns the `onSessionExpired` callback used by NavPillProvider.
 * When called it fires an Alert with two buttons:
 *   • "Later"        — cancel, no navigation
 *   • "Sign In Again" — navigates to /(auth)/sign-in
 */
export function makeSessionExpiredAlert(
  router: SessionExpiredRouter,
): () => void {
  return () => {
    Alert.alert(
      "Session Expired",
      "Your session has expired. Please sign in again to save your layout.",
      [
        { text: "Later", style: "cancel" },
        {
          text: "Sign In Again",
          onPress: () => router.push("/(auth)/sign-in"),
        },
      ],
    );
  };
}
