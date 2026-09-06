import React, { useState, useEffect } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCreateReview } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface ExistingReview {
  id: number;
  authorName: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
}

interface Props {
  visible: boolean;
  stationId?: number;
  externalId?: string;
  stationName: string;
  onClose: () => void;
}

const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

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

export function QuickRateSheet({ visible, stationId, externalId, stationName, onClose }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const createReview = useCreateReview();

  const [rating, setRating] = useState(0);
  const [authorName, setAuthorName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [externalPending, setExternalPending] = useState(false);

  const [existingReviews, setExistingReviews] = useState<ExistingReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReviewsLoading(true);

    const url = stationId !== undefined
      ? `${BASE}/api/stations/${stationId}/reviews`
      : externalId
      ? `${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews`
      : null;

    if (!url) { setReviewsLoading(false); return; }

    fetch(url)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setExistingReviews(Array.isArray(data) ? data : []))
      .catch(() => setExistingReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [visible, stationId, externalId]);

  function reset() {
    setRating(0);
    setAuthorName("");
    setComment("");
    setError(null);
    setDone(false);
    setExternalPending(false);
    setExistingReviews([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!authorName.trim()) { setError("Please enter your name."); return; }
    if (rating === 0) { setError("Please select a star rating."); return; }
    setError(null);

    if (stationId !== undefined) {
      createReview.mutate(
        { id: stationId, data: { authorName: authorName.trim(), rating, comment: comment.trim() || null } },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            queryClient.invalidateQueries({ queryKey: ["ev-stations-explore"] });
            queryClient.invalidateQueries({ queryKey: ["ev-stations-nearby"] });
            queryClient.invalidateQueries({ queryKey: ["station", stationId] });
            queryClient.invalidateQueries({ queryKey: ["station-reviews", stationId] });
            setDone(true);
            setTimeout(handleClose, 1800);
          },
          onError: () => setError("Could not submit. Please try again."),
        }
      );
    } else if (externalId) {
      setExternalPending(true);
      try {
        const res = await fetch(`${BASE}/api/ev-stations/${encodeURIComponent(externalId)}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorName: authorName.trim(), rating, comment: comment.trim() || null }),
        });
        if (!res.ok) throw new Error("Failed");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ["ev-stations-nearby"] });
        queryClient.invalidateQueries({ queryKey: ["ev-stations-explore"] });
        queryClient.invalidateQueries({ queryKey: ["ev-stations-map"] });
        setDone(true);
        setTimeout(handleClose, 1800);
      } catch {
        setError("Could not submit. Please try again.");
      } finally {
        setExternalPending(false);
      }
    }
  }

  const isPending = createReview.isPending || externalPending;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={S.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={S.kav}>
        <View style={[S.sheet, { backgroundColor: colors.card }]}>
          <View style={[S.handle, { backgroundColor: colors.border }]} />

          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={[S.title, { color: colors.foreground }]}>Rate this station</Text>
              <Text style={[S.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{stationName}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={[S.closeBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="close" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Existing reviews */}
          {(existingReviews.length > 0 || reviewsLoading) && !done && (
            <View style={[S.reviewsSection, { borderBottomColor: colors.border }]}>
              <Text style={[S.reviewsTitle, { color: colors.mutedForeground }]}>
                {reviewsLoading ? "Loading reviews…" : `What others said (${existingReviews.length})`}
              </Text>
              {reviewsLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
              ) : (
                <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
                  {existingReviews.map((r) => (
                    <View key={r.id} style={[S.reviewCard, { borderBottomColor: colors.border }]}>
                      <View style={S.reviewCardHead}>
                        <View style={[S.avatar, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[S.avatarTxt, { color: colors.primary }]}>{r.authorName[0]?.toUpperCase() ?? "?"}</Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
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
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {done ? (
            <View style={S.successBox}>
              <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
              <Text style={[S.successTxt, { color: colors.foreground }]}>Review submitted — thank you!</Text>
            </View>
          ) : (
            <>
              <View style={S.section}>
                <Text style={[S.label, { color: colors.mutedForeground }]}>Your rating</Text>
                <View style={S.starRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => { Haptics.selectionAsync(); setRating(star); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={star <= rating ? "star" : "star-outline"}
                        size={36}
                        color={star <= rating ? "#f59e0b" : colors.border}
                      />
                    </TouchableOpacity>
                  ))}
                  {rating > 0 && (
                    <Text style={[S.ratingLabel, { color: colors.foreground }]}>{LABELS[rating]}</Text>
                  )}
                </View>
              </View>

              <View style={S.section}>
                <Text style={[S.label, { color: colors.mutedForeground }]}>Your name</Text>
                <TextInput
                  style={[S.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Alex M."
                  placeholderTextColor={colors.mutedForeground}
                  value={authorName}
                  onChangeText={setAuthorName}
                  autoFocus
                  returnKeyType="next"
                />
              </View>

              <View style={S.section}>
                <Text style={[S.label, { color: colors.mutedForeground }]}>Comment <Text style={{ fontWeight: "400" }}>(optional)</Text></Text>
                <TextInput
                  style={[S.input, S.textArea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="How was the charging experience?"
                  placeholderTextColor={colors.mutedForeground}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />
              </View>

              {error && (
                <View style={S.errorBox}>
                  <Text style={S.errorTxt}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[S.submitBtn, { backgroundColor: colors.primary }, isPending && { opacity: 0.7 }]}
                onPress={handleSubmit}
                activeOpacity={0.85}
                disabled={isPending}
              >
                {isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={S.submitTxt}>Submit Review</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  kav: { justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 36 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0", marginBottom: 6 },
  title: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  reviewsSection: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 12, marginBottom: 4 },
  reviewsTitle: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  reviewCard: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  reviewCardHead: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reviewAuthor: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reviewComment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginLeft: 36 },
  section: { marginTop: 16 },
  label: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  starRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingLabel: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginLeft: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  textArea: { height: 80, textAlignVertical: "top", paddingTop: 10 },
  errorBox: { marginTop: 12, backgroundColor: "#fef2f2", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#fecaca" },
  errorTxt: { fontSize: 13, color: "#dc2626", fontFamily: "Inter_400Regular" },
  submitBtn: { marginTop: 18, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  submitTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  successBox: { paddingVertical: 32, alignItems: "center", gap: 12 },
  successTxt: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
