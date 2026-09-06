import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Modal,
  TextInput, KeyboardAvoidingView, ScrollView, Linking,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GasRateSheet } from "@/components/GasRateSheet";
import { CardPhotoStrip } from "@/components/StationCard";
import { useIsButtonEnabled } from "@/hooks/useButtonConfigs";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { WallpaperLayer } from "@/components/WallpaperPicker";
import { useWallpaper } from "@/contexts/WallpaperContext";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type GasPrices = {
  regularCents: number | null;
  midCents: number | null;
  premiumCents: number | null;
  dieselCents: number | null;
  source: "osm" | "community" | "eia" | "fred" | "aaa" | null;
  reporterName: string | null;
  reportedAt: string | null;
  regionName?: string | null;
};

type GasStation = {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  distanceMiles: number | null;
  fuelTypes: string[];
  hasCarWash: boolean;
  opening_hours: string | null;
  phone: string | null;
  osmUrl: string;
  prices: GasPrices;
  averageRating: number | null;
  reviewCount: number;
};

type SortBy = "distance" | "price_regular" | "price_diesel";
type FuelFilter = "all" | "regular" | "diesel" | "premium";

const RADII = [5, 10, 25, 50];

function fmtCents(c: number | null): string {
  return c !== null ? `$${(c / 100).toFixed(3)}` : "—";
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function PricePill({ label, cents, best }: { label: string; cents: number | null; best?: boolean }) {
  const colors = useColors();
  return (
    <View style={[
      PP.pill,
      best
        ? { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }
        : { backgroundColor: colors.muted, borderColor: colors.border },
    ]}>
      <Text style={[PP.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[PP.value, { color: best ? colors.primary : cents !== null ? colors.foreground : colors.mutedForeground }]}>
        {fmtCents(cents)}
      </Text>
      {best && cents !== null && <Text style={[PP.bestTxt, { color: colors.primary }]}>BEST</Text>}
    </View>
  );
}
const PP = StyleSheet.create({
  pill: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7, alignItems: "center", minWidth: 62 },
  label: { fontSize: 9, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 1 },
  bestTxt: { fontSize: 8, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 1 },
});

function ReportModal({ station, onClose, onSaved }: {
  station: GasStation;
  onClose: () => void;
  onSaved: (prices: GasPrices) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [regular, setRegular] = useState(station.prices.regularCents ? (station.prices.regularCents / 100).toFixed(3) : "");
  const [mid, setMid] = useState(station.prices.midCents ? (station.prices.midCents / 100).toFixed(3) : "");
  const [premium, setPremium] = useState(station.prices.premiumCents ? (station.prices.premiumCents / 100).toFixed(3) : "");
  const [diesel, setDiesel] = useState(station.prices.dieselCents ? (station.prices.dieselCents / 100).toFixed(3) : "");
  const [reporter, setReporter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toCents(v: string): number | null {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0 || n > 20) return null;
    return Math.round(n * 100);
  }

  async function submit() {
    const reg = toCents(regular), mi = toCents(mid), pre = toCents(premium), die = toCents(diesel);
    if (!reg && !mi && !pre && !die) { setError("Enter at least one price"); return; }
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`${BASE}/api/gas-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osmId: station.id, regularCents: reg, midCents: mi, premiumCents: pre, dieselCents: die, reporterName: reporter || null }),
      });
      if (!r.ok) throw new Error("Failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved({
        regularCents: reg ?? station.prices.regularCents,
        midCents: mi ?? station.prices.midCents,
        premiumCents: pre ?? station.prices.premiumCents,
        dieselCents: die ?? station.prices.dieselCents,
        source: "community", reporterName: reporter || null, reportedAt: new Date().toISOString(),
      });
    } catch { setError("Could not save prices"); } finally { setSaving(false); }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={[RM.overlay]} activeOpacity={1} onPress={onClose} />
        <View style={[RM.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[RM.handle, { backgroundColor: colors.border }]} />
          <View style={RM.sheetHead}>
            <View>
              <Text style={[RM.title, { color: colors.foreground }]}>Update Prices</Text>
              <Text style={[RM.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{station.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[RM.closeBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="close" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={RM.grid}>
            {[
              { label: "Regular", val: regular, set: setRegular },
              { label: "Mid-Grade", val: mid, set: setMid },
              { label: "Premium", val: premium, set: setPremium },
              { label: "Diesel", val: diesel, set: setDiesel },
            ].map(({ label, val, set }) => (
              <View key={label} style={RM.field}>
                <Text style={[RM.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <View style={[RM.inputRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Text style={[RM.dollar, { color: colors.mutedForeground }]}>$</Text>
                  <TextInput
                    style={[RM.input, { color: colors.foreground }]}
                    value={val}
                    onChangeText={set}
                    placeholder="3.499"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            ))}
          </View>
          <View style={[RM.nameField, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <TextInput
              style={[RM.nameInput, { color: colors.foreground }]}
              value={reporter}
              onChangeText={setReporter}
              placeholder="Your name (optional)"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          {!!error && <Text style={RM.errTxt}>{error}</Text>}
          <TouchableOpacity
            style={[RM.btn, { backgroundColor: saving ? colors.muted : colors.primary }]}
            onPress={submit}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={[RM.btnTxt, { color: colors.primaryForeground }]}>Submit Prices</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const RM = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", maxWidth: 240 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  field: { width: "47%" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 5 },
  inputRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 10 },
  dollar: { fontSize: 14, fontFamily: "Inter_500Medium" },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  nameField: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, marginBottom: 12 },
  nameInput: { fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 12 },
  errTxt: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  btn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnTxt: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});

function StarBar({ rating, count, onPress }: { rating: number | null; count: number; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity style={SB.row} onPress={onPress} activeOpacity={0.7}>
      <View style={SB.stars}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Ionicons
            key={i}
            name={rating && i <= Math.round(rating) ? "star" : "star-outline"}
            size={14}
            color={rating && i <= Math.round(rating) ? "#f59e0b" : "#cbd5e1"}
          />
        ))}
      </View>
      {rating && rating > 0 ? (
        <Text style={[SB.val, { color: colors.foreground }]}>{rating.toFixed(1)}</Text>
      ) : null}
      <Text style={[SB.count, { color: colors.mutedForeground }]}>
        {count > 0 ? `(${count} review${count !== 1 ? "s" : ""})` : "No reviews yet"}
      </Text>
      <View style={[SB.ratePill, { backgroundColor: "#fef3c7", borderColor: "#fcd34d" }]}>
        <Ionicons name="star" size={11} color="#d97706" />
        <Text style={SB.rateTxt}>Rate</Text>
      </View>
    </TouchableOpacity>
  );
}
const SB = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e2e8f0" },
  stars: { flexDirection: "row", gap: 2 },
  val: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  count: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  ratePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  rateTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#d97706" },
});

function GasCard({ station, isCheapest, onReport, onRate, onDirections, onPress }: {
  station: GasStation;
  isCheapest: boolean;
  onReport: () => void;
  onRate: () => void;
  onDirections: () => void;
  onPress: () => void;
}) {
  const colors = useColors();
  const p = station.prices;
  const hasAnyPrice = p.regularCents || p.midCents || p.premiumCents || p.dieselCents;
  const sourceLabel = p.source === "community" ? "Community price" : p.source === "aaa" ? `AAA daily avg${p.regionName ? ` · ${p.regionName}` : ""}` : p.source === "eia" ? `EIA regional${p.regionName ? ` · ${p.regionName}` : ""}` : p.source === "fred" ? `${p.regionName ?? "Metro"} avg` : p.source === "osm" ? "OSM price" : null;

  return (
    <View style={[GC.card, { backgroundColor: colors.card, borderColor: isCheapest ? colors.primary + "60" : colors.border }]}>
    <TouchableOpacity
      activeOpacity={0.97}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
    >
      {/* Header */}
      <View style={GC.cardHead}>
        <View style={[GC.iconBox, { backgroundColor: "#f59e0b18" }]}>
          <Ionicons name="car" size={20} color="#f59e0b" />
        </View>
        <View style={GC.nameBlock}>
          <View style={GC.nameRow}>
            <Text style={[GC.name, { color: colors.foreground }]} numberOfLines={1}>{station.name}</Text>
            {isCheapest && (
              <View style={[GC.cheapBadge, { backgroundColor: colors.primary }]}>
                <Text style={[GC.cheapTxt, { color: colors.primaryForeground }]}>Cheapest</Text>
              </View>
            )}
          </View>
          {station.address && (
            <Text style={[GC.addr, { color: colors.mutedForeground }]} numberOfLines={1}>
              {station.address}{station.city ? `, ${station.city}` : ""}
            </Text>
          )}
        </View>
        {station.distanceMiles != null && (
          <TouchableOpacity
            style={GC.distBtn}
            onPress={() => { Haptics.selectionAsync(); onDirections(); }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="navigation" size={11} color={colors.primary} />
            <Text style={[GC.dist, { color: colors.primary }]}>{station.distanceMiles.toFixed(1)} mi</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Prices */}
      <View style={GC.prices}>
        <PricePill label="Regular" cents={p.regularCents} best={isCheapest && !!p.regularCents} />
        <PricePill label="Mid" cents={p.midCents} />
        <PricePill label="Premium" cents={p.premiumCents} />
        <PricePill label="Diesel" cents={p.dieselCents} />
      </View>

      {/* Source note */}
      {hasAnyPrice && p.reportedAt ? (
        <Text style={[GC.sourceNote, { color: colors.mutedForeground }]}>
          {sourceLabel}{p.source === "community" && p.reporterName ? ` · ${p.reporterName}` : ""}{p.reportedAt && p.source === "community" ? ` · ${timeAgo(p.reportedAt)}` : ""}
        </Text>
      ) : (
        <Text style={[GC.sourceNote, { color: colors.mutedForeground, fontStyle: "italic" }]}>
          {sourceLabel ?? "No prices reported yet — tap below to add"}
        </Text>
      )}

      {/* Star rating row — tappable to rate */}
      <StarBar rating={station.averageRating} count={station.reviewCount} onPress={() => { Haptics.selectionAsync(); onRate(); }} />

      {/* Action buttons */}
      <View style={GC.actions}>
        <TouchableOpacity
          style={[GC.actionBtn, { backgroundColor: "#fef3c7", borderColor: "#fcd34d" }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRate(); }}
          activeOpacity={0.8}
        >
          <Ionicons name="star" size={15} color="#d97706" />
          <Text style={[GC.actionTxt, { color: "#d97706" }]}>Rate & Review</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[GC.actionBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReport(); }}
          activeOpacity={0.8}
        >
          <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          <Text style={[GC.actionTxt, { color: colors.mutedForeground }]}>Update Prices</Text>
        </TouchableOpacity>
        {!!station.phone && (
          <TouchableOpacity
            style={[GC.actionBtn, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", flexGrow: 0, paddingHorizontal: 14 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(`tel:${station.phone}`); }}
            activeOpacity={0.8}
          >
            <Feather name="phone" size={14} color="#2563eb" />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>

    {/* Location photo strip — outside TouchableOpacity so horizontal scroll works */}
    <CardPhotoStrip lat={station.lat} lng={station.lng} name={station.name} address={[station.address, station.city].filter(Boolean).join(", ") || null} />
    </View>
  );
}
const GC = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  nameBlock: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cheapBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, flexShrink: 0 },
  cheapTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  name: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1 },
  addr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  distBtn: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 },
  dist: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  prices: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  sourceNote: { fontSize: 11, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  actionTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});

const SORTS: { key: SortBy; label: string }[] = [
  { key: "distance", label: "Nearest" },
  { key: "price_regular", label: "Cheapest Regular" },
  { key: "price_diesel", label: "Cheapest Diesel" },
];

export function GasScreen({ onSwitchMode }: { onSwitchMode?: () => void }) {
  const colors = useColors();
  const wallpaper = useWallpaper("gas");
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const showHomeBtn = useIsButtonEnabled("mobile_header_home_button");

  const { isSignedIn } = useAuth();
  const autoFilterApplied = useRef(false);

  const { data: vehicleProfile } = useQuery<{ fuelType: string | null; vehicleMake: string | null }>({
    queryKey: ["profile-fuel"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/me`);
      if (!r.ok) return { fuelType: null, vehicleMake: null };
      const d = await r.json();
      return { fuelType: d.fuelType ?? null, vehicleMake: d.vehicleMake ?? null };
    },
    enabled: isSignedIn === true,
    staleTime: 5 * 60 * 1000,
  });

  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("distance");
  const [fuelFilter, setFuelFilter] = useState<FuelFilter>("all");
  const [radius, setRadius] = useState(10);
  const [reportingStation, setReportingStation] = useState<GasStation | null>(null);
  const [ratingStation, setRatingStation] = useState<GasStation | null>(null);
  const [stationPrices, setStationPrices] = useState<Record<string, GasPrices>>({});

  const { data: stations, isLoading, refetch, isRefetching } = useQuery<GasStation[]>({
    queryKey: ["gas-stations", loc?.lat, loc?.lng, radius, sortBy],
    queryFn: async () => {
      const p = new URLSearchParams({ lat: String(loc!.lat), lng: String(loc!.lng), radius: String(radius), sortBy });
      const r = await fetch(`${BASE}/api/gas-stations?${p}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!loc,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const getLocation = useCallback(async () => {
    setLocLoading(true);
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } else {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); resolve(); },
            reject
          )
        );
      }
    } finally { setLocLoading(false); }
  }, []);

  useEffect(() => { getLocation(); }, []);

  // Auto-apply fuel filter from saved vehicle on first load
  useEffect(() => {
    if (!vehicleProfile?.fuelType || autoFilterApplied.current) return;
    const ft = vehicleProfile.fuelType;
    if (ft === "diesel") { setFuelFilter("diesel"); autoFilterApplied.current = true; }
    else if (ft === "premium") { setFuelFilter("premium"); autoFilterApplied.current = true; }
    else if (ft === "regular" || ft === "hybrid" || ft === "e85") { setFuelFilter("regular"); autoFilterApplied.current = true; }
  }, [vehicleProfile]);

  const displayStations = (() => {
    const merged = stations?.map((s) => ({ ...s, prices: stationPrices[s.id] ?? s.prices })) ?? [];
    if (fuelFilter === "regular") return merged.filter((s) => s.prices.regularCents !== null);
    if (fuelFilter === "diesel") return merged.filter((s) => s.prices.dieselCents !== null);
    if (fuelFilter === "premium") return merged.filter((s) => s.prices.premiumCents !== null);
    return merged;
  })();

  const pricesWithRegular = displayStations.filter((s) => s.prices.regularCents !== null);
  const cheapestCents = pricesWithRegular.length > 0 ? Math.min(...pricesWithRegular.map((s) => s.prices.regularCents!)) : null;

  const bottomPad = isWeb ? 84 + 34 : 100;

  return (
    <View style={[GS.root, { backgroundColor: wallpaper.isDefault ? colors.background : "transparent" }]}>
      <WallpaperLayer tab="gas" />
      {/* Header */}
      <View style={[GS.header, { paddingTop: topPad + 14, borderBottomColor: colors.border, backgroundColor: wallpaper.isDefault ? colors.background : "transparent" }, onSwitchMode ? { flexDirection: "column", alignItems: "stretch" } : undefined]}>
        {onSwitchMode && (
          <View style={{ flexDirection: "row", backgroundColor: colors.muted + "88", borderRadius: 10, padding: 3, marginBottom: 12 }}>
            <TouchableOpacity
              style={{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8 }}
              onPress={onSwitchMode}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.mutedForeground }}>⚡ EV Charging</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8, backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>⛽ Gas Prices</Text>
            </View>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={[GS.title, { color: colors.foreground }]}>Gas Prices</Text>
            <Text style={[GS.sub, { color: colors.mutedForeground }]}>Community-reported · real time</Text>
          </View>
          <View style={GS.headerBtns}>
            <TouchableOpacity style={[GS.iconBtn, { backgroundColor: colors.primary + "15" }]} onPress={getLocation}>
              <Feather name="navigation" size={18} color={colors.primary} />
            </TouchableOpacity>
            {showHomeBtn && (
              <TouchableOpacity
                style={[GS.iconBtn, { backgroundColor: colors.muted }]}
                onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/home"); }}
              >
                <Feather name="home" size={18} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Filter strip — always visible once loc is set */}
      {loc && (
        <View style={[GS.filterStrip, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          {/* Row 1: Sort + Radius */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={GS.filterRow}
          >
            {/* Sort label */}
            <View style={GS.filterGroup}>
              <Feather name="bar-chart-2" size={12} color={colors.mutedForeground} />
              <Text style={[GS.filterGroupLabel, { color: colors.mutedForeground }]}>Sort</Text>
            </View>
            {SORTS.map((s) => {
              const active = sortBy === s.key;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[
                    GS.filterChip,
                    active
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setSortBy(s.key); }}
                  activeOpacity={0.8}
                >
                  <Feather
                    name={s.key === "distance" ? "navigation" : "tag"}
                    size={11}
                    color={active ? "#fff" : colors.mutedForeground}
                  />
                  <Text style={[GS.filterChipTxt, { color: active ? "#fff" : colors.foreground }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <View style={[GS.filterDivider, { backgroundColor: colors.border }]} />

            {/* Radius label */}
            <View style={GS.filterGroup}>
              <Feather name="map-pin" size={12} color={colors.mutedForeground} />
              <Text style={[GS.filterGroupLabel, { color: colors.mutedForeground }]}>Radius</Text>
            </View>
            {RADII.map((r) => {
              const active = radius === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    GS.filterChip,
                    active
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setRadius(r); }}
                  activeOpacity={0.8}
                >
                  <Text style={[GS.filterChipTxt, { color: active ? "#fff" : colors.foreground }]}>
                    {r} mi
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Row 2: Fuel type */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[GS.filterRow, { paddingTop: 0, paddingBottom: 8 }]}
          >
            <View style={GS.filterGroup}>
              <Feather name="droplet" size={12} color={colors.mutedForeground} />
              <Text style={[GS.filterGroupLabel, { color: colors.mutedForeground }]}>Fuel</Text>
            </View>
            {vehicleProfile?.vehicleMake && vehicleProfile.fuelType && vehicleProfile.fuelType !== "electric" && (
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.primary + "14", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 4, borderWidth: 1, borderColor: colors.primary + "30" }}>
                <Ionicons name="car-outline" size={10} color={colors.primary} style={{ marginRight: 3 }} />
                <Text style={{ fontSize: 10, fontWeight: "600", color: colors.primary }}>{vehicleProfile.vehicleMake}</Text>
              </View>
            )}
            {([
              { key: "all" as FuelFilter, label: "All", icon: "grid" },
              { key: "regular" as FuelFilter, label: "Regular", icon: "droplet" },
              { key: "diesel" as FuelFilter, label: "Diesel", icon: "zap" },
              { key: "premium" as FuelFilter, label: "Premium", icon: "star" },
            ] as { key: FuelFilter; label: string; icon: string }[]).map((f) => {
              const active = fuelFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    GS.filterChip,
                    active
                      ? { backgroundColor: "#f59e0b", borderColor: "#f59e0b" }
                      : { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setFuelFilter(f.key); }}
                  activeOpacity={0.8}
                >
                  <Feather
                    name={f.icon as "grid"}
                    size={11}
                    color={active ? "#fff" : colors.mutedForeground}
                  />
                  <Text style={[GS.filterChipTxt, { color: active ? "#fff" : colors.foreground }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* States */}
      {(locLoading || isLoading) && (
        <View style={GS.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      )}

      {!loc && !locLoading && (
        <View style={GS.center}>
          <View style={[GS.stateIcon, { backgroundColor: colors.muted }]}>
            <Feather name="map-pin" size={32} color={colors.mutedForeground} />
          </View>
          <Text style={[GS.emptyTitle, { color: colors.foreground }]}>Allow location</Text>
          <Text style={[GS.emptyText, { color: colors.mutedForeground }]}>To find gas stations near you</Text>
          <TouchableOpacity style={[GS.cta, { backgroundColor: colors.primary }]} onPress={getLocation}>
            <Ionicons name="navigate" size={15} color="#fff" />
            <Text style={GS.ctaTxt}>Use My Location</Text>
          </TouchableOpacity>
        </View>
      )}

      {stations && (
        <FlatList
          data={displayStations}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <GasCard
              station={item}
              isCheapest={cheapestCents !== null && item.prices.regularCents === cheapestCents}
              onReport={() => { Haptics.selectionAsync(); setReportingStation(item); }}
              onRate={() => { Haptics.selectionAsync(); setRatingStation(item); }}
              onDirections={() => { setNavigationIntent({ lat: item.lat, lng: item.lng, label: item.name }); router.push("/(tabs)/map" as any); }}
              onPress={() => {
                const p = item.prices;
                router.push({
                  pathname: "/station/gas/[id]",
                  params: {
                    id: item.id,
                    name: item.name,
                    address: item.address ?? "",
                    city: item.city ?? "",
                    state: item.state ?? "",
                    lat: String(item.lat),
                    lng: String(item.lng),
                    distanceMiles: item.distanceMiles != null ? String(item.distanceMiles) : "",
                    brand: item.brand ?? "",
                    phone: item.phone ?? "",
                    opening_hours: item.opening_hours ?? "",
                    hasCarWash: String(item.hasCarWash),
                    fuelTypes: item.fuelTypes.join(","),
                    osmUrl: item.osmUrl ?? "",
                    regularCents: p.regularCents != null ? String(p.regularCents) : "",
                    midCents: p.midCents != null ? String(p.midCents) : "",
                    premiumCents: p.premiumCents != null ? String(p.premiumCents) : "",
                    dieselCents: p.dieselCents != null ? String(p.dieselCents) : "",
                    priceSource: p.source ?? "",
                    priceReporterName: p.reporterName ?? "",
                    priceReportedAt: p.reportedAt ?? "",
                    priceRegionName: p.regionName ?? "",
                    averageRating: item.averageRating != null ? String(item.averageRating) : "",
                    reviewCount: String(item.reviewCount),
                  },
                });
              }}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPad }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            cheapestCents !== null ? (
              <View style={[GS.priceBar, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
                <Ionicons name="trophy" size={14} color={colors.primary} />
                <Text style={[GS.priceBarTxt, { color: colors.primary }]}>
                  Best regular: ${(cheapestCents / 100).toFixed(3)}/gal nearby
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={GS.center}>
              <View style={[GS.stateIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name="car-outline" size={32} color={colors.mutedForeground} />
              </View>
              <Text style={[GS.emptyTitle, { color: colors.foreground }]}>No stations found</Text>
              <Text style={[GS.emptyText, { color: colors.mutedForeground }]}>Try expanding the radius</Text>
            </View>
          }
        />
      )}

      {reportingStation && (
        <ReportModal
          station={reportingStation}
          onClose={() => setReportingStation(null)}
          onSaved={(prices) => {
            setStationPrices((prev) => ({ ...prev, [reportingStation.id]: prices }));
            setReportingStation(null);
          }}
        />
      )}

      {ratingStation && (
        <GasRateSheet
          visible={!!ratingStation}
          osmId={ratingStation.id}
          stationName={ratingStation.name}
          onClose={() => setRatingStation(null)}
          onReviewed={() => refetch()}
        />
      )}
    </View>
  );
}

const GS = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "800", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  filterStrip: { borderBottomWidth: StyleSheet.hairlineWidth },
  filterRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8 },
  filterGroup: { flexDirection: "row", alignItems: "center", marginRight: 6 },
  filterGroupLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginLeft: 3, marginRight: 4 },
  filterDivider: { width: 1, height: 18, marginHorizontal: 10 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
    marginRight: 6,
  },
  filterChipTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  priceBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  priceBarTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12, marginTop: 40 },
  stateIcon: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, marginTop: 4 },
  ctaTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
});

export default GasScreen;
