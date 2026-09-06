import React, { useState, useEffect } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Pressable,
  ActivityIndicator, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface GasReview {
  id: number;
  authorName: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
}

interface Props {
  visible: boolean;
  osmId: string;
  stationName: string;
  onClose: () => void;
  onReviewed?: () => void;
}

const LABELS = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

function StarRow({ rating, size = 13 }: { rating: number; size?: number }) {
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

export function GasRateSheet({ visible, osmId, stationName, onClose, onReviewed }: Props) {
  const colors = useColors();

  const [rating, setRating] = useState(0);
  const [authorName, setAuthorName] = useState("");
  const [comment, setComment] = useState("");
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existingReviews, setExistingReviews] = useState<GasReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReviewsLoading(true);
    fetch(`${BASE}/api/gas-stations/${encodeURIComponent(osmId)}/reviews`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setExistingReviews(Array.isArray(data) ? data : []))
      .catch(() => setExistingReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [visible, osmId]);

  function reset() {
    setRating(0);
    setAuthorName("");
    setComment("");
    setRatingError(null);
    setNameError(null);
    setServerError(null);
    setDone(false);
    setSubmitting(false);
    setExistingReviews([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    let hasError = false;
    if (rating === 0) { setRatingError("Please select a star rating."); hasError = true; } else { setRatingError(null); }
    if (!authorName.trim()) { setNameError("Please enter your name."); hasError = true; } else { setNameError(null); }
    if (hasError) return;
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/gas-stations/${encodeURIComponent(osmId)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: authorName.trim(), rating, comment: comment.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
      onReviewed?.();
      setTimeout(handleClose, 1800);
    } catch {
      setServerError("Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const avgRating = existingReviews.length > 0
    ? existingReviews.reduce((s, r) => s + r.rating, 0) / existingReviews.length
    : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={S.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={S.kav}
      >
        <View style={[S.sheet, { backgroundColor: colors.card }]}>
          {/* Handle */}
          <View style={[S.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[S.title, { color: colors.foreground }]}>Rate & Review</Text>
              <Text style={[S.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{stationName}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={[S.closeBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="close" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Scrollable body */}
          <ScrollView
            style={S.body}
            contentContainerStyle={S.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {done ? (
              <View style={S.successBox}>
                <View style={[S.successIcon, { backgroundColor: "#dcfce7" }]}>
                  <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
                </View>
                <Text style={[S.successTxt, { color: colors.foreground }]}>Review submitted!</Text>
                <Text style={[S.successSub, { color: colors.mutedForeground }]}>Thank you for helping the community.</Text>
              </View>
            ) : (
              <>
                {/* Star picker */}
                <View style={S.section}>
                  <Text style={[S.label, { color: ratingError ? "#dc2626" : colors.mutedForeground }]}>Your Rating *</Text>
                  <View style={S.starPickerRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        onPress={() => { Haptics.selectionAsync(); setRating(star); setRatingError(null); }}
                        activeOpacity={0.7}
                        style={S.starTouch}
                      >
                        <Ionicons
                          name={star <= rating ? "star" : "star-outline"}
                          size={40}
                          color={star <= rating ? "#f59e0b" : ratingError ? "#ef4444" : colors.border}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  {rating > 0
                    ? <Text style={[S.ratingLabel, { color: "#f59e0b" }]}>{LABELS[rating]}</Text>
                    : ratingError
                      ? <Text style={S.fieldError}>{ratingError}</Text>
                      : null}
                </View>

                {/* Name */}
                <View style={S.section}>
                  <Text style={[S.label, { color: nameError ? "#dc2626" : colors.mutedForeground }]}>Your Name *</Text>
                  <TextInput
                    style={[S.input, { backgroundColor: colors.background, borderColor: nameError ? "#ef4444" : colors.border, color: colors.foreground }]}
                    placeholder="Alex M."
                    placeholderTextColor={colors.mutedForeground}
                    value={authorName}
                    onChangeText={v => { setAuthorName(v); if (nameError) setNameError(null); }}
                    returnKeyType="next"
                  />
                  {nameError ? <Text style={S.fieldError}>{nameError}</Text> : null}
                </View>

                {/* Comment */}
                <View style={S.section}>
                  <Text style={[S.label, { color: colors.mutedForeground }]}>Comment <Text style={{ fontWeight: "400" }}>(optional)</Text></Text>
                  <TextInput
                    style={[S.input, S.textArea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="How was the experience? Prices accurate? Clean station?"
                    placeholderTextColor={colors.mutedForeground}
                    value={comment}
                    onChangeText={setComment}
                    multiline
                    numberOfLines={3}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                </View>

                {serverError && (
                  <View style={S.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
                    <Text style={S.errorTxt}>{serverError}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: colors.primary }, submitting && { opacity: 0.7 }]}
                  onPress={handleSubmit}
                  activeOpacity={0.85}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={S.submitTxt}>Submit Review</Text>}
                </TouchableOpacity>

                {/* Existing reviews */}
                {(reviewsLoading || existingReviews.length > 0) && (
                  <View style={[S.reviewsSection, { borderTopColor: colors.border }]}>
                    <View style={S.reviewsHeaderRow}>
                      <Text style={[S.reviewsTitle, { color: colors.mutedForeground }]}>
                        {reviewsLoading ? "Loading reviews…" : `Community Reviews (${existingReviews.length})`}
                      </Text>
                      {avgRating != null && (
                        <View style={S.avgRow}>
                          <Ionicons name="star" size={13} color="#f59e0b" />
                          <Text style={[S.avgTxt, { color: colors.foreground }]}>{avgRating.toFixed(1)}</Text>
                        </View>
                      )}
                    </View>
                    {reviewsLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
                    ) : (
                      existingReviews.map((r) => (
                        <View key={r.id} style={[S.reviewCard, { borderBottomColor: colors.border }]}>
                          <View style={S.reviewCardHead}>
                            <View style={[S.avatar, { backgroundColor: colors.primary + "22" }]}>
                              <Text style={[S.avatarTxt, { color: colors.primary }]}>{r.authorName[0]?.toUpperCase() ?? "?"}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                <Text style={[S.reviewAuthor, { color: colors.foreground }]}>{r.authorName}</Text>
                                <Text style={[S.reviewDate, { color: colors.mutedForeground }]}>
                                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                </Text>
                              </View>
                              <StarRow rating={r.rating} />
                            </View>
                          </View>
                          {r.comment ? (
                            <Text style={[S.reviewComment, { color: colors.foreground }]}>{r.comment}</Text>
                          ) : null}
                        </View>
                      ))
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  kav: { justifyContent: "flex-end", maxHeight: "90%" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },

  body: { maxHeight: 520 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 36 },

  section: { marginTop: 18 },
  label: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },

  starPickerRow: { flexDirection: "row", gap: 4 },
  starTouch: { padding: 4 },
  ratingLabel: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 6 },

  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  textArea: { height: 90, textAlignVertical: "top", paddingTop: 12 },

  fieldError: { fontSize: 12, color: "#dc2626", fontFamily: "Inter_400Regular", marginTop: 5 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorTxt: { fontSize: 13, color: "#dc2626", fontFamily: "Inter_400Regular", flex: 1 },

  submitBtn: { marginTop: 20, borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  submitTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },

  reviewsSection: { marginTop: 24, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  reviewsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  reviewsTitle: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  avgRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  avgTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reviewCard: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  reviewCardHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reviewAuthor: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reviewComment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginLeft: 42 },

  successBox: { paddingVertical: 40, alignItems: "center", gap: 12 },
  successIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  successTxt: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
