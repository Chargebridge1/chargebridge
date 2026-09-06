/**
 * otaDismissalCooldown — AsyncStorage-backed OTA prompt cooldown
 *
 * When a tester taps "Not now" on the OTA update Alert, we record the
 * dismissal timestamp. Any subsequent checkForUpdate() call within the
 * cooldown window is silently skipped, preventing the Alert from
 * reappearing immediately.
 *
 * Default cooldown: 24 hours (configurable via COOLDOWN_MS).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const OTA_DISMISSAL_KEY = "ota_dismissal_ts";

/** Default cooldown: 24 hours in milliseconds. */
export const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface DismissalState {
  /** Whether the tester is currently within the cooldown window. */
  isCoolingDown: boolean;
  /**
   * Human-readable string describing when the cooldown expires, e.g.
   * "check again after 23h 45m" or null when not cooling down.
   */
  cooldownLabel: string | null;
  /** Unix ms timestamp when the cooldown expires, or null. */
  expiresAt: number | null;
}

/**
 * Record a "Not now" dismissal by persisting the current timestamp.
 * Call this inside the "Not now" onPress handler.
 */
export async function recordOTADismissal(
  nowMs: number = Date.now(),
): Promise<void> {
  await AsyncStorage.setItem(OTA_DISMISSAL_KEY, String(nowMs));
}

/**
 * Clear a previously recorded dismissal (e.g. to allow manual re-check
 * via a "Check now anyway" button).
 */
export async function clearOTADismissal(): Promise<void> {
  await AsyncStorage.removeItem(OTA_DISMISSAL_KEY);
}

/**
 * Returns the current dismissal state: whether we are cooling down and a
 * human-readable label.
 *
 * @param cooldownMs  Cooldown duration in ms (default: 24 h).
 * @param nowMs       Override current time (useful in tests).
 */
export async function getOTADismissalState(
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  nowMs: number = Date.now(),
): Promise<DismissalState> {
  const raw = await AsyncStorage.getItem(OTA_DISMISSAL_KEY);
  if (raw === null) {
    return { isCoolingDown: false, cooldownLabel: null, expiresAt: null };
  }

  const dismissedAt = Number(raw);
  const expiresAt = dismissedAt + cooldownMs;
  const remaining = expiresAt - nowMs;

  if (remaining <= 0) {
    // Cooldown has expired — clean up so we don't keep stale data.
    await AsyncStorage.removeItem(OTA_DISMISSAL_KEY);
    return { isCoolingDown: false, cooldownLabel: null, expiresAt: null };
  }

  return {
    isCoolingDown: true,
    cooldownLabel: formatRemaining(remaining),
    expiresAt,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Format a remaining-milliseconds duration into a short human-readable
 * string, e.g. "23h 45m", "45m", "< 1m".
 */
export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "< 1m";
}
