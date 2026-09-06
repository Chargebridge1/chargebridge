import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Platform,
} from "react-native";
import { router } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { setNavigationIntent } from "@/utils/navigationIntent";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface CityRow { city: string; state: string; count: number; availableCount: number; lat: number; lng: number; }

export default function CitiesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const [search, setSearch] = useState("");

  const { data: cities = [], isLoading } = useQuery<CityRow[]>({
    queryKey: ["cities"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/cities`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const filtered = cities.filter(c =>
    c.city.toLowerCase().includes(search.toLowerCase()) ||
    c.state.toLowerCase().includes(search.toLowerCase())
  );

  const byState = filtered.reduce<Record<string, CityRow[]>>((acc, c) => {
    if (!acc[c.state]) acc[c.state] = [];
    acc[c.state].push(c);
    return acc;
  }, {});
  const sortedStates = Object.keys(byState).sort();

  function openCity(city: CityRow) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNavigationIntent({ lat: city.lat, lng: city.lng, label: city.city });
    router.push("/(tabs)/map" as any);
  }

  return (
    <View style={[C.root, { backgroundColor: colors.background }]}>
      {/* Nav bar */}
      <View style={[C.navBar, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={C.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={C.navCenter}>
          <Ionicons name="business" size={17} color={colors.primary} style={{ marginRight: 6 }} />
          <Text style={[C.navTitle, { color: colors.foreground }]}>Browse by City</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Search */}
      <View style={[C.searchBar, { backgroundColor: colors.muted + "55", borderColor: colors.border, margin: 14 }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
        <TextInput
          style={[C.searchInput, { color: colors.foreground }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search cities or states…"
          placeholderTextColor={colors.mutedForeground + "88"}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={C.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[C.loadingTxt, { color: colors.mutedForeground }]}>Loading cities…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={C.center}>
          <Ionicons name="location-outline" size={40} color={colors.mutedForeground + "66"} />
          <Text style={[C.emptyTxt, { color: colors.mutedForeground }]}>
            {search ? `No cities matching "${search}"` : "No cities found"}
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          {sortedStates.map(state => (
            <View key={state}>
              <View style={[C.stateHeader, { backgroundColor: colors.muted + "33" }]}>
                <Feather name="map-pin" size={11} color={colors.mutedForeground} style={{ marginRight: 5 }} />
                <Text style={[C.stateName, { color: colors.mutedForeground }]}>{state}</Text>
              </View>
              <View style={C.cityGrid}>
                {byState[state].map(city => (
                  <TouchableOpacity
                    key={`${city.city}-${city.state}`}
                    style={[C.cityCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => openCity(city)}
                    activeOpacity={0.75}
                  >
                    <Text style={[C.cityName, { color: colors.foreground }]} numberOfLines={1}>{city.city}</Text>
                    <View style={C.cityMeta}>
                      <Feather name="zap" size={11} color={colors.primary} />
                      <Text style={[C.cityCount, { color: colors.mutedForeground }]}>{city.count} station{city.count !== 1 ? "s" : ""}</Text>
                    </View>
                    {city.availableCount > 0 && (
                      <View style={[C.availBadge, { backgroundColor: "#22c55e18" }]}>
                        <Text style={[C.availTxt, { color: "#16a34a" }]}>{city.availableCount} avail.</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const C = StyleSheet.create({
  root: { flex: 1 },
  navBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  navCenter: { flexDirection: "row", alignItems: "center" },
  navTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchBar: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32 },
  stateHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  stateName: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "Inter_700Bold" },
  cityGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, paddingBottom: 4, gap: 8 },
  cityCard: { width: "47%", borderRadius: 12, borderWidth: 1, padding: 12 },
  cityName: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  cityMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  cityCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  availBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6, alignSelf: "flex-start" },
  availTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
