/**
 * NavDebugOverlay.tsx
 *
 * Build #212: extended for the voice-timing-delay investigation.
 *
 * Toggled by long-pressing the voice mute button in the turn-by-turn banner.
 * Polls refs every 500 ms — zero re-render pressure on the GPS handler.
 * Zero native dependencies, zero file I/O, zero async teardown calls.
 *
 * KEY METRIC FOR THE INVESTIGATION
 * ─────────────────────────────────
 *   since_navSpeak = ms from navSpeak() call to Speech.speak() dispatch.
 *
 *   • Small  (<250 ms) → delay is PRE-navSpeak()  — zone threshold fires too late.
 *   • Large  (>500 ms) → delay is POST-navSpeak() — TTS scheduling / settle delay.
 *
 * One highway drive with this overlay visible answers the original question.
 * Remove this file once the root cause is confirmed and fixed.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { navStepThreshold } from '@/utils/navSpeedThreshold';
import { navOffRouteThreshold } from '@/utils/navOffRouteThreshold';

export interface NavDebugOverlayProps {
  visible: boolean;
  /** Current GPS speed in m/s — updated each GPS tick. */
  speedMsRef:           React.MutableRefObject<number>;
  /** Active transport mode — used to derive isWalking / isCycling. */
  navModeRef:           React.MutableRefObject<'driving' | 'walking' | 'transit' | 'cycling'>;
  /** Consecutive GPS readings currently exceeding the off-route distance. */
  offRouteCountRef:     React.MutableRefObject<number>;
  /** Wall-clock ms when the most recent reroute was triggered (0 = never). */
  lastRecalcTimeRef:    React.MutableRefObject<number>;
  /** Adaptive sensitivity multiplier (1.0 = default). */
  recalcSensitivityRef: React.MutableRefObject<number>;
  /** Text and timestamp of the most recent navSpeak call. */
  lastNavSpeakRef:      React.MutableRefObject<{ text: string; timeMs: number }>;

  // ── Timing-investigation refs (Build #212) ────────────────────────────────
  /** ms — age of the GPS fix at the moment _posHandler fired. */
  posAgeRef:            React.MutableRefObject<number>;
  /** ms — wall-clock gap between consecutive _posHandler calls. */
  gpsIntervalRef:       React.MutableRefObject<number>;
  /** m  — current arc distToNextM (result of routeArcDistM). */
  distRef:              React.MutableRefObject<number>;
  /** m  — arc distToNextM from the previous GPS tick (for delta display). */
  distPrevRef:          React.MutableRefObject<number>;
  /** m  — haversine straight-line distance to the next step. */
  straightRef:          React.MutableRefObject<number>;
  /** Last voice zone that fired: "a1", "a2", "a3", or "—". */
  lastZoneRef:          React.MutableRefObject<string>;
  /** ms from navSpeak() call to Speech.speak() dispatch. Null until first speak. */
  sinceNavSpeakRef:     React.MutableRefObject<number | null>;
  /** ms from navSpeak() call to ttsOnDone. Null until first completion. */
  ttsElapsedRef:        React.MutableRefObject<number | null>;
}

interface DebugSnapshot {
  speedMph:           number;
  bucket:             string;
  stepThresholdM:     number;
  posAgeMs:           number;
  intervalMs:         number;
  distM:              number;
  distPrevM:          number;
  straightM:          number;
  lastZone:           string;
  offDistM:           number;
  offCountCurrent:    number;
  offCountNeeded:     number;
  cooldownRemainingS: number | null;
  sensitivity:        number;
  lastSpeakText:      string;
  lastSpeakAgoMs:     number | null;
  sinceNavSpeakMs:    number | null;
  ttsElapsedMs:       number | null;
}

function buildSnapshot(props: NavDebugOverlayProps): DebugSnapshot {
  const speedMs   = Math.max(0, props.speedMsRef.current);
  const mode      = props.navModeRef.current;
  const isWalking = mode === 'walking';
  const isCycling = mode === 'cycling';
  const speedMph  = Math.round(speedMs * 2.237);

  const bucket =
    isWalking        ? 'walking'
    : isCycling      ? 'cycling'
    : speedMph > 50  ? 'highway (>50 mph)'
    : speedMph > 30  ? 'arterial (>30 mph)'
    : speedMph > 15  ? 'residential (>15 mph)'
    :                  'slow / stop';

  const stepThresholdM = navStepThreshold(speedMs);
  const { offDistM, offCount: offCountNeeded, offCooldown } = navOffRouteThreshold(
    speedMs, isWalking, isCycling, props.recalcSensitivityRef.current,
  );

  const now          = Date.now();
  const lastRecalcMs = props.lastRecalcTimeRef.current;
  const cooldownRemainingS = lastRecalcMs === 0
    ? null
    : Math.max(0, Math.round((lastRecalcMs + offCooldown - now) / 1000));

  const lastSpeak = props.lastNavSpeakRef.current;

  return {
    speedMph,
    bucket,
    stepThresholdM,
    posAgeMs:        props.posAgeRef.current,
    intervalMs:      props.gpsIntervalRef.current,
    distM:           props.distRef.current,
    distPrevM:       props.distPrevRef.current,
    straightM:       props.straightRef.current,
    lastZone:        props.lastZoneRef.current,
    offDistM,
    offCountCurrent: props.offRouteCountRef.current,
    offCountNeeded,
    cooldownRemainingS,
    sensitivity:     props.recalcSensitivityRef.current,
    lastSpeakText:   lastSpeak.text,
    lastSpeakAgoMs:  lastSpeak.timeMs > 0 ? now - lastSpeak.timeMs : null,
    sinceNavSpeakMs: props.sinceNavSpeakRef.current,
    ttsElapsedMs:    props.ttsElapsedRef.current,
  };
}

export function NavDebugOverlay(props: NavDebugOverlayProps) {
  const [snap, setSnap] = useState<DebugSnapshot>(() => buildSnapshot(props));

  useEffect(() => {
    if (!props.visible) return;
    // Immediate refresh on show so values aren't stale from a prior session.
    setSnap(buildSnapshot(props));
    const id = setInterval(() => setSnap(buildSnapshot(props)), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);

  if (!props.visible) return null;

  const cooldownStr =
    snap.cooldownRemainingS == null  ? '—'
    : snap.cooldownRemainingS > 0    ? `${snap.cooldownRemainingS} s remaining`
    :                                  'ready';
  const cooldownActive = snap.cooldownRemainingS != null && snap.cooldownRemainingS > 0;

  const lastSpeakStr = snap.lastSpeakText
    ? snap.lastSpeakAgoMs != null
      ? `"${snap.lastSpeakText.slice(0, 26)}" · ${(snap.lastSpeakAgoMs / 1000).toFixed(1)} s ago`
      : `"${snap.lastSpeakText.slice(0, 26)}"`
    : '—';

  const distDelta = snap.distPrevM >= 0
    ? `  Δ${snap.distM - snap.distPrevM >= 0 ? '+' : ''}${snap.distM - snap.distPrevM}m`
    : '';

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.header}>⚙ Nav Debug  (long-press mute to hide)</Text>

      <Divider />
      <Text style={styles.section}>GPS</Text>
      <Row label="posAge"   value={`${snap.posAgeMs} ms`}   highlight={snap.posAgeMs > 500} />
      <Row label="interval" value={`${snap.intervalMs} ms`} highlight={snap.intervalMs > 2000} />
      <Row label="speed"    value={`${snap.speedMph} mph  ·  ${snap.bucket}`} />

      <Divider />
      <Text style={styles.section}>Route</Text>
      <Row label="distToNext (arc)" value={`${snap.distM} m${distDelta}`} />
      <Row label="straight-line"    value={`${snap.straightM} m`} />
      <Row label="step threshold"   value={`${snap.stepThresholdM} m`} />

      <Divider />
      <Text style={styles.section}>Off-route</Text>
      <Row label="off-route dist"   value={`${snap.offDistM} m  (sens ×${snap.sensitivity.toFixed(2)})`} />
      <Row label="off-route count"  value={`${snap.offCountCurrent} / ${snap.offCountNeeded}`} highlight={snap.offCountCurrent > 0} />
      <Row label="reroute cooldown" value={cooldownStr} highlight={cooldownActive} />

      <Divider />
      <Text style={styles.section}>Voice  ← investigation</Text>
      <Row label="last zone"   value={snap.lastZone} />
      <Row label="last speak"  value={lastSpeakStr} />
      <Row
        label="since navSpeak"
        value={snap.sinceNavSpeakMs != null ? `${snap.sinceNavSpeakMs} ms` : '—'}
        highlight={snap.sinceNavSpeakMs != null && snap.sinceNavSpeakMs > 400}
      />
      <Row
        label="ttsOnDone elapsed"
        value={snap.ttsElapsedMs != null ? `${(snap.ttsElapsedMs / 1000).toFixed(1)} s` : '—'}
      />
    </View>
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, highlight ? styles.valueHighlight : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 140,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(10,15,25,0.92)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 9999,
    gap: 2,
  },
  header: {
    color: '#00ff88',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
    letterSpacing: 0.4,
  },
  section: {
    color: '#475569',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 0,
    width: 120,
  },
  value: {
    color: '#f1f5f9',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },
  valueHighlight: {
    color: '#fbbf24',
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 2,
  },
});
