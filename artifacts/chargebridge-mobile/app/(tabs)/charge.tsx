import React, { useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { WallpaperLayer } from "@/components/WallpaperPicker";
import { router, useFocusEffect } from "expo-router";
import { track } from "@/lib/analytics";
import {
  useSession, useSessionElapsed, fmtElapsedSession,
} from "@/contexts/SessionContext";

// ── Active Session View ───────────────────────────────────────────────────────
// Shown instead of the placeholder when a charging session is live.
// Uses useSessionElapsed in isolation so only this component ticks every second.
function ActiveSessionView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const elapsed = useSessionElapsed();

  if (!session) return null;

  const costDollars = (session.totalCostCents / 100).toFixed(2);

  function handleContinue() {
    const s = session!;
    router.push({
      pathname: "/active-session",
      params: {
        sessionId: s.sessionId,
        stationId: String(s.stationId),
        stationName: s.stationName,
        chargerType: s.chargerType,
        kwh: String(s.targetKwh),
        totalCost: costDollars,
        date: new Date(s.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" } as Intl.DateTimeFormatOptions),
      },
    } as any);
  }

  return (
    <View style={[A.root, { backgroundColor: colors.background }]}>
      <WallpaperLayer tab="charge" />
      <LinearGradient
        colors={[colors.primary + "22", "transparent"]}
        style={A.gradient}
        pointerEvents="none"
      />
      <View style={[A.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}>
        {/* Header */}
        <View style={[A.headerBar, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "35" }]}>
          <View style={[A.liveDot, { backgroundColor: colors.primary }]} />
          <Text style={[A.liveLabel, { color: colors.primary }]}>CHARGING NOW</Text>
        </View>

        {/* Station name */}
        <Text style={[A.stationName, { color: colors.foreground }]} numberOfLines={2}>
          {session.stationName}
        </Text>

        {/* Main metric: kWh delivered */}
        <View style={A.mainMetricWrap}>
          <Text style={[A.mainMetricVal, { color: colors.primary }]}>
            {session.displayKwh.toFixed(2)}
          </Text>
          <Text style={[A.mainMetricUnit, { color: colors.mutedForeground }]}>kWh</Text>
        </View>

        {/* Secondary metrics row */}
        <View style={[A.metricsRow, { borderColor: colors.border }]}>
          <View style={A.metricCell}>
            <Text style={[A.metricVal, { color: colors.foreground }]}>{fmtElapsedSession(elapsed)}</Text>
            <Text style={[A.metricLabel, { color: colors.mutedForeground }]}>Elapsed</Text>
          </View>
          <View style={[A.metricDivider, { backgroundColor: colors.border }]} />
          {session.powerW !== null && session.powerW > 0 ? (
            <View style={A.metricCell}>
              <Text style={[A.metricVal, { color: colors.foreground }]}>
                {(session.powerW / 1000).toFixed(1)} kW
              </Text>
              <Text style={[A.metricLabel, { color: colors.mutedForeground }]}>Live Power</Text>
            </View>
          ) : (
            <View style={A.metricCell}>
              <Text style={[A.metricVal, { color: colors.mutedForeground }]}>—</Text>
              <Text style={[A.metricLabel, { color: colors.mutedForeground }]}>Power</Text>
            </View>
          )}
          <View style={[A.metricDivider, { backgroundColor: colors.border }]} />
          <View style={A.metricCell}>
            <Text style={[A.metricVal, { color: colors.foreground }]}>${costDollars}</Text>
            <Text style={[A.metricLabel, { color: colors.mutedForeground }]}>Cost</Text>
          </View>
        </View>

        {/* Charger type badge */}
        {session.chargerType ? (
          <View style={[A.badge, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30" }]}>
            <Ionicons name="flash" size={12} color={colors.primary} />
            <Text style={[A.badgeTxt, { color: colors.primary }]}>
              {session.chargerType === "DCFC" ? "DC Fast Charging" :
               session.chargerType === "Level2" ? "Level 2 AC" :
               session.chargerType}
            </Text>
          </View>
        ) : null}

        {/* CTAs */}
        <View style={A.actions}>
          <TouchableOpacity
            style={[A.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleContinue}
            accessibilityRole="button"
            accessibilityLabel="Return to active charging session"
          >
            <Ionicons name="flash" size={18} color="#fff" />
            <Text style={A.primaryBtnTxt}>Continue Charging</Text>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.75)" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[A.secondaryBtn, { borderColor: colors.border }]}
            onPress={() => router.navigate("/(tabs)/history" as any)}
            accessibilityRole="button"
            accessibilityLabel="View charging history"
          >
            <Feather name="clock" size={15} color={colors.mutedForeground} />
            <Text style={[A.secondaryBtnTxt, { color: colors.mutedForeground }]}>View History</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── No Session View ───────────────────────────────────────────────────────────
// Original placeholder shown when no session is active.
function NoSessionView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <WallpaperLayer tab="charge" />
      <LinearGradient
        colors={[colors.primary + "18", "transparent"]}
        style={[S.gradient, { paddingTop: insets.top + 24 }]}
        pointerEvents="none"
      />
      <View style={[S.center, { paddingBottom: insets.bottom + 90 }]}>
        <View style={[S.iconRing, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}>
          <View style={[S.iconInner, { backgroundColor: colors.primary + "28" }]}>
            <Feather name="zap" size={38} color={colors.primary} />
          </View>
        </View>
        <Text style={[S.title, { color: colors.foreground }]}>Charge Hub</Text>
        <Text style={[S.body, { color: colors.mutedForeground }]}>
          Find a nearby station and tap it to start a charging session. Live energy delivery and session controls are available on the station detail screen.
        </Text>
        <View style={S.actions}>
          <TouchableOpacity
            style={[S.btn, { backgroundColor: colors.primary }]}
            onPress={() => router.navigate("/(tabs)/map")}
            accessibilityRole="button"
            accessibilityLabel="Find a charger"
          >
            <Feather name="map-pin" size={16} color="#fff" />
            <Text style={S.btnTxt}>Find a Charger</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.btnSecondary, { borderColor: colors.border }]}
            onPress={() => router.navigate("/(tabs)/history" as any)}
            accessibilityRole="button"
            accessibilityLabel="View charging history"
          >
            <Feather name="clock" size={16} color={colors.mutedForeground} />
            <Text style={[S.btnSecondaryTxt, { color: colors.mutedForeground }]}>View History</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function ChargeScreen() {
  const { session } = useSession();
  useFocusEffect(useCallback(() => { track("screen_viewed", { screen_name: "charge" }); }, []));
  if (session) return <ActiveSessionView />;
  return <NoSessionView />;
}

// ── Styles: Active Session ────────────────────────────────────────────────────

const A = StyleSheet.create({
  root: { flex: 1 },
  gradient: { position: "absolute", top: 0, left: 0, right: 0, height: 240 },
  content: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 24, gap: 14,
  },
  headerBar: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveLabel: { fontSize: 11, fontWeight: "800", fontFamily: "Inter_700Bold", letterSpacing: 1 },
  stationName: {
    fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold",
    textAlign: "center", letterSpacing: -0.3, lineHeight: 26,
  },
  mainMetricWrap: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  mainMetricVal: { fontSize: 56, fontWeight: "800", fontFamily: "Inter_700Bold", letterSpacing: -2 },
  mainMetricUnit: { fontSize: 18, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  metricsRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 14, paddingVertical: 14, width: "100%",
  },
  metricCell: { flex: 1, alignItems: "center", gap: 3 },
  metricDivider: { width: 1, height: 28 },
  metricVal: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  badgeTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  actions: { gap: 10, width: "100%", marginTop: 4 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 15, borderRadius: 14,
  },
  primaryBtnTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "700", color: "#fff", flex: 1, textAlign: "center" },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
  secondaryBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});

// ── Styles: No Session ────────────────────────────────────────────────────────

const S = StyleSheet.create({
  root: { flex: 1 },
  gradient: { position: "absolute", top: 0, left: 0, right: 0, height: 220 },
  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 36, gap: 16,
  },
  iconRing: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  iconInner: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "800", fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  actions: { gap: 10, width: "100%", marginTop: 8 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  btnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: "#fff" },
  btnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
  btnSecondaryTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});
