import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  dispatchToCompletionMs,
  navSpeakToDispatchMs,
  type NavEvidenceCaptureRecord,
  type NavEvidenceCaptureState,
} from "@/utils/navEvidenceCapture";

interface NavEvidenceCapturePanelProps {
  capture: NavEvidenceCaptureState;
  onArm: () => void;
}

function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatOptionalNumber(value: number | null, digits = 0): string {
  return value == null ? "—" : formatNumber(value, digits);
}

function timingValue(
  timestampMs: number | null,
  baselineMs: number,
): string {
  return timestampMs == null ? "—" : `${timestampMs} (${timestampMs - baselineMs} ms)`;
}

function durationValue(value: number | null): string {
  return value == null ? "—" : `${value} ms`;
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function EvidenceRecord({ record }: { record: NavEvidenceCaptureRecord }) {
  const colors = useColors();
  return (
    <View style={[styles.record, { borderTopColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.primary }]}>a3 capture · immutable</Text>
      <EvidenceRow label="GPS timestamp" value={String(record.gpsTimestampMs)} />
      <EvidenceRow label="GPS received" value={String(record.gpsReceivedAtMs)} />
      <EvidenceRow label="GPS age / interval" value={`${record.gpsFixAgeMs} / ${record.gpsIntervalMs} ms`} />
      <EvidenceRow label="GPS lat / lon" value={`${formatNumber(record.latitude, 6)}, ${formatNumber(record.longitude, 6)}`} />
      <EvidenceRow label="Accuracy / speed" value={`${formatOptionalNumber(record.accuracyM, 1)} m / ${formatOptionalNumber(record.speedMs, 2)} m/s`} />
      <EvidenceRow label="Maneuver instruction" value={record.maneuverInstruction} />
      <EvidenceRow label="Vehicle dist at navSpeak" value={`${formatNumber(record.routeArcDistanceM, 1)} m`} />
      <EvidenceRow label="routeArcDistM" value={`${formatNumber(record.routeArcDistanceM, 1)} m`} />
      <EvidenceRow label="Straight-line distance" value={`${formatNumber(record.straightDistanceM, 1)} m`} />
      <EvidenceRow label="Maneuver lat / lon" value={`${formatNumber(record.maneuverLatitude, 6)}, ${formatNumber(record.maneuverLongitude, 6)}`} />
      <EvidenceRow label="Step / route / zone" value={`${record.stepIndex} / ${record.routeVersion} / ${record.zone}`} />
      <EvidenceRow label="navSpeak" value={String(record.navSpeakAtMs)} />
      <EvidenceRow label="TTS dispatch" value={timingValue(record.ttsDispatchAtMs, record.navSpeakAtMs)} />
      <EvidenceRow label="navSpeak→dispatch" value={durationValue(navSpeakToDispatchMs(record))} />
      <EvidenceRow label="TTS terminal timestamp" value={String(record.ttsCompletedAtMs ?? "—")} />
      <EvidenceRow label="dispatch→completion" value={durationValue(dispatchToCompletionMs(record))} />
      <EvidenceRow label="TTS outcome" value={record.ttsOutcome ?? "pending"} />
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Dispatch timing is app-level only; Expo Speech does not expose audible-onset timing.
      </Text>
    </View>
  );
}

export function NavEvidenceCapturePanel({ capture, onArm }: NavEvidenceCapturePanelProps) {
  const colors = useColors();
  const disabled = capture.armed || capture.record != null;
  const buttonLabel = capture.armed
    ? "Capture armed — waiting for a3"
    : capture.record
      ? "One a3 capture recorded"
      : "Capture next a3";

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Navigation evidence</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        One armed maneuver capture for this navigation session.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        activeOpacity={0.8}
        disabled={disabled}
        onPress={onArm}
        style={[
          styles.button,
          { backgroundColor: disabled ? colors.muted : colors.primary },
        ]}
      >
        <Text style={[styles.buttonText, { color: disabled ? colors.mutedForeground : colors.primaryForeground }]}>
          {buttonLabel}
        </Text>
      </TouchableOpacity>
      {capture.record ? <EvidenceRecord record={capture.record} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    maxWidth: 370,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    alignItems: "center",
    borderRadius: 9,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  record: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    marginTop: 4,
    paddingTop: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  label: {
    flexShrink: 0,
    fontSize: 11,
  },
  value: {
    flex: 1,
    fontSize: 11,
    textAlign: "right",
  },
  note: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
});