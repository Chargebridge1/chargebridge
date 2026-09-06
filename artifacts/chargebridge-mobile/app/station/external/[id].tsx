import React, { useState, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Linking, Image, TextInput, Modal, Pressable, Dimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser, useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haversineDistance, formatDistance } from "@/utils/distance";
import { getNetworkLink, openNetworkApp } from "@/utils/networkLinks";
import { setNavigationIntent } from "@/utils/navigationIntent";
import { REPORT_BADGE, isRecentReport } from "@/components/StationCard";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type ExternalReview = {
  id: number;
  externalId: string;
  authorName: string;
  clerkUserId: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
};

type EnrichData = {
  ocm: {
    photos: { url: string; title: string | null; dateCreated: string | null }[];
    comments: { id: number; userName: string; rating: number | null; comment: string; dateCreated: string }[];
  };
  yelp: {
    name: string | null; url: string | null; rating: number | null; reviewCount: number | null;
    photos: string[];
    reviews: { id: string; text: string; rating: number; time_created: string; url: string; user: { name: string; image_url: string | null } }[];
  };
  hasOcm: boolean;
  hasYelp: boolean;
};

function formatRelTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= Math.round(rating) ? "star" : "star-outline"} size={size}
          color={i <= Math.round(rating) ? "#f59e0b" : "#cbd5e1"} />
      ))}
    </View>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity key={i} onPress={() => { Haptics.selectionAsync(); onChange(i); }}>
          <Ionicons name={i <= value ? "star" : "star-outline"} size={30}
            color={i <= value ? "#f59e0b" : "#94a3b8"} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function InfoRow({ icon, label, value, onPress }: { icon: string; label: string; value: string; onPress?: () => void }) {
  const colors = useColors();
  const inner = (
    <View style={S.infoRow}>
      <Feather name={icon as any} size={15} color={colors.primary} style={{ marginRight: 12, width: 18 }} />
      <Text style={[S.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[S.infoValue, { color: onPress ? colors.primary : colors.foreground }]} numberOfLines={2}>{value}</Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>
  ) : inner;
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  const colors = useColors();
  return (
    <View style={S.sectionHead}>
      <Text style={[S.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {count != null && count > 0 && (
        <View style={[S.countBadge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[S.countTxt, { color: colors.primary }]}>{count}</Text>
        </View>
      )}
    </View>
  );
}

export default function ExternalStationDetail() {
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    lat: string;
    lng: string;
    address?: string;
    city?: string;
    state?: string;
    chargerType?: string;
    powerKw?: string;
    priceText?: string;
    isFree?: string;
    status?: string;
    network?: string;
    totalPorts?: string;
    availablePorts?: string;
    phone?: string;
    website?: string;
    pricingUrl?: string;
    distanceMiles?: string;
    averageRating?: string;
    reviewCount?: string;
  }>();

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { location } = useCurrentLocation();
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();

  const externalId = params.id;
  const lat = parseFloat(params.lat ?? "");
  const lng = parseFloat(params.lng ?? "");
  const name = params.name ?? "EV Charging Station";

  const SW = Dimensions.get("window").width;
  const [locPhotoModal, setLocPhotoModal] = useState<{ url: string; thumbUrl: string; title: string; source: "wikimedia" | "ocm" | "community" | "google" | "mapillary" | "streetview"; sourceUrl?: string; attribution?: string; distanceM?: number } | null>(null);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewAuthor, setReviewAuthor] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [editRating, setEditRating] = useState(5);
  const [editComment, setEditComment] = useState("");

  // Status report
  const [reportConfirmDone, setReportConfirmDone] = useState(false);
  const [reportConfirmCount, setReportConfirmCount] = useState(0);

  type LatestReport = { id: number; reportType: string; confirmations: number; createdAt: string } | null;
  const { data: latestReport, refetch: refetchReport } = useQuery<LatestReport>({
    queryKey: ["latestReport", externalId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/latest-report`);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 60000,
    refetchInterval: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (latestReport?.confirmations != null) {
      setReportConfirmCount(latestReport.confirmations);
      setReportConfirmDone(false);
    }
  }, [latestReport?.id]);

  const hasRecentReport = !!latestReport && isRecentReport(latestReport.createdAt) && REPORT_BADGE[latestReport.reportType] != null;

  type StatusHistoryItem = { id: number; reportType: string; confirmations: number; createdAt: string };
  const { data: statusHistory = [] } = useQuery<StatusHistoryItem[]>({
    queryKey: ["statusHistory", externalId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/status-history?limit=10`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
    refetchInterval: 5 * 60 * 1000,
  });

  async function handleConfirmReport() {
    if (reportConfirmDone || !latestReport) return;
    Haptics.selectionAsync();
    setReportConfirmDone(true);
    setReportConfirmCount((c) => c + 1);
    try {
      await fetch(
        `${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/status-report/${latestReport.id}/confirm`,
        { method: "POST" }
      );
    } catch {}
  }

  function handleReportStatus() {
    Alert.alert(
      "Report Station Status",
      "What's the current situation?",
      [
        { text: "✓ Working", onPress: () => submitStatusReport("working") },
        { text: "⚡ Busy / In Use", onPress: () => submitStatusReport("busy") },
        { text: "⚠ Issue / Problem", onPress: () => submitStatusReport("issue") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function submitStatusReport(reportType: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/status-report`, {
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
    if (isSignedIn && user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
      if (fullName) setReviewAuthor(fullName);
    }
  }, [isSignedIn, user]);

  const networkLink = getNetworkLink(params.network ?? null);

  const liveDistance =
    location && !isNaN(lat) && !isNaN(lng)
      ? haversineDistance(location.lat, location.lng, lat, lng)
      : null;
  const displayDistance = liveDistance
    ? formatDistance(liveDistance)
    : params.distanceMiles
    ? `${Number(params.distanceMiles).toFixed(1)} mi`
    : null;

  const { data: enrich, isLoading: enrichLoading } = useQuery<EnrichData>({
    queryKey: ["externalEnrich", externalId],
    queryFn: async () => {
      const p = new URLSearchParams({ name, lat: String(lat), lng: String(lng) });
      const r = await fetch(`${BASE}/api/stations/${externalId}/enrich?${p}`);
      if (!r.ok) return { ocm: { photos: [], comments: [] }, yelp: { name: null, url: null, rating: null, reviewCount: null, photos: [], reviews: [] }, hasOcm: false, hasYelp: false };
      return r.json();
    },
    enabled: !isNaN(lat) && !isNaN(lng),
    staleTime: 6 * 60 * 60 * 1000,
  });

  type LocationPhoto = { url: string; thumbUrl: string; title: string; source: "wikimedia" | "ocm" | "community" | "google" | "mapillary" | "streetview"; sourceUrl?: string; attribution?: string };
  const { data: locationPhotos = [] } = useQuery<LocationPhoto[]>({
    queryKey: ["locationPhotos", lat, lng, params.address],
    queryFn: async () => {
      const urlParams = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (params.address) urlParams.set("address", params.address);
      const r = await fetch(`${BASE}/api/location-photos?${urlParams}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !isNaN(lat) && !isNaN(lng),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const { data: reviews = [], isLoading: reviewsLoading, refetch: refetchReviews } = useQuery<ExternalReview[]>({
    queryKey: ["externalReviews", externalId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      if (!reviewAuthor.trim()) throw new Error("Name required");
      const token = isSignedIn ? await getToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews`, {
        method: "POST",
        headers,
        body: JSON.stringify({ authorName: reviewAuthor.trim(), rating: reviewRating, comment: reviewComment.trim() || null }),
      });
      if (!r.ok) throw new Error("Failed to submit");
      return r.json();
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["externalReviews", externalId] });
      setShowReviewForm(false);
      setReviewComment(""); setReviewRating(5);
      refetchReviews();
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not submit review"),
  });

  const updateReview = useMutation({
    mutationFn: async ({ id, rating, comment }: { id: number; rating: number; comment: string }) => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating, comment: comment.trim() || null }),
      });
      if (!r.ok) throw new Error("Failed to update review");
      return r.json();
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["externalReviews", externalId] });
      setEditingReviewId(null);
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not update review"),
  });

  const deleteReview = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to delete review");
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["externalReviews", externalId] });
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not delete review"),
  });

  function handleDirections() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isNaN(lat) && !isNaN(lng)) {
      setNavigationIntent({ lat, lng, label: name });
      router.push("/(tabs)/map" as any);
    }
  }

  const statusColor = params.status === "available" ? "#22c55e" : params.status === "busy" ? "#f59e0b" : params.status === "offline" ? "#ef4444" : "#94a3b8";
  const statusLabel = params.status === "available" ? "Available" : params.status === "busy" ? "In Use" : params.status === "offline" ? "Offline" : "Unknown";
  const typeLabel = params.chargerType === "DCFC" ? "DC Fast Charge" : params.chargerType === "Level2" ? "Level 2" : params.chargerType === "Level1" ? "Level 1" : null;
  const avgRating = params.averageRating ? parseFloat(params.averageRating) : null;
  const totalReviews = parseInt(params.reviewCount ?? "0", 10) + reviews.length;

  const allOcmPhotos = enrich?.ocm.photos ?? [];
  // Yelp photos excluded — may be marketing/stock images, not verified location photos
  const combinedPhotos = allOcmPhotos.map(p => p.url).filter(Boolean);
  const hasAnyPhotos = combinedPhotos.length > 0 || locationPhotos.length > 0;
  const totalPhotoCount = combinedPhotos.length + locationPhotos.length;

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[S.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={[S.backBtn, { backgroundColor: colors.muted }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[S.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
        <TouchableOpacity
          style={[S.dirBtnTop, { backgroundColor: colors.primary + "15" }]}
          onPress={handleDirections}
        >
          <Feather name="navigation" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* Hero card */}
        <View style={[S.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.heroTop}>
            <View style={[S.heroIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="flash" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[S.heroName, { color: colors.foreground }]}>{name}</Text>
              {(params.address || params.city) && (
                <Text style={[S.heroAddr, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {[params.address, params.city, params.state].filter(Boolean).join(", ")}
                </Text>
              )}
            </View>
          </View>

          {/* Chips row */}
          <View style={S.chipsRow}>
            <View style={[S.chip, { backgroundColor: statusColor + "18" }]}>
              <View style={[S.chipDot, { backgroundColor: statusColor }]} />
              <Text style={[S.chipTxt, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {typeLabel && (
              <View style={[S.chip, { backgroundColor: params.chargerType === "DCFC" ? colors.primary + "18" : "#3b82f618" }]}>
                <Text style={[S.chipTxt, { color: params.chargerType === "DCFC" ? colors.primary : "#3b82f6" }]}>{typeLabel}</Text>
              </View>
            )}
            {params.powerKw && (
              <View style={[S.chip, { backgroundColor: colors.muted }]}>
                <Text style={[S.chipTxt, { color: colors.mutedForeground }]}>{params.powerKw} kW</Text>
              </View>
            )}
            {params.isFree === "true" ? (
              <View style={[S.chip, { backgroundColor: "#dcfce7" }]}>
                <Text style={[S.chipTxt, { color: "#15803d" }]}>Free</Text>
              </View>
            ) : params.priceText ? (
              <View style={[S.chip, { backgroundColor: colors.muted }]}>
                <Text style={[S.chipTxt, { color: colors.foreground }]}>{params.priceText}</Text>
              </View>
            ) : null}
            {params.totalPorts && (
              <View style={[S.chip, { backgroundColor: colors.muted }]}>
                <Text style={[S.chipTxt, { color: colors.mutedForeground }]}>
                  {params.availablePorts != null ? `${params.availablePorts}⁄${params.totalPorts}` : params.totalPorts} ports
                </Text>
              </View>
            )}
          </View>

          {/* Rating row */}
          <View style={S.ratingRow}>
            {avgRating != null && avgRating > 0 ? (
              <>
                <Stars rating={avgRating} size={15} />
                <Text style={[S.ratingNum, { color: colors.foreground }]}>{avgRating.toFixed(1)}</Text>
                <Text style={[S.ratingCount, { color: colors.mutedForeground }]}>
                  ({totalReviews} review{totalReviews !== 1 ? "s" : ""})
                </Text>
              </>
            ) : reviews.length > 0 ? (
              <>
                <Stars rating={reviews.reduce((s, r) => s + r.rating, 0) / reviews.length} size={15} />
                <Text style={[S.ratingCount, { color: colors.mutedForeground }]}>({reviews.length} review{reviews.length !== 1 ? "s" : ""})</Text>
              </>
            ) : (
              <>
                {[1,2,3,4,5].map(i => <Ionicons key={i} name="star-outline" size={15} color="#cbd5e1" />)}
                <Text style={[S.ratingCount, { color: colors.mutedForeground }]}>  No reviews yet</Text>
              </>
            )}
            {displayDistance && (
              <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Feather name="navigation" size={12} color={colors.primary} />
                <Text style={[S.ratingCount, { color: colors.primary, fontWeight: "700" }]}>{displayDistance}</Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View style={S.actionsRow}>
            <TouchableOpacity style={[S.actionBtn, { backgroundColor: colors.primary, flex: 1 }]} onPress={handleDirections}>
              <Feather name="navigation" size={15} color="#fff" />
              <Text style={S.actionBtnTxt}>Get Directions</Text>
            </TouchableOpacity>
            {networkLink && (
              <TouchableOpacity
                style={[S.actionBtn, { backgroundColor: "#3b82f6", flex: 1 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); openNetworkApp(params.network!, Linking); }}
              >
                <Ionicons name="open-outline" size={15} color="#fff" />
                <Text style={S.actionBtnTxt}>Open {networkLink.label}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[S.actionBtn, { backgroundColor: "#fee2e218", paddingHorizontal: 12 }]}
              onPress={handleReportStatus}
              activeOpacity={0.8}
            >
              <Ionicons name="alert-circle-outline" size={17} color="#ef4444" />
            </TouchableOpacity>
          </View>

          {/* Status report badge */}
          {hasRecentReport && latestReport && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ backgroundColor: REPORT_BADGE[latestReport.reportType]!.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", fontFamily: "Inter_600SemiBold", color: REPORT_BADGE[latestReport.reportType]!.color }}>
                  {REPORT_BADGE[latestReport.reportType]!.label}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleConfirmReport}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: reportConfirmDone ? colors.primary + "20" : colors.muted }}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 13 }}>👍</Text>
                <Text style={{ fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: reportConfirmDone ? colors.primary : colors.mutedForeground }}>
                  {reportConfirmCount}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Station info */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionHeader title="Station Info" />
          {params.network && <InfoRow icon="radio" label="Network" value={params.network} />}
          {params.phone && (
            <InfoRow icon="phone" label="Phone" value={params.phone}
              onPress={() => Linking.openURL(`tel:${params.phone}`)} />
          )}
          {params.website && (
            <InfoRow icon="globe" label="Website" value={params.website.replace(/^https?:\/\//, "")}
              onPress={() => Linking.openURL(params.website!)} />
          )}
          {params.pricingUrl && !params.website && (
            <InfoRow icon="tag" label="Pricing" value="View pricing info"
              onPress={() => Linking.openURL(params.pricingUrl!)} />
          )}
          {!params.network && !params.phone && !params.website && !params.pricingUrl && (
            <Text style={[S.emptyTxt, { color: colors.mutedForeground }]}>No additional info available</Text>
          )}
        </View>

        {/* Status History */}
        {statusHistory.length > 0 && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionHeader
              title="Status History"
              count={statusHistory.length}
            />
            <Text style={[S.historySubtitle, { color: colors.mutedForeground }]}>Last 24 hours</Text>
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

        {/* Photos */}
        {enrichLoading ? (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 24 }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[{ marginTop: 8, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }]}>
              Loading photos &amp; community data…
            </Text>
          </View>
        ) : hasAnyPhotos ? (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionHeader title="Photos" count={totalPhotoCount} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }} style={{ marginTop: 8 }}>
              {/* OCM + Yelp photos first */}
              {combinedPhotos.map((url, i) => (
                <TouchableOpacity key={`ocm-${i}`} onPress={() => Linking.openURL(url)} activeOpacity={0.85}>
                  <Image
                    source={{ uri: url }}
                    style={S.photo}
                    resizeMode="cover"
                    onError={() => {}}
                  />
                </TouchableOpacity>
              ))}
              {/* Wikimedia / OCM location photos */}
              {locationPhotos.map((lp, i) => (
                <TouchableOpacity key={`loc-${i}`} activeOpacity={0.85} onPress={() => { Haptics.selectionAsync(); setLocPhotoModal(lp); }}>
                  <View>
                    <Image
                      source={{ uri: lp.thumbUrl }}
                      style={S.photo}
                      resizeMode="cover"
                      onError={() => {}}
                    />
                    <View style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                      backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 6, paddingVertical: 3,
                      flexDirection: "row", alignItems: "center", gap: 4,
                    }}>
                      <Text style={{ fontSize: 9, fontWeight: "700", color: lp.source === "wikimedia" ? "#93c5fd" : "#6ee7b7", fontFamily: "Inter_700Bold" }}>
                        {lp.source === "wikimedia" ? "WIKIMEDIA" : "OCM"}
                      </Text>
                      <Feather name="info" size={8} color="rgba(255,255,255,0.65)" />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[S.photoSrc, { color: colors.mutedForeground }]}>
              📍 Verified location photos · via{" "}
              {[
                allOcmPhotos.length > 0 && "OpenChargeMap",
                locationPhotos.some(p => p.source === "wikimedia") && "Wikimedia Commons",
              ].filter(Boolean).join(" & ")}
            </Text>
          </View>
        ) : null}

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
                        style={{ width: SW, height: SW * 0.55 }}
                        resizeMode="cover"
                      />
                      <View style={{ paddingHorizontal: 18, paddingTop: 14 }}>
                        {lp.title ? (
                          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, fontFamily: "Inter_700Bold", marginBottom: 5 }} numberOfLines={2}>{lp.title}</Text>
                        ) : null}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: lp.source === "wikimedia" ? "#3b82f622" : "#0D9E7E22" }}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: lp.source === "wikimedia" ? "#93c5fd" : "#6ee7b7", fontFamily: "Inter_700Bold" }}>
                              {lp.source === "wikimedia" ? "WIKIMEDIA" : "OCM"}
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
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 14 }} numberOfLines={2}>📍 {name}</Text>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12 }}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setLocPhotoModal(null);
                              setNavigationIntent({ lat, lng, label: name });
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

        {/* OCM community comments */}
        {!enrichLoading && (enrich?.ocm.comments ?? []).length > 0 && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionHeader title="OpenChargeMap Reviews" count={enrich!.ocm.comments.length} />
            {enrich!.ocm.comments.map((c) => (
              <View key={c.id} style={[S.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={S.reviewHead}>
                  <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{c.userName}</Text>
                  {c.rating != null && <Stars rating={c.rating} size={12} />}
                  <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                    {new Date(c.dateCreated).toLocaleDateString()}
                  </Text>
                </View>
                {c.comment ? (
                  <Text style={[S.reviewTxt, { color: colors.foreground }]}>{c.comment}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Yelp data */}
        {!enrichLoading && enrich?.hasYelp && enrich.yelp.name && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionHeader title="Yelp" />
            <View style={S.yelpRow}>
              <Text style={[S.yelpName, { color: colors.foreground }]}>{enrich.yelp.name}</Text>
              {enrich.yelp.rating != null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Stars rating={enrich.yelp.rating} size={13} />
                  <Text style={[S.yelpMeta, { color: colors.mutedForeground }]}>
                    {enrich.yelp.rating.toFixed(1)} · {enrich.yelp.reviewCount} reviews
                  </Text>
                </View>
              )}
              {enrich.yelp.url && (
                <TouchableOpacity onPress={() => Linking.openURL(enrich!.yelp.url!)} style={S.yelpLink}>
                  <Feather name="external-link" size={13} color={colors.primary} />
                  <Text style={[S.yelpLinkTxt, { color: colors.primary }]}>View on Yelp</Text>
                </TouchableOpacity>
              )}
            </View>
            {enrich.yelp.reviews.slice(0, 3).map((r) => (
              <View key={r.id} style={[S.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={S.reviewHead}>
                  <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{r.user.name}</Text>
                  <Stars rating={r.rating} size={12} />
                  <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                    {new Date(r.time_created).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={[S.reviewTxt, { color: colors.foreground }]}>{r.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Community reviews */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.sectionHead, { marginBottom: 0 }]}>
            <SectionHeader title="Community Reviews" count={reviews.length} />
            <TouchableOpacity
              style={[S.addReviewBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}
              onPress={() => { Haptics.selectionAsync(); setShowReviewForm(!showReviewForm); }}
            >
              <Ionicons name={showReviewForm ? "close" : "add"} size={14} color={colors.primary} />
              <Text style={[S.addReviewTxt, { color: colors.primary }]}>{showReviewForm ? "Cancel" : "Add Review"}</Text>
            </TouchableOpacity>
          </View>

          {showReviewForm && (
            <View style={[S.reviewForm, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <StarPicker value={reviewRating} onChange={setReviewRating} />
              <TextInput
                style={[S.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                value={reviewAuthor}
                onChangeText={setReviewAuthor}
              />
              <TextInput
                style={[S.input, S.inputMulti, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Share your experience (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={reviewComment}
                onChangeText={setReviewComment}
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity
                style={[S.submitBtn, { backgroundColor: colors.primary }, submitReview.isPending && { opacity: 0.6 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); submitReview.mutate(); }}
                disabled={submitReview.isPending}
              >
                <Text style={S.submitBtnTxt}>{submitReview.isPending ? "Submitting…" : "Submit Review"}</Text>
              </TouchableOpacity>
            </View>
          )}

          {reviewsLoading && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 16 }} />}

          {!reviewsLoading && reviews.length === 0 && !showReviewForm && (
            <Text style={[S.emptyTxt, { color: colors.mutedForeground }]}>
              No community reviews yet. Be the first!
            </Text>
          )}

          {reviews.map((r) => {
            const isOwn = isSignedIn && !!r.clerkUserId && r.clerkUserId === user?.id;
            const isEditing = editingReviewId === r.id;
            return (
              <View key={r.id} style={[S.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={S.reviewHead}>
                  <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{r.authorName}</Text>
                  <Stars rating={r.rating} size={12} />
                  <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                {r.comment && !isEditing ? <Text style={[S.reviewTxt, { color: colors.foreground }]}>{r.comment}</Text> : null}
                {isOwn && !isEditing && (
                  <View style={S.reviewActions}>
                    <TouchableOpacity
                      style={[S.reviewActionBtn, { backgroundColor: colors.primary + "15" }]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setEditRating(r.rating);
                        setEditComment(r.comment ?? "");
                        setEditingReviewId(r.id);
                      }}
                    >
                      <Feather name="edit-2" size={12} color={colors.primary} />
                      <Text style={[S.reviewActionTxt, { color: colors.primary }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[S.reviewActionBtn, { backgroundColor: "#ef444415" }]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        Alert.alert("Delete Review", "Are you sure you want to delete this review?", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteReview.mutate(r.id) },
                        ]);
                      }}
                    >
                      <Feather name="trash-2" size={12} color="#ef4444" />
                      <Text style={[S.reviewActionTxt, { color: "#ef4444" }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {isEditing && (
                  <View style={[S.editForm, { borderColor: colors.border }]}>
                    <StarPicker value={editRating} onChange={setEditRating} />
                    <TextInput
                      style={[S.input, S.inputMulti, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                      placeholder="Update your comment (optional)"
                      placeholderTextColor={colors.mutedForeground}
                      value={editComment}
                      onChangeText={setEditComment}
                      multiline
                      numberOfLines={3}
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity
                        style={[S.submitBtn, { backgroundColor: colors.primary, flex: 1 }, updateReview.isPending && { opacity: 0.6 }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          updateReview.mutate({ id: r.id, rating: editRating, comment: editComment });
                        }}
                        disabled={updateReview.isPending}
                      >
                        <Text style={S.submitBtnTxt}>{updateReview.isPending ? "Saving…" : "Save"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.submitBtn, { backgroundColor: colors.muted, flex: 1 }]}
                        onPress={() => { Haptics.selectionAsync(); setEditingReviewId(null); }}
                      >
                        <Text style={[S.submitBtnTxt, { color: colors.foreground }]}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  topBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  dirBtnTop: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },

  heroCard: { margin: 14, borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  heroIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  heroName: { fontSize: 17, fontWeight: "800", fontFamily: "Inter_700Bold", marginBottom: 3 },
  heroAddr: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  ratingRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  ratingNum: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  ratingCount: { fontSize: 12, fontFamily: "Inter_400Regular" },

  actionsRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12 },
  actionBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

  section: { marginHorizontal: 14, marginBottom: 12, borderRadius: 18, borderWidth: 1, padding: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  countBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  countTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  infoRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e2e8f015" },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  infoValue: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", textAlign: "right", maxWidth: "60%" },

  photo: { width: 160, height: 110, borderRadius: 10, marginRight: 8, backgroundColor: "#f1f5f9" },
  photoSrc: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 6 },

  yelpRow: { gap: 6, marginBottom: 8 },
  yelpName: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  yelpMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  yelpLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  yelpLinkTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },

  historySubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginHorizontal: 16, marginTop: -6, marginBottom: 4 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  historyBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  historyBadgeTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  historyTime: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  historyConf: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  historyConfTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 8, gap: 6 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  reviewAuthor: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  reviewTxt: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  reviewActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  reviewActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  reviewActionTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  editForm: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4, gap: 10 },

  addReviewBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  addReviewTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  reviewForm: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  inputMulti: { height: 80, textAlignVertical: "top" },
  submitBtn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  submitBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  emptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 20 },
});
