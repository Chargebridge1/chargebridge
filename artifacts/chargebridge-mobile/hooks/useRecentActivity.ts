import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export type ActivityEntry = {
  id: number | string;
  stationName: string;
  kwh: number | null;
  amountCents: number | null;
  chargedAt: string;
  durationMinutes?: number | null;
  source?: string;
};

export function useRecentActivity() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery<ActivityEntry | null>({
    queryKey: ["recent-activity-dashboard"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${BASE}/api/charging-history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return null;
      const all: ActivityEntry[] = await r.json();
      return Array.isArray(all) && all.length > 0 ? all[0] : null;
    },
    enabled: isSignedIn === true,
    staleTime: 60_000,
  });
}
