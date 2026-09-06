import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform,
  Modal, ScrollView,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChargeNowModal } from "@/components/ChargeNowModal";
import { MapModal } from "@/components/MapModal";
import { useIsButtonEnabled } from "@/hooks/useButtonConfigs";
import { AllTabsWallpaperPicker, WallpaperLayer } from "@/components/WallpaperPicker";
import { StationCard, EvStation, LiveDot } from "@/components/StationCard";
import { GasScreen } from "./gas";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function NearbyScreen() {
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [radius, setRadius] = useState(25);
  const [chargeNowVisible, setChargeNowVisible] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [networkFilter, setNetworkFilter] = useState<string | null>(null);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sortBy, setSortBy] = useState<"nearest" | "highest_rating" | "lowest_rating">("nearest");
  const [directPayOnly, setDirectPayOnly] = useState(false);
  const [connectorFilter, setConnectorFilter] = useState<string | null>(null);
  const [connectorAutoSet, setConnectorAutoSet] = useState(false);
  const [stationMode, setStationMode] = useState<"ev" | "gas">("ev");
  const [modeAutoSet, setModeAutoSet] = useState(false);
  const [communityOnly, setCommunityOnly] = useState(false);
  const [statusReportId, setStatusReportId] = useState<string | null>(null);
  const [radiusSheetVisible, setRadiusSheetVisible] = useState(false);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [filtersSheetVisible, setFiltersSheetVisible] = useState(false);
  const [connectorSheetVisible, setConnectorSheetVisible] = useState(false);

  const { data: profileForConnector } = useQuery<{ connectorType: string | null; fuelType?: string | null }>({
    queryKey: ["profile"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/me`); if (!r.ok) throw new Error("unauth"); return r.json(); },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!connectorAutoSet && profileForConnector?.connectorType && connectorFilter === null) {
      setConnectorFilter(profileForConnector.connectorType);
      setConnectorAutoSet(true);
    }
  }, [profileForConnector, connectorAutoSet, connectorFilter]);

  useEffect(() => {
    if (!modeAutoSet && profileForConnector) {
      const ft = profileForConnector.fuelType;
      if (ft && ft !== "electric") setStationMode("gas");
      setModeAutoSet(true);
    }
  }, [profileForConnector, modeAutoSet]);

  const showHomeBtn = useIsButtonEnabled("mobile_header_home_button");
  const showChargeNowBtn = useIsButtonEnabled("mobile_header_charge_now");

  const { data: stations, isLoading, refetch, isRefetching } = useQuery<EvStation[]>({
    queryKey: ["ev-stations", loc?.lat, loc?.lng, radius],
    enabled: !!loc,
    staleTime: 30000,
    refetchInterval: 30000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations?lat=${loc!.lat}&lng=${loc!.lng}&radius=${radius}`);
      if (!r.ok) throw new Error("Failed to fetch EV stations");
      return r.json();
    },
  });

  const RADII = [5, 10, 25, 50, 100];

  const uniqueNetworks = useMemo(() => {
    if (!stations) return [];
    const nets = new Set<string>();
    stations.forEach((s) => { if (s.network) { const n = s.network.split(";")[0].trim(); if (n) nets.add(n); } });
    return Array.from(nets).sort();
  }, [stations]);

  const directPayCount = useMemo(() => (stations ?? []).filter((s) => !!s.ocppChargePointId).length, [stations]);

  const allConnectorTypes = useMemo(() => {
    const set = new Set<string>();
    (stations ?? []).forEach((s) => (s.connectorTypes ?? []).forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [stations]);

  const filteredStations = useMemo(() => {
    if (!stations) return [];
    let list = [...stations];

    if (communityOnly) list = list.filter((s) => s.source === "community");
    if (directPayOnly) list = list.filter((s) => !!s.ocppChargePointId);
    if (connectorFilter) list = list.filter((s) => (s.connectorTypes ?? []).includes(connectorFilter));
    if (networkFilter) list = list.filter((s) => s.network?.toLowerCase().includes(networkFilter.toLowerCase()));

    if (sortBy === "highest_rating") {
      list.sort((a, b) => {
        const ra = a.averageRating ?? -1;
        const rb = b.averageRating ?? -1;
        if (ra !== rb) return rb - ra;
        return a.distanceMiles - b.distanceMiles;
      });
    } else if (sortBy === "lowest_rating") {
      list.sort((a, b) => {
        const ra = a.averageRating ?? Infinity;
        const rb = b.averageRating ?? Infinity;
        if (ra !== rb) return ra - rb;
        return a.distanceMiles - b.distanceMiles;
      });
    }
    return list;
  }, [stations, networkFilter, sortBy, directPayOnly, connectorFilter, communityOnly]);

  const getLocation = useCallback(async () => {
    setLocLoading(true);
    setLocError(null);
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { setLocError("Location permission denied"); return; }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } else {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); resolve(); },
            () => { setLocError("Could not get location"); reject(); }
          )
        );
      }
    } catch { setLocError("Could not access location"); }
    finally { setLocLoading(false); }
  }, []);

  useEffect(() => { getLocation(); }, []);

  if (stationMode === "gas") {
    return <GasScreen onSwitchMode={() => setStationMode("ev")} />;
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <WallpaperLayer tab="nearby" />
      <AllTabsWallpaperPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
      {/* Header */}
      <View style={[S.header, { paddingTop: topPad + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={S.headerTop}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[S.brand, { color: colors.foreground }]}>Stations</Text>
              {loc && <LiveDot />}
            </View>
            <Text style={[S.brandSub, { color: colors.mutedForeground }]}>EV Chargers · Live Data</Text>
          </View>
          {/* EV / Gas mode toggle */}
          <View style={{ flexDirection: "row", backgroundColor: colors.muted + "88", borderRadius: 10, padding: 3 }}>
            <View style={{ paddingHorizontal: 12, alignItems: "center", paddingVertical: 6, borderRadius: 8, backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.foreground }}>⚡ EV</Text>
            </View>
            <TouchableOpacity
              style={{ paddingHorizontal: 12, alignItems: "center", paddingVertical: 6, borderRadius: 8 }}
              onPress={() => { Haptics.selectionAsync(); setStationMode("gas"); }}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.mutedForeground }}>⛽ Gas</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action buttons — horizontally scrollable so all buttons are always reachable */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={S.actionRow}
          contentContainerStyle={{ gap: 7, paddingLeft: 16, paddingRight: 16 }}
        >
          {showChargeNowBtn && (
            <TouchableOpacity
              style={[S.chgNowBtn, { backgroundColor: colors.primary }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setChargeNowVisible(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="flash" size={14} color="#fff" />
              <Text style={S.chgNowTxt}>Charge Now</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[S.communityBtn, { backgroundColor: "#0D9E7E" }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/community-stations" as any); }}
            activeOpacity={0.85}
          >
            <Ionicons name="people" size={14} color="#fff" />
            <Text style={S.chgNowTxt}>Community</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.communityBtn, { backgroundColor: "#f59e0b" }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-station" as any); }}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={14} color="#fff" />
            <Text style={S.chgNowTxt}>Request Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.muted }]} onPress={() => { Haptics.selectionAsync(); setMapVisible(true); }}>
            <Feather name="map" size={17} color={colors.foreground} />
          </TouchableOpacity>
          {showHomeBtn && (
            <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.muted }]} onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/home"); }}>
              <Feather name="home" size={17} color={colors.foreground} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.primary + "15" }]} onPress={getLocation}>
            <Feather name="navigation" size={17} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[S.communityBtn, { backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "40" }]} onPress={() => { Haptics.selectionAsync(); setPickerOpen(true); }} activeOpacity={0.8}>
            <Ionicons name="color-palette-outline" size={14} color={colors.primary} />
            <Text style={[S.chgNowTxt, { color: colors.primary }]}>Wallpaper</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Filter dropdowns */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.filterRow} contentContainerStyle={{ gap: 6, paddingLeft: 16, paddingRight: 16 }}>
          {/* Radius */}
          <TouchableOpacity
            style={[S.ddBtn, { backgroundColor: colors.muted }]}
            onPress={() => { Haptics.selectionAsync(); setRadiusSheetVisible(true); }}
          >
            <Feather name="navigation" size={12} color={colors.mutedForeground} />
            <Text style={[S.ddLabel, { color: colors.foreground }]}>{radius} mi</Text>
            <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* Sort */}
          {(() => {
            const isDefault = sortBy === "nearest";
            return (
              <TouchableOpacity
                style={[S.ddBtn, { backgroundColor: isDefault ? colors.muted : "#f59e0b" }]}
                onPress={() => { Haptics.selectionAsync(); setSortSheetVisible(true); }}
              >
                <Ionicons name="swap-vertical" size={12} color={isDefault ? colors.mutedForeground : "#fff"} />
                <Text style={[S.ddLabel, { color: isDefault ? colors.foreground : "#fff" }]}>
                  {sortBy === "nearest" ? "Nearest" : sortBy === "highest_rating" ? "★ Highest" : "★ Lowest"}
                </Text>
                <Ionicons name="chevron-down" size={12} color={isDefault ? colors.mutedForeground : "#fff"} />
              </TouchableOpacity>
            );
          })()}

          {/* Filters (Community + Direct Pay) */}
          {(() => {
            const activeCount = (communityOnly ? 1 : 0) + (directPayOnly ? 1 : 0);
            const active = activeCount > 0;
            return (
              <TouchableOpacity
                style={[S.ddBtn, { backgroundColor: active ? colors.primary : colors.muted }]}
                onPress={() => { Haptics.selectionAsync(); setFiltersSheetVisible(true); }}
              >
                <Ionicons name="options" size={12} color={active ? "#fff" : colors.mutedForeground} />
                <Text style={[S.ddLabel, { color: active ? "#fff" : colors.foreground }]}>
                  {active ? `Filters (${activeCount})` : "Filters"}
                </Text>
                <Ionicons name="chevron-down" size={12} color={active ? "#fff" : colors.mutedForeground} />
              </TouchableOpacity>
            );
          })()}

          {/* Connector */}
          {(() => {
            const active = connectorFilter != null;
            return (
              <TouchableOpacity
                style={[S.ddBtn, { backgroundColor: active ? "#8b5cf6" : colors.muted }]}
                onPress={() => { Haptics.selectionAsync(); setConnectorSheetVisible(true); }}
              >
                <Ionicons name="flash" size={12} color={active ? "#fff" : colors.mutedForeground} />
                <Text style={[S.ddLabel, { color: active ? "#fff" : colors.foreground }]}>
                  {connectorFilter ?? "Connector"}
                </Text>
                <Ionicons name="chevron-down" size={12} color={active ? "#fff" : colors.mutedForeground} />
              </TouchableOpacity>
            );
          })()}

          {/* Network */}
          {(() => {
            const active = networkFilter != null;
            return (
              <TouchableOpacity
                style={[S.ddBtn, { backgroundColor: active ? colors.primary : colors.muted }]}
                onPress={() => { Haptics.selectionAsync(); setFilterSheetVisible(true); }}
              >
                <Feather name="wifi" size={12} color={active ? "#fff" : colors.mutedForeground} />
                <Text style={[S.ddLabel, { color: active ? "#fff" : colors.foreground }]} numberOfLines={1}>
                  {active ? networkFilter!.split(";")[0].trim().substring(0, 14) : "Network"}
                </Text>
                <Ionicons name="chevron-down" size={12} color={active ? "#fff" : colors.mutedForeground} />
              </TouchableOpacity>
            );
          })()}
        </ScrollView>
      </View>

      {/* State views */}
      {!loc && !locLoading && !locError && (
        <View style={S.stateWrap}>
          <View style={[S.stateIcon, { backgroundColor: colors.primary + "15" }]}>
            <Ionicons name="location-outline" size={36} color={colors.primary} />
          </View>
          <Text style={[S.stateTitle, { color: colors.foreground }]}>Find nearby chargers</Text>
          <Text style={[S.stateBody, { color: colors.mutedForeground }]}>Allow location to see EV stations near you</Text>
          <TouchableOpacity style={[S.stateCta, { backgroundColor: colors.primary }]} onPress={getLocation}>
            <Ionicons name="navigate" size={15} color="#fff" />
            <Text style={S.stateCtaTxt}>Use My Location</Text>
          </TouchableOpacity>
        </View>
      )}

      {locError && (
        <View style={S.stateWrap}>
          <View style={[S.stateIcon, { backgroundColor: "#ef444418" }]}>
            <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
          </View>
          <Text style={[S.stateTitle, { color: colors.foreground }]}>{locError}</Text>
          <TouchableOpacity style={[S.stateCta, { backgroundColor: colors.primary }]} onPress={getLocation}>
            <Text style={S.stateCtaTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {(locLoading || (isLoading && !stations)) && (
        <View style={S.stateWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[S.stateBody, { color: colors.mutedForeground, marginTop: 14 }]}>Finding stations…</Text>
        </View>
      )}

      {stations && (
        <FlatList
          data={filteredStations}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <StationCard station={item} onReportStatus={setStatusReportId} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: isWeb ? 118 : 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={[S.listMeta, { color: colors.mutedForeground }]}>
              {filteredStations.length} station{filteredStations.length !== 1 ? "s" : ""}
              {communityOnly ? " · Community" : ""}
              {directPayOnly ? " · Direct Pay" : ""}
              {connectorFilter ? ` · ${connectorFilter}` : ""}
              {networkFilter ? ` · ${networkFilter.split(";")[0].trim()}` : ""}
              {" · "}{sortBy === "nearest" ? `within ${radius} mi` : sortBy === "highest_rating" ? "highest rated first" : "lowest rated first"}
            </Text>
          }
          ListEmptyComponent={
            <View style={[S.stateWrap, { marginTop: 0 }]}>
              <View style={[S.stateIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name="flash-outline" size={32} color={colors.mutedForeground} />
              </View>
              <Text style={[S.stateTitle, { color: colors.foreground }]}>No stations found</Text>
              <Text style={[S.stateBody, { color: colors.mutedForeground }]}>
                {communityOnly ? "No community stations found nearby — try a larger radius" : networkFilter ? `No ${networkFilter.split(";")[0].trim()} stations nearby` : "Try a larger radius"}
              </Text>
            </View>
          }
        />
      )}

      {/* Radius sheet */}
      <Modal visible={radiusSheetVisible} animationType="slide" transparent onRequestClose={() => setRadiusSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setRadiusSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Search Radius</Text>
            <TouchableOpacity onPress={() => setRadiusSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {RADII.map((r) => {
            const isActive = radius === r;
            return (
              <TouchableOpacity
                key={r}
                style={[S.netRow, { borderBottomColor: colors.border }, isActive && { backgroundColor: colors.primary + "10" }]}
                onPress={() => { Haptics.selectionAsync(); setRadius(r); setRadiusSheetVisible(false); }}
              >
                <View style={[S.netCheck, { borderColor: isActive ? colors.primary : "#94a3b8" }, isActive && { backgroundColor: colors.primary }]}>
                  {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <Text style={[S.netLabel, { color: colors.foreground }]}>{r} miles</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {/* Sort sheet */}
      <Modal visible={sortSheetVisible} animationType="slide" transparent onRequestClose={() => setSortSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setSortSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Sort By</Text>
            <TouchableOpacity onPress={() => setSortSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {([
            { value: "nearest", label: "Nearest first", icon: "navigate" as const, detail: "Closest to your location" },
            { value: "highest_rating", label: "Highest rated", icon: "star" as const, detail: "Best community ratings first" },
            { value: "lowest_rating", label: "Lowest rated", icon: "star-outline" as const, detail: "Lowest ratings first" },
          ]).map(({ value, label, icon, detail }) => {
            const isActive = sortBy === value;
            return (
              <TouchableOpacity
                key={value}
                style={[S.netRow, { borderBottomColor: colors.border }, isActive && { backgroundColor: colors.primary + "10" }]}
                onPress={() => { Haptics.selectionAsync(); setSortBy(value as typeof sortBy); setSortSheetVisible(false); }}
              >
                <View style={[S.netCheck, { borderColor: isActive ? colors.primary : "#94a3b8" }, isActive && { backgroundColor: colors.primary }]}>
                  {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.netLabel, { color: colors.foreground, marginBottom: 0 }]}>{label}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 1 }}>{detail}</Text>
                </View>
                <Ionicons name={icon} size={16} color={isActive ? colors.primary : colors.mutedForeground} />
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {/* Filters sheet (Community + Direct Pay) */}
      <Modal visible={filtersSheetVisible} animationType="slide" transparent onRequestClose={() => setFiltersSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setFiltersSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Filters</Text>
            <TouchableOpacity onPress={() => setFiltersSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[S.netRow, { borderBottomColor: colors.border }, communityOnly && { backgroundColor: colors.primary + "10" }]}
            onPress={() => { Haptics.selectionAsync(); setCommunityOnly((v) => !v); }}
          >
            <View style={[S.netCheck, { borderColor: communityOnly ? colors.primary : "#94a3b8" }, communityOnly && { backgroundColor: colors.primary }]}>
              {communityOnly && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.netLabel, { color: colors.foreground }]}>Community only</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 1 }}>Show only ChargeBridge-listed stations</Text>
            </View>
            <Ionicons name="people" size={16} color={communityOnly ? colors.primary : colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.netRow, { borderBottomColor: colors.border }, directPayOnly && { backgroundColor: "#22c55e18" }]}
            onPress={() => { Haptics.selectionAsync(); setDirectPayOnly((v) => !v); }}
          >
            <View style={[S.netCheck, { borderColor: directPayOnly ? "#22c55e" : "#94a3b8" }, directPayOnly && { backgroundColor: "#22c55e" }]}>
              {directPayOnly && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.netLabel, { color: colors.foreground }]}>Direct Pay only</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 1 }}>OCPP stations · charge &amp; pay via ChargeBridge</Text>
              {directPayCount > 0 && (
                <Text style={{ fontSize: 11, color: "#22c55e", marginTop: 2, fontWeight: "600" }}>{directPayCount} stations nearby</Text>
              )}
            </View>
            <Ionicons name="flash" size={16} color={directPayOnly ? "#22c55e" : colors.mutedForeground} />
          </TouchableOpacity>
          {(communityOnly || directPayOnly) && (
            <TouchableOpacity
              style={{ marginHorizontal: 20, marginTop: 14, marginBottom: 4, alignItems: "center" }}
              onPress={() => { Haptics.selectionAsync(); setCommunityOnly(false); setDirectPayOnly(false); setFiltersSheetVisible(false); }}
            >
              <Text style={{ fontSize: 14, color: colors.mutedForeground }}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      {/* Connector sheet */}
      <Modal visible={connectorSheetVisible} animationType="slide" transparent onRequestClose={() => setConnectorSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setConnectorSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Connector Type</Text>
            <TouchableOpacity onPress={() => setConnectorSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[S.netRow, { borderBottomColor: colors.border }, connectorFilter === null && { backgroundColor: "#8b5cf610" }]}
            onPress={() => { Haptics.selectionAsync(); setConnectorFilter(null); setConnectorSheetVisible(false); }}
          >
            <View style={[S.netCheck, { borderColor: connectorFilter === null ? "#8b5cf6" : "#94a3b8" }, connectorFilter === null && { backgroundColor: "#8b5cf6" }]}>
              {connectorFilter === null && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <Text style={[S.netLabel, { color: colors.foreground }]}>All connectors</Text>
            <Text style={[S.netCount, { color: colors.mutedForeground }]}>{stations?.length ?? 0}</Text>
          </TouchableOpacity>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {allConnectorTypes.map((ct) => {
              const isActive = connectorFilter === ct;
              const count = (stations ?? []).filter((s) => (s.connectorTypes ?? []).includes(ct)).length;
              return (
                <TouchableOpacity
                  key={ct}
                  style={[S.netRow, { borderBottomColor: colors.border }, isActive && { backgroundColor: "#8b5cf610" }]}
                  onPress={() => { Haptics.selectionAsync(); setConnectorFilter(isActive ? null : ct); setConnectorSheetVisible(false); }}
                >
                  <View style={[S.netCheck, { borderColor: isActive ? "#8b5cf6" : "#94a3b8" }, isActive && { backgroundColor: "#8b5cf6" }]}>
                    {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                  <Text style={[S.netLabel, { color: colors.foreground }]}>{ct}</Text>
                  <Text style={[S.netCount, { color: colors.mutedForeground }]}>{count}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Network filter sheet */}
      <Modal visible={filterSheetVisible} animationType="slide" transparent onRequestClose={() => setFilterSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setFilterSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Filter by Network</Text>
            <TouchableOpacity onPress={() => setFilterSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
            {[null, ...uniqueNetworks].map((net) => {
              const isActive = networkFilter === net;
              const count = net == null ? (stations?.length ?? 0) : (stations?.filter((s) => s.network?.toLowerCase().includes(net.toLowerCase())).length ?? 0);
              return (
                <TouchableOpacity
                  key={net ?? "__all__"}
                  style={[S.netRow, { borderBottomColor: colors.border }, isActive && { backgroundColor: colors.primary + "10" }]}
                  onPress={() => { Haptics.selectionAsync(); setNetworkFilter(net); setFilterSheetVisible(false); }}
                >
                  <View style={[S.netCheck, { borderColor: isActive ? colors.primary : "#94a3b8" }, isActive && { backgroundColor: colors.primary }]}>
                    {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                  <Text style={[S.netLabel, { color: colors.foreground }]}>{net ?? "All Networks"}</Text>
                  <Text style={[S.netCount, { color: colors.mutedForeground }]}>{count}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Status report bottom sheet */}
      <Modal visible={!!statusReportId} transparent animationType="slide" onRequestClose={() => setStatusReportId(null)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setStatusReportId(null)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Report Station Status</Text>
            <TouchableOpacity onPress={() => setStatusReportId(null)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <Text style={[{ fontSize: 12, color: colors.mutedForeground, marginHorizontal: 18, marginTop: 10, marginBottom: 14 }]}>
            Quick update — no account required. Helps the next driver.
          </Text>
          {([
            { type: "working", label: "Working ✓", detail: "Ports are operational", bg: "#dcfce7", fg: "#15803d" },
            { type: "busy", label: "Busy ⚡", detail: "All ports occupied", bg: "#fef3c7", fg: "#d97706" },
            { type: "issue", label: "Issue ⚠", detail: "Out of service / broken", bg: "#fee2e2", fg: "#dc2626" },
          ] as const).map(({ type, label, detail, bg, fg }) => (
            <TouchableOpacity
              key={type}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 18, marginBottom: 10, padding: 14, borderRadius: 12, backgroundColor: bg }}
              activeOpacity={0.8}
              onPress={async () => {
                const id = statusReportId;
                setStatusReportId(null);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                try {
                  await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(id!)}/status-report`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reportType: type }),
                  });
                } catch {}
              }}
            >
              <Text style={{ fontSize: 18 }}>{type === "working" ? "✅" : type === "busy" ? "⚡" : "⚠️"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: fg }}>{label}</Text>
                <Text style={{ fontSize: 12, color: fg + "bb", marginTop: 1 }}>{detail}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <ChargeNowModal visible={chargeNowVisible} onClose={() => setChargeNowVisible(false)} />
      <MapModal visible={mapVisible} onClose={() => setMapVisible(false)} />
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center" },
  brand: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  brandSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  actionRow: { marginHorizontal: -16 },
  chgNowBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22 },
  communityBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22 },
  chgNowTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  filterRow: { marginHorizontal: -16 },
  ddBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20 },
  ddLabel: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  listMeta: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },

  stateWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12, marginTop: 20 },
  stateIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  stateTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  stateBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  stateCta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, marginTop: 4 },
  stateCtaTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderBottomWidth: 0, maxHeight: "60%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  netRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  netCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  netLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  netCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
