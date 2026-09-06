import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useMemo } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CatalogEntry {
  id: number;
  trimId: number;
  modelYearId: number;
  modelId: number;
  manufacturerId: number;
  make: string;
  model: string;
  year: number;
  yearFrom: number | null;
  yearTo: number | null;
  yearDisplay: string;
  trim: string | null;
  trimName: string;
  fuelCategory: string;
  bodyStyle: string | null;
  segment: string | null;
  dcConnector: string | null;
  acConnector: string | null;
  batteryKwh: number | null;
  usableKwh: number | null;
  acMaxKw: number | null;
  dcMaxKw: number | null;
  onboardChargerKw: number | null;
  rangeMiles: number | null;
  typicalMpg: number | null;
  plugAndCharge: boolean | null;
  superchargerEligible: boolean | null;
  source: string;
  isActive: boolean;
}

export interface CatalogVersion {
  version: string | null;
  releasedAt: string | null;
  entryCount: number;
  trimCount: number;
}

export interface VehicleManufacturer {
  id: number;
  name: string;
  slug: string;
  country: string;
  modelCount: number;
}

export interface VehicleModel {
  id: number;
  manufacturerId: number;
  name: string;
  fuelCategory: string;
  bodyStyle: string | null;
  segment: string | null;
  yearCount: number;
}

export interface VehicleModelYear {
  id: number;
  year: number;
  trimCount: number;
}

export interface VehicleTrim {
  id: number;
  modelYearId: number;
  trimName: string;
  msrpUsd: number | null;
  source: string;
  chargingProfile: {
    dcConnector: string | null;
    acConnector: string | null;
    batteryKwh: number | null;
    usableKwh: number | null;
    acMaxKw: number | null;
    dcMaxKw: number | null;
    onboardChargerKw: number | null;
    rangeMiles: number | null;
    typicalMpg: number | null;
    plugAndCharge: boolean | null;
    superchargerEligible: boolean | null;
    notes: string | null;
  } | null;
}

export type CatalogFuelFilter = "BEV" | "PHEV" | "HEV" | "GAS" | "DIESEL" | "E85" | "all";

// ── Cache settings ────────────────────────────────────────────────────────────
const CATALOG_CACHE_KEY    = "@chargebridge/vehicle_catalog_v2";
const VERSION_CACHE_KEY    = "@chargebridge/catalog_version";
const CACHE_TTL_MS         = 24 * 60 * 60 * 1000; // 24 hours
const QUERY_KEY_CATALOG    = ["vehicle-catalog-v2"] as const;
const QUERY_KEY_VERSION    = ["vehicle-catalog-version"] as const;
const QUERY_KEY_MFR        = ["vehicle-manufacturers"] as const;

// ── Base URL helper ───────────────────────────────────────────────────────────
function apiBase() {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
}

// ── Catalog version storage ───────────────────────────────────────────────────
async function readStoredVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(VERSION_CACHE_KEY);
  } catch {
    return null;
  }
}

async function writeStoredVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(VERSION_CACHE_KEY, version);
  } catch {}
}

// ── Catalog local cache ───────────────────────────────────────────────────────
async function readCache(): Promise<{ entries: CatalogEntry[]; ts: number; version: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { entries: CatalogEntry[]; ts: number; version: string | null };
  } catch {
    return null;
  }
}

async function writeCache(entries: CatalogEntry[], version: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ entries, ts: Date.now(), version }));
    if (version) await writeStoredVersion(version);
  } catch {}
}

// ── Fetch catalog version from server ────────────────────────────────────────
async function fetchServerVersion(): Promise<CatalogVersion> {
  const res = await fetch(`${apiBase()}/api/vehicles/version`);
  if (!res.ok) throw new Error(`Version check failed: ${res.status}`);
  return res.json() as Promise<CatalogVersion>;
}

// ── Fetch full catalog from server ────────────────────────────────────────────
async function fetchCatalog(): Promise<CatalogEntry[]> {
  let all: CatalogEntry[] = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const res = await fetch(`${apiBase()}/api/vehicles/search?limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
    const json = (await res.json()) as { entries: CatalogEntry[]; total: number };
    all = all.concat(json.entries);
    if (all.length >= json.total || json.entries.length < limit) break;
    offset += limit;
  }

  return all;
}

// ── Smart cache-first query with version check ────────────────────────────────
// Flow:
//   1. Load local cache (instant)
//   2. Fetch server version
//   3. If server version ≠ cached version → fetch full catalog + update cache
//   4. If same version → return cached data (skip network download)
//
// serverEmpty = true means the server was reachable and responded 200 but
// returned 0 entries (e.g. production DB not seeded). This is a distinct
// condition from a network error (isError) or a search returning no results.
async function queryCatalog(): Promise<{
  entries: CatalogEntry[];
  fromCache: boolean;
  version: string | null;
  serverEmpty: boolean;
}> {
  const cached = await readCache();

  // Try to get server version
  let serverVersion: string | null = null;
  try {
    const sv = await fetchServerVersion();
    serverVersion = sv.version;
  } catch (err) {
    // Network/server error — return cached data if available
    if (cached && cached.entries.length > 0) {
      return { entries: cached.entries, fromCache: true, version: cached.version ?? null, serverEmpty: false };
    }
    // No cache and server unavailable — throw so React Query marks this as an error
    // and the UI can show "Vehicle catalog unavailable" instead of empty results.
    throw err instanceof Error ? err : new Error("Vehicle catalog unavailable");
  }

  // Check if cached data is still valid
  const cacheAge    = cached ? Date.now() - cached.ts : Infinity;
  const versionMatch = cached?.version === serverVersion;
  const cacheValid  = cached && cacheAge < CACHE_TTL_MS && versionMatch && cached.entries.length > 0;

  if (cacheValid) {
    return { entries: cached.entries, fromCache: true, version: serverVersion, serverEmpty: false };
  }

  // Fetch fresh catalog
  try {
    const entries = await fetchCatalog();
    if (entries.length > 0) {
      await writeCache(entries, serverVersion);
      return { entries, fromCache: false, version: serverVersion, serverEmpty: false };
    }
    // Server responded but returned nothing — catalog is empty on the backend
    return { entries: [], fromCache: false, version: serverVersion, serverEmpty: true };
  } catch {
    // Network error during catalog download — fall back to stale cache
    if (cached && cached.entries.length > 0) {
      return { entries: cached.entries, fromCache: true, version: cached.version ?? null, serverEmpty: false };
    }
  }

  // Download failed and no stale cache — treat as server-empty so the UI
  // shows "try again" rather than a generic empty list.
  return { entries: [], fromCache: false, version: serverVersion, serverEmpty: true };
}

// ── Main catalog hook (backward compatible) ───────────────────────────────────
export function useVehicleCatalog() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY_CATALOG,
    queryFn: queryCatalog,
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
    retry: 1,
  });

  const entries    = data?.entries    ?? [];
  const fromCache  = data?.fromCache  ?? false;
  const version    = data?.version    ?? null;
  // True when the server is unreachable AND there is no local cache to fall back on.
  // Consumers should show "Vehicle catalog unavailable" rather than an empty list.
  const isUnavailable = isError && entries.length === 0;
  // True when the server responded successfully but returned 0 entries
  // (e.g. backend DB not seeded, or catalog download failed with no stale cache).
  // Distinct from isUnavailable (network error) and an empty search result.
  const isServerEmpty = !isLoading && !isError && entries.length === 0 && (data?.serverEmpty ?? false);

  const search = useCallback(
    (
      query: string,
      fuels: CatalogFuelFilter[] = ["all"],
      maxResults = 50
    ): CatalogEntry[] => {
      const q    = query.toLowerCase().trim();
      const fuelSet = new Set(fuels);
      const all  = fuelSet.has("all");

      const pool = entries.filter((e) => {
        if (!e.isActive) return false;
        if (!all && !fuelSet.has(e.fuelCategory as CatalogFuelFilter)) return false;
        if (!q) return true;
        return (
          e.make.toLowerCase().includes(q) ||
          e.model.toLowerCase().includes(q) ||
          (e.trim ?? "").toLowerCase().includes(q) ||
          e.yearDisplay.includes(q)
        );
      });

      return pool.slice(0, maxResults);
    },
    [entries]
  );

  const makes = useMemo((): string[] => {
    const seen   = new Set<string>();
    const result: string[] = [];
    for (const e of entries) {
      if (e.isActive && !seen.has(e.make)) {
        seen.add(e.make);
        result.push(e.make);
      }
    }
    return result.sort();
  }, [entries]);

  const modelsForMake = useCallback(
    (make: string): string[] => {
      const seen   = new Set<string>();
      const result: string[] = [];
      for (const e of entries) {
        if (e.isActive && e.make === make && !seen.has(e.model)) {
          seen.add(e.model);
          result.push(e.model);
        }
      }
      return result.sort();
    },
    [entries]
  );

  const yearsForMakeModel = useCallback(
    (make: string, model: string) =>
      entries
        .filter((e) => e.isActive && e.make === make && e.model === model)
        .map((e) => ({ yearFrom: e.yearFrom, yearTo: e.yearTo, yearDisplay: e.yearDisplay }))
        .filter((v, i, arr) => arr.findIndex((x) => x.yearDisplay === v.yearDisplay) === i),
    [entries]
  );

  const trimsForMakeModel = useCallback(
    (make: string, model: string, year?: number): CatalogEntry[] =>
      entries.filter((e) => {
        if (!e.isActive || e.make !== make || e.model !== model) return false;
        if (!year) return true;
        return e.year === year;
      }),
    [entries]
  );

  return {
    entries,
    isLoading,
    isError,
    isUnavailable,
    isServerEmpty,
    fromCache,
    version,
    refetch,
    search,
    makes,
    modelsForMake,
    yearsForMakeModel,
    trimsForMakeModel,
  };
}

// ── Progressive selection hooks (server-side filtering, lightweight payloads) ─

export function useVehicleManufacturers(fuel?: string) {
  return useQuery({
    queryKey: [...QUERY_KEY_MFR, fuel ?? "all"] as const,
    queryFn: async (): Promise<VehicleManufacturer[]> => {
      const url = new URL(`${apiBase()}/api/vehicles/manufacturers`);
      if (fuel && fuel !== "all") url.searchParams.set("fuel", fuel);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Failed to fetch manufacturers: ${res.status}`);
      return res.json() as Promise<VehicleManufacturer[]>;
    },
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });
}

export function useVehicleModels(manufacturerId?: number, fuel?: string) {
  return useQuery({
    queryKey: ["vehicle-models", manufacturerId ?? null, fuel ?? "all"] as const,
    enabled: manufacturerId != null,
    queryFn: async (): Promise<VehicleModel[]> => {
      const url = new URL(`${apiBase()}/api/vehicles/models`);
      if (manufacturerId) url.searchParams.set("manufacturerId", String(manufacturerId));
      if (fuel && fuel !== "all") url.searchParams.set("fuel", fuel);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
      return res.json() as Promise<VehicleModel[]>;
    },
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });
}

export function useVehicleYears(modelId?: number) {
  return useQuery({
    queryKey: ["vehicle-years", modelId ?? null] as const,
    enabled: modelId != null,
    queryFn: async (): Promise<VehicleModelYear[]> => {
      if (!modelId) return [];
      const res = await fetch(`${apiBase()}/api/vehicles/years?modelId=${modelId}`);
      if (!res.ok) throw new Error(`Failed to fetch years: ${res.status}`);
      return res.json() as Promise<VehicleModelYear[]>;
    },
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });
}

export function useVehicleTrims(modelYearId?: number) {
  return useQuery({
    queryKey: ["vehicle-trims", modelYearId ?? null] as const,
    enabled: modelYearId != null,
    queryFn: async (): Promise<VehicleTrim[]> => {
      if (!modelYearId) return [];
      const res = await fetch(`${apiBase()}/api/vehicles/trims?modelYearId=${modelYearId}`);
      if (!res.ok) throw new Error(`Failed to fetch trims: ${res.status}`);
      return res.json() as Promise<VehicleTrim[]>;
    },
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });
}

export function useVehicleChargingProfile(trimId?: number) {
  return useQuery({
    queryKey: ["vehicle-charging-profile", trimId ?? null] as const,
    enabled: trimId != null,
    queryFn: async (): Promise<CatalogEntry | null> => {
      if (!trimId) return null;
      const res = await fetch(`${apiBase()}/api/vehicles/${trimId}/charging-profile`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to fetch charging profile: ${res.status}`);
      return res.json() as Promise<CatalogEntry>;
    },
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });
}

export function useCatalogVersion() {
  return useQuery({
    queryKey: QUERY_KEY_VERSION,
    queryFn: fetchServerVersion,
    staleTime: 5 * 60 * 1000,    // re-check version every 5 minutes
    gcTime:   30 * 60 * 1000,
    retry: 2,
  });
}

// ── Catalog entry → Vehicle mapper (exported for consumers) ──────────────────
export function catalogFuelCategory(fc: string): "electric" | "phev_hybrid" | "gas_diesel" {
  if (fc === "BEV") return "electric";
  if (fc === "PHEV" || fc === "HEV") return "phev_hybrid";
  return "gas_diesel";
}

export function catalogFuelType(fc: string): "regular" | "premium" | "diesel" | "e85" | "hybrid" | undefined {
  if (fc === "DIESEL") return "diesel";
  if (fc === "E85")    return "e85";
  if (fc === "HEV" || fc === "PHEV") return "hybrid";
  return undefined;
}

export function catalogToVehicle(e: CatalogEntry): {
  id: string; name: string; make: string; model: string; yearRange: string;
  fuelCategory: "electric" | "phev_hybrid" | "gas_diesel";
  dcConnector?: "NACS" | "CCS" | "CHAdeMO" | null;
  acConnector?: "J1772" | "NACS";
  fuelType?: "regular" | "premium" | "diesel" | "e85" | "hybrid";
  typicalMpg?: number; batteryKwh?: number; usableKwh?: number; rangeMiles?: number;
  acMaxKw?: number; dcMaxKw?: number; onboardChargerKw?: number;
  plugAndCharge?: boolean; superchargerEligible?: boolean;
} {
  return {
    id:                   `cat-${e.id}`,
    name:                 e.trim ? `${e.make} ${e.model} ${e.trim}` : `${e.make} ${e.model}`,
    make:                 e.make,
    model:                e.model,
    yearRange:            e.yearDisplay,
    fuelCategory:         catalogFuelCategory(e.fuelCategory),
    dcConnector:          (e.dcConnector as "NACS" | "CCS" | "CHAdeMO" | null) ?? null,
    acConnector:          (e.acConnector as "J1772" | "NACS") ?? undefined,
    fuelType:             catalogFuelType(e.fuelCategory),
    typicalMpg:           e.typicalMpg           ?? undefined,
    batteryKwh:           e.batteryKwh           ?? undefined,
    usableKwh:            e.usableKwh            ?? undefined,
    rangeMiles:           e.rangeMiles           ?? undefined,
    acMaxKw:              e.acMaxKw              ?? undefined,
    dcMaxKw:              e.dcMaxKw              ?? undefined,
    onboardChargerKw:     e.onboardChargerKw     ?? undefined,
    plugAndCharge:        e.plugAndCharge        ?? undefined,
    superchargerEligible: e.superchargerEligible ?? undefined,
  };
}

// ── Prefetch helper (call in AppShell on launch) ──────────────────────────────
export async function prefetchVehicleCatalog(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: QUERY_KEY_CATALOG,
    queryFn: queryCatalog,
    staleTime: CACHE_TTL_MS,
  });
}
