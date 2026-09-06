import React, { useRef, useEffect, useState } from "react";
import {
  Modal, View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Animated, Pressable, Linking, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { QuickRateSheet } from "@/components/QuickRateSheet";

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
  totalPorts: number | null;
  availablePorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  network: string | null;
  ocppChargePointId: string | null;
  distanceMiles: number;
};

type CustomLoc = { lat: number; lng: number; label: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  initialLocation?: { lat: number; lng: number };
};

function stationCta(s: EvStation): "charge_now" | "network_app" | "charge_here" {
  if (s.ocppChargePointId) return "charge_now";
  if (getNetworkLink(s.network)) return "network_app";
  return "charge_here";
}

function typeLabel(t: string) {
  return t === "DCFC" ? "DC Fast" : t === "Level2" ? "Level 2" : "Level 1";
}
function typeBg(t: string) {
  return t === "DCFC" ? "#0D9E7E22" : t === "Level2" ? "#3b82f622" : "#94a3b822";
}
function typeTc(t: string) {
  return t === "DCFC" ? "#0D9E7E" : t === "Level2" ? "#3b82f6" : "#64748b";
}

async function nominatimGeocode(query: string): Promise<CustomLoc | null> {
  try {
    const r = await fetch(
      `${BASE}/api/geocode?q=${encodeURIComponent(query)}`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await r.json();
    if (!data.length) return null;
    const label = (data[0].display_name as string).split(",").slice(0, 2).join(", ");
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label };
  } catch {
    return null;
  }
}

export function ChargeNowModal({ visible, onClose, initialLocation }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { location } = useCurrentLocation();
  const slideAnim = useRef(new Animated.Value(700)).current;

  // Location search state
  const [customLoc,      setCustomLoc]      = useState<CustomLoc | null>(null);
  const [showLocSearch,  setShowLocSearch]  = useState(false);
  const [locQuery,       setLocQuery]       = useState("");
  const [geocoding,      setGeocoding]      = useState(false);
  const [geocodeError,   setGeocodeError]   = useState<string | null>(null);
  const locInputRef = useRef<TextInput>(null);

  // Rating state
  const [ratingStation, setRatingStation] = useState<EvStation | null>(null);

  const effectiveLoc =
    customLoc ??
    (location ? { lat: location.lat, lng: location.lng, label: "Your location" } : null) ??
    (initialLocation ? { ...initialLocation, label: "Your location" } : null);

  const { data: allStations, isLoading } = useQuery<EvStation[]>({
    queryKey: ["charge-now-stations", effectiveLoc?.lat, effectiveLoc?.lng],
    enabled: !!effectiveLoc && visible,
    staleTime: 30000,
    refetchInterval: 60000,
    queryFn: async () => {
      const r = await fetch(
        `${BASE}/api/ev-stations?lat=${effectiveLoc!.lat}&lng=${effectiveLoc!.lng}&radius=50`,
      );
      if (!r.ok) throw new Error("Failed to fetch");
      return r.json();
    },
  });

  const stations = (allStations ?? []).filter((s) => s.status === "available" || s.status === "unknown");

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 700,
        duration: 220,
        useNativeDriver: true,
      }).start();
      // Reset search state when closed
      setShowLocSearch(false);
      setLocQuery("");
      setGeocodeError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (showLocSearch) {
      setTimeout(() => locInputRef.current?.focus(), 100);
    }
  }, [showLocSearch]);

  async function handleGeocode() {
    if (!locQuery.trim()) return;
    setGeocoding(true);
    setGeocodeError(null);
    const result = await nominatimGeocode(locQuery.trim());
    setGeocoding(false);
    if (!result) {
      setGeocodeError(`Could not find "${locQuery}" — try a more specific city name.`);
      return;
    }
    setCustomLoc(result);
    setShowLocSearch(false);
    setLocQuery("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleCta(station: EvStation) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const cta = stationCta(station);
    if (cta === "network_app" && station.network) {
      openNetworkApp(station.network, Linking);
    } else if (cta === "charge_now" || (cta === "charge_here" && station.source === "community")) {
      onClose();
      setTimeout(() => router.push(`/station/${station.id}?charge=1` as any), 300);
    } else {
      onClose();
      setTimeout(() => {
        setNavigationIntent({ lat: station.lat, lng: station.lng, label: station.name });
        router.push("/(tabs)/map" as any);
      }, 300);
    }
  }

  const communityCount = stations.filter((s) => s.source === "community").length;
  const locationLabel = effectiveLoc?.label ?? null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          S.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={[S.handle, { backgroundColor: colors.border }]} />

        {/* Header */}
        <View style={S.sheetHeader}>
          <View style={S.sheetHeaderLeft}>
            <View style={[S.sheetIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="flash" size={20} color={colors.primary} />
            </View>
            <View>
              <Text style={[S.sheetTitle, { color: colors.foreground }]}>Charge Now</Text>
              <Text style={[S.sheetSub, { color: colors.mutedForeground }]}>
                {!effectiveLoc
                  ? "Detecting your location…"
                  : isLoading
                  ? "Finding stations near you…"
                  : `${stations.length} stations within 50 mi`}
                {communityCount > 0 && !isLoading && ` · ${communityCount} ChargeBridge`}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[S.closeBtn, { backgroundColor: colors.muted }]}
            onPress={onClose}
          >
            <Ionicons name="close" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Location row */}
        <View style={[S.locRow, { borderColor: colors.border, backgroundColor: colors.muted + "40" }]}>
          {!showLocSearch ? (
            <View style={S.locRowInner}>
              <Ionicons name="location-outline" size={14} color={colors.mutedForeground} style={{ marginTop: 1 }} />
              <Text style={[S.locLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                {locationLabel ?? "No location set"}
              </Text>
              <TouchableOpacity
                onPress={() => setShowLocSearch(true)}
                style={[S.locChangeBtn, { backgroundColor: colors.primary + "15" }]}
              >
                <Ionicons name="search-outline" size={12} color={colors.primary} />
                <Text style={[S.locChangeTxt, { color: colors.primary }]}>
                  {effectiveLoc ? "Change" : "Search"}
                </Text>
              </TouchableOpacity>
              {customLoc && location && (
                <TouchableOpacity onPress={() => setCustomLoc(null)}>
                  <Text style={[S.useGpsTxt, { color: colors.mutedForeground }]}>Use GPS</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={S.locSearchRow}>
              <Ionicons name="search-outline" size={14} color={colors.mutedForeground} />
              <TextInput
                ref={locInputRef}
                value={locQuery}
                onChangeText={setLocQuery}
                placeholder="City, address or zip…"
                placeholderTextColor={colors.mutedForeground + "88"}
                style={[S.locInput, { color: colors.foreground }]}
                returnKeyType="search"
                onSubmitEditing={handleGeocode}
                autoCorrect={false}
              />
              {geocoding ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <TouchableOpacity onPress={handleGeocode}>
                  <Text style={[S.locChangeTxt, { color: colors.primary }]}>Go</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => { setShowLocSearch(false); setLocQuery(""); setGeocodeError(null); }}
              >
                <Text style={[S.locChangeTxt, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
          {geocodeError != null && (
            <Text style={[S.geocodeErr, { color: "#ef4444" }]}>{geocodeError}</Text>
          )}
        </View>

        {/* States */}
        {(!effectiveLoc || isLoading) && (
          <View style={S.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[S.emptyTxt, { color: colors.mutedForeground, marginTop: 10 }]}>
              {!effectiveLoc ? "Waiting for location…" : "Searching nearby stations…"}
            </Text>
            {!effectiveLoc && (
              <TouchableOpacity
                style={[S.searchCityBtn, { backgroundColor: colors.primary + "15" }]}
                onPress={() => setShowLocSearch(true)}
              >
                <Ionicons name="search-outline" size={14} color={colors.primary} />
                <Text style={[S.searchCityTxt, { color: colors.primary }]}>Search a city instead</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {effectiveLoc && !isLoading && stations.length === 0 && (
          <View style={S.empty}>
            <Ionicons name="flash-off-outline" size={36} color={colors.mutedForeground} />
            <Text style={[S.emptyTitle, { color: colors.foreground }]}>No stations found</Text>
            <Text style={[S.emptyTxt, { color: colors.mutedForeground }]}>
              No stations found within 50 miles. Try a different location.
            </Text>
            <TouchableOpacity
              style={[S.searchCityBtn, { backgroundColor: colors.primary + "15", marginTop: 8 }]}
              onPress={() => setShowLocSearch(true)}
            >
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={[S.searchCityTxt, { color: colors.primary }]}>Search another location</Text>
            </TouchableOpacity>
          </View>
        )}

        {effectiveLoc && !isLoading && stations.length > 0 && (
          <FlatList
            data={stations}
            keyExtractor={(s) => s.id}
            contentContainerStyle={S.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: station }) => {
              const cta = stationCta(station);
              const netLink = getNetworkLink(station.network);
              const isCommunity = station.source === "community";
              const ctaColor =
                cta === "network_app" ? "#3b82f6" :
                colors.primary;
              const ctaLabel =
                cta === "charge_now" ? "Charge Now" :
                cta === "network_app" && netLink ? `Open ${netLink.label}` :
                "Charge Here";
              const ctaIcon =
                cta === "network_app" ? "open-outline" : "flash";

              return (
                <TouchableOpacity
                  style={[
                    S.card,
                    {
                      backgroundColor: colors.background,
                      borderColor: isCommunity ? colors.primary + "44" : colors.border,
                    },
                  ]}
                  onPress={() => handleCta(station)}
                  activeOpacity={0.8}
                >
                  <View style={S.cardTop}>
                    <View style={[S.cardIcon, { backgroundColor: ctaColor + "14" }]}>
                      <Ionicons name="flash" size={18} color={ctaColor} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={S.nameRow}>
                        <Text style={[S.cardName, { color: colors.foreground }]} numberOfLines={1}>
                          {station.name}
                        </Text>
                        {isCommunity && (
                          <View style={[S.communityPill, { backgroundColor: colors.primary + "14" }]}>
                            <Ionicons name="flash" size={9} color={colors.primary} />
                            <Text style={[S.communityTxt, { color: colors.primary }]}>CB</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[S.cardAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {[station.address, station.city].filter(Boolean).join(", ")}
                      </Text>
                    </View>
                    <Text style={[S.cardDist, { color: colors.primary }]}>
                      {Number(station.distanceMiles).toFixed(1)} mi
                    </Text>
                  </View>

                  <View style={S.cardFoot}>
                    <View style={[S.badge, { backgroundColor: typeBg(station.chargerType) }]}>
                      <Text style={[S.badgeTxt, { color: typeTc(station.chargerType) }]}>
                        {typeLabel(station.chargerType)}
                      </Text>
                    </View>
                    {station.powerKw != null && (
                      <Text style={[S.cardPower, { color: colors.mutedForeground }]}>
                        {station.powerKw} kW
                      </Text>
                    )}
                    {station.isFree ? (
                      <Text style={[S.cardPrice, { color: "#15803d" }]}>Free</Text>
                    ) : station.priceText ? (
                      <Text style={[S.cardPrice, { color: colors.foreground }]}>
                        {station.priceText}
                      </Text>
                    ) : null}
                    {station.totalPorts != null && (
                      <Text style={[S.cardPorts, { color: colors.mutedForeground }]}>
                        {station.availablePorts ?? "?"}/{station.totalPorts} ports
                      </Text>
                    )}
                    <TouchableOpacity
                      style={[S.rateBtn, { backgroundColor: "#fef3c7", borderColor: "#fcd34d" }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.selectionAsync();
                        setRatingStation(station);
                      }}
                    >
                      <Ionicons name="star-outline" size={12} color="#d97706" />
                      <Text style={S.rateBtnTxt}>Rate</Text>
                    </TouchableOpacity>
                    <View style={[S.chargeBtn, { backgroundColor: ctaColor }]}>
                      <Ionicons name={ctaIcon as any} size={12} color="#fff" />
                      <Text style={S.chargeBtnTxt}>{ctaLabel}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </Animated.View>

      {ratingStation && (
        <QuickRateSheet
          visible={!!ratingStation}
          stationName={ratingStation.name}
          stationId={
            ratingStation.source === "community"
              ? parseInt(ratingStation.id.replace(/^db-/, ""), 10)
              : undefined
          }
          externalId={
            ratingStation.source === "osm" ? ratingStation.id : undefined
          }
          onClose={() => setRatingStation(null)}
        />
      )}
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 24,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
  },
  sheetHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sheetTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  // Location row
  locRow: {
    marginHorizontal: 16, marginBottom: 10, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8,
  },
  locRowInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  locLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  locChangeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  locChangeTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  useGpsTxt: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: 4 },
  locSearchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  locInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 2 },
  geocodeErr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4, paddingLeft: 2 },
  // States
  loadingWrap: { alignItems: "center", padding: 48 },
  empty: { alignItems: "center", padding: 36, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  searchCityBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginTop: 4,
  },
  searchCityTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  cardName: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1 },
  communityPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, flexShrink: 0,
  },
  communityTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  cardAddr: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardDist: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", flexShrink: 0 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  cardPower: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardPrice: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  cardPorts: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  rateBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
  },
  rateBtnTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#d97706" },
  chargeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
  },
  chargeBtnTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
});
