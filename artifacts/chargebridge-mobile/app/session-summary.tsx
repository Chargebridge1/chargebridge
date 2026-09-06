import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function SessionSummaryScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  const { sessionId, stationId, stationName, kwh, totalCost, date, driverEmail, chargerType } =
    useLocalSearchParams<{
      sessionId?: string;
      stationId?: string;
      stationName?: string;
      kwh?: string;
      totalCost?: string;
      date?: string;
      driverEmail?: string;
      chargerType?: string;
    }>();

  const storageKey = sessionId ? `@chargebridge/reviewPromptDismissed/${sessionId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    AsyncStorage.getItem(storageKey).then((val) => {
      if (val === "1") setReviewDismissed(true);
    });
  }, [storageKey]);

  function dismissReviewPrompt() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReviewDismissed(true);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, "1");
    }
  }

  const kwhNum = kwh ? parseFloat(kwh) : null;
  const costNum = totalCost ? parseFloat(totalCost) : null;

  function handleViewStation() {
    if (!stationId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/station/${stationId}` as any);
  }

  function handleDone() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.dismissAll();
    router.replace("/(tabs)/home" as any);
  }

  async function handleShareReceipt() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPdfBusy(true);
    try {
      const generatedDate = new Date().toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      const rows: string[] = [];
      if (stationName) {
        rows.push(`<tr><td class="lbl">Station</td><td class="val">${stationName}</td></tr>`);
      }
      if (date) {
        rows.push(`<tr><td class="lbl">Date &amp; Time</td><td class="val">${date}</td></tr>`);
      }
      if (chargerType) {
        rows.push(`<tr><td class="lbl">Charger Type</td><td class="val">${chargerType}</td></tr>`);
      }
      if (kwhNum != null) {
        rows.push(`<tr><td class="lbl">Energy Delivered</td><td class="val">${kwhNum.toFixed(2)} kWh</td></tr>`);
      }
      if (costNum != null) {
        rows.push(`<tr><td class="lbl">Amount Charged</td><td class="val amt">$${costNum.toFixed(2)}</td></tr>`);
      }
      if (driverEmail) {
        rows.push(`<tr><td class="lbl">Receipt Email</td><td class="val">${driverEmail}</td></tr>`);
      }

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a2530; padding: 40px; }
.header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 24px; border-bottom: 2px solid #0D9E7E; margin-bottom: 28px; }
.brand-name { font-size: 22px; font-weight: 800; color: #0D9E7E; }
.brand-sub { font-size: 12px; color: #888; margin-top: 2px; }
.meta { text-align: right; font-size: 12px; color: #888; }
.hero { text-align: center; margin-bottom: 28px; }
.checkmark { font-size: 48px; margin-bottom: 8px; }
.hero-title { font-size: 20px; font-weight: 800; color: #1a2530; }
.hero-sub { font-size: 13px; color: #888; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
td { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; }
td.lbl { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; width: 40%; }
td.val { font-weight: 600; color: #1a2530; }
td.amt { font-size: 18px; font-weight: 800; color: #0D9E7E; }
.footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #f0f0f0; padding-top: 16px; }
</style></head><body>
<div class="header">
  <div><div class="brand-name">ChargeBridge</div><div class="brand-sub">EV Charging Receipt</div></div>
  <div class="meta">Generated ${generatedDate}</div>
</div>
<div class="hero">
  <div class="checkmark">✅</div>
  <div class="hero-title">Charging Complete</div>
  <div class="hero-sub">Your session has been recorded successfully.</div>
</div>
<table>
  <tbody>${rows.join("")}</tbody>
</table>
<div class="footer">ChargeBridge — Community EV Charging Network · chargebridge.app</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Share Charging Receipt",
          UTI: "com.adobe.pdf",
        });
      }
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Nav bar */}
      <View style={[S.navBar, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={[S.backBtn, { backgroundColor: colors.muted }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>Session Summary</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[S.content, { paddingBottom: isWeb ? 34 : insets.bottom + 40 }]}
      >
        {/* Success hero */}
        <View style={[S.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[S.heroIconWrap, { backgroundColor: "#22c55e18" }]}>
            <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
          </View>
          <Text style={[S.heroTitle, { color: colors.foreground }]}>Charging Complete</Text>
          <Text style={[S.heroSub, { color: colors.mutedForeground }]}>
            Your session has been recorded successfully.
          </Text>
        </View>

        {/* Session details card */}
        <View style={[S.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[S.detailHeading, { color: colors.foreground }]}>Session Details</Text>

          {/* Station name */}
          <View style={[S.row, { borderBottomColor: colors.border }]}>
            <View style={[S.rowIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="flash" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Station</Text>
              <Text style={[S.rowValue, { color: colors.foreground }]} numberOfLines={2}>
                {stationName ?? "Unknown Station"}
              </Text>
            </View>
          </View>

          {/* Charger type */}
          {!!chargerType && (
            <View style={[S.row, { borderBottomColor: colors.border }]}>
              <View style={[S.rowIcon, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="cpu" size={16} color="#8b5cf6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Charger Type</Text>
                <Text style={[S.rowValue, { color: colors.foreground }]}>{chargerType}</Text>
              </View>
            </View>
          )}

          {/* kWh */}
          {kwhNum != null && (
            <View style={[S.row, { borderBottomColor: colors.border }]}>
              <View style={[S.rowIcon, { backgroundColor: "#3b82f618" }]}>
                <Feather name="zap" size={16} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Energy Delivered</Text>
                <Text style={[S.rowValue, { color: colors.foreground }]}>{kwhNum.toFixed(2)} kWh</Text>
              </View>
            </View>
          )}

          {/* Amount paid */}
          {costNum != null && (
            <View style={[S.row, { borderBottomColor: colors.border }]}>
              <View style={[S.rowIcon, { backgroundColor: "#f59e0b18" }]}>
                <Feather name="dollar-sign" size={16} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Amount Charged</Text>
                <Text style={[S.rowValue, { color: colors.foreground }]}>${costNum.toFixed(2)}</Text>
              </View>
            </View>
          )}

          {/* Date / time */}
          {date && (
            <View style={[S.row, { borderBottomColor: driverEmail ? colors.border : "transparent" }]}>
              <View style={[S.rowIcon, { backgroundColor: colors.muted }]}>
                <Feather name="clock" size={16} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Date & Time</Text>
                <Text style={[S.rowValue, { color: colors.foreground }]}>{date}</Text>
              </View>
            </View>
          )}

          {/* Driver email */}
          {!!driverEmail && (
            <View style={[S.row, { borderBottomColor: "transparent" }]}>
              <View style={[S.rowIcon, { backgroundColor: colors.muted }]}>
                <Feather name="mail" size={16} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.rowLabel, { color: colors.mutedForeground }]}>Receipt Email</Text>
                <Text style={[S.rowValue, { color: colors.foreground }]}>{driverEmail}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Metrics strip */}
        {(kwhNum != null || costNum != null) && (
          <View style={S.metricsRow}>
            {kwhNum != null && (
              <View style={[S.metricPill, { backgroundColor: "#3b82f618", flex: 1 }]}>
                <Text style={[S.metricVal, { color: "#3b82f6" }]}>{kwhNum.toFixed(1)}</Text>
                <Text style={[S.metricLbl, { color: "#3b82f688" }]}>kWh</Text>
              </View>
            )}
            {costNum != null && (
              <View style={[S.metricPill, { backgroundColor: colors.primary + "18", flex: 1 }]}>
                <Text style={[S.metricVal, { color: colors.primary }]}>${costNum.toFixed(2)}</Text>
                <Text style={[S.metricLbl, { color: colors.primary + "88" }]}>Paid</Text>
              </View>
            )}
          </View>
        )}

        {/* Rate this station prompt */}
        {stationId && !reviewDismissed && (
          <View style={[S.reviewCard, { backgroundColor: colors.card, borderColor: colors.primary + "44" }]}>
            <View style={[S.reviewIconWrap, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="star" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.reviewCardTitle, { color: colors.foreground }]}>Rate this station</Text>
              <Text style={[S.reviewCardSub, { color: colors.mutedForeground }]}>
                Help the community — share your experience.
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <TouchableOpacity
                style={[S.reviewCardBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/station/${stationId}?review=1` as any);
                }}
                activeOpacity={0.85}
              >
                <Text style={S.reviewCardBtnTxt}>Write a review</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.reviewDismissBtn, { backgroundColor: colors.muted }]}
                onPress={dismissReviewPrompt}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Actions */}
        {stationId && (
          <TouchableOpacity
            style={[S.viewStationBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleViewStation}
            activeOpacity={0.8}
          >
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={[S.viewStationTxt, { color: colors.primary }]}>View Station</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary + "88"} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[S.shareBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: pdfBusy ? 0.6 : 1 }]}
          onPress={handleShareReceipt}
          disabled={pdfBusy}
          activeOpacity={0.8}
        >
          {pdfBusy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="share-2" size={18} color={colors.primary} />
          )}
          <Text style={[S.shareTxt, { color: colors.primary }]}>
            {pdfBusy ? "Generating…" : "Share Receipt"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[S.doneBtn, { backgroundColor: colors.primary }]}
          onPress={handleDone}
          activeOpacity={0.85}
        >
          <Text style={S.doneTxt}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  navTitle: {
    flex: 1, textAlign: "center",
    fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  content: { padding: 16, gap: 12 },

  heroCard: {
    borderRadius: 20, borderWidth: 1,
    padding: 28, alignItems: "center", gap: 10,
  },
  heroIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  heroSub: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 20,
  },

  detailCard: {
    borderRadius: 16, borderWidth: 1, overflow: "hidden",
  },
  detailHeading: {
    fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  rowLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
  rowValue: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  metricsRow: { flexDirection: "row", gap: 10 },
  metricPill: {
    borderRadius: 14, paddingVertical: 14, alignItems: "center",
  },
  metricVal: {
    fontSize: 24, fontWeight: "800", fontFamily: "Inter_700Bold",
  },
  metricLbl: {
    fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2,
    textTransform: "uppercase", letterSpacing: 0.5,
  },

  viewStationBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 18, paddingVertical: 15,
  },
  viewStationTxt: {
    flex: 1, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },

  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 15,
  },
  shareTxt: {
    fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },

  doneBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: "center",
  },
  doneTxt: {
    color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold",
  },

  reviewCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1.5,
    padding: 14,
  },
  reviewIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  reviewCardTitle: {
    fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  reviewCardSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16,
  },
  reviewCardBtn: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  reviewCardBtnTxt: {
    color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  reviewDismissBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },
});
