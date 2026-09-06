/**
 * otaReloadGuard — session-safe OTA reload utility
 *
 * Prevents `Updates.reloadAsync()` from interrupting an active charging session.
 * If a session is in progress the reload is deferred; the caller is notified via
 * `onDeferred` so it can surface a "will install after this session" indicator.
 * When no session is active the reload fires immediately.
 */

export type OTAReloadResult = "reloaded" | "deferred";

export interface OTAReloadGuardDeps {
  /** Whether a charge session is currently active (SessionContext.session !== null). */
  isSessionActive: boolean;
  /** Thin wrapper around Updates.reloadAsync() — injected so tests can mock it. */
  reloadAsync: () => Promise<void>;
  /**
   * Called when the reload is deferred because a session is active.
   * The caller should surface a "Update ready — will install after this session"
   * indicator and schedule a reload once the session ends.
   */
  onDeferred: () => void;
}

/**
 * Attempt a session-safe OTA reload.
 *
 * - When no session is active: calls `reloadAsync()` immediately, returns "reloaded".
 * - When a session is active: calls `onDeferred()`, skips `reloadAsync()`, returns "deferred".
 */
export async function guardedOTAReload({
  isSessionActive,
  reloadAsync,
  onDeferred,
}: OTAReloadGuardDeps): Promise<OTAReloadResult> {
  if (isSessionActive) {
    onDeferred();
    return "deferred";
  }
  await reloadAsync();
  return "reloaded";
}
