import { useState, useEffect } from "react";
import * as Location from "expo-location";

export type LatLng = { lat: number; lng: number };

export function useCurrentLocation() {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (mounted) {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return { location, loading };
}
