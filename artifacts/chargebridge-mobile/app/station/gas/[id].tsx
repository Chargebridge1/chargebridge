import React, { useState, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, Platform, TextInput,
  KeyboardAvoidingView, Modal,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { haversineDistance, formatDistance } from "@/utils/distance";
import { setNavigationIntent } from "@/utils/navigationIntent";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type GasReview = {
  id: number;
  authorName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

function fmtCents(c: number | null): string {
  return c !== null ? `$${(c / 100).toFixed(3)}` : "—";
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={i <= Math.round(rating) ? "star" : "star-outline"}
          size={size}
          color={i <= Math.round(rating) ? "#f59e0b" : "#cbd5e1"}
        />
      ))}
    </View>
  );
}

function InfoRow({ icon, label, value, onPress, tint }: {
  icon: string; label: string; value: string; onPress?: () => void; tint?: string;
}) {
  const colors = useColors();
  const content = (
    <View style={S.infoRow}>
      <Feather name={icon as any} size={15} color={tint ?? colors.primary} style={{ width: 20 }} />
      <Text style={[S.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[S.infoValue, { color: onPress ? colors.primary : colors.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>
  ) : content;
}

function PriceCard({ label, cents, best, colors }: {
  label: string; cents: number | null; best?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[
      S.priceCard,
      best
        ? { backgroundColor: colors.primary + "15", borderColor: colors.primary + "50" }
        : { backgroundColor: colors.muted, borderColor: colors.border },
    ]}>
      <Text style={[S.priceLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[S.priceValue, { color: best ? colors.primary : cents !== null ? colors.foreground : colors.mutedForeground }]}>
        {fmtCents(cents)}
      </Text>
      {best && cents !== null && (
        <View style={[S.bestBadge, { backgroundColor: colors.primary }]}>
          <Text style={S.bestBadgeTxt}>BEST</Text>
        </View>
      )}
    </View>
  );
}

function ReviewCard({ review, colors }: { review: GasReview; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[S.reviewCard, { borderBottomColor: colors.border }]}>
      <View style={S.reviewHead}>
        <View style={[S.avatar, { backgroundColor: colors.primary + "22" }]}>
          <Text style={[S.avatarTxt, { color: colors.primary }]}>{review.authorName[0]?.toUpperCase() ?? "?"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{review.authorName}</Text>
            <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>{timeAgo(review.createdAt)}</Text>
          </View>
          <Stars rating={review.rating} size={13} />
        </View>
      </View>
      {review.comment ? (
        <Text style={[S.reviewComment, { color: colors.foreground }]}>{review.comment}</Text>
      ) : null}
    </View>
  );
}

export default function GasStationDetail() {
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    lat: string;
    lng: string;
    distanceMiles?: string;
    brand?: string;
    phone?: string;
    opening_hours?: string;
    hasCarWash?: string;
    fuelTypes?: string;
    osmUrl?: string;
    regularCents?: string;
    midCents?: string;
    premiumCents?: string;
    dieselCents?: string;
    priceSource?: string;
    priceReporterName?: string;
    priceReportedAt?: string;
    priceRegionName?: string;
    averageRating?: string;
    reviewCount?: string;
  }>();

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { location } = useCurrentLocation();
  const qc = useQueryClient();

  const lat = parseFloat(params.lat ?? "");
  const lng = parseFloat(params.lng ?? "");
  const name = params.name ?? "Gas Station";
  const osmId = params.id;

  const regularCents = params.regularCents ? parseInt(params.regularCents) : null;
  const midCents = params.midCents ? parseInt(params.midCents) : null;
  const premiumCents = params.premiumCents ? parseInt(params.premiumCents) : null;
  const dieselCents = params.dieselCents ? parseInt(params.dieselCents) : null;
  const fuelTypes = params.fuelTypes ? params.fuelTypes.split(",") : [];
  const hasCarWash = params.hasCarWash === "true";
  const initRating = params.averageRating ? parseFloat(params.averageRating) : null;
  const initReviewCount = params.reviewCount ? parseInt(params.reviewCount) : 0;

  const priceSource = params.priceSource as "osm" | "community" | "eia" | "fred" | null ?? null;
  const priceRegionName = params.priceRegionName ?? null;

  // Live distance
  const liveDistance = location && !isNaN(lat) && !isNaN(lng)
    ? haversineDistance(location.lat, location.lng, lat, lng)
    : null;
  const displayDistance = liveDistance
    ? formatDistance(liveDistance)
    : params.distanceMiles
    ? `${Number(params.distanceMiles).toFixed(1)} mi`
    : null;

  // Reviews
  const { data: reviews = [], isLoading: reviewsLoading, refetch: refetchReviews } = useQuery<GasReview[]>({
    queryKey: ["gas-reviews", osmId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/gas-stations/${encodeURIComponent(osmId)}/reviews`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60_000,
  });

  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : initRating;
  const reviewCount = reviews.length > 0 ? reviews.length : initReviewCount;

  // Review form
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewAuthor, setReviewAuthor] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Price update form
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [priceRegular, setPriceRegular] = useState(regularCents ? (regularCents / 100).toFixed(3) : "");
  const [priceMid, setPriceMid] = useState(midCents ? (midCents / 100).toFixed(3) : "");
  const [pricePremium, setPricePremium] = useState(premiumCents ? (premiumCents / 100).toFixed(3) : "");
  const [priceDiesel, setPriceDiesel] = useState(dieselCents ? (dieselCents / 100).toFixed(3) : "");
  const [priceReporter, setPriceReporter] = useState("");
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [priceSaved, setPriceSaved] = useState(false);

  function toCents(v: string): number | null {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0 || n > 20) return null;
    return Math.round(n * 100);
  }

  async function submitPrices() {
    const reg = toCents(priceRegular), mi = toCents(priceMid), pre = toCents(pricePremium), die = toCents(priceDiesel);
    if (!reg && !mi && !pre && !die) { setPriceError("Enter at least one price"); return; }
    setPriceSaving(true); setPriceError("");
    try {
      const r = await fetch(`${BASE}/api/gas-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osmId, regularCents: reg, midCents: mi, premiumCents: pre, dieselCents: die, reporterName: priceReporter || null }),
      });
      if (!r.ok) throw new Error("Failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPriceSaved(true);
      setTimeout(() => setShowPriceForm(false), 1500);
    } catch { setPriceError("Could not save prices"); }
    finally { setPriceSaving(false); }
  }

  async function submitReview() {
    if (!reviewAuthor.trim()) { setReviewError("Please enter your name."); return; }
    setReviewSubmitting(true); setReviewError("");
    try {
      const r = await fetch(`${BASE}/api/gas-stations/${encodeURIComponent(osmId)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: reviewAuthor.trim(), rating: reviewRating, comment: reviewComment.trim() || null }),
      });
      if (!r.ok) throw new Error("Failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReviewDone(true);
      refetchReviews();
      setTimeout(() => { setShowReviewForm(false); setReviewDone(false); }, 1800);
    } catch { setReviewError("Could not submit. Please try again."); }
    finally { setReviewSubmitting(false); }
  }

  const sourceLabel = priceSource === "community"
    ? "Community price"
    : priceSource === "eia"
    ? `EIA regional${priceRegionName ? ` · ${priceRegionName}` : ""}`
    : priceSource === "fred"
    ? `${priceRegionName ?? "Metro"} avg`
    : priceSource === "osm"
    ? "OSM price"
    : null;

  const hasAnyPrice = regularCents || midCents || premiumCents || dieselCents;

  const allPricesWithValue = [regularCents, midCents, premiumCents, dieselCents].filter(Boolean) as number[];
  const cheapestCents = allPricesWithValue.length > 0 ? Math.min(...allPricesWithValue) : null;

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[S.topBar, { paddingTop: insets.top + 10, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[S.backBtn, { backgroundColor: colors.muted }]}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[S.topName, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
          {params.address && (
            <Text style={[S.topAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
              {params.address}{params.city ? `, ${params.city}` : ""}
            </Text>
          )}
        </View>
        {displayDistance && (
          <TouchableOpacity
            style={[S.dirBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setNavigationIntent({ lat, lng, label: name });
              router.push("/(tabs)/map" as any);
            }}
          >
            <Feather name="navigation" size={14} color="#fff" />
            <Text style={S.dirBtnTxt}>{displayDistance}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Fuel prices */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.sectionHead}>
            <Ionicons name="car" size={17} color="#f59e0b" />
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>Fuel Prices</Text>
            {hasAnyPrice && (
              <View style={[S.sourceBadge, { backgroundColor: colors.muted }]}>
                <Text style={[S.sourceBadgeTxt, { color: colors.mutedForeground }]}>
                  {sourceLabel ?? "Unknown source"}
                </Text>
              </View>
            )}
          </View>
          <View style={S.pricesGrid}>
            <PriceCard label="Regular" cents={regularCents} best={!!regularCents && regularCents === cheapestCents} colors={colors} />
            <PriceCard label="Mid-Grade" cents={midCents} colors={colors} />
            <PriceCard label="Premium" cents={premiumCents} colors={colors} />
            <PriceCard label="Diesel" cents={dieselCents} colors={colors} />
          </View>
          {params.priceReportedAt && priceSource === "community" && (
            <Text style={[S.priceNote, { color: colors.mutedForeground }]}>
              {params.priceReporterName ? `Reported by ${params.priceReporterName}` : "Community report"} · {timeAgo(params.priceReportedAt)}
            </Text>
          )}
          {!hasAnyPrice && (
            <Text style={[S.priceNote, { color: colors.mutedForeground, fontStyle: "italic" }]}>
              No prices reported yet — be the first to add them
            </Text>
          )}
        </View>

        {/* Rating summary */}
        {(avgRating !== null || reviewCount > 0) && (
          <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={S.ratingRow}>
              <View style={[S.ratingBigBox, { backgroundColor: "#fef3c7" }]}>
                <Text style={S.ratingBigNum}>{avgRating ? avgRating.toFixed(1) : "—"}</Text>
                <Stars rating={avgRating ?? 0} size={16} />
                <Text style={S.ratingBigSub}>{reviewCount} review{reviewCount !== 1 ? "s" : ""}</Text>
              </View>
              <View style={{ flex: 1, paddingLeft: 16, gap: 4 }}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = reviews.filter((r) => Math.round(r.rating) === star).length;
                  const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                  return (
                    <View key={star} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[S.barStar, { color: colors.mutedForeground }]}>{star}★</Text>
                      <View style={[S.barTrack, { backgroundColor: colors.muted }]}>
                        <View style={[S.barFill, { width: `${pct}%` as any, backgroundColor: "#f59e0b" }]} />
                      </View>
                      <Text style={[S.barCount, { color: colors.mutedForeground }]}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* Station info */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.sectionHead}>
            <Feather name="info" size={16} color={colors.primary} />
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>Station Info</Text>
          </View>
          {params.address && (
            <InfoRow
              icon="map-pin"
              label="Address"
              value={[params.address, params.city, params.state].filter(Boolean).join(", ")}
              onPress={() => {
                const query = encodeURIComponent(`${params.address}, ${params.city ?? ""}`);
                Linking.openURL(`https://maps.apple.com/?q=${query}`);
              }}
            />
          )}
          {params.opening_hours && (
            <InfoRow icon="clock" label="Hours" value={params.opening_hours} />
          )}
          {params.phone && (
            <InfoRow
              icon="phone"
              label="Phone"
              value={params.phone}
              onPress={() => Linking.openURL(`tel:${params.phone}`)}
            />
          )}
          {fuelTypes.length > 0 && (
            <InfoRow icon="droplet" label="Fuel Types" value={fuelTypes.join(", ")} />
          )}
          {hasCarWash && (
            <InfoRow icon="check-circle" label="Car Wash" value="Available" tint="#22c55e" />
          )}
          {params.brand && params.brand !== params.name && (
            <InfoRow icon="tag" label="Brand" value={params.brand} />
          )}
          {params.osmUrl && (
            <InfoRow
              icon="external-link"
              label="OpenStreetMap"
              value="View on OSM"
              onPress={() => Linking.openURL(params.osmUrl!)}
            />
          )}
        </View>

        {/* Action buttons */}
        <View style={S.actions}>
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: "#fef3c7", borderColor: "#fcd34d" }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowReviewForm(true); }}
            activeOpacity={0.85}
          >
            <Ionicons name="star" size={17} color="#d97706" />
            <Text style={[S.actionTxt, { color: "#d97706" }]}>Rate & Review</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPriceForm(true); }}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
            <Text style={[S.actionTxt, { color: colors.mutedForeground }]}>Update Prices</Text>
          </TouchableOpacity>
          {!isNaN(lat) && !isNaN(lng) && (
            <TouchableOpacity
              style={[S.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40", flex: 0, paddingHorizontal: 16 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setNavigationIntent({ lat, lng, label: name });
                router.push("/(tabs)/map" as any);
              }}
              activeOpacity={0.85}
            >
              <Feather name="navigation" size={16} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Reviews */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.sectionHead}>
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.primary} />
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>
              Community Reviews
            </Text>
            {reviewCount > 0 && (
              <View style={[S.countBadge, { backgroundColor: colors.primary + "18" }]}>
                <Text style={[S.countTxt, { color: colors.primary }]}>{reviewCount}</Text>
              </View>
            )}
          </View>
          {reviewsLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
          ) : reviews.length === 0 ? (
            <Text style={[S.noReviews, { color: colors.mutedForeground }]}>No reviews yet — be the first!</Text>
          ) : (
            reviews.map((r) => <ReviewCard key={r.id} review={r} colors={colors} />)
          )}
        </View>
      </ScrollView>

      {/* Update Prices Modal */}
      <Modal visible={showPriceForm} transparent animationType="slide" onRequestClose={() => setShowPriceForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setShowPriceForm(false)} />
          <View style={[S.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={[S.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={S.sheetHead}>
              <View>
                <Text style={[S.sheetTitle, { color: colors.foreground }]}>Update Prices</Text>
                <Text style={[S.sheetSub, { color: colors.mutedForeground }]} numberOfLines={1}>{name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPriceForm(false)} style={[S.closeBtn, { backgroundColor: colors.muted }]}>
                <Ionicons name="close" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            {priceSaved ? (
              <View style={S.successBox}>
                <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
                <Text style={[S.successTxt, { color: colors.foreground }]}>Prices updated!</Text>
              </View>
            ) : (
              <>
                <View style={S.priceFormGrid}>
                  {[
                    { label: "Regular", val: priceRegular, set: setPriceRegular },
                    { label: "Mid-Grade", val: priceMid, set: setPriceMid },
                    { label: "Premium", val: pricePremium, set: setPricePremium },
                    { label: "Diesel", val: priceDiesel, set: setPriceDiesel },
                  ].map(({ label, val, set }) => (
                    <View key={label} style={S.priceFormField}>
                      <Text style={[S.priceFormLabel, { color: colors.mutedForeground }]}>{label}</Text>
                      <View style={[S.priceInputRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                        <Text style={[S.dollar, { color: colors.mutedForeground }]}>$</Text>
                        <TextInput
                          style={[S.priceInput, { color: colors.foreground }]}
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
                <View style={[S.nameInputRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <TextInput
                    style={[S.nameInput, { color: colors.foreground }]}
                    value={priceReporter}
                    onChangeText={setPriceReporter}
                    placeholder="Your name (optional)"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                {!!priceError && <Text style={S.errTxt}>{priceError}</Text>}
                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: priceSaving ? colors.muted : colors.primary }]}
                  onPress={submitPrices}
                  disabled={priceSaving}
                >
                  {priceSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={S.submitTxt}>Submit Prices</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rate & Review Modal */}
      <Modal visible={showReviewForm} transparent animationType="slide" onRequestClose={() => setShowReviewForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <TouchableOpacity style={S.overlay} activeOpacity={1} onPress={() => setShowReviewForm(false)} />
          <View style={[S.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={[S.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={S.sheetHead}>
              <View>
                <Text style={[S.sheetTitle, { color: colors.foreground }]}>Rate & Review</Text>
                <Text style={[S.sheetSub, { color: colors.mutedForeground }]} numberOfLines={1}>{name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowReviewForm(false)} style={[S.closeBtn, { backgroundColor: colors.muted }]}>
                <Ionicons name="close" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            {reviewDone ? (
              <View style={S.successBox}>
                <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
                <Text style={[S.successTxt, { color: colors.foreground }]}>Review submitted!</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 480 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Star picker */}
                <Text style={[S.formLabel, { color: colors.mutedForeground, marginTop: 8 }]}>YOUR RATING *</Text>
                <View style={S.starRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity key={star} onPress={() => { Haptics.selectionAsync(); setReviewRating(star); }} style={S.starTouch}>
                      <Ionicons
                        name={star <= reviewRating ? "star" : "star-outline"}
                        size={38}
                        color={star <= reviewRating ? "#f59e0b" : colors.border}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Name */}
                <Text style={[S.formLabel, { color: colors.mutedForeground, marginTop: 16 }]}>YOUR NAME *</Text>
                <TextInput
                  style={[S.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Alex M."
                  placeholderTextColor={colors.mutedForeground}
                  value={reviewAuthor}
                  onChangeText={setReviewAuthor}
                />
                {/* Comment */}
                <Text style={[S.formLabel, { color: colors.mutedForeground, marginTop: 14 }]}>COMMENT (OPTIONAL)</Text>
                <TextInput
                  style={[S.formInput, S.formTextArea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="How was the station? Prices accurate? Clean?"
                  placeholderTextColor={colors.mutedForeground}
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  multiline
                  numberOfLines={3}
                />
                {!!reviewError && (
                  <View style={S.errBox}>
                    <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
                    <Text style={S.errTxt}>{reviewError}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: reviewSubmitting ? colors.muted : colors.primary, marginTop: 16 }]}
                  onPress={submitReview}
                  disabled={reviewSubmitting}
                >
                  {reviewSubmitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={S.submitTxt}>Submit Review</Text>}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  topName: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  topAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  dirBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, flexShrink: 0,
  },
  dirBtnTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },

  section: { margin: 16, marginBottom: 0, borderRadius: 16, borderWidth: 1, padding: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1 },
  sourceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  sourceBadgeTxt: { fontSize: 10, fontFamily: "Inter_500Medium" },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  countTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  pricesGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  priceCard: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
    alignItems: "center", minWidth: 72, flex: 1,
  },
  priceLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  priceValue: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 2 },
  bestBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20, marginTop: 4 },
  bestBadgeTxt: { fontSize: 8, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  priceNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8 },

  ratingRow: { flexDirection: "row", alignItems: "center" },
  ratingBigBox: { borderRadius: 14, padding: 14, alignItems: "center", gap: 6, minWidth: 90 },
  ratingBigNum: { fontSize: 28, fontWeight: "800", fontFamily: "Inter_700Bold", color: "#d97706" },
  ratingBigSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400e", marginTop: 2 },
  barStar: { fontSize: 11, fontFamily: "Inter_500Medium", width: 24 },
  barTrack: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  barCount: { fontSize: 11, fontFamily: "Inter_400Regular", width: 20, textAlign: "right" },

  infoRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f044" },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium", width: 90 },
  infoValue: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "right" },

  actions: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 16 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  actionTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

  reviewCard: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  reviewHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reviewAuthor: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reviewComment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginLeft: 42 },
  noReviews: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  sheetSub: { fontSize: 13, fontFamily: "Inter_400Regular", maxWidth: 240 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },

  priceFormGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  priceFormField: { width: "47%" },
  priceFormLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 5 },
  priceInputRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 10 },
  dollar: { fontSize: 14, fontFamily: "Inter_500Medium" },
  priceInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  nameInputRow: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, marginBottom: 12 },
  nameInput: { fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 12 },

  starRow: { flexDirection: "row", gap: 4, marginBottom: 4 },
  starTouch: { padding: 4 },
  formLabel: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold", letterSpacing: 0.7, marginBottom: 8 },
  formInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  formTextArea: { height: 90, textAlignVertical: "top", paddingTop: 12 },

  errBox: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, backgroundColor: "#fef2f2", borderRadius: 10, padding: 12 },
  errTxt: { fontSize: 13, color: "#dc2626", fontFamily: "Inter_400Regular", flex: 1 },

  submitBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },

  successBox: { alignItems: "center", paddingVertical: 32, gap: 12 },
  successTxt: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
