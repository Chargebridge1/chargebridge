// ─────────────────────────────────────────────────────────────────────────────
// Pending route store
//
// When a deep-link URL arrives while the user is not yet authenticated (e.g.
// tapping a station link from a cold-start where Clerk shows the sign-in
// screen), the DeepLinkHandler writes the resolved route here instead of
// calling router.push() (which would be a no-op or redirect to auth).
//
// resolveInitialRoute() reads and clears the value so the auth entry-point
// can navigate directly to the linked screen after sign-in/up completes.
// ─────────────────────────────────────────────────────────────────────────────

let _pending: string | null = null;

/** Store a route to navigate to after the current auth flow completes. */
export function setPendingRoute(route: string): void {
  _pending = route;
}

/**
 * Return the pending route and clear it.
 * Returns null if no pending route was stored.
 */
export function consumePendingRoute(): string | null {
  const r = _pending;
  _pending = null;
  return r;
}
