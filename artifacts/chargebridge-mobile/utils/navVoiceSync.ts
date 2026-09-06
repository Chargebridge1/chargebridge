/**
 * navVoiceSync.ts
 *
 * Utility for syncing background-notification state into the foreground's
 * voice-dedup ref when the app returns to the active state mid-route.
 *
 * Problem:
 *   Both the background task (backgroundNav.ts) and the foreground-while-
 *   inactive path (map.tsx) fire push notifications for upcoming maneuvers via
 *   showTurnNotification().  When the user re-opens the app, the foreground GPS
 *   handler evaluates the same step from scratch and calls Speech.speak() with
 *   the same instruction — the user hears the turn twice.
 *
 * Fix:
 *   Each notification emitter adds the step index to navState.notifiedStepIndices
 *   only after showTurnNotification() resolves successfully.  On every
 *   background→active transition, syncBgNotifiedIntoVoiceAnnounced() stamps only
 *   those exact indices in voiceAnnouncedRef so the foreground voice guards skip
 *   them.  Steps that were skipped by a background multi-step jump, or where the
 *   notification call failed, are never suppressed.
 */

const ZONES = ["a1", "a2", "a3", "turn"] as const;

/**
 * Marks all voice-announcement zones (a1 / a2 / a3 / turn) for each step
 * index in `notifiedStepIndices` in the provided voiceAnnouncedRef.
 *
 * Only the exact steps recorded in the set are stamped — steps skipped by a
 * background multi-step advance or where the notification failed are untouched.
 *
 * Idempotent: safe to call multiple times with the same or overlapping sets.
 *
 * @param notifiedStepIndices  navState.notifiedStepIndices — the set of step
 *   indices for which showTurnNotification() resolved successfully.  Pass an
 *   empty Set (the initial value) to no-op.
 * @param voiceAnnouncedRef    The foreground's voiceAnnouncedRef from map.tsx,
 *   keyed by step index, valued by a Set<string> of fired zone names.
 */
export function syncBgNotifiedIntoVoiceAnnounced(
  notifiedStepIndices: Set<number>,
  voiceAnnouncedRef: { current: Record<number, Set<string>> },
): void {
  if (notifiedStepIndices.size === 0) return;

  for (const si of notifiedStepIndices) {
    if (!voiceAnnouncedRef.current[si]) {
      voiceAnnouncedRef.current[si] = new Set<string>();
    }
    const zones = voiceAnnouncedRef.current[si];
    for (const z of ZONES) {
      zones.add(z);
    }
  }
}
