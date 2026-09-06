import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Linking } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { track } from "@/lib/analytics";

export type DefaultMap = "chargebridge" | "apple_maps" | "google_maps" | "waze";

const STORAGE_KEY = "@cb:default_map_v1";
const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const SAVE_DEBOUNCE_MS = 600;

export const MAP_OPTIONS: {
  id: DefaultMap;
  label: string;
  icon: string;
  desc: string;
  iosOnly?: boolean;
}[] = [
  {
    id: "chargebridge",
    label: "ChargeBridge Navigate",
    icon: "map-outline",
    desc: "Built-in turn-by-turn (default)",
  },
  {
    id: "apple_maps",
    label: "Apple Maps",
    icon: "navigate-outline",
    desc: "iOS system navigation",
    iosOnly: true,
  },
  {
    id: "google_maps",
    label: "Google Maps",
    icon: "earth-outline",
    desc: "Requires Google Maps app",
  },
  {
    id: "waze",
    label: "Waze",
    icon: "car-sport-outline",
    desc: "Requires Waze app",
  },
];

export function useDefaultMap() {
  const [defaultMap, setDefaultMapState] = useState<DefaultMap>("chargebridge");
  const [loaded, setLoaded] = useState(false);
  const { isSignedIn, getToken } = useAuth();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (v) setDefaultMapState(v as DefaultMap); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    getToken()
      .then((token) => {
        if (!token) return null;
        return fetch(`${BASE}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => (r.ok ? r.json() : null));
      })
      .then((user) => {
        const map = user?.preferences?.defaultMap as DefaultMap | undefined;
        if (map && MAP_OPTIONS.some((o) => o.id === map)) {
          setDefaultMapState(map);
          AsyncStorage.setItem(STORAGE_KEY, map).catch(() => {});
        }
      })
      .catch(() => {});
  }, [isSignedIn, getToken]);

  const setDefaultMap = useCallback(async (map: DefaultMap) => {
    setDefaultMapState(map);
    await AsyncStorage.setItem(STORAGE_KEY, map);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      getToken()
        .then((token) => {
          if (!token) {
            track("default_map_save_no_token", {});
            return;
          }
          return fetch(`${BASE}/api/me`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ preferences: { defaultMap: map } }),
          });
        })
        .catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, [getToken]);

  return { defaultMap, setDefaultMap, loaded };
}

export async function getDefaultMap(): Promise<DefaultMap> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return (v as DefaultMap | null) ?? "chargebridge";
  } catch {
    return "chargebridge";
  }
}

export function openWithDefaultMap(
  lat: number,
  lng: number,
  label: string,
  preference: DefaultMap,
  options?: { alreadyOnMap?: boolean }
): void {
  if (preference === "chargebridge") {
    setNavigationIntent({ lat, lng, label });
    if (!options?.alreadyOnMap) {
      router.push("/(tabs)/map" as any);
    }
    return;
  }

  const encoded = encodeURIComponent(label);
  let url: string;

  if (preference === "waze") {
    url = `waze://?ll=${lat},${lng}&navigate=yes`;
  } else if (preference === "google_maps") {
    url =
      Platform.OS === "ios"
        ? `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`
        : `google.navigation:q=${lat},${lng}`;
  } else {
    url = `maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=d${encoded ? `&q=${encoded}` : ""}`;
  }

  Linking.canOpenURL(url).then((ok) =>
    Linking.openURL(
      ok ? url : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    )
  );
}
