// This file must be imported (side-effect) at app startup so that
// TaskManager.defineTask runs before any navigation begins.

import { AppState } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import {
  BACKGROUND_NAV_TASK,
  navState,
  showTurnNotification,
  showArrivalNotification,
} from "@/utils/navNotifications";
import {
  haversineMeters,
  backgroundAdvanceStepIdx,
} from "@/utils/navStepAdvance";
import { backgroundOffRouteTick } from "@/utils/navOffRouteDetect";
import { normalizeSpeed } from "@/utils/navNormalizeSpeed";
import { ARRIVAL_GATE_METERS } from "@/utils/navConstants";

TaskManager.defineTask(
  BACKGROUND_NAV_TASK,
  async ({
    data,
    error,
  }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
    if (error || !navState.isActive || !navState.steps.length) return;

    const locations = data?.locations;
    if (!locations?.length) return;

    const pos = locations[locations.length - 1].coords;
    const loc = { latitude: pos.latitude, longitude: pos.longitude };
    const steps = navState.steps;

    // Compute distance to destination once — used by both the step-advance
    // block (for the distToNext fallback on the final step) and the arrival
    // gate below.
    const distToDest = haversineMeters(loc, {
      latitude: navState.destLatitude,
      longitude: navState.destLongitude,
    });

    // Speed-adaptive step-advance — MUST run before the arrival check so the
    // final-turn push notification always fires before the arrival notification.
    // At highway speed (~29 m/tick) the arrival gate (60 m) and the 65 m
    // step-advance threshold overlap: without this ordering the arrival branch
    // would return early and skip the final maneuver announcement entirely.
    //
    // Shared utility used by the foreground handler in map.tsx
    // (foregroundAdvanceStepIdx) and tested in
    // __tests__/backgroundNavThreshold.test.ts.  Advances through ALL
    // consecutive in-threshold steps in a single location batch.
    const idx = backgroundAdvanceStepIdx(
      navState.currentStepIdx,
      steps,
      loc,
      normalizeSpeed(pos.speed),
      navState.travelMode === "walking",
      navState.travelMode === "cycling",
    );
    // Only let the background task drive currentStepIdx when the app is truly
    // backgrounded. When active, the foreground GPS handler owns this field
    // (speed-adaptive thresholds). Writing it from a potentially stale background
    // location batch would race the foreground and cause the voice block to
    // announce the wrong (skipped) step.
    if (AppState.currentState !== "active") {
      navState.currentStepIdx = idx;
    }

    // Background off-route detection — only when the foreground GPS handler is
    // not running (AppState "active" means map.tsx owns rerouting).  Uses the
    // same speed-adaptive thresholds as the foreground via navOffRouteThreshold()
    // inside backgroundOffRouteTick().  Counter state lives in navState so it
    // persists across consecutive background location batches.
    //
    // When the reroute condition is met, navState.offRouteDetected is set to
    // true; the foreground picks this up on the next active transition and
    // initiates the actual route-fetch.  The background does not fetch a new
    // route itself because it may not have reliable network timing guarantees.
    // Keep lastBgLoc fresh on every background tick so the active-transition
    // handler can reroute from a reliable location even when the foreground
    // GPS watch was suspended or killed by iOS while backgrounded.
    navState.lastBgLoc = loc;
    if (AppState.currentState !== "active" && navState.routeCoords.length >= 2) {
      const bgState = {
        count: navState.offRouteCount,
        startMs: navState.offRouteStartMs,
        lastRecalcMs: navState.lastBgOffRouteMs,
      };
      const shouldReroute = backgroundOffRouteTick(
        loc,
        normalizeSpeed(pos.speed),
        navState.travelMode === "walking",
        navState.travelMode === "cycling",
        /* sensitivity */ navState.recalcSensitivity, // same adaptive value as foreground
        navState.routeCoords,
        bgState,
        Date.now(),
      );
      navState.offRouteCount    = bgState.count;
      navState.offRouteStartMs  = bgState.startMs;
      navState.lastBgOffRouteMs = bgState.lastRecalcMs;
      if (shouldReroute) {
        navState.offRouteDetected = true;
      }
    }

    // Fire turn notification when step changes (before arrival check).
    // Track whether the turn fired in THIS tick: if so, showArrivalNotification
    // must not immediately dismiss it (skipDismissTurn=true), because
    // dismissNotificationAsync("chargebridge-nav-turn") would cancel the just-
    // scheduled turn notification before the driver sees it.
    let turnFiredThisTick = false;
    if (idx !== navState.lastNotifiedStepIdx) {
      navState.lastNotifiedStepIdx = idx;
      const step = steps[idx];
      const nextStep = steps[idx + 1] ?? null;
      const distToNext = nextStep
        ? haversineMeters(loc, nextStep.coordinate)
        : distToDest;
      await showTurnNotification(step, nextStep, distToNext);
      // Record only after the notification call resolves so a failed or
      // permission-denied notification is never treated as "announced".
      navState.notifiedStepIndices.add(idx);
      turnFiredThisTick = true;
    }

    // Arrival check — runs after step-advance so the final turn notification
    // is never skipped when the user crosses the arrival gate in the same tick
    // as the final maneuver point.
    // Pass turnFiredThisTick so arrival does not dismiss the turn notification
    // that was just shown — cancelNavNotifications() cleans it up on teardown.
    if (distToDest < ARRIVAL_GATE_METERS) {
      navState.isActive = false;
      await showArrivalNotification(turnFiredThisTick);
      await Location.stopLocationUpdatesAsync(BACKGROUND_NAV_TASK).catch(() => {});
      return;
    }
  }
);
