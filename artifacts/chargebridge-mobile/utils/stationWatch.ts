import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface WatchEntry {
  stationId: number;
  stationName: string;
  lastAvailable: number | null;
  intervalId: ReturnType<typeof setInterval>;
}

const watches = new Map<number, WatchEntry>();

export function isWatching(stationId: number): boolean {
  return watches.has(stationId);
}

export async function watchStation(
  stationId: number,
  stationName: string,
  currentAvailable: number | null
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (watches.has(stationId)) return true;

  const existing = (await Notifications.getPermissionsAsync()) as unknown as { granted: boolean };
  if (!existing.granted) {
    const result = (await Notifications.requestPermissionsAsync()) as unknown as { granted: boolean };
    if (!result.granted) return false;
  }

  const entry: WatchEntry = {
    stationId,
    stationName,
    lastAvailable: currentAvailable ?? 0,
    intervalId: setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/stations/${stationId}`);
        if (!r.ok) return;
        const data = await r.json();
        const available: number = data.availablePorts ?? 0;
        const prev = watches.get(stationId)?.lastAvailable ?? 0;
        if (prev === 0 && available > 0) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "Port available! ⚡",
              body: `${stationName} now has ${available} port${available > 1 ? "s" : ""} free.`,
              sound: true,
              data: { stationId },
            },
            trigger: null,
          });
          unwatchStation(stationId);
        } else if (watches.has(stationId)) {
          watches.get(stationId)!.lastAvailable = available;
        }
      } catch {}
    }, 30_000),
  };

  watches.set(stationId, entry);
  return true;
}

export function unwatchStation(stationId: number): void {
  const entry = watches.get(stationId);
  if (entry) {
    clearInterval(entry.intervalId);
    watches.delete(stationId);
  }
}
