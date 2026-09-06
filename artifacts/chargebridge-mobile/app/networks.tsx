import React from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface Network {
  id: string;
  name: string;
  tagline: string;
  connectors: string[];
  levels: string[];
  pricing: string;
  coverage: string;
  website: string;
  color: string;
}

const NETWORKS: Network[] = [
  {
    id: "chargepoint",
    name: "ChargePoint",
    tagline: "Largest charging network in the world",
    connectors: ["J1772", "CCS", "CHAdeMO"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Per-kWh or per-minute, varies by station",
    coverage: "US, Canada, Europe — 50,000+ locations",
    website: "https://www.chargepoint.com",
    color: "#0078D4",
  },
  {
    id: "tesla",
    name: "Tesla Supercharger",
    tagline: "High-speed network, now open to all EVs",
    connectors: ["NACS", "CCS"],
    levels: ["DC Fast (72–250 kW)"],
    pricing: "Per-kWh or per-minute; free for some Tesla owners",
    coverage: "US, Canada, Europe, Asia-Pacific — 50,000+ stalls",
    website: "https://www.tesla.com/supercharger",
    color: "#E31937",
  },
  {
    id: "electrify-america",
    name: "Electrify America",
    tagline: "Ultra-fast DC charging coast to coast",
    connectors: ["CCS", "CHAdeMO"],
    levels: ["DC Fast (50–350 kW)"],
    pricing: "Per-kWh (pass plans available)",
    coverage: "US — 800+ stations, 4,500+ chargers",
    website: "https://www.electrifyamerica.com",
    color: "#00B200",
  },
  {
    id: "evgo",
    name: "EVgo",
    tagline: "America's largest public fast-charging network",
    connectors: ["CCS", "CHAdeMO", "NACS"],
    levels: ["DC Fast (50–350 kW)"],
    pricing: "Per-minute; monthly subscription plans available",
    coverage: "US — 35+ states, 950+ locations",
    website: "https://www.evgo.com",
    color: "#7CB342",
  },
  {
    id: "blink",
    name: "Blink Charging",
    tagline: "Widespread Level 2 network with growing DCFC",
    connectors: ["J1772", "CCS", "CHAdeMO"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Per-kWh or per-hour; some free stations",
    coverage: "US, Europe — 30,000+ locations",
    website: "https://www.blinkcharging.com",
    color: "#00A9E0",
  },
  {
    id: "shell-recharge",
    name: "Shell Recharge",
    tagline: "Charging at Shell stations and beyond",
    connectors: ["J1772", "CCS", "CHAdeMO"],
    levels: ["Level 2", "DC Fast (50–150 kW)"],
    pricing: "Per-kWh",
    coverage: "US, Europe — 40,000+ locations globally",
    website: "https://www.shell.com/electric-vehicle-charging.html",
    color: "#FFC000",
  },
  {
    id: "flo",
    name: "FLO",
    tagline: "Leading network in Canada, expanding in the US",
    connectors: ["J1772", "CCS"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Per-kWh; roaming access available",
    coverage: "Canada, US Northeast — 100,000+ ports",
    website: "https://www.flo.com",
    color: "#0D9E7E",
  },
  {
    id: "rivian",
    name: "Rivian Adventure Network",
    tagline: "Built for Rivian owners, designed for adventure",
    connectors: ["NACS"],
    levels: ["DC Fast (200 kW)"],
    pricing: "Per-kWh for Rivian owners",
    coverage: "US — off-highway corridors and state parks",
    website: "https://rivian.com/adventures/adventure-network",
    color: "#1DB954",
  },
  {
    id: "volta",
    name: "Volta",
    tagline: "Free Level 2 charging at retail destinations",
    connectors: ["J1772", "CCS"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Free (ad-supported) or per-kWh for DCFC",
    coverage: "US — grocery, retail, healthcare locations",
    website: "https://voltacharging.com",
    color: "#6E3FF3",
  },
  {
    id: "circle-k",
    name: "Circle K EV Charging",
    tagline: "Fast charging at convenience stores",
    connectors: ["CCS", "CHAdeMO"],
    levels: ["DC Fast (50–150 kW)"],
    pricing: "Per-kWh",
    coverage: "US, Europe — convenience store locations",
    website: "https://www.circlek.com/ev-charging",
    color: "#E05C00",
  },
  {
    id: "bp-pulse",
    name: "bp pulse",
    tagline: "Fast and ultra-fast charging by BP",
    connectors: ["CCS", "CHAdeMO"],
    levels: ["Level 2", "DC Fast (50–150 kW)"],
    pricing: "Per-kWh or monthly subscription",
    coverage: "US, UK, Europe",
    website: "https://www.bppulse.com",
    color: "#009944",
  },
  {
    id: "evcs",
    name: "EVCS",
    tagline: "West Coast DC fast and Level 2 charging",
    connectors: ["J1772", "CCS", "CHAdeMO"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Per-kWh",
    coverage: "California, Oregon, Washington",
    website: "https://evcs.com",
    color: "#00BCD4",
  },
  {
    id: "francis-energy",
    name: "Francis Energy",
    tagline: "Building out the rural Midwest charging corridor",
    connectors: ["CCS", "CHAdeMO"],
    levels: ["DC Fast (50–150 kW)"],
    pricing: "Per-kWh",
    coverage: "Oklahoma, Kansas, Arkansas, Missouri, Texas",
    website: "https://www.francisenergy.com",
    color: "#FF6F00",
  },
  {
    id: "ev-connect",
    name: "EV Connect",
    tagline: "Smart charging for commercial properties",
    connectors: ["J1772", "CCS"],
    levels: ["Level 2", "DC Fast"],
    pricing: "Per-kWh or per-session — set by host",
    coverage: "US — commercial, retail, municipal",
    website: "https://www.evconnect.com",
    color: "#1565C0",
  },
  {
    id: "semaconnect",
    name: "SemaConnect",
    tagline: "Level 2 charging for workplaces and multifamily",
    connectors: ["J1772"],
    levels: ["Level 2"],
    pricing: "Per-kWh, per-hour, or free — set by host",
    coverage: "US — corporate campuses and residential properties",
    website: "https://semaconnect.com",
    color: "#2196F3",
  },
];

function NetworkCard({ network }: { network: Network }) {
  const colors = useColors();
  const initials = network.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();

  return (
    <View style={[NC.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Name row */}
      <View style={NC.nameRow}>
        <View style={[NC.badge, { backgroundColor: network.color + "22", borderColor: network.color + "44" }]}>
          <Text style={[NC.badgeTxt, { color: network.color }]}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[NC.name, { color: colors.foreground }]}>{network.name}</Text>
          <Text style={[NC.tagline, { color: colors.mutedForeground }]}>{network.tagline}</Text>
        </View>
      </View>

      {/* Detail rows */}
      <View style={[NC.details, { borderTopColor: colors.border }]}>
        <View style={NC.detailRow}>
          <Feather name="zap" size={12} color={colors.primary} style={NC.detailIcon} />
          <Text style={[NC.detailLabel, { color: colors.mutedForeground }]}>Levels: </Text>
          <Text style={[NC.detailVal, { color: colors.foreground }]}>{network.levels.join(" · ")}</Text>
        </View>
        <View style={NC.detailRow}>
          <Feather name="link" size={12} color={colors.primary} style={NC.detailIcon} />
          <Text style={[NC.detailLabel, { color: colors.mutedForeground }]}>Connectors: </Text>
          <Text style={[NC.detailVal, { color: colors.foreground }]}>{network.connectors.join(", ")}</Text>
        </View>
        <View style={NC.detailRow}>
          <Feather name="dollar-sign" size={12} color={colors.primary} style={NC.detailIcon} />
          <Text style={[NC.detailLabel, { color: colors.mutedForeground }]}>Pricing: </Text>
          <Text style={[NC.detailVal, { color: colors.foreground }]} numberOfLines={2}>{network.pricing}</Text>
        </View>
        <View style={NC.detailRow}>
          <Feather name="map-pin" size={12} color={colors.primary} style={NC.detailIcon} />
          <Text style={[NC.detailLabel, { color: colors.mutedForeground }]}>Coverage: </Text>
          <Text style={[NC.detailVal, { color: colors.foreground }]} numberOfLines={2}>{network.coverage}</Text>
        </View>
      </View>

      {/* Website button */}
      <TouchableOpacity
        style={[NC.webBtn, { borderColor: network.color + "55", backgroundColor: network.color + "0e" }]}
        onPress={() => { Haptics.selectionAsync(); Linking.openURL(network.website); }}
        activeOpacity={0.8}
      >
        <Text style={[NC.webBtnTxt, { color: network.color }]}>Visit Website</Text>
        <Feather name="external-link" size={12} color={network.color} />
      </TouchableOpacity>
    </View>
  );
}

export default function NetworksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[NC.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[NC.header, { paddingTop: insets.top + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); router.back(); }} style={NC.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[NC.title, { color: colors.foreground }]}>Charging Networks</Text>
          <Text style={[NC.subtitle, { color: colors.mutedForeground }]}>{NETWORKS.length} major networks</Text>
        </View>
      </View>

      {/* Intro banner */}
      <View style={[NC.banner, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
        <Feather name="info" size={14} color={colors.primary} />
        <Text style={[NC.bannerTxt, { color: colors.primary }]}>
          ChargeBridge shows stations from all major networks plus independent community chargers not listed elsewhere.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {NETWORKS.map(n => <NetworkCard key={n.id} network={n} />)}
      </ScrollView>
    </View>
  );
}

const NC = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  bannerTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  badge: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, flexShrink: 0 },
  badgeTxt: { fontSize: 14, fontWeight: "800", fontFamily: "Inter_700Bold" },
  name: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  tagline: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },

  details: { paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 5 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap" },
  detailIcon: { marginRight: 5, marginTop: 1, flexShrink: 0 },
  detailLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  detailVal: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },

  webBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, margin: 12, marginTop: 0, borderRadius: 10, borderWidth: 1, paddingVertical: 9 },
  webBtnTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
