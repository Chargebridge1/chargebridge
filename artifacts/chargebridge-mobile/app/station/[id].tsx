import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, TextInput, Alert, Animated, Linking, Modal, Image,
  StatusBar, Pressable,
} from "react-native";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setGuestToken, deleteGuestToken } from "@/utils/guestToken";
import { useStripe } from "@stripe/stripe-react-native";
import { useUser, useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { track, hashId } from "@/lib/analytics";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import {
  useGetStation,
  useGetStationReviews,
  useCreateReview,
  useUpdateReview,
  useDeleteReview,
  useCreateReviewReply,
  useDeleteReviewReply,
  useAddFavorite,
  useRemoveFavorite,
} from "@/lib/api-client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haversineDistance, formatDistance } from "@/utils/distance";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { useDefaultMap, openWithDefaultMap } from "@/hooks/useDefaultMap";
import { watchStation, unwatchStation, isWatching } from "@/utils/stationWatch";
import { REPORT_BADGE, isRecentReport } from "@/components/StationCard";
import ChargeTimeline, { type TimelineStepDef } from "@/components/ChargeTimeline";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type ReviewReply = {
  id: number;
  reviewId: number;
  clerkUserId: string;
  body: string;
  createdAt: string;
};

type Review = {
  id: number;
  stationId: number;
  authorName: string;
  rating: number;
  comment?: string | null;
  clerkUserId?: string | null;
  createdAt: string;
  reply?: ReviewReply | null;
};

const PRESETS = [20, 40, 60, 80];

function formatRelTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[PD.dot, { opacity }]} />;
}
const PD = StyleSheet.create({ dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#22c55e" } });

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= rating ? "star" : "star-outline"} size={size}
          color={i <= rating ? "#f59e0b" : colors.border} />
      ))}
    </View>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity key={i} onPress={() => { Haptics.selectionAsync(); onChange(i); }}>
          <Ionicons name={i <= value ? "star" : "star-outline"} size={28}
            color={i <= value ? "#f59e0b" : "#94a3b8"} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={IR.row}>
      <Feather name={icon as any} size={16} color={colors.primary} style={IR.icon} />
      <Text style={[IR.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[IR.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}
const IR = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  icon: { marginRight: 12, width: 20 },
  label: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  value: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});

function PhotoThumbnail({ uri, colors, onPress }: { uri: string; colors: ReturnType<typeof useColors>; onPress?: () => void }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <View style={{ width: "100%", height: 160, borderRadius: 8, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
        <Feather name="image" size={32} color={colors.mutedForeground + "88"} />
        <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 6, fontFamily: "Inter_400Regular" }}>Image unavailable</Text>
      </View>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} disabled={!onPress}>
      <Image
        source={{ uri }}
        style={{ width: "100%", height: 160, borderRadius: 8, backgroundColor: colors.muted, marginBottom: 8 }}
        resizeMode="cover"
        onError={() => setErrored(true)}
      />
    </TouchableOpacity>
  );
}

function LightboxModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 6));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else if (e.translationY > 80 && Math.abs(e.velocityY) > 300) {
        runOnJS(onClose)();
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(panGesture, pinchGesture, doubleTapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar hidden />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <GestureDetector gesture={composed}>
            <Reanimated.View style={[{ flex: 1, alignItems: "center", justifyContent: "center" }, animatedStyle]}>
              <Image
                source={{ uri }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="contain"
              />
            </Reanimated.View>
          </GestureDetector>
          <TouchableOpacity
            onPress={onClose}
            style={{ position: "absolute", top: 52, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export default function StationDetailScreen() {
  const { id, charge, review } = useLocalSearchParams<{ id: string; charge?: string; review?: string }>();
  const stationId = parseInt(id.replace(/^db-/, ""), 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const qc = useQueryClient();
  const { location } = useCurrentLocation();
  const { user } = useUser();
  const { getToken } = useAuth();

  const { data: station, isLoading } = useGetStation(stationId, {
    query: { enabled: !isNaN(stationId), refetchInterval: 30000 } as any,
  });
  const { data: reviews, isLoading: reviewsLoading } = useGetStationReviews(stationId, {
    query: { enabled: !isNaN(stationId) } as any,
  });

  const addFav = useAddFavorite();
  const removeFav = useRemoveFavorite();
  const createReview = useCreateReview();
  const updateReview = useUpdateReview();
  const deleteReview = useDeleteReview();
  const createReviewReply = useCreateReviewReply();
  const deleteReviewReply = useDeleteReviewReply();

  const [replyFormForId, setReplyFormForId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);

  const [kwhAmount, setKwhAmount] = useState(40);
  const [customKwh, setCustomKwh] = useState("40");

  type KwhPrefs = { global: number | null; dcfc: number | null; level2: number | null; level1: number | null };

  // Stored per-type kWh preferences. Kept in state so that the resolver effect
  // below reruns correctly regardless of whether station data or AsyncStorage
  // finishes loading first.
  const [kwhPrefs, setKwhPrefs] = useState<KwhPrefs | null>(null);

  // Load persisted kWh (global + per-type), email, and driver name on mount
  useEffect(() => {
    AsyncStorage.multiGet([
      "@chargebridge/last_kwh",
      "@chargebridge/last_kwh_dcfc",
      "@chargebridge/last_kwh_level2",
      "@chargebridge/last_kwh_level1",
      "@chargebridge/driver_email",
      "@chargebridge/driver_name",
    ])
      .then(([kwhEntry, dcfcEntry, level2Entry, level1Entry, emailEntry, nameEntry]) => {
        const parse = (v: string | null) => {
          if (!v) return null;
          const n = parseFloat(v);
          return !isNaN(n) && n > 0 && n <= 500 ? n : null;
        };
        setKwhPrefs({
          global: parse(kwhEntry[1]),
          dcfc: parse(dcfcEntry[1]),
          level2: parse(level2Entry[1]),
          level1: parse(level1Entry[1]),
        });
        const savedEmail = emailEntry[1];
        if (savedEmail) setDriverEmail(savedEmail);
        const savedName = nameEntry[1];
        if (savedName) setDriverName(savedName);
      })
      .catch(() => {});
  }, []);

  // T010: When a user signs in, pre-fill checkout fields from their Clerk profile
  // so they never have to retype info they already provided.
  useEffect(() => {
    if (!user) return;
    const clerkName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    if (clerkName) setDriverName(clerkName);
    const clerkEmail = user.primaryEmailAddress?.emailAddress;
    if (clerkEmail) setDriverEmail(clerkEmail);
  }, [user?.id]);

  // Apply the best kWh preference once both storage and station type are known.
  // This effect reruns whenever either piece arrives, so the ordering of the
  // two async operations (AsyncStorage vs. React Query) does not matter.
  useEffect(() => {
    if (!kwhPrefs || !station?.chargerType) return;
    const typeKey = station.chargerType === "DCFC" ? "dcfc"
      : station.chargerType === "Level2" ? "level2"
      : "level1";
    const preferred = kwhPrefs[typeKey] ?? kwhPrefs.global;
    if (preferred !== null) {
      setKwhAmount(preferred);
      setCustomKwh(String(preferred));
    }
  }, [kwhPrefs, station?.chargerType]);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [author, setAuthor] = useState(
    [user?.firstName, user?.lastName].filter(Boolean).join(" ")
  );
  const [comment, setComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const userFullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  React.useEffect(() => {
    if (userFullName && !author) setAuthor(userFullName);
  }, [userFullName]);
  const [submitting, setSubmitting] = useState(false);

  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [showChargeForm, setShowChargeForm] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [driverEmail, setDriverEmail] = useState("");
  const [driverNameError, setDriverNameError] = useState("");
  const [driverEmailError, setDriverEmailError] = useState("");
  const [chargeLoading, setChargeLoading] = useState(false);
  const [chargePhase, setChargePhase] = useState<"idle" | "connecting" | "started">("idle");
  const { defaultMap } = useDefaultMap();

  // Photos
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoType, setPhotoType] = useState<"station" | "nearby_business">("station");
  const [businessName, setBusinessName] = useState("");
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [locPhotoModal, setLocPhotoModal] = useState<{ url: string; thumbUrl: string; title: string; source: "wikimedia" | "ocm" | "community" | "google" | "mapillary" | "streetview"; sourceUrl?: string; attribution?: string; distanceM?: number } | null>(null);

  // Check-in
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);

  // Watch station
  const [watching, setWatching] = useState(false);

  // Status report
  const stationExtId = `db-${stationId}`;

  type LatestReport = { id: number; reportType: string; confirmations: number; createdAt: string } | null;
  const { data: latestReport, refetch: refetchReport } = useQuery<LatestReport>({
    queryKey: ["latestReport", stationExtId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(stationExtId)}/latest-report`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !isNaN(stationId),
    staleTime: 60000,
    refetchInterval: 5 * 60 * 1000,
  });

  type StatusHistoryItem = { id: number; reportType: string; confirmations: number; createdAt: string };
  const { data: statusHistory = [] } = useQuery<StatusHistoryItem[]>({
    queryKey: ["statusHistory", stationExtId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(stationExtId)}/status-history?limit=10`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !isNaN(stationId),
    staleTime: 60000,
    refetchInterval: 5 * 60 * 1000,
  });

  const hasRecentReport = !!latestReport && isRecentReport(latestReport.createdAt) && REPORT_BADGE[latestReport.reportType] != null;
  const [reportConfirmDone, setReportConfirmDone] = useState(false);
  const [reportConfirmCount, setReportConfirmCount] = useState(0);

  useEffect(() => {
    if (latestReport?.confirmations != null) {
      setReportConfirmCount(latestReport.confirmations);
      setReportConfirmDone(false);
    }
  }, [latestReport?.id]);

  async function handleConfirmReport() {
    if (reportConfirmDone || !latestReport) return;
    Haptics.selectionAsync();
    setReportConfirmDone(true);
    setReportConfirmCount((c) => c + 1);
    try {
      await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(stationExtId)}/status-report/${latestReport.id}/confirm`, { method: "POST" });
    } catch {}
  }

  function handleReportStatus() {
    Alert.alert(
      "Report Station Status",
      "What's the current situation?",
      [
        { text: "✓ Working", onPress: () => submitReport("working") },
        { text: "⚡ Busy / In Use", onPress: () => submitReport("busy") },
        { text: "⚠ Issue / Problem", onPress: () => submitReport("issue") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function submitReport(reportType: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(stationExtId)}/status-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType }),
      });
      refetchReport();
    } catch {
      Alert.alert("Error", "Could not submit report. Please try again.");
    }
  }

  useEffect(() => {
    if (!isNaN(stationId)) setWatching(isWatching(stationId));
  }, [stationId]);

  useEffect(() => {
    if (showReviewForm && user && !author.trim()) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
      if (name) setAuthor(name);
    }
  }, [showReviewForm]);

  useEffect(() => {
    return () => { if (!isNaN(stationId)) unwatchStation(stationId); };
  }, [stationId]);

  async function toggleWatch() {
    if (!station) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (watching) {
      unwatchStation(stationId);
      setWatching(false);
    } else {
      const ok = await watchStation(stationId, station.name, (station as any).availablePorts ?? null);
      if (ok) {
        setWatching(true);
      } else {
        Alert.alert("Notifications blocked", "Enable notifications in Settings to get port-available alerts.");
      }
    }
  }

  // Pre-fill name & email from Clerk profile when the charge form opens.
  // Clerk always takes priority over AsyncStorage for signed-in users.
  useEffect(() => {
    if (!showChargeForm || !user) return;
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
    if (full) setDriverName(full);
    const email = user.primaryEmailAddress?.emailAddress;
    if (email) setDriverEmail(email);
  }, [showChargeForm, user]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["getStation", stationId] });
    qc.invalidateQueries({ queryKey: ["getStationReviews", stationId] });
    qc.invalidateQueries({ queryKey: ["listFavorites"] });
  }

  type EnrichData = {
    ocm: { photos: { url: string; title: string | null; dateCreated: string | null }[]; comments: { id: number; userName: string; rating: number | null; comment: string; dateCreated: string }[] };
    yelp: { name: string | null; url: string | null; rating: number | null; reviewCount: number | null; photos: string[]; reviews: { id: string; text: string; rating: number; time_created: string; url: string; user: { name: string; image_url: string | null } }[] };
    hasOcm: boolean; hasYelp: boolean;
  };
  const [showExternal, setShowExternal] = useState(false);
  const { data: enrichData, isLoading: enrichLoading, refetch: fetchEnrich } = useQuery<EnrichData>({
    queryKey: ["stationEnrich", stationId],
    queryFn: async () => {
      if (!station) return { ocm: { photos: [], comments: [] }, yelp: { name: null, url: null, rating: null, reviewCount: null, photos: [], reviews: [] }, hasOcm: false, hasYelp: false };
      const p = new URLSearchParams({ name: String(station.name), lat: String(station.lat), lng: String(station.lng) });
      const r = await fetch(`${BASE}/api/stations/${stationId}/enrich?${p}`);
      if (!r.ok) return { ocm: { photos: [], comments: [] }, yelp: { name: null, url: null, rating: null, reviewCount: null, photos: [], reviews: [] }, hasOcm: false, hasYelp: false };
      return r.json();
    },
    enabled: false,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const { data: photos = [], refetch: refetchPhotos } = useQuery<Array<{ id: number; photoUrl: string; caption: string | null; clerkUserId: string; createdAt: string }>>({
    queryKey: ["stationPhotos", stationId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stations/${stationId}/photos`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !isNaN(stationId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  type LocationPhoto = { url: string; thumbUrl: string; title: string; source: "wikimedia" | "ocm" | "community" | "google" | "mapillary" | "streetview"; sourceUrl?: string; attribution?: string };
  const { data: locationPhotos = [] } = useQuery<LocationPhoto[]>({
    queryKey: ["locationPhotos", station?.lat, station?.lng, station?.address],
    queryFn: async () => {
      if (!station) return [];
      const params = new URLSearchParams({ lat: String(station.lat), lng: String(station.lng) });
      const addr = [station.address, station.city, station.state].filter(Boolean).join(", ");
      if (addr) params.set("address", addr);
      const r = await fetch(`${BASE}/api/location-photos?${params}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!station,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const { data: queueData, refetch: refetchQueue } = useQuery<{ count: number; checkins: Array<{ id: number; portNumber: number | null; checkedInAt: string }> }>({
    queryKey: ["stationQueue", stationId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stations/${stationId}/queue`);
      if (!r.ok) return { count: 0, checkins: [] };
      return r.json();
    },
    enabled: !isNaN(stationId),
    staleTime: 20000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 30000,
  });

  const { data: amenities = [] } = useQuery<{ name: string; type: string; icon: string; distanceM: number; walkMins: number }[]>({
    queryKey: ["station-amenities", stationId],
    queryFn: async () => { const r = await fetch(`${BASE}/api/stations/${stationId}/amenities`); return r.json(); },
    enabled: !isNaN(stationId),
    staleTime: 60 * 60 * 1000,
  });

  async function addPhoto() {
    if (!photoUrl.trim()) { setPhotoError("Paste a photo URL to share."); return; }
    if (photoType === "nearby_business" && !businessName.trim()) { setPhotoError("Enter the business name."); return; }
    setPhotoError(null);
    setAddingPhoto(true);
    try {
      const r = await fetch(`${BASE}/api/stations/${stationId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrl: photoUrl.trim(),
          caption: photoCaption.trim() || null,
          photoType,
          businessName: photoType === "nearby_business" ? businessName.trim() : undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotoUrl(""); setPhotoCaption(""); setBusinessName(""); setPhotoType("station"); setShowPhotoForm(false);
      refetchPhotos();
    } catch { setPhotoError("Could not add photo. Try again."); }
    finally { setAddingPhoto(false); }
  }

  async function toggleCheckIn() {
    setCheckInLoading(true);
    try {
      if (checkedIn) {
        await fetch(`${BASE}/api/stations/${stationId}/checkin`, { method: "DELETE" });
        setCheckedIn(false);
      } else {
        const r = await fetch(`${BASE}/api/stations/${stationId}/checkin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        if (!r.ok) throw new Error("Failed");
        setCheckedIn(true);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      refetchQueue();
    } catch { /* check-in errors are silent — UI reverts automatically */ }
    finally { setCheckInLoading(false); }
  }

  function toggleFav() {
    if (!station) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (station.isFavorited) {
      removeFav.mutate({ stationId: String(station.id) }, { onSuccess: invalidate });
    } else {
      addFav.mutate({ data: { stationId: station.id } }, { onSuccess: invalidate });
    }
  }

  async function submitReview() {
    if (!author.trim()) { setReviewError("Please enter your name."); return; }
    setReviewError(null);
    setSubmitting(true);

    if (editingReviewId !== null) {
      updateReview.mutate(
        { id: editingReviewId, data: { rating, comment: comment.trim() || null } },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            invalidate();
            setShowReviewForm(false);
            setEditingReviewId(null);
            setAuthor(userFullName); setComment(""); setRating(5);
            setSubmitting(false);
          },
          onError: () => { setSubmitting(false); setReviewError("Could not update review. Please try again."); },
        }
      );
    } else {
      createReview.mutate(
        { id: stationId, data: { authorName: author.trim(), rating, comment: comment.trim() || null } },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            invalidate();
            setShowReviewForm(false);
            setAuthor(userFullName); setComment(""); setRating(5);
            setSubmitting(false);
          },
          onError: () => { setSubmitting(false); setReviewError("Could not submit review. Please try again."); },
        }
      );
    }
  }

  function startEditReview(r: Review) {
    Haptics.selectionAsync();
    setEditingReviewId(r.id);
    setRating(r.rating);
    setComment(r.comment ?? "");
    setShowReviewForm(true);
  }

  function cancelReviewForm() {
    Haptics.selectionAsync();
    setShowReviewForm(false);
    setEditingReviewId(null);
    setRating(5);
    setComment("");
  }

  function submitReply(reviewId: number) {
    if (!replyText.trim()) { setReplyError("Please enter a reply."); return; }
    setReplyError(null);
    setSubmittingReply(true);
    createReviewReply.mutate(
      { id: reviewId, data: { body: replyText.trim() } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          invalidate();
          setReplyFormForId(null);
          setReplyText("");
          setSubmittingReply(false);
        },
        onError: () => {
          setSubmittingReply(false);
          setReplyError("Could not post reply. Please try again.");
        },
      }
    );
  }

  function confirmDeleteReply(reviewId: number) {
    Alert.alert(
      "Delete Reply",
      "Are you sure you want to delete this reply?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteReviewReply.mutate(
              { id: reviewId },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  invalidate();
                },
                onError: () => Alert.alert("Could not delete reply"),
              }
            );
          },
        },
      ]
    );
  }

  function confirmDeletePhoto(photoId: number) {
    Alert.alert(
      "Delete Photo",
      "Delete this photo?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await fetch(`${BASE}/api/stations/${stationId}/photos/${photoId}`, { method: "DELETE" });
              if (!r.ok) throw new Error("Failed");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              refetchPhotos();
            } catch {
              Alert.alert("Could not delete photo");
            }
          },
        },
      ]
    );
  }

  function confirmDeleteReview(reviewId: number) {
    Alert.alert(
      "Delete Review",
      "Are you sure you want to delete this review?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteReview.mutate(
              { id: reviewId },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  invalidate();
                },
                onError: () => Alert.alert("Could not delete review"),
              }
            );
          },
        },
      ]
    );
  }

  const statusColor = station?.status === "available" ? "#22c55e" : station?.status === "busy" ? "#f59e0b" : "#ef4444";
  const statusLabel = station?.status === "available" ? "Available" : station?.status === "busy" ? "Busy" : "Offline";
  const typeLabel = station?.chargerType === "DCFC" ? "DC Fast Charge" : station?.chargerType === "Level2" ? "Level 2" : "Level 1";

  const stationNetwork = (station as any)?.network as string | null | undefined;
  const stationOcppId = (station as any)?.ocppChargePointId as string | null | undefined;
  const netLink = getNetworkLink(stationNetwork);
  const stationCtaType = stationOcppId
    ? "charge_now"
    : netLink
    ? "network_app"
    : "charge_here";

  if (isLoading || !station) {
    return (
      <View style={[S.root, { backgroundColor: colors.background }]}>
        <View style={[S.navBar, { paddingTop: topPad + 8 }]}>
          <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={S.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </View>
    );
  }

  const price = Number(station.pricePerKwh);
  const power = Number(station.powerKw);
  const estimatedCost = kwhAmount * price;
  const estimatedMinutes = Math.ceil((kwhAmount / power) * 60);

  const distance =
    location && station.lat != null && station.lng != null
      ? haversineDistance(location.lat, location.lng, Number(station.lat), Number(station.lng))
      : null;

  useEffect(() => {
    if (charge === "1" && station?.status === "available") {
      setShowChargeForm(true);
    }
  }, [charge, station?.status]);

  useEffect(() => {
    if (review === "1" && station) {
      setShowReviewForm(true);
    }
  }, [review, station]);

  function handleDirections() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const lat = Number(station?.lat);
    const lng = Number(station?.lng);
    openWithDefaultMap(lat, lng, station?.name ?? "Station", defaultMap);
  }

  async function handleWalletPay() {
    if (!station) return;
    let hasFieldError = false;
    if (!driverName.trim()) { setDriverNameError("Please enter your name"); hasFieldError = true; } else setDriverNameError("");
    if (!driverEmail.trim() || !driverEmail.includes("@")) { setDriverEmailError("Enter a valid email address"); hasFieldError = true; } else setDriverEmailError("");
    if (hasFieldError) return;
    setChargeLoading(true);
    track("pay_to_charge_tapped", {
      station_id: String(stationId),
      kwh_requested: kwhAmount,
      charger_type: station.chargerType ?? "Unknown",
    });

    // Hoisted so the catch block can clean up the guest token on any failure
    // that occurs after the token has been saved to SecureStore.
    let resolvedSessionId: number | undefined;
    let guestTokenSaved = false;

    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const baseUrl = domain ? `https://${domain}` : "";

      // 1. Create PaymentIntent on the server.
      // Attach the Clerk Bearer token when available so the server can bind
      // the Stripe Customer to the authenticated user (enables saved payment
      // methods). Guest checkout works without the token — the server omits
      // the customer in that case.
      const clerkToken = await getToken().catch(() => null);
      const piHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (clerkToken) piHeaders["Authorization"] = `Bearer ${clerkToken}`;

      const res = await fetch(`${baseUrl}/api/stations/${stationId}/payment-intent`, {
        method: "POST",
        headers: piHeaders,
        body: JSON.stringify({
          driverEmail: driverEmail.trim(),
          driverName: driverName.trim(),
          kwh: kwhAmount,
          chargeMode: "kwh",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Could not create session");
      }
      const { clientSecret, sessionId, customerId, ephemeralKeySecret, guestToken } = (await res.json()) as {
        clientSecret: string;
        sessionId: number;
        amountCents: number;
        customerId?: string;
        ephemeralKeySecret?: string;
        guestToken?: string;
      };
      resolvedSessionId = sessionId;

      // Persist guest token securely so the active-session screen can
      // attach it to start-charging and stop-charging requests.
      // Stored with a 72-hour expiry so abandoned sessions self-clean when
      // the token is read back (e.g. force-quit recovery).
      if (guestToken) {
        try {
          await setGuestToken(sessionId, guestToken);
          guestTokenSaved = true;
        } catch {
          // setGuestToken already called deleteItemAsync internally to clean
          // up any stale entry — guestTokenSaved stays false.
        }
        if (!guestTokenSaved) {
          const shouldContinue = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Secure Storage Unavailable",
              "Your device could not save the session recovery token. If you force-quit the app while charging, you won't be able to stop the session remotely — contact support in that case.\n\nDo you want to continue?",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Continue Anyway", style: "default", onPress: () => resolve(true) },
              ],
            );
          });
          if (!shouldContinue) {
            setChargeLoading(false);
            return;
          }
        }
      }

      // 2. Initialise the Stripe PaymentSheet (Apple Pay / Google Pay / card)
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "ChargeBridge",
        ...(customerId && ephemeralKeySecret
          ? { customerId, customerEphemeralKeySecret: ephemeralKeySecret }
          : {}),
        applePay: { merchantCountryCode: "US" },
        googlePay: { merchantCountryCode: "US", testEnv: true },
        defaultBillingDetails: {
          name: driverName.trim(),
          email: driverEmail.trim(),
        },
        returnURL: "chargebridge-mobile://stripe-redirect",
        style: "automatic",
        allowsDelayedPaymentMethods: false,
      });
      if (initError) throw new Error(initError.message);

      // Precompute session ID hash (async SHA-256) for analytics events below
      const _sessionIdHash = await hashId(resolvedSessionId);

      // 3. Present the PaymentSheet — user picks Apple Pay / Google Pay / card
      track("payment_sheet_presented", {
        station_id: String(stationId),
        session_id_hash: _sessionIdHash,
      });
      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code !== "Canceled") {
          track("payment_failed", {
            station_id: String(stationId),
            error_code: payError.code,
          });
          throw new Error(payError.message);
        }
        track("payment_abandoned", {
          station_id: String(stationId),
          session_id_hash: _sessionIdHash,
        });
        // User dismissed without paying — clean up any saved guest token so
        // it doesn't linger for a session that will never charge.
        if (guestTokenSaved) deleteGuestToken(sessionId);
        return;
      }

      track("payment_authorized", {
        station_id: String(stationId),
        session_id_hash: _sessionIdHash,
      });
      // Show session-starting timeline overlay
      setChargePhase("connecting");

      // 4. Persist the kWh amount (global + per-charger-type), email, and driver name
      const typeStorageKey = station.chargerType === "DCFC"
        ? "@chargebridge/last_kwh_dcfc"
        : station.chargerType === "Level2"
        ? "@chargebridge/last_kwh_level2"
        : "@chargebridge/last_kwh_level1";
      AsyncStorage.multiSet([
        ["@chargebridge/last_kwh", String(kwhAmount)],
        [typeStorageKey, String(kwhAmount)],
        ["@chargebridge/driver_email", driverEmail.trim()],
        ["@chargebridge/driver_name", driverName.trim()],
      ]).catch((storageErr: unknown) => {
        console.warn(
          "[ChargeBridge] AsyncStorage.multiSet failed — kWh preference and driver details were not saved:",
          storageErr,
        );
      });
      // Update kwhPrefs state so same-session navigation to another station of
      // the same type immediately picks up the updated preference.
      const typeKey = station.chargerType === "DCFC" ? "dcfc"
        : station.chargerType === "Level2" ? "level2"
        : "level1";
      setKwhPrefs((prev) => ({ ...(prev ?? { global: null, dcfc: null, level2: null, level1: null }), global: kwhAmount, [typeKey]: kwhAmount }));

      // 5. Notify the server that payment succeeded → starts the OCPP charge
      const startHeaders: Record<string, string> = {};
      if (guestToken) startHeaders["X-Guest-Token"] = guestToken;
      const startRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/start-charging`, {
        method: "POST",
        headers: startHeaders,
      });
      if (!startRes.ok) {
        const startErr = await startRes.json().catch(() => ({}));
        throw new Error((startErr as any).error ?? "Could not start charging session. Please contact support.");
      }

      setChargePhase("started");
      await new Promise<void>((r) => setTimeout(r, 600));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowChargeForm(false);
      router.push({
        pathname: "/active-session" as any,
        params: {
          sessionId: String(sessionId),
          stationId: String(stationId),
          stationName: station.name,
          kwh: String(kwhAmount),
          totalCost: String(estimatedCost.toFixed(2)),
          date: new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
          driverEmail: driverEmail.trim(),
          chargerType: station.chargerType ?? "",
          lat: station.lat != null ? String(station.lat) : "",
          lng: station.lng != null ? String(station.lng) : "",
          // Pass the guest token so active-session can stop the charge
          // without requiring a Clerk session.
          ...(guestToken ? { guestToken } : {}),
        },
      });
    } catch (err: any) {
      // If the guest token was saved to SecureStore but the session failed to
      // start (e.g. start-charging returned an error after payment), remove it
      // so it cannot mislead force-quit recovery for a dead session.
      if (guestTokenSaved && resolvedSessionId !== undefined) {
        deleteGuestToken(resolvedSessionId);
      }
      Alert.alert("Payment Error", err.message ?? "Could not complete payment. Please try again.");
    } finally {
      setChargeLoading(false);
      setChargePhase("idle");
    }
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <View style={[S.topBar, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={[S.backBtn, { backgroundColor: colors.muted }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[S.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>Station Detail</Text>
        <TouchableOpacity
          style={[S.favBtn, { backgroundColor: station.isFavorited ? colors.primary + "18" : colors.muted }]}
          onPress={toggleFav}
        >
          <Ionicons name={station.isFavorited ? "heart" : "heart-outline"} size={20}
            color={station.isFavorited ? colors.primary : colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: isWeb ? 34 : insets.bottom + 24 }}>
        {/* Hero */}
        <View style={[S.hero, { backgroundColor: colors.primary + "0e" }]}>
          <View style={[S.heroIcon, { backgroundColor: colors.primary + "22" }]}>
            <Ionicons name="flash" size={40} color={colors.primary} />
          </View>
          <Text style={[S.heroName, { color: colors.foreground }]}>{station.name}</Text>
          <Text style={[S.heroAddr, { color: colors.mutedForeground }]}>
            {station.address}, {station.city}, {station.state}
          </Text>
          <View style={S.heroBadges}>
            <View style={[S.statusPill, { backgroundColor: statusColor + "22" }]}>
              <View style={[S.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[S.statusTxt, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <View style={[S.typePill, { backgroundColor: colors.secondary }]}>
              <Text style={[S.typeTxt, { color: colors.secondaryForeground }]}>{typeLabel}</Text>
            </View>
            {station.averageRating != null && (
              <View style={[S.ratingPill, { backgroundColor: "#f59e0b18" }]}>
                <Ionicons name="star" size={12} color="#f59e0b" />
                <Text style={S.ratingTxt}>{Number(station.averageRating).toFixed(1)}</Text>
                <Text style={[S.reviewCntTxt, { color: colors.mutedForeground }]}>({station.reviewCount})</Text>
              </View>
            )}
          </View>

          {/* Status report badge */}
          {hasRecentReport && latestReport && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
              <View style={{ backgroundColor: REPORT_BADGE[latestReport.reportType]!.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", color: REPORT_BADGE[latestReport.reportType]!.color }}>
                  {REPORT_BADGE[latestReport.reportType]!.label}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleConfirmReport}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: reportConfirmDone ? colors.primary + "20" : colors.secondary }}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 13 }}>👍</Text>
                <Text style={{ fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: reportConfirmDone ? colors.primary : colors.mutedForeground }}>
                  {reportConfirmCount}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={S.heroCtaRow}>
            <TouchableOpacity
              style={[S.directionsBtn, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={handleDirections}
              activeOpacity={0.8}
            >
              <Feather name="navigation" size={16} color="#fff" />
              <Text style={S.directionsTxt}>
                Get Directions{distance != null ? `  ·  ${formatDistance(distance)}` : ""}
              </Text>
            </TouchableOpacity>
            {Platform.OS !== "web" && (
              <TouchableOpacity
                style={[S.callBtn, { backgroundColor: watching ? "#fef3c7" : colors.card, borderColor: watching ? "#fcd34d" : colors.border }]}
                onPress={toggleWatch}
                activeOpacity={0.8}
              >
                <Ionicons name={watching ? "notifications" : "notifications-outline"} size={18} color={watching ? "#d97706" : colors.mutedForeground} />
              </TouchableOpacity>
            )}
            {!!(station as any)?.phone && (
              <TouchableOpacity
                style={[S.callBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(`tel:${(station as any).phone}`); }}
                activeOpacity={0.8}
              >
                <Feather name="phone" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[S.callBtn, { backgroundColor: "#fee2e218", borderColor: "#fca5a530" }]}
              onPress={handleReportStatus}
              activeOpacity={0.8}
            >
              <Ionicons name="alert-circle-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>
          {watching && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingHorizontal: 4 }}>
              <PulseDot />
              <Text style={{ fontSize: 12, color: "#d97706", fontFamily: "Inter_500Medium" }}>
                Watching — you'll be notified when a port opens
              </Text>
            </View>
          )}
        </View>

        {/* Station Info */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Station Info</Text>
          <InfoRow icon="zap" label="Power output" value={`${power} kW`} />
          <View style={[S.divider, { backgroundColor: colors.border }]} />
          <InfoRow icon="dollar-sign" label="Price per kWh" value={`$${price.toFixed(3)}`} />
          <View style={[S.divider, { backgroundColor: colors.border }]} />
          {station.totalPorts != null && (
            <InfoRow
              icon="server"
              label="Ports"
              value={
                station.availablePorts != null
                  ? `${station.availablePorts} of ${station.totalPorts} available`
                  : `${station.totalPorts} total`
              }
            />
          )}
          {station.network && (
            <>
              <View style={[S.divider, { backgroundColor: colors.border }]} />
              <InfoRow icon="wifi" label="Network" value={station.network} />
            </>
          )}
          {station.description && (
            <View style={S.descBlock}>
              <Text style={[S.descTxt, { color: colors.mutedForeground }]}>{station.description}</Text>
            </View>
          )}
        </View>

        {/* Cost Estimator */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.estimatorHead}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>Cost Estimator</Text>
            <View style={[S.livePill, { backgroundColor: "#22c55e18" }]}>
              <PulseDot />
              <Text style={S.liveTxt}>LIVE</Text>
            </View>
          </View>

          <View style={[S.priceRow, { borderBottomColor: colors.border }]}>
            <Text style={[S.bigPrice, { color: colors.primary }]}>${price.toFixed(3)}</Text>
            <Text style={[S.perKwh, { color: colors.mutedForeground }]}> / kWh</Text>
            <Text style={[S.powerNote, { color: colors.mutedForeground }]}>  ·  {power} kW charger</Text>
          </View>

          <Text style={[S.estimatorLabel, { color: colors.mutedForeground }]}>How much to charge?</Text>
          <View style={S.presetRow}>
            {PRESETS.map((kwh) => {
              const active = kwhAmount === kwh;
              return (
                <TouchableOpacity
                  key={kwh}
                  style={[S.presetBtn, { backgroundColor: active ? colors.primary : colors.muted }]}
                  onPress={() => { Haptics.selectionAsync(); setKwhAmount(kwh); setCustomKwh(String(kwh)); }}
                >
                  <Text style={[S.presetTxt, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                    {kwh} kWh
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[S.customRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[S.customLabel, { color: colors.mutedForeground }]}>Custom</Text>
            <TextInput
              style={[S.kwhInput, { color: colors.foreground }]}
              value={customKwh}
              onChangeText={(t) => {
                setCustomKwh(t);
                const n = parseFloat(t);
                if (!isNaN(n) && n > 0 && n <= 500) setKwhAmount(n);
              }}
              keyboardType="decimal-pad"
              placeholder="40"
              placeholderTextColor={colors.mutedForeground}
              selectTextOnFocus
            />
            <Text style={[S.kwhUnit, { color: colors.mutedForeground }]}>kWh</Text>
          </View>

          <View style={[S.resultCard, { backgroundColor: colors.primary + "0c", borderColor: colors.primary + "2a" }]}>
            <View style={S.resultRow}>
              <View style={S.resultLeft}>
                <Text style={[S.resultLabel, { color: colors.mutedForeground }]}>Estimated cost</Text>
                <Text style={[S.resultValue, { color: colors.primary }]}>${estimatedCost.toFixed(2)}</Text>
              </View>
              <View style={[S.resultSep, { backgroundColor: colors.primary + "25" }]} />
              <View style={S.resultLeft}>
                <Text style={[S.resultLabel, { color: colors.mutedForeground }]}>Charge time</Text>
                <Text style={[S.resultValue, { color: colors.foreground }]}>~{estimatedMinutes} min</Text>
              </View>
            </View>
            <View style={[S.resultDivider, { backgroundColor: colors.primary + "20" }]} />
            <Text style={[S.resultNote, { color: colors.mutedForeground }]}>
              {kwhAmount} kWh at ${price.toFixed(3)}/kWh · {power} kW output
            </Text>
          </View>
        </View>

        {/* Charge / Network CTA */}
        {station.status === "available" && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {stationCtaType === "network_app" && netLink ? (
              /* ── Known-network station: open their app ── */
              <>
                <View style={S.chargeHeader}>
                  <View style={[S.chargeIconWrap, { backgroundColor: "#3b82f618" }]}>
                    <Ionicons name="open-outline" size={22} color="#3b82f6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.chargeSectionTitle, { color: colors.foreground }]}>
                      Charge via {netLink.label}
                    </Text>
                    <Text style={[S.chargeSubtitle, { color: colors.mutedForeground }]}>
                      This station is operated by {netLink.label}. Open their app to start a session.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[S.chargeStartBtn, { backgroundColor: "#3b82f6" }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    if (stationNetwork) openNetworkApp(stationNetwork, Linking);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="open-outline" size={18} color="#fff" />
                  <Text style={S.chargeStartTxt}>Open {netLink.label}</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── Community / OCPP: Stripe checkout ── */
              <>
                <View style={S.chargeHeader}>
                  <View style={[S.chargeIconWrap, { backgroundColor: colors.primary + "18" }]}>
                    <Ionicons name="flash" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.chargeSectionTitle, { color: colors.foreground }]}>
                      {stationCtaType === "charge_now" ? "Charge Now" : "Charge Here"}
                    </Text>
                    <Text style={[S.chargeSubtitle, { color: colors.mutedForeground }]}>
                      Pay with Apple Pay, Google Pay, or card
                    </Text>
                  </View>
                </View>

                {!showChargeForm ? (
                  <TouchableOpacity
                    style={[S.chargeStartBtn, { backgroundColor: colors.primary }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowChargeForm(true); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="flash" size={18} color="#fff" />
                    <Text style={S.chargeStartTxt}>Start Charging Session</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={S.chargeForm}>
                    <Text style={[S.chargeLabel, { color: colors.mutedForeground }]}>Your name</Text>
                    <TextInput
                      style={[S.chargeInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: driverNameError ? "#ef4444" : colors.border }]}
                      value={driverName}
                      onChangeText={(v) => { setDriverName(v); if (v.trim()) setDriverNameError(""); }}
                      placeholder="Jane Smith"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="words"
                      returnKeyType="next"
                    />
                    {!!driverNameError && <Text style={{ color: "#ef4444", fontSize: 12, marginTop: -6, marginBottom: 6, marginLeft: 2 }}>{driverNameError}</Text>}
                    <Text style={[S.chargeLabel, { color: colors.mutedForeground }]}>Email for receipt</Text>
                    <TextInput
                      style={[S.chargeInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: driverEmailError ? "#ef4444" : colors.border }]}
                      value={driverEmail}
                      onChangeText={(v) => { setDriverEmail(v); if (v.trim() && v.includes("@")) setDriverEmailError(""); }}
                      placeholder="jane@example.com"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      returnKeyType="done"
                    />
                    {!!driverEmailError && <Text style={{ color: "#ef4444", fontSize: 12, marginTop: -6, marginBottom: 6, marginLeft: 2 }}>{driverEmailError}</Text>}
                    <View style={[S.chargeSummaryBox, { backgroundColor: colors.primary + "0c", borderColor: colors.primary + "28" }]}>
                      <Text style={[S.chargeSummaryMain, { color: colors.foreground }]}>
                        {kwhAmount} kWh{" "}
                        <Text style={{ color: colors.primary, fontWeight: "700" }}>· ${estimatedCost.toFixed(2)}</Text>
                      </Text>
                      <Text style={[S.chargeSummaryNote, { color: colors.mutedForeground }]}>
                        ~{estimatedMinutes} min · ${price.toFixed(3)}/kWh · {power} kW
                      </Text>
                    </View>
                    <View style={S.chargeFormRow}>
                      <TouchableOpacity
                        style={[S.chargeCancelBtn, { backgroundColor: colors.muted }]}
                        onPress={() => setShowChargeForm(false)}
                      >
                        <Text style={[S.chargeCancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.chargeConfirmBtn, { backgroundColor: chargeLoading ? colors.muted : colors.primary, flex: 1 }]}
                        onPress={handleWalletPay}
                        disabled={chargeLoading}
                        activeOpacity={0.85}
                      >
                        {chargeLoading ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name={Platform.OS === "ios" ? "logo-apple" : "logo-google"}
                              size={17}
                              color="#fff"
                            />
                            <Text style={S.chargeConfirmTxt}>
                              {Platform.OS === "ios" ? "Pay with Apple Pay" : "Pay with Google Pay"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Photos */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.reviewsHeader}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>
              Photos {(photos.length + locationPhotos.length) > 0 ? `(${photos.length + locationPhotos.length})` : ""}
            </Text>
            <TouchableOpacity
              onPress={() => { Haptics.selectionAsync(); setShowPhotoForm(!showPhotoForm); }}
              style={[S.addReviewBtn, { backgroundColor: colors.primary + "18" }]}
            >
              <Feather name={showPhotoForm ? "x" : "camera"} size={15} color={colors.primary} />
              <Text style={[S.addReviewTxt, { color: colors.primary }]}>{showPhotoForm ? "Cancel" : "Add Photo"}</Text>
            </TouchableOpacity>
          </View>

          {/* Auto-fetched location photos strip */}
          {locationPhotos.length > 0 && (
            <View style={{ marginBottom: 4 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
                {locationPhotos.map((lp, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.85}
                    onPress={() => { Haptics.selectionAsync(); setLocPhotoModal(lp); }}
                  >
                    <View>
                      <Image
                        source={{ uri: lp.thumbUrl }}
                        style={{ width: 180, height: 130, borderRadius: 10, backgroundColor: colors.muted }}
                        resizeMode="cover"
                      />
                      <View style={{
                        position: "absolute", bottom: 0, left: 0, right: 0,
                        borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
                        backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 4,
                      }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{
                            paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                            backgroundColor: lp.source === "streetview" ? "#f59e0b22" : lp.source === "wikimedia" ? "#3b82f622" : "#0D9E7E22",
                          }}>
                            <Text style={{ fontSize: 9, fontWeight: "700", color: lp.source === "streetview" ? "#fcd34d" : lp.source === "wikimedia" ? "#93c5fd" : "#6ee7b7", fontFamily: "Inter_700Bold" }}>
                              {lp.source === "streetview" ? "STREET VIEW" : lp.source === "wikimedia" ? "WIKIMEDIA" : lp.source === "google" ? "GOOGLE" : lp.source === "mapillary" ? "MAPILLARY" : lp.source === "community" ? "COMMUNITY" : "OCM"}
                            </Text>
                          </View>
                          {lp.title && (
                            <Text style={{ fontSize: 10, color: "#fff", flex: 1, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{lp.title}</Text>
                          )}
                          <Feather name="info" size={9} color="rgba(255,255,255,0.7)" />
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, paddingHorizontal: 16, marginBottom: 6, fontFamily: "Inter_400Regular" }}>
                📍 Tap photo for info &amp; directions · via{" "}
                {[
                  locationPhotos.some(p => p.source === "streetview") && "Google Street View",
                  locationPhotos.some(p => p.source === "community") && "Community",
                  locationPhotos.some(p => p.source === "ocm") && "OpenChargeMap",
                  locationPhotos.some(p => p.source === "mapillary") && "Mapillary",
                  locationPhotos.some(p => p.source === "google") && "Google Maps",
                  locationPhotos.some(p => p.source === "wikimedia") && "Wikimedia",
                ].filter(Boolean).join(" & ")}
              </Text>
            </View>
          )}

          {/* Add photo form */}
          {showPhotoForm && (
            <View style={[S.reviewForm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <TextInput
                style={[S.reviewInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                value={photoUrl} onChangeText={t => { setPhotoUrl(t); setPhotoError(null); }}
                placeholder="Photo URL (https://…)" placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none" keyboardType="url"
              />
              <TextInput
                style={[S.reviewInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                value={photoCaption} onChangeText={setPhotoCaption}
                placeholder="Caption (optional)" placeholderTextColor={colors.mutedForeground}
              />
              {/* Photo type toggle */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <TouchableOpacity
                  onPress={() => { setPhotoType("station"); setPhotoError(null); }}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                    paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
                    borderColor: photoType === "station" ? colors.primary : colors.border,
                    backgroundColor: photoType === "station" ? colors.primary + "15" : colors.card,
                  }}
                >
                  <Feather name="zap" size={13} color={photoType === "station" ? colors.primary : colors.mutedForeground} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: photoType === "station" ? colors.primary : colors.mutedForeground }}>
                    This Station
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setPhotoType("nearby_business"); setPhotoError(null); }}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                    paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
                    borderColor: photoType === "nearby_business" ? "#f59e0b" : colors.border,
                    backgroundColor: photoType === "nearby_business" ? "#f59e0b15" : colors.card,
                  }}
                >
                  <Feather name="map-pin" size={13} color={photoType === "nearby_business" ? "#f59e0b" : colors.mutedForeground} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: photoType === "nearby_business" ? "#f59e0b" : colors.mutedForeground }}>
                    Nearby Business
                  </Text>
                </TouchableOpacity>
              </View>
              {photoType === "nearby_business" && (
                <TextInput
                  style={[S.reviewInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: "#f59e0b" }]}
                  value={businessName} onChangeText={t => { setBusinessName(t); setPhotoError(null); }}
                  placeholder="Business name (e.g. Coffee Shop, Museum)" placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                />
              )}
              {photoError && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderRadius: 8, borderWidth: 1, borderColor: "#fecaca", padding: 10, marginBottom: 4 }}>
                  <Ionicons name="alert-circle" size={14} color="#ef4444" />
                  <Text style={{ flex: 1, fontSize: 13, color: "#ef4444" }}>{photoError}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[S.submitBtn, { backgroundColor: addingPhoto ? colors.muted : colors.primary }]}
                onPress={addPhoto} disabled={addingPhoto}
              >
                <Text style={[S.submitTxt, { color: addingPhoto ? colors.mutedForeground : colors.primaryForeground }]}>
                  {addingPhoto ? "Adding…" : "Add Photo"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Empty state — only show if no location photos either */}
          {photos.length === 0 && locationPhotos.length === 0 && !showPhotoForm && (
            <View style={S.noReviews}>
              <Feather name="camera" size={22} color={colors.mutedForeground + "66"} />
              <Text style={[S.noReviewsTxt, { color: colors.mutedForeground }]}>No photos yet. Add the first one!</Text>
            </View>
          )}

          {/* Divider before community photos */}
          {photos.length > 0 && locationPhotos.length > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginBottom: 10 }}>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Community photos</Text>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
            </View>
          )}

          {/* Community-uploaded photos */}
          {photos.map(p => {
            const isOwnPhoto = !!user && p.clerkUserId === user.id;
            const isNearbyBusiness = (p as any).photoType === "nearby_business";
            const bizName = (p as any).businessName as string | null | undefined;
            return (
              <View key={p.id} style={[S.reviewCard, { borderTopColor: colors.border }]}>
                <PhotoThumbnail uri={p.photoUrl} colors={colors} onPress={() => { Haptics.selectionAsync(); setLightboxUri(p.photoUrl); }} />
                {/* Nearby business badge */}
                {isNearbyBusiness && bizName && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f59e0b18", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Feather name="map-pin" size={10} color="#f59e0b" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#d97706" }}>Nearby: {bizName}</Text>
                    </View>
                  </View>
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="image" size={13} color={colors.mutedForeground + "99"} />
                  {p.caption
                    ? <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, flex: 1 }}>{p.caption}</Text>
                    : <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, flex: 1, fontStyle: "italic" }}>No caption</Text>
                  }
                  <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                {/* Directions button for nearby business photos */}
                {isNearbyBusiness && bizName && station && (
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: "#f59e0b18", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start" }}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setNavigationIntent({ lat: station.lat as number, lng: station.lng as number, label: bizName });
                      router.push("/(tabs)/map" as any);
                    }}
                  >
                    <Feather name="navigation-2" size={13} color="#d97706" />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#d97706" }}>Directions to {bizName}</Text>
                  </TouchableOpacity>
                )}
                {isOwnPhoto && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      style={S.reviewActionBtn}
                      onPress={() => { Haptics.selectionAsync(); confirmDeletePhoto(p.id); }}
                    >
                      <Text style={[S.reviewActionTxt, { color: "#ef4444" }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Check-in / Queue */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[S.sectionTitle, { color: colors.foreground, padding: 0 }]}>Live Queue</Text>
              {(queueData?.count ?? 0) > 0 && (
                <View style={{ backgroundColor: "#f59e0b22", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#d97706" }}>{queueData!.count} here</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[S.addReviewBtn, { backgroundColor: checkedIn ? "#ef444420" : colors.primary + "18" }]}
              onPress={toggleCheckIn} disabled={checkInLoading}
            >
              {checkInLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name={checkedIn ? "log-out" : "log-in"} size={15} color={checkedIn ? "#ef4444" : colors.primary} />
                  <Text style={[S.addReviewTxt, { color: checkedIn ? "#ef4444" : colors.primary }]}>
                    {checkedIn ? "Check Out" : "Check In"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          {(queueData?.count ?? 0) === 0 ? (
            <View style={S.noReviews}>
              <Text style={[S.noReviewsTxt, { color: colors.mutedForeground }]}>No one checked in yet.</Text>
            </View>
          ) : (
            queueData?.checkins.map((c, i) => (
              <View key={c.id} style={[S.reviewCard, { borderTopColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[S.reviewAvatar, { backgroundColor: "#22c55e22" }]}>
                    <Text style={[S.avatarTxt, { color: "#16a34a" }]}>#{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: colors.foreground }]}>
                      {c.portNumber ? `Port ${c.portNumber}` : "Open port"}
                    </Text>
                    <Text style={[S.reviewDate, { color: colors.mutedForeground, marginTop: 2 }]}>
                      Arrived {new Date(c.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: "#22c55e18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#16a34a" }}>Charging</Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Status History */}
        {statusHistory.length > 0 && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[S.sectionTitle, { color: colors.foreground, paddingBottom: 12 }]}>
              Status History{" "}
              <Text style={{ fontSize: 12, fontWeight: "400", color: colors.mutedForeground }}>
                (last 24h)
              </Text>
            </Text>
            {statusHistory.map((item, i) => {
              const badge = REPORT_BADGE[item.reportType];
              if (!badge) return null;
              return (
                <View
                  key={item.id}
                  style={[
                    S.historyRow,
                    { borderTopColor: colors.border },
                    i === 0 && { borderTopWidth: 0 },
                  ]}
                >
                  <View style={[S.historyBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[S.historyBadgeTxt, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                  <Text style={[S.historyTime, { color: colors.mutedForeground }]}>
                    {formatRelTime(item.createdAt)}
                  </Text>
                  {item.confirmations > 0 && (
                    <View style={[S.historyConf, { backgroundColor: colors.muted }]}>
                      <Text style={{ fontSize: 11 }}>👍</Text>
                      <Text style={[S.historyConfTxt, { color: colors.mutedForeground }]}>
                        {item.confirmations}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* External Reviews (OCM + Yelp) */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.reviewsHeader}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>External Data</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                if (!showExternal) { setShowExternal(true); fetchEnrich(); }
                else setShowExternal(false);
              }}
              style={[S.addReviewBtn, { backgroundColor: colors.primary + "18" }]}
            >
              <Feather name={showExternal ? "x" : "globe"} size={15} color={colors.primary} />
              <Text style={[S.addReviewTxt, { color: colors.primary }]}>{showExternal ? "Hide" : "Load"}</Text>
            </TouchableOpacity>
          </View>
          {showExternal && (
            enrichLoading ? (
              <View style={{ padding: 16, alignItems: "center" }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 8 }]}>Fetching OCM &amp; Yelp…</Text>
              </View>
            ) : (
              <View>
                {/* OCM */}
                <View style={{ padding: 16, paddingTop: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: "#16a34a18", alignItems: "center", justifyContent: "center" }}>
                      <Feather name="zap" size={11} color="#16a34a" />
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: colors.foreground }}>OpenChargeMap</Text>
                    {!enrichData?.hasOcm && <Text style={{ fontSize: 10, color: "#d97706", backgroundColor: "#fef3c733", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>No key</Text>}
                  </View>
                  {enrichData?.hasOcm && (enrichData.ocm.photos.length > 0 || enrichData.ocm.comments.length > 0) ? (
                    <View style={{ gap: 8 }}>
                      {enrichData.ocm.comments.slice(0, 4).map(c => (
                        <View key={c.id} style={[{ borderRadius: 10, borderWidth: 1, padding: 10 }, { backgroundColor: colors.muted + "33", borderColor: colors.border }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{c.userName}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              {c.rating != null && (
                                <Text style={{ fontSize: 11, color: "#f59e0b", fontWeight: "700" }}>★ {c.rating}/5</Text>
                              )}
                              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{new Date(c.dateCreated).toLocaleDateString()}</Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 18 }}>{c.comment}</Text>
                        </View>
                      ))}
                      {enrichData.ocm.photos.length > 0 && (
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>+ {enrichData.ocm.photos.length} photo{enrichData.ocm.photos.length !== 1 ? "s" : ""} on OpenChargeMap</Text>
                      )}
                    </View>
                  ) : enrichData?.hasOcm ? (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>No OCM data near this location.</Text>
                  ) : (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>Add an OCM_API_KEY to enable.</Text>
                  )}
                </View>

                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 16 }} />

                {/* Yelp */}
                <View style={{ padding: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: "#ef444418", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="star" size={11} color="#ef4444" />
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: colors.foreground }}>Yelp</Text>
                    {!enrichData?.hasYelp && <Text style={{ fontSize: 10, color: "#d97706", backgroundColor: "#fef3c733", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>No key</Text>}
                  </View>
                  {enrichData?.hasYelp && enrichData.yelp.name ? (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 10, backgroundColor: "#ef444408", borderWidth: 1, borderColor: "#ef444420" }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{enrichData.yelp.name}</Text>
                        {enrichData.yelp.rating != null && (
                          <Text style={{ fontSize: 12, color: "#ef4444", fontWeight: "700" }}>★ {enrichData.yelp.rating} · {enrichData.yelp.reviewCount} reviews</Text>
                        )}
                      </View>
                      {enrichData.yelp.reviews.slice(0, 3).map(r => (
                        <View key={r.id} style={[{ borderRadius: 10, borderWidth: 1, padding: 10 }, { backgroundColor: colors.muted + "33", borderColor: colors.border }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{r.user.name}</Text>
                            <Text style={{ fontSize: 11, color: "#ef4444", fontWeight: "700" }}>★ {r.rating}/5</Text>
                          </View>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 18 }} numberOfLines={3}>{r.text}</Text>
                        </View>
                      ))}
                    </View>
                  ) : enrichData?.hasYelp ? (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>No Yelp listing found near this location.</Text>
                  ) : (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>Add a YELP_API_KEY to enable.</Text>
                  )}
                </View>
              </View>
            )
          )}
        </View>

        {/* Reviews */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.reviewsHeader}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>
              Reviews {reviews ? `(${reviews.length})` : ""}
            </Text>
            <TouchableOpacity
              onPress={() => showReviewForm ? cancelReviewForm() : setShowReviewForm(true)}
              style={[S.addReviewBtn, { backgroundColor: colors.primary + "18" }]}
            >
              <Feather name={showReviewForm ? "x" : "edit-3"} size={15} color={colors.primary} />
              <Text style={[S.addReviewTxt, { color: colors.primary }]}>
                {showReviewForm ? "Cancel" : "Add Review"}
              </Text>
            </TouchableOpacity>
          </View>

          {showReviewForm && (
            <View style={[S.reviewForm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              {editingReviewId !== null && (
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary, marginBottom: 2 }}>
                  Editing your review
                </Text>
              )}
              <StarPicker value={rating} onChange={setRating} />
              <TextInput
                style={[S.reviewInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                value={author} onChangeText={t => { setAuthor(t); setReviewError(null); }} placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                style={[S.reviewInput, S.reviewCommentInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                value={comment} onChangeText={setComment}
                placeholder="Share your experience (optional)"
                placeholderTextColor={colors.mutedForeground}
                multiline numberOfLines={3}
              />
              {reviewError && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderRadius: 8, borderWidth: 1, borderColor: "#fecaca", padding: 10, marginBottom: 4 }}>
                  <Ionicons name="alert-circle" size={14} color="#ef4444" />
                  <Text style={{ flex: 1, fontSize: 13, color: "#ef4444" }}>{reviewError}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[S.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}
                onPress={submitReview} disabled={submitting}
              >
                <Text style={[S.submitTxt, { color: submitting ? colors.mutedForeground : colors.primaryForeground }]}>
                  {submitting ? "Saving…" : editingReviewId !== null ? "Update Review" : "Submit Review"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {reviewsLoading && <ActivityIndicator size="small" color={colors.primary} style={{ margin: 16 }} />}

          {reviews?.length === 0 && !reviewsLoading && (
            <View style={S.noReviews}>
              <Text style={[S.noReviewsTxt, { color: colors.mutedForeground }]}>No reviews yet. Be the first!</Text>
            </View>
          )}

          {reviews?.map((r: Review) => {
            const isOwn = !!user && !!r.clerkUserId && r.clerkUserId === user.id;
            const isReplyOwn = !!user && !!r.reply && r.reply.clerkUserId === user.id;
            const showingReplyForm = replyFormForId === r.id;
            return (
              <View key={r.id} style={[S.reviewCard, { borderTopColor: colors.border }]}>
                <View style={S.reviewHead}>
                  <View style={[S.reviewAvatar, { backgroundColor: colors.primary + "22" }]}>
                    <Text style={[S.avatarTxt, { color: colors.primary }]}>{r.authorName[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={S.reviewMeta}>
                    <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{r.authorName}</Text>
                    <Stars rating={r.rating} size={12} />
                  </View>
                  <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                {r.comment && <Text style={[S.reviewCommentTxt, { color: colors.foreground }]}>{r.comment}</Text>}
                {isOwn && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      onPress={() => startEditReview(r)}
                      style={[S.reviewActionBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30" }]}
                    >
                      <Feather name="edit-2" size={13} color={colors.primary} />
                      <Text style={[S.reviewActionTxt, { color: colors.primary }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmDeleteReview(r.id)}
                      style={[S.reviewActionBtn, { backgroundColor: "#ef444414", borderColor: "#ef444430" }]}
                    >
                      <Feather name="trash-2" size={13} color="#ef4444" />
                      <Text style={[S.reviewActionTxt, { color: "#ef4444" }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Existing reply */}
                {r.reply && (
                  <View style={[S.replyBlock, { backgroundColor: colors.muted + "44", borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <View style={[S.replyIcon, { backgroundColor: colors.primary + "22" }]}>
                        <Feather name="corner-down-right" size={11} color={colors.primary} />
                      </View>
                      <Text style={[S.replyOwnerTxt, { color: colors.primary }]}>Owner reply</Text>
                      <Text style={[S.replyDate, { color: colors.mutedForeground }]}>
                        {new Date(r.reply.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={[S.replyBodyTxt, { color: colors.foreground }]}>{r.reply.body}</Text>
                    {isReplyOwn && (
                      <TouchableOpacity
                        onPress={() => confirmDeleteReply(r.id)}
                        style={[S.reviewActionBtn, { backgroundColor: "#ef444414", borderColor: "#ef444430", marginTop: 6, alignSelf: "flex-start" }]}
                      >
                        <Feather name="trash-2" size={12} color="#ef4444" />
                        <Text style={[S.reviewActionTxt, { color: "#ef4444" }]}>Delete reply</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Reply form / button for station owner with no reply yet */}
                {user && user.id === station?.ownerClerkUserId && !r.reply && (
                  <View style={{ marginTop: 6 }}>
                    {showingReplyForm ? (
                      <View style={[S.replyForm, { backgroundColor: colors.muted + "44", borderColor: colors.border }]}>
                        <TextInput
                          style={[S.reviewInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                          value={replyText}
                          onChangeText={t => { setReplyText(t); setReplyError(null); }}
                          placeholder="Write a reply…"
                          placeholderTextColor={colors.mutedForeground}
                          multiline
                          numberOfLines={2}
                        />
                        {replyError && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderRadius: 8, borderWidth: 1, borderColor: "#fecaca", padding: 8, marginBottom: 4 }}>
                            <Ionicons name="alert-circle" size={13} color="#ef4444" />
                            <Text style={{ flex: 1, fontSize: 12, color: "#ef4444" }}>{replyError}</Text>
                          </View>
                        )}
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => { setReplyFormForId(null); setReplyText(""); setReplyError(null); }}
                            style={[S.reviewActionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.muted, borderColor: colors.border }]}
                          >
                            <Text style={[S.reviewActionTxt, { color: colors.mutedForeground }]}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => submitReply(r.id)}
                            disabled={submittingReply}
                            style={[S.reviewActionBtn, { flex: 1, justifyContent: "center", backgroundColor: submittingReply ? colors.muted : colors.primary + "22", borderColor: colors.primary + "44" }]}
                          >
                            <Feather name="send" size={12} color={colors.primary} />
                            <Text style={[S.reviewActionTxt, { color: colors.primary }]}>{submittingReply ? "Posting…" : "Post reply"}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => { Haptics.selectionAsync(); setReplyFormForId(r.id); setReplyText(""); }}
                        style={[S.reviewActionBtn, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "28", alignSelf: "flex-start" }]}
                      >
                        <Feather name="corner-down-right" size={12} color={colors.primary} />
                        <Text style={[S.reviewActionTxt, { color: colors.primary }]}>Reply</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Nearby while you charge */}
        {amenities.length > 0 && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>Nearby while you charge</Text>
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
              {amenities.map((a, i) => (
                <View key={`${a.type}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.muted + "22", borderRadius: 10, padding: 10 }}>
                  <Text style={{ fontSize: 22 }}>{a.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 1 }}>{a.type} · ~{a.walkMins} min walk</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {lightboxUri && (
        <LightboxModal uri={lightboxUri} onClose={() => setLightboxUri(null)} />
      )}

      {/* Location photo info modal */}
      <Modal
        visible={!!locPhotoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setLocPhotoModal(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}
          onPress={() => setLocPhotoModal(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 36, overflow: "hidden" }}>
              {locPhotoModal && (() => {
                const lp = locPhotoModal;
                return (
                  <>
                    <Image
                      source={{ uri: lp.thumbUrl }}
                      style={{ width: "100%", height: 220 }}
                      resizeMode="cover"
                    />
                    <View style={{ paddingHorizontal: 18, paddingTop: 14 }}>
                      {lp.title ? (
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, fontFamily: "Inter_700Bold", marginBottom: 5 }} numberOfLines={2}>{lp.title}</Text>
                      ) : null}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: lp.source === "streetview" ? "#f59e0b22" : lp.source === "wikimedia" ? "#3b82f622" : "#0D9E7E22" }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: lp.source === "streetview" ? "#fcd34d" : lp.source === "wikimedia" ? "#93c5fd" : "#6ee7b7", fontFamily: "Inter_700Bold" }}>
                            {lp.source === "streetview" ? "STREET VIEW" : lp.source === "wikimedia" ? "WIKIMEDIA" : lp.source === "google" ? "GOOGLE" : lp.source === "mapillary" ? "MAPILLARY" : lp.source === "community" ? "COMMUNITY" : "OCM"}
                          </Text>
                        </View>
                        {lp.distanceM != null && (
                          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                            {lp.distanceM < 1000 ? `${Math.round(lp.distanceM)} m from station` : `${(lp.distanceM / 1000).toFixed(1)} km from station`}
                          </Text>
                        )}
                      </View>
                      {lp.attribution ? (
                        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 10 }} numberOfLines={1}>© {lp.attribution}</Text>
                      ) : null}
                      {station ? (
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 14 }} numberOfLines={2}>📍 {station.name}</Text>
                      ) : null}
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12 }}
                          onPress={() => {
                            if (!station) return;
                            Haptics.selectionAsync();
                            setLocPhotoModal(null);
                            setNavigationIntent({ lat: station.lat as number, lng: station.lng as number, label: station.name });
                            router.push("/(tabs)/map" as any);
                          }}
                        >
                          <Feather name="navigation-2" size={15} color="#fff" />
                          <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" }}>Navigate Here</Text>
                        </TouchableOpacity>
                        {lp.sourceUrl ? (
                          <TouchableOpacity
                            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 16 }}
                            onPress={() => Linking.openURL(lp.sourceUrl!)}
                          >
                            <Feather name="external-link" size={14} color={colors.mutedForeground} />
                            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>Source</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </>
                );
              })()}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Charge Confidence Timeline overlay — shown during session handoff */}
      <Modal
        visible={chargePhase !== "idle"}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={TL.backdrop}>
          <View style={[TL.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={TL.header}>
              <View style={[TL.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="flash" size={18} color={colors.primary} />
              </View>
              <View>
                <Text style={[TL.title, { color: colors.foreground }]}>Charging Session Starting</Text>
                <Text style={[TL.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {station?.name ?? "Station"}
                </Text>
              </View>
            </View>

            <ChargeTimeline
              steps={[
                {
                  id: "auth",
                  label: "Payment Authorized",
                  state: "complete",
                },
                {
                  id: "connect",
                  label: "Connecting to Charger",
                  state: chargePhase === "connecting" ? "active" : "complete",
                },
                {
                  id: "started",
                  label: "Charging Started",
                  state: chargePhase === "started" ? "active" : "pending",
                },
              ]}
              tintColor={colors.primary}
            />

            <Text style={[TL.hint, { color: colors.mutedForeground }]}>
              Hang tight — your session is being activated
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBar: { paddingHorizontal: 16, paddingBottom: 8 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarTitle: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center" },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  favBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  hero: { padding: 24, paddingBottom: 20, alignItems: "center", gap: 8 },
  heroCtaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  directionsBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24 },
  callBtn: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  directionsTxt: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#fff" },
  heroIcon: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  heroName: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  heroAddr: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  heroBadges: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  typePill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  typeTxt: { fontSize: 13, fontWeight: "500", fontFamily: "Inter_500Medium" },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  ratingTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#f59e0b" },
  reviewCntTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  historyBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  historyBadgeTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  historyTime: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  historyConf: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  historyConfTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  section: { margin: 16, marginTop: 0, borderRadius: 20, borderWidth: 1, overflow: "hidden", marginBottom: 14, shadowColor: "#1A2530", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, padding: 16, paddingBottom: 10, opacity: 0.5 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  descBlock: { padding: 16, paddingTop: 8 },
  descTxt: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  // Cost estimator
  estimatorHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 0 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  liveTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#22c55e" },
  priceRow: { flexDirection: "row", alignItems: "baseline", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  bigPrice: { fontSize: 32, fontWeight: "700", fontFamily: "Inter_700Bold" },
  perKwh: { fontSize: 16, fontFamily: "Inter_400Regular" },
  powerNote: { fontSize: 13, fontFamily: "Inter_400Regular" },
  estimatorLabel: { fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  presetRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  presetBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  presetTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  customRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, marginBottom: 14 },
  customLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginRight: 10 },
  kwhInput: { flex: 1, fontSize: 17, fontWeight: "600", fontFamily: "Inter_600SemiBold", paddingVertical: 12 },
  kwhUnit: { fontSize: 14, fontFamily: "Inter_400Regular" },
  resultCard: { marginHorizontal: 16, marginBottom: 16, borderRadius: 18, borderWidth: 1, padding: 18, gap: 10 },
  resultRow: { flexDirection: "row", alignItems: "center" },
  resultLeft: { flex: 1, gap: 2 },
  resultSep: { width: 1, height: 40, marginHorizontal: 16 },
  resultLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  resultValue: { fontSize: 24, fontWeight: "700", fontFamily: "Inter_700Bold" },
  resultDivider: { height: StyleSheet.hairlineWidth },
  resultNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  // Reviews
  reviewsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 12 },
  addReviewBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  addReviewTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewForm: { margin: 16, marginTop: 0, borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  reviewInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular" },
  reviewCommentInput: { height: 80, textAlignVertical: "top" },
  submitBtn: { borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  submitTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  noReviews: { padding: 20, alignItems: "center" },
  noReviewsTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
  reviewCard: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reviewMeta: { flex: 1, gap: 2 },
  reviewAuthor: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reviewCommentTxt: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  reviewActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  reviewActionTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  replyBlock: { marginTop: 8, marginLeft: 16, borderRadius: 10, borderWidth: 1, padding: 10 },
  replyIcon: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  replyOwnerTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  replyDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  replyBodyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  replyForm: { marginTop: 6, marginLeft: 16, borderRadius: 10, borderWidth: 1, padding: 10, gap: 8 },
  // Charge Here section
  chargeHeader: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, paddingBottom: 12 },
  chargeIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  chargeSectionTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  chargeSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  chargeStartBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginBottom: 16, paddingVertical: 14, borderRadius: 14 },
  chargeStartTxt: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  chargeForm: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  chargeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: -2 },
  chargeInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontFamily: "Inter_400Regular" },
  chargeSummaryBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 4, gap: 4 },
  chargeSummaryMain: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chargeSummaryNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  chargeFormRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  chargeCancelBtn: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chargeCancelTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  chargeConfirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 12 },
  chargeConfirmTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
});

const TL = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
