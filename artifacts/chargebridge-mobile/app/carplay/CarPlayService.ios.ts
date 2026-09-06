/**
 * CarPlay service — iOS implementation.
 *
 * Displays a ListTemplate of nearby EV charging stations when the iPhone is
 * connected to a CarPlay-enabled vehicle.  Requires the
 * com.apple.developer.carplay-ev-charging entitlement (added to app.json).
 *
 * On Android / Web, Metro resolves CarPlayService.ts (no-ops) instead.
 *
 * react-native-carplay uses native modules that are unavailable in Expo Go.
 * The dynamic require below lets Expo Go load the file without crashing —
 * all exported functions become silent no-ops when the module is absent.
 */

import type { ListItem, ListSection } from "react-native-carplay";
import { getNearbyStations } from "@workspace/api-client-react";
import type { StationWithDistance } from "@workspace/api-client-react";

type CarPlayModule = typeof import("react-native-carplay");
let _mod: CarPlayModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _mod = require("react-native-carplay") as CarPlayModule;
} catch {
  // Expo Go — native CarPlay module not available; all functions are no-ops
}

const CP = _mod?.CarPlay ?? null;
const LT = _mod?.ListTemplate ?? null;

const RADIUS_MILES = 10;
const MAX_ITEMS = 12;

let currentLocation: { latitude: number; longitude: number } | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let listTemplate: InstanceType<NonNullable<typeof LT>> | null = null;

const onConnect = async () => {
  if (!CP || !LT) return;
  const template = new LT({
    title: "ChargeBridge",
    sections: [],
    emptyViewTitleVariants: ["Locating…"],
    emptyViewSubtitleVariants: ["Searching for nearby EV chargers"],
  });

  listTemplate = template;
  CP.setRootTemplate(template, true);

  if (currentLocation) {
    await refreshTemplate();
  }

  refreshTimer = setInterval(refreshTemplate, 60_000);
};

const onDisconnect = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  listTemplate = null;
};

function chargerTypeLabel(station: StationWithDistance): string {
  const map: Record<string, string> = {
    Level1: "L1",
    Level2: "L2",
    DCFC: "DC Fast",
  };
  return map[station.chargerType] ?? station.chargerType;
}

function buildListItem(station: StationWithDistance): ListItem {
  const statusEmoji =
    station.status === "available"
      ? "🟢"
      : station.status === "busy"
        ? "🟡"
        : "🔴";

  const ports =
    station.availablePorts > 0
      ? `${station.availablePorts}/${station.totalPorts} ports`
      : "No ports available";

  const price =
    station.pricePerKwh > 0
      ? ` · $${station.pricePerKwh.toFixed(2)}/kWh`
      : "";

  return {
    text: `${statusEmoji} ${station.name}`,
    detailText: `${station.distanceMiles.toFixed(1)} mi · ${chargerTypeLabel(station)}${price} · ${ports}`,
  };
}

async function refreshTemplate(): Promise<void> {
  if (!listTemplate || !currentLocation) return;
  const { latitude: lat, longitude: lng } = currentLocation;

  try {
    const stations = await getNearbyStations({
      lat,
      lng,
      radiusMiles: RADIUS_MILES,
    });

    const nearest = stations.slice(0, MAX_ITEMS);

    const sections: ListSection[] =
      nearest.length > 0
        ? [{ header: "Nearby Stations", items: nearest.map(buildListItem) }]
        : [];

    listTemplate.updateSections(sections);
  } catch {
    // Silently skip — stale data stays visible
  }
}

export function initCarPlay(): void {
  if (!CP) return;
  CP.registerOnConnect(onConnect);
  CP.registerOnDisconnect(onDisconnect);
}

export function cleanupCarPlay(): void {
  if (!CP) return;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  CP.unregisterOnConnect(onConnect);
  CP.unregisterOnDisconnect(onDisconnect);
  listTemplate = null;
  currentLocation = null;
}

export function updateCarPlayLocation(loc: {
  latitude: number;
  longitude: number;
}): void {
  currentLocation = loc;
  void refreshTemplate();
}
