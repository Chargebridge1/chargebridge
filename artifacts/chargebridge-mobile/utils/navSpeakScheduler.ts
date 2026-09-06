/**
 * navSpeakScheduler.ts
 *
 * Core scheduling logic for the navSpeak forced (a3 / rerouting) path.
 * Extracted so it can be unit-tested with a mocked Speech adapter without
 * mounting the full map.tsx React component.
 *
 * History:
 *   - The original code had a 400 ms utterance-age gate (`shouldInterrupt`).
 *     When a2 fired and began speaking, then a3 fired within the same second,
 *     utteranceAge was typically 0–200 ms — below the gate.  Speech.stop()
 *     was not called, so iOS AVSpeechSynthesizer QUEUED a3 behind a2.
 *     a2 phrases run 3–5 s; at 65 mph that delayed "Turn right" by 100–145 m,
 *     frequently past the turn.
 *   - Fix (Option B): remove the age gate entirely.  Forced calls always call
 *     Speech.stop() regardless of utterance age.  The settle delay is raised
 *     from 80 ms to FORCED_SETTLE_MS (120 ms) to give AVAudioSession enough
 *     time to release cleanly and prevent crackle at the start of the new
 *     utterance.
 */

/**
 * Settle delay (ms) between Speech.stop() and Speech.speak() when a forced
 * announcement interrupts active speech.  Chosen to allow AVAudioSession
 * cleanup without audio crackle while still firing well within the 200 ms
 * dispatch deadline required for a3 timing at highway speeds.
 */
export const FORCED_SETTLE_MS = 120 as const;

/** Ref-bag subset required by scheduleForcedSpeak (matches React ref shapes). */
export interface ForcedSpeakRefs {
  isSpeaking:   { current: boolean };
  routeVersion: { current: number };
  isNavigating: { current: boolean };
  voiceMuted:   { current: boolean };
}

/** Injectable callbacks — lets callers (and tests) supply a Speech adapter. */
export interface ForcedSpeakCallbacks {
  /** Called before Speech.stop() to disarm the TTS watchdog. */
  clearWatchdog(): void;
  /** Called before Speech.speak() to arm the TTS watchdog. */
  armWatchdog(): void;
  /** Calls the platform Speech.stop() (or a test double). */
  stop(): void;
  /** Calls the platform Speech.speak() (or a test double). */
  speak(text: string, opts: object): void;
  /** Builds the SpeechOptions to pass to speak() (rate, pitch, voice…). */
  makeOpts(): object;
  /**
   * Called at the very start of the settle timer callback — before any guard
   * checks — so the caller can clear its timer-ID ref.  This replicates the
   * `speakTimerRef.current = null` that the original inline callback performed,
   * without requiring the scheduler to hold a reference to the caller's ref.
   *
   * Without this, the caller's timer ref stays non-null after the timer fires,
   * causing subsequent non-forced announcements to always take the "pending
   * timer" queue branch and never be dispatched.
   */
  onTimerFired(): void;
}

/**
 * scheduleForcedSpeak — the forced-path core of navSpeak.
 *
 * Guarantees:
 *   1. stop() is called whenever TTS is currently active — no utterance-age gate.
 *   2. speak() fires after FORCED_SETTLE_MS (120 ms) when interrupting,
 *      or after 0 ms when TTS was idle.
 *   3. If isNavigating goes false, voiceMuted goes true, or routeVersion
 *      advances (reroute) during the settle window, speak() is silently dropped.
 *   4. isSpeaking is set false synchronously before the settle timer, so no
 *      concurrent non-forced call can mistake the interrupted utterance as active.
 *
 * @returns settleMs — the actual delay used (0 or FORCED_SETTLE_MS).
 *          Callers store the returned timerId in speakTimerRef.
 */
export function scheduleForcedSpeak(
  text: string,
  capturedRouteVersion: number,
  refs: ForcedSpeakRefs,
  cbs: ForcedSpeakCallbacks,
): { settleMs: number; timerId: ReturnType<typeof setTimeout> } {
  const wasSpeaking = refs.isSpeaking.current;
  if (wasSpeaking) {
    cbs.clearWatchdog();
    try { cbs.stop(); } catch { /* swallow — platform TTS stop is best-effort */ }
    refs.isSpeaking.current = false;
  }

  const settleMs = wasSpeaking ? FORCED_SETTLE_MS : 0;

  const timerId = setTimeout(() => {
    // Notify caller immediately so it can clear its speakTimerRef.  This must
    // be the very first call — before any guard returns — so the ref is null
    // regardless of which exit path the timer takes.  Without it, the timer ref
    // stays non-null after firing and subsequent non-forced announcements always
    // land in the "pending timer" queue branch, stranding them forever.
    cbs.onTimerFired();
    // Guards evaluated inside the timer so changes during settle are respected.
    if (!refs.isNavigating.current || refs.voiceMuted.current) return;
    if (refs.routeVersion.current !== capturedRouteVersion) return; // stale route
    refs.isSpeaking.current = true;
    cbs.armWatchdog();
    try {
      cbs.speak(text, cbs.makeOpts());
    } catch {
      refs.isSpeaking.current = false;
      cbs.clearWatchdog();
    }
  }, settleMs);

  return { settleMs, timerId };
}
