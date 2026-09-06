import React, { useMemo, useState, useRef } from "react";
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  ScrollView, Platform, TextInput, Linking, ActivityIndicator,
  KeyboardAvoidingView, Keyboard,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type Plan = {
  id: string;
  name: string;
  priceUsd: number;
  period: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  features: string[];
  highlight?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    period: "forever",
    color: "#64748b",
    icon: "flash-outline",
    features: [
      "Browse all community stations",
      "View real-time availability",
      "Read community reviews",
      "5 saved stations",
    ],
  },
  {
    id: "explorer",
    name: "Explorer",
    priceUsd: 4.99,
    period: "per month",
    color: "#3b82f6",
    icon: "compass-outline",
    features: [
      "Everything in Free",
      "Unlimited saved stations",
      "Gas price tracking",
      "Route planning",
      "Priority support",
    ],
    badge: "Popular",
  },
  {
    id: "driver",
    name: "Driver Pro",
    priceUsd: 9.99,
    period: "per month",
    color: "#13AE8F",
    icon: "car-sport-outline",
    features: [
      "Everything in Explorer",
      "Charging session history",
      "Cost analytics & reports",
      "Offline station maps",
      "Badge & profile recognition",
    ],
    highlight: true,
    badge: "Best Value",
  },
  {
    id: "fleet",
    name: "Fleet Pro",
    priceUsd: 19.99,
    period: "per month",
    color: "#8b5cf6",
    icon: "business-outline",
    features: [
      "Everything in Driver Pro",
      "Multi-vehicle management",
      "Fleet cost dashboards",
      "API access",
      "Dedicated account manager",
    ],
    badge: "Business",
  },
];

const COUNTRY_CURRENCY: Record<string, { currency: string; rate: number }> = {
  US: { currency: "USD", rate: 1 },
  GB: { currency: "GBP", rate: 0.79 },
  DE: { currency: "EUR", rate: 0.92 },
  FR: { currency: "EUR", rate: 0.92 },
  IT: { currency: "EUR", rate: 0.92 },
  ES: { currency: "EUR", rate: 0.92 },
  NL: { currency: "EUR", rate: 0.92 },
  CA: { currency: "CAD", rate: 1.36 },
  AU: { currency: "AUD", rate: 1.53 },
  JP: { currency: "JPY", rate: 157 },
  IN: { currency: "INR", rate: 83.5 },
  MX: { currency: "MXN", rate: 17.2 },
  BR: { currency: "BRL", rate: 5.0 },
  CH: { currency: "CHF", rate: 0.9 },
  SG: { currency: "SGD", rate: 1.34 },
  NZ: { currency: "NZD", rate: 1.63 },
  SE: { currency: "SEK", rate: 10.5 },
  NO: { currency: "NOK", rate: 10.6 },
  DK: { currency: "DKK", rate: 6.9 },
  HK: { currency: "HKD", rate: 7.8 },
  ZA: { currency: "ZAR", rate: 18.5 },
  AE: { currency: "AED", rate: 3.67 },
  PL: { currency: "PLN", rate: 3.9 },
  KR: { currency: "KRW", rate: 1350 },
};

function useLocalCurrency(): { currency: string; rate: number; locale: string } {
  return useMemo(() => {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split("-");
      const country = parts[parts.length - 1]?.toUpperCase() ?? "US";
      const found = COUNTRY_CURRENCY[country];
      return { currency: found?.currency ?? "USD", rate: found?.rate ?? 1, locale };
    } catch {
      return { currency: "USD", rate: 1, locale: "en-US" };
    }
  }, []);
}

function formatPrice(priceUsd: number, currency: string, rate: number, locale: string): string {
  if (priceUsd === 0) return "Free";
  const converted = priceUsd * rate;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: ["JPY", "KRW", "IDR", "VND"].includes(currency) ? 0 : 2,
      maximumFractionDigits: ["JPY", "KRW", "IDR", "VND"].includes(currency) ? 0 : 2,
    }).format(converted);
  } catch {
    return `$${priceUsd.toFixed(2)}`;
  }
}

type Stage = "plans" | "form" | "loading" | "success";

export function MembershipModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency, rate, locale } = useLocalCurrency();

  const [stage, setStage] = useState<Stage>("plans");
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);

  function handleClose() {
    setStage("plans");
    setSelectedPlan(null);
    setEmail("");
    setName("");
    setError(null);
    onClose();
  }

  function handleChoosePlan(plan: Plan) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (plan.priceUsd === 0) {
      // Free plan — no payment needed, just close
      handleClose();
      return;
    }
    setSelectedPlan(plan);
    setError(null);
    setStage("form");
  }

  async function handleSubmit() {
    if (!selectedPlan) return;
    const trimEmail = email.trim();
    const trimName = name.trim();
    if (!trimName) {
      setError("Please enter your full name.");
      return;
    }
    if (!trimEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setStage("loading");

    try {
      const resp = await fetch(`${BASE}/api/billing/checkout-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          priceUsd: selectedPlan.priceUsd,
          email: trimEmail,
          name: trimName,
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.url) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStage("form");
        return;
      }

      await Linking.openURL(data.url);
      setStage("success");
    } catch {
      setError("Network error. Check your connection and try again.");
      setStage("form");
    }
  }

  const renderContent = () => {
    if (stage === "loading") {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={selectedPlan?.color ?? "#0D9E7E"} />
          <Text style={[styles.loadingTxt, { color: colors.foreground }]}>
            Opening secure checkout…
          </Text>
          <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>
            You'll be redirected to complete your {selectedPlan?.name} membership
          </Text>
        </View>
      );
    }

    if (stage === "success") {
      return (
        <View style={styles.centered}>
          <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
            <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Checkout Opened!</Text>
          <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
            Complete your {selectedPlan?.name} membership in the browser. Check your email for a receipt once done.
          </Text>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: selectedPlan?.color ?? "#0D9E7E" }]}
            onPress={handleClose}
            activeOpacity={0.82}
          >
            <Text style={styles.doneBtnTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (stage === "form" && selectedPlan) {
      return (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Selected plan summary */}
            <View style={[styles.planSummary, { backgroundColor: selectedPlan.color + "15", borderColor: selectedPlan.color + "40" }]}>
              <View style={[styles.planSummaryIcon, { backgroundColor: selectedPlan.color + "20" }]}>
                <Ionicons name={selectedPlan.icon} size={22} color={selectedPlan.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planSummaryName, { color: colors.foreground }]}>
                  {selectedPlan.name}
                </Text>
                <Text style={[styles.planSummaryPrice, { color: selectedPlan.color }]}>
                  {formatPrice(selectedPlan.priceUsd, currency, rate, locale)}/{selectedPlan.period}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setStage("plans")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.changePlan, { color: colors.mutedForeground }]}>Change</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.formTitle, { color: colors.foreground }]}>Your details</Text>
            <Text style={[styles.formSub, { color: colors.mutedForeground }]}>
              You'll be taken to Stripe's secure checkout to complete payment.
            </Text>

            {/* Name field */}
            <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="user" size={16} color={colors.mutedForeground} style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Full name *"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                autoCapitalize="words"
                autoCorrect={false}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </View>

            {/* Email field */}
            <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="mail" size={16} color={colors.mutedForeground} style={{ marginRight: 10 }} />
              <TextInput
                ref={emailRef}
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Email address *"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                returnKeyType="done"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleSubmit}
              />
            </View>

            {error && (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={14} color="#ef4444" />
                <Text style={styles.errorTxt}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: selectedPlan.color }]}
              onPress={handleSubmit}
              activeOpacity={0.82}
            >
              <Feather name="lock" size={15} color="#fff" />
              <Text style={styles.submitBtnTxt}>
                Continue to Checkout — {formatPrice(selectedPlan.priceUsd, "USD", 1, "en-US")}/mo
              </Text>
            </TouchableOpacity>

            <View style={styles.secureRow}>
              <Feather name="shield" size={12} color={colors.mutedForeground} />
              <Text style={[styles.secureTxt, { color: colors.mutedForeground }]}>
                Secured by Stripe · Cancel anytime · No hidden fees
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }

    // Plans list (default)
    return (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.locRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="globe" size={14} color={colors.mutedForeground} />
          <Text style={[styles.locTxt, { color: colors.mutedForeground }]}>
            Showing prices in{" "}
            <Text style={{ fontWeight: "700", color: colors.foreground }}>{currency}</Text>
            {currency !== "USD" ? " · charges processed in USD" : ""}
          </Text>
        </View>

        {PLANS.map((plan) => {
          const price = formatPrice(plan.priceUsd, currency, rate, locale);
          const showUsd = currency !== "USD" && plan.priceUsd > 0;
          const isFree = plan.priceUsd === 0;

          return (
            <View
              key={plan.id}
              style={[
                styles.planCard,
                { backgroundColor: colors.card, borderColor: plan.highlight ? plan.color : colors.border },
                plan.highlight && styles.planCardHighlight,
              ]}
            >
              {plan.badge && (
                <View style={[styles.badge, { backgroundColor: plan.color }]}>
                  <Text style={styles.badgeTxt}>{plan.badge}</Text>
                </View>
              )}

              <View style={styles.planTop}>
                <View style={[styles.planIcon, { backgroundColor: plan.color + "20" }]}>
                  <Ionicons name={plan.icon} size={22} color={plan.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: plan.color }]}>{price}</Text>
                    {plan.priceUsd > 0 && (
                      <Text style={[styles.period, { color: colors.mutedForeground }]}>
                        /{plan.period}
                      </Text>
                    )}
                  </View>
                  {showUsd && (
                    <Text style={[styles.usdHint, { color: colors.mutedForeground }]}>
                      ≈ ${plan.priceUsd.toFixed(2)} USD/mo
                    </Text>
                  )}
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              {plan.features.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <Feather name="check" size={13} color={plan.color} />
                  <Text style={[styles.featureTxt, { color: colors.foreground }]}>{f}</Text>
                </View>
              ))}

              <TouchableOpacity
                style={[
                  styles.ctaBtn,
                  { backgroundColor: plan.highlight ? plan.color : isFree ? colors.muted : plan.color + "22" },
                ]}
                activeOpacity={0.82}
                onPress={() => handleChoosePlan(plan)}
              >
                {!isFree && (
                  <Feather
                    name="arrow-right-circle"
                    size={15}
                    color={plan.highlight ? "#fff" : plan.color}
                  />
                )}
                <Text
                  style={[
                    styles.ctaTxt,
                    { color: plan.highlight ? "#fff" : isFree ? colors.mutedForeground : plan.color },
                  ]}
                >
                  {isFree ? "Your Current Plan" : `Choose ${plan.name}`}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          Prices shown in local currency are approximate. Charges processed in USD via Stripe.
          Cancel anytime from your account settings.
        </Text>
      </ScrollView>
    );
  };

  const headerTitle =
    stage === "form" ? `Subscribe to ${selectedPlan?.name}` :
    stage === "loading" ? "Preparing Checkout" :
    stage === "success" ? "You're all set!" :
    "Membership Plans";

  const headerSub =
    stage === "form" ? "Enter your details to continue" :
    stage === "loading" ? "One moment…" :
    stage === "success" ? "Check your browser to complete payment" :
    `Prices shown in ${currency}${currency !== "USD" ? " · exchange rates approximate" : ""}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: colors.border, paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12 }]}>
          {stage === "form" ? (
            <TouchableOpacity
              onPress={() => { setStage("plans"); setError(null); }}
              style={[styles.backBtn, { backgroundColor: colors.muted }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="arrow-left" size={18} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 34 }} />
          )}
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{headerTitle}</Text>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {headerSub}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: colors.muted }]}>
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {renderContent()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center" },
  sheetSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1, textAlign: "center" },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },

  locRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 2,
  },
  locTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  planCard: { borderRadius: 18, borderWidth: 1.5, padding: 18, gap: 10 },
  planCardHighlight: { borderWidth: 2 },
  badge: {
    position: "absolute", top: -1, right: 16,
    paddingHorizontal: 10, paddingVertical: 4,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  badgeTxt: { fontSize: 10, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  planTop: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  planIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 3 },
  price: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  period: { fontSize: 12, fontFamily: "Inter_400Regular" },
  usdHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  ctaBtn: {
    marginTop: 4, borderRadius: 12, paddingVertical: 13,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 7,
  },
  ctaTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  disclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16, paddingHorizontal: 8 },

  // Form stage
  planSummary: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 4,
  },
  planSummaryIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  planSummaryName: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  planSummaryPrice: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  changePlan: { fontSize: 12, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },

  formTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  formSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 8 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#ef4444", flex: 1 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, paddingVertical: 15, marginTop: 4,
  },
  submitBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  secureRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 },
  secureTxt: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // Loading / success
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  loadingTxt: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  loadingSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  doneBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginTop: 8 },
  doneBtnTxt: { fontSize: 16, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});
