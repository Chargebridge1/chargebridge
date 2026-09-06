import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Linking,
  Modal,
  KeyboardAvoidingView,
  FlatList,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { haversineDistance } from "@/utils/distance";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import { NativeMapView } from "@/components/NativeMapView";
import { QuickRateSheet } from "@/components/QuickRateSheet";

const MAP_POSITION_KEY = "chargebridge:lastMapPosition";

type SavedMapPosition = { lat: number; lng: number; zoom: number };

// Within-session cache: populated once storage is read, reused on subsequent opens
// without incurring another async read.
let _sessionPosition: SavedMapPosition | null = null;

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type EvStation = {
  id: string;
  source: "osm" | "community";
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  chargerType: "Level1" | "Level2" | "DCFC";
  powerKw: number | null;
  pricePerKwh: number | null;
  priceText: string | null;
  isFree: boolean;
  pricingUrl: string | null;
  totalPorts: number | null;
  availablePorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  network: string | null;
  ocppChargePointId?: string | null;
  distanceMiles: number;
  averageRating?: number | null;
  reviewCount?: number;
};

function statusColor(s: string) {
  return s === "available" ? "#22c55e" : s === "busy" ? "#f59e0b" : s === "offline" ? "#ef4444" : "#94a3b8";
}

function stationCta(s: EvStation): "charge_now" | "network_app" | "charge_here" {
  if (s.ocppChargePointId) return "charge_now";
  if (getNetworkLink(s.network)) return "network_app";
  return "charge_here";
}

function priceLabel(s: EvStation): string {
  if (s.isFree) return "Free";
  if (s.priceText) return s.priceText;
  if (s.pricePerKwh) return `$${Number(s.pricePerKwh).toFixed(2)}/kWh`;
  return "";
}

function chargerLabel(t: string) {
  return t === "DCFC" ? "DC Fast" : t === "Level2" ? "Level 2" : "Level 1";
}

function goInApp(lat: number, lng: number, label: string) {
  setNavigationIntent({ lat, lng, label });
  router.push("/(tabs)/map" as any);
}

function WebLeafletMap({
  stations,
  userLat,
  userLng,
  activeLat,
  activeLng,
  initialLat,
  initialLng,
  initialZoom,
  onClose,
  onStationSelect,
  onMapMove,
}: {
  stations: EvStation[];
  userLat: number | null;
  userLng: number | null;
  activeLat: number | null;
  activeLng: number | null;
  initialLat?: number | null;
  initialLng?: number | null;
  initialZoom?: number;
  onClose: () => void;
  onStationSelect: (s: EvStation) => void;
  onMapMove?: (lat: number, lng: number, zoom: number) => void;
}) {
  const mapRef = useRef<any>(null);
  const instanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const onSelectRef = useRef(onStationSelect);
  onSelectRef.current = onStationSelect;
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  // Mount the map once
  useEffect(() => {
    const tryMount = () => {
      if (!mapRef.current || initializedRef.current) return;
      const L = (globalThis as any).L;
      if (!L) return;

      initializedRef.current = true;
      const startLat = initialLat ?? 39.5;
      const startLng = initialLng ?? -98.35;
      const startZoom = initialLat != null ? (initialZoom ?? 12) : 4;
      const map = L.map(mapRef.current, { zoomControl: true }).setView([startLat, startLng], startZoom);
      instanceRef.current = map;

      map.on("moveend zoomend", () => {
        const c = map.getCenter();
        const z = map.getZoom();
        onMapMoveRef.current?.(c.lat, c.lng, z);
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
    };

    const loadLeaflet = () => {
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if ((globalThis as any).L) {
        tryMount();
      } else if (!document.getElementById("leaflet-js")) {
        const script = document.createElement("script");
        script.id = "leaflet-js";
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.onload = tryMount;
        document.head.appendChild(script);
      } else {
        const check = setInterval(() => {
          if ((globalThis as any).L) { clearInterval(check); tryMount(); }
        }, 100);
        return () => clearInterval(check);
      }
    };

    loadLeaflet();
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
        initializedRef.current = false;
      }
    };
  }, []);

  // Fly to active location when it changes (only fires when activeLat/activeLng are non-null,
  // which only happens when the parent has cleared restoredLoc, so this won't override a restored view)
  useEffect(() => {
    const map = instanceRef.current;
    if (!map || activeLat == null || activeLng == null) return;
    map.flyTo([activeLat, activeLng], 13, { duration: 1.2 });
  }, [activeLat, activeLng]);

  // Reposition the map when the restored position arrives after the initial setView
  // (covers the async-storage race where storage loads after the Leaflet map is already mounted)
  const repositionedRef = useRef(false);
  useEffect(() => {
    const map = instanceRef.current;
    if (!map || initialLat == null || initialLng == null) return;
    if (!repositionedRef.current) {
      repositionedRef.current = true;
      // Map was already setView'd to this in the mount effect — skip if values match
      const c = map.getCenter();
      if (Math.abs(c.lat - initialLat) < 0.0001 && Math.abs(c.lng - initialLng) < 0.0001) return;
    }
    map.setView([initialLat, initialLng], initialZoom ?? 12, { animate: false });
  }, [initialLat, initialLng, initialZoom]);

  // Update user location dot
  useEffect(() => {
    const map = instanceRef.current;
    const L = (globalThis as any).L;
    if (!map || !L || userLat == null || userLng == null) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLat, userLng]);
    } else {
      userMarkerRef.current = L.circleMarker([userLat, userLng], {
        radius: 10,
        fillColor: "#0D9E7E",
        color: "#fff",
        weight: 3,
        fillOpacity: 1,
      }).addTo(map).bindPopup("<b>Your location</b>");
    }
  }, [userLat, userLng]);

  // Update station markers when stations change
  useEffect(() => {
    const map = instanceRef.current;
    const L = (globalThis as any).L;
    if (!map || !L) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    stations.forEach((s) => {
      const dot = statusColor(s.status);
      const isCommunity = s.source === "community";
      const pinBg = isCommunity ? "#0D9E7E" : "#3b82f6";
      const shortName = s.name.length > 18 ? s.name.slice(0, 16) + "…" : s.name;

      const icon = L.divIcon({
        html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:pointer">
          <div style="width:32px;height:32px;border-radius:50%;background:${pinBg};border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;position:relative">
            <span style="color:white;font-size:14px">⚡</span>
            <div style="position:absolute;bottom:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:${dot};border:2px solid white"></div>
          </div>
          <div style="margin-top:3px;background:rgba(0,0,0,0.72);color:white;font-size:9px;font-weight:600;padding:2px 5px;border-radius:4px;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;pointer-events:none">${shortName}</div>
        </div>`,
        className: "",
        iconSize: [90, 52],
        iconAnchor: [45, 34],
      });

      const marker = L.marker([s.lat, s.lng], { icon }).addTo(map);
      marker.on("click", () => { onSelectRef.current(s); });
      markersRef.current.push(marker);
    });
  }, [stations]);

  return <View ref={mapRef} style={StyleSheet.absoluteFill} />;
}

const RADII = [10, 25, 50, 100];

type Props = {
  visible: boolean;
  onClose: () => void;
  chargerFilter?: "all" | "Level1" | "Level2" | "DCFC";
  networkFilter?: string | null;
  connectorFilter?: string | null;
  onClearFilters?: () => void;
  onEditFilters?: () => void;
  initialRadius?: number;
  onRadiusChange?: (r: number) => void;
};

export function MapModal({ visible, onClose, chargerFilter, networkFilter, connectorFilter, onClearFilters, onEditFilters, initialRadius, onRadiusChange }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 0 : insets.top;

  // GPS location
  const [gpsLoc, setGpsLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Search-based location
  const [searchText, setSearchText] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoc, setSearchLoc] = useState<{ lat: number; lng: number; name: string } | null>(null);

  // Restored location from the last session (cleared once the user picks a new location)
  const [restoredLoc, setRestoredLoc] = useState<{ lat: number; lng: number; zoom: number } | null>(null);

  // Position loaded from AsyncStorage (initialised asynchronously; null until loaded)
  const [persistedPosition, setPersistedPosition] = useState<SavedMapPosition | null>(
    _sessionPosition ?? null
  );

  // Load from AsyncStorage once on mount; skip if already in the session cache
  useEffect(() => {
    if (_sessionPosition) return;
    AsyncStorage.getItem(MAP_POSITION_KEY)
      .then((raw) => {
        if (raw) {
          const pos: SavedMapPosition = JSON.parse(raw);
          _sessionPosition = pos;
          setPersistedPosition(pos);
        }
      })
      .catch(() => {});
  }, []);

  const [radius, setRadius] = useState(initialRadius ?? 25);

  // Sync radius whenever the caller's initialRadius changes (covers both open and mid-session updates from filter sheet)
  useEffect(() => {
    if (visible) {
      setRadius(initialRadius ?? 25);
    }
  }, [visible, initialRadius]);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [showList, setShowList] = useState(false);
  const [selectedStation, setSelectedStation] = useState<EvStation | null>(null);
  const [rateVisible, setRateVisible] = useState(false);

  // Active center: prefer search result over GPS
  const activeLoc = searchLoc ?? gpsLoc;

  // Map viewport tracking — updated on every Leaflet moveend/zoomend (includes zoom level)
  const [mapViewCenter, setMapViewCenter] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  // User-confirmed "Search this area" center (overrides activeLoc for the query)
  const [searchAreaLoc, setSearchAreaLoc] = useState<{ lat: number; lng: number } | null>(null);

  // Clear searchAreaLoc when the primary location changes (new GPS fix or city search)
  useEffect(() => { setSearchAreaLoc(null); }, [gpsLoc, searchLoc]);

  // The center used for the API query:
  // user-pinned area > restored last viewport > GPS/search > nothing
  // restoredLoc takes priority over GPS so the station list matches the restored map view;
  // it is cleared the moment the user explicitly taps crosshair or submits a city search.
  const effectiveLoc = searchAreaLoc ?? restoredLoc ?? activeLoc;

  // Restore last map position when modal opens — runs on open AND when persistedPosition loads
  // (handles the race where modal opens before AsyncStorage read completes).
  // No GPS/search guard: saved viewport always takes precedence until the user explicitly
  // navigates somewhere new (crosshair tap or city search clears restoredLoc).
  useEffect(() => {
    if (visible && persistedPosition) {
      setRestoredLoc({ lat: persistedPosition.lat, lng: persistedPosition.lng, zoom: persistedPosition.zoom });
    }
  }, [visible, persistedPosition]);

  // Save the actual viewport center (where the user was looking) when the modal closes.
  // Falls back to effectiveLoc when the user never panned (i.e. mapViewCenter is still null).
  const mapViewCenterRef = useRef(mapViewCenter);
  mapViewCenterRef.current = mapViewCenter;
  const effectiveLocRef = useRef(effectiveLoc);
  effectiveLocRef.current = effectiveLoc;
  useEffect(() => {
    if (!visible) {
      const viewport = mapViewCenterRef.current;
      const fallback = effectiveLocRef.current;
      const center = viewport ?? (fallback ? { lat: fallback.lat, lng: fallback.lng, zoom: 12 } : null);
      if (center) {
        const saved: SavedMapPosition = { lat: center.lat, lng: center.lng, zoom: center.zoom };
        _sessionPosition = saved;
        setPersistedPosition(saved);
        AsyncStorage.setItem(MAP_POSITION_KEY, JSON.stringify(saved)).catch(() => {});
      }
    }
  }, [visible]);

  // Show "Search this area" button when map has panned > 0.5 mi from the current query center
  const showSearchHere = !!(
    mapViewCenter &&
    effectiveLoc &&
    haversineDistance(mapViewCenter.lat, mapViewCenter.lng, effectiveLoc.lat, effectiveLoc.lng) > 0.5
  );

  const { data: stations, isLoading: stationsLoading } = useQuery<EvStation[]>({
    queryKey: ["ev-stations-map-modal", effectiveLoc?.lat, effectiveLoc?.lng, radius],
    enabled: !!effectiveLoc && visible,
    staleTime: 30000,
    refetchInterval: 60000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations?lat=${effectiveLoc!.lat}&lng=${effectiveLoc!.lng}&radius=${radius}`);
      if (!r.ok) throw new Error("Failed to fetch stations");
      return r.json();
    },
  });

  const getGps = useCallback(async () => {
    setGpsLoading(true);
    setRestoredLoc(null);
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } else {
        await new Promise<void>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (p) => { setGpsLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); resolve(); },
            () => resolve(),
            { timeout: 10000, maximumAge: 60000 }
          )
        );
      }
    } finally {
      setGpsLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    setSearchLoading(true);
    setRestoredLoc(null);
    try {
      const res = await fetch(
        `${BASE}/api/geocode?q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (data[0]) {
        setSearchLoc({
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          name: data[0].display_name.split(",").slice(0, 2).join(","),
        });
      }
    } finally {
      setSearchLoading(false);
    }
  }, [searchText]);

  useEffect(() => {
    if (visible && !gpsLoc) getGps();
  }, [visible]);

  // Reset search when closing
  useEffect(() => {
    if (!visible) {
      setSearchText("");
      setSearchLoc(null);
    }
  }, [visible]);

  function handleAction(station: EvStation) {
    const cta = stationCta(station);
    if (cta === "network_app" && station.network) {
      openNetworkApp(station.network, Linking);
    } else if (cta === "charge_now" || (cta === "charge_here" && station.source === "community")) {
      onClose();
      setTimeout(() => router.push(`/station/${station.id}?charge=1` as any), 300);
    } else {
      goInApp(station.lat, station.lng, station.name);
    }
  }

  const stationList = stations ?? [];

  const activeExploreFilterCount = [
    chargerFilter && chargerFilter !== "all",
    !!networkFilter,
    !!connectorFilter,
  ].filter(Boolean).length;

  const filteredByExplore = stationList.filter((s) => {
    if (chargerFilter && chargerFilter !== "all" && s.chargerType !== chargerFilter) return false;
    if (networkFilter && !s.network?.toLowerCase().includes(networkFilter.toLowerCase())) return false;
    if (connectorFilter && !(s as any).connectorTypes?.includes(connectorFilter)) return false;
    return true;
  });

  const displayedStations = availableOnly
    ? filteredByExplore.filter((s) => s.status === "available" || s.status === "unknown")
    : filteredByExplore;
  const isAnythingLoading = gpsLoading || stationsLoading || searchLoading;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[S.root, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[S.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
            <View style={S.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[S.title, { color: colors.foreground }]}>EV Map</Text>
                <Text style={[S.sub, { color: colors.mutedForeground }]}>
                  {isAnythingLoading
                    ? (gpsLoading ? "Locating you…" : stationsLoading ? "Loading stations…" : "Searching…")
                    : searchAreaLoc
                    ? `Area search · ${stationList.length} stations`
                    : searchLoc
                    ? `${searchLoc.name} · ${stationList.length} stations`
                    : activeLoc
                    ? `${stationList.length} stations · ${radius} mi`
                    : restoredLoc
                    ? `Last location · ${stationList.length} stations`
                    : "Search a city or allow location"}
                </Text>
              </View>
              <View style={S.headerRight}>
                <View style={S.radiusPills}>
                  {RADII.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[S.pill, { backgroundColor: radius === r ? colors.primary : colors.muted }]}
                      onPress={() => { Haptics.selectionAsync(); setRadius(r); onRadiusChange?.(r); }}
                    >
                      <Text style={[S.pillTxt, { color: radius === r ? colors.primaryForeground : colors.mutedForeground }]}>
                        {r}mi
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[S.iconBtn, { backgroundColor: colors.primary + "18" }]}
                  onPress={() => { setSearchLoc(null); getGps(); }}
                >
                  <Feather name="crosshair" size={17} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.muted }]} onPress={onClose}>
                  <Ionicons name="close" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Search bar */}
            <View style={[S.searchRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="search" size={15} color={colors.mutedForeground} style={{ marginLeft: 10 }} />
              <TextInput
                style={[S.searchInput, { color: colors.foreground }]}
                placeholder="Search city, address, country…"
                placeholderTextColor={colors.mutedForeground}
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {searchLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
              ) : searchText.length > 0 ? (
                <TouchableOpacity onPress={handleSearch} style={S.searchBtn}>
                  <Text style={[S.searchBtnTxt, { color: colors.primaryForeground, backgroundColor: colors.primary }]}>Go</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Filter row: Available Only + List toggle */}
            <View style={S.filterRow}>
              <TouchableOpacity
                style={[
                  S.filterPill,
                  availableOnly
                    ? { backgroundColor: "#22c55e" }
                    : { backgroundColor: colors.muted },
                ]}
                onPress={() => { Haptics.selectionAsync(); setAvailableOnly((v) => !v); }}
              >
                <Ionicons
                  name={availableOnly ? "checkmark-circle" : "checkmark-circle-outline"}
                  size={14}
                  color={availableOnly ? "#fff" : colors.mutedForeground}
                />
                <Text style={[S.filterPillTxt, { color: availableOnly ? "#fff" : colors.mutedForeground }]}>
                  Available only
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  S.filterPill,
                  showList
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.muted },
                ]}
                onPress={() => { Haptics.selectionAsync(); setShowList((v) => !v); }}
              >
                <Feather name="list" size={13} color={showList ? "#fff" : colors.mutedForeground} />
                <Text style={[S.filterPillTxt, { color: showList ? "#fff" : colors.mutedForeground }]}>
                  {showList ? "Hide list" : "Show list"}
                </Text>
              </TouchableOpacity>

              {availableOnly && (
                <Text style={[S.filterCount, { color: colors.mutedForeground }]}>
                  {displayedStations.length} available
                </Text>
              )}
            </View>

            {/* Active explore filter indicator */}
            {activeExploreFilterCount > 0 && (
              <View style={[S.activeFiltersRow, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
                <Feather name="filter" size={12} color={colors.primary} />
                <Text style={[S.activeFiltersTxt, { color: colors.primary }]} numberOfLines={1}>
                  {activeExploreFilterCount === 1
                    ? "1 explore filter active"
                    : `${activeExploreFilterCount} explore filters active`}
                  {networkFilter ? ` · ${networkFilter.split(";")[0].trim()}` : ""}
                  {chargerFilter && chargerFilter !== "all"
                    ? ` · ${chargerFilter === "DCFC" ? "DC Fast" : chargerFilter === "Level2" ? "Level 2" : "Level 1"}`
                    : ""}
                  {connectorFilter ? ` · ${connectorFilter}` : ""}
                </Text>
                <Text style={[S.activeFiltersCount, { color: colors.primary }]}>
                  {displayedStations.length} match{displayedStations.length !== 1 ? "es" : ""}
                </Text>
                {onEditFilters && (
                  <TouchableOpacity
                    onPress={() => { Haptics.selectionAsync(); onEditFilters(); }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={[S.editFiltersBtn, { backgroundColor: colors.primary + "28", borderColor: colors.primary + "60" }]}
                    activeOpacity={0.75}
                  >
                    <Feather name="sliders" size={11} color={colors.primary} />
                    <Text style={[S.editFiltersTxt, { color: colors.primary }]}>Edit</Text>
                  </TouchableOpacity>
                )}
                {onClearFilters && (
                  <TouchableOpacity
                    onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClearFilters(); }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={[S.clearFiltersBtn, { backgroundColor: colors.primary }]}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="close" size={11} color="#fff" />
                    <Text style={S.clearFiltersTxt}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Map — always rendered */}
          <View style={[S.mapWrapper, showList && { flex: 0.55 }]}>
            {isWeb ? (
              <WebLeafletMap
                stations={displayedStations}
                userLat={gpsLoc?.lat ?? null}
                userLng={gpsLoc?.lng ?? null}
                activeLat={restoredLoc ? null : (activeLoc?.lat ?? null)}
                activeLng={restoredLoc ? null : (activeLoc?.lng ?? null)}
                initialLat={restoredLoc?.lat ?? null}
                initialLng={restoredLoc?.lng ?? null}
                initialZoom={restoredLoc?.zoom ?? 12}
                onClose={onClose}
                onStationSelect={setSelectedStation}
                onMapMove={(lat, lng, zoom) => setMapViewCenter({ lat, lng, zoom })}
              />
            ) : (
              <NativeMapView
                stations={displayedStations}
                userLat={effectiveLoc?.lat ?? 39.5}
                userLng={effectiveLoc?.lng ?? -98.35}
                onAction={setSelectedStation}
                onDirections={(s) => goInApp(s.lat, s.lng, s.name)}
              />
            )}

            {/* Search this area button — appears when map has panned away from query center */}
            {showSearchHere && !isAnythingLoading && (
              <TouchableOpacity
                style={[S.searchHereBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  if (mapViewCenter) {
                    setSearchAreaLoc(mapViewCenter);
                    Haptics.selectionAsync();
                  }
                }}
                activeOpacity={0.85}
              >
                <Feather name="search" size={12} color={colors.foreground} />
                <Text style={[S.searchHereTxt, { color: colors.foreground }]}>Search this area</Text>
              </TouchableOpacity>
            )}

            {/* Loading badge overlay */}
            {isAnythingLoading && (
              <View style={[S.loadingBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[S.loadingTxt, { color: colors.foreground }]}>
                  {gpsLoading ? "Getting location…" : searchLoading ? "Searching…" : "Loading stations…"}
                </Text>
              </View>
            )}

            {/* Prompt when no location and not loading */}
            {!activeLoc && !restoredLoc && !isAnythingLoading && (
              <View style={[S.promptOverlay, { backgroundColor: colors.card + "EE", borderColor: colors.border }]}>
                <Ionicons name="map-outline" size={32} color={colors.mutedForeground} />
                <Text style={[S.promptTitle, { color: colors.foreground }]}>Find EV chargers anywhere</Text>
                <Text style={[S.promptSub, { color: colors.mutedForeground }]}>
                  Search a city above, or tap the crosshair to use your location
                </Text>
                <TouchableOpacity style={[S.promptBtn, { backgroundColor: colors.primary }]} onPress={getGps}>
                  <Feather name="crosshair" size={14} color="#fff" />
                  <Text style={S.promptBtnTxt}>Use My Location</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Station count badge */}
            {effectiveLoc && !isAnythingLoading && displayedStations.length > 0 && (
              <View style={[S.countBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="flash" size={12} color={colors.primary} />
                <Text style={[S.countTxt, { color: colors.foreground }]}>
                  {displayedStations.length} station{displayedStations.length !== 1 ? "s" : ""}
                  {availableOnly ? " available" : ""}
                </Text>
              </View>
            )}
          </View>

          {/* List panel — shown when showList is true */}
          {showList && (
            <View style={[S.listPanel, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
              <FlatList
                data={displayedStations}
                keyExtractor={(s) => s.id}
                horizontal={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={S.listPanelContent}
                ListEmptyComponent={
                  <View style={S.listEmpty}>
                    <Ionicons name="flash-outline" size={28} color={colors.mutedForeground} />
                    <Text style={[S.listEmptyTxt, { color: colors.mutedForeground }]}>
                      {availableOnly ? "No available stations in this area" : "No stations in this area"}
                    </Text>
                  </View>
                }
                renderItem={({ item: s }) => (
                  <TouchableOpacity
                    style={[S.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => { Haptics.selectionAsync(); setSelectedStation(s); }}
                    activeOpacity={0.8}
                  >
                    <View style={[S.listCardIcon, { backgroundColor: colors.primary + "18" }]}>
                      <Ionicons name="flash" size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.listCardName, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
                      <Text style={[S.listCardAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {[s.address, s.city].filter(Boolean).join(", ") || "Address unknown"}
                      </Text>
                    </View>
                    <View style={S.listCardRight}>
                      <View style={[S.listDot, {
                        backgroundColor: s.status === "available" ? "#22c55e"
                          : s.status === "busy" ? "#f59e0b"
                          : s.status === "offline" ? "#ef4444" : "#94a3b8",
                      }]} />
                      <TouchableOpacity
                        onPress={() => goInApp(s.lat, s.lng, s.name)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                          <Feather name="navigation" size={9} color={colors.primary} />
                          <Text style={[S.listCardDist, { color: colors.primary }]}>
                            {Number(s.distanceMiles).toFixed(1)} mi
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>

          {/* Reviews sheet — mounts on top of the bottom sheet */}
          {selectedStation && rateVisible && (
            <QuickRateSheet
              visible={rateVisible}
              stationId={selectedStation.source === "community" ? Number(selectedStation.id.replace(/^db-/, "")) : undefined}
              externalId={selectedStation.source !== "community" ? selectedStation.id : undefined}
              stationName={selectedStation.name}
              onClose={() => setRateVisible(false)}
            />
          )}

          {/* Station detail bottom sheet */}
          {selectedStation && (
            <View style={S.sheetBackdrop}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSelectedStation(null)} />
              <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Drag handle */}
                <View style={[S.sheetHandle, { backgroundColor: colors.border }]} />

                {/* Station header */}
                <View style={S.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    {selectedStation.source === "community" && (
                      <View style={[S.sheetBadge, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={[S.sheetBadgeTxt, { color: colors.primary }]}>COMMUNITY</Text>
                      </View>
                    )}
                    <Text style={[S.sheetName, { color: colors.foreground }]} numberOfLines={2}>
                      {selectedStation.name}
                    </Text>
                    {selectedStation.network && (
                      <Text style={[S.sheetNetwork, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {selectedStation.network}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => setSelectedStation(null)} style={[S.sheetClose, { backgroundColor: colors.muted }]}>
                    <Ionicons name="close" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>

                {/* Address */}
                {(selectedStation.address || selectedStation.city) && (
                  <View style={S.sheetAddrRow}>
                    <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                    <Text style={[S.sheetAddr, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {[selectedStation.address, selectedStation.city, selectedStation.state].filter(Boolean).join(", ")}
                    </Text>
                  </View>
                )}

                {/* Status + type + power + distance pills */}
                <View style={S.sheetPills}>
                  <View style={[S.sheetPill, { backgroundColor: statusColor(selectedStation.status) + "22" }]}>
                    <View style={[S.sheetStatusDot, { backgroundColor: statusColor(selectedStation.status) }]} />
                    <Text style={[S.sheetPillTxt, { color: statusColor(selectedStation.status) }]}>
                      {selectedStation.status === "unknown" ? "Status unknown"
                        : selectedStation.status.charAt(0).toUpperCase() + selectedStation.status.slice(1)}
                    </Text>
                  </View>
                  <View style={[S.sheetPill, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={[S.sheetPillTxt, { color: colors.primary }]}>{chargerLabel(selectedStation.chargerType)}</Text>
                  </View>
                  {selectedStation.powerKw != null && (
                    <View style={[S.sheetPill, { backgroundColor: colors.muted }]}>
                      <Text style={[S.sheetPillTxt, { color: colors.mutedForeground }]}>{selectedStation.powerKw} kW</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[S.sheetPill, { backgroundColor: colors.primary + "18" }]}
                    onPress={() => goInApp(selectedStation.lat, selectedStation.lng, selectedStation.name)}
                  >
                    <Feather name="navigation" size={11} color={colors.primary} />
                    <Text style={[S.sheetPillTxt, { color: colors.primary }]}>{Number(selectedStation.distanceMiles).toFixed(1)} mi</Text>
                  </TouchableOpacity>
                </View>

                {/* Ports + Price row */}
                {(selectedStation.availablePorts != null || selectedStation.isFree || selectedStation.priceText || selectedStation.pricePerKwh) && (
                  <View style={[S.sheetMetaRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    {selectedStation.availablePorts != null && selectedStation.totalPorts != null && (
                      <View style={S.sheetMeta}>
                        <Text style={[S.sheetMetaVal, { color: selectedStation.availablePorts > 0 ? "#22c55e" : colors.foreground }]}>
                          {selectedStation.availablePorts}/{selectedStation.totalPorts}
                        </Text>
                        <Text style={[S.sheetMetaLbl, { color: colors.mutedForeground }]}>ports open</Text>
                      </View>
                    )}
                    {(selectedStation.isFree || selectedStation.priceText || selectedStation.pricePerKwh) && (
                      <View style={S.sheetMeta}>
                        <Text style={[S.sheetMetaVal, { color: colors.foreground }]}>{priceLabel(selectedStation) || "—"}</Text>
                        <Text style={[S.sheetMetaLbl, { color: colors.mutedForeground }]}>per kWh</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Star rating row */}
                <TouchableOpacity
                  style={S.sheetRatingRow}
                  onPress={() => { Haptics.selectionAsync(); setRateVisible(true); }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <View style={{ flexDirection: "row", gap: 3 }}>
                    {[1,2,3,4,5].map((n) => {
                      const filled = selectedStation.averageRating != null && n <= Math.round(selectedStation.averageRating);
                      return (
                        <Ionicons key={n} name={filled ? "star" : "star-outline"} size={15}
                          color={filled ? "#f59e0b" : "#cbd5e1"} />
                      );
                    })}
                  </View>
                  {selectedStation.averageRating != null && selectedStation.averageRating > 0 ? (
                    <>
                      <Text style={[S.sheetRatingNum, { color: colors.foreground }]}>
                        {selectedStation.averageRating.toFixed(1)}
                      </Text>
                      <Text style={[S.sheetRatingCount, { color: colors.mutedForeground }]}>
                        ({selectedStation.reviewCount ?? 0} review{(selectedStation.reviewCount ?? 0) !== 1 ? "s" : ""})
                      </Text>
                    </>
                  ) : (
                    <Text style={[S.sheetRatingCount, { color: colors.primary }]}>Tap to rate</Text>
                  )}
                  <Feather name="chevron-right" size={13} color={colors.mutedForeground} style={{ marginLeft: "auto" }} />
                </TouchableOpacity>

                {/* Action buttons */}
                <View style={S.sheetActions}>
                  <TouchableOpacity
                    style={[S.sheetBtn, { backgroundColor: colors.muted, flex: 1 }]}
                    onPress={() => { Haptics.selectionAsync(); goInApp(selectedStation.lat, selectedStation.lng, selectedStation.name); }}
                  >
                    <Feather name="navigation" size={15} color={colors.foreground} />
                    <Text style={[S.sheetBtnTxt, { color: colors.foreground }]}>Directions</Text>
                  </TouchableOpacity>

                  {stationCta(selectedStation) === "charge_now" && (
                    <TouchableOpacity
                      style={[S.sheetBtn, { backgroundColor: colors.primary, flex: 1.4 }]}
                      onPress={() => {
                        setSelectedStation(null);
                        onClose();
                        setTimeout(() => router.push(`/station/${selectedStation.id}?charge=1` as any), 300);
                      }}
                    >
                      <Ionicons name="flash" size={15} color="#fff" />
                      <Text style={[S.sheetBtnTxt, { color: "#fff" }]}>Charge Now</Text>
                    </TouchableOpacity>
                  )}

                  {stationCta(selectedStation) === "network_app" && selectedStation.network && (
                    <TouchableOpacity
                      style={[S.sheetBtn, { backgroundColor: "#3b82f6", flex: 1.4 }]}
                      onPress={() => { openNetworkApp(selectedStation.network!, Linking); }}
                    >
                      <Feather name="external-link" size={15} color="#fff" />
                      <Text style={[S.sheetBtnTxt, { color: "#fff" }]} numberOfLines={1}>
                        Open {getNetworkLink(selectedStation.network)?.label ?? selectedStation.network}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {stationCta(selectedStation) === "charge_here" && (
                    <TouchableOpacity
                      style={[S.sheetBtn, { backgroundColor: colors.primary, flex: 1.4 }]}
                      onPress={() => {
                        if (selectedStation.source === "community") {
                          setSelectedStation(null);
                          onClose();
                          setTimeout(() => router.push(`/station/${selectedStation.id}?charge=1` as any), 300);
                        } else {
                          goInApp(selectedStation.lat, selectedStation.lng, selectedStation.name);
                        }
                      }}
                    >
                      <Ionicons name="flash" size={15} color="#fff" />
                      <Text style={[S.sheetBtnTxt, { color: "#fff" }]}>Charge Here</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  radiusPills: { flexDirection: "row", gap: 3 },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  pillTxt: { fontSize: 10, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 0,
    height: 40,
  },
  searchBtn: { marginRight: 6 },
  searchBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  filterRow: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, flexWrap: "wrap",
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  filterPillTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  filterCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 4 },
  listPanel: {
    flex: 0.45, borderTopWidth: StyleSheet.hairlineWidth,
  },
  listPanelContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  listEmpty: { alignItems: "center", paddingVertical: 24, gap: 8 },
  listEmptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  listCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
  },
  listCardIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  listCardName: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  listCardAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  listCardRight: { alignItems: "flex-end", gap: 4 },
  listDot: { width: 8, height: 8, borderRadius: 4 },
  listCardDist: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  mapWrapper: { flex: 1 },
  loadingBadge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  loadingTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  promptOverlay: {
    position: "absolute",
    bottom: 40,
    left: 24,
    right: 24,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
  promptTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  promptSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  promptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 20,
    marginTop: 4,
  },
  promptBtnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#fff" },
  countBadge: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  countTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sheetBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "flex-end",
    zIndex: 50,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 24,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: "center", marginTop: 10, marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 18, gap: 10, marginBottom: 8,
  },
  sheetBadge: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    alignSelf: "flex-start", marginBottom: 5,
  },
  sheetBadgeTxt: { fontSize: 9, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  sheetName: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", lineHeight: 22 },
  sheetNetwork: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  sheetClose: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  sheetAddrRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    paddingHorizontal: 18, marginBottom: 12,
  },
  sheetAddr: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  sheetPills: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingHorizontal: 18, marginBottom: 14,
  },
  sheetPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  sheetPillTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sheetStatusDot: { width: 7, height: 7, borderRadius: 4 },
  sheetMetaRow: {
    flexDirection: "row", gap: 0,
    marginHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 16,
  },
  sheetMeta: {
    flex: 1, alignItems: "center", paddingVertical: 12,
  },
  sheetMetaVal: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetMetaLbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetRatingRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    marginBottom: 4,
  },
  sheetRatingNum: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetRatingCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sheetActions: {
    flexDirection: "row", gap: 10, paddingHorizontal: 18,
  },
  sheetBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, paddingVertical: 13, borderRadius: 14,
  },
  sheetBtnTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchHereBtn: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 10,
  },
  searchHereTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  activeFiltersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  activeFiltersTxt: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  activeFiltersCount: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  editFiltersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    marginLeft: 2,
  },
  editFiltersTxt: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  clearFiltersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 2,
  },
  clearFiltersTxt: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});
