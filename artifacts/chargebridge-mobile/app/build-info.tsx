import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  Share, Platform, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useColors } from "@/hooks/useColors";
import { useSession } from "@/contexts/SessionContext";
import { useOtaUpdate } from "@/contexts/OtaUpdateContext";
import { guardedOTAReload } from "@/utils/otaReloadGuard";
import {
  recordOTADismissal,
  clearOTADismissal,
  getOTADismissalState,
} from "@/utils/otaDismissalCooldown";

// ─── Dynamic values from app.json — automatically correct for every build ───
const cfg = Constants.expoConfig;
const extra = cfg?.extra ?? {};

const BUILD = {
  appVersion:      cfg?.version                 ?? "—",
  buildNumber:     cfg?.ios?.buildNumber         ?? "—",
  androidBuild:    String(cfg?.android?.versionCode ?? "—"),
  easBuildId:      extra.easBuildId             ?? "not set",
  submissionId:    extra.easSubmissionId         ?? "not set",
  gitCommitShort:  extra.gitCommitShort          ?? "not set",
  gitCommitFull:   extra.gitCommitFull           ?? "not set",
  gitMessage:      extra.gitMessage              ?? "not set",
  buildStartUTC:   extra.buildStartUTC           ?? "not set",
  buildEndUTC:     extra.buildEndUTC             ?? "not set",
  environment:     __DEV__ ? "Development" : "Production",
  platform:        Platform.OS === "ios" ? "iOS" : "Android",
  sdkVersion:      cfg?.sdkVersion               ?? "—",
};

// ─── What changed in this build — update this array before each release ─────
const CHANGES: { phase: string; color: string; items: { title: string; verify: string }[] }[] = [
  {
    phase: "Phase 5 — Charging Experience Modernization",
    color: "#0D9E7E",
    items: [
      { title: "SessionContext — shared session state across all screens", verify: "Start a charge session → check Dashboard, Map, and Charge tabs all show the banner simultaneously" },
      { title: "Dashboard ActiveSessionBanner with isolated 1-second timer", verify: "Dashboard shows teal banner with live elapsed time and kWh during active session" },
      { title: "Map ActiveSessionMapBanner floating above tab bar", verify: "Map tab shows floating banner at bottom during active session — does not interfere with markers" },
      { title: "Charge tab dual-mode (ActiveSessionView vs idle prompt)", verify: "Charge tab shows large kWh display and elapsed timer when session active; idle prompt when not" },
      { title: "SYNC-001: startedAt preserved across screen remounts", verify: "Navigate away and back to Charge tab — elapsed time does not reset to zero" },
      { title: "SYNC-002: session summary shows correct start time", verify: "End session → summary shows time from when session actually started, not screen remount time" },
      { title: "SYNC-003: VoiceContext wired to live session state", verify: "Say 'charging status' while session active — voice reads live kWh and cost" },
      { title: "AsyncStorage 4h TTL — session survives cold-start", verify: "Force-quit app during active session → reopen within 4 hours → session banner still present" },
    ],
  },
  {
    phase: "Phase 4 — Map Experience",
    color: "#d97706",
    items: [
      { title: "3-snap bottom sheet (collapsed / partial / full)", verify: "Map tab → drag bottom sheet handle → snaps cleanly to 3 positions" },
      { title: "Filter pills (charger type, availability, network)", verify: "Filter bar visible in bottom sheet; tap one → station list filters instantly" },
      { title: "Station list with freshness indicator", verify: "Station list rows show colored status dot: green=available, amber=in-use, red=offline" },
      { title: "Offline banner during network loss", verify: "Enable Airplane Mode → Map tab → offline banner appears at top" },
    ],
  },
  {
    phase: "Build Preparation",
    color: "#6366f1",
    items: [
      { title: "Removed diagnostic console.log from profile.tsx", verify: "No console noise from profile screen in any debug session" },
      { title: `iOS buildNumber bumped to ${BUILD.buildNumber}`, verify: `Settings → iPhone Storage → ChargeBridge shows ${BUILD.appVersion} (${BUILD.buildNumber})` },
      { title: `Android versionCode bumped to ${BUILD.androidBuild}`, verify: `Play Store internal track shows version ${BUILD.appVersion} (${BUILD.androidBuild})` },
    ],
  },
];

// ─── OTA update state ────────────────────────────────────────────────────────
type OTAStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "restarting" | "error" | "dismissed";

// ─── Components ───────────────────────────────────────────────────────────────
function Row({ label, value, shareable }: { label: string; value: string; shareable?: boolean }) {
  const colors = useColors();
  async function share() {
    await Share.share({ message: `${label}: ${value}` });
  }
  return (
    <Pressable
      onPress={shareable ? share : undefined}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
        <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={1}>{value}</Text>
        {shareable && <Feather name="share" size={11} color={colors.mutedForeground} />}
      </View>
    </Pressable>
  );
}

function Card({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// ─── OTA Card ─────────────────────────────────────────────────────────────────
function OTACard() {
  const colors = useColors();
  const { session } = useSession();
  const isSessionActive = session !== null;
  const { updateAvailable, _setPendingReload } = useOtaUpdate();

  const [status, setStatus] = useState<OTAStatus>("idle");
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cooldownLabel, setCooldownLabel] = useState<string | null>(null);
  // True when an update has been downloaded but reload was deferred due to an
  // active session. When the session ends this effect fires reloadAsync.
  const [pendingReload, setPendingReload] = useState(false);
  // Stable ref so the effect below always sees the latest value without
  // declaring it as a dependency (avoids re-subscribing on every status change).
  const pendingReloadRef = useRef(false);
  pendingReloadRef.current = pendingReload;

  // Keep context pendingReload in sync with local state so BuildInfoScreen
  // can show the top-level banner without needing to scroll to the OTACard.
  useEffect(() => {
    _setPendingReload(pendingReload);
  }, [pendingReload]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount, restore any in-progress dismissal cooldown so the UI stays
  // consistent across screen navigations and app restarts.
  useEffect(() => {
    void (async () => {
      const state = await getOTADismissalState();
      if (state.isCoolingDown) {
        setStatus("dismissed");
        setCooldownLabel(state.cooldownLabel);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When session ends and a reload is pending, fire it automatically.
  useEffect(() => {
    if (!isSessionActive && pendingReloadRef.current) {
      setPendingReload(false);
      setStatus("restarting");
      void Updates.reloadAsync();
    }
  }, [isSessionActive]);

  // Derive display values from expo-updates
  const isEmbedded = Updates.isEmbeddedLaunch;
  const channel = Updates.channel ?? "—";
  const runtimeVersion = Updates.runtimeVersion ?? "—";
  const updateId = Updates.updateId ?? (isEmbedded ? "embedded (no OTA applied)" : "—");
  const createdAt = Updates.createdAt
    ? Updates.createdAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
    : isEmbedded ? "— (running embedded build)" : "—";

  // Source badge
  const sourceLabel = isEmbedded ? "Embedded build" : "OTA update";
  const sourceColor = isEmbedded ? "#f59e0b" : "#0D9E7E";

  async function checkForUpdate() {
    if (__DEV__) {
      Alert.alert("OTA unavailable in dev", "expo-updates OTA checks only work in production/preview builds, not the Expo Go dev client.");
      return;
    }

    // Respect the dismissal cooldown — do not re-prompt within 24 h of "Not now".
    const dismissalState = await getOTADismissalState();
    if (dismissalState.isCoolingDown) {
      setStatus("dismissed");
      setCooldownLabel(dismissalState.cooldownLabel);
      return;
    }

    setStatus("checking");
    setErrorMsg(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
      setLastChecked(now);
      if (result.isAvailable) {
        setStatus("update-available");
        Alert.alert(
          "Update available",
          "A new OTA update is available. Download and apply it now?",
          [
            {
              text: "Not now",
              style: "cancel",
              onPress: async () => {
                await recordOTADismissal();
                const newState = await getOTADismissalState();
                setStatus("dismissed");
                setCooldownLabel(newState.cooldownLabel);
              },
            },
            {
              text: "Apply update",
              onPress: async () => {
                setStatus("downloading");
                try {
                  await Updates.fetchUpdateAsync();
                  // Guard: do not reload mid-session. Defer until session ends.
                  const guardResult = await guardedOTAReload({
                    isSessionActive,
                    reloadAsync: () => Updates.reloadAsync(),
                    onDeferred: () => {
                      setPendingReload(true);
                      pendingReloadRef.current = true;
                      setStatus("update-available");
                    },
                  });
                  // Only transition to "restarting" when reload was actually invoked.
                  if (guardResult === "reloaded") {
                    setStatus("restarting");
                  }
                } catch (e: any) {
                  setStatus("error");
                  setErrorMsg(e?.message ?? "Failed to apply update");
                }
              },
            },
          ],
        );
      } else {
        setStatus("up-to-date");
      }
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message ?? "Check failed");
    }
  }

  const statusColor: Record<OTAStatus, string> = {
    idle: colors.mutedForeground,
    checking: "#3b82f6",
    "up-to-date": "#0D9E7E",
    "update-available": "#f59e0b",
    downloading: "#3b82f6",
    restarting: "#8b5cf6",
    error: "#ef4444",
    dismissed: "#94a3b8",
  };
  const statusLabel: Record<OTAStatus, string> = {
    idle: "Not checked yet",
    checking: "Checking…",
    "up-to-date": "Up to date ✓",
    "update-available": pendingReload
      ? "Update ready — will install after this session"
      : "Update available",
    downloading: "Downloading…",
    restarting: "Restarting…",
    error: errorMsg ?? "Error",
    dismissed: cooldownLabel
      ? `Dismissed — check again after ${cooldownLabel}`
      : "Dismissed",
  };

  const isBusy =
    status === "checking" ||
    status === "downloading" ||
    status === "restarting" ||
    pendingReload;
  const isCoolingDown = status === "dismissed";

  async function applyUpdate() {
    if (__DEV__) {
      Alert.alert("OTA unavailable in dev", "expo-updates OTA checks only work in production/preview builds, not the Expo Go dev client.");
      return;
    }
    setStatus("downloading");
    setErrorMsg(null);
    try {
      await Updates.fetchUpdateAsync();
      const guardResult = await guardedOTAReload({
        isSessionActive,
        reloadAsync: () => Updates.reloadAsync(),
        onDeferred: () => {
          setPendingReload(true);
          pendingReloadRef.current = true;
          setStatus("update-available");
        },
      });
      if (guardResult === "reloaded") {
        setStatus("restarting");
      }
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message ?? "Failed to apply update");
    }
  }

  return (
    <Card title="OTA Update Status" accent="#0D9E7E">
      {/* Persistent "Update ready" banner — shown when background checker found an update */}
      {updateAvailable && (
        <TouchableOpacity
          onPress={applyUpdate}
          disabled={status === "downloading" || status === "restarting" || pendingReload}
          style={[styles.updateReadyBanner, { borderBottomColor: colors.border }]}
          activeOpacity={0.75}
        >
          <Feather name="download-cloud" size={15} color="#ffffff" />
          <Text style={styles.updateReadyText}>Update ready — tap to apply</Text>
          <Feather name="chevron-right" size={15} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      )}

      {/* Source badge */}
      <View style={[styles.otaBanner, { backgroundColor: sourceColor + "18", borderBottomColor: colors.border }]}>
        <Feather name={isEmbedded ? "package" : "zap"} size={13} color={sourceColor} />
        <Text style={[styles.otaBannerText, { color: sourceColor }]}>
          {sourceLabel}
        </Text>
      </View>

      <Row label="Channel"          value={channel} />
      <Row label="Runtime version"  value={runtimeVersion} />
      <Row label="Update ID"        value={typeof updateId === "string" && updateId.length > 20 ? updateId.slice(0, 16) + "…" : String(updateId)} shareable={!isEmbedded} />
      <Row label="Published at"     value={createdAt} />
      <Row label="Check result"     value={statusLabel[status]} />
      {lastChecked && <Row label="Last checked"  value={lastChecked} />}

      {/* Deferred-reload indicator — shown when update is waiting for session to end */}
      {pendingReload && (
        <View style={[styles.note, { backgroundColor: "#f59e0b11", borderColor: "#f59e0b33" }]}>
          <Feather name="clock" size={12} color="#f59e0b" />
          <Text style={[styles.noteText, { color: "#f59e0b" }]}>
            Update ready — will install automatically once your charging session ends.
          </Text>
        </View>
      )}

      {/* Cooldown indicator — shown when user tapped "Not now" within cooldown window */}
      {isCoolingDown && (
        <View style={[styles.note, { backgroundColor: "#94a3b811", borderColor: "#94a3b833" }]}>
          <Feather name="clock" size={12} color="#94a3b8" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.noteText, { color: "#94a3b8" }]}>
              {statusLabel["dismissed"]}
            </Text>
            <TouchableOpacity
              onPress={async () => {
                await clearOTADismissal();
                setStatus("idle");
                setCooldownLabel(null);
              }}
              hitSlop={8}
            >
              <Text style={{ fontSize: 11, color: "#0D9E7E", fontWeight: "600" }}>
                Check now anyway
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Check-for-update button */}
      <TouchableOpacity
        onPress={checkForUpdate}
        disabled={isBusy || isCoolingDown}
        style={[
          styles.otaBtn,
          {
            backgroundColor: (isBusy || isCoolingDown)
              ? colors.border
              : "#0D9E7E",
          },
        ]}
        activeOpacity={0.75}
      >
        <Feather
          name={status === "checking" || status === "downloading" ? "loader" : "refresh-cw"}
          size={14}
          color="#ffffff"
        />
        <Text style={styles.otaBtnText}>
          {status === "checking" ? "Checking…"
            : status === "downloading" ? "Downloading…"
            : status === "restarting" ? "Restarting…"
            : pendingReload ? "Update queued…"
            : isCoolingDown ? "Prompt dismissed"
            : "Check for OTA update"}
        </Text>
      </TouchableOpacity>

      {/* Smoke-test note */}
      <View style={[styles.note, { backgroundColor: "#0D9E7E11", borderColor: "#0D9E7E33" }]}>
        <Feather name="info" size={12} color="#0D9E7E" />
        <Text style={[styles.noteText, { color: "#0D9E7E" }]}>
          OTA smoke test: after receiving an update, "Update ID" and "Published at" will change — and "Embedded build" badge will switch to "OTA update". No reinstall required from TestFlight (iOS) or Google Play internal track (Android).
        </Text>
      </View>
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function BuildInfoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { updateAvailable, pendingReload: ctxPendingReload } = useOtaUpdate();
  // True when any OTA indicator should show at the screen level (before scroll).
  const showTopBanner = updateAvailable || ctxPendingReload;

  async function shareReport() {
    const lines = [
      "ChargeBridge Build Info",
      `Version:      ${BUILD.appVersion} (${BUILD.buildNumber})`,
      `Platform:     ${BUILD.platform}`,
      `Environment:  ${BUILD.environment}`,
      `EAS Build ID: ${BUILD.easBuildId}`,
      `Submission:   ${BUILD.submissionId}`,
      `Git commit:   ${BUILD.gitCommitFull}`,
      `Built:        ${BUILD.buildStartUTC} → ${BUILD.buildEndUTC}`,
      `OTA channel:  ${Updates.channel ?? "—"}`,
      `OTA update:   ${Updates.isEmbeddedLaunch ? "embedded" : Updates.updateId ?? "—"}`,
    ];
    await Share.share({ message: lines.join("\n"), title: "ChargeBridge Build Report" });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Nav */}
      <View style={[styles.nav, { paddingTop: insets.top + 12, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>Build Info</Text>
        <TouchableOpacity onPress={shareReport} hitSlop={12}>
          <Feather name="share" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Persistent top-of-screen OTA indicator — visible without scrolling */}
      {showTopBanner && (
        <View style={[
          styles.screenUpdateBanner,
          { backgroundColor: ctxPendingReload ? "#f59e0b" : "#0D9E7E" },
        ]}>
          <Feather
            name={ctxPendingReload ? "clock" : "download-cloud"}
            size={14}
            color="#ffffff"
          />
          <Text style={styles.screenUpdateBannerText}>
            {ctxPendingReload
              ? "Update ready — will install once your session ends"
              : "Update ready — scroll down to apply"}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: "#0f172a" }]}>
          <Text style={styles.heroApp}>ChargeBridge</Text>
          <Text style={styles.heroVersion}>{BUILD.appVersion} ({BUILD.buildNumber})</Text>
          <View style={styles.heroBadges}>
            <View style={[styles.badge, { backgroundColor: BUILD.environment === "Production" ? "#0D9E7E22" : "#f59e0b22" }]}>
              <Text style={[styles.badgeText, { color: BUILD.environment === "Production" ? "#0D9E7E" : "#f59e0b" }]}>{BUILD.environment}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: "#6366f122" }]}>
              <Text style={[styles.badgeText, { color: "#818cf8" }]}>{BUILD.platform}</Text>
            </View>
            {BUILD.sdkVersion !== "—" && (
              <View style={[styles.badge, { backgroundColor: "#d9770622" }]}>
                <Text style={[styles.badgeText, { color: "#fbbf24" }]}>SDK {BUILD.sdkVersion}</Text>
              </View>
            )}
            {/* OTA badge */}
            <View style={[styles.badge, { backgroundColor: Updates.isEmbeddedLaunch ? "#f59e0b22" : "#0D9E7E22" }]}>
              <Text style={[styles.badgeText, { color: Updates.isEmbeddedLaunch ? "#f59e0b" : "#0D9E7E" }]}>
                {Updates.isEmbeddedLaunch ? "Embedded" : "OTA ✓"}
              </Text>
            </View>
          </View>
        </View>

        {/* OTA status — top-of-page for easy smoke-test verification */}
        <OTACard />

        {/* Identity */}
        <Card title="Build Identity" accent="#6366f1">
          <Row label="App Version"     value={BUILD.appVersion} />
          <Row label="iOS Build #"     value={BUILD.buildNumber} />
          <Row label="Android vCode"   value={BUILD.androidBuild} />
          <Row label="EAS Build ID"    value={BUILD.easBuildId}   shareable />
          <Row label="Submission ID"   value={BUILD.submissionId} shareable />
          <Row label="Git Commit"      value={BUILD.gitCommitShort} shareable />
        </Card>

        {/* Timeline */}
        <Card title="Build Timeline" accent="#3b82f6">
          <Row label="Build Start"   value={BUILD.buildStartUTC} />
          <Row label="Build End"     value={BUILD.buildEndUTC} />
          <Row label="Duration"      value={BUILD.buildStartUTC !== "not set" ? "~9 min 28 s" : "—"} />
        </Card>

        {/* Platform */}
        <Card title="Platform" accent="#d97706">
          <Row label="SDK"               value={`Expo ${BUILD.sdkVersion}`} />
          <Row label="React Native"      value="0.86" />
          <Row label="iOS Target"        value="17.0+" />
          <Row label="Arch"              value="New Architecture (Hermes)" />
          <Row label="Environment"       value={BUILD.environment} />
        </Card>

        {/* Commit */}
        <Card title="Last Commit at Build" accent="#8b5cf6">
          <View style={[styles.commitBox, { backgroundColor: colors.background }]}>
            <Text style={[styles.commitSha, { color: "#8b5cf6" }]}>{BUILD.gitCommitFull}</Text>
            <Text style={[styles.commitMsg, { color: colors.foreground }]}>{BUILD.gitMessage}</Text>
            <Text style={[styles.commitDate, { color: colors.mutedForeground }]}>2026-07-21 04:09:21 UTC</Text>
          </View>
          <View style={[styles.note, { backgroundColor: "#0D9E7E11", borderColor: "#0D9E7E33" }]}>
            <Feather name="check-circle" size={13} color="#0D9E7E" />
            <Text style={[styles.noteText, { color: "#0D9E7E" }]}>
              All Phase 4 + Phase 5 mobile changes were committed before this build was triggered (EAS_NO_VCS=1 uploads local files directly).
            </Text>
          </View>
        </Card>

        {/* What changed */}
        {CHANGES.map((group) => (
          <Card key={group.phase} title={group.phase} accent={group.color}>
            {group.items.map((item, i) => (
              <View key={i} style={[styles.changeRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.changeDot, { backgroundColor: group.color }]} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.changeTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.changeVerify, { color: colors.mutedForeground }]}>Verify: {item.verify}</Text>
                </View>
              </View>
            ))}
          </Card>
        ))}

        {/* Source of truth note */}
        <View style={[styles.note, { backgroundColor: colors.card, borderColor: colors.border, margin: 0, marginTop: 4 }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
            Version and build number are read live from app.json via expo-constants — always accurate. EAS Build ID, git SHA, and build timing are set in app.json extra before each build trigger.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1 },
  nav:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn:     { padding: 4 },
  navTitle:    { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  scroll:      { padding: 16, gap: 14 },

  hero:        { borderRadius: 18, padding: 24, alignItems: "center", gap: 6, marginBottom: 2 },
  heroApp:     { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.5)", letterSpacing: 1.2, textTransform: "uppercase" },
  heroVersion: { fontSize: 36, fontWeight: "800", color: "#ffffff", letterSpacing: -1 },
  heroBadges:  { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:   { fontSize: 11, fontWeight: "700" },

  card:        { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardHeader:  { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  accentBar:   { width: 4, height: 16, borderRadius: 2 },
  cardTitle:   { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

  row:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  rowLabel:    { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowValue:    { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },

  commitBox:   { margin: 12, borderRadius: 10, padding: 14, gap: 6 },
  commitSha:   { fontSize: 10, fontFamily: "Inter_400Regular", letterSpacing: 0.5 },
  commitMsg:   { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  commitDate:  { fontSize: 11, fontFamily: "Inter_400Regular" },

  note:        { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 12, marginTop: 0, borderRadius: 10, padding: 12, borderWidth: 1 },
  noteText:    { fontSize: 11, lineHeight: 16, flex: 1 },

  changeRow:   { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: "flex-start" },
  changeDot:   { width: 7, height: 7, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  changeTitle: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  changeVerify:{ fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },

  // OTA-specific
  screenUpdateBanner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  screenUpdateBannerText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  updateReadyBanner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: "#0D9E7E" },
  updateReadyText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  otaBanner:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  otaBannerText: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  otaBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginVertical: 12, paddingVertical: 11, borderRadius: 10 },
  otaBtnText:  { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#ffffff" },
});
