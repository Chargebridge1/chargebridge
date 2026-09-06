import { useQuery } from "@tanstack/react-query";
import { matchStations } from "@workspace/api-client-react";
import type { MatchedStation } from "@workspace/api-client-react";
import type { PrimaryVehicle } from "./usePrimaryVehicle";

export type { MatchedStation };

export interface SmartMatchResult {
  rankedStations: MatchedStation[];
  topStation: MatchedStation | null;
  isLoading: boolean;
}

/**
 * Vehicle-aware station ranking via POST /api/stations/match.
 * Calls the server which looks up the charging profile and applies
 * the 6-factor scorer (connector 30 · speed 20 · SoC 20 · availability 15 · cost 10 · access 5).
 *
 * When no vehicle is present the query is disabled and empty results are returned.
 * Callers should gate the "Best for Me" UI on hasPrimaryVehicle so this branch
 * is never reached in normal operation.
 *
 * currentSocPercent — from AsyncStorage-backed useBatteryState, so it reflects
 * the user's last-set battery level across all tabs.
 * vehicleTrimId — passed when vehicle.catalogTrimId is set, enabling server-side
 * charging profile lookup (dcMaxKw, acMaxKw) for precise speed scoring.
 */
export function useSmartChargerMatch(
  lat: number | null,
  lng: number | null,
  vehicle: PrimaryVehicle | null,
  opts?: { minArrivalSocPercent?: number; currentSocPercent?: number },
): SmartMatchResult {
  const enabled = lat != null && lng != null && vehicle != null;

  const query = useQuery<MatchedStation[]>({
    queryKey: [
      "smart-match",
      lat,
      lng,
      vehicle?.id,
      vehicle?.catalogTrimId,
      opts?.minArrivalSocPercent,
      opts?.currentSocPercent,
    ],
    enabled,
    staleTime: 2 * 60 * 1000,
    queryFn: () =>
      matchStations({
        lat: lat!,
        lng: lng!,
        radiusMiles: 10,
        vehicleTrimId: vehicle!.catalogTrimId ?? undefined,
        connectorType: vehicle!.connectorType ?? undefined,
        plugTypes: vehicle!.plugTypes ?? undefined,
        batteryKwh: vehicle!.batteryKwh ?? undefined,
        rangeMiles: vehicle!.rangePerCharge ?? undefined,
        currentSocPercent: opts?.currentSocPercent ?? undefined,
        minArrivalSocPercent: opts?.minArrivalSocPercent ?? undefined,
        limit: 30,
      }),
  });

  return {
    rankedStations: query.data ?? [],
    topStation: query.data?.[0] ?? null,
    isLoading: enabled && query.isLoading,
  };
}
