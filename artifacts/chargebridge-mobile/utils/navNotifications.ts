import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const BACKGROUND_NAV_TASK = "CHARGEBRIDGE_BG_NAV";

export type NavStep = {
  instruction: string;
  featherIcon: string;
  coordinate: { latitude: number; longitude: number };
};

// Module-level singleton — readable by both the foreground component and the
// background task (they share the same JS bundle instance on iOS/Android).
export const navState = {
  isActive: false,
  steps: [] as NavStep[],
  currentStepIdx: 0,
  destLatitude: 0,
  destLongitude: 0,
  destLabel: "",
  // lastNotifiedStepIdx: used by the background task to deduplicate repeated
  // push notifications for the same step within a single background session.
  lastNotifiedStepIdx: -1,
  // notifiedStepIndices: the exact set of step indices for which
  // showTurnNotification() resolved successfully (either from the background
  // task or from the foreground-while-inactive path).  Consumed by
  // syncBgNotifiedIntoVoiceAnnounced on every background→active transition to
  // suppress foreground re-announcement of those steps.  Cleared on every
  // route replacement so new-route steps are never incorrectly suppressed.
  notifiedStepIndices: new Set<number>(),
  // activeGeneration: incremented on every background→active AppState transition.
  // The foreground non-active branch captures this value before calling
  // showTurnNotification(); the .then() callback only records the step index
  // when the generation still matches (i.e. the app has NOT transitioned to
  // active since the notification was started).  This prevents late-resolving
  // notifications from recording into notifiedStepIndices after the sync has
  // already run, which would otherwise silently suppress foreground voice
  // guidance for steps where no push was delivered before the active transition.
  activeGeneration: 0,

  // ── Background off-route detection ────────────────────────────────────────
  // The route polyline is stored here so the background task can compute
  // perpendicular distance via closestPointOnPolyline() without re-fetching
  // the route.  It uses the same speed-adaptive thresholds as the foreground
  // (navOffRouteThreshold).  All four fields are reset when navigation starts
  // or a new route is loaded (resetRouteRefs / nav start block in map.tsx).
  //
  // routeCoords:      Full route polyline (WGS-84 lat/lng array).  Must be set
  //                   before background off-route detection can run.
  routeCoords: [] as { latitude: number; longitude: number }[],
  // travelMode:       Driving / walking / cycling — determines which distance
  //                   and count bucket navOffRouteThreshold() selects.
  travelMode: "driving" as "driving" | "walking" | "cycling",
  // offRouteCount:    Consecutive GPS readings that exceeded offDistM.
  offRouteCount: 0,
  // offRouteStartMs:  Wall-clock timestamp of the first reading in the current
  //                   off-route streak (0 = no active streak).
  offRouteStartMs: 0,
  // lastBgOffRouteMs: Timestamp of the last background-triggered reroute signal
  //                   (used for the offCooldown gate).
  lastBgOffRouteMs: 0,
  // offRouteDetected: Set to true by the background task when the reroute
  //                   condition is met.  The foreground checks this on the next
  //                   active transition and initiates the actual reroute fetch.
  //                   Reset to false after the foreground processes it.
  offRouteDetected: false,
  // lastBgLoc:        Most recent GPS fix received by the background location
  //                   task.  Written on every background tick so the foreground
  //                   active-transition handler can reroute from a fresh location
  //                   even when the foreground GPS watch was suspended/killed.
  lastBgLoc: null as { latitude: number; longitude: number } | null,
  // recalcSensitivity: Adaptive multiplier (1.0 default) that scales the
  //                    off-route distance threshold.  Mirrors
  //                    recalcSensitivityRef in map.tsx and must be kept in
  //                    sync so the background and foreground paths apply the
  //                    same threshold.  Set by map.tsx whenever the value is
  //                    loaded from AsyncStorage or adapted after a reroute.
  recalcSensitivity: 1.0,
};

// Create the Android notification channel at module load time.
// This replaces the expo-notifications plugin entry (removed from app.json
// because that plugin injects aps-environment, breaking our no-push build).
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("charging-session", {
    name: "Charging Session",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#0D9E7E",
  }).catch(() => {});
}

export async function requestNavNotifPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  // expo-notifications .d.ts does not expose `granted` at the top level in all
  // versions, but the runtime object always has it (extends PermissionResponse).
  const existing = (await Notifications.getPermissionsAsync()) as unknown as { granted: boolean };
  if (existing.granted) return true;
  const result = (await Notifications.requestPermissionsAsync()) as unknown as { granted: boolean };
  return result.granted;
}

export async function showTurnNotification(
  step: NavStep,
  nextStep: NavStep | null,
  distToNextManeuverM: number
): Promise<void> {
  if (Platform.OS === "web") return;
  const distLabel =
    distToNextManeuverM < 60
      ? "Now"
      : distToNextManeuverM < 1000
      ? `In ${Math.round(distToNextManeuverM / 10) * 10} m`
      : `In ${(distToNextManeuverM / 1000).toFixed(1)} km`;

  await Notifications.scheduleNotificationAsync({
    identifier: "chargebridge-nav-turn",
    content: {
      title: `${distLabel} — ${step.instruction}`,
      body: nextStep ? `Then: ${nextStep.instruction}` : "Approaching destination",
      sound: false,
      ...(Platform.OS === "android" && {
        priority: Notifications.AndroidNotificationPriority.HIGH,
        ongoing: true,
        sticky: true,
        color: "#0D9E7E",
      }),
    },
    trigger: null,
  });
}

/**
 * @param skipDismissTurn - When true, the existing turn notification is NOT
 *   dismissed before scheduling arrival. Pass true when a turn notification
 *   fired in the same background tick so the driver sees "turn now" before the
 *   arrival notification appears (the turn is cleared by cancelNavNotifications
 *   when navigation fully ends). When false (default), the stale turn banner is
 *   cleared first — the normal non-overlapping flow.
 */
export async function showArrivalNotification(skipDismissTurn = false): Promise<void> {
  if (Platform.OS === "web") return;
  if (!skipDismissTurn) {
    await Notifications.dismissNotificationAsync("chargebridge-nav-turn").catch(() => {});
  }
  await Notifications.scheduleNotificationAsync({
    identifier: "chargebridge-nav-arrived",
    content: {
      title: "You have arrived!",
      body: "Your destination is nearby.",
      sound: true,
    },
    trigger: null,
  });
}

export async function cancelNavNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.dismissNotificationAsync("chargebridge-nav-turn").catch(() => {});
  await Notifications.dismissNotificationAsync("chargebridge-nav-arrived").catch(() => {});
}

const CHARGER_OFFLINE_NOTIF_ID = "chargebridge-charger-offline";

export async function scheduleChargerOfflineNotification(stationName: string): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    identifier: CHARGER_OFFLINE_NOTIF_ID,
    content: {
      title: "Charger Disconnected",
      body: `${stationName} has gone offline. Your session is using estimated values.`,
      sound: true,
      ...(Platform.OS === "android" && {
        priority: Notifications.AndroidNotificationPriority.HIGH,
        vibrationPattern: [0, 400, 200, 400],
        color: "#b45309",
        channelId: "charging-session",
      }),
    },
    trigger: null,
  });
}

export async function cancelChargerOfflineNotification(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.dismissNotificationAsync(CHARGER_OFFLINE_NOTIF_ID).catch(() => {});
}
