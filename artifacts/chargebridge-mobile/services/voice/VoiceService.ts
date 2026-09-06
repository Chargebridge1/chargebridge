import type {
  VoiceIntent,
  CommandContext,
  VoiceCommandResult,
  PendingConfirmation,
  ActiveSessionSnapshot,
  CurrentStationSnapshot,
} from "./types";
import {
  formatKwh,
  formatCostCents,
  formatElapsed,
  formatEta,
  formatChargerType,
} from "./ResponseManager";

export type NavigateFn = (path: string, params?: Record<string, string>) => void;
export type StopChargingFn = (session: ActiveSessionSnapshot) => Promise<{ ok: boolean; message?: string }>;

function stationName(station: CurrentStationSnapshot | null): string {
  return station?.name ?? "this station";
}

export function handleIntent(
  intent: VoiceIntent,
  context: CommandContext,
  navigate: NavigateFn,
  stopCharging: StopChargingFn,
): VoiceCommandResult {
  const { activeSession, currentStation } = context;

  switch (intent.name) {
    // ── Discovery ─────────────────────────────────────────────────────────────
    case "FIND_STATIONS":
      return {
        response: "Opening nearby charging stations.",
        action: () => navigate("/(tabs)/index"),
      };

    case "FIND_NEAREST":
      return {
        response: "Finding the closest charger to you.",
        action: () => navigate("/(tabs)/index", { sortBy: "distance" }),
      };

    case "FIND_SAFEST":
      return {
        response: "Finding the most accessible station near you.",
        action: () => navigate("/(tabs)/index", { sortBy: "smart" }),
      };

    case "FIND_CHEAPEST":
      return {
        response: "Looking for free or low-cost chargers near you.",
        action: () => navigate("/(tabs)/index", { filter: "free" }),
      };

    case "FILTER_DCFC":
      return {
        response: "Showing only DC Fast Chargers.",
        action: () => navigate("/(tabs)/index", { chargerType: "DCFC" }),
      };

    // ── Station info ──────────────────────────────────────────────────────────
    case "STATION_INFO": {
      if (!currentStation) {
        return { response: "I don't have a station selected. Please open a station first." };
      }
      const speed = formatChargerType(currentStation.chargerType);
      const power = currentStation.powerKw ? ` at ${currentStation.powerKw} kilowatts` : "";
      const free = currentStation.isFree ? "free charging" : currentStation.pricePerKwh ? `$${currentStation.pricePerKwh.toFixed(2)} per kilowatt-hour` : "unknown pricing";
      return {
        response: `${stationName(currentStation)} — ${speed}${power}, ${free}.`,
      };
    }

    case "PORT_AVAILABILITY": {
      if (!currentStation) {
        return { response: "No station is selected. Open a station to check port availability." };
      }
      if (currentStation.availablePorts !== null && currentStation.availablePorts !== undefined) {
        const total = currentStation.totalPorts ?? currentStation.availablePorts;
        return {
          response: `${currentStation.availablePorts} of ${total} port${total !== 1 ? "s" : ""} available at ${stationName(currentStation)}.`,
        };
      }
      return { response: `Port availability isn't known for ${stationName(currentStation)}.` };
    }

    case "STATION_STATUS": {
      if (!currentStation) {
        return { response: "No station selected. Please open a station first." };
      }
      const s = currentStation.status;
      if (!s || s === "unknown") {
        return { response: `The status of ${stationName(currentStation)} is currently unknown.` };
      }
      const readable =
        s === "available" ? "available"
        : s === "busy" ? "in use"
        : s === "offline" ? "offline"
        : s;
      return { response: `${stationName(currentStation)} is currently ${readable}.` };
    }

    case "CHARGING_SPEED": {
      if (!currentStation) {
        return { response: "No station selected. Open a station to check its charging speed." };
      }
      const type = formatChargerType(currentStation.chargerType);
      const power = currentStation.powerKw ? ` — ${currentStation.powerKw} kilowatts` : "";
      return { response: `${stationName(currentStation)} is a ${type}${power}.` };
    }

    case "STATION_ACCESS": {
      if (!currentStation) {
        return { response: "No station selected. Open a station to check access." };
      }
      const level = currentStation.accessibilityLevel;
      if (level === "EASY") {
        return { response: `${stationName(currentStation)} is open to the public — easy access.` };
      } else if (level === "RESTRICTED") {
        return { response: `${stationName(currentStation)} may have restricted access, such as a campus or private lot.` };
      } else if (level === "MODERATE") {
        return { response: `${stationName(currentStation)} is generally accessible, though it may be at a hotel or office building.` };
      }
      const access = currentStation.accessType;
      if (access === "public") {
        return { response: `${stationName(currentStation)} is open to the public.` };
      } else if (access === "restricted") {
        return { response: `${stationName(currentStation)} has restricted access.` };
      }
      return { response: `Access information isn't available for ${stationName(currentStation)}.` };
    }

    // ── Session control ───────────────────────────────────────────────────────
    case "START_CHARGING": {
      if (activeSession) {
        return { response: "You already have an active charging session." };
      }
      const target = currentStation;
      const prompt = target
        ? `Start a charging session at ${stationName(target)}?`
        : "Start a charging session at this station?";
      const confirmation: PendingConfirmation = {
        intent: "START_CHARGING",
        context,
        promptText: prompt,
      };
      return {
        response: `${prompt} Say yes to confirm, or no to cancel.`,
        requiresConfirmation: confirmation,
      };
    }

    case "STOP_CHARGING": {
      if (!activeSession) {
        return { response: "There's no active charging session to stop." };
      }
      const confirmation: PendingConfirmation = {
        intent: "STOP_CHARGING",
        context,
        promptText: `Stop charging at ${activeSession.stationName}?`,
      };
      return {
        response: `Stop charging at ${activeSession.stationName}? Say yes to confirm, or no to cancel.`,
        requiresConfirmation: confirmation,
      };
    }

    // ── Confirmed actions (called after user says "yes") ──────────────────────
    case "CONFIRM_YES":
    case "CONFIRM_NO":
      return { response: "Got it." };

    // ── Session status ────────────────────────────────────────────────────────
    case "SESSION_STATUS": {
      if (!activeSession) {
        return {
          response: "No active session. Go to a station and tap Charge Now to start charging.",
          action: () => navigate("/(tabs)/index"),
        };
      }
      const energy = formatKwh(activeSession.displayKwh);
      const time = formatElapsed(activeSession.elapsedSeconds);
      return {
        response: `You've been charging at ${activeSession.stationName} for ${time} and delivered ${energy}.`,
        action: () => navigate("/active-session"),
      };
    }

    case "SESSION_ENERGY": {
      if (!activeSession) {
        return { response: "No active charging session." };
      }
      return { response: `You've added ${formatKwh(activeSession.displayKwh)} in this session.` };
    }

    case "SESSION_COST": {
      if (!activeSession) {
        return { response: "No active charging session." };
      }
      return { response: `This session has cost ${formatCostCents(activeSession.totalCostCents)} so far.` };
    }

    case "SESSION_TIME": {
      if (!activeSession) {
        return { response: "No active charging session." };
      }
      const eta = formatEta(
        activeSession.targetKwh,
        activeSession.displayKwh,
        activeSession.chargerType,
      );
      return { response: `Estimated time remaining is ${eta}.` };
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    case "NAVIGATE_TO_CHARGER": {
      if (!currentStation) {
        return { response: "No station selected. Open a station first, then ask me to navigate." };
      }
      return {
        response: `Opening directions to ${stationName(currentStation)}.`,
        action: () =>
          navigate("/station/" + currentStation.id, { openDirections: "true" }),
      };
    }

    case "NAVIGATE_BEST":
      return {
        response: "Finding the best charger and opening the map.",
        action: () => navigate("/(tabs)/map"),
      };

    // ── Account ───────────────────────────────────────────────────────────────
    case "CHARGING_HISTORY":
      return {
        response: "Opening your charging history.",
        action: () => navigate("/history"),
      };

    case "PAYMENT_METHOD":
      return {
        response: "Opening your profile to check your payment method.",
        action: () => navigate("/(tabs)/account"),
      };

    case "FAVORITES":
      return {
        response: "Opening your favorite stations.",
        action: () => navigate("/favorites"),
      };

    // ── Fleet stubs ───────────────────────────────────────────────────────────
    case "FLEET_STATUS":
    case "FLEET_VEHICLE":
    case "FLEET_COSTS":
      return {
        response: "Fleet management features are coming soon to ChargeBridge.",
      };

    // ── Fallback ──────────────────────────────────────────────────────────────
    case "UNKNOWN":
    default:
      return {
        response:
          "Sorry, I didn't understand that. Try saying something like: find a charger, start charging, or show my session status.",
      };
  }
}

export async function executeConfirmedStart(
  context: CommandContext,
  navigate: NavigateFn,
): Promise<string> {
  const { currentStation } = context;
  if (!currentStation) {
    navigate("/(tabs)/index");
    return "Opening the station list. Select a station and tap Charge Now to begin.";
  }
  navigate("/station/" + currentStation.id);
  return `Opening ${currentStation.name}. Tap Charge Now to start your session.`;
}

export async function executeConfirmedStop(
  session: ActiveSessionSnapshot,
  stopCharging: StopChargingFn,
  navigate: NavigateFn,
): Promise<string> {
  try {
    const result = await stopCharging(session);
    if (result.ok) {
      return "Charging stopped. Navigating to your session summary.";
    }
    return result.message ?? "Stop command sent. Please check the charger.";
  } catch {
    return "I couldn't reach the charger. Please tap Stop on screen to try again.";
  }
}
