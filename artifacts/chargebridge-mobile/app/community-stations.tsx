import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Modal, ScrollView,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TypeBadge, StatusChip, LiveDot, chargeEstimate, REPORT_BADGE, isRecentReport, CardPhotoStrip } from "@/components/StationCard";
import { setNavigationIntent } from "@/utils/navigationIntent";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type ChargeableStation = {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
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
  averageRating: number | null;
  reviewCount: number;
  distanceMiles: number | null;
  isFavorited: boolean;
  latestReport: { id: number; reportType: string; confirmations: number; createdAt: string } | null;
};

type FilterMeta = {
  countries: string[];
  countryStates: Record<string, string[]>;
  stateCities: Record<string, string[]>;
};

type PickerSheetDef = {
  title: string;
  items: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
};

function FilterPickerModal({
  sheet,
  onClose,
}: {
  sheet: PickerSheetDef | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!sheet) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[FP.root, { backgroundColor: colors.background }]}>
        <View style={[FP.header, { borderBottomColor: colors.border, paddingTop: 20 }]}>
          <Text style={[FP.title, { color: colors.foreground }]}>{sheet.title}</Text>
          <TouchableOpacity
            style={[FP.closeBtn, { backgroundColor: colors.muted }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* "All" option */}
          <TouchableOpacity
            style={[FP.row, { borderBottomColor: colors.border }, !sheet.selected && { backgroundColor: colors.primary + "10" }]}
            onPress={() => { Haptics.selectionAsync(); sheet.onSelect(null); onClose(); }}
            activeOpacity={0.8}
          >
            <View style={[FP.check, { borderColor: !sheet.selected ? colors.primary : "#94a3b8" }, !sheet.selected && { backgroundColor: colors.primary }]}>
              {!sheet.selected && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <Text style={[FP.rowTxt, { color: !sheet.selected ? colors.primary : colors.foreground }]}>All</Text>
          </TouchableOpacity>

          {sheet.items.map((item) => {
            const active = sheet.selected === item;
            return (
              <TouchableOpacity
                key={item}
                style={[FP.row, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + "10" }]}
                onPress={() => { Haptics.selectionAsync(); sheet.onSelect(item); onClose(); }}
                activeOpacity={0.8}
              >
                <View style={[FP.check, { borderColor: active ? colors.primary : "#94a3b8" }, active && { backgroundColor: colors.primary }]}>
                  {active && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <Text style={[FP.rowTxt, { color: active ? colors.primary : colors.foreground }]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const FP = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 19, fontWeight: "700", fontFamily: "Inter_700Bold" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  rowTxt: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
});

export default function CommunityStationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [pickerSheet, setPickerSheet] = useState<PickerSheetDef | null>(null);

  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [stateFilter,   setStateFilter]   = useState<string | null>(null);
  const [cityFilter,    setCityFilter]    = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== "web") {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          }
        } else {
          navigator.geolocation?.getCurrentPosition((p) => {
            setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
          });
        }
      } catch {}
    })();
  }, []);

  const { data: filterMeta } = useQuery<FilterMeta>({
    queryKey: ["chargeable-filters"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stations/chargeable/filters`);
      if (!r.ok) throw new Error("Failed to fetch filters");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (loc)           { p.set("lat", String(loc.lat)); p.set("lng", String(loc.lng)); }
    if (countryFilter) p.set("country", countryFilter);
    if (stateFilter)   p.set("state",   stateFilter);
    if (cityFilter)    p.set("city",    cityFilter);
    return p.toString();
  }, [loc, countryFilter, stateFilter, cityFilter]);

  const { data: stations, isLoading, refetch, isRefetching } = useQuery<ChargeableStation[]>({
    queryKey: ["chargeable-stations", queryParams],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stations/chargeable${queryParams ? `?${queryParams}` : ""}`);
      if (!r.ok) throw new Error("Failed to fetch community stations");
      return r.json();
    },
  });

  // Cascading filter options: state list depends on selected country
  const availableStates = useMemo(() => {
    if (!filterMeta) return [];
    if (!countryFilter) {
      return [...new Set(Object.values(filterMeta.countryStates).flat())].sort();
    }
    return filterMeta.countryStates[countryFilter] ?? [];
  }, [filterMeta, countryFilter]);

  // City list depends on selected country + state
  const availableCities = useMemo(() => {
    if (!filterMeta) return [];
    if (!countryFilter && !stateFilter) {
      return [...new Set(Object.values(filterMeta.stateCities).flat())].sort();
    }
    if (countryFilter && !stateFilter) {
      return [
        ...new Set(
          (filterMeta.countryStates[countryFilter] ?? [])
            .flatMap((s) => filterMeta.stateCities[`${countryFilter}|${s}`] ?? [])
        ),
      ].sort();
    }
    const key = `${countryFilter ?? ""}|${stateFilter}`;
    return filterMeta.stateCities[key] ?? [];
  }, [filterMeta, countryFilter, stateFilter]);

  function clearFilters() {
    Haptics.selectionAsync();
    setCountryFilter(null); setStateFilter(null); setCityFilter(null);
  }

  function openCountryPicker() {
    if (!filterMeta) return;
    Haptics.selectionAsync();
    setPickerSheet({
      title: "Country",
      items: filterMeta.countries,
      selected: countryFilter,
      onSelect: (v) => {
        setCountryFilter(v);
        if (v !== countryFilter) { setStateFilter(null); setCityFilter(null); }
      },
    });
  }

  function openStatePicker() {
    if (availableStates.length === 0) return;
    Haptics.selectionAsync();
    setPickerSheet({
      title: "State / Region",
      items: availableStates,
      selected: stateFilter,
      onSelect: (v) => {
        setStateFilter(v);
        if (v !== stateFilter) setCityFilter(null);
      },
    });
  }

  function openCityPicker() {
    if (availableCities.length === 0) return;
    Haptics.selectionAsync();
    setPickerSheet({
      title: "City",
      items: availableCities,
      selected: cityFilter,
      onSelect: setCityFilter,
    });
  }

  const ocppCount     = (stations ?? []).filter((s) => !!s.ocppChargePointId).length;
  const payCount      = (stations ?? []).filter((s) => s.pricePerKwh != null && !s.ocppChargePointId).length;
  const activeFilters = [countryFilter, stateFilter, cityFilter].filter(Boolean).length;

  const renderItem = useCallback(({ item: s }: { item: ChargeableStation }) => {
    const hasOcpp    = !!s.ocppChargePointId;
    const chargeEst  = chargeEstimate(s.powerKw, s.pricePerKwh);
    const hasRecentRpt =
      s.latestReport != null &&
      isRecentReport(s.latestReport.createdAt) &&
      REPORT_BADGE[s.latestReport.reportType] != null;

    const locationLine = [
      s.address,
      s.city,
      s.state,
      s.country !== "United States" ? s.country : null,
    ].filter(Boolean).join(", ") || "Address unknown";

    return (
      <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.primary + "50" }]}>
      <TouchableOpacity
        onPress={() => { Haptics.selectionAsync(); router.push(`/station/${s.id}` as any); }}
        activeOpacity={0.93}
      >
        {/* Capability + distance */}
        <View style={S.capRow}>
          {hasOcpp ? (
            <View style={[S.capBadge, { backgroundColor: "#0D9E7E18" }]}>
              <Ionicons name="flash" size={10} color="#0D9E7E" />
              <Text style={[S.capTxt, { color: "#0D9E7E" }]}>OCPP · Instant Start</Text>
            </View>
          ) : (
            <View style={[S.capBadge, { backgroundColor: colors.primary + "12" }]}>
              <Ionicons name="card" size={10} color={colors.primary} />
              <Text style={[S.capTxt, { color: colors.primary }]}>Pay in App</Text>
            </View>
          )}
          {s.distanceMiles != null && (
            <View style={[S.distBadge, { backgroundColor: colors.primary + "10" }]}>
              <Feather name="navigation" size={10} color={colors.primary} />
              <Text style={[S.distTxt, { color: colors.primary }]}>{s.distanceMiles.toFixed(1)} mi</Text>
            </View>
          )}
        </View>

        {/* Name + address */}
        <View style={S.cardHeader}>
          <View style={[S.iconWrap, { backgroundColor: hasOcpp ? "#0D9E7E18" : colors.primary + "15" }]}>
            <Ionicons name="flash" size={22} color={hasOcpp ? "#0D9E7E" : colors.primary} />
          </View>
          <View style={S.cardInfo}>
            <Text style={[S.stationName, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
            <Text style={[S.stationAddr, { color: colors.mutedForeground }]} numberOfLines={1}>{locationLine}</Text>
          </View>
        </View>

        {/* Chips */}
        <View style={S.chipsRow}>
          <StatusChip status={s.status} />
          <TypeBadge type={s.chargerType} />
          {s.powerKw != null && (
            <View style={[S.badge, { backgroundColor: colors.muted }]}>
              <Text style={[S.badgeTxt, { color: colors.mutedForeground }]}>{s.powerKw} kW</Text>
            </View>
          )}
          {s.isFree ? (
            <View style={[S.badge, { backgroundColor: "#dcfce7" }]}>
              <Text style={[S.badgeTxt, { color: "#15803d" }]}>Free</Text>
            </View>
          ) : s.pricePerKwh != null ? (
            <View style={[S.badge, { backgroundColor: colors.primary + "10" }]}>
              <Text style={[S.badgeTxt, { color: colors.primary }]}>${Number(s.pricePerKwh).toFixed(2)}/kWh</Text>
            </View>
          ) : null}
          {s.totalPorts != null && (
            <View style={[S.badge, {
              backgroundColor: s.availablePorts != null && s.availablePorts > 0
                ? colors.primary + "15" : colors.muted,
            }]}>
              <Text style={[S.badgeTxt, {
                color: s.availablePorts != null && s.availablePorts > 0
                  ? colors.primary : colors.mutedForeground,
              }]}>
                {s.availablePorts != null ? `${s.availablePorts}/${s.totalPorts} ports` : `${s.totalPorts} ports`}
              </Text>
            </View>
          )}
        </View>

        {/* Charge estimate + report */}
        {(chargeEst || hasRecentRpt) && (
          <View style={S.estimateRow}>
            {chargeEst && (
              <View style={S.estimateInner}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>⏱</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>{chargeEst.time}</Text>
                {chargeEst.cost && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>· {chargeEst.cost}</Text>}
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>for {chargeEst.kwh} kWh</Text>
              </View>
            )}
            {hasRecentRpt && s.latestReport && (
              <View style={[S.rptBadge, { backgroundColor: REPORT_BADGE[s.latestReport.reportType]!.bg }]}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: REPORT_BADGE[s.latestReport.reportType]!.color }}>
                  {REPORT_BADGE[s.latestReport.reportType]!.label}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Star rating */}
        <View style={S.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Ionicons
              key={n}
              name={s.averageRating && n <= Math.round(s.averageRating) ? "star" : "star-outline"}
              size={12}
              color={s.averageRating && n <= Math.round(s.averageRating) ? "#f59e0b" : "#cbd5e1"}
            />
          ))}
          {s.averageRating && s.averageRating > 0 ? (
            <>
              <Text style={[S.starVal, { color: colors.foreground }]}>{s.averageRating.toFixed(1)}</Text>
              <Text style={[S.starCount, { color: colors.mutedForeground }]}>({s.reviewCount})</Text>
            </>
          ) : (
            <Text style={[S.starCount, { color: colors.mutedForeground }]}>No reviews yet</Text>
          )}
        </View>

      </TouchableOpacity>

        {/* Location photo strip — outside TouchableOpacity so horizontal scroll works */}
        <CardPhotoStrip lat={s.lat} lng={s.lng} name={s.name} address={[s.address, s.city, s.state].filter(Boolean).join(", ") || null} />

        {/* CTA */}
        <TouchableOpacity
          style={[S.ctaBtn, { backgroundColor: hasOcpp ? "#0D9E7E" : colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push(`/station/${s.id}?charge=1` as any);
          }}
          activeOpacity={0.82}
        >
          <Ionicons name="flash" size={14} color="#fff" />
          <Text style={S.ctaBtnTxt}>{hasOcpp ? "Charge Now" : "View & Pay"}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [colors]);

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <FilterPickerModal sheet={pickerSheet} onClose={() => setPickerSheet(null)} />

      {/* Header */}
      <View style={[S.header, { paddingTop: topPad + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={S.headerTop}>
          <TouchableOpacity
            style={[S.backBtn, { backgroundColor: colors.muted }]}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </TouchableOpacity>

          <View style={S.titleWrap}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[S.title, { color: colors.foreground }]}>Community Stations</Text>
              {stations && <LiveDot />}
            </View>
            <Text style={[S.subtitle, { color: colors.mutedForeground }]}>
              {stations
                ? `${stations.length} station${stations.length !== 1 ? "s" : ""} worldwide`
                : "Charge & pay via ChargeBridge"}
            </Text>
          </View>

          <TouchableOpacity
            style={[S.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-station" as any); }}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Cascading filter pills */}
        <View style={S.filterRow}>
          <TouchableOpacity
            style={[S.filterBtn, { backgroundColor: countryFilter ? colors.primary : colors.muted }]}
            onPress={openCountryPicker}
            activeOpacity={0.8}
          >
            <Ionicons name="globe-outline" size={13} color={countryFilter ? "#fff" : colors.mutedForeground} />
            <Text style={[S.filterBtnTxt, { color: countryFilter ? "#fff" : colors.foreground }]} numberOfLines={1}>
              {countryFilter ?? "Country"}
            </Text>
            <Ionicons name="chevron-down" size={12} color={countryFilter ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              S.filterBtn,
              { backgroundColor: stateFilter ? colors.primary : colors.muted },
              availableStates.length === 0 && { opacity: 0.4 },
            ]}
            onPress={openStatePicker}
            disabled={availableStates.length === 0}
            activeOpacity={0.8}
          >
            <Feather name="map-pin" size={13} color={stateFilter ? "#fff" : colors.mutedForeground} />
            <Text style={[S.filterBtnTxt, { color: stateFilter ? "#fff" : colors.foreground }]} numberOfLines={1}>
              {stateFilter ?? "State"}
            </Text>
            <Ionicons name="chevron-down" size={12} color={stateFilter ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              S.filterBtn,
              { backgroundColor: cityFilter ? colors.primary : colors.muted },
              availableCities.length === 0 && { opacity: 0.4 },
            ]}
            onPress={openCityPicker}
            disabled={availableCities.length === 0}
            activeOpacity={0.8}
          >
            <Ionicons name="business-outline" size={13} color={cityFilter ? "#fff" : colors.mutedForeground} />
            <Text style={[S.filterBtnTxt, { color: cityFilter ? "#fff" : colors.foreground }]} numberOfLines={1}>
              {cityFilter ?? "City"}
            </Text>
            <Ionicons name="chevron-down" size={12} color={cityFilter ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>

          {activeFilters > 0 && (
            <TouchableOpacity
              style={[S.clearBtn, { backgroundColor: "#ef444418" }]}
              onPress={clearFilters}
              activeOpacity={0.8}
            >
              <Feather name="x" size={14} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>

        {/* Summary chips */}
        {stations && stations.length > 0 && (
          <View style={S.summaryRow}>
            <View style={[S.sumChip, { backgroundColor: "#0D9E7E18" }]}>
              <Ionicons name="flash" size={11} color="#0D9E7E" />
              <Text style={[S.sumTxt, { color: "#0D9E7E" }]}>{ocppCount} OCPP</Text>
            </View>
            {payCount > 0 && (
              <View style={[S.sumChip, { backgroundColor: colors.primary + "14" }]}>
                <Ionicons name="card" size={11} color={colors.primary} />
                <Text style={[S.sumTxt, { color: colors.primary }]}>{payCount} pay-in-app</Text>
              </View>
            )}
            {loc && (
              <View style={[S.sumChip, { backgroundColor: colors.muted }]}>
                <Feather name="navigation" size={11} color={colors.mutedForeground} />
                <Text style={[S.sumTxt, { color: colors.mutedForeground }]}>sorted by distance</Text>
              </View>
            )}
            {activeFilters > 0 && (
              <View style={[S.sumChip, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="funnel-outline" size={11} color={colors.primary} />
                <Text style={[S.sumTxt, { color: colors.primary }]}>
                  {activeFilters} filter{activeFilters > 1 ? "s" : ""} active
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Loading */}
      {isLoading && (
        <View style={S.stateWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[S.stateBody, { color: colors.mutedForeground, marginTop: 14 }]}>
            Loading community stations…
          </Text>
        </View>
      )}

      {/* List */}
      {stations && (
        <FlatList
          data={stations}
          keyExtractor={(s) => String(s.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: isWeb ? 120 : 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={S.stateWrap}>
              <View style={[S.stateIcon, { backgroundColor: colors.primary + "14" }]}>
                <Ionicons name="flash-outline" size={36} color={colors.primary} />
              </View>
              <Text style={[S.stateTitle, { color: colors.foreground }]}>
                {activeFilters > 0 ? "No stations match your filters" : "No community stations yet"}
              </Text>
              <Text style={[S.stateBody, { color: colors.mutedForeground }]}>
                {activeFilters > 0
                  ? "Try broadening your location filters."
                  : "Be the first to add an independent charger that supports in-app payment."}
              </Text>
              {activeFilters > 0 ? (
                <TouchableOpacity
                  style={[S.addStationBtn, { backgroundColor: colors.muted }]}
                  onPress={clearFilters}
                  activeOpacity={0.85}
                >
                  <Feather name="x" size={15} color={colors.foreground} />
                  <Text style={[S.addStationTxt, { color: colors.foreground }]}>Clear Filters</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[S.addStationBtn, { backgroundColor: colors.primary }]}
                  onPress={() => router.push("/add-station" as any)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add-circle-outline" size={16} color="#fff" />
                  <Text style={S.addStationTxt}>Add a Station</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  filterRow: { flexDirection: "row", gap: 7, alignItems: "center" },
  filterBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22, minWidth: 0,
  },
  filterBtnTxt: { flex: 1, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  clearBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sumChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  sumTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  stateWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12, marginTop: 20 },
  stateIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  stateTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  stateBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  addStationBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, marginTop: 4 },
  addStationTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  card: { borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 14, gap: 10 },
  capRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  capBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  capTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  distBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginLeft: "auto" },
  distTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  iconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardInfo: { flex: 1, minWidth: 0 },
  stationName: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 3 },
  stationAddr: { fontSize: 12, fontFamily: "Inter_400Regular" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  estimateRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  estimateInner: { flexDirection: "row", alignItems: "center", gap: 3 },
  rptBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },

  starsRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  starVal: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", marginLeft: 4 },
  starCount: { fontSize: 12, fontFamily: "Inter_400Regular" },

  ctaBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 12, paddingVertical: 11,
  },
  ctaBtnTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
});
