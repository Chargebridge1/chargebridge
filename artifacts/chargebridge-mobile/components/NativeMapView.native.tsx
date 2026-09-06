import React, { useState } from "react";
import { View, StyleSheet, Animated } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNetworkLink } from "@/utils/networkLinks";
import { useRef, useEffect } from "react";

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
  distanceMiles: number;
};

function statusColor(s: string) {
  return s === "available" ? "#22c55e" : s === "busy" ? "#f59e0b" : "#ef4444";
}

function chargerLabel(t: string) {
  return t === "DCFC" ? "DC Fast" : t === "Level2" ? "Level 2" : "Level 1";
}

function priceLabel(s: EvStation): string {
  if (s.isFree) return "Free";
  if (s.priceText) return s.priceText;
  if (s.pricePerKwh) return `$${Number(s.pricePerKwh).toFixed(2)}/kWh`;
  return "";
}

function stationCta(s: EvStation) {
  if ((s as any).ocppChargePointId) return "charge_now";
  if (getNetworkLink(s.network)) return "network_app";
  if (s.source === "community") return "charge_here";
  return "directions";
}

function StationCallout({
  station: s,
  onDismiss,
  onAction,
  onDirections,
}: {
  station: EvStation;
  onDismiss: () => void;
  onAction: (s: EvStation) => void;
  onDirections: (s: EvStation) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(260)).current;
  const cta = stationCta(s);
  const netLink = getNetworkLink(s.network);
  const dot = statusColor(s.status);
  const isCommunity = s.source === "community";
  const isAvailable = s.status === "available";

  const ctaColor =
    cta === "network_app" ? "#3b82f6" :
    cta === "directions" ? colors.mutedForeground :
    colors.primary;
  const ctaLabel =
    cta === "charge_now" ? "Charge Now" :
    cta === "network_app" && netLink ? `Open ${netLink.label}` :
    cta === "charge_here" ? "Charge Here" :
    "Get Directions";
  const ctaIcon: any =
    cta === "network_app" ? "open-outline" :
    cta === "directions" ? "navigate-outline" :
    "flash";

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, []);

  return (
    <Animated.View
      style={[
        C.callout,
        {
          backgroundColor: colors.card,
          borderColor: isCommunity ? colors.primary + "44" : colors.border,
          bottom: insets.bottom + 16,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={C.handleRow}>
        <View style={[C.handle, { backgroundColor: colors.border }]} />
      </View>

      <View
        style={C.closeHit}
        onTouchEnd={onDismiss}
      >
        <View style={[C.closeCircle, { backgroundColor: colors.muted }]}>
          <Ionicons name="close" size={14} color={colors.mutedForeground} />
        </View>
      </View>

      {isCommunity && (
        <View style={[C.communityBadge, { backgroundColor: colors.primary + "14" }]}>
          <Ionicons name="flash" size={10} color={colors.primary} />
          <Text style={[C.communityTxt, { color: colors.primary }]}>Community Station</Text>
        </View>
      )}

      <Text style={[C.name, { color: colors.foreground }]} numberOfLines={2}>
        {s.name}
      </Text>
      <Text style={[C.addr, { color: colors.mutedForeground }]} numberOfLines={1}>
        {[s.address, s.city, s.state].filter(Boolean).join(", ") || "Address unknown"}
      </Text>

      <View style={C.metaRow}>
        <View style={[C.statusPill, { backgroundColor: dot + "22" }]}>
          <View style={[C.statusDot, { backgroundColor: dot }]} />
          <Text style={[C.statusTxt, { color: dot }]}>{s.status}</Text>
        </View>
        <View style={[
          C.badge,
          { backgroundColor: s.chargerType === "DCFC" ? "#0D9E7E22" : s.chargerType === "Level2" ? "#3b82f622" : "#94a3b822" }
        ]}>
          <Text style={[C.badgeTxt, { color: s.chargerType === "DCFC" ? "#0D9E7E" : s.chargerType === "Level2" ? "#3b82f6" : "#64748b" }]}>
            {chargerLabel(s.chargerType)}
          </Text>
        </View>
        {s.powerKw != null && (
          <Text style={[C.meta, { color: colors.mutedForeground }]}>{s.powerKw} kW</Text>
        )}
        {priceLabel(s) ? (
          <Text style={[C.meta, { color: colors.foreground, fontWeight: "700" as const }]}>{priceLabel(s)}</Text>
        ) : null}
        {s.totalPorts != null && (
          <Text style={[C.meta, { color: s.availablePorts ? colors.primary : colors.mutedForeground }]}>
            {s.availablePorts ?? "?"}/{s.totalPorts} ports
          </Text>
        )}
        <Text style={[C.dist, { color: colors.primary }]}>
          {Number(s.distanceMiles).toFixed(1)} mi
        </Text>
      </View>

      <View style={C.actionRow}>
        {isAvailable && (
          <View
            style={[C.primaryBtn, { backgroundColor: ctaColor, flex: 1 }]}
            onTouchEnd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onAction(s); }}
          >
            <Ionicons name={ctaIcon} size={15} color="#fff" />
            <Text style={C.primaryBtnTxt}>{ctaLabel}</Text>
          </View>
        )}
        <View
          style={[C.dirBtn, { backgroundColor: colors.muted }]}
          onTouchEnd={() => { Haptics.selectionAsync(); onDirections(s); }}
        >
          <Feather name="navigation" size={15} color={colors.mutedForeground} />
          {!isAvailable && <Text style={[C.dirBtnTxt, { color: colors.mutedForeground }]}>Directions</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

import { Text } from "react-native";

export type NativeMapViewProps = {
  stations: EvStation[];
  userLat: number;
  userLng: number;
  onAction: (s: EvStation) => void;
  onDirections: (s: EvStation) => void;
};

export function NativeMapView({ stations, userLat, userLng, onAction, onDirections }: NativeMapViewProps) {
  const [selected, setSelected] = useState<EvStation | null>(null);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: userLat,
          longitude: userLng,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        onPress={() => setSelected(null)}
      >
        {stations.map((s) => {
          const dot = statusColor(s.status);
          const isCommunity = s.source === "community";
          const pinBg = isCommunity ? "#0D9E7E" : "#3b82f6";
          return (
            <Marker
              key={s.id}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              onPress={() => { Haptics.selectionAsync(); setSelected(s); }}
              anchor={{ x: 0.5, y: 0.7 }}
            >
              <View style={{ alignItems: "center" }}>
                <View style={[P.pin, { backgroundColor: pinBg }]}>
                  <Ionicons name="flash" size={11} color="#fff" />
                  <View style={[P.dot, { backgroundColor: dot, borderColor: pinBg }]} />
                </View>
                <View style={P.label}>
                  <Text style={P.labelTxt} numberOfLines={1}>
                    {s.name.length > 14 ? s.name.slice(0, 13) + "…" : s.name}
                  </Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {selected && (
        <StationCallout
          key={selected.id}
          station={selected}
          onDismiss={() => setSelected(null)}
          onAction={(s) => { setSelected(null); onAction(s); }}
          onDirections={(s) => { setSelected(null); onDirections(s); }}
        />
      )}
    </View>
  );
}

const P = StyleSheet.create({
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  dot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  label: {
    marginTop: 3,
    backgroundColor: "rgba(0,0,0,0.70)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    maxWidth: 88,
  },
  labelTxt: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
});

const C = StyleSheet.create({
  callout: {
    position: "absolute",
    left: 14,
    right: 14,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  handleRow: { alignItems: "center", marginBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  closeHit: { position: "absolute", top: 12, right: 12, padding: 4 },
  closeCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  communityBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: 8,
  },
  communityTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 3, paddingRight: 34 },
  addr: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", textTransform: "capitalize" },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dist: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", marginLeft: "auto" },
  actionRow: { flexDirection: "row", gap: 10 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, borderRadius: 12, paddingVertical: 12,
  },
  primaryBtnTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  dirBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
  },
  dirBtnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
