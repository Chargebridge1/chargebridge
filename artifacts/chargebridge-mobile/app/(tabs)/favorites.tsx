import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Platform, Linking,
} from "react-native";
import { router } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useListFavorites, useRemoveFavorite } from "@/lib/api-client";
import { getListFavoritesQueryKey } from "@/lib/api-client/generated/api";
import type { FavoriteStation } from "@/lib/api-client/generated/api.schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useIsButtonEnabled } from "@/hooks/useButtonConfigs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haversineDistance, formatDistance } from "@/utils/distance";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import { QuickRateSheet } from "@/components/QuickRateSheet";

function stationCta(s: FavoriteStation) {
  if (s.ocppChargePointId) return "charge_now";
  if (getNetworkLink(s.network)) return "network_app";
  return "charge_here";
}

const STATUS_COLOR: Record<string, string> = {
  available: "#22c55e",
  busy: "#f59e0b",
  offline: "#ef4444",
};

function navigateToStation(station: FavoriteStation) {
  if (station.source === "community") {
    router.push(`/station/${station.id}` as any);
  } else {
    const params = new URLSearchParams({
      name: station.name,
      lat: String(station.lat),
      lng: String(station.lng),
      ...(station.address && { address: station.address }),
      ...(station.city && { city: station.city }),
      ...(station.status && { status: station.status }),
      ...(station.chargerType && { chargerType: station.chargerType }),
      ...(station.powerKw != null && { powerKw: String(station.powerKw) }),
      ...(station.priceText && { priceText: station.priceText }),
      isFree: String(station.isFree),
      ...(station.network && { network: station.network }),
      ...(station.totalPorts != null && { totalPorts: String(station.totalPorts) }),
      ...(station.availablePorts != null && { availablePorts: String(station.availablePorts) }),
      ...(station.website && { website: station.website }),
      distanceMiles: "0",
      reviewCount: String(station.reviewCount),
    });
    router.push(`/station/external/${encodeURIComponent(station.id)}?${params}` as any);
  }
}

function FavoriteCard({ station, onRemove, userLat, userLng }: {
  station: FavoriteStation; onRemove: () => void;
  userLat?: number; userLng?: number;
}) {
  const colors = useColors();
  const [rateVisible, setRateVisible] = useState(false);
  const cta = stationCta(station);
  const netLink = getNetworkLink(station.network);
  const statusColor = STATUS_COLOR[station.status] ?? "#94a3b8";
  const typeBg = station.chargerType === "DCFC" ? "#0D9E7E18" : station.chargerType === "Level2" ? "#3b82f618" : "#94a3b818";
  const typeTc = station.chargerType === "DCFC" ? "#0D9E7E" : station.chargerType === "Level2" ? "#3b82f6" : "#64748b";
  const typeLabel = station.chargerType === "DCFC" ? "DC Fast" : station.chargerType === "Level2" ? "Level 2" : "Level 1";
  const ctaColor = cta === "network_app" ? "#3b82f6" : colors.primary;
  const statusLabel = station.status === "available" ? "Available" :
    station.status === "busy" ? "In Use" :
    station.status === "offline" ? "Offline" : "Unknown";

  const dist = userLat != null && userLng != null
    ? haversineDistance(userLat, userLng, station.lat, station.lng)
    : null;

  function handleCta() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cta === "network_app" && station.network) openNetworkApp(station.network, Linking);
    else if (station.source === "community") router.push(`/station/${station.id}?charge=1` as any);
    else navigateToStation(station);
  }

  const ctaLabel = cta === "charge_now" ? "Charge Now" : cta === "network_app" && netLink ? `Open ${netLink.label}` : "Charge Here";
  const communityNumericId = station.source === "community" ? Number(station.id) : undefined;

  return (
    <>
      <TouchableOpacity
        style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { Haptics.selectionAsync(); navigateToStation(station); }}
        activeOpacity={0.75}
      >
        {/* Top row */}
        <View style={S.cardTop}>
          <View style={[S.iconBox, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="flash" size={22} color={colors.primary} />
          </View>
          <View style={S.cardMeta}>
            <View style={S.nameRow}>
              <Text style={[S.name, { color: colors.foreground }]} numberOfLines={1}>{station.name}</Text>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemove(); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="heart" size={21} color="#ef4444" />
              </TouchableOpacity>
            </View>
            <Text style={[S.address, { color: colors.mutedForeground }]} numberOfLines={1}>
              {[station.address, station.city].filter(Boolean).join(", ")}
            </Text>
          </View>
        </View>

        {/* Badges row */}
        <View style={S.badgeRow}>
          <View style={[S.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[S.statusTxt, { color: statusColor }]}>{statusLabel}</Text>
          <View style={[S.badge, { backgroundColor: typeBg }]}>
            <Text style={[S.badgeTxt, { color: typeTc }]}>{typeLabel}</Text>
          </View>
          {station.powerKw != null && (
            <Text style={[S.kw, { color: colors.mutedForeground }]}>{station.powerKw} kW</Text>
          )}
          {station.pricePerKwh != null && (
            <Text style={[S.priceTag, { color: colors.foreground }]}>
              {station.isFree || station.pricePerKwh === 0 ? "Free" : `$${Number(station.pricePerKwh).toFixed(2)}/kWh`}
            </Text>
          )}
          {dist != null && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); Haptics.selectionAsync(); setNavigationIntent({ lat: station.lat, lng: station.lng, label: station.name }); router.push("/(tabs)/map" as any); }}
              style={[S.distChip, { backgroundColor: colors.primary + "12" }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="navigation" size={10} color={colors.primary} />
              <Text style={[S.distTxt, { color: colors.primary }]}>{formatDistance(dist)}</Text>
            </TouchableOpacity>
          )}
          {station.source !== "community" && station.network && (
            <View style={[S.badge, { backgroundColor: colors.muted }]}>
              <Text style={[S.badgeTxt, { color: colors.mutedForeground }]}>{station.network}</Text>
            </View>
          )}
        </View>

        {/* Stars — only show for community stations with ratings */}
        {station.source === "community" && (
          <TouchableOpacity
            style={S.starsRow}
            onPress={(e) => { e.stopPropagation(); Haptics.selectionAsync(); setRateVisible(true); }}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
          >
            {[1, 2, 3, 4, 5].map((s) => (
              <Ionicons
                key={s}
                name={station.averageRating && s <= Math.round(station.averageRating) ? "star" : "star-outline"}
                size={13}
                color={station.averageRating && s <= Math.round(station.averageRating) ? "#f59e0b" : "#cbd5e1"}
              />
            ))}
            {station.averageRating && station.averageRating > 0 ? (
              <>
                <Text style={[S.starVal, { color: colors.foreground }]}>{station.averageRating.toFixed(1)}</Text>
                <Text style={[S.starCount, { color: colors.mutedForeground }]}>({station.reviewCount})</Text>
              </>
            ) : (
              <Text style={[S.starCount, { color: colors.mutedForeground }]}>Tap to rate</Text>
            )}
          </TouchableOpacity>
        )}

        {/* CTA */}
        {station.status === "available" && (
          <TouchableOpacity
            style={[S.ctaBtn, { backgroundColor: ctaColor }]}
            onPress={(e) => { e.stopPropagation(); handleCta(); }}
            activeOpacity={0.85}
          >
            <Ionicons name={cta === "network_app" ? "open-outline" : "flash"} size={13} color="#fff" />
            <Text style={S.ctaTxt}>{ctaLabel}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {rateVisible && communityNumericId != null && (
        <QuickRateSheet
          visible={rateVisible}
          stationId={communityNumericId}
          stationName={station.name}
          onClose={() => setRateVisible(false)}
        />
      )}
    </>
  );
}

export default function FavoritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const showHomeBtn = useIsButtonEnabled("mobile_header_home_button");
  const qc = useQueryClient();
  const { location } = useCurrentLocation();

  const { data: stations, isLoading, refetch, isRefetching } = useListFavorites({ refetchInterval: 30000 } as any);
  const removeFav = useRemoveFavorite();

  const handleRemove = (station: FavoriteStation) => {
    const stationId = station.source === "community" ? station.id : (station.externalStationId ?? station.id);
    removeFav.mutate({ stationId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListFavoritesQueryKey() }),
    });
  };

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[S.header, { paddingTop: topPad + 16, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[S.title, { color: colors.foreground }]}>Saved Stations</Text>
          {stations && <Text style={[S.subtitle, { color: colors.mutedForeground }]}>{stations.length} saved</Text>}
        </View>
        {showHomeBtn && (
          <TouchableOpacity
            style={[S.homeBtn, { backgroundColor: colors.muted }]}
            onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/home"); }}
            activeOpacity={0.8}
          >
            <Feather name="home" size={18} color={colors.foreground} />
          </TouchableOpacity>
        )}
      </View>

      {!isLoading && stations?.length === 0 && (
        <View style={S.empty}>
          <View style={[S.emptyIcon, { backgroundColor: colors.muted }]}>
            <Ionicons name="heart-outline" size={36} color={colors.mutedForeground} />
          </View>
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>No saved stations yet</Text>
          <Text style={[S.emptyBody, { color: colors.mutedForeground }]}>Tap the heart on any station to save it here for quick access.</Text>
          <TouchableOpacity
            style={[S.emptyCta, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/(tabs)/explore")}
          >
            <Ionicons name="search" size={15} color="#fff" />
            <Text style={S.emptyCtaTxt}>Explore Stations</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={stations ?? []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <FavoriteCard
            station={item}
            onRemove={() => handleRemove(item)}
            userLat={location?.lat}
            userLng={location?.lng}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: isWeb ? 84 + 34 : 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 24, fontWeight: "800", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  homeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  card: { borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  iconBox: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardMeta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1 },
  address: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },

  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  badgeTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  kw: { fontSize: 12, fontFamily: "Inter_400Regular" },
  priceTag: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", marginLeft: "auto" },
  distChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  distTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  starsRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  starVal: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", marginLeft: 4 },
  starCount: { fontSize: 12, fontFamily: "Inter_400Regular" },

  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22 },
  ctaTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  emptyBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyCta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, marginTop: 6 },
  emptyCtaTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
