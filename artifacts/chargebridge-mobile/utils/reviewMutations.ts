/**
 * Core mutation logic for update-review, extracted from ProfileTab so it
 * can be unit-tested without a React rendering environment.
 *
 * All external dependencies are injected as callbacks so tests can mock them
 * without touching module-level mocks.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewData {
  rating: number;
  comment: string | null;
}

export interface UpdateReviewDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Performs the PATCH /api/reviews/:id request. Receives the bearer token,
   * review id, and update data; throws on non-OK responses with an Error
   * whose message is the API's `error` field.
   */
  patchReview: (token: string, id: number, data: ReviewData) => Promise<unknown>;
  /** Called when the review is successfully updated. */
  onSuccess: () => void;
  /**
   * Called with the thrown Error on failure. This is where the caller shows
   * Alert.alert — kept outside the utility so tests don't need to mock RN.
   */
  onError: (err: Error) => void;
  /**
   * Called when getToken() returns null (session expired). The parent UI
   * should replace the primary CTA with a "Sign In Again" action so the
   * button is never permanently broken. Called before onError.
   */
  onSessionExpired?: () => void;
  /** Optional analytics tracker. */
  track?: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Runs the update-review mutation.
 *
 * - If `getToken()` returns null, calls `onSessionExpired` then `onError` with
 *   a session-expired message without touching the network.
 * - If `getToken()` throws, routes the error through `onError`.
 * - If the PATCH succeeds, calls `onSuccess`.
 * - Any other error (network, API 4xx/5xx) is routed through `onError`.
 * - The edit-form state is intentionally NOT managed here; callers must only
 *   close the form inside `onSuccess` so the user can retry after a failure.
 */
export async function runUpdateReview(
  id: number,
  data: ReviewData,
  deps: UpdateReviewDeps,
): Promise<void> {
  const { getToken, patchReview, onSuccess, onError, track } = deps;

  track?.("profile_editreview_started", { review_id: id });

  let token: string | null = null;
  try {
    token = await getToken();
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    track?.("profile_editreview_token_error", { error: msg });
    onError(tokenErr instanceof Error ? tokenErr : new Error(msg));
    return;
  }

  track?.("profile_editreview_token_result", { token_present: !!token });

  if (!token) {
    track?.("profile_editreview_no_token", {});
    deps.onSessionExpired?.();
    onError(
      new Error(
        "Your session has expired. Please sign in again to save your review.",
      ),
    );
    return;
  }

  try {
    await patchReview(token, id, data);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    track?.("profile_editreview_failed", { error: e.message });
    onError(e);
    return;
  }

  track?.("profile_editreview_complete", { review_id: id });
  onSuccess();
}
