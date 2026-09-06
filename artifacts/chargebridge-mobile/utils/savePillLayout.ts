/**
 * Core logic for saving a nav-pill layout, extracted from NavPillProvider so
 * it can be unit-tested without a React rendering environment.
 *
 * All external dependencies are injected as callbacks so tests can mock them
 * without touching module-level mocks.
 */

import { NavPillLayout } from "@/constants/navPills";

export interface SavePillLayoutDeps {
  /** Whether the user is currently signed in to Clerk. */
  isSignedIn: boolean | undefined;
  /** Returns the current Clerk session token, or null if expired. */
  getToken: () => Promise<string | null>;
  /** Persists the layout to AsyncStorage. Returns true on success. */
  writeLocal: (layout: NavPillLayout) => Promise<boolean>;
  /**
   * PATCHes the layout to the server using the provided bearer token.
   * Returns the HTTP response status and ok flag.
   * Throws on network-level errors.
   */
  patchServer: (
    token: string,
    layout: NavPillLayout,
  ) => Promise<{ ok: boolean; status: number }>;
  /**
   * Controls the save-failure toast visibility.
   * Must NEVER be called with `true` when isSignedIn is false —
   * a local-only save is the expected behaviour when signed out.
   */
  setSaveErrorVisible: (visible: boolean) => void;
  /**
   * Called when getToken() returns null (session expired mid-drag).
   * The parent UI should surface a "Sign In Again" action alongside the
   * save-failure toast so the user knows how to recover.
   * Called before setSaveErrorVisible(true).
   */
  onSessionExpired?: () => void;
  /** Tracks a PostHog analytics event. */
  track: (event: string, props: Record<string, unknown>) => void;
  /** Invalidates the TanStack Query "profile" cache after a successful PATCH. */
  invalidateProfile: () => void;
}

export async function runSavePillLayout(
  layout: NavPillLayout,
  deps: SavePillLayoutDeps,
): Promise<void> {
  const {
    isSignedIn,
    getToken,
    writeLocal,
    patchServer,
    setSaveErrorVisible,
    track,
    invalidateProfile,
  } = deps;

  const newLayout = layout;

  // ── [1] navpill_save_started ────────────────────────────────────────────────
  track("navpill_save_started", { order: newLayout.order, hidden: newLayout.hidden, is_signed_in: !!isSignedIn });

  const localOk = await writeLocal(newLayout);

  // ── [2] navpill_asyncstorage_written ────────────────────────────────────────
  track("navpill_asyncstorage_written", { success: localOk });

  // ── Signed-out path: local save only — toast must never fire ────────────────
  if (!isSignedIn) {
    if (localOk) {
      track("navpill_save_complete", { signed_in: false });
    } else {
      track("navpill_save_failed", { stage: "asyncstorage", signed_in: false });
    }
    return;
  }

  // ── Signed-in path: also PATCH the server ──────────────────────────────────
  try {
    const token = await getToken();

    if (!token) {
      track("navpill_save_failed", { stage: "patch", reason: "no_token" });
      deps.onSessionExpired?.();
      setSaveErrorVisible(true);
      return;
    }

    // ── [3] navpill_patch_request ──────────────────────────────────────────────
    track("navpill_patch_request", { token_present: true });

    const patchResult = await patchServer(token, newLayout);

    // ── [4] navpill_patch_response ─────────────────────────────────────────────
    track("navpill_patch_response", {
      status: patchResult.status,
      ok: patchResult.ok,
    });

    if (!patchResult.ok) {
      track("navpill_save_failed", {
        stage: "patch",
        status: patchResult.status,
      });
      setSaveErrorVisible(true);
      return;
    }

    invalidateProfile();

    // ── [5] navpill_save_complete ──────────────────────────────────────────────
    track("navpill_save_complete", { signed_in: true });
  } catch (err) {
    track("navpill_save_failed", {
      stage: "patch",
      error: err instanceof Error ? err.message : String(err),
    });
    setSaveErrorVisible(true);
  }
}
