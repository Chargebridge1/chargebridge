import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { usePrimaryVehicle } from "@/hooks/usePrimaryVehicle";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export type NearbyStation = {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  chargerType: string;
  status: string;
  distanceMiles: number;
  pricePerKwh: number | null;
  connectorType: string | null;
  availablePorts: number | null;
  totalPorts: number | null;
  powerKw: number | null;
};

export function useNearbyStation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const primaryVehicle = usePrimaryVehicle();
  const plugTypes = primaryVehicle?.plugTypes ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setLocationDenied(true);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch {
        if (!cancelled) setLocationDenied(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const query = useQuery<NearbyStation | null>({
    queryKey: ["nearby-station-dashboard", coords?.lat, coords?.lng],
    queryFn: async () => {
      const r = await fetch(
        `${BASE}/api/stations/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radiusMiles=10`,
      );
      const stations: NearbyStation[] = await r.json();
      if (!stations || stations.length === 0) return null;
      if (plugTypes && plugTypes.length > 0) {
        const compatible = stations.filter(
          (s) => s.connectorType && plugTypes.includes(s.connectorType),
        );
        return compatible[0] ?? stations[0];
      }
      return stations[0];
    },
    enabled: coords != null,
    staleTime: 5 * 60_000,
  });

  return {
    station: query.data ?? null,
    loading: query.isLoading,
    hasLocation: coords != null,
    locationDenied,
    refetch: query.refetch,
  };
}
