import * as SecureStore from "expo-secure-store";

export type GuestTokenResult =
  | { token: string; expiresAt?: number; status: "valid" }
  | { token: null; expiresAt?: undefined; status: "absent" | "expired" | "invalid" };

/** Client-side TTL for structured guest tokens (JSON with expiresAt). */
export const GUEST_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

const PLAIN_TOKEN_STALENESS_MS = 48 * 60 * 60 * 1000; // 48 hours (pre-migration plain strings)

function plainTokenFirstSeenKey(sessionId: string | number): string {
  return `guestTokenFirstSeen:${sessionId}`;
}

/**
 * Read a guest token from SecureStore for the given sessionId.
 *
 * Stored value format (since the 72-hour TTL was added):
 *   JSON `{ token: string; expiresAt: number }` — expiresAt is Date.now() + GUEST_TOKEN_TTL_MS.
 * Older entries (pre-migration) may be a plain string token. On first read a companion
 * key (`guestTokenFirstSeen:<sessionId>`) is written with the current timestamp. On
 * subsequent reads the entry is evicted once 48 hours have elapsed from that first
 * read, preventing stale pre-migration tokens from persisting indefinitely.
 *
 * Returns a GuestTokenResult with status:
 *  - "valid"   — token present and not expired; use it
 *  - "expired" — token was stored but its TTL has passed; show expiry message
 *  - "absent"  — no entry in SecureStore (normal for non-guest / already cleaned up)
 *  - "invalid" — entry present but unreadable; treat as absent
 */
export async function getGuestToken(sessionId: string | number): Promise<GuestTokenResult> {
  const raw = await SecureStore.getItemAsync(`guestToken:${sessionId}`);
  if (!raw) return { token: null, status: "absent" };

  try {
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") {
      return { token: null, status: "invalid" };
    }
    if (parsed.expiresAt <= Date.now()) {
      SecureStore.deleteItemAsync(`guestToken:${sessionId}`).catch(() => {});
      return { token: null, status: "expired" };
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt, status: "valid" };
  } catch {
    // Pre-migration plain-string token — apply a 48-hour staleness window.
    if (typeof raw !== "string" || raw.length === 0) {
      return { token: null, status: "invalid" };
    }

    const firstSeenKey = plainTokenFirstSeenKey(sessionId);
    const firstSeenRaw = await SecureStore.getItemAsync(firstSeenKey).catch(() => null);

    if (firstSeenRaw === null) {
      // First time this token has been read — record the timestamp and return it.
      SecureStore.setItemAsync(firstSeenKey, String(Date.now())).catch(() => {});
      return { token: raw, status: "valid" };
    }

    const firstSeen = Number(firstSeenRaw);
    if (!Number.isFinite(firstSeen) || Date.now() - firstSeen >= PLAIN_TOKEN_STALENESS_MS) {
      // 48 hours have elapsed (or the timestamp is corrupt) — evict both keys.
      SecureStore.deleteItemAsync(`guestToken:${sessionId}`).catch(() => {});
      SecureStore.deleteItemAsync(firstSeenKey).catch(() => {});
      return { token: null, status: "expired" };
    }

    return { token: raw, status: "valid" };
  }
}

/**
 * Persist a guest token to SecureStore with a 72-hour client-side TTL.
 *
 * TTL is CLIENT-SIDE ONLY. The server performs a SHA-256 hash comparison and has
 * no expiry concept — a valid hash always works. The 72-hour local TTL is purely
 * a self-cleanup guard; on force-quit recovery getGuestToken will delete the entry
 * and return status "expired" so the caller can show an actionable message.
 */
export async function setGuestToken(sessionId: string | number, token: string): Promise<void> {
  const expiresAt = Date.now() + GUEST_TOKEN_TTL_MS;
  try {
    await SecureStore.setItemAsync(
      `guestToken:${sessionId}`,
      JSON.stringify({ token, expiresAt }),
    );
  } catch (err) {
    // Write failed — remove any stale entry that may exist for this session so
    // cold-start recovery doesn't find an old token and produce a confusing auth
    // error. Also remove the companion first-seen key in case a pre-migration
    // plain-string token had already been read and recorded it. The caller is
    // responsible for warning the user.
    SecureStore.deleteItemAsync(`guestToken:${sessionId}`).catch(() => {});
    SecureStore.deleteItemAsync(plainTokenFirstSeenKey(sessionId)).catch(() => {});
    throw err;
  }
}

/**
 * Remove a guest token from SecureStore (e.g. after the session ends).
 * Also removes the companion first-seen key written for pre-migration plain-string entries.
 */
export function deleteGuestToken(sessionId: string | number): void {
  SecureStore.deleteItemAsync(`guestToken:${sessionId}`).catch(() => {});
  SecureStore.deleteItemAsync(plainTokenFirstSeenKey(sessionId)).catch(() => {});
}
