/**
 * OtaUpdateContext — periodic OTA update checker for testers.
 *
 * Behaviour
 * ─────────
 * • Fires `Updates.checkForUpdateAsync()` on every foreground transition
 *   AND on a 4-hour interval, whichever comes first.
 * • De-dupes: if both triggers fire within 60 s of each other, only the
 *   first check runs (avoids a redundant network call on cold-start).
 * • In __DEV__ (Expo Go / Metro) the check is skipped entirely — expo-updates
 *   OTA is not available there.
 * • When an update is found, a non-intrusive Alert gives the tester a
 *   "Restart to update" option.  "Later" dismisses without action.
 * • Session-safe: if a charge session is active when the tester accepts the
 *   prompt, `reloadAsync()` is deferred via `guardedOTAReload`. The reload
 *   fires automatically once the session ends.
 * • Exposes `updateAvailable` via context so the Build Info screen can show
 *   a persistent "Update ready" banner even after the Alert is dismissed.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Alert, AppState, AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { useSession } from "@/contexts/SessionContext";
import { guardedOTAReload } from "@/utils/otaReloadGuard";

const CHECK_INTERVAL_MS  = 4 * 60 * 60 * 1000; // 4 hours
const MIN_RECHECK_GAP_MS = 60 * 1000;          // 60 s — de-dupe window
const LATER_COOLDOWN_MS  = 2 * 60 * 60 * 1000; // 2 h — suppress prompt after "Later"

// ─── Context ──────────────────────────────────────────────────────────────────

interface OtaUpdateContextValue {
  /** True when an OTA update has been detected (persists until the app reloads). */
  updateAvailable: boolean;
  /** Internal setter — only used by OtaUpdateChecker. */
  _setUpdateAvailable: (v: boolean) => void;
  /**
   * True when an update was downloaded and deferred because a charge session was
   * active. Will auto-install once the session ends. Persists across screens so
   * Build Info can show a top-level banner even when the OTACard is off-screen.
   */
  pendingReload: boolean;
  /** Internal setter — called by OtaUpdateChecker and OTACard. */
  _setPendingReload: (v: boolean) => void;
}

const OtaUpdateContext = createContext<OtaUpdateContextValue>({
  updateAvailable: false,
  _setUpdateAvailable: () => {},
  pendingReload: false,
  _setPendingReload: () => {},
});

/**
 * Wrap the app tree (inside SessionProvider) with this provider so any screen
 * can read `updateAvailable` and `pendingReload` from `useOtaUpdate()`.
 */
export function OtaUpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [pendingReload, setPendingReload] = useState(false);
  return (
    <OtaUpdateContext.Provider value={{
      updateAvailable,
      _setUpdateAvailable: setUpdateAvailable,
      pendingReload,
      _setPendingReload: setPendingReload,
    }}>
      {children}
    </OtaUpdateContext.Provider>
  );
}

/** Read OTA update state from anywhere in the tree. */
export function useOtaUpdate(): OtaUpdateContextValue {
  return useContext(OtaUpdateContext);
}

// ─── Background checker ───────────────────────────────────────────────────────

/**
 * Drop <OtaUpdateChecker /> anywhere inside OtaUpdateProvider + SessionProvider.
 * It renders nothing and manages the background check as a side-effect.
 */
export function OtaUpdateChecker() {
  const { session } = useSession();
  const isSessionActive = session !== null;
  const { _setUpdateAvailable, _setPendingReload } = useOtaUpdate();

  const lastCheckRef        = useRef<number>(0);
  const laterDismissedAtRef = useRef<number>(0); // timestamp of last "Later" tap
  const appStateRef         = useRef<AppStateStatus>(AppState.currentState);
  // True when an update was downloaded but reloadAsync was deferred because a
  // session was active. Cleared once the reload fires.
  const pendingReloadRef = useRef<boolean>(false);
  // Stable ref so the session-end effect reads the current isSessionActive
  // without adding it as a dependency of the interval/listener setup.
  const isSessionActiveRef = useRef<boolean>(isSessionActive);
  isSessionActiveRef.current = isSessionActive;

  // When the session ends and a reload is queued, fire it automatically.
  useEffect(() => {
    if (!isSessionActive && pendingReloadRef.current) {
      pendingReloadRef.current = false;
      _setPendingReload(false);
      void Updates.reloadAsync();
    }
  }, [isSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function runCheck() {
      // expo-updates OTA is disabled in the Expo Go dev client.
      if (__DEV__) return;

      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;

        // Mark update available in context so Build Info can show a persistent banner.
        _setUpdateAvailable(true);

        // Suppress the prompt while the "Later" cooldown is active.
        const now = Date.now();
        if (now - laterDismissedAtRef.current < LATER_COOLDOWN_MS) return;

        Alert.alert(
          "Update ready",
          "A new app update is available. Restart now to apply it — it only takes a moment.",
          [
            {
              text: "Later",
              style: "cancel",
              onPress: () => {
                laterDismissedAtRef.current = Date.now();
              },
            },
            {
              text: "Restart to update",
              style: "default",
              onPress: async () => {
                try {
                  await Updates.fetchUpdateAsync();
                  // Gate behind session state — never reload mid-charge.
                  await guardedOTAReload({
                    isSessionActive: isSessionActiveRef.current,
                    reloadAsync: () => Updates.reloadAsync(),
                    onDeferred: () => {
                      pendingReloadRef.current = true;
                      _setPendingReload(true);
                      // Inform the tester their update is queued.
                      Alert.alert(
                        "Update queued",
                        "The update will install automatically once your charging session ends.",
                        [{ text: "OK" }],
                      );
                    },
                  });
                } catch {
                  // Silent — tester can tap "Check for OTA update" on Build Info if
                  // the download fails.
                }
              },
            },
          ],
          { cancelable: true },
        );
      } catch {
        // Network errors, missing manifest, etc. — no-op silently.
      }
    }

    function maybeCheck() {
      const now = Date.now();
      if (now - lastCheckRef.current < MIN_RECHECK_GAP_MS) return;
      lastCheckRef.current = now;
      void runCheck();
    }

    // Foreground-transition listener
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "active" && prev !== "active") {
        maybeCheck();
      }
    });

    // Periodic 4-hour interval (fires even when the app stays foregrounded)
    const interval = setInterval(maybeCheck, CHECK_INTERVAL_MS);

    // Initial check — runs once shortly after mount so testers who leave the
    // app open on the Build Info screen also see the prompt.
    maybeCheck();

    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
