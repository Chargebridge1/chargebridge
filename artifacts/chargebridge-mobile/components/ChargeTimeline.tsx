import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";

export type StepState = "pending" | "active" | "complete" | "error";

export interface TimelineStepDef {
  id: string;
  label: string;
  sublabel?: string;
  state: StepState;
}

function PulsingDot() {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.4, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 2 - scale.value,
  }));
  return (
    <View style={S.activeIconOuter}>
      <Animated.View style={[S.activePulseRing, style]} />
      <View style={S.activeDot} />
    </View>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "complete") {
    return (
      <View style={S.completeIcon}>
        <Text style={S.checkMark}>✓</Text>
      </View>
    );
  }
  if (state === "active") {
    return <PulsingDot />;
  }
  if (state === "error") {
    return (
      <View style={S.errorIcon}>
        <Text style={S.errorMark}>✕</Text>
      </View>
    );
  }
  return <View style={S.pendingIcon} />;
}

interface ChargeTimelineProps {
  steps: TimelineStepDef[];
  errorMessage?: string | null;
  onRetry?: () => void;
  recoveryNote?: string;
  tintColor?: string;
}

export default function ChargeTimeline({
  steps,
  errorMessage,
  onRetry,
  recoveryNote,
  tintColor = "#0D9E7E",
}: ChargeTimelineProps) {
  return (
    <View style={S.root}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <View key={step.id} style={S.row}>
            <View style={S.iconCol}>
              <StepIcon state={step.state} />
              {!isLast && (
                <View
                  style={[
                    S.connector,
                    { backgroundColor: step.state === "complete" ? "#22c55e" : "#e2e8f0" },
                  ]}
                />
              )}
            </View>
            <View style={[S.labelCol, isLast && { paddingBottom: 0 }]}>
              <Text
                style={[
                  S.label,
                  step.state === "complete"
                    ? { color: "#16a34a" }
                    : step.state === "active"
                      ? { color: "#0f172a" }
                      : step.state === "error"
                        ? { color: "#dc2626" }
                        : { color: "#94a3b8" },
                ]}
              >
                {step.label}
              </Text>
              {step.sublabel != null && step.state !== "pending" && (
                <Text style={S.sublabel}>{step.sublabel}</Text>
              )}
              {step.state === "active" && step.sublabel == null && (
                <Text style={[S.sublabel, { color: tintColor }]}>In progress…</Text>
              )}
            </View>
          </View>
        );
      })}

      {errorMessage != null && (
        <View style={S.errorBox}>
          <Text style={S.errorText}>{errorMessage}</Text>
          {recoveryNote != null && (
            <Text style={S.recoveryNote}>{recoveryNote}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { paddingVertical: 4 },
  row: { flexDirection: "row", gap: 12 },
  iconCol: { alignItems: "center", width: 28 },
  labelCol: { flex: 1, paddingBottom: 20 },
  connector: { width: 2, flex: 1, marginVertical: 4, borderRadius: 1, minHeight: 16 },

  completeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "800" },

  activeIconOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D9E7E18",
    borderWidth: 2,
    borderColor: "#0D9E7E",
  },
  activePulseRing: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#0D9E7E60",
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0D9E7E",
  },

  errorIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },
  errorMark: { color: "#fff", fontSize: 13, fontWeight: "800" },

  pendingIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#cbd5e1",
    backgroundColor: "transparent",
  },

  label: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  sublabel: { fontSize: 12, color: "#64748b", marginTop: 2 },

  errorBox: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fef2f2",
    padding: 14,
    gap: 6,
  },
  errorText: { fontSize: 13, color: "#dc2626", fontWeight: "600" },
  recoveryNote: { fontSize: 12, color: "#64748b" },
});
