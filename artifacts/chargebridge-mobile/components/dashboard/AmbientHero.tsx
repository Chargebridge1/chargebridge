import React, { useEffect, memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import {
  Duration,
  HeroMorph,
  chargingPulseDuration,
  chargingGlowOpacity,
  Glow,
} from "@/constants/motion";
import { useSessionElapsed, fmtElapsedSession } from "@/contexts/SessionContext";
import type { ActiveSessionData } from "@/contexts/SessionContext";

// ── Ambient colour tokens ─────────────────────────────────────────────────────
const A = {
  teal: "#2DD4BF",
  textPrimary: "rgba(255,255,255,0.90)",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",
  glassBg: "rgba(255,255,255,0.08)",
  glassBorder: "rgba(255,255,255,0.10)",
  success: "#34D399",
};

// ── Vehicle silhouette ────────────────────────────────────────────────────────
const VehicleSilhouette = memo(function VehicleSilhouette() {
  return (
    <Svg width={160} height={46} viewBox="0 0 140 40" fill="none">
      <Path
        d="M15 30 L22 18 C 24 14, 30 10, 35 10 L75 10 C 85 10, 95 12, 105 16 L125 24 C 128 26, 130 28, 130 30"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={30} cy={30} r={6} stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
      <Circle cx={110} cy={30} r={6} stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
      <Path
        d="M10 30 L24 30 M36 30 L104 30 M116 30 L135 30"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
});

// ── Connected dot (animated) ──────────────────────────────────────────────────
const ConnectedDot = memo(function ConnectedDot() {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: Duration.pulse / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: Duration.pulse / 2, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);
  const s = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: A.teal }, s]} />
  );
});

// ── Adaptive pulse ring ───────────────────────────────────────────────────────
const AdaptivePulseRing = memo(function AdaptivePulseRing({
  size,
  powerW,
  isCharging,
}: {
  size: number;
  powerW: number | null;
  isCharging: boolean;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(isCharging ? 0.6 : 0.5);

  useEffect(() => {
    const dur = isCharging
      ? chargingPulseDuration(powerW ? powerW / 1000 : null)
      : Duration.pulse;
    cancelAnimation(scale);
    cancelAnimation(opacity);
    scale.value = 1;
    opacity.value = isCharging ? 0.6 : 0.5;
    scale.value = withRepeat(
      withTiming(1.45, { duration: dur, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: dur, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [isCharging, powerW]);

  const ringSize = size + 40;
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: isCharging ? 2 : 1.5,
          borderColor: A.teal,
        },
        animStyle,
      ]}
      pointerEvents="none"
    />
  );
});

// ── Charging content — memo'd to isolate 1-second elapsed re-renders ──────────
// INVARIANT (synchronization governance): useSessionElapsed() must only ever
// live in this component. Do not move it to AmbientHero or DashboardScreen.
const AmbientHeroCharging = memo(function AmbientHeroCharging({
  session,
}: {
  session: ActiveSessionData;
}) {
  const elapsed = useSessionElapsed();
  const powerKw = session.powerW != null ? session.powerW / 1000 : null;

  return (
    <View style={CS.root}>
      <Text style={CS.stationName} numberOfLines={1}>{session.stationName}</Text>

      <View style={CS.metricWrap}>
        <AdaptivePulseRing size={80} powerW={session.powerW} isCharging />
        <Text style={CS.kwhNumber}>
          {session.displayKwh.toFixed(2)}
        </Text>
        <Text style={CS.kwhUnit}>kWh delivered</Text>
      </View>

      <View style={CS.secondaryRow}>
        {powerKw !== null && powerKw > 0 && (
          <View style={CS.pill}>
            <Ionicons name="flash" size={13} color={A.teal} />
            <Text style={CS.pillText}>{powerKw.toFixed(1)} kW</Text>
          </View>
        )}
        <View style={CS.pill}>
          <Ionicons name="time-outline" size={13} color={A.textSecondary} />
          <Text style={CS.pillText}>{fmtElapsedSession(elapsed)}</Text>
        </View>
        <View style={CS.pill}>
          <Text style={CS.pillText}>{session.chargerType}</Text>
        </View>
      </View>
    </View>
  );
});

const CS = StyleSheet.create({
  root: { alignItems: "center" },
  stationName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.textSecondary,
    letterSpacing: 0.2,
    marginBottom: 16,
    textAlign: "center",
    maxWidth: 260,
  },
  metricWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    height: 120,
  },
  kwhNumber: {
    fontSize: 72,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: -2,
  },
  kwhUnit: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.teal,
    marginTop: 2,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: A.glassBg,
    borderWidth: 1,
    borderColor: A.glassBorder,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.textPrimary,
  },
});

// ── Complete state content ────────────────────────────────────────────────────
const AmbientHeroComplete = memo(function AmbientHeroComplete({
  session,
}: {
  session: ActiveSessionData;
}) {
  const durationSecs = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
  const costDollars = (session.totalCostCents / 100).toFixed(2);

  return (
    <View style={CC.root}>
      <View style={CC.badge} accessible accessibilityRole="text" accessibilityLabel="Session complete">
        <Ionicons name="checkmark-circle" size={36} color={A.success} />
        <Text style={CC.badgeText}>Session Complete</Text>
      </View>

      <View
        style={CC.metricsRow}
        accessible
        accessibilityLabel={`${session.displayKwh.toFixed(2)} kilowatt hours added, $${costDollars} estimated cost, ${fmtElapsedSession(durationSecs)} duration`}
      >
        <View style={CC.metric}>
          <Text style={CC.metricVal}>{session.displayKwh.toFixed(2)}</Text>
          <Text style={CC.metricLabel}>kWh added</Text>
        </View>
        <View style={CC.divider} />
        <View style={CC.metric}>
          <Text style={CC.metricVal}>${costDollars}</Text>
          <Text style={CC.metricLabel}>estimated</Text>
        </View>
        <View style={CC.divider} />
        <View style={CC.metric}>
          <Text style={CC.metricVal}>{fmtElapsedSession(durationSecs)}</Text>
          <Text style={CC.metricLabel}>duration</Text>
        </View>
      </View>

      <Text style={CC.stationName} numberOfLines={1}>{session.stationName}</Text>
    </View>
  );
});

const CC = StyleSheet.create({
  root: { alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 22,
  },
  badgeText: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: A.success,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    backgroundColor: A.glassBg,
    borderWidth: 1,
    borderColor: A.glassBorder,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    marginBottom: 14,
  },
  metric: { alignItems: "center", gap: 3 },
  metricVal: {
    fontSize: 18,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    color: A.textPrimary,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: A.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  divider: { width: 1, height: 28, backgroundColor: A.glassBorder },
  stationName: {
    fontSize: 12,
    color: A.textMuted,
    fontFamily: "Inter_400Regular",
  },
});

// ── Hero props ────────────────────────────────────────────────────────────────
export interface AmbientHeroProps {
  batteryPercent: number | null;
  vehicleName: string;
  estimatedRangeMi: number | null;
  topInset: number;
  onUpdateBattery: () => void;
  state?: "idle" | "charging" | "complete";
  session?: ActiveSessionData | null;
  completedSession?: ActiveSessionData | null;
}

// ── Main component ────────────────────────────────────────────────────────────
export const AmbientHero = memo(function AmbientHero({
  batteryPercent,
  vehicleName,
  estimatedRangeMi,
  topInset,
  onUpdateBattery,
  state = "idle",
  session,
  completedSession,
}: AmbientHeroProps) {
  const { height: screenHeight } = useWindowDimensions();
  // Hero occupies 48% of screen height. Min 320, max 420 to cover all devices.
  const HERO_HEIGHT = Math.min(Math.max(screenHeight * 0.48, 320), 420);

  const pct = batteryPercent ?? 0;
  const powerW = session?.powerW ?? null;

  // ── State cross-fade ──
  const idleOpacity = useSharedValue(1);
  const chargingOpacity = useSharedValue(0);
  const completeOpacity = useSharedValue(0);

  useEffect(() => {
    const dur = HeroMorph.contentFadeDuration;
    const t = { idle: [1, 0, 0], charging: [0, 1, 0], complete: [0, 0, 1] }[state];
    idleOpacity.value = withTiming(t[0], { duration: dur });
    chargingOpacity.value = withTiming(t[1], { duration: dur });
    completeOpacity.value = withTiming(t[2], { duration: dur });
  }, [state]);

  const idleStyle = useAnimatedStyle(() => ({ opacity: idleOpacity.value }));
  const chargingStyle = useAnimatedStyle(() => ({ opacity: chargingOpacity.value }));
  const completeStyle = useAnimatedStyle(() => ({ opacity: completeOpacity.value }));

  // Glow intensity tracks session power
  const glowOpacity = state === "charging"
    ? chargingGlowOpacity(powerW ? powerW / 1000 : null)
    : Glow.opacity.idle;
  const glowStart = state === "complete"
    ? `rgba(52,211,153,${Math.min(glowOpacity + 0.08, 0.55)})`
    : `rgba(45,212,191,${Math.min(glowOpacity + 0.06, 0.55)})`;
  const glowMid = state === "complete"
    ? `rgba(52,211,153,${glowOpacity * 0.35})`
    : `rgba(45,212,191,${glowOpacity * 0.35})`;

  return (
    <View style={{ height: HERO_HEIGHT }}>
      {/* ── Radial glow (absolute, behind everything) ── */}
      <View style={[S.glowWrap, { top: topInset }]} pointerEvents="none">
        <LinearGradient
          colors={[glowStart, glowMid, "transparent"]}
          style={S.glow}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>

      {/* ── IDLE STATE ── */}
      <Animated.View
        style={[S.layer, { paddingTop: topInset + 14 }, idleStyle]}
        pointerEvents={state === "idle" ? "auto" : "none"}
      >
        <Text style={S.vehicleName} numberOfLines={1}>{vehicleName}</Text>

        <View style={S.silhouetteWrap}>
          <VehicleSilhouette />
        </View>

        <View
          style={S.connectedPill}
          accessible
          accessibilityRole="text"
          accessibilityLabel="Connected — live data"
        >
          <ConnectedDot />
          <Text style={S.connectedText}>Connected · Live data</Text>
        </View>

        <View
          style={S.batteryWrap}
          accessible
          accessibilityRole="text"
          accessibilityLabel={
            batteryPercent != null
              ? `Battery ${pct} percent${estimatedRangeMi ? `, ${estimatedRangeMi} miles estimated range` : ""}`
              : "Battery level unknown. Tap to update."
          }
        >
          <AdaptivePulseRing size={110} powerW={null} isCharging={false} />
          <TouchableOpacity onPress={onUpdateBattery} activeOpacity={0.8}>
            <Text style={S.batteryNumber}>
              {batteryPercent != null ? String(pct) : "–"}
              {batteryPercent != null && <Text style={S.batterySymbol}>%</Text>}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={S.pillsRow}>
          {estimatedRangeMi != null ? (
            <View style={S.pill}>
              <Ionicons name="flash" size={13} color={A.teal} />
              <Text style={S.pillText}>{estimatedRangeMi} mi range</Text>
            </View>
          ) : (
            <TouchableOpacity style={S.pill} onPress={onUpdateBattery}>
              <Ionicons name="battery-half-outline" size={13} color={A.textMuted} />
              <Text style={[S.pillText, { color: A.textMuted }]}>Tap to set battery</Text>
            </TouchableOpacity>
          )}
          <View style={S.pill}>
            <Text style={S.pillText}>72°F battery</Text>
          </View>
        </View>
      </Animated.View>

      {/* ── CHARGING STATE ── */}
      <Animated.View
        style={[S.layer, { paddingTop: topInset + 24 }, chargingStyle]}
        pointerEvents={state === "charging" ? "auto" : "none"}
      >
        {session ? (
          <AmbientHeroCharging session={session} />
        ) : (
          <Text style={S.vehicleName}>Connecting…</Text>
        )}
      </Animated.View>

      {/* ── COMPLETE STATE ── */}
      <Animated.View
        style={[S.layer, { paddingTop: topInset + 28 }, completeStyle]}
        pointerEvents={state === "complete" ? "auto" : "none"}
      >
        {completedSession && <AmbientHeroComplete session={completedSession} />}
      </Animated.View>
    </View>
  );
});

const S = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  glowWrap: {
    position: "absolute",
    left: "50%" as any,
    marginLeft: -130,
    width: 260,
    alignItems: "center",
  },
  glow: {
    width: 260,
    height: 220,
    borderRadius: 130,
  },
  vehicleName: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.textPrimary,
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  silhouetteWrap: {
    marginBottom: 12,
  },
  connectedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: A.glassBg,
    borderWidth: 1,
    borderColor: A.glassBorder,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 22,
  },
  connectedText: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.textSecondary,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  batteryWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  batteryNumber: {
    fontSize: 100,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: -4,
    lineHeight: 108,
  },
  batterySymbol: {
    fontSize: 52,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 0,
  },
  pillsRow: {
    flexDirection: "row",
    gap: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: A.glassBg,
    borderWidth: 1,
    borderColor: A.glassBorder,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: A.textPrimary,
  },
});
