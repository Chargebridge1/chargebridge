import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Linking,
  Image, ScrollView, Modal, Pressable, Dimensions,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useFavoriteToggle } from "@/hooks/useFavoriteToggle";
import { QuickRateSheet } from "@/components/QuickRateSheet";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { navState } from "@/utils/navNotifications";
import { Badge } from "@/components/ui/Badge";
import { Typography } from "@/components/ui/Typography";
import { Button } from "@/components/ui/Button";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

/* ─────────────────────────────────────────────────────────────────────────────
   Exported types & utilities
───────────────────────────────────────────────────────────────────────────── */

export type EvStation = {
  id: string;
  source: "osm" | "community";
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  chargerType: "Level1" | "Level2" | "DCFC";
  connectorTypes?: string[];
  powerKw: number | null;
  pricePerKwh: number | null;
  priceText: string | null;
  isFree: boolean;
  pricingUrl: string | null;
  totalPorts: number | null;
  availablePorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  network: string | null;
  ocppChargePointId: string | null;
  website?: string | null;
  distanceMiles: number;
  averageRating: number | null;
  reviewCount: number;
  latestReport?: { id: number; reportType: string; confirmations: number; createdAt: string } | null;
};

export const REPORT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  working: { label: "✓ Working", color: "#15803d", bg: "#dcfce7" },
  busy:    { label: "⚡ Busy",   color: "#b45309", bg: "#fef3c7" },
  issue:   { label: "⚠ Issue",  color: "#b91c1c", bg: "#fee2e2" },
};

export function isRecentReport(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 4 * 60 * 60 * 1000;
}

export function chargeEstimate(powerKw: number | null, pricePerKwh: number | null) {
  if (!powerKw || powerKw <= 0) return null;
  const kwh = powerKw >= 50 ? 50 : powerKw >= 10 ? 25 : 10;
  const mins = Math.round((kwh / powerKw) * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const time = h > 0 ? `~${h}h ${m}m` : `~${mins} min`;
  const cost = pricePerKwh != null && pricePerKwh > 0 ? `$${(kwh * pricePerKwh).toFixed(2)}` : null;
  return { time, cost, kwh };
}

export function stationCta(s: EvStation): "charge_now" | "network_app" | "charge_here" {
  if (s.ocppChargePointId) return "charge_now";
  if (getNetworkLink(s.network)) return "network_app";
  return "charge_here";
}

/* ─────────────────────────────────────────────────────────────────────────────
   Shared sub-components (also exported for use in map callouts, detail screens)
───────────────────────────────────────────────────────────────────────────── */

export function LiveDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[S.liveDot, { opacity }]} />;
}

export function StatusChip({ status }: { status: string }) {
  const variant =
    status === "available" ? "success" :
    status === "busy"      ? "warning" :
    status === "offline"   ? "error"   : "muted";
  const label =
    status === "available" ? "Available" :
    status === "busy"      ? "In Use"    :
    status === "offline"   ? "Offline"   : "Unknown";
  return <Badge variant={variant} label={label} dot size="sm" />;
}

export function TypeBadge({ type }: { type: string }) {
  const variant = type === "DCFC" ? "primary" : type === "Level2" ? "info" : "muted";
  const label   = type === "DCFC" ? "DC Fast"  : type === "Level2" ? "Level 2" : "Level 1";
  return <Badge variant={variant} label={label} size="sm" />;
}

/* ─────────────────────────────────────────────────────────────────────────────
   CardPhotoStrip — location photo strip (unchanged)
───────────────────────────────────────────────────────────────────────────── */
type LocationPhoto = {
  url: string;
  thumbUrl: string;
  title: string;
  source: "wikimedia" | "ocm";
  sourceUrl?: string;
  attribution?: string;
  distanceM?: number;
};

const SW = Dimensions.get("window").width;

const NETWORK_COLORS: Record<string, string> = {
  chargepoint: "#3a8f47",
  tesla: "#E82127",
  "tesla supercharger": "#E82127",
  evgo: "#EF7D00",
  blink: "#0065A4",
  "blink network": "#0065A4",
  "shell recharge": "#DD1D21",
  "electrify america": "#00ADEF",
  "volta": "#4B53BC",
  "greenlots": "#5BB565",
  "semacharge": "#F7941D",
  "circle k": "#E31837",
  "chargehub": "#F47920",
};

function networkColor(network: string | null | undefined): string {
  if (!network) return "#0D9E7E";
  return NETWORK_COLORS[network.toLowerCase()] ?? "#0D9E7E";
}

function networkInitials(network: string | null | undefined, name: string): string {
  const src = network ?? name;
  const words = src.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "EV";
}

export function CardPhotoStrip({
  lat, lng, name,
  network, chargerType, stationId, address,
}: {
  lat: number; lng: number; name: string;
  network?: string | null;
  chargerType?: string;
  stationId?: string | null;
  address?: string | null;
}) {
  const colors = useColors();
  const hasValidCoords = typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng);
  const [modalPhoto, setModalPhoto] = useState<LocationPhoto | null>(null);

  const communityId = stationId && !isNaN(Number(stationId)) ? stationId : null;

  const { data: photos = [], isLoading } = useQuery<LocationPhoto[]>({
    queryKey: ["locationPhotos", hasValidCoords ? lat.toFixed(3) : "0", hasValidCoords ? lng.toFixed(3) : "0", communityId ?? "", address ?? ""],
    enabled: hasValidCoords,
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
        if (communityId) params.set("stationId", communityId);
        if (address) params.set("address", address);
        const url = `${BASE}/api/location-photos?${params}`;
        const r = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!r.ok) return [];
        return r.json();
      } catch {
        return [];
      }
    },
    staleTime: communityId ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  if (!hasValidCoords) return null;
  if (isLoading) {
    return (
      <View style={{ height: 98, borderRadius: 9, backgroundColor: colors.muted + "66", marginBottom: 4, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="image-outline" size={22} color={colors.mutedForeground + "55"} />
      </View>
    );
  }

  if (photos.length === 0) {
    const brandColor = networkColor(network);
    const initials = networkInitials(network, name);
    const typeLabel = chargerType === "DCFC" ? "DC Fast" : chargerType === "Level2" ? "Level 2" : chargerType === "Level1" ? "Level 1" : "EV";
    return (
      <View style={{
        height: 98, borderRadius: 9, marginBottom: 4,
        backgroundColor: brandColor + "18",
        borderWidth: 1, borderColor: brandColor + "33",
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
      }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: brandColor + "28", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18, fontWeight: "800", fontFamily: "Inter_700Bold", color: brandColor }}>{initials}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: brandColor }}>{network ?? name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <Ionicons name="flash-outline" size={12} color={brandColor} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: brandColor + "cc" }}>{typeLabel} Charger</Text>
          </View>
          <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: brandColor + "88", marginTop: 3 }}>No photos yet — be the first!</Text>
        </View>
      </View>
    );
  }

  function navigateToStation() {
    Haptics.selectionAsync();
    setModalPhoto(null);
    setNavigationIntent({ lat, lng, label: name });
    router.push("/(tabs)/map" as any);
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6 }}
      >
        {photos.slice(0, 5).map((photo, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.85}
            onPress={() => { Haptics.selectionAsync(); setModalPhoto(photo); }}
          >
            <View>
              <Image
                source={{ uri: photo.thumbUrl }}
                style={{ width: 148, height: 98, borderRadius: 9, backgroundColor: colors.muted }}
                resizeMode="cover"
              />
              <View style={{
                position: "absolute", top: 5, right: 5,
                backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 6,
                paddingHorizontal: 5, paddingVertical: 2,
              }}>
                <Feather name="info" size={10} color="#fff" />
              </View>
              <View style={{ position: "absolute", bottom: 5, left: 6 }}>
                <Text style={{
                  fontSize: 8, fontWeight: "700", fontFamily: "Inter_700Bold",
                  color: photo.source === "wikimedia" ? "#93c5fd" : "#6ee7b7",
                }}>
                  {photo.source === "wikimedia" ? "WIKIMEDIA" : "OCM"}
                </Text>
              </View>
              {photo.distanceM != null && (
                <View style={{
                  position: "absolute", bottom: 5, right: 6,
                  backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 5,
                  paddingHorizontal: 4, paddingVertical: 2,
                }}>
                  <Text style={{ fontSize: 8, color: "#fff", fontFamily: "Inter_400Regular" }}>
                    {photo.distanceM < 1000 ? `${Math.round(photo.distanceM)}m` : `${(photo.distanceM / 1000).toFixed(1)}km`}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={{ fontSize: 10, color: colors.mutedForeground + "99", marginTop: 5, fontFamily: "Inter_400Regular" }}>
        📍 Tap a photo for info &amp; directions
      </Text>

      <Modal
        visible={!!modalPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setModalPhoto(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}
          onPress={() => setModalPhoto(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              paddingBottom: 32,
              overflow: "hidden",
            }}>
              {modalPhoto && (
                <>
                  <Image
                    source={{ uri: modalPhoto.thumbUrl }}
                    style={{ width: SW, height: SW * 0.55 }}
                    resizeMode="cover"
                  />
                  <View style={{ paddingHorizontal: 18, paddingTop: 14 }}>
                    {modalPhoto.title ? (
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, fontFamily: "Inter_700Bold", marginBottom: 4 }} numberOfLines={2}>
                        {modalPhoto.title}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <View style={{
                        paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5,
                        backgroundColor: modalPhoto.source === "wikimedia" ? "#3b82f622" : "#0D9E7E22",
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: modalPhoto.source === "wikimedia" ? "#93c5fd" : "#6ee7b7", fontFamily: "Inter_700Bold" }}>
                          {modalPhoto.source === "wikimedia" ? "WIKIMEDIA" : "OCM"}
                        </Text>
                      </View>
                      {modalPhoto.distanceM != null && (
                        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                          {modalPhoto.distanceM < 1000
                            ? `${Math.round(modalPhoto.distanceM)} m from station`
                            : `${(modalPhoto.distanceM / 1000).toFixed(1)} km from station`}
                        </Text>
                      )}
                    </View>
                    {modalPhoto.attribution ? (
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 10 }} numberOfLines={1}>
                        © {modalPhoto.attribution}
                      </Text>
                    ) : null}
                    <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 14 }} numberOfLines={2}>
                      📍 {name}
                    </Text>
                    {navState.isActive ? (
                      <View style={{ gap: 8 }}>
                        <TouchableOpacity
                          onPress={navigateToStation}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "center",
                            gap: 7, backgroundColor: colors.primary, borderRadius: 10,
                            paddingVertical: 13,
                          }}
                        >
                          <Feather name="navigation-2" size={15} color="#fff" />
                          <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" }} numberOfLines={1}>
                            Navigate to {modalPhoto.title || name}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setModalPhoto(null)}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "center",
                            gap: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
                            paddingVertical: 12,
                          }}
                        >
                          <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
                          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>
                            Continue to {navState.destLabel || "destination"}
                          </Text>
                        </TouchableOpacity>
                        {modalPhoto.sourceUrl ? (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(modalPhoto!.sourceUrl!)}
                            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
                          >
                            <Feather name="external-link" size={12} color={colors.mutedForeground + "99"} />
                            <Text style={{ fontSize: 11, color: colors.mutedForeground + "99", fontFamily: "Inter_400Regular" }}>View source</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity
                          onPress={navigateToStation}
                          style={{
                            flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                            gap: 6, backgroundColor: colors.primary, borderRadius: 10,
                            paddingVertical: 12,
                          }}
                        >
                          <Feather name="navigation-2" size={15} color="#fff" />
                          <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" }}>
                            Navigate Here
                          </Text>
                        </TouchableOpacity>
                        {modalPhoto.sourceUrl ? (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(modalPhoto!.sourceUrl!)}
                            style={{
                              flexDirection: "row", alignItems: "center", justifyContent: "center",
                              gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
                              paddingVertical: 12, paddingHorizontal: 16,
                            }}
                          >
                            <Feather name="external-link" size={14} color={colors.mutedForeground} />
                            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>Source</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    )}
                  </View>
                </>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Navigation helper (unchanged)
───────────────────────────────────────────────────────────────────────────── */

function navigateToDetail(station: EvStation) {
  const isCommunity = station.source === "community";
  if (isCommunity) {
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
      ...(station.pricingUrl && { pricingUrl: station.pricingUrl }),
      distanceMiles: String(station.distanceMiles),
      ...(station.averageRating != null && { averageRating: String(station.averageRating) }),
      reviewCount: String(station.reviewCount),
    });
    router.push(`/station/external/${encodeURIComponent(station.id)}?${params}` as any);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   StationCard — public API
───────────────────────────────────────────────────────────────────────────── */

export type StationCardVariant = "full" | "compact" | "horizontal";

type StationCardProps = {
  station: EvStation;
  onReportStatus?: (id: string) => void;
  variant?: StationCardVariant;
};

export function StationCard({ station, onReportStatus, variant = "full" }: StationCardProps) {
  if (variant === "compact") return <CompactCard station={station} />;
  if (variant === "horizontal") return <HorizontalCard station={station} />;
  return <FullCard station={station} onReportStatus={onReportStatus} />;
}

/* ─────────────────────────────────────────────────────────────────────────────
   FullCard — default variant (all functionality)
───────────────────────────────────────────────────────────────────────────── */

function FullCard({ station, onReportStatus }: Omit<StationCardProps, "variant">) {
  const colors = useColors();
  const isCommunity = station.source === "community";
  const cta = stationCta(station);
  const netLink = getNetworkLink(station.network);
  const [rateVisible, setRateVisible] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmCount, setConfirmCount] = useState(station.latestReport?.confirmations ?? 0);
  const chargeEst = chargeEstimate(station.powerKw, station.pricePerKwh);
  const stationDbId = isCommunity ? Number(station.id.replace(/^db-/, "")) : undefined;
  const stationExtId = !isCommunity ? station.id : undefined;
  const externalStationData: Record<string, unknown> | undefined = !isCommunity ? {
    name: station.name,
    address: station.address,
    city: station.city,
    state: station.state,
    lat: station.lat,
    lng: station.lng,
    chargerType: station.chargerType,
    powerKw: station.powerKw,
    pricePerKwh: station.pricePerKwh,
    priceText: station.priceText,
    isFree: station.isFree,
    totalPorts: station.totalPorts,
    availablePorts: station.availablePorts,
    status: station.status,
    network: station.network,
    website: station.website,
  } : undefined;
  const { isFavorited, toggle: toggleFavorite, isPending: favPending } = useFavoriteToggle(
    isCommunity ? stationDbId : stationExtId,
    externalStationData,
  );

  const hasRecentReport =
    station.latestReport != null &&
    isRecentReport(station.latestReport.createdAt) &&
    REPORT_BADGE[station.latestReport.reportType] != null;

  const ctaLabel =
    cta === "charge_now" ? "Charge Now" :
    cta === "network_app" && netLink ? `Open ${netLink.label}` :
    "Charge Here";

  const cardA11yLabel = [
    station.name,
    station.chargerType === "DCFC" ? "DC Fast" : station.chargerType === "Level2" ? "Level 2" : "Level 1",
    station.powerKw != null ? `${station.powerKw} kilowatts` : null,
    station.status === "available" ? "available" : station.status === "busy" ? "in use" : station.status,
    station.availablePorts != null && station.totalPorts != null
      ? `${station.availablePorts} of ${station.totalPorts} ports free`
      : station.totalPorts != null ? `${station.totalPorts} ports` : null,
    `${Number(station.distanceMiles).toFixed(1)} miles away`,
    station.isFree ? "free" : station.pricePerKwh != null ? `$${Number(station.pricePerKwh).toFixed(2)} per kilowatt-hour` : null,
  ].filter(Boolean).join(", ");

  async function handleConfirmReport() {
    if (confirmDone || !station.latestReport) return;
    Haptics.selectionAsync();
    setConfirmDone(true);
    setConfirmCount((c) => c + 1);
    try {
      await fetch(
        `${BASE}/api/ev-stations/${encodeURIComponent(station.id)}/status-report/${station.latestReport.id}/confirm`,
        { method: "POST" }
      );
    } catch {}
  }

  function handleDir() {
    Haptics.selectionAsync();
    setNavigationIntent({ lat: station.lat, lng: station.lng, label: station.name });
    router.push("/(tabs)/map" as any);
  }

  function handleCta() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cta === "network_app" && station.network) openNetworkApp(station.network, Linking);
    else if (cta === "charge_now" || station.source === "community") {
      router.push(`/station/${station.id}?charge=1` as any);
    } else {
      setNavigationIntent({ lat: station.lat, lng: station.lng, label: station.name });
      router.push("/(tabs)/map" as any);
    }
  }

  return (
    <>
      <View
        style={[
          S.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            ...(isCommunity ? {
              borderLeftWidth: 3,
              borderLeftColor: colors.primary,
            } : {}),
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync(); navigateToDetail(station); }}
          activeOpacity={0.93}
          style={{ gap: 10 }}
          accessibilityRole="button"
          accessibilityLabel={cardA11yLabel}
          accessibilityHint="Opens station details"
        >
          {/* Community badge */}
          {isCommunity && !netLink && (
            <Badge
              variant="primary"
              label="Community Station"
              icon={<Ionicons name="flash" size={10} color={colors.primary} />}
            />
          )}

          {/* Header row */}
          <View style={S.cardHeader}>
            <View style={[S.iconWrap, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="flash" size={22} color={colors.primary} />
            </View>
            <View style={S.cardInfo}>
              <Typography variant="headline" color={colors.foreground} numberOfLines={1}>
                {station.name}
              </Typography>
              <Typography variant="caption" color={colors.mutedForeground} numberOfLines={1}>
                {[station.address, station.city].filter(Boolean).join(", ") || "Address unknown"}
              </Typography>
            </View>
            <TouchableOpacity
              onPress={handleDir}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Navigate to ${station.name}`}
            >
              <View style={[S.distBadge, { backgroundColor: colors.primary + "12" }]}>
                <Feather name="navigation" size={10} color={colors.primary} />
                <Text style={[S.distTxt, { color: colors.primary }]}>
                  {Number(station.distanceMiles).toFixed(1)} mi
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Chips row */}
          <View style={S.chipsRow}>
            <StatusChip status={station.status} />
            <TypeBadge type={station.chargerType} />
            {station.powerKw != null && (
              <Badge variant="muted" label={`${station.powerKw} kW`} />
            )}
            {station.isFree ? (
              <Badge variant="success" label="Free" />
            ) : station.priceText ? (
              <Typography variant="callout" color={colors.foreground} style={S.priceTxt}>
                {station.priceText}
              </Typography>
            ) : station.pricePerKwh != null ? (
              <Typography variant="callout" color={colors.foreground} style={S.priceTxt}>
                ${Number(station.pricePerKwh).toFixed(2)}/kWh
              </Typography>
            ) : null}
            {station.totalPorts != null && (
              <Badge
                variant={
                  station.availablePorts != null && station.availablePorts > 0
                    ? "primary"
                    : "muted"
                }
                label={
                  station.availablePorts != null
                    ? `${station.availablePorts}/${station.totalPorts} ports`
                    : `${station.totalPorts} ports`
                }
              />
            )}
          </View>

          {/* Charge estimate + status report */}
          {(chargeEst || hasRecentReport) && (
            <View style={S.estimateRow}>
              {chargeEst && (
                <View style={S.estimateInner}>
                  <Typography variant="caption" color={colors.mutedForeground}>⏱</Typography>
                  <Typography variant="caption" color={colors.foreground} style={{ fontWeight: "600" }}>
                    {chargeEst.time}
                  </Typography>
                  {chargeEst.cost ? (
                    <Typography variant="caption" color={colors.mutedForeground}>
                      · {chargeEst.cost}
                    </Typography>
                  ) : null}
                  <Typography variant="caption" color={colors.mutedForeground}>
                    for {chargeEst.kwh} kWh
                  </Typography>
                </View>
              )}
              {hasRecentReport && station.latestReport && (
                <View style={S.reportRow}>
                  <Badge
                    variant={
                      station.latestReport.reportType === "working" ? "success" :
                      station.latestReport.reportType === "busy"    ? "warning" : "error"
                    }
                    label={REPORT_BADGE[station.latestReport.reportType]!.label}
                  />
                  <TouchableOpacity
                    onPress={handleConfirmReport}
                    style={[
                      S.confirmBtn,
                      { backgroundColor: confirmDone ? colors.primary + "20" : colors.muted },
                    ]}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm report, ${confirmCount} ${confirmCount === 1 ? "confirmation" : "confirmations"}`}
                  >
                    <Text style={{ fontSize: 12 }}>👍</Text>
                    <Typography variant="caption" color={confirmDone ? colors.primary : colors.mutedForeground}>
                      {confirmCount}
                    </Typography>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Star rating */}
          <View style={S.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Ionicons
                key={s}
                name={station.averageRating && s <= Math.round(station.averageRating) ? "star" : "star-outline"}
                size={13}
                color={station.averageRating && s <= Math.round(station.averageRating) ? colors.warning : colors.border}
              />
            ))}
            {station.averageRating && station.averageRating > 0 ? (
              <>
                <Typography variant="caption" color={colors.foreground} style={S.starVal}>
                  {station.averageRating.toFixed(1)}
                </Typography>
                <Typography variant="caption" color={colors.mutedForeground}>
                  ({station.reviewCount})
                </Typography>
              </>
            ) : (
              <Typography variant="caption" color={colors.mutedForeground}>No reviews yet</Typography>
            )}
          </View>
        </TouchableOpacity>

        {/* Photo strip — outside TouchableOpacity so horizontal scroll works */}
        <CardPhotoStrip
          lat={station.lat}
          lng={station.lng}
          name={station.name}
          network={station.network}
          chargerType={station.chargerType}
          stationId={station.id}
          address={[station.address, station.city, station.state].filter(Boolean).join(", ") || null}
        />

        {/* Actions */}
        <View style={S.actions}>
          <Button
            variant={cta === "network_app" ? "info" : "primary"}
            size="sm"
            label={ctaLabel}
            onPress={handleCta}
            haptic="medium"
            style={{ flex: 1 }}
            icon={
              <Ionicons
                name={cta === "network_app" ? "open-outline" : "flash"}
                size={14}
                color="#fff"
              />
            }
          />
          <Button
            variant="warning"
            size="sm"
            label="Rate"
            onPress={() => { Haptics.selectionAsync(); setRateVisible(true); }}
            haptic="light"
            accessibilityLabel={`Rate ${station.name}`}
            icon={<Ionicons name="star-outline" size={13} color={colors.warningForeground} />}
          />
          <TouchableOpacity
            style={[
              S.iconBtn,
              {
                backgroundColor: isFavorited ? colors.errorBackground : colors.muted,
                opacity: favPending ? 0.5 : 1,
              },
            ]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleFavorite(); }}
            activeOpacity={0.8}
            disabled={favPending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isFavorited ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}
            accessibilityState={{ busy: favPending }}
          >
            <Ionicons
              name={isFavorited ? "heart" : "heart-outline"}
              size={16}
              color={isFavorited ? colors.error : colors.mutedForeground}
            />
          </TouchableOpacity>
          {onReportStatus && (
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: colors.errorBackground }]}
              onPress={() => { Haptics.selectionAsync(); onReportStatus(station.id); }}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Report issue at ${station.name}`}
            >
              <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[S.iconBtn, { backgroundColor: colors.muted }]}
            onPress={handleDir}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${station.name}`}
          >
            <Feather name="navigation" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {rateVisible && (
        <QuickRateSheet
          visible={rateVisible}
          stationId={stationDbId}
          externalId={stationExtId}
          stationName={station.name}
          onClose={() => setRateVisible(false)}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   CompactCard — map callouts / dense lists (no photo strip, no actions)
───────────────────────────────────────────────────────────────────────────── */

function CompactCard({ station }: { station: EvStation }) {
  const colors = useColors();

  const cardA11yLabel = [
    station.name,
    station.chargerType === "DCFC" ? "DC Fast" : station.chargerType === "Level2" ? "Level 2" : "Level 1",
    station.status === "available" ? "available" : station.status === "busy" ? "in use" : station.status,
    `${Number(station.distanceMiles).toFixed(1)} miles away`,
    station.isFree ? "free" : station.pricePerKwh != null ? `$${Number(station.pricePerKwh).toFixed(2)} per kilowatt-hour` : null,
  ].filter(Boolean).join(", ");

  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); navigateToDetail(station); }}
      activeOpacity={0.92}
      style={[
        S.compactCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          ...(station.source === "community" ? { borderLeftWidth: 3, borderLeftColor: colors.primary } : {}),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={cardA11yLabel}
      accessibilityHint="Opens station details"
    >
      {/* Row 1: icon + name + status */}
      <View style={S.compactRow}>
        <View style={[S.compactIcon, { backgroundColor: colors.primary + "18" }]}>
          <Ionicons name="flash" size={16} color={colors.primary} />
        </View>
        <Typography variant="callout" color={colors.foreground} numberOfLines={1} style={{ flex: 1, fontWeight: "600" }}>
          {station.name}
        </Typography>
        <StatusChip status={station.status} />
      </View>

      {/* Row 2: type + distance + price */}
      <View style={[S.compactRow, S.compactRowIndent]}>
        <TypeBadge type={station.chargerType} />
        <Typography variant="caption" color={colors.mutedForeground}>
          {Number(station.distanceMiles).toFixed(1)} mi
        </Typography>
        {station.isFree ? (
          <Badge variant="success" label="Free" />
        ) : station.pricePerKwh != null ? (
          <Typography variant="caption" color={colors.foreground} style={{ fontWeight: "700" }}>
            ${Number(station.pricePerKwh).toFixed(2)}/kWh
          </Typography>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   HorizontalCard — carousels / suggested stations
───────────────────────────────────────────────────────────────────────────── */

function HorizontalCard({ station }: { station: EvStation }) {
  const colors = useColors();
  const cta = stationCta(station);
  const netLink = getNetworkLink(station.network);

  const ctaLabel =
    cta === "charge_now" ? "Charge Now" :
    cta === "network_app" && netLink ? `Open ${netLink.label}` :
    "Go";

  function handleCta() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cta === "network_app" && station.network) openNetworkApp(station.network, Linking);
    else if (cta === "charge_now" || station.source === "community") {
      router.push(`/station/${station.id}?charge=1` as any);
    } else {
      setNavigationIntent({ lat: station.lat, lng: station.lng, label: station.name });
      router.push("/(tabs)/map" as any);
    }
  }

  const cardA11yLabel = [
    station.name,
    station.chargerType === "DCFC" ? "DC Fast" : station.chargerType === "Level2" ? "Level 2" : "Level 1",
    station.status === "available" ? "available" : station.status === "busy" ? "in use" : station.status,
    `${Number(station.distanceMiles).toFixed(1)} miles away`,
    station.isFree ? "free" : station.pricePerKwh != null ? `$${Number(station.pricePerKwh).toFixed(2)} per kilowatt-hour` : null,
  ].filter(Boolean).join(", ");

  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); navigateToDetail(station); }}
      activeOpacity={0.92}
      style={[
        S.horizCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          ...(station.source === "community" ? { borderLeftWidth: 3, borderLeftColor: colors.primary } : {}),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={cardA11yLabel}
      accessibilityHint="Opens station details"
    >
      {/* Left: icon */}
      <View style={[S.horizIcon, { backgroundColor: colors.primary + "18" }]}>
        <Ionicons name="flash" size={20} color={colors.primary} />
      </View>

      {/* Middle: name + address + badges */}
      <View style={S.horizMid}>
        <Typography variant="callout" color={colors.foreground} numberOfLines={1} style={{ fontWeight: "700" }}>
          {station.name}
        </Typography>
        <Typography variant="caption" color={colors.mutedForeground} numberOfLines={1}>
          {[station.address, station.city].filter(Boolean).join(", ") || "Address unknown"}
          {" · "}{Number(station.distanceMiles).toFixed(1)} mi
        </Typography>
        <View style={[S.chipsRow, { marginTop: 4 }]}>
          <StatusChip status={station.status} />
          <TypeBadge type={station.chargerType} />
        </View>
      </View>

      {/* Right: price + CTA */}
      <View style={S.horizRight}>
        {station.isFree ? (
          <Typography variant="caption" color={colors.success} style={{ fontWeight: "700" }}>Free</Typography>
        ) : station.pricePerKwh != null ? (
          <Typography variant="caption" color={colors.foreground} style={{ fontWeight: "700" }}>
            ${Number(station.pricePerKwh).toFixed(2)}<Typography variant="caption" color={colors.mutedForeground}>/kWh</Typography>
          </Typography>
        ) : null}
        <Button
          variant={cta === "network_app" ? "info" : "primary"}
          size="sm"
          label={ctaLabel}
          onPress={handleCta}
          haptic="medium"
          accessibilityLabel={`${ctaLabel} at ${station.name}`}
        />
      </View>
    </TouchableOpacity>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Styles
───────────────────────────────────────────────────────────────────────────── */

const S = StyleSheet.create({
  liveDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: "#22c55e",
  },

  card: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
    gap: 12,
    shadowColor: "#1A2530",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 46, height: 46, borderRadius: 15,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  cardInfo: { flex: 1, minWidth: 0 },

  distBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
  },
  distTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  priceTxt: { fontWeight: "700", marginLeft: "auto" },

  estimateRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  estimateInner: { flexDirection: "row", alignItems: "center", gap: 3 },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  confirmBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
  },

  starsRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  starVal: { fontWeight: "700", marginLeft: 4 },

  actions: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },

  compactCard: {
    borderRadius: 14, borderWidth: 1, marginBottom: 8, padding: 10, gap: 6,
    shadowColor: "#1A2530", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compactRowIndent: { paddingLeft: 44 },
  compactIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  horizCard: {
    borderRadius: 16, borderWidth: 1, marginBottom: 8, padding: 12,
    flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#1A2530", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  horizIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  horizMid: { flex: 1, minWidth: 0 },
  horizRight: {
    flexShrink: 0, alignItems: "flex-end", gap: 6,
  },
});
