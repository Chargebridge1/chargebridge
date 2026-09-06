import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  PillId,
  NavPillLayout,
  DEFAULT_LAYOUT,
  normalizeLayout,
  resolveVisiblePills,
  ALL_PILL_IDS,
} from "@/constants/navPills";
import { readLocal, writeLocal } from "@/utils/navPillStorage";
import { track } from "@/lib/analytics";
import { NavSaveErrorToast } from "@/components/navigation/NavSaveErrorToast";
import { runSavePillLayout } from "@/utils/savePillLayout";
import { makeSessionExpiredAlert } from "@/utils/makeSessionExpiredAlert";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavPillContextValue {
  /** Pills visible in the tab bar, in user-defined display order */
  visiblePills: PillId[];
  /** Full ordering of all pills (includes hidden optional ones) */
  layout: NavPillLayout;
  /** Whether the edit-mode sheet is open */
  isEditMode: boolean;
  enterEditMode: () => void;
  exitEditMode: () => void;
  /** Persist a new layout — updates local state, AsyncStorage, and the server */
  savePillLayout: (order: PillId[], hidden: PillId[]) => Promise<void>;
  /** Reset to factory defaults */
  resetToDefault: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const NavPillContext = createContext<NavPillContextValue | null>(null);

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export function NavPillProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [layout, setLayout] = useState<NavPillLayout>(DEFAULT_LAYOUT);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saveErrorVisible, setSaveErrorVisible] = useState(false);
  const serverHydrated = useRef(false);
  /**
   * Set to true when Phase 2 fails with a transient error (network throw or
   * non-ok HTTP response).  The AppState "active" listener watches this flag
   * and re-runs attemptPhase2 the next time the app foregrounds, so a layout
   * saved on another device while this device was offline is picked up as soon
   * as connectivity returns — without requiring a full app restart.
   */
  const phase2FailedRef = useRef(false);
  /**
   * Stores the order/hidden values from the most-recent savePillLayout call so
   * the toast Retry button can re-attempt the exact same PATCH without the user
   * having to drag again.
   */
  const lastAttemptedLayoutRef = useRef<{ order: PillId[]; hidden: PillId[] } | null>(null);
  /**
   * Tracks the savedAt timestamp of the most-recently applied local layout.
   * Phase 2 compares against this to avoid overwriting a newer local layout
   * with a stale server response (Hypothesis D — cross-device race condition).
   */
  const localSavedAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Reset hydration state so Phase 1 always runs for a fresh auth session.
    // Without this reset, a second user signing in on the same device would
    // skip Phase 1 entirely (serverHydrated still true from the previous
    // user's Phase 2), causing them to see the previous user's nav layout
    // until Phase 2 fires — or permanently if Phase 2 also has no data.
    serverHydrated.current = false;
    localSavedAtRef.current = undefined;

    // Kick off the Phase 2 server fetch immediately so it races Phase 1 in
    // parallel (no added latency), but we won't *evaluate* its result until
    // after Phase 1 has settled.  This guarantees localSavedAtRef.current is
    // always populated before the stale-server comparison runs, eliminating
    // the race where an early API response bypasses the guard.
    const serverPromise: Promise<Partial<NavPillLayout> | null> = isSignedIn
      ? (async () => {
          try {
            const token = await getToken();
            const res = await fetch(`${BASE}/api/me`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) {
              // Mark for retry — a 5xx or network error is transient; the
              // AppState "active" listener will re-attempt when we foreground.
              phase2FailedRef.current = true;
              return null;
            }
            const data = (await res.json()) as {
              preferences?: { navPillLayout?: Partial<NavPillLayout> };
            };
            return data?.preferences?.navPillLayout ?? null;
          } catch {
            // Network throw (offline, DNS, timeout) — mark for retry.
            phase2FailedRef.current = true;
            return null;
          }
        })()
      : Promise.resolve(null);

    void (async () => {
      // ── Phase 1 — local cache ───────────────────────────────────────────────
      // Await first so localSavedAtRef is settled before Phase 2 comparison.
      const local = await readLocal();
      if (local && !serverHydrated.current) {
        localSavedAtRef.current = local.savedAt;
        setLayout(local);
        track("navpill_rehydrated", {
          source: "asyncstorage",
          order: local.order,
          hidden: local.hidden,
          saved_at: local.savedAt,
        });
        console.log("[NavPill][DIAG] navpill_rehydrated source=asyncstorage order:", local.order, "hidden:", local.hidden, "savedAt:", local.savedAt);
      }

      // ── Phase 2 — server ────────────────────────────────────────────────────
      // Evaluated only after Phase 1 settles — localSavedAtRef is reliable now.
      if (!isSignedIn) return;
      const serverLayout = await serverPromise;
      if (!serverLayout) return;

      // Successful response received — clear the retry flag regardless of the
      // guard outcome below (stale-server skip is not a transient failure).
      phase2FailedRef.current = false;

      const normalized = normalizeLayout(serverLayout);
      const serverSavedAt = normalized.savedAt;
      const localSavedAt = localSavedAtRef.current;

      // Skip if server layout is provably older than the local one.
      // If either timestamp is missing (legacy / first-install), fall through
      // and treat the server as authoritative for backward-compat.
      if (
        serverSavedAt != null &&
        localSavedAt != null &&
        serverSavedAt < localSavedAt
      ) {
        track("navpill_rehydrated", {
          source: "api",
          skipped: true,
          reason: "stale_server",
          server_saved_at: serverSavedAt,
          local_saved_at: localSavedAt,
        });
        console.log(
          "[NavPill][DIAG] navpill_rehydrated source=api SKIPPED (stale server)",
          "serverSavedAt:", serverSavedAt,
          "localSavedAt:", localSavedAt,
        );
        return;
      }

      serverHydrated.current = true;
      localSavedAtRef.current = serverSavedAt;
      setLayout(normalized);
      void writeLocal(normalized);
      track("navpill_rehydrated", {
        source: "api",
        skipped: false,
        order: normalized.order,
        hidden: normalized.hidden,
        saved_at: serverSavedAt,
        local_saved_at: localSavedAt,
      });
      console.log("[NavPill][DIAG] navpill_rehydrated source=api order:", normalized.order, "hidden:", normalized.hidden, "savedAt:", serverSavedAt);
    })();
  }, [isSignedIn]);

  /**
   * Re-runs the Phase 2 server fetch + guard.  Called by the AppState listener
   * when the app returns to the foreground after a previous Phase 2 failure so
   * that a layout saved on another device while this device was offline is
   * applied automatically — without requiring an app restart.
   *
   * Guards:
   *  • No-op if the user is not signed in (nothing to fetch).
   *  • No-op if Phase 2 already succeeded (serverHydrated.current === true).
   */
  const attemptPhase2 = useCallback(async () => {
    if (!isSignedIn || serverHydrated.current) return;
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        phase2FailedRef.current = true;
        return;
      }
      const data = (await res.json()) as {
        preferences?: { navPillLayout?: Partial<NavPillLayout> };
      };
      const serverRaw = data?.preferences?.navPillLayout ?? null;
      // Server has no stored layout — not a transient error; clear the flag.
      if (!serverRaw) {
        phase2FailedRef.current = false;
        return;
      }

      phase2FailedRef.current = false;

      const normalized = normalizeLayout(serverRaw);
      const serverSavedAt = normalized.savedAt;
      const localSavedAt = localSavedAtRef.current;

      if (
        serverSavedAt != null &&
        localSavedAt != null &&
        serverSavedAt < localSavedAt
      ) {
        track("navpill_rehydrated", {
          source: "api_retry",
          skipped: true,
          reason: "stale_server",
          server_saved_at: serverSavedAt,
          local_saved_at: localSavedAt,
        });
        console.log("[NavPill][DIAG] attemptPhase2 retry SKIPPED (stale server) serverSavedAt:", serverSavedAt, "localSavedAt:", localSavedAt);
        return;
      }

      serverHydrated.current = true;
      localSavedAtRef.current = serverSavedAt;
      setLayout(normalized);
      void writeLocal(normalized);
      track("navpill_rehydrated", {
        source: "api_retry",
        skipped: false,
        order: normalized.order,
        hidden: normalized.hidden,
        saved_at: serverSavedAt,
        local_saved_at: localSavedAt,
      });
      console.log("[NavPill][DIAG] attemptPhase2 retry applied order:", normalized.order, "hidden:", normalized.hidden, "savedAt:", serverSavedAt);
    } catch {
      phase2FailedRef.current = true;
      console.log("[NavPill][DIAG] attemptPhase2 retry failed (network error)");
    }
  }, [isSignedIn, getToken]);

  // Re-attempt Phase 2 whenever the app comes to the foreground after a
  // previous transient failure.  This covers the most common recovery path:
  // the user goes offline, saves a layout on another device, then comes back —
  // without killing and restarting the app.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (
        nextState === "active" &&
        phase2FailedRef.current &&
        isSignedIn &&
        !serverHydrated.current
      ) {
        console.log("[NavPill][DIAG] AppState → active, retrying Phase 2 after prior failure");
        void attemptPhase2();
      }
    });
    return () => sub.remove();
  }, [isSignedIn, attemptPhase2]);

  const savePillLayout = useCallback(
    async (order: PillId[], hidden: PillId[]) => {
      console.log("[NavPill][DIAG] savePillLayout entered — order:", order, "hidden:", hidden, "isSignedIn:", isSignedIn);
      // Record so the toast Retry button can replay the same call.
      lastAttemptedLayoutRef.current = { order, hidden };

      // Optimistic local update — advance the ref so Phase 2 knows this
      // timestamp is the authoritative local baseline before the async write.
      const optimisticSavedAt = Date.now();
      const optimisticLayout: NavPillLayout = { order, hidden, savedAt: optimisticSavedAt };
      localSavedAtRef.current = optimisticSavedAt;
      setLayout(optimisticLayout);

      await runSavePillLayout(optimisticLayout, {
        isSignedIn,
        getToken,
        writeLocal,
        patchServer: async (token, layout) => {
          const res = await fetch(`${BASE}/api/me`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ preferences: { navPillLayout: layout } }),
          });
          // Drain body to avoid resource leak on non-ok responses
          if (!res.ok) {
            const errText = await res.text().catch(() => "(unreadable)");
            console.warn("[NavPill][DIAG] savePillLayout: PATCH error body:", errText);
          } else {
            console.log("[NavPill][DIAG] navpill_patch_response status=", res.status, "ok=", res.ok);
          }
          return { ok: res.ok, status: res.status };
        },
        setSaveErrorVisible,
        onSessionExpired: makeSessionExpiredAlert(router),
        track,
        invalidateProfile: () => {
          queryClient.invalidateQueries({ queryKey: ["profile"] });
          console.log("[NavPill][DIAG] navpill_save_complete — profile query invalidated");
        },
      });
    },
    [isSignedIn, getToken, queryClient],
  );

  const resetToDefault = useCallback(async () => {
    await savePillLayout(DEFAULT_LAYOUT.order, DEFAULT_LAYOUT.hidden);
  }, [savePillLayout]);

  return (
    <NavPillContext.Provider
      value={{
        visiblePills: resolveVisiblePills(layout),
        layout,
        isEditMode,
        enterEditMode: () => {
          console.log("[NavPill][DIAG] enterEditMode called → isEditMode true");
          setIsEditMode(true);
        },
        exitEditMode: () => {
          console.log("[NavPill][DIAG] exitEditMode called → isEditMode false");
          setIsEditMode(false);
        },
        savePillLayout,
        resetToDefault,
      }}
    >
      {children}
      <NavSaveErrorToast
        visible={saveErrorVisible}
        onHide={() => setSaveErrorVisible(false)}
        onRetry={
          lastAttemptedLayoutRef.current
            ? () => {
                const { order, hidden } = lastAttemptedLayoutRef.current!;
                void savePillLayout(order, hidden);
              }
            : undefined
        }
      />
    </NavPillContext.Provider>
  );
}

export function useNavPills(): NavPillContextValue {
  const ctx = useContext(NavPillContext);
  if (!ctx) throw new Error("useNavPills must be used within NavPillProvider");
  return ctx;
}
