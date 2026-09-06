import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, Platform, ActivityIndicator,
  Modal, ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsButtonEnabled } from "@/hooks/useButtonConfigs";
import { ChargeNowModal } from "@/components/ChargeNowModal";
import { MapModal } from "@/components/MapModal";
import { WallpaperLayer } from "@/components/WallpaperPicker";
import { useWallpaper } from "@/contexts/WallpaperContext";
import { StationCard, CardPhotoStrip, EvStation } from "@/components/StationCard";
import { setNavigationIntent } from "@/utils/navigationIntent";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type GasStation = {
  id: string;
  source: string;
  name: string | null;
  brand: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  distanceMiles: number | null;
  prices: {
    regularCents: number | null;
    dieselCents: number | null;
  };
};

type StationViewMode = "ev" | "gas";
type ChargerType = "Level1" | "Level2" | "DCFC";

const CHARGER_FILTER_OPTIONS: { key: ChargerType; label: string }[] = [
  { key: "DCFC",   label: "DC Fast" },
  { key: "Level2", label: "Level 2" },
  { key: "Level1", label: "Level 1" },
];

const RADII = [10, 25, 50, 100];

const TRANSLATE_LANGS: { code: string; label: string; flag: string; nativeName: string }[] = [
  { code: "es",    label: "Spanish",            flag: "🇪🇸", nativeName: "Español" },
  { code: "fr",    label: "French",             flag: "🇫🇷", nativeName: "Français" },
  { code: "de",    label: "German",             flag: "🇩🇪", nativeName: "Deutsch" },
  { code: "it",    label: "Italian",            flag: "🇮🇹", nativeName: "Italiano" },
  { code: "pt",    label: "Portuguese",         flag: "🇧🇷", nativeName: "Português" },
  { code: "ru",    label: "Russian",            flag: "🇷🇺", nativeName: "Русский" },
  { code: "ar",    label: "Arabic",             flag: "🇸🇦", nativeName: "العربية" },
  { code: "hi",    label: "Hindi",              flag: "🇮🇳", nativeName: "हिन्दी" },
  { code: "zh-CN", label: "Chinese (Simplified)", flag: "🇨🇳", nativeName: "中文" },
  { code: "ja",    label: "Japanese",           flag: "🇯🇵", nativeName: "日本語" },
  { code: "ko",    label: "Korean",             flag: "🇰🇷", nativeName: "한국어" },
  { code: "tr",    label: "Turkish",            flag: "🇹🇷", nativeName: "Türkçe" },
  { code: "nl",    label: "Dutch",              flag: "🇳🇱", nativeName: "Nederlands" },
  { code: "pl",    label: "Polish",             flag: "🇵🇱", nativeName: "Polski" },
  { code: "sv",    label: "Swedish",            flag: "🇸🇪", nativeName: "Svenska" },
];

function toggle<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val);
  else next.add(val);
  return next;
}

function GasStationCard({ station }: { station: GasStation }) {
  const colors = useColors();
  const displayName = station.brand ?? station.name ?? "Gas Station";
  const address = [station.address, station.city].filter(Boolean).join(", ") || "Address unknown";

  function handleNavigate() {
    Haptics.selectionAsync();
    setNavigationIntent({ lat: station.lat, lng: station.lng, label: displayName });
    router.push("/(tabs)/map" as any);
  }

  return (
    <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={S.row}>
        <View style={[S.iconBox, { backgroundColor: "#f59e0b18" }]}>
          <Feather name="droplet" size={20} color="#f59e0b" />
        </View>
        <View style={S.body}>
          <View style={S.headRow}>
            <Text style={[S.name, { color: colors.foreground }]} numberOfLines={1}>{displayName}</Text>
            <Text style={[S.dist, { color: "#f59e0b" }]}>{Number(station.distanceMiles).toFixed(1)} mi</Text>
          </View>
          <Text style={[S.addr, { color: colors.mutedForeground }]} numberOfLines={1}>{address}</Text>
          <View style={S.footRow}>
            {station.prices?.regularCents != null && (
              <View style={[S.badge, { backgroundColor: "#fef3c7" }]}>
                <Text style={[S.badgeTxt, { color: "#b45309" }]}>Regular ${(station.prices.regularCents / 100).toFixed(2)}</Text>
              </View>
            )}
            {station.prices?.dieselCents != null && (
              <View style={[S.badge, { backgroundColor: "#fde68a" }]}>
                <Text style={[S.badgeTxt, { color: "#92400e" }]}>Diesel ${(station.prices.dieselCents / 100).toFixed(2)}</Text>
              </View>
            )}
            {station.prices?.regularCents == null && station.prices?.dieselCents == null && (
              <Text style={[S.meta, { color: colors.mutedForeground }]}>No price data</Text>
            )}
          </View>
        </View>
      </View>
      <CardPhotoStrip lat={station.lat} lng={station.lng} name={displayName} network={station.brand ?? "Gas Station"} chargerType="gas" address={[station.address, station.city].filter(Boolean).join(", ") || null} />
      <View style={S.actionRow}>
        <TouchableOpacity
          style={[S.directionsBtn, { backgroundColor: "#f59e0b" }]}
          onPress={handleNavigate}
          activeOpacity={0.85}
        >
          <Feather name="navigation-2" size={14} color="#fff" />
          <Text style={S.directionsTxt}>Get Directions</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

async function geocodeLocation(query: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "ChargeBridge/1.0" } });
    const data = await res.json();
    if (!data[0]) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name.split(",").slice(0, 2).join(", "),
    };
  } catch {
    return null;
  }
}

// ── MyMemory translation (free, no API key) ──────────────────────────────────
// Rate: 500 words/day per IP free. Each string is fetched once and cached for
// the session. langpair format: "en|es" (source|target).
async function myMemoryTranslate(text: string, targetLang: string): Promise<string> {
  if (!text || text.trim().length < 2) return text;
  try {
    const url =
      `https://api.mymemory.translated.net/get` +
      `?q=${encodeURIComponent(text)}` +
      `&langpair=en|${targetLang}` +
      `&de=app@chargebridgeapp.com`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    if (
      json.responseStatus === 200 &&
      json.responseData?.translatedText &&
      json.responseData.translatedText !== text
    ) {
      return json.responseData.translatedText;
    }
  } catch {}
  return text;
}

export default function ExploreScreen() {
  const colors = useColors();
  const wallpaper = useWallpaper("explore");
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [locating, setLocating] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchTextRef = useRef("");
  const [radius, setRadius] = useState(25);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [chargeNowVisible, setChargeNowVisible] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [viewMode, setViewMode] = useState<StationViewMode>("ev");
  const [statusReportId, setStatusReportId] = useState<string | null>(null);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sortBy, setSortBy] = useState<"nearest" | "highest_rating" | "lowest_rating">("nearest");

  // Multi-select filter sets
  const [chargerFilters, setChargerFilters] = useState<Set<ChargerType>>(new Set());
  const [connectorFilters, setConnectorFilters] = useState<Set<string>>(new Set());
  const [networkFilters, setNetworkFilters] = useState<Set<string>>(new Set());

  const savedEvFilters = useRef<{
    chargerFilters: Set<ChargerType>;
    networkFilters: Set<string>;
    connectorFilters: Set<string>;
    sortBy: "nearest" | "highest_rating" | "lowest_rating";
  } | null>(null);

  // ── Translator state ─────────────────────────────────────────────────────
  const [translateLang, setTranslateLang] = useState<string | null>(null);
  const [translateModalVisible, setTranslateModalVisible] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateCacheTick, setTranslateCacheTick] = useState(0);
  // Cache: original text → translated text, scoped to the active language
  const translationCache = useRef<Map<string, string>>(new Map());
  const translateLangRef = useRef<string | null>(null);

  const showHomeBtn = useIsButtonEnabled("mobile_header_home_button");
  const showChargeNowBtn = useIsButtonEnabled("mobile_header_charge_now");

  const userSearchedRef = useRef(false);

  const getGPSLocation = useCallback(async (isManualPress = false) => {
    if (isManualPress) userSearchedRef.current = false;
    setGeoError(null);
    setLocating(true);
    if (!userSearchedRef.current) setLocationLabel("");
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setGeoError("Location permission denied — enter a city or address above");
          setLocating(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!userSearchedRef.current) {
          setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          const city = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
            .then((r) => r[0] ? [r[0].city, r[0].region].filter(Boolean).join(", ") : null)
            .catch(() => null);
          setLocationLabel(city ?? "Current location");
        }
      } else {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (p) => {
              if (!userSearchedRef.current) {
                setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
                setLocationLabel("Current location");
              }
              resolve();
            },
            () => { setGeoError("Could not get location — enter a city or address above"); reject(); }
          )
        );
      }
    } catch {
      setGeoError("Could not access location — enter a city or address above");
    } finally {
      setLocating(false);
    }
  }, []);

  const handleLocationSearch = useCallback(async () => {
    const query = searchTextRef.current.trim();
    if (!query) return;
    setGeocoding(true);
    setGeoError(null);
    const result = await geocodeLocation(query);
    setGeocoding(false);
    if (result) {
      userSearchedRef.current = true;
      setLoc({ lat: result.lat, lng: result.lng });
      setLocationLabel(result.displayName);
      setSearchText("");
      searchTextRef.current = "";
    } else {
      setGeoError(`Location not found: "${query}"`);
    }
  }, []);

  useEffect(() => { getGPSLocation(); }, []);

  const { data: allStations, isLoading: evLoading, refetch: evRefetch, isRefetching: evRefetching } = useQuery<EvStation[]>({
    queryKey: ["ev-stations-explore", loc?.lat, loc?.lng, radius],
    enabled: !!loc,
    staleTime: 90000,
    gcTime: 300000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations?lat=${loc!.lat}&lng=${loc!.lng}&radius=${radius}`);
      if (!r.ok) throw new Error("Failed to fetch stations");
      return r.json();
    },
  });

  const { data: gasData, isLoading: gasLoading, refetch: gasRefetch, isRefetching: gasRefetching } = useQuery<GasStation[]>({
    queryKey: ["gas-stations-explore", loc?.lat, loc?.lng, radius],
    enabled: !!loc,
    staleTime: 180000,
    gcTime: 300000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/gas-stations?lat=${loc!.lat}&lng=${loc!.lng}&radius=${radius}`);
      if (!r.ok) throw new Error("Failed to fetch gas stations");
      return r.json();
    },
  });

  const isLoading = viewMode === "ev" ? evLoading : gasLoading;
  const isRefetching = viewMode === "ev" ? evRefetching : gasRefetching;
  function refetch() {
    if (viewMode === "ev") evRefetch();
    else gasRefetch();
  }

  // ── Translation engine ───────────────────────────────────────────────────
  // Collect all unique text strings from current results, batch-translate them
  // using MyMemory (10 concurrent requests at a time), and cache the results.
  // Re-runs whenever the language or station data changes.
  useEffect(() => {
    if (!translateLang) return;
    const lang = translateLang;
    translateLangRef.current = lang;

    const raw: string[] = [];
    (allStations ?? []).forEach((s) => {
      if (s.name)    raw.push(s.name);
      if (s.address) raw.push(s.address);
      if (s.city)    raw.push(s.city);
      if (s.network) raw.push(s.network.split(";")[0].trim());
    });
    (gasData ?? []).forEach((s) => {
      if (s.name)    raw.push(s.name);
      if (s.brand)   raw.push(s.brand);
      if (s.address) raw.push(s.address);
      if (s.city)    raw.push(s.city);
    });

    // Only translate strings not already in the cache for this language
    const unique = [...new Set(raw.filter(
      (t) => t && t.trim().length > 1 && !translationCache.current.has(t)
    ))];
    if (unique.length === 0) {
      setTranslateCacheTick((n) => n + 1);
      return;
    }

    setTranslating(true);

    const CHUNK = 8;
    let i = 0;
    async function processNext(): Promise<void> {
      if (translateLangRef.current !== lang) return;
      if (i >= unique.length) {
        setTranslating(false);
        setTranslateCacheTick((n) => n + 1);
        return;
      }
      const chunk = unique.slice(i, i + CHUNK);
      i += CHUNK;
      await Promise.allSettled(
        chunk.map(async (text) => {
          const translated = await myMemoryTranslate(text, lang);
          translationCache.current.set(text, translated);
        })
      );
      // Tick UI after each chunk so partial results appear quickly
      if (translateLangRef.current === lang) {
        setTranslateCacheTick((n) => n + 1);
      }
      await processNext();
    }

    processNext();
  }, [translateLang, allStations, gasData]);

  // Clear cache when language changes so we don't serve stale translations
  function applyLanguage(code: string | null) {
    if (code !== translateLang) {
      translationCache.current = new Map();
      setTranslateCacheTick(0);
    }
    translateLangRef.current = code;
    setTranslateLang(code);
    setTranslateModalVisible(false);
    Haptics.selectionAsync();
  }

  // Lookup helper — falls back to original text when translation not yet ready
  const tr = useCallback((text: string | null | undefined): string | null | undefined => {
    if (!translateLang || !text) return text;
    return translationCache.current.get(text) ?? text;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateLang, translateCacheTick]);

  const uniqueNetworks = useMemo(() => {
    if (!allStations) return [];
    const nets = new Set<string>();
    allStations.forEach((s) => { if (s.network) { const n = s.network.split(";")[0].trim(); if (n) nets.add(n); } });
    return Array.from(nets).sort();
  }, [allStations]);

  const allConnectorTypes = useMemo(() => {
    const set = new Set<string>();
    (allStations ?? []).forEach((s) => (s.connectorTypes ?? []).forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [allStations]);

  const stations = useMemo(() => {
    if (!allStations) return [];
    let s = [...allStations];
    if (chargerFilters.size > 0) s = s.filter((x) => chargerFilters.has(x.chargerType as ChargerType));
    if (networkFilters.size > 0) s = s.filter((x) => x.network && networkFilters.has(x.network.split(";")[0].trim()));
    if (connectorFilters.size > 0) s = s.filter((x) => (x.connectorTypes ?? []).some((c) => connectorFilters.has(c)));

    if (sortBy === "highest_rating") {
      s.sort((a, b) => {
        const ra = a.averageRating ?? -1, rb = b.averageRating ?? -1;
        return ra !== rb ? rb - ra : a.distanceMiles - b.distanceMiles;
      });
    } else if (sortBy === "lowest_rating") {
      s.sort((a, b) => {
        const ra = a.averageRating ?? Infinity, rb = b.averageRating ?? Infinity;
        return ra !== rb ? ra - rb : a.distanceMiles - b.distanceMiles;
      });
    }
    return s;
  }, [allStations, chargerFilters, networkFilters, connectorFilters, sortBy]);

  // Apply translations to station data before rendering
  const translatedStations = useMemo<EvStation[]>(() => {
    if (!translateLang) return stations;
    return stations.map((s) => ({
      ...s,
      name:    tr(s.name)    as string ?? s.name,
      address: tr(s.address) as string ?? s.address,
      city:    tr(s.city)    as string ?? s.city,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, translateLang, translateCacheTick]);

  const gasStations = gasData ?? [];
  const translatedGasStations = useMemo<GasStation[]>(() => {
    if (!translateLang) return gasStations;
    return gasStations.map((s) => ({
      ...s,
      name:    tr(s.name)    as string | null,
      brand:   tr(s.brand)   as string | null,
      address: tr(s.address) as string | null,
      city:    tr(s.city)    as string | null,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasStations, translateLang, translateCacheTick]);

  const communityCount = stations.filter((s) => s.source === "community").length;

  const activeFilterCount = [
    chargerFilters.size > 0,
    networkFilters.size > 0,
    connectorFilters.size > 0,
    sortBy !== "nearest",
  ].filter(Boolean).length;

  function resetAllFilters() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setChargerFilters(new Set());
    setNetworkFilters(new Set());
    setConnectorFilters(new Set());
    setSortBy("nearest");
  }

  const filterSummaryParts: string[] = [];
  if (chargerFilters.size > 0) filterSummaryParts.push([...chargerFilters].map((k) => CHARGER_FILTER_OPTIONS.find((o) => o.key === k)?.label ?? k).join(", "));
  if (networkFilters.size > 0) filterSummaryParts.push([...networkFilters].join(", "));
  if (connectorFilters.size > 0) filterSummaryParts.push([...connectorFilters].join(", "));
  if (sortBy !== "nearest") filterSummaryParts.push(sortBy === "highest_rating" ? "★ Highest" : "★ Lowest");

  const activeLangInfo = TRANSLATE_LANGS.find((l) => l.code === translateLang);

  return (
    <View style={[S.root, { backgroundColor: wallpaper.isDefault ? colors.background : "transparent" }]}>
      <WallpaperLayer tab="explore" />

      <View style={[S.header, { paddingTop: topPad + 14, backgroundColor: wallpaper.isDefault ? colors.background : "transparent", borderBottomColor: colors.border }]}>
        {/* Title row */}
        <View style={S.titleRow}>
          <Text style={[S.title, { color: colors.foreground }]}>Explore</Text>
          <View style={S.titleActions}>
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: colors.muted }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/cities" as any); }}
              activeOpacity={0.85}
            >
              <Feather name="grid" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: colors.muted }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/trip-planner" as any); }}
              activeOpacity={0.85}
            >
              <Feather name="navigation" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: colors.muted }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMapVisible(true); }}
              activeOpacity={0.85}
            >
              <Feather name="map" size={18} color={colors.foreground} />
            </TouchableOpacity>
            {/* Translate button — highlighted when active */}
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: translateLang ? colors.primary : colors.muted }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTranslateModalVisible(true); }}
              activeOpacity={0.85}
            >
              {translating
                ? <ActivityIndicator size="small" color={translateLang ? "#fff" : colors.foreground} />
                : <Feather name="globe" size={18} color={translateLang ? "#fff" : colors.foreground} />
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.iconBtn, { backgroundColor: colors.muted }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-station" as any); }}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={18} color={colors.foreground} />
            </TouchableOpacity>
            {showChargeNowBtn && (
              <TouchableOpacity
                style={[S.chargeNowBtn, { backgroundColor: colors.primary }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setChargeNowVisible(true); }}
                activeOpacity={0.85}
              >
                <Ionicons name="flash" size={14} color="#fff" />
                <Text style={S.chargeNowTxt}>Charge Now</Text>
              </TouchableOpacity>
            )}
            {showHomeBtn && (
              <TouchableOpacity
                style={[S.iconBtn, { backgroundColor: colors.muted }]}
                onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/home"); }}
                activeOpacity={0.8}
              >
                <Feather name="home" size={18} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Active translation banner */}
        {translateLang && (
          <TouchableOpacity
            style={[S.translateBanner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}
            onPress={() => setTranslateModalVisible(true)}
            activeOpacity={0.8}
          >
            <Feather name="globe" size={13} color={colors.primary} />
            <Text style={[S.translateBannerTxt, { color: colors.primary }]}>
              {translating
                ? `Translating to ${activeLangInfo?.label ?? translateLang}…`
                : `Translated to ${activeLangInfo?.flag ?? ""} ${activeLangInfo?.label ?? translateLang}`}
            </Text>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); applyLanguage(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={13} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* Location search */}
        <View style={[S.searchBar, { backgroundColor: colors.card, borderColor: geoError ? "#ef4444" : colors.border }]}>
          <Ionicons name="location-outline" size={16} color={geocoding ? colors.primary : colors.mutedForeground} />
          <TextInput
            style={[S.searchInput, { color: colors.foreground }]}
            value={searchText}
            onChangeText={(t) => { setSearchText(t); searchTextRef.current = t; setGeoError(null); }}
            placeholder={locationLabel || "Search city, address, zip…"}
            placeholderTextColor={loc && !searchText ? colors.primary : colors.mutedForeground}
            returnKeyType="search"
            onSubmitEditing={handleLocationSearch}
            clearButtonMode="while-editing"
          />
          {geocoding ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : searchText.length > 0 ? (
            <TouchableOpacity onPress={handleLocationSearch}>
              <View style={[S.goBtn, { backgroundColor: colors.primary }]}>
                <Text style={S.goBtnTxt}>Go</Text>
              </View>
            </TouchableOpacity>
          ) : loc ? (
            <TouchableOpacity onPress={() => getGPSLocation(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="crosshair" size={16} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
        {geoError && <Text style={[S.geoError, { color: "#ef4444" }]}>{geoError}</Text>}

        {/* EV / Gas toggle + Filters button */}
        <View style={S.modeAndFiltersRow}>
          <View style={[S.modeToggleRow, { backgroundColor: colors.muted, borderRadius: 22, flex: 1 }]}>
            <TouchableOpacity
              style={[S.modeToggleBtn, viewMode === "ev" && { backgroundColor: colors.primary, borderRadius: 20 }]}
              onPress={() => {
                Haptics.selectionAsync();
                if (viewMode !== "ev") {
                  const saved = savedEvFilters.current;
                  if (saved) {
                    setChargerFilters(saved.chargerFilters);
                    setNetworkFilters(saved.networkFilters);
                    setConnectorFilters(saved.connectorFilters);
                    setSortBy(saved.sortBy);
                  }
                  setViewMode("ev");
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="flash" size={13} color={viewMode === "ev" ? "#fff" : colors.mutedForeground} />
              <Text style={[S.modeToggleTxt, { color: viewMode === "ev" ? "#fff" : colors.mutedForeground }]}>EV Chargers</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.modeToggleBtn, viewMode === "gas" && { backgroundColor: "#f59e0b", borderRadius: 20 }]}
              onPress={() => {
                Haptics.selectionAsync();
                if (viewMode !== "gas") {
                  savedEvFilters.current = { chargerFilters, networkFilters, connectorFilters, sortBy };
                  setViewMode("gas");
                }
              }}
              activeOpacity={0.85}
            >
              <Feather name="droplet" size={13} color={viewMode === "gas" ? "#fff" : colors.mutedForeground} />
              <Text style={[S.modeToggleTxt, { color: viewMode === "gas" ? "#fff" : colors.mutedForeground }]}>Gas Stations</Text>
            </TouchableOpacity>
          </View>

          {/* Radius pill (always visible) */}
          <TouchableOpacity
            style={[S.radiusBtn, { backgroundColor: colors.muted }]}
            onPress={() => { Haptics.selectionAsync(); setFilterSheetVisible(true); }}
            activeOpacity={0.8}
          >
            <Feather name="crosshair" size={12} color={colors.mutedForeground} />
            <Text style={[S.radiusBtnTxt, { color: colors.foreground }]}>{radius} mi</Text>
          </TouchableOpacity>

          {/* Filters button (EV only) */}
          {viewMode === "ev" && (
            <TouchableOpacity
              style={[S.filtersBtn, { backgroundColor: activeFilterCount > 0 ? colors.primary : colors.muted }]}
              onPress={() => { Haptics.selectionAsync(); setFilterSheetVisible(true); }}
              onLongPress={resetAllFilters}
              activeOpacity={0.8}
              delayLongPress={400}
            >
              <Feather name="sliders" size={13} color={activeFilterCount > 0 ? "#fff" : colors.mutedForeground} />
              <Text style={[S.filtersBtnTxt, { color: activeFilterCount > 0 ? "#fff" : colors.mutedForeground }]}>
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Active filter summary chips */}
        {viewMode === "ev" && filterSummaryParts.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }} style={{ marginTop: 2 }}>
            {filterSummaryParts.map((part, i) => (
              <View key={i} style={[S.summaryChip, { backgroundColor: colors.primary + "14" }]}>
                <Text style={[S.summaryChipTxt, { color: colors.primary }]} numberOfLines={1}>{part}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[S.summaryChip, { backgroundColor: "#ef444414", flexDirection: "row", alignItems: "center", gap: 4 }]}
              onPress={resetAllFilters}
              activeOpacity={0.8}
            >
              <Feather name="x" size={11} color="#ef4444" />
              <Text style={[S.summaryChipTxt, { color: "#ef4444" }]}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* Acquiring GPS */}
      {locating && !loc && (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[S.emptyTitle, { color: colors.foreground, marginTop: 16 }]}>Finding your location…</Text>
          <Text style={[S.emptyText, { color: colors.mutedForeground }]}>Or search a city, address, or zip above</Text>
        </View>
      )}

      {!locating && !loc && !isLoading && !geocoding && !geoError && (
        <View style={S.center}>
          <Ionicons name="earth-outline" size={56} color={colors.mutedForeground} />
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>Search anywhere in the world</Text>
          <Text style={[S.emptyText, { color: colors.mutedForeground }]}>
            Enter a city, address, or zip code above to find EV chargers
          </Text>
          <TouchableOpacity style={[S.cta, { backgroundColor: colors.primary }]} onPress={() => getGPSLocation(true)}>
            <Feather name="crosshair" size={15} color="#fff" />
            <Text style={[S.ctaTxt, { color: "#fff" }]}>Use My Location</Text>
          </TouchableOpacity>
        </View>
      )}

      {geoError && !loc && !locating && (
        <View style={S.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
          <Text style={[S.emptyText, { color: "#ef4444", textAlign: "center", paddingHorizontal: 32 }]}>{geoError}</Text>
          <TouchableOpacity style={[S.cta, { backgroundColor: colors.primary, marginTop: 16 }]} onPress={() => getGPSLocation(true)}>
            <Feather name="crosshair" size={15} color="#fff" />
            <Text style={[S.ctaTxt, { color: "#fff" }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {(isLoading || geocoding) && loc && (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[S.emptyText, { color: colors.mutedForeground, marginTop: 12 }]}>Searching stations…</Text>
        </View>
      )}

      {loc && !isLoading && !geocoding && viewMode === "ev" && (
        <FlatList
          data={translatedStations}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <StationCard station={item} onReportStatus={setStatusReportId} />}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: isWeb ? 84 + 34 : 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={8}
          windowSize={5}
          initialNumToRender={8}
          ListHeaderComponent={
            stations.length > 0 ? (
              <View style={S.listHeaderRow}>
                <Text style={[S.listHeader, { color: colors.mutedForeground }]}>
                  {stations.length} EV charger{stations.length !== 1 ? "s" : ""}
                  {chargerFilters.size > 0 ? ` · ${[...chargerFilters].map((k) => CHARGER_FILTER_OPTIONS.find((o) => o.key === k)?.label).join(", ")}` : ""}
                  {networkFilters.size > 0 ? ` · ${[...networkFilters].join(", ")}` : ""}
                  {connectorFilters.size > 0 ? ` · ${[...connectorFilters].join(", ")}` : ""}
                  {" · "}{sortBy === "nearest" ? `${radius} mi` : sortBy === "highest_rating" ? "highest rated" : "lowest rated"}
                  {locationLabel ? ` · ${locationLabel}` : ""}
                </Text>
                {communityCount > 0 && (
                  <View style={[S.communityPill, { backgroundColor: colors.primary + "18" }]}>
                    <Ionicons name="flash" size={10} color={colors.primary} />
                    <Text style={[S.communityPillTxt, { color: colors.primary }]}>{communityCount} ChargeBridge</Text>
                  </View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={S.center}>
              <Ionicons name="flash-outline" size={48} color={colors.mutedForeground} />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>No EV chargers found</Text>
              <Text style={[S.emptyText, { color: colors.mutedForeground }]}>
                {networkFilters.size > 0 ? `No ${[...networkFilters].join(" / ")} stations in this area`
                  : connectorFilters.size > 0 ? `No ${[...connectorFilters].join(" / ")} connectors nearby`
                  : "Try a larger radius or different location"}
              </Text>
              {activeFilterCount > 0 ? (
                <TouchableOpacity style={[S.cta, { backgroundColor: colors.primary }]} onPress={resetAllFilters}>
                  <Text style={[S.ctaTxt, { color: "#fff" }]}>Clear Filters</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[S.cta, { backgroundColor: colors.primary }]} onPress={() => setRadius(100)}>
                  <Text style={[S.ctaTxt, { color: "#fff" }]}>Expand to 100 mi</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {loc && !isLoading && !geocoding && viewMode === "gas" && (
        <FlatList
          data={translatedGasStations}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => <GasStationCard station={item} />}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: isWeb ? 84 + 34 : 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#f59e0b" />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={8}
          windowSize={5}
          initialNumToRender={8}
          ListHeaderComponent={
            gasStations.length > 0 ? (
              <View style={S.listHeaderRow}>
                <Text style={[S.listHeader, { color: colors.mutedForeground }]}>
                  {gasStations.length} gas station{gasStations.length !== 1 ? "s" : ""} · {radius} mi · {locationLabel}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={S.center}>
              <Feather name="droplet" size={48} color={colors.mutedForeground} />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>No gas stations found</Text>
              <Text style={[S.emptyText, { color: colors.mutedForeground }]}>Try a larger radius or different location</Text>
              <TouchableOpacity style={[S.cta, { backgroundColor: "#f59e0b" }]} onPress={() => setRadius(100)}>
                <Text style={[S.ctaTxt, { color: "#fff" }]}>Expand to 100 mi</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

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
          <Text style={{ fontSize: 12, color: colors.mutedForeground, marginHorizontal: 18, marginTop: 10, marginBottom: 14 }}>
            Quick update — no account required. Helps the next driver.
          </Text>
          {([
            { type: "working", label: "Working ✓", detail: "Ports are operational", bg: "#dcfce7", fg: "#15803d" },
            { type: "busy",    label: "Busy ⚡",   detail: "All ports occupied",   bg: "#fef3c7", fg: "#d97706" },
            { type: "issue",   label: "Issue ⚠",   detail: "Out of service / broken", bg: "#fee2e2", fg: "#dc2626" },
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

      {/* ── Full filter sheet ── */}
      <Modal visible={filterSheetVisible} animationType="slide" transparent onRequestClose={() => setFilterSheetVisible(false)}>
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setFilterSheetVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={[S.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>Filters</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={resetAllFilters}>
                  <Text style={{ fontSize: 13, color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Reset all</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setFilterSheetVisible(false)}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
            {/* Search radius */}
            <View style={S.filterSection}>
              <Text style={[S.filterSectionLabel, { color: colors.mutedForeground }]}>SEARCH RADIUS</Text>
              <View style={S.filterChipRow}>
                {RADII.map((r) => {
                  const active = radius === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      style={[S.filterChip, { backgroundColor: active ? colors.primary : colors.muted }]}
                      onPress={() => { Haptics.selectionAsync(); setRadius(r); }}
                    >
                      <Text style={[S.filterChipTxt, { color: active ? "#fff" : colors.mutedForeground }]}>{r} mi</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Charger type */}
            <View style={[S.filterSection, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={S.filterSectionRow}>
                <Text style={[S.filterSectionLabel, { color: colors.mutedForeground }]}>CHARGER TYPE</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>Select multiple</Text>
              </View>
              <View style={S.filterChipRow}>
                {CHARGER_FILTER_OPTIONS.map((f) => {
                  const active = chargerFilters.has(f.key);
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[S.filterChip, { backgroundColor: active ? colors.primary : colors.muted }]}
                      onPress={() => { Haptics.selectionAsync(); setChargerFilters((prev) => toggle(prev, f.key)); }}
                    >
                      {active && <Ionicons name="checkmark" size={12} color="#fff" />}
                      <Text style={[S.filterChipTxt, { color: active ? "#fff" : colors.mutedForeground }]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Connector type */}
            {allConnectorTypes.length > 0 && (
              <View style={[S.filterSection, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={S.filterSectionRow}>
                  <Text style={[S.filterSectionLabel, { color: colors.mutedForeground }]}>CONNECTOR</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>Select multiple</Text>
                </View>
                <View style={S.filterChipRow}>
                  {allConnectorTypes.map((ct) => {
                    const active = connectorFilters.has(ct);
                    return (
                      <TouchableOpacity
                        key={ct}
                        style={[S.filterChip, { backgroundColor: active ? "#8b5cf6" : colors.muted }]}
                        onPress={() => { Haptics.selectionAsync(); setConnectorFilters((prev) => toggle(prev, ct)); }}
                      >
                        {active && <Ionicons name="checkmark" size={12} color="#fff" />}
                        <Text style={[S.filterChipTxt, { color: active ? "#fff" : colors.mutedForeground }]}>{ct}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Sort */}
            <View style={[S.filterSection, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={[S.filterSectionLabel, { color: colors.mutedForeground }]}>SORT BY</Text>
              <View style={S.filterChipRow}>
                {(["nearest", "highest_rating", "lowest_rating"] as const).map((s) => {
                  const active = sortBy === s;
                  const label = s === "nearest" ? "Nearest first" : s === "highest_rating" ? "★ Highest rated" : "★ Lowest rated";
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[S.filterChip, { backgroundColor: active ? (s === "nearest" ? colors.primary : "#f59e0b") : colors.muted }]}
                      onPress={() => { Haptics.selectionAsync(); setSortBy(s); }}
                    >
                      <Text style={[S.filterChipTxt, { color: active ? "#fff" : colors.mutedForeground }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Network */}
            <View style={[S.filterSection, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingBottom: 0 }]}>
              <View style={S.filterSectionRow}>
                <Text style={[S.filterSectionLabel, { color: colors.mutedForeground }]}>NETWORK</Text>
                {networkFilters.size > 0 && (
                  <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setNetworkFilters(new Set()); }}>
                    <Text style={{ fontSize: 11, color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={[S.netRow, { borderBottomColor: colors.border }, networkFilters.size === 0 && { backgroundColor: colors.primary + "10" }]}
              onPress={() => { Haptics.selectionAsync(); setNetworkFilters(new Set()); }}
            >
              <View style={[S.netCheck, { borderColor: networkFilters.size === 0 ? colors.primary : "#94a3b8" }, networkFilters.size === 0 && { backgroundColor: colors.primary }]}>
                {networkFilters.size === 0 && <Ionicons name="checkmark" size={13} color="#fff" />}
              </View>
              <Text style={[S.netLabel, { color: colors.foreground }]}>All Networks</Text>
              <Text style={[S.netCount, { color: colors.mutedForeground }]}>{allStations?.length ?? 0}</Text>
            </TouchableOpacity>
            {uniqueNetworks.map((net) => {
              const active = networkFilters.has(net);
              const count = allStations?.filter((s) => s.network?.split(";")[0].trim() === net).length ?? 0;
              return (
                <TouchableOpacity
                  key={net}
                  style={[S.netRow, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + "10" }]}
                  onPress={() => { Haptics.selectionAsync(); setNetworkFilters((prev) => toggle(prev, net)); }}
                >
                  <View style={[S.netCheck, { borderColor: active ? colors.primary : "#94a3b8" }, active && { backgroundColor: colors.primary }]}>
                    {active && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                  <Text style={[S.netLabel, { color: colors.foreground }]}>{net}</Text>
                  <Text style={[S.netCount, { color: colors.mutedForeground }]}>{count}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Translate language picker modal ── */}
      <Modal
        visible={translateModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTranslateModalVisible(false)}
      >
        <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setTranslateModalVisible(false)} />
        <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={[S.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={[S.sheetHead, { borderBottomColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="globe" size={18} color={colors.foreground} />
              <Text style={[S.sheetTitle, { color: colors.foreground }]}>Translate Findings</Text>
            </View>
            {translateLang && (
              <TouchableOpacity onPress={() => { applyLanguage(null); }}>
                <Text style={{ fontSize: 13, color: "#ef4444", fontFamily: "Inter_600SemiBold" }}>Turn off</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 }}>
            Station names and addresses will be translated into your chosen language using MyMemory.
          </Text>

          <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
            {/* "Original (English)" row */}
            <TouchableOpacity
              style={[S.langRow, { borderBottomColor: colors.border }, !translateLang && { backgroundColor: colors.primary + "10" }]}
              onPress={() => applyLanguage(null)}
              activeOpacity={0.8}
            >
              <Text style={S.langFlag}>🇺🇸</Text>
              <View style={{ flex: 1 }}>
                <Text style={[S.langLabel, { color: !translateLang ? colors.primary : colors.foreground }]}>Original (English)</Text>
                <Text style={[S.langNative, { color: colors.mutedForeground }]}>No translation</Text>
              </View>
              {!translateLang && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
            </TouchableOpacity>

            {TRANSLATE_LANGS.map((lang) => {
              const active = translateLang === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[S.langRow, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + "10" }]}
                  onPress={() => applyLanguage(lang.code)}
                  activeOpacity={0.8}
                >
                  <Text style={S.langFlag}>{lang.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.langLabel, { color: active ? colors.primary : colors.foreground }]}>{lang.label}</Text>
                    <Text style={[S.langNative, { color: colors.mutedForeground }]}>{lang.nativeName}</Text>
                  </View>
                  {active
                    ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    : <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  }
                </TouchableOpacity>
              );
            })}

            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 16, paddingHorizontal: 24 }}>
              Powered by MyMemory · Free translation · Results may vary
            </Text>
          </ScrollView>
        </View>
      </Modal>

      <ChargeNowModal visible={chargeNowVisible} onClose={() => setChargeNowVisible(false)} initialLocation={loc ?? undefined} />
      <MapModal
        visible={mapVisible}
        onClose={() => setMapVisible(false)}
        chargerFilter={chargerFilters.size === 1 ? [...chargerFilters][0] : "all"}
        networkFilter={networkFilters.size > 0 ? [...networkFilters][0] : null}
        connectorFilter={connectorFilters.size > 0 ? [...connectorFilters][0] : null}
        initialRadius={radius}
        onRadiusChange={setRadius}
        onClearFilters={() => {
          setChargerFilters(new Set());
          setNetworkFilters(new Set());
          setConnectorFilters(new Set());
        }}
        onEditFilters={() => setFilterSheetVisible(true)}
      />
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  titleActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  title: { flex: 1, fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  chargeNowBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  chargeNowTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },

  // ── Translate banner ──────────────────────────────────────────────────────
  translateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginBottom: 8,
  },
  translateBannerTxt: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 11 },
  goBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  goBtnTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  geoError: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6, marginLeft: 2 },

  modeAndFiltersRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  modeToggleRow: { flexDirection: "row", alignItems: "center", padding: 3 },
  modeToggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  modeToggleTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  radiusBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22, flexShrink: 0 },
  radiusBtnTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  filtersBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 22, flexShrink: 0 },
  filtersBtnTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  summaryChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  summaryChipTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  listHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  listHeader: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  communityPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  communityPillTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, borderWidth: 1, marginBottom: 10, padding: 14 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  iconBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  body: { flex: 1, minWidth: 0 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  name: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1 },
  dist: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", flexShrink: 0 },
  addr: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  footRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  directionsBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, paddingVertical: 8 },
  directionsTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10, marginTop: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "600", fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, marginTop: 8 },
  ctaTxt: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 6 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  filterSection: { paddingHorizontal: 18, paddingVertical: 14, gap: 10 },
  filterSectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterSectionLabel: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
  filterChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22 },
  filterChipTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  netRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  netCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  netLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  netCount: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // ── Language picker rows ──────────────────────────────────────────────────
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  langFlag: { fontSize: 26, lineHeight: 30 },
  langLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  langNative: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
