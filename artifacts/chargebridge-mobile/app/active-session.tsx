import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Platform, ScrollView,
} from "react-native";
import CompanionPanel, { type CompanionData } from "@/components/CompanionPanel";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
// expo-brightness v56 uses createPermissionHook which requires a newer expo
// core than what is installed. Lazy-load so a version mismatch doesn't crash
// the module at import time — Brightness methods become no-ops when unavailable.
let Brightness: typeof import("expo-brightness") | null = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Brightness = require("expo-brightness") as typeof import("expo-brightness");
  } catch {
    // Incompatible version in Expo Go — brightness control disabled
  }
}
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedStyle, withTiming, Easing,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import {
  requestNavNotifPermissions,
  scheduleChargerOfflineNotification,
  cancelChargerOfflineNotification,
} from "@/utils/navNotifications";
import { getGuestToken, deleteGuestToken } from "@/utils/guestToken";
import Svg, { Circle } from "react-native-svg";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/contexts/SessionContext";
import { useVoice } from "@/contexts/VoiceContext";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_RADIUS = 90;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const POLL_MS = 3000;
const MAX_STOP_ATTEMPTS = 3;

const DIM_BRIGHTNESS = 0.2;
const IDLE_DIM_MS = 60_000;

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : "";
}

function chargeRateKw(chargerType?: string): number {
  if (chargerType === "DCFC") return 50;
  if (chargerType === "Level2") return 7.2;
  return 1.4;
}

function fmtOfflineDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtTokenExpiry(ts: number): string {
  return new Date(ts).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtEta(targetKwh: number, deliveredKwh: number, chargeRate: number): string {
  if (deliveredKwh >= targetKwh) return "Complete";
  const remainingKwh = targetKwh - deliveredKwh;
  const remainingSecs = Math.round((remainingKwh / chargeRate) * 3600);
  const h = Math.floor(remainingSecs / 3600);
  const m = Math.floor((remainingSecs % 3600) / 60);
  if (h > 0) return `~${h}h ${m}m remaining`;
  if (m > 0) return `~${m}m remaining`;
  return "Less than a minute";
}

export default function ActiveSessionScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const {
    sessionId, stationId, stationName, kwh, totalCost, date, driverEmail, chargerType, guestToken, lat, lng,
  } = useLocalSearchParams<{
    sessionId?: string;
    stationId?: string;
    stationName?: string;
    kwh?: string;
    totalCost?: string;
    date?: string;
    driverEmail?: string;
    chargerType?: string;
    guestToken?: string;
    lat?: string;
    lng?: string;
  }>();

  const targetKwh = kwh ? parseFloat(kwh) : 0;
  const chargeRate = chargeRateKw(chargerType);

  // guestToken may be absent when the app is force-quit and relaunched directly
  // into this screen (route params are lost on cold-start). Recover from SecureStore.
  const [resolvedGuestToken, setResolvedGuestToken] = useState<string | undefined>(
    guestToken || undefined,
  );
  // Set to true when SecureStore recovery finds a stored entry that has passed its
  // 72-hour client-side TTL. Used to show an actionable "session expired" message
  // instead of a generic auth error when the user tries to stop charging.
  const [guestTokenExpired, setGuestTokenExpired] = useState(false);
  // Unix ms timestamp at which the stored guest token expires (from expiresAt field).
  // Only set for structured tokens (post-migration); legacy plain-string tokens omit it.
  const [guestTokenExpiresAt, setGuestTokenExpiresAt] = useState<number | undefined>(undefined);

  const [elapsed, setElapsed] = useState(0);
  const [displayKwh, setDisplayKwh] = useState(0);
  const [ocppConnected, setOcppConnected] = useState(false);
  const [ocppPowerW, setOcppPowerW] = useState<number | null>(null);
  const [ocppConnectorStatus, setOcppConnectorStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopAttempts, setStopAttempts] = useState(0);
  const [connectionLost, setConnectionLost] = useState(false);
  const [offlineElapsed, setOfflineElapsed] = useState(0);
  const [companionData, setCompanionData] = useState<CompanionData | null>(null);

  const elapsedRef = useRef(0);
  const displayKwhRef = useRef(0);
  const ocppBaselineRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const ocppEverConnectedRef = useRef(false);

  const originalBrightnessRef = useRef<number | null>(null);
  const isDimmedRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDimmed, setIsDimmed] = useState(false);

  const ringProgress = useSharedValue(0);
  const dimIndicatorOpacity = useSharedValue(0);

  const { startSession, updateTelemetry, endSession } = useSession();
  const { setActiveSession } = useVoice();
  const queryClient = useQueryClient();

  const KEEP_AWAKE_TAG = "charging-session";

  // Brightness management — only active on native (expo-brightness is a no-op on web)
  const restoreBrightness = useCallback(() => {
    if (!isDimmedRef.current || Platform.OS === "web") return;
    isDimmedRef.current = false;
    setIsDimmed(false);
    const original = originalBrightnessRef.current;
    if (original !== null) {
      void Brightness?.setBrightnessAsync(original);
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (Platform.OS === "web") return;
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    restoreBrightness();
    idleTimerRef.current = setTimeout(() => {
      if (!stoppedRef.current) {
        isDimmedRef.current = true;
        setIsDimmed(true);
        void Brightness?.setBrightnessAsync(DIM_BRIGHTNESS);
      }
    }, IDLE_DIM_MS);
  }, [restoreBrightness]);

  // Read the persisted token from SecureStore on mount for two purposes:
  // 1. Cold-start recovery: when the app is force-quit and relaunched, route params
  //    (including guestToken) are lost. SecureStore is the only source of truth then.
  // 2. Expiry display: even when guestToken was passed via params, SecureStore holds
  //    the structured entry with the expiresAt timestamp that we surface to the user.
  // If the 72-hour client-side TTL has already passed, record that explicitly so
  // handleStop can show an actionable "session expired" message instead of a raw auth error.
  useEffect(() => {
    if (!sessionId || Platform.OS === "web") return;
    getGuestToken(sessionId)
      .then((result) => {
        if (result.token) {
          if (!guestToken) setResolvedGuestToken(result.token);
          if (result.expiresAt) setGuestTokenExpiresAt(result.expiresAt);
        } else if (result.status === "expired") {
          if (!guestToken) setGuestTokenExpired(true);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save original brightness, start idle timer, restore on unmount
  useEffect(() => {
    if (Platform.OS === "web") return;

    async function init() {
      const result = await Brightness?.requestPermissionsAsync();
      if (result?.status !== "granted") return;
      originalBrightnessRef.current = await Brightness?.getBrightnessAsync() ?? null;
      resetIdleTimer();
    }
    void init();

    return () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      restoreBrightness();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  // Request local notification permission once on mount (native only)
  useEffect(() => {
    if (Platform.OS === "web") return;
    void requestNavNotifPermissions();
  }, []);

  useEffect(() => {
    if (stopped) {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      restoreBrightness();
    }
  }, [stopped, restoreBrightness]);

  // ── SessionContext + VoiceContext integration ─────────────────────────────
  // Register session globally on mount so Dashboard, Map, and Charge tab can
  // show a live "Active Session" banner and voice commands work immediately.
  useEffect(() => {
    if (!sessionId || !stationId) return;
    startSession({
      sessionId,
      stationId: Number(stationId),
      stationName: stationName ?? "Station",
      chargerType: chargerType ?? "",
      targetKwh,
      totalCostCents: Math.round(parseFloat(totalCost ?? "0") * 100),
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
    });
    return () => {
      // VoiceContext ref must not outlive this screen — clear on unmount.
      setActiveSession(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push live telemetry into SessionContext (rate-limited ≥0.05 kWh) and
  // VoiceContext (ref — no re-render) on every kWh or power change.
  useEffect(() => {
    if (!sessionId) return;
    updateTelemetry(displayKwh, ocppPowerW);
    setActiveSession({
      sessionId,
      stationId: stationId ?? "",
      stationName: stationName ?? "",
      displayKwh,
      elapsedSeconds: elapsedRef.current,
      totalCostCents: Math.round(parseFloat(totalCost ?? "0") * 100),
      targetKwh,
      chargerType: chargerType ?? "",
      guestToken: resolvedGuestToken,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayKwh, ocppPowerW]);

  // On session end: clear global state and invalidate history queries so
  // the Dashboard activity card and History tab refresh automatically.
  useEffect(() => {
    if (!stopped) return;
    endSession();
    setActiveSession(null);
    queryClient.invalidateQueries({ queryKey: ["recent-activity-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["charging-history"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopped]);

  const applyDelivered = useCallback(
    (delivered: number) => {
      const clamped = Math.max(0, Math.min(delivered, targetKwh > 0 ? targetKwh : Infinity));
      displayKwhRef.current = clamped;
      setDisplayKwh(clamped);

      const progress = targetKwh > 0 ? Math.min(clamped / targetKwh, 1) : 0;
      ringProgress.value = withTiming(progress, {
        duration: 800,
        easing: Easing.out(Easing.cubic),
      });

      if (clamped >= targetKwh && targetKwh > 0 && !stoppedRef.current) {
        stoppedRef.current = true;
        setStopped(true);
      }
    },
    [targetKwh],
  );

  // Detect charger going offline mid-session and show/clear the connection-lost banner.
  // Also fires a local push notification so the driver is alerted even when the app
  // is backgrounded or the screen is off. The notification is cancelled on reconnect.
  useEffect(() => {
    if (ocppConnected) {
      ocppEverConnectedRef.current = true;
      setConnectionLost(false);
      void cancelChargerOfflineNotification();
    } else if (ocppEverConnectedRef.current) {
      setConnectionLost(true);
      setOfflineElapsed(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void scheduleChargerOfflineNotification(stationName ?? "Your charger");
    }
  }, [ocppConnected, stationName]);

  // Tick the offline duration counter every second while the charger is disconnected
  useEffect(() => {
    if (!connectionLost || stopped) return;
    const ticker = setInterval(() => {
      setOfflineElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(ticker);
  }, [connectionLost, stopped]);

  // Elapsed time ticker (1s) — drives simulation fallback when OCPP is absent
  useEffect(() => {
    const ticker = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);

      if (ocppBaselineRef.current === null) {
        // No OCPP data yet — simulate based on charger type and elapsed time
        const simulated = (chargeRate * elapsedRef.current) / 3600;
        applyDelivered(simulated);
      }
    }, 1000);
    return () => clearInterval(ticker);
  }, [chargeRate, applyDelivered]);

  // OCPP live data — poll /api/stations/:id/ocpp-status every POLL_MS
  // Uses a baseline (meterKwhBaseline) established on the first connected reading
  // so that delivered = currentMeterKwh - baseline, not the lifetime cumulative register.
  useEffect(() => {
    if (!stationId) return;
    const baseUrl = getBaseUrl();

    async function poll() {
      try {
        const res = await fetch(`${baseUrl}/api/stations/${stationId}/ocpp-status`);
        if (!res.ok) return;

        const data: {
          connected: boolean;
          meterKwh?: number;
          meterWh?: number;
          connectorStatus?: string;
        } = await res.json();

        setOcppConnected(data.connected);

        if (data.connected && typeof data.meterKwh === "number") {
          // Establish baseline on first connected poll
          if (ocppBaselineRef.current === null) {
            ocppBaselineRef.current = data.meterKwh;
          }
          // Delivered = delta from session-start meter reading
          const delivered = Math.max(0, data.meterKwh - ocppBaselineRef.current);
          applyDelivered(delivered);
        } else if (!data.connected) {
          // Charger disconnected — clear baseline so sim takes over
          ocppBaselineRef.current = null;
          setOcppConnected(false);
          setOcppPowerW(null);
          setOcppConnectorStatus(null);
        }
        if (data.connected && data.connectorStatus) {
          setOcppConnectorStatus(data.connectorStatus);
        }
      } catch {
        // Network hiccup — simulation continues
      }
    }

    void poll();
    const poller = setInterval(poll, POLL_MS);
    return () => clearInterval(poller);
  }, [stationId, applyDelivered]);

  // SSE stream for session_start, meter, and session_stop events
  // Provides lower-latency updates than polling and delivers accurate kwhDelivered on stop.
  // On React Native, response.body streaming is supported on Hermes ≥ 0.71 / Expo SDK 49+.
  // If streaming is unavailable the effect silently exits and polling handles updates.
  useEffect(() => {
    if (!stationId) return;
    const baseUrl = getBaseUrl();
    const controller = new AbortController();

    async function streamSse() {
      try {
        const res = await fetch(`${baseUrl}/api/stations/${stationId}/live`, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!res.ok || !res.body) return;

        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const chunks = buf.split("\n\n");
          buf = chunks.pop() ?? "";

          for (const chunk of chunks) {
            let eventType = "message";
            let dataLine = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
            }
            if (!dataLine) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(dataLine) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (eventType === "session_start") {
              // meterStartWh is the cumulative register at session begin
              const meterStartWh = typeof payload.meterStartWh === "number" ? payload.meterStartWh : 0;
              ocppBaselineRef.current = meterStartWh / 1000;
              applyDelivered(0);
              setOcppConnected(true);
            } else if (eventType === "meter") {
              const meterWh = typeof payload.meterWh === "number" ? payload.meterWh : null;
              if (meterWh !== null) {
                if (ocppBaselineRef.current === null) {
                  ocppBaselineRef.current = meterWh / 1000;
                }
                applyDelivered(Math.max(0, meterWh / 1000 - ocppBaselineRef.current));
                setOcppConnected(true);
              }
              const powerW = typeof payload.powerW === "number" ? payload.powerW : null;
              if (powerW !== null) setOcppPowerW(powerW);
            } else if (eventType === "session_stop") {
              // kwhDelivered is the exact session-delivered energy from OCPP StopTransaction
              const kwhDelivered = typeof payload.kwhDelivered === "number" ? payload.kwhDelivered : null;
              if (kwhDelivered !== null) {
                applyDelivered(kwhDelivered);
              }
              setOcppPowerW(null);
              stoppedRef.current = true;
              setStopped(true);
            } else if (eventType === "status") {
              const connected = payload.connected === true;
              setOcppConnected(connected);
              // status events carry meterKwh and connectorStatus
              const meterKwh = typeof payload.meterKwh === "number" ? payload.meterKwh : null;
              if (connected && meterKwh !== null) {
                if (ocppBaselineRef.current === null) {
                  ocppBaselineRef.current = meterKwh;
                }
                applyDelivered(Math.max(0, meterKwh - ocppBaselineRef.current));
              }
              const connStatus = typeof payload.connectorStatus === "string" ? payload.connectorStatus : null;
              if (connected && connStatus) setOcppConnectorStatus(connStatus);
              if (!connected) { setOcppPowerW(null); setOcppConnectorStatus(null); }
            } else if (eventType === "connected") {
              setOcppConnected(true);
            } else if (eventType === "disconnected") {
              setOcppConnected(false);
              setOcppPowerW(null);
              setOcppConnectorStatus(null);
              ocppBaselineRef.current = null;
            }
          }
        }
      } catch {
        // AbortError on cleanup or streaming unsupported — polling handles it
      }
    }

    void streamSse();
    return () => controller.abort();
  }, [stationId, applyDelivered]);

  // Fade the power-saving indicator in/out as the screen dims or wakes
  useEffect(() => {
    dimIndicatorOpacity.value = withTiming(isDimmed ? 1 : 0, {
      duration: 600,
      easing: Easing.inOut(Easing.ease),
    });
  }, [isDimmed]);

  const dimIndicatorStyle = useAnimatedStyle(() => ({
    opacity: dimIndicatorOpacity.value,
  }));

  // Companion panel — fetch weather + nearby places 15s after session starts
  useEffect(() => {
    if (stopped || !stationId || !lat || !lng) return;
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) return;

    const t = setTimeout(async () => {
      try {
        const base = getBaseUrl();
        const res = await fetch(
          `${base}/api/stations/${stationId}/companion?lat=${parsedLat}&lng=${parsedLng}`,
        );
        if (!res.ok) return;
        const data = await res.json() as CompanionData;
        setCompanionData(data);
      } catch {
        // Companion panel is best-effort — never crash the session
      }
    }, 15_000);

    return () => clearTimeout(t);
  }, [stationId, lat, lng, stopped]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress.value),
  }));

  const pct = targetKwh > 0 ? Math.round(Math.min(displayKwh / targetKwh, 1) * 100) : 0;
  const minutesToTarget = !stopped && chargeRate > 0
    ? Math.ceil(Math.max(0, targetKwh - displayKwh) / chargeRate * 60)
    : 0;

  const clearGuestToken = useCallback(() => {
    if (sessionId) {
      deleteGuestToken(sessionId);
    }
  }, [sessionId]);

  const navigateToSummary = useCallback(() => {
    clearGuestToken();
    router.replace({
      pathname: "/session-summary" as any,
      params: {
        sessionId,
        stationId,
        stationName,
        kwh: displayKwhRef.current.toFixed(2),
        totalCost,
        date: date ?? new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
        driverEmail,
        chargerType,
      },
    });
  }, [sessionId, stationId, stationName, totalCost, date, driverEmail, chargerType, clearGuestToken]);

  useEffect(() => {
    if (stopped && !stopping) {
      const t = setTimeout(() => navigateToSummary(), 1200);
      return () => clearTimeout(t);
    }
  }, [stopped, stopping, navigateToSummary]);

  async function handleStop() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // If the client-side TTL already expired (force-quit recovery, >72 h later),
    // skip the network call and show an actionable message immediately.
    // Note: the server has no TTL — the token hash would still be accepted if the
    // entry hadn't been cleaned up client-side. The 72-hour limit is a local
    // self-cleanup guard, not a server-enforced expiry.
    if (guestTokenExpired && !resolvedGuestToken) {
      Alert.alert(
        "Session Expired",
        "Your charging session token has expired (sessions are valid for 72 hours). Please contact the station owner to stop the charger manually.",
      );
      return;
    }

    Alert.alert(
      "Stop Charging?",
      "This will send a remote stop command to the charger. Proceed?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop Charging",
          style: "destructive",
          onPress: async () => {
            setStopping(true);
            try {
              if (!sessionId) throw new Error("Session ID missing");

              const baseUrl = getBaseUrl();
              const stopHeaders: Record<string, string> = {};
              if (resolvedGuestToken) stopHeaders["X-Guest-Token"] = resolvedGuestToken;
              const res = await fetch(
                `${baseUrl}/api/sessions/${sessionId}/stop-charging`,
                { method: "POST", headers: stopHeaders },
              );

              if (!res.ok) {
                // 401 — no credentials sent (token was absent or expired without being
                //        flagged as "expired" — e.g. pre-migration plain-string entries).
                // 403 — credentials sent but rejected by the server (hash mismatch or
                //        wrong session owner). Both cases are unrecoverable without the
                //        station owner's intervention.
                if (res.status === 401 || res.status === 403) {
                  setStopping(false);
                  Alert.alert(
                    "Session Expired or Invalid",
                    "Your session has expired or is no longer valid. Please contact the station owner to stop the charger manually.",
                  );
                  return;
                }
                const body = await res.json().catch(() => ({})) as Record<string, unknown>;
                throw new Error((body.error as string | undefined) ?? `Server error ${res.status}`);
              }

              const body = await res.json() as { ok: boolean; ocppStopped: boolean; message?: string };

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              stoppedRef.current = true;

              if (!body.ocppStopped) {
                // OCPP stop command wasn't accepted (e.g. no OCPP charger), but payment
                // is already processed — navigate to summary and let the user know.
                Alert.alert(
                  "Session Ended",
                  body.message ?? "The session has been recorded. The charger may need to be stopped manually.",
                  [{ text: "OK", onPress: () => navigateToSummary() }],
                );
                setStopping(false);
                setStopped(true);
              } else {
                setStopped(true);
                navigateToSummary();
              }
            } catch (err: any) {
              setStopping(false);
              setStopAttempts((n) => n + 1);
              Alert.alert(
                "Could Not Stop Session",
                err.message ?? "The stop command failed. Please contact the station owner.",
              );
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]} onTouchStart={resetIdleTimer}>
      {/* Nav bar */}
      <View
        style={[
          S.navBar,
          { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={{ width: 38 }} />
        <Text style={[S.navTitle, { color: colors.foreground }]}>Charging Session</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={S.scrollWrap}
        contentContainerStyle={[S.content, { paddingBottom: isWeb ? 34 : insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Station name */}
        <View style={S.stationRow}>
          <View style={[S.stationIcon, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="flash" size={18} color={colors.primary} />
          </View>
          <Text style={[S.stationName, { color: colors.foreground }]} numberOfLines={1}>
            {stationName ?? "Charging Station"}
          </Text>
        </View>

        {/* Live indicator */}
        <View style={S.liveRow}>
          <View style={[S.liveDot, stopped ? { backgroundColor: "#22c55e" } : {}]} />
          <Text style={[S.liveTxt, { color: stopped ? "#22c55e" : "#ef4444" }]}>
            {stopped ? "Complete" : ocppConnected ? "Live · OCPP" : "Live · Est."}
          </Text>
          {ocppConnected && !!ocppConnectorStatus && !stopped && (
            <View style={[S.connStatusPill, {
              backgroundColor: ocppConnectorStatus === "Charging"
                ? colors.primary + "22"
                : ocppConnectorStatus === "Faulted"
                  ? "#ef444422"
                  : colors.muted,
            }]}>
              <Text style={[S.connStatusTxt, {
                color: ocppConnectorStatus === "Charging"
                  ? colors.primary
                  : ocppConnectorStatus === "Faulted"
                    ? "#ef4444"
                    : colors.mutedForeground,
              }]}>
                {ocppConnectorStatus}
              </Text>
            </View>
          )}
        </View>

        {/* Connection-lost banner */}
        {connectionLost && !stopped && (
          <View style={S.connectionLostBanner}>
            <Feather name="wifi-off" size={15} color="#b45309" />
            <Text style={S.connectionLostTxt}>
              Charger offline for {fmtOfflineDuration(offlineElapsed)} — using estimated values
            </Text>
          </View>
        )}

        {/* Progress ring */}
        <View style={S.ringWrap}>
          <Svg width={RING_RADIUS * 2 + 24} height={RING_RADIUS * 2 + 24}>
            {/* Track */}
            <Circle
              cx={RING_RADIUS + 12}
              cy={RING_RADIUS + 12}
              r={RING_RADIUS}
              stroke={colors.border}
              strokeWidth={14}
              fill="none"
            />
            {/* Progress arc */}
            <AnimatedCircle
              cx={RING_RADIUS + 12}
              cy={RING_RADIUS + 12}
              r={RING_RADIUS}
              stroke={stopped ? "#22c55e" : colors.primary}
              strokeWidth={14}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              animatedProps={animatedProps}
              rotation="-90"
              origin={`${RING_RADIUS + 12}, ${RING_RADIUS + 12}`}
            />
          </Svg>
          {/* Center content */}
          <View style={S.ringCenter} pointerEvents="none">
            <Text style={[S.pctText, { color: stopped ? "#22c55e" : colors.primary }]}>
              {pct}%
            </Text>
            <Text style={[S.kwhText, { color: colors.foreground }]}>
              {displayKwh.toFixed(2)} kWh
            </Text>
            <Text style={[S.kwhTarget, { color: colors.mutedForeground }]}>
              of {targetKwh.toFixed(2)} kWh
            </Text>
          </View>
        </View>

        {/* Metrics strip */}
        <View style={S.metricsRow}>
          <View style={[S.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="clock" size={16} color={colors.mutedForeground} />
            <Text style={[S.metricVal, { color: colors.foreground }]}>{fmtElapsed(elapsed)}</Text>
            <Text style={[S.metricLbl, { color: colors.mutedForeground }]}>Elapsed</Text>
          </View>
          <View style={[S.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="zap" size={16} color="#3b82f6" />
            <Text style={[S.metricVal, { color: colors.foreground }]}>
              {ocppConnected && ocppPowerW !== null
                ? ocppPowerW >= 1000
                  ? `${(ocppPowerW / 1000).toFixed(1)} kW`
                  : `${Math.round(ocppPowerW)} W`
                : chargeRate >= 1
                  ? `${chargeRate} kW`
                  : `${chargeRate * 1000} W`}
            </Text>
            <Text style={[S.metricLbl, { color: colors.mutedForeground }]}>
              {ocppConnected && ocppPowerW !== null ? "Power · Live" : "Power · Est."}
            </Text>
          </View>
          <View style={[S.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="dollar-sign" size={16} color="#f59e0b" />
            <Text style={[S.metricVal, { color: colors.foreground }]}>
              ${totalCost ? parseFloat(totalCost).toFixed(2) : "—"}
            </Text>
            <Text style={[S.metricLbl, { color: colors.mutedForeground }]}>Total</Text>
          </View>
        </View>

        {/* ETA */}
        {!stopped && (
          <View style={[S.etaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="flag" size={14} color={colors.mutedForeground} />
            <Text style={[S.etaTxt, { color: colors.mutedForeground }]}>
              {fmtEta(targetKwh, displayKwh, chargeRate)}
            </Text>
          </View>
        )}

        {/* Charger type pill */}
        {!!chargerType && (
          <View style={[S.typePill, { backgroundColor: colors.muted }]}>
            <Text style={[S.typeTxt, { color: colors.mutedForeground }]}>{chargerType}</Text>
          </View>
        )}

        {/* Guest token expiry — only shown while the session is active */}
        {!stopped && !!guestTokenExpiresAt && !!(resolvedGuestToken ?? guestToken) && (
          <View style={[S.tokenExpiryRow, { borderColor: colors.border }]}>
            <Feather name="clock" size={12} color={colors.mutedForeground} />
            <Text style={[S.tokenExpiryTxt, { color: colors.mutedForeground }]}>
              Token valid until {fmtTokenExpiry(guestTokenExpiresAt)}
            </Text>
          </View>
        )}

        {/* Stop button / contact-owner fallback */}
        {!stopped && (
          stopAttempts >= MAX_STOP_ATTEMPTS ? (
            <View style={[S.contactOwnerCard, { backgroundColor: "#fef3c722", borderColor: "#d9770655" }]}>
              <Ionicons name="warning-outline" size={20} color="#d97706" />
              <View style={{ flex: 1 }}>
                <Text style={[S.contactOwnerTitle, { color: "#d97706" }]}>Cannot stop remotely</Text>
                <Text style={[S.contactOwnerMsg, { color: "#92400e" }]}>
                  Stop failed after {MAX_STOP_ATTEMPTS} attempts. Contact the station owner or unplug manually to end the session.
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[S.stopBtn, { borderColor: "#ef4444", opacity: stopping ? 0.6 : 1 }]}
              onPress={handleStop}
              disabled={stopping}
              activeOpacity={0.8}
            >
              {stopping ? (
                <Feather name="loader" size={18} color="#ef4444" />
              ) : (
                <Ionicons name="stop-circle-outline" size={22} color="#ef4444" />
              )}
              <Text style={S.stopTxt}>
                {stopping
                  ? stopAttempts > 0
                    ? `Retry ${stopAttempts + 1} of ${MAX_STOP_ATTEMPTS}…`
                    : "Stopping…"
                  : stopAttempts > 0
                    ? `Retry Stop (${stopAttempts + 1} of ${MAX_STOP_ATTEMPTS})`
                    : "Stop Charging"}
              </Text>
            </TouchableOpacity>
          )
        )}

        {stopped && (
          <View style={[S.completeCard, { backgroundColor: "#22c55e18", borderColor: "#22c55e44" }]}>
            <Ionicons name="checkmark-circle" size={22} color="#22c55e" />
            <Text style={[S.completeTxt, { color: "#22c55e" }]}>
              Charge complete — preparing summary…
            </Text>
          </View>
        )}

        {/* Charging Companion Panel — weather, nearby places, smart suggestion */}
        {!stopped && companionData && (
          <CompanionPanel
            data={companionData}
            minutesToTarget={minutesToTarget}
            stationName={stationName}
          />
        )}
      </ScrollView>

      {/* Power-saving indicator — fades in when screen auto-dims, tap anywhere to restore */}
      {Platform.OS !== "web" && (
        <Animated.View style={[S.dimIndicator, dimIndicatorStyle]} pointerEvents="none">
          <Feather name="moon" size={12} color="rgba(255,255,255,0.75)" />
          <Text style={S.dimIndicatorTxt}>Power saving</Text>
        </Animated.View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: {
    flex: 1, textAlign: "center",
    fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  scrollWrap: { flex: 1 },
  content: {
    alignItems: "center",
    paddingHorizontal: 20, paddingTop: 20, gap: 16,
    flexGrow: 1,
  },

  stationRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    maxWidth: "100%",
  },
  stationIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stationName: {
    fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },

  liveRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444",
  },
  liveTxt: {
    fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold",
    letterSpacing: 1, textTransform: "uppercase",
  },
  connStatusPill: {
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  connStatusTxt: {
    fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },

  ringWrap: {
    alignItems: "center", justifyContent: "center",
    marginVertical: 4,
  },
  ringCenter: {
    position: "absolute",
    alignItems: "center", justifyContent: "center",
    width: RING_RADIUS * 2 - 20,
    height: RING_RADIUS * 2 - 20,
    top: 12 + 10, left: 12 + 10,
    gap: 2,
  },
  pctText: {
    fontSize: 36, fontWeight: "800", fontFamily: "Inter_700Bold",
  },
  kwhText: {
    fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  kwhTarget: {
    fontSize: 12, fontFamily: "Inter_400Regular",
  },

  metricsRow: {
    flexDirection: "row", gap: 10, width: "100%",
  },
  metricCard: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingVertical: 12, alignItems: "center", gap: 4,
  },
  metricVal: {
    fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  metricLbl: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    textTransform: "uppercase", letterSpacing: 0.5,
  },

  etaCard: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  etaTxt: {
    fontSize: 13, fontFamily: "Inter_400Regular",
  },

  typePill: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
  },
  typeTxt: {
    fontSize: 12, fontFamily: "Inter_400Regular",
  },

  tokenExpiryRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  tokenExpiryTxt: {
    fontSize: 11, fontFamily: "Inter_400Regular",
  },

  stopBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 28, paddingVertical: 14,
    marginTop: 4,
  },
  stopTxt: {
    color: "#ef4444", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold",
  },

  contactOwnerCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 4, width: "100%",
  },
  contactOwnerTitle: {
    fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2,
  },
  contactOwnerMsg: {
    fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17,
  },

  completeCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 12,
    marginTop: 4,
  },
  completeTxt: {
    fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },

  connectionLostBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, borderWidth: 1,
    borderColor: "#fbbf2466",
    backgroundColor: "#fef3c7",
    paddingHorizontal: 14, paddingVertical: 10,
    width: "100%",
  },
  connectionLostTxt: {
    flex: 1,
    color: "#92400e",
    fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },

  dimIndicator: {
    position: "absolute",
    bottom: 36,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.48)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dimIndicatorTxt: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
});
