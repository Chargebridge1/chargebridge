import React, { useState, useMemo, memo, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Linking, Platform,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { track } from "@/lib/analytics";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useUser } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useUnits } from "@/hooks/useUnits";
import { useButtonConfigs } from "@/hooks/useButtonConfigs";
import { usePrimaryVehicle } from "@/hooks/usePrimaryVehicle";
import { useBatteryState } from "@/hooks/useBatteryState";
import { AddStationModal } from "@/components/AddStationModal";
import { MapModal } from "@/components/MapModal";
import { ChargeNowModal } from "@/components/ChargeNowModal";
import { MembershipModal } from "@/components/MembershipModal";
import { FleetModal } from "@/components/FleetModal";
import { SettingsModal } from "@/components/SettingsModal";
import { AllTabsWallpaperPicker } from "@/components/WallpaperPicker";
import { SmartRecommendationCard } from "@/components/dashboard/SmartRecommendationCard";
import { NearbyStationCard } from "@/components/dashboard/NearbyStationCard";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { QuickActionsRow } from "@/components/dashboard/QuickActionsRow";
import { BatterySliderSheet } from "@/components/dashboard/BatterySliderSheet";
import { AmbientHero } from "@/components/dashboard/AmbientHero";
import { Typography } from "@/components/ui";
import { useSession, useSessionElapsed, fmtElapsedSession } from "@/contexts/SessionContext";
import type { ActiveSessionData } from "@/contexts/SessionContext";
import { AmbientThemeProvider } from "@/contexts/AmbientTheme";
import { ambientDark } from "@/constants/colors";
import { Glass } from "@/constants/motion";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type DashboardStats = {
  totalStations: number; availableStations: number;
  busyStations: number; offlineStations: number;
  totalDcfc: number; totalLevel2: number; totalLevel1: number;
  averageRating: number; totalReviews: number; favoritesCount: number;
};

// ── Active Session Banner ─────────────────────────────────────────────────────
// Renders at the top of the frosted-glass content panel when a charging
// session is live. Self-reads useSession() so no session prop is drilled
// through ContentPanel. ActiveSessionCardInner is memo'd to confine the
// 1-second useSessionElapsed re-renders (synchronization governance rule).

const TEAL = "#2DD4BF";

const ActiveSessionCardInner = memo(function ActiveSessionCardInner({
  session,
}: {
  session: ActiveSessionData;
}) {
  const elapsed = useSessionElapsed();
  const powerKw = session.powerW != null ? session.powerW / 1000 : null;

  return (
    <TouchableOpacity
      style={AS.card}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        router.push("/active-session" as any);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Active charging session at ${session.stationName}, ${session.displayKwh.toFixed(2)} kWh delivered. Tap to open session controls.`}
    >
      {/* Header: live indicator + station name */}
      <View style={AS.header}>
        <View style={AS.liveDot} />
        <Text style={AS.liveLabel}>Charging in Progress</Text>
        <View style={{ flex: 1 }} />
        <Text style={AS.stationName} numberOfLines={1}>{session.stationName}</Text>
      </View>

      {/* Metrics row */}
      <View style={AS.metricsRow}>
        <View style={AS.metric}>
          <Text style={AS.metricVal}>{session.displayKwh.toFixed(2)}</Text>
          <Text style={AS.metricLabel}>kWh</Text>
        </View>
        <View style={AS.divider} />
        {powerKw !== null && powerKw > 0 && (
          <>
            <View style={AS.metric}>
              <Text style={AS.metricVal}>{powerKw.toFixed(1)}</Text>
              <Text style={AS.metricLabel}>kW</Text>
            </View>
            <View style={AS.divider} />
          </>
        )}
        <View style={AS.metric}>
          <Text style={AS.metricVal}>{fmtElapsedSession(elapsed)}</Text>
          <Text style={AS.metricLabel}>elapsed</Text>
        </View>
      </View>

      {/* Resume CTA */}
      <View style={AS.cta}>
        <Ionicons name="flash" size={14} color="#fff" />
        <Text style={AS.ctaText}>Resume Session</Text>
        <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.75)" />
      </View>
    </TouchableOpacity>
  );
});

function ActiveSessionBanner() {
  const { session } = useSession();
  if (!session) return null;
  return <ActiveSessionCardInner session={session} />;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { units, toggleUnits } = useUnits();
  useFocusEffect(useCallback(() => { track("screen_viewed", { screen_name: "home" }); }, []));
  const { user } = useUser();
  const vehicle = usePrimaryVehicle();
  const { batteryPercent, setBatteryPercent } = useBatteryState();

  // ── Session state → hero state machine ───────────────────────────────────
  // All live session reads go through useSession() per the synchronization
  // invariant. No screen-local session state is permitted.
  const { session } = useSession();
  const prevSessionRef = useRef<ActiveSessionData | null>(null);
  const [completedSession, setCompletedSession] = useState<ActiveSessionData | null>(null);

  const heroState: "idle" | "charging" | "complete" = session
    ? "charging"
    : completedSession
      ? "complete"
      : "idle";

  useEffect(() => {
    if (!session && prevSessionRef.current) {
      // Session just ended — surface the Complete state for 10 seconds
      const last = prevSessionRef.current;
      prevSessionRef.current = null;
      setCompletedSession(last);
      const timer = setTimeout(() => setCompletedSession(null), 10_000);
      return () => clearTimeout(timer);
    }
    if (session) {
      prevSessionRef.current = session;
    }
  }, [session]);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showChargeNow, setShowChargeNow] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showMembership, setShowMembership] = useState(false);
  const [showFleet, setShowFleet] = useState(false);
  const [batterySheetOpen, setBatterySheetOpen] = useState(false);

  const { data: btnCfgs } = useButtonConfigs();
  const isBtnEnabled = (key: string) => {
    if (!btnCfgs) return true;
    return btnCfgs.find((c) => c.key === key)?.enabled ?? true;
  };

  const { data: stats, isRefetching, refetch } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetch(`${BASE}/api/stats`).then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Vehicle data ──────────────────────────────────────────────────────────
  const vehicleName = vehicle
    ? (vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`)
    : "My Vehicle";

  const estimatedRangeMi = useMemo(() => {
    if (batteryPercent == null || vehicle?.rangePerCharge == null) return null;
    return Math.round((batteryPercent / 100) * vehicle.rangePerCharge);
  }, [batteryPercent, vehicle?.rangePerCharge]);

  // ── Quick actions ─────────────────────────────────────────────────────────
  const PRIMARY_ACTIONS = useMemo(() => [
    { icon: "flash" as const,              label: "Find Charger",  color: colors.primary,  onPress: () => router.navigate("/(tabs)") },
    { icon: "flash-outline" as const,      label: "Start Charging",color: colors.warning,  onPress: () => setShowChargeNow(true) },
    { icon: "time-outline" as const,       label: "History",       color: colors.info,     onPress: () => router.navigate("/(tabs)/history" as any) },
    { icon: "add-circle-outline" as const, label: "Add Station",   color: "#8b5cf6",       onPress: () => setShowAdd(true) },
  ], [colors.primary, colors.warning, colors.info]);

  const ALL_SECONDARY = [
    { key: "mobile_dashboard_find_nearby",    icon: "flash" as const,                  lib: "ion",     label: "Find Nearby",   sub: "EV stations near you",       color: colors.primary,  onPress: () => router.navigate("/(tabs)") },
    { key: "mobile_dashboard_explore",        icon: "search" as const,                 lib: "feather", label: "Explore",       sub: "Search by city or zip",      color: colors.info,     onPress: () => router.navigate("/(tabs)/explore") },
    { key: "mobile_dashboard_live_map",       icon: "map" as const,                    lib: "feather", label: "Live Map",      sub: "All stations on map",        color: "#0ea5e9",       onPress: () => setShowMap(true) },
    { key: "mobile_dashboard_gas_prices",     icon: "car-outline" as const,            lib: "ion",     label: "Gas Prices",    sub: "Community fuel prices",      color: colors.success,  onPress: () => router.navigate("/(tabs)/gas") },
    { key: "mobile_dashboard_membership",     icon: "diamond-outline" as const,        lib: "ion",     label: "Membership",    sub: "Plans & pricing",            color: "#a855f7",       onPress: () => setShowMembership(true) },
    { key: "mobile_dashboard_fleet",          icon: "car-outline" as const,            lib: "ion",     label: "Fleet Manager", sub: "Vehicles & drivers",         color: "#6366f1",       onPress: () => setShowFleet(true) },
    { key: "mobile_dashboard_invoices",       icon: "document-text-outline" as const,  lib: "ion",     label: "Invoices",      sub: "Billing & receipts",         color: "#0891b2",       onPress: () => router.navigate("/(tabs)/invoices") },
    { key: "mobile_dashboard_saved",          icon: "heart-outline" as const,          lib: "ion",     label: "Saved",         sub: "Favourite stations",         color: "#e11d48",       onPress: () => router.navigate("/(tabs)/favorites") },
    { key: "mobile_dashboard_trip_planner",   icon: "navigate-outline" as const,       lib: "ion",     label: "Trip Planner",  sub: "Plan charging stops",        color: "#0891b2",       onPress: () => router.push("/trip-planner" as any) },
    { key: "mobile_dashboard_ev_guides",      icon: "book-outline" as const,           lib: "ion",     label: "EV Guides",     sub: "Charging tips & how-tos",    color: "#7c3aed",       onPress: () => router.push("/guides" as any) },
    { key: "mobile_dashboard_networks",       icon: "git-network-outline" as const,    lib: "ion",     label: "Networks",      sub: "Major charging networks",    color: colors.primary,  onPress: () => router.push("/networks" as any) },
    {
      key: "mobile_dashboard_change_wallpaper", icon: "color-palette-outline" as const, lib: "ion",   label: "Wallpaper",     sub: "Change all tab themes",      color: "#6d28d9",
      onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setGlobalPickerOpen(true); },
    },
    {
      key: "mobile_dashboard_app_reviews", icon: "star-outline" as const, lib: "ion", label: "App Reviews", sub: "What drivers say", color: "#ec4899",
      onPress: () => {
        const url = Platform.select({ ios: "https://apps.apple.com/search?term=ChargeBridge+EV", android: "https://play.google.com/store/search?q=ChargeBridge&c=apps", default: "https://chargebridgeapp.com" });
        if (url) Linking.openURL(url);
      },
    },
  ].filter((a) => isBtnEnabled(a.key));

  const secRows: typeof ALL_SECONDARY[] = [];
  for (let i = 0; i < ALL_SECONDARY.length; i += 2) secRows.push(ALL_SECONDARY.slice(i, i + 2));

  return (
    <View style={S.root}>
      {/* ── Ambient dark gradient background ── */}
      <LinearGradient
        colors={[ambientDark.bgDeep, ambientDark.bgMid, ambientDark.bgDark]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* ── Ambient Hero — drives Idle / Charging / Complete state machine ── */}
      <AmbientHero
        batteryPercent={batteryPercent}
        vehicleName={vehicleName}
        estimatedRangeMi={estimatedRangeMi}
        topInset={insets.top}
        onUpdateBattery={() => setBatterySheetOpen(true)}
        state={heroState}
        session={session}
        completedSession={completedSession}
      />

      {/* ── Frosted glass content panel — AmbientThemeProvider forces dark
          palette for all Cards/Surfaces inside regardless of system setting ── */}
      <AmbientThemeProvider>
      <View style={S.panelWrap}>
        {Platform.OS === "ios" ? (
          <BlurView intensity={22} tint="dark" style={S.panelBlur}>
            <ContentPanel
              insets={insets}
              isRefetching={isRefetching}
              refetch={refetch}
              batteryPercent={batteryPercent}
              vehicle={vehicle}
              PRIMARY_ACTIONS={PRIMARY_ACTIONS}
              secRows={secRows}
              setBatterySheetOpen={setBatterySheetOpen}
              colors={colors}
              units={units}
              toggleUnits={toggleUnits}
              setShowMap={setShowMap}
              setSettingsOpen={setSettingsOpen}
            />
          </BlurView>
        ) : (
          <View style={[S.panelBlur, S.androidPanel]}>
            <ContentPanel
              insets={insets}
              isRefetching={isRefetching}
              refetch={refetch}
              batteryPercent={batteryPercent}
              vehicle={vehicle}
              PRIMARY_ACTIONS={PRIMARY_ACTIONS}
              secRows={secRows}
              setBatterySheetOpen={setBatterySheetOpen}
              colors={colors}
              units={units}
              toggleUnits={toggleUnits}
              setShowMap={setShowMap}
              setSettingsOpen={setSettingsOpen}
            />
          </View>
        )}
      </View>

      </AmbientThemeProvider>

      {/* ── Modals (all preserved from Build 191) ── */}
      <AllTabsWallpaperPicker visible={globalPickerOpen} onClose={() => setGlobalPickerOpen(false)} />
      <BatterySliderSheet visible={batterySheetOpen} current={batteryPercent} onSet={setBatteryPercent} onClose={() => setBatterySheetOpen(false)} />
      <SettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AddStationModal visible={showAdd} onClose={() => setShowAdd(false)} onAdded={() => refetch()} />
      <ChargeNowModal visible={showChargeNow} onClose={() => setShowChargeNow(false)} />
      <MapModal visible={showMap} onClose={() => setShowMap(false)} />
      <MembershipModal visible={showMembership} onClose={() => setShowMembership(false)} />
      <FleetModal visible={showFleet} onClose={() => setShowFleet(false)} />
    </View>
  );
}

// ── Content panel — extracted to avoid duplication across iOS/Android branches
function ContentPanel({
  insets,
  isRefetching,
  refetch,
  batteryPercent,
  vehicle,
  PRIMARY_ACTIONS,
  secRows,
  setBatterySheetOpen,
  colors,
  units,
  toggleUnits,
  setShowMap,
  setSettingsOpen,
}: any) {
  return (
    <View style={S.panelInner}>
      <View style={S.dragHandle} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={ambientDark.teal} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Panel header shortcuts */}
        <View style={S.panelHeader}>
          <TouchableOpacity
            style={S.headerBtn}
            onPress={() => { Haptics.selectionAsync(); toggleUnits(); }}
            accessibilityRole="button"
            accessibilityLabel={`Switch units, currently ${units}`}
          >
            <Feather name="compass" size={12} color={ambientDark.textSecondary} />
            <Text style={S.headerBtnText}>{units}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={S.headerBtn} onPress={() => setShowMap(true)} accessibilityRole="button" accessibilityLabel="Open map">
            <Feather name="map" size={14} color={ambientDark.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={S.headerBtn} onPress={() => setSettingsOpen(true)} accessibilityRole="button" accessibilityLabel="Open settings">
            <Feather name="settings" size={14} color={ambientDark.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Active session card — shown at top when a session is live */}
        <ActiveSessionBanner />

        {/* Smart recommendation */}
        <SmartRecommendationCard
          batteryPercent={batteryPercent}
          onSetBattery={() => setBatterySheetOpen(true)}
        />

        {/* Nearby charging */}
        <NearbyStationCard
          batteryPercent={batteryPercent}
          batteryKwh={vehicle?.batteryKwh ?? null}
        />

        {/* Quick actions */}
        <QuickActionsRow actions={PRIMARY_ACTIONS} />

        {/* Recent activity */}
        <RecentActivityCard />

        {/* More actions */}
        {secRows.length > 0 && (
          <>
            <Typography
              variant="label"
              color={ambientDark.textMuted}
              style={{ marginLeft: 16, marginTop: 8, marginBottom: 10 }}
            >
              More
            </Typography>
            {secRows.map((row: any[], ri: number) => (
              <View key={ri} style={S.secRow}>
                {row.map((a: any) => (
                  <TouchableOpacity
                    key={a.key}
                    style={[S.secCard, { backgroundColor: a.color }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); a.onPress(); }}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.label}: ${a.sub}`}
                  >
                    <View style={S.secIconWrap}>
                      {a.lib === "ion"
                        ? <Ionicons name={a.icon as any} size={22} color="#fff" />
                        : <Feather name={a.icon as any} size={20} color="#fff" />}
                    </View>
                    <Typography variant="callout" color="#fff" style={{ fontWeight: "700" }}>{a.label}</Typography>
                    <Typography variant="caption" color="rgba(255,255,255,0.75)">{a.sub}</Typography>
                  </TouchableOpacity>
                ))}
                {row.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D1117" },
  panelWrap: { flex: 1, marginTop: -28 },
  panelBlur: {
    flex: 1,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderColor: `rgba(255,255,255,${Glass.borderOpacity})`,
  },
  androidPanel: { backgroundColor: "rgba(10,22,40,0.94)" },
  panelInner: {
    flex: 1,
    backgroundColor: `rgba(255,255,255,${Glass.backgroundOpacity})`,
  },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: `rgba(255,255,255,${Glass.handleOpacity})`,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  headerBtnText: {
    fontSize: 11,
    color: ambientDark.textSecondary,
    fontFamily: "Inter_600SemiBold",
  },
  secRow: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginBottom: 10 },
  secCard: { flex: 1, borderRadius: 16, padding: 14, gap: 3 },
  secIconWrap: { marginBottom: 4 },
});

const AS = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 18,
    backgroundColor: "rgba(45,212,191,0.10)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.30)",
    overflow: "hidden",
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
  },
  liveLabel: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stationName: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.55)",
    flexShrink: 1,
    textAlign: "right",
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  metric: {
    flex: 1,
    alignItems: "center",
  },
  metricVal: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: -0.5,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 4,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.2,
  },
});
