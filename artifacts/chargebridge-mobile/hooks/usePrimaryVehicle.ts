import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export interface PrimaryVehicle {
  id: number;
  clerkUserId: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  connectorType: string | null;
  plugTypes: string[] | null;
  batteryKwh: number | null;
  rangePerCharge: number | null;
  fuelType: string | null;
  mpg: number | null;
  color: string | null;
  isPrimary: boolean;
  createdAt: string;
  /** Catalog trim ID — set when the vehicle was linked to the EV catalog.
   *  Passed to /api/stations/match for precise charging profile lookup. */
  catalogTrimId: number | null;
}

export function usePrimaryVehicle(): PrimaryVehicle | null {
  const { getToken, isSignedIn } = useAuth();

  const { data: vehicles } = useQuery<PrimaryVehicle[]>({
    queryKey: ["me-vehicles"],
    enabled: !!isSignedIn,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const token = await getToken();
      if (!token) return [];
      const res = await fetch(`${BASE}/api/me/vehicles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (!vehicles || vehicles.length === 0) return null;
  return vehicles.find((v) => v.isPrimary) ?? vehicles[0];
}
