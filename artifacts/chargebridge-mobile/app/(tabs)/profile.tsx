import { useAuth, useUser } from "@clerk/expo";
import { useStripe } from "@stripe/stripe-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useGetMyReviews, useDeleteReview, getGetMyReviewsQueryKey, getGetStationReviewsQueryKey, useGetMeConnectorAffinity } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Platform, Share, Modal, Pressable,
  TextInput, Alert, Linking,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { track } from "@/lib/analytics";
import { useIsButtonEnabled } from "@/hooks/useButtonConfigs";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { WallpaperLayer } from "@/components/WallpaperPicker";
import { useWallpaper } from "@/contexts/WallpaperContext";
import { useOtaUpdate } from "@/contexts/OtaUpdateContext";
import { VehiclePickerModal, type Vehicle } from "@/components/VehiclePickerModal";
import { runAddCardFlow } from "@/utils/addCardFlow";
import { runAddVehicle, runEditVehicle, runDeleteVehicle, runSetPrimaryVehicle, addVehicleOnError, editVehicleOnError, setPrimaryVehicleOnError, SessionExpiredError } from "@/utils/vehicleMutations";
import { runUpdateReview } from "@/utils/reviewMutations";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface HistoryEntry {
  id: number;
  stationId: number | null;
  stationName: string;
  stationAddress: string | null;
  chargerType: string | null;
  kwh: number | null;
  amountCents: number | null;
  currency: string;
  chargedAt: string;
}

interface UserProfile {
  clerkId: string;
  email: string;
  name: string | null;
  createdAt: string;
  favoritesCount: number;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  connectorType: string | null;
  batteryKwh: number | null;
  rangePerCharge: number | null;
  fuelType: string | null;
  mpg: number | null;
}

interface UserVehicle {
  id: number;
  clerkUserId: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  connectorType: string | null;
  batteryKwh: number | null;
  rangePerCharge: number | null;
  fuelType: string | null;
  mpg: number | null;
  isPrimary: boolean;
  createdAt: string;
}

type PaymentMethod = {
  id: string;
  type: "card" | "bank" | "carrier";
  label: string;
  last4: string;
  subLabel: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function StatPill({ value, label, tint }: { value: string | number; label: string; tint: string }) {
  return (
    <View style={[SP.pill, { backgroundColor: tint + "15" }]}>
      <Text style={[SP.val, { color: tint }]}>{value}</Text>
      <Text style={[SP.lbl, { color: tint + "aa" }]}>{label}</Text>
    </View>
  );
}
const SP = StyleSheet.create({
  pill: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  val: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  lbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
});

function AddCardModal({ visible, onClose, onSave }: {
  visible: boolean; onClose: () => void; onSave: (m: PaymentMethod) => void;
}) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  // Reset state each time the modal opens so a stale error from a previous
  // attempt is never shown on a fresh open.  Critically, handleClose does NOT
  // call setError("") — clearing error there would wipe the message before the
  // user has a chance to read it if the parent closes the modal immediately
  // after a session-expiry error is surfaced.
  useEffect(() => {
    if (visible) {
      setError("");
      setLoading(false);
      setSessionExpired(false);
    }
  }, [visible]);

  function handleClose() { setLoading(false); onClose(); }

  async function openSheet() {
    await runAddCardFlow({
      getToken,
      createSetupIntent: async (token, email, name) => {
        const r = await fetch(`${BASE}/api/setup-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email, name }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "Setup failed"); }
        return r.json();
      },
      initPaymentSheet,
      presentPaymentSheet,
      fetchPaymentMethods: async (token) => {
        const pmRes = await fetch(`${BASE}/api/payment-methods`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return pmRes.ok ? pmRes.json() : { methods: [] };
      },
      onError: setError,
      onLoading: setLoading,
      onSave,
      onSessionExpired: (checkpoint) => {
        // Surface as an imperative Alert so the message is visible regardless of
        // keyboard state — a fixed-height sheet can be occluded by the software
        // keyboard, but an Alert always renders above everything.
        //
        // Checkpoint 2 fires AFTER presentPaymentSheet succeeded, so the card
        // was already saved.  Use wording that confirms this so the user does
        // not think they need to re-enter their card details.
        const message =
          checkpoint === 2
            ? "Card added, but session expired — please reopen this screen to see your updated payment methods."
            : "Your session has expired. Please sign in again to add a card.";
        Alert.alert("Session Expired", message);
        setSessionExpired(true);
      },
      trackEvent: track,
      hapticSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      email: clerkUser?.emailAddresses?.[0]?.emailAddress,
      name: clerkUser?.fullName ?? clerkUser?.firstName,
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={WM.backdrop} onPress={handleClose} />
      <View style={WM.sheet}>
        <View style={WM.handle} />
        <View style={WM.head}>
          <Text style={WM.title}>Add Card</Text>
          <TouchableOpacity onPress={handleClose} style={WM.closeBtn}>
            <Ionicons name="close" size={18} color="#6B6B6B" />
          </TouchableOpacity>
        </View>
        {/* ScrollView makes the error Text scrollable into view when the
            software keyboard is open and compresses the fixed-height sheet.
            This mirrors the pattern used in AddBankModal and
            CarrierBillingModal. keyboardShouldPersistTaps="handled" ensures
            the Add Card button remains tappable while the keyboard is up. */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={WM.body}
        >
          <View style={WM.cardArt}>
            <Ionicons name="card" size={28} color="#fff" />
            <Text style={WM.cardNum}>•••• •••• •••• ••••</Text>
            <View style={WM.cardRow}>
              <Text style={WM.cardSub}>CARDHOLDER</Text>
              <Text style={WM.cardSub}>MM/YY</Text>
            </View>
          </View>
          <View style={[CM.infoBox, { marginBottom: 20 }]}>
            <Ionicons name="shield-checkmark-outline" size={15} color="#0D9E7E" />
            <Text style={CM.infoTxt}>
              Card details are handled securely by Stripe — never stored on ChargeBridge servers.
            </Text>
          </View>
          {!!error && <Text style={[WM.error, { marginBottom: 12 }]}>{error}</Text>}
          {sessionExpired ? (
            <TouchableOpacity
              style={[WM.saveBtn, { backgroundColor: "#6B6B6B" }]}
              onPress={() => {
                handleClose();
                router.push({
                  pathname: "/(auth)/sign-in",
                  params: { returnTo: "addCard" },
                });
              }}
              activeOpacity={0.85}
            >
              <Text style={WM.saveTxt}>Sign In Again</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[WM.saveBtn, { opacity: loading ? 0.7 : 1 }]}
              onPress={openSheet}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={WM.saveTxt}>Add Card Securely</Text>}
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function AddBankModal({ visible, onClose, onSave }: {
  visible: boolean; onClose: () => void; onSave: (m: PaymentMethod) => void;
}) {
  const [bankName, setBankName] = useState("");
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acctType, setAcctType] = useState<"checking" | "savings">("checking");
  const [error, setError] = useState("");

  // Reset form state each time the modal opens so a stale error from a previous
  // attempt is never shown on a fresh open.  Critically, handleClose does NOT
  // call setError("") — clearing error there would wipe the message before the
  // user has a chance to read it if the parent closes the modal immediately
  // after a validation error is surfaced.
  useEffect(() => {
    if (visible) {
      setBankName(""); setRouting(""); setAccount(""); setConfirm("");
      setAcctType("checking"); setError("");
    }
  }, [visible]);

  function handleClose() { onClose(); }

  function save() {
    if (!bankName.trim()) { setError("Bank name is required"); return; }
    if (routing.length !== 9) { setError("Routing number must be 9 digits"); return; }
    if (account.length < 4) { setError("Enter a valid account number"); return; }
    if (account !== confirm) { setError("Account numbers don't match"); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({ id: Date.now().toString(), type: "bank", label: bankName.trim(), last4: account.slice(-4), subLabel: acctType.charAt(0).toUpperCase() + acctType.slice(1) + " •••• " + account.slice(-4) });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={WM.backdrop} onPress={handleClose} />
      <View style={WM.sheet}>
        <View style={WM.handle} />
        <View style={WM.head}>
          <Text style={WM.title}>Add Bank Account</Text>
          <TouchableOpacity onPress={handleClose} style={WM.closeBtn}><Ionicons name="close" size={18} color="#6B6B6B" /></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={WM.body}>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {(["checking", "savings"] as const).map(t => (
              <TouchableOpacity key={t} style={[WM.typeBtn, acctType === t && WM.typeBtnActive]} onPress={() => setAcctType(t)}>
                <Feather name={t === "checking" ? "credit-card" : "dollar-sign"} size={14} color={acctType === t ? "#0D9E7E" : "#6B6B6B"} />
                <Text style={[WM.typeTxt, acctType === t && WM.typeTxtActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {[
            { lbl: "Bank Name *", val: bankName, set: setBankName, ph: "Chase, Bank of America…", kb: "default" as any },
            { lbl: "Routing Number * (9 digits)", val: routing, set: setRouting, ph: "021000021", kb: "number-pad" as any, max: 9 },
            { lbl: "Account Number *", val: account, set: setAccount, ph: "Account number", kb: "number-pad" as any, sec: true },
            { lbl: "Confirm Account Number *", val: confirm, set: setConfirm, ph: "Re-enter account number", kb: "number-pad" as any, sec: true },
          ].map(f => (
            <View key={f.lbl} style={WM.field}>
              <Text style={WM.lbl}>{f.lbl}</Text>
              <TextInput style={WM.input} value={f.val} onChangeText={f.set} placeholder={f.ph} placeholderTextColor="#9AAFAF" keyboardType={f.kb} maxLength={(f as any).max} secureTextEntry={(f as any).sec} />
            </View>
          ))}
          {!!error && <Text style={WM.error}>{error}</Text>}
          <TouchableOpacity style={WM.saveBtn} onPress={save} activeOpacity={0.85}>
            <Text style={WM.saveTxt}>Link Bank Account</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const CARRIERS = ["AT&T", "Verizon", "T-Mobile", "Google Fi", "US Cellular", "Other"];

function CarrierBillingModal({ visible, onClose, onSave, prefillPhone }: {
  visible: boolean; onClose: () => void;
  onSave: (m: PaymentMethod) => void;
  prefillPhone?: string;
}) {
  const isIOS = Platform.OS === "ios";
  const walletLabel = isIOS ? "Apple Pay" : "Google Pay";
  const walletColor = isIOS ? "#000000" : "#4285F4";

  const { getToken } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState(prefillPhone ?? "");
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  // Reset form state each time the modal opens so a stale error from a previous
  // attempt is never shown on a fresh open.  Critically, handleClose does NOT
  // call setError("") — clearing error there would wipe the message before the
  // user has a chance to read it if the parent closes the modal immediately
  // after a network or validation error is surfaced.
  useEffect(() => {
    if (visible) {
      setStep("phone"); setPhone(prefillPhone ?? ""); setCarrier(CARRIERS[0]);
      setOtp(""); setSending(false); setError(""); setSessionExpired(false);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  function fmtPhone(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  // reset() is used only after a successful save so the form is clean if the
  // modal is reopened.  handleClose does NOT call reset() — that would wipe the
  // error before the user reads it.  The useEffect above handles fresh-open resets.
  function reset() {
    setStep("phone"); setPhone(prefillPhone ?? ""); setCarrier(CARRIERS[0]);
    setOtp(""); setSending(false); setError(""); setSessionExpired(false);
  }

  function handleClose() { onClose(); }

  async function sendCode() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit US phone number"); return; }
    setError("");
    setSending(true);
    // Session-expiry checkpoint: guard before the network call so an expired
    // session surfaces a clear error rather than a silent failure if auth is
    // required on this route.
    const token = await getToken();
    if (!token) {
      setError("Your session has expired. Please sign in again to verify your phone.");
      setSessionExpired(true);
      setSending(false);
      return;
    }
    try {
      const r = await fetch(`${BASE}/api/verify/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Failed to send code. Try again."); setSending(false); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("otp");
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setSending(false);
  }

  async function verify() {
    if (otp.replace(/\D/g, "").length < 6) { setError("Enter the 6-digit code"); return; }
    const digits = phone.replace(/\D/g, "");
    setError("");
    setSending(true);
    // Session-expiry checkpoint: guard before the network call so an expired
    // session surfaces a clear error rather than a silent failure if auth is
    // required on this route.
    const token = await getToken();
    if (!token) {
      setError("Your session has expired. Please sign in again to verify your phone.");
      setSessionExpired(true);
      setSending(false);
      return;
    }
    try {
      const r = await fetch(`${BASE}/api/verify/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, code: otp }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Incorrect code. Please try again."); setSending(false); return; }
      const last4 = digits.slice(-4);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSave({
        id: Date.now().toString(),
        type: "carrier",
        label: walletLabel,
        last4,
        subLabel: `${carrier} · •••-•••-${last4}`,
      });
      reset();
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setSending(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={WM.backdrop} onPress={handleClose} />
      <View style={WM.sheet}>
        <View style={WM.handle} />
        <View style={WM.head}>
          <Text style={WM.title}>Link {walletLabel} to Phone Bill</Text>
          <TouchableOpacity onPress={handleClose} style={WM.closeBtn}>
            <Ionicons name="close" size={18} color="#6B6B6B" />
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={WM.body}>
          {/* Hero badge */}
          <View style={[CM.heroBadge, { backgroundColor: walletColor + "12", borderColor: walletColor + "33" }]}>
            <View style={[CM.heroIcon, { backgroundColor: walletColor }]}>
              <Ionicons name={isIOS ? "logo-apple" : "logo-google"} size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[CM.heroTitle, { color: walletColor }]}>{walletLabel} Carrier Billing</Text>
              <Text style={CM.heroSub}>Charges will appear on your monthly phone bill</Text>
            </View>
          </View>

          {step === "phone" ? (
            <>
              <View style={WM.field}>
                <Text style={WM.lbl}>Mobile Phone Number *</Text>
                <TextInput
                  style={WM.input}
                  value={phone}
                  onChangeText={v => setPhone(fmtPhone(v))}
                  placeholder="(555) 000-0000"
                  placeholderTextColor="#9AAFAF"
                  keyboardType="phone-pad"
                  maxLength={14}
                />
              </View>

              <View style={WM.field}>
                <Text style={WM.lbl}>Carrier</Text>
                <View style={CM.carrierGrid}>
                  {CARRIERS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[CM.carrierChip, carrier === c && CM.carrierChipActive]}
                      onPress={() => setCarrier(c)}
                    >
                      <Text style={[CM.carrierTxt, carrier === c && CM.carrierTxtActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[CM.infoBox]}>
                <Ionicons name="information-circle-outline" size={15} color="#6B6B6B" />
                <Text style={CM.infoTxt}>
                  We'll send a one-time verification code to confirm your number is linked to a {carrier} account.
                </Text>
              </View>

              {!!error && <Text style={WM.error}>{error}</Text>}

              {sessionExpired ? (
                <TouchableOpacity
                  style={[WM.saveBtn, { backgroundColor: "#6B6B6B" }]}
                  onPress={() => { handleClose(); router.push("/(auth)/sign-in"); }}
                  activeOpacity={0.85}
                >
                  <Text style={WM.saveTxt}>Sign In Again</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[WM.saveBtn, { backgroundColor: walletColor, opacity: sending ? 0.7 : 1 }]}
                  onPress={sendCode}
                  disabled={sending}
                  activeOpacity={0.85}
                >
                  {sending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={WM.saveTxt}>Send Verification Code</Text>}
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <View style={[CM.sentBox]}>
                <Ionicons name="chatbubble-ellipses-outline" size={28} color="#0D9E7E" />
                <Text style={CM.sentTitle}>Code sent!</Text>
                <Text style={CM.sentSub}>
                  A 6-digit code was sent to{"\n"}<Text style={{ fontWeight: "700" }}>{phone}</Text>
                </Text>
              </View>

              <View style={WM.field}>
                <Text style={WM.lbl}>Verification Code *</Text>
                <TextInput
                  style={[WM.input, CM.otpInput]}
                  value={otp}
                  onChangeText={v => setOtp(v.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor="#9AAFAF"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              </View>

              {!!error && <Text style={WM.error}>{error}</Text>}

              {sessionExpired ? (
                <TouchableOpacity
                  style={[WM.saveBtn, { backgroundColor: "#6B6B6B" }]}
                  onPress={() => { handleClose(); router.push("/(auth)/sign-in"); }}
                  activeOpacity={0.85}
                >
                  <Text style={WM.saveTxt}>Sign In Again</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[WM.saveBtn, { backgroundColor: walletColor }]}
                  onPress={verify}
                  activeOpacity={0.85}
                >
                  <Text style={WM.saveTxt}>Verify & Link {walletLabel}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={CM.resendBtn}
                onPress={() => { setStep("phone"); setOtp(""); setError(""); }}
              >
                <Text style={CM.resendTxt}>Wrong number or resend code</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

interface VehicleCardProfile {
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | number | null;
  fuelType?: string | null;
  connectorType?: string | null;
  batteryKwh?: number | null;
  rangePerCharge?: number | null;
  mpg?: number | null;
}

function VehicleDisplayCard({ profile }: { profile: VehicleCardProfile }) {
  const colors = useColors();
  const isEV = !profile.fuelType || profile.fuelType === "electric";
  const fuelLabels: Record<string, string> = { regular: "Regular Gas", premium: "Premium Gas", diesel: "Diesel", hybrid: "Hybrid", e85: "E85 FlexFuel" };
  const fuelColors: Record<string, string> = { regular: "#f59e0b", premium: "#8b5cf6", diesel: "#0891b2", hybrid: "#0D9E7E", e85: "#22c55e" };
  const fuelEmojis: Record<string, string> = { regular: "⛽", premium: "⬛", diesel: "🔵", hybrid: "🔋", e85: "🌽" };
  const fuelLabel = profile.fuelType ? (fuelLabels[profile.fuelType] ?? profile.fuelType) : null;
  const fuelColor = profile.fuelType ? (fuelColors[profile.fuelType] ?? "#f59e0b") : colors.primary;
  const fuelEmoji = profile.fuelType ? (fuelEmojis[profile.fuelType] ?? "⛽") : "";
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: (isEV ? colors.primary : fuelColor) + "18", justifyContent: "center", alignItems: "center" }}>
          <Ionicons name={isEV ? "flash-outline" : "car-outline"} size={20} color={isEV ? colors.primary : fuelColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.foreground }}>
            {[profile.vehicleYear, profile.vehicleMake, profile.vehicleModel].filter(Boolean).join(" ")}
          </Text>
          {isEV && profile.connectorType ? (
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{profile.connectorType} connector</Text>
          ) : null}
          {!isEV && fuelLabel ? (
            <Text style={{ fontSize: 12, color: fuelColor, fontWeight: "600" }}>{fuelEmoji} {fuelLabel}</Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {isEV && profile.batteryKwh != null ? (
          <View style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, padding: 10 }}>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Battery</Text>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.foreground }}>{profile.batteryKwh} kWh</Text>
          </View>
        ) : null}
        {isEV && profile.rangePerCharge != null ? (
          <View style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, padding: 10 }}>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Range</Text>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.foreground }}>{profile.rangePerCharge} mi</Text>
          </View>
        ) : null}
        {!isEV && profile.mpg != null ? (
          <View style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, padding: 10 }}>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Fuel Economy</Text>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.foreground }}>{profile.mpg} MPG</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const CM = StyleSheet.create({
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  heroIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  heroTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  heroSub: { fontSize: 12, color: "#6B6B6B", fontFamily: "Inter_400Regular", lineHeight: 16 },
  carrierGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  carrierChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: "#D5D0C8", backgroundColor: "#F8F7F4" },
  carrierChipActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E14" },
  carrierTxt: { fontSize: 13, fontWeight: "600", color: "#6B6B6B", fontFamily: "Inter_600SemiBold" },
  carrierTxtActive: { color: "#0D9E7E" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F8F7F4", borderRadius: 10, padding: 12, marginBottom: 14 },
  infoTxt: { flex: 1, fontSize: 12, color: "#6B6B6B", fontFamily: "Inter_400Regular", lineHeight: 17 },
  sentBox: { alignItems: "center", paddingVertical: 20, gap: 8, marginBottom: 12 },
  sentTitle: { fontSize: 18, fontWeight: "700", color: "#1A2530", fontFamily: "Inter_700Bold" },
  sentSub: { fontSize: 14, color: "#6B6B6B", fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  otpInput: { fontSize: 24, letterSpacing: 8, textAlign: "center", fontWeight: "700" },
  resendBtn: { marginTop: 14, alignItems: "center" },
  resendTxt: { fontSize: 13, color: "#0D9E7E", fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});

const WM = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D5D0C8", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5E5" },
  title: { fontSize: 17, fontWeight: "700", color: "#1A2530", fontFamily: "Inter_700Bold" },
  closeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F3F3F3", alignItems: "center", justifyContent: "center" },
  body: { padding: 20, paddingBottom: 40 },
  cardArt: { backgroundColor: "#0D9E7E", borderRadius: 16, padding: 20, marginBottom: 20, gap: 10 },
  cardNum: { color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: 2 },
  cardRow: { flexDirection: "row", justifyContent: "space-between" },
  cardSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" },
  field: { marginBottom: 14 },
  lbl: { fontSize: 13, fontWeight: "600", color: "#1A2530", marginBottom: 6 },
  input: { backgroundColor: "#F8F7F4", borderWidth: 1, borderColor: "#D5D0C8", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: "#1A2530" },
  error: { color: "#EF4444", fontSize: 13, marginBottom: 10, textAlign: "center" },
  saveBtn: { backgroundColor: "#0D9E7E", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  saveTxt: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: "#D5D0C8", backgroundColor: "#F8F7F4" },
  typeBtnActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E12" },
  typeTxt: { fontSize: 14, fontWeight: "600", color: "#6B6B6B" },
  typeTxtActive: { color: "#0D9E7E" },
});

export default function ProfileTab() {
  const { isSignedIn, signOut, getToken, sessionClaims } = useAuth();
  const isAdmin = (sessionClaims?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { user } = useUser();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const wallpaper = useWallpaper("profile");
  const { updateAvailable: otaUpdateAvailable, pendingReload: otaPendingReload } = useOtaUpdate();
  const showOtaBadge = otaUpdateAvailable || otaPendingReload;
  const showHomeBtn = useIsButtonEnabled("mobile_header_home_button");
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const topPad = isWeb ? 67 : insets.top;

  // ── Cross-device profile sync ─────────────────────────────────────────────
  const SYNC_LAST_KEY = "@chargebridge/profile_last_sync";
  const DEVICE_ID_KEY = "@chargebridge/profile_device_id";
  const syncCheckRunning = useRef(false);

  async function checkProfileSync() {
    if (!isSignedIn || syncCheckRunning.current) return;
    syncCheckRunning.current = true;
    try {
      await user?.reload();
      let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      }
      const lastSync = await AsyncStorage.getItem(SYNC_LAST_KEY);
      if (!lastSync) {
        await AsyncStorage.setItem(SYNC_LAST_KEY, new Date().toISOString());
        syncCheckRunning.current = false;
        return;
      }
      const token = await getToken();
      if (!token) {
        track("profile_sync_no_token", {});
        syncCheckRunning.current = false;
        return;
      }
      const res = await fetch(
        `${BASE}/api/me/changes?since=${encodeURIComponent(lastSync)}&deviceId=${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) { syncCheckRunning.current = false; return; }
      const changes: Array<{ id: number; changedAt: string; deviceType: string; fieldGroup: string; changeSummary: { action: string; label: string } }> = await res.json();
      if (changes.length > 0) {
        const labels = changes.map(c => `• ${c.changeSummary.label}`).slice(0, 5).join("\n");
        const more = changes.length > 5 ? `\n…and ${changes.length - 5} more change${changes.length > 6 ? "s" : ""}` : "";
        Alert.alert(
          "Profile Updated on Another Device",
          `Your profile was updated while you were away:\n\n${labels}${more}`,
          [{
            text: "Got it",
            onPress: async () => {
              try { await AsyncStorage.setItem(SYNC_LAST_KEY, new Date().toISOString()); } catch {}
            },
          }]
        );
      } else {
        await AsyncStorage.setItem(SYNC_LAST_KEY, new Date().toISOString());
      }
    } catch {} finally {
      syncCheckRunning.current = false;
    }
  }

  // Signed-out state is handled by the early return below (line ~1743) which
  // renders a sign-in prompt instead of redirecting.  All auth-gated queries
  // already carry `enabled: isSignedIn === true` so no 401s fire while signed out.

  useFocusEffect(
    useCallback(() => {
      track("screen_viewed", { screen_name: "account" });
    }, []),
  );

  // ── [DIAG] Runtime Clerk key check — fires once on mount ─────────────────
  // Confirms whether EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is present in the
  // production bundle and which Clerk instance issued the current session JWT.
  useEffect(() => {
    const pk = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const iss = (sessionClaims as Record<string, unknown>)?.iss ?? null;
    console.log("[Profile][Clerk] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY present:", !!pk, "— prefix:", pk ? pk.substring(0, 15) : "MISSING");
    console.log("[Profile][Clerk] session JWT issuer (iss):", iss);
    console.log("[Profile][Clerk] isSignedIn:", isSignedIn);
    track("profile_clerk_runtime_check", {
      key_present: !!pk,
      key_is_test: pk?.startsWith("pk_test_") ?? false,
      key_is_live: pk?.startsWith("pk_live_") ?? false,
      session_iss: iss,
      is_signed_in: isSignedIn,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) checkProfileSync();
    }, [isSignedIn])
  );

  // ── Post-auth deep return: re-open Add Card / vehicle form ───────────────
  // When the user taps "Sign In Again" from a session-expiry path, sign-in.tsx
  // navigates here with a param indicating which flow to resume after auth.
  // Ref guards ensure each form opens only once even if the component re-renders
  // before the user closes it.
  const { openAddCard, openEditVehicle, openAddVehicle } = useLocalSearchParams<{
    openAddCard?: string;
    openEditVehicle?: string;
    openAddVehicle?: string;
  }>();
  const openAddCardHandled = useRef(false);
  const openEditVehicleHandled = useRef(false);
  const openAddVehicleHandled = useRef(false);

  const [showCardModal, setShowCardModal] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showCarrierModal, setShowCarrierModal] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [versionTapCount, setVersionTapCount] = useState(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleVersionTap() {
    const next = versionTapCount + 1;
    setVersionTapCount(next);
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (next >= 5) {
      setVersionTapCount(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push("/build-info" as any);
    } else {
      Haptics.selectionAsync();
      versionTapTimer.current = setTimeout(() => setVersionTapCount(0), 2000);
    }
  }

  const queryClient = useQueryClient();
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null);
  const [addVehicleSessionExpired, setAddVehicleSessionExpired] = useState(false);
  const [editVehicleSessionExpired, setEditVehicleSessionExpired] = useState(false);
  const [setPrimarySessionExpiredId, setSetPrimarySessionExpiredId] = useState<number | null>(null);
  const [deleteSessionExpiredId, setDeleteSessionExpiredId] = useState<number | null>(null);
  const [vehicleFormNew, setVehicleFormNew] = useState({ make: "", model: "", year: "", connectorType: "", batteryKwh: "", rangePerCharge: "", nickname: "", fuelType: "electric" });
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [editRating, setEditRating] = useState(5);
  const [editComment, setEditComment] = useState("");
  const [reviewEditSessionExpired, setReviewEditSessionExpired] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [histFiltersVisible, setHistFiltersVisible] = useState(false);
  const [histSearchInput, setHistSearchInput] = useState("");
  const [histFrom, setHistFrom] = useState<Date | null>(null);
  const [histTo, setHistTo] = useState<Date | null>(null);
  const [monthPickerMode, setMonthPickerMode] = useState<"from" | "to" | null>(null);
  const [vehicleForm, setVehicleForm] = useState({ vehicleMake: "", vehicleModel: "", vehicleYear: "", connectorType: "", batteryKwh: "", rangePerCharge: "", fuelType: "electric", mpg: "" });

  type LocalVehicle = { vehicleMake: string | null; vehicleModel: string | null; vehicleYear: string | null; connectorType: string | null; batteryKwh: number | null; rangePerCharge: number | null; fuelType: string | null; mpg: number | null };
  const VEHICLE_KEY = "@chargebridge/vehicle";
  // Keys used to persist pending vehicle form data across the re-auth round-trip.
  // Written before navigating to sign-in; read and cleared once the user returns.
  const PENDING_VEHICLE_FORM_KEY = "@chargebridge/pending_vehicle_form";
  const PENDING_VEHICLE_ID_KEY = "@chargebridge/pending_vehicle_id";
  const [localVehicle, setLocalVehicle] = useState<LocalVehicle | null>(null);

  const [savedDriverName, setSavedDriverName] = useState<string>("");
  const [savedDriverEmail, setSavedDriverEmail] = useState<string>("");
  const [editingSavedDetails, setEditingSavedDetails] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");

  // Navigation Voice settings (shared AsyncStorage keys with map.tsx)
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [navVoiceId, setNavVoiceId] = useState<string | null>(null);
  const [navVoiceName, setNavVoiceName] = useState("Auto (Female)");
  const [navLanguage, setNavLanguage] = useState("en-US");
  const [availableVoices, setAvailableVoices] = useState<Speech.Voice[]>([]);
  const [navVoiceRate, setNavVoiceRate] = useState(0.88);
  const [navVoiceLevel, setNavVoiceLevel] = useState<"quiet" | "normal" | "verbose">("normal");
  const [navVoiceVolume, setNavVoiceVolume] = useState(1.0);
  const [navVoiceMuted, setNavVoiceMuted] = useState(false);

  // Open the Add Card modal automatically when the user returns here after
  // re-authenticating via the session-expiry "Sign In Again" path.
  // The ref guard ensures the modal opens only once even if the component
  // re-renders (e.g. from profile-sync) before the user closes it.
  useEffect(() => {
    if (openAddCard === "1" && isSignedIn && !openAddCardHandled.current) {
      openAddCardHandled.current = true;
      setShowCardModal(true);
    }
  }, [openAddCard, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore a pending Edit Vehicle form after the user re-authenticates.
  // The pending form and vehicle ID were saved to AsyncStorage before navigating
  // to sign-in so no data is lost across the re-auth round-trip.
  useEffect(() => {
    if (openEditVehicle === "1" && isSignedIn && !openEditVehicleHandled.current) {
      openEditVehicleHandled.current = true;
      Promise.all([
        AsyncStorage.getItem(PENDING_VEHICLE_FORM_KEY),
        AsyncStorage.getItem(PENDING_VEHICLE_ID_KEY),
      ]).then(([formJson, idStr]) => {
        if (formJson) {
          try {
            const form = JSON.parse(formJson);
            setVehicleFormNew(form);
            const vehicleId = idStr ? parseInt(idStr, 10) : null;
            if (vehicleId != null && !isNaN(vehicleId)) setEditingVehicleId(vehicleId);
            setEditVehicleSessionExpired(false);
            setAddingVehicle(false);
          } catch {}
          AsyncStorage.multiRemove([PENDING_VEHICLE_FORM_KEY, PENDING_VEHICLE_ID_KEY]).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [openEditVehicle, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore a pending Add Vehicle form after the user re-authenticates.
  useEffect(() => {
    if (openAddVehicle === "1" && isSignedIn && !openAddVehicleHandled.current) {
      openAddVehicleHandled.current = true;
      AsyncStorage.getItem(PENDING_VEHICLE_FORM_KEY).then((formJson) => {
        if (formJson) {
          try {
            const form = JSON.parse(formJson);
            setVehicleFormNew(form);
            setEditingVehicleId(null);
            setAddVehicleSessionExpired(false);
            setAddingVehicle(true);
          } catch {}
          AsyncStorage.removeItem(PENDING_VEHICLE_FORM_KEY).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [openAddVehicle, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    AsyncStorage.getItem(VEHICLE_KEY).then(v => {
      if (v) { try { setLocalVehicle(JSON.parse(v)); } catch {} }
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      AsyncStorage.multiGet(["@chargebridge/driver_name", "@chargebridge/driver_email"]).then((pairs) => {
        setSavedDriverName(pairs[0][1] ?? "");
        setSavedDriverEmail(pairs[1][1] ?? "");
      });
    }
  }, [isSignedIn]);

  useEffect(() => {
    AsyncStorage.multiGet(["@chargebridge/nav_language", "@chargebridge/nav_voice_id", "@chargebridge/nav_voice_rate", "@chargebridge/nav_voice_level", "@chargebridge/nav_voice_volume", "@chargebridge/nav_voice_muted"]).then((pairs) => {
      const lang = pairs[0][1];
      const voiceId = pairs[1][1];
      const rate = parseFloat(pairs[2][1] ?? "");
      const level = pairs[3][1];
      const vol = parseFloat(pairs[4][1] ?? "");
      const muted = pairs[5][1];
      if (lang) setNavLanguage(lang);
      if (voiceId) setNavVoiceId(voiceId);
      if (!isNaN(rate) && rate > 0) setNavVoiceRate(rate);
      if (level === "quiet" || level === "normal" || level === "verbose") setNavVoiceLevel(level);
      if (!isNaN(vol) && vol >= 0 && vol <= 1) setNavVoiceVolume(vol);
      if (muted === "1") setNavVoiceMuted(true);
    }).catch(() => {});
    Speech.getAvailableVoicesAsync().then((voices) => {
      setAvailableVoices(voices);
      AsyncStorage.getItem("@chargebridge/nav_voice_id").then((voiceId) => {
        if (voiceId) {
          const found = voices.find((v) => v.identifier === voiceId);
          if (found) setNavVoiceName(found.name);
        }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  function startEditSavedDetails() {
    setDraftName(savedDriverName);
    setDraftEmail(savedDriverEmail);
    setEditingSavedDetails(true);
  }

  async function saveSavedDetails() {
    const nameTrimmed = draftName.trim();
    const emailTrimmed = draftEmail.trim();
    if (nameTrimmed) {
      await AsyncStorage.setItem("@chargebridge/driver_name", nameTrimmed);
    } else {
      await AsyncStorage.removeItem("@chargebridge/driver_name");
    }
    if (emailTrimmed) {
      await AsyncStorage.setItem("@chargebridge/driver_email", emailTrimmed);
    } else {
      await AsyncStorage.removeItem("@chargebridge/driver_email");
    }
    setSavedDriverName(nameTrimmed);
    setSavedDriverEmail(emailTrimmed);
    setEditingSavedDetails(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function clearSavedDetails() {
    await AsyncStorage.multiRemove(["@chargebridge/driver_name", "@chargebridge/driver_email"]);
    setSavedDriverName("");
    setSavedDriverEmail("");
    setDraftName("");
    setDraftEmail("");
    setEditingSavedDetails(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const patchVehicle = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      // ── [DIAG] Step 1: entry ──────────────────────────────────────────────
      console.log("[Profile][PatchProfile] mutationFn entered — isSignedIn:", isSignedIn);
      track("profile_patchprofile_started", { is_signed_in: isSignedIn });

      // ── [DIAG] Step 2: token acquisition ─────────────────────────────────
      let token: string | null = null;
      try {
        token = await getToken();
      } catch (tokenErr) {
        const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        console.warn("[Profile][PatchProfile] getToken() threw:", msg);
        track("profile_patchprofile_token_error", { error: msg });
        throw tokenErr;
      }
      console.log("[Profile][PatchProfile] getToken() result — token present:", !!token, "isSignedIn:", isSignedIn);
      track("profile_patchprofile_token_result", {
        token_present: !!token,
        is_signed_in: isSignedIn,
        session_iss: (sessionClaims as Record<string, unknown>)?.iss ?? null,
      });

      if (!token) {
        console.warn("[Profile][PatchProfile] No token — aborting to avoid silent 401");
        track("profile_patchprofile_no_token", { is_signed_in: isSignedIn });
        throw new Error("Your session has expired. Please sign in again to save changes.");
      }

      // ── [DIAG] Step 3: request ────────────────────────────────────────────
      console.log("[Profile][PatchProfile] PATCH /api/me — auth_header_present: true");
      track("profile_patchprofile_request", { auth_header_present: true });

      let res: Response;
      try {
        res = await fetch(`${BASE}/api/me`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(data),
        });
      } catch (netErr) {
        const msg = netErr instanceof Error ? netErr.message : String(netErr);
        console.warn("[Profile][PatchProfile] fetch threw (network error):", msg);
        track("profile_patchprofile_network_error", { error: msg });
        throw new Error("Check your connection and try again.");
      }

      // ── [DIAG] Step 4: response ───────────────────────────────────────────
      console.log("[Profile][PatchProfile] PATCH /api/me ←", res.status, res.ok ? "ok" : "FAILED");
      track("profile_patchprofile_response", { status: res.status, ok: res.ok });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "unreadable" }));
        console.warn("[Profile][PatchProfile] FAILED:", res.status, JSON.stringify(errBody));
        track("profile_patchprofile_failed", { status: res.status, error_text: errBody.error ?? "unknown" });
        throw new Error(errBody.error ?? "Save failed");
      }

      const result = await res.json();
      console.log("[Profile][PatchProfile] success");
      track("profile_patchprofile_complete", {});
      return result;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["profile"] }); setEditingVehicle(false); },
    onError: (err: Error) => {
      Alert.alert("Couldn't Save Profile", err.message ?? "Something went wrong. Please try again.");
    },
  });

  const VQ = ["vehicles"] as const;

  const addVehicleMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      new Promise<unknown>((resolve, reject) =>
        runAddVehicle(data, {
          getToken,
          postVehicle: async (token, vehicleData) => {
            console.log("[Profile][AddVehicle] POST /api/me/vehicles — make:", vehicleData.make ?? null);
            let res: Response;
            try {
              res = await fetch(`${BASE}/api/me/vehicles`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(vehicleData),
              });
            } catch {
              throw new Error("Check your connection and try again.");
            }
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({ error: "unreadable" }));
              throw new Error(errBody.error ?? "Save failed");
            }
            return res.json();
          },
          onSuccess: resolve,
          onError: reject,
          onSessionExpired: () => {
            setAddVehicleSessionExpired(true);
            // Persist the in-progress form data so it survives the re-auth
            // round-trip.  The useEffect that watches openAddVehicle will restore
            // it once the user signs back in.
            AsyncStorage.setItem(PENDING_VEHICLE_FORM_KEY, JSON.stringify(vehicleFormNew)).catch(() => {});
            Alert.alert(
              "Session Expired",
              "Your session has expired. Please sign in again to add a vehicle.",
              [
                { text: "Later", style: "cancel" },
                {
                  text: "Sign In Again",
                  onPress: () => router.push({
                    pathname: "/(auth)/sign-in",
                    params: { returnTo: "addVehicle" },
                  }),
                },
              ],
            );
          },
          track: (event, props) => track(event, { ...props, is_signed_in: isSignedIn }),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VQ });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setAddingVehicle(false);
      setAddVehicleSessionExpired(false);
      setVehicleFormNew({ make: "", model: "", year: "", connectorType: "", batteryKwh: "", rangePerCharge: "", nickname: "", fuelType: "electric" });
      // Remove any pending-form keys left over from a previous session-expiry
      // round-trip so they can't bleed into a future Add Vehicle flow.
      AsyncStorage.multiRemove([PENDING_VEHICLE_FORM_KEY, PENDING_VEHICLE_ID_KEY]).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => addVehicleOnError(err, Alert.alert),
  });

  const editVehicleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      new Promise<unknown>((resolve, reject) =>
        runEditVehicle(id, data, {
          getToken,
          patchVehicle: async (token, vehicleId, vehicleData) => {
            console.log("[Profile][EditVehicle] PATCH /api/me/vehicles/:id — id:", vehicleId);
            let res: Response;
            try {
              res = await fetch(`${BASE}/api/me/vehicles/${vehicleId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(vehicleData),
              });
            } catch {
              throw new Error("Check your connection and try again.");
            }
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({ error: "unreadable" }));
              throw new Error(errBody.error ?? "Failed to update vehicle");
            }
            return res.json();
          },
          onSuccess: resolve,
          onError: reject,
          onSessionExpired: () => {
            setEditVehicleSessionExpired(true);
            // Persist the in-progress form data and the vehicle ID so they
            // survive the re-auth round-trip.  The useEffect that watches
            // openEditVehicle will restore them once the user signs back in.
            AsyncStorage.setItem(PENDING_VEHICLE_FORM_KEY, JSON.stringify(vehicleFormNew)).catch(() => {});
            if (editingVehicleId != null) {
              AsyncStorage.setItem(PENDING_VEHICLE_ID_KEY, String(editingVehicleId)).catch(() => {});
            }
            Alert.alert(
              "Session Expired",
              "Your session has expired. Please sign in again to save vehicle changes.",
              [
                { text: "Later", style: "cancel" },
                {
                  text: "Sign In Again",
                  onPress: () => router.push({
                    pathname: "/(auth)/sign-in",
                    params: { returnTo: "editVehicle" },
                  }),
                },
              ],
            );
          },
          track: (event, props) => track(event, { ...props, is_signed_in: isSignedIn }),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VQ });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setEditingVehicleId(null);
      setEditVehicleSessionExpired(false);
      // Remove any pending-form keys left over from a previous session-expiry
      // round-trip so they can't bleed into a future Edit Vehicle flow.
      AsyncStorage.multiRemove([PENDING_VEHICLE_FORM_KEY, PENDING_VEHICLE_ID_KEY]).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => editVehicleOnError(err, Alert.alert),
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: (id: number) =>
      new Promise<void>((resolve, reject) =>
        runDeleteVehicle(id, {
          getToken,
          deleteVehicle: async (token, vehicleId) => {
            console.log("[Profile][DeleteVehicle] DELETE /api/me/vehicles/:id — auth_header_present: true, id:", vehicleId);
            let res: Response;
            try {
              res = await fetch(`${BASE}/api/me/vehicles/${vehicleId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
            } catch {
              throw new Error("Check your connection and try again.");
            }
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({ error: "unreadable" }));
              throw new Error(errBody.error ?? "Failed to delete vehicle");
            }
          },
          onSuccess: resolve,
          onError: reject,
          onSessionExpired: () => {
            setDeleteSessionExpiredId(id);
            Alert.alert(
              "Session Expired",
              "Your session has expired. Please sign in again to remove vehicles.",
              [
                { text: "Later", style: "cancel" },
                { text: "Sign In Again", onPress: () => router.push("/(auth)/sign-in") },
              ],
            );
          },
          track: (event, props) => track(event, { ...props, is_signed_in: isSignedIn }),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VQ });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setDeleteSessionExpiredId(null);
    },
    onError: (err: Error) => {
      // The onSessionExpired callback already showed a dedicated "Session
      // Expired" alert with a "Sign In Again" button — suppress the generic
      // alert so the user never sees two consecutive dialogs.
      if (err instanceof SessionExpiredError) return;
      Alert.alert("Couldn't Remove Vehicle", err.message ?? "Something went wrong. Please try again.");
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (id: number) =>
      new Promise<unknown>((resolve, reject) =>
        runSetPrimaryVehicle(id, {
          getToken,
          setPrimaryVehicle: async (token, vehicleId) => {
            console.log("[Profile][SetPrimary] POST /api/me/vehicles/:id/primary — auth_header_present: true, id:", vehicleId);
            track("profile_setprimary_request", { auth_header_present: true, vehicle_id: vehicleId, is_signed_in: isSignedIn });
            let res: Response;
            try {
              res = await fetch(`${BASE}/api/me/vehicles/${vehicleId}/primary`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              });
            } catch (netErr) {
              const msg = netErr instanceof Error ? netErr.message : String(netErr);
              console.warn("[Profile][SetPrimary] fetch threw (network error):", msg);
              track("profile_setprimary_network_error", { error: msg });
              throw new Error("Check your connection and try again.");
            }
            console.log("[Profile][SetPrimary] POST /api/me/vehicles/:id/primary ←", res.status, res.ok ? "ok" : "FAILED");
            track("profile_setprimary_response", { status: res.status, ok: res.ok });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({ error: "unreadable" }));
              console.warn("[Profile][SetPrimary] FAILED:", res.status, JSON.stringify(errBody));
              track("profile_setprimary_api_error", { status: res.status, error_text: errBody.error ?? "unknown" });
              throw new Error(errBody.error ?? "Failed to set primary vehicle");
            }
            return res.json();
          },
          onSuccess: resolve,
          onError: reject,
          onSessionExpired: () => {
            setSetPrimarySessionExpiredId(id);
            Alert.alert(
              "Session Expired",
              "Your session has expired. Please sign in again to update your primary vehicle.",
              [
                { text: "Later", style: "cancel" },
                { text: "Sign In Again", onPress: () => router.push("/(auth)/sign-in") },
              ],
            );
          },
          track: (event, props) => track(event, { ...props, is_signed_in: isSignedIn }),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VQ });
      setSetPrimarySessionExpiredId(null);
      Haptics.selectionAsync();
    },
    onError: (err: Error) => {
      // Delegates to the exported setPrimaryVehicleOnError so the
      // instanceof SessionExpiredError guard is defined in one place and
      // can be unit-tested without a React render environment.
      setPrimaryVehicleOnError(err, Alert.alert.bind(Alert));
    },
  });

  function startAddVehicle() {
    setVehicleFormNew({ make: "", model: "", year: "", connectorType: "", batteryKwh: "", rangePerCharge: "", nickname: "", fuelType: "electric" });
    setEditingVehicleId(null);
    setAddVehicleSessionExpired(false);
    setAddingVehicle(true);
  }

  function startEditVehicleItem(v: UserVehicle) {
    setVehicleFormNew({
      make: v.make ?? "",
      model: v.model ?? "",
      year: v.year ?? "",
      connectorType: v.connectorType ?? "",
      batteryKwh: v.batteryKwh != null ? String(v.batteryKwh) : "",
      rangePerCharge: v.rangePerCharge != null ? String(v.rangePerCharge) : "",
      nickname: v.nickname ?? "",
      fuelType: v.fuelType ?? "electric",
    });
    setEditingVehicleId(v.id);
    setEditVehicleSessionExpired(false);
    setAddingVehicle(false);
  }

  async function submitVehicleForm() {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    const isEV = !vehicleFormNew.fuelType || vehicleFormNew.fuelType === "electric";
    const mpgRaw = (vehicleFormNew as any).mpg;
    const payload = {
      make: vehicleFormNew.make || null,
      model: vehicleFormNew.model || null,
      year: vehicleFormNew.year || null,
      connectorType: isEV ? (vehicleFormNew.connectorType || null) : null,
      batteryKwh: isEV && vehicleFormNew.batteryKwh ? parseFloat(vehicleFormNew.batteryKwh) : null,
      rangePerCharge: isEV && vehicleFormNew.rangePerCharge ? parseFloat(vehicleFormNew.rangePerCharge) : null,
      nickname: vehicleFormNew.nickname || null,
      fuelType: vehicleFormNew.fuelType || "electric",
      mpg: !isEV && mpgRaw ? parseFloat(mpgRaw) : null,
      _deviceId: deviceId,
      _deviceType: "mobile",
    };
    if (editingVehicleId != null) {
      editVehicleMutation.mutate({ id: editingVehicleId, data: payload });
    } else {
      addVehicleMutation.mutate(payload);
    }
  }

  function confirmDeleteVehicle(v: UserVehicle) {
    Alert.alert(
      "Remove Vehicle",
      `Remove ${[v.year, v.make, v.model].filter(Boolean).join(" ") || "this vehicle"}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => deleteVehicleMutation.mutate(v.id) },
      ]
    );
  }

  function startEditVehicle() {
    setVehicleForm({
      vehicleMake: effectiveVehicle?.vehicleMake ?? "",
      vehicleModel: effectiveVehicle?.vehicleModel ?? "",
      vehicleYear: effectiveVehicle?.vehicleYear ?? "",
      connectorType: effectiveVehicle?.connectorType ?? "",
      batteryKwh: effectiveVehicle?.batteryKwh != null ? String(effectiveVehicle.batteryKwh) : "",
      rangePerCharge: effectiveVehicle?.rangePerCharge != null ? String(effectiveVehicle.rangePerCharge) : "",
      fuelType: effectiveVehicle?.fuelType ?? "electric",
      mpg: effectiveVehicle?.mpg != null ? String(effectiveVehicle.mpg) : "",
    });
    setEditingVehicle(true);
  }

  function saveVehicle() {
    const isElectric = !vehicleForm.fuelType || vehicleForm.fuelType === "electric";
    const data: LocalVehicle = {
      vehicleMake: vehicleForm.vehicleMake || null,
      vehicleModel: vehicleForm.vehicleModel || null,
      vehicleYear: vehicleForm.vehicleYear || null,
      connectorType: isElectric ? (vehicleForm.connectorType || null) : null,
      batteryKwh: isElectric && vehicleForm.batteryKwh ? parseFloat(vehicleForm.batteryKwh) : null,
      rangePerCharge: isElectric && vehicleForm.rangePerCharge ? parseFloat(vehicleForm.rangePerCharge) : null,
      fuelType: vehicleForm.fuelType || null,
      mpg: vehicleForm.mpg ? parseFloat(vehicleForm.mpg) : null,
    };
    AsyncStorage.setItem(VEHICLE_KEY, JSON.stringify(data));
    setLocalVehicle(data);
    if (isSignedIn) patchVehicle.mutate(data);
    setEditingVehicle(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleVehicleSelect(v: Vehicle) {
    const isEV = v.fuelCategory === "electric";
    const isHybrid = v.fuelCategory === "phev_hybrid";
    if (isSignedIn && (addingVehicle || editingVehicleId != null)) {
      setVehicleFormNew((f) => ({
        ...f,
        make: v.make,
        model: v.model,
        year: v.yearRange,
        connectorType: isEV ? (v.dcConnector ?? v.acConnector ?? "") : (isHybrid && v.acConnector ? v.acConnector : ""),
        batteryKwh: "",
        rangePerCharge: "",
      }));
    } else {
      setVehicleForm((f) => ({
        ...f,
        vehicleMake: v.make,
        vehicleModel: v.model,
        vehicleYear: v.yearRange,
        connectorType: isEV ? (v.dcConnector ?? v.acConnector ?? "") : (isHybrid && v.acConnector ? v.acConnector : ""),
        batteryKwh: "",
        rangePerCharge: "",
        fuelType: isEV ? "electric" : (v.fuelType ?? "regular"),
        mpg: v.typicalMpg != null ? String(v.typicalMpg) : "",
      }));
    }
    setVehiclePickerOpen(false);
  }
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    () => (user?.unsafeMetadata?.paymentMethods as PaymentMethod[] | undefined) ?? []
  );

  // Sync payment methods from Clerk when user loads or changes (fixes stale init when Clerk loads late)
  useEffect(() => {
    if (!user) return;
    const clerkMethods = (user.unsafeMetadata?.paymentMethods as PaymentMethod[] | undefined) ?? [];
    setPaymentMethods(clerkMethods);
  }, [user?.id]);

  // Invalidate all cached queries when the logged-in user changes so stale data never leaks between accounts
  const prevUserIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevUserIdRef.current !== undefined && user?.id !== prevUserIdRef.current) {
      queryClient.removeQueries();
    }
    prevUserIdRef.current = user?.id;
  }, [user?.id]);

  const meta = user?.unsafeMetadata as Record<string, any> | undefined;
  const address = meta?.address as Record<string, string> | undefined;

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["profile"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        track("profile_query_no_token", {});
        throw new Error("Session expired — please sign in again.");
      }
      const res = await fetch(`${BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: isSignedIn === true,
  });

  const {
    data: vehiclesList = [],
    isError: vehiclesIsError,
    error: vehiclesError,
    refetch: refetchVehicles,
  } = useQuery<UserVehicle[]>({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        track("vehicles_query_no_token", {});
        throw new Error("Session expired — please sign in again.");
      }
      const res = await fetch(`${BASE}/api/me/vehicles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rawText = await res.text();
      if (!res.ok) {
        let body: any = {};
        try { body = JSON.parse(rawText); } catch {}
        throw new Error(body.error ?? `Failed to load vehicles (${res.status})`);
      }
      let parsed: UserVehicle[] = [];
      try { parsed = JSON.parse(rawText); } catch {}
      return parsed;
    },
    enabled: isSignedIn === true,
    staleTime: 0,
    retry: 2,
  });

  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) refetchVehicles();
    }, [isSignedIn])
  );

  const {
    data: queryPaymentMethods,
    isError: pmIsError,
    refetch: refetchPaymentMethods,
  } = useQuery<PaymentMethod[]>({
    queryKey: ["payment-methods"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error("Session expired — please sign in again.");
      }
      const res = await fetch(`${BASE}/api/payment-methods`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load payment methods (${res.status})`);
      const data = await res.json();
      // The server returns raw Stripe card objects: { id, brand, last4, expMonth, expYear }.
      // Normalise them to the PaymentMethod shape expected by the UI so that after
      // any query invalidation the re-fetched list renders correctly (label / subLabel
      // are derived here rather than being left undefined).
      const rawMethods: Array<{ id: string; brand: string; last4: string; expMonth: number; expYear: number }> =
        data.methods ?? data;
      return rawMethods.map((pm): PaymentMethod => {
        const brandLabel = pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : "Card";
        return {
          id: pm.id,
          type: "card",
          label: `${brandLabel} ···· ${pm.last4}`,
          last4: pm.last4,
          subLabel: `Expires ${pm.expMonth}/${pm.expYear}`,
        };
      });
    },
    enabled: isSignedIn === true,
    staleTime: 0,
    retry: 2,
  });

  // When the query resolves (including after invalidateQueries fires in
  // savePaymentMethods), sync the canonical server card list into local state.
  //
  // NOTE: /api/payment-methods only returns Stripe card entries — bank and
  // carrier methods are intentionally local-only (never persisted server-side;
  // they use client-generated Date.now() IDs).  A full replace would wipe those
  // local entries every time the query re-fetches.  Instead we merge: replace
  // all card entries with the server's canonical list while preserving any
  // bank/carrier entries that only exist in local state.
  useEffect(() => {
    if (queryPaymentMethods !== undefined) {
      setPaymentMethods(prev => {
        const localOnly = prev.filter(m => m.type === "bank" || m.type === "carrier");
        return [...queryPaymentMethods, ...localOnly];
      });
    }
  }, [queryPaymentMethods]);

  const effectiveVehicle = profile ?? localVehicle;

  const histDateParams = new URLSearchParams();
  if (histFrom) histDateParams.set("from", histFrom.toISOString());
  if (histTo) histDateParams.set("to", histTo.toISOString());
  const histDateParamStr = histDateParams.toString();

  const { data: history = [], isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery<HistoryEntry[]>({
    queryKey: ["charging-history", histDateParamStr],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        track("charging_history_query_no_token", {});
        throw new Error("Session expired — please sign in again.");
      }
      const url = `${BASE}/api/charging-history${histDateParamStr ? `?${histDateParamStr}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: isSignedIn === true,
  });

  const searchTrimmed = histSearchInput.trim().toLowerCase();
  const filteredHistory = searchTrimmed
    ? history.filter((h) => h.stationName.toLowerCase().includes(searchTrimmed))
    : history;

  const totalKwh = history.reduce((s, h) => s + (h.kwh ?? 0), 0);
  const totalSpent = history.reduce((s, h) => s + (h.amountCents ?? 0), 0) / 100;

  const { data: myReviews = [], isLoading: reviewsLoading, isError: reviewsError, refetch: refetchReviews } = useGetMyReviews({
    query: { enabled: isSignedIn === true } as any,
  });
  const deleteReview = useDeleteReview();

  const { data: connectorAffinity = [] } = useGetMeConnectorAffinity({
    query: { enabled: isSignedIn === true } as any,
  });

  function startEditReview(review: { id: number; rating: number; comment?: string | null }) {
    setEditingReviewId(review.id);
    setEditRating(review.rating);
    setEditComment(review.comment ?? "");
    // Reset any stale session-expiry flag from a previous edit attempt so the
    // Save button is never permanently stuck in "Sign In Again" state.
    setReviewEditSessionExpired(false);
  }

  async function saveEditReview(reviewId: number) {
    const stationId = myReviews.find((r) => r.id === reviewId)?.stationId;
    setReviewSaving(true);
    await runUpdateReview(
      reviewId,
      { rating: editRating, comment: editComment || null },
      {
        getToken,
        patchReview: async (token, id, data) => {
          const r = await fetch(`${BASE}/api/reviews/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(data),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.error ?? "Failed to save review. Please try again.");
          }
          return r.json();
        },
        onSuccess: () => {
          setEditingReviewId(null);
          setReviewEditSessionExpired(false);
          queryClient.invalidateQueries({ queryKey: getGetMyReviewsQueryKey() });
          if (stationId != null) {
            queryClient.invalidateQueries({ queryKey: getGetStationReviewsQueryKey(stationId) });
          }
        },
        onError: (err) => {
          Alert.alert("Error", err.message);
        },
        onSessionExpired: () => setReviewEditSessionExpired(true),
        track,
      },
    );
    setReviewSaving(false);
  }

  function handleDeleteReview(reviewId: number) {
    const stationId = myReviews.find((r) => r.id === reviewId)?.stationId;
    Alert.alert("Delete Review", "Are you sure you want to delete this review?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => {
          deleteReview.mutate(
            { id: reviewId },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetMyReviewsQueryKey() });
                if (stationId != null) {
                  queryClient.invalidateQueries({ queryKey: getGetStationReviewsQueryKey(stationId) });
                }
              },
            }
          );
        },
      },
    ]);
  }

  async function handleShare() {
    try {
      await Share.share({
        message: "I'm using ChargeBridge to find independent EV charging stations and community gas prices. Join me! 🔋⚡",
        url: "https://chargebridge.app",
      });
    } catch { }
  }

  async function handleSharePDF() {
    if (history.length === 0) {
      Alert.alert("No History", "You have no charging sessions to export yet.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPdfGenerating(true);
    try {
      const userName = user?.fullName || profile?.name || "ChargeBridge User";
      const userEmail = user?.primaryEmailAddress?.emailAddress || profile?.email || "";
      const generatedDate = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
      const totalSessions = history.length;
      const kwhTotal = history.reduce((s, h) => s + (h.kwh ?? 0), 0);
      const spentTotal = history.reduce((s, h) => s + (h.amountCents ?? 0), 0) / 100;

      const rows = history.map((entry) => {
        const date = new Date(entry.chargedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        const kwh = entry.kwh != null ? entry.kwh.toFixed(2) + " kWh" : "—";
        const amt = entry.amountCents != null ? "$" + (entry.amountCents / 100).toFixed(2) : "—";
        const type = entry.chargerType ?? "—";
        return `
          <tr>
            <td>${entry.stationName}</td>
            <td style="color:#666">${entry.stationAddress ?? "—"}</td>
            <td>${date}</td>
            <td>${type}</td>
            <td style="text-align:center">${kwh}</td>
            <td style="text-align:center;font-weight:600">${amt}</td>
          </tr>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a2530; background: #fff; padding: 40px; }
  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 24px; border-bottom: 2px solid #0D9E7E; margin-bottom: 28px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo { width: 44px; height: 44px; background: #0D9E7E; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
  .logo-text { color: #fff; font-size: 22px; font-weight: 800; line-height: 44px; text-align: center; width: 44px; }
  .brand-name { font-size: 22px; font-weight: 800; color: #0D9E7E; }
  .brand-sub { font-size: 12px; color: #888; margin-top: 2px; }
  .meta { text-align: right; font-size: 12px; color: #888; }
  .meta strong { color: #1a2530; display: block; font-size: 14px; }
  .summary { display: flex; gap: 16px; margin-bottom: 28px; }
  .stat { flex: 1; background: #f7faf9; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #e2f0ec; }
  .stat-val { font-size: 26px; font-weight: 800; color: #0D9E7E; }
  .stat-lbl { font-size: 11px; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  h2 { font-size: 15px; font-weight: 700; color: #1a2530; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #0D9E7E; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  th:last-child, th:nth-last-child(2) { text-align: center; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
  tr:nth-child(even) td { background: #fafcfb; }
  .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #f0f0f0; padding-top: 16px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="logo"><div class="logo-text">⚡</div></div>
      <div>
        <div class="brand-name">ChargeBridge</div>
        <div class="brand-sub">EV Charging History Report</div>
      </div>
    </div>
    <div class="meta">
      <strong>${userName}</strong>
      ${userEmail}<br/>Generated ${generatedDate}
    </div>
  </div>

  <div class="summary">
    <div class="stat"><div class="stat-val">${totalSessions}</div><div class="stat-lbl">Sessions</div></div>
    <div class="stat"><div class="stat-val">${kwhTotal > 0 ? kwhTotal.toFixed(1) : "—"}</div><div class="stat-lbl">kWh Charged</div></div>
    <div class="stat"><div class="stat-val">${spentTotal > 0 ? "$" + spentTotal.toFixed(2) : "—"}</div><div class="stat-lbl">Total Spent</div></div>
  </div>

  <h2>Session Details</h2>
  <table>
    <thead>
      <tr>
        <th>Station</th>
        <th>Address</th>
        <th>Date</th>
        <th>Charger</th>
        <th>kWh</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">ChargeBridge — Community EV Charging Network &nbsp;·&nbsp; chargebridge.app</div>
</body>
</html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Share Charging History PDF",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Sharing unavailable", "Sharing is not supported on this device.");
      }
    } catch (err) {
      Alert.alert("Export failed", "Could not generate the PDF. Please try again.");
    } finally {
      setPdfGenerating(false);
    }
  }

  async function savePaymentMethods(methods: PaymentMethod[]) {
    setPaymentMethods(methods);
    try {
      await user?.update({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), paymentMethods: methods } });
    } catch { }
    queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
  }

  // Mutation that detaches a payment method from the Stripe customer server-side
  // so it no longer appears in the re-fetched list after query invalidation.
  const deletePaymentMethodMutation = useMutation({
    mutationFn: async (pmId: string) => {
      const token = await getToken();
      if (!token) throw new Error("Session expired — please sign in again.");
      const res = await fetch(`${BASE}/api/payment-methods/${pmId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Failed to remove payment method (${res.status})`);
      }
    },
    onSuccess: () => {
      // Re-fetch the canonical server list so local state matches Stripe exactly.
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
    },
    onError: (err: Error) => {
      // Re-fetch to restore the card that was optimistically removed from the UI.
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
      Alert.alert("Remove Failed", err.message || "Failed to remove payment method. Please try again.");
    },
  });

  if (!isSignedIn) {
    return (
      <View style={[S.root, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: topPad + 16 }} />
        <View style={S.signInWrap}>
          <View style={[S.logoBox, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="flash" size={36} color={colors.primary} />
          </View>
          <Text style={[S.siTitle, { color: colors.foreground }]}>Your ChargeBridge Account</Text>
          <Text style={[S.siBody, { color: colors.mutedForeground }]}>
            Sign in to save stations, track charging history, and manage your profile.
          </Text>
          <View style={[S.featureBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { icon: "heart", label: "Save your favorite stations" },
              { icon: "clock", label: "View charging history" },
              { icon: "zap", label: "Track kWh and spending" },
              { icon: "wallet", label: "Manage payment methods" },
            ].map(({ icon, label }) => (
              <View key={label} style={S.featureRow}>
                <View style={[S.featureIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name={icon as any} size={15} color={colors.primary} />
                </View>
                <Text style={[S.featureText, { color: colors.foreground }]}>{label}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[S.signInBtn, { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push({ pathname: "/(auth)/sign-in", params: { returnTo: "profile" } }); }}
            activeOpacity={0.85}
          >
            <Text style={S.signInBtnTxt}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.signUpBtn, { borderColor: colors.primary }]}
            onPress={() => { Haptics.selectionAsync(); router.push("/(auth)/sign-up"); }}
            activeOpacity={0.85}
          >
            <Text style={[S.signUpBtnTxt, { color: colors.primary }]}>Create Account</Text>
          </TouchableOpacity>

          {/* Saved driver details */}
          <View style={[GD.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={GD.cardHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[GD.iconBadge, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name="user" size={14} color={colors.primary} />
                </View>
                <Text style={[GD.cardTitle, { color: colors.foreground }]}>Saved Charge Details</Text>
              </View>
              {!editingSavedDetails && (
                <TouchableOpacity
                  onPress={startEditSavedDetails}
                  style={[GD.editBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30" }]}
                  activeOpacity={0.75}
                >
                  <Feather name="edit-2" size={12} color={colors.primary} />
                  <Text style={[GD.editBtnTxt, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {editingSavedDetails ? (
              <View style={{ gap: 10 }}>
                <Text style={[GD.hint, { color: colors.mutedForeground }]}>
                  These details pre-fill the charge form. Leave a field blank to clear it.
                </Text>
                <View>
                  <Text style={[GD.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
                  <TextInput
                    style={[GD.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    value={draftName}
                    onChangeText={setDraftName}
                    placeholder="Your name"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>
                <View>
                  <Text style={[GD.fieldLabel, { color: colors.mutedForeground }]}>Email</Text>
                  <TextInput
                    style={[GD.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    value={draftEmail}
                    onChangeText={setDraftEmail}
                    placeholder="your@email.com"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="done"
                    onSubmitEditing={saveSavedDetails}
                  />
                </View>
                <View style={GD.actionRow}>
                  <TouchableOpacity
                    onPress={() => setEditingSavedDetails(false)}
                    style={[GD.cancelBtn, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                  >
                    <Text style={[GD.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
                  </TouchableOpacity>
                  {(savedDriverName || savedDriverEmail) && (
                    <TouchableOpacity
                      onPress={clearSavedDetails}
                      style={[GD.clearBtn]}
                      activeOpacity={0.75}
                    >
                      <Feather name="trash-2" size={13} color="#EF4444" />
                      <Text style={GD.clearTxt}>Clear</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={saveSavedDetails}
                    style={[GD.saveBtn, { backgroundColor: colors.primary }]}
                    activeOpacity={0.85}
                  >
                    <Text style={GD.saveTxt}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={[GD.hint, { color: colors.mutedForeground }]}>
                  Used to pre-fill the charge form when you pay as a guest.
                </Text>
                <View style={GD.detailRow}>
                  <Feather name="user" size={13} color={colors.mutedForeground} />
                  <Text style={[GD.detailVal, { color: savedDriverName ? colors.foreground : colors.mutedForeground }]}>
                    {savedDriverName || "No name saved"}
                  </Text>
                </View>
                <View style={GD.detailRow}>
                  <Feather name="mail" size={13} color={colors.mutedForeground} />
                  <Text style={[GD.detailVal, { color: savedDriverEmail ? colors.foreground : colors.mutedForeground }]}>
                    {savedDriverEmail || "No email saved"}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* My Vehicle — works for guests via AsyncStorage */}
          <View style={[GD.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={GD.cardHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[GD.iconBadge, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name="car-outline" size={14} color={colors.primary} />
                </View>
                <Text style={[GD.cardTitle, { color: colors.foreground }]}>My Vehicle</Text>
              </View>
              {!editingVehicle && (
                <TouchableOpacity
                  onPress={startEditVehicle}
                  style={[GD.editBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30" }]}
                  activeOpacity={0.75}
                >
                  <Feather name="edit-2" size={12} color={colors.primary} />
                  <Text style={[GD.editBtnTxt, { color: colors.primary }]}>{effectiveVehicle?.vehicleMake ? "Edit" : "Add"}</Text>
                </TouchableOpacity>
              )}
            </View>
            {editingVehicle ? (
              <View style={{ gap: 10 }}>
                <View>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Vehicle Type</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {([
                      { label: "⚡ Electric", value: "electric" },
                      { label: "⛽ Gas", value: "regular" },
                      { label: "🔋 Hybrid", value: "hybrid" },
                    ] as { label: string; value: string }[]).map((opt) => {
                      const active = opt.value === "electric"
                        ? (!vehicleForm.fuelType || vehicleForm.fuelType === "electric")
                        : opt.value === "hybrid"
                          ? vehicleForm.fuelType === "hybrid"
                          : (vehicleForm.fuelType !== "electric" && vehicleForm.fuelType !== "hybrid");
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          onPress={() => {
                            setVehicleForm(f => ({
                              ...f, fuelType: opt.value,
                              connectorType: opt.value !== "electric" ? "" : f.connectorType,
                              batteryKwh: opt.value !== "electric" ? "" : f.batteryKwh,
                              rangePerCharge: opt.value !== "electric" ? "" : f.rangePerCharge,
                            }));
                            Haptics.selectionAsync();
                          }}
                          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center",
                            backgroundColor: active ? colors.primary + "20" : colors.muted + "44",
                            borderWidth: 1, borderColor: active ? colors.primary + "60" : colors.border }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? colors.primary : colors.foreground }}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                {[
                  { label: "Make", key: "vehicleMake", placeholder: "e.g. Toyota" },
                  { label: "Model", key: "vehicleModel", placeholder: "e.g. Camry" },
                  { label: "Year", key: "vehicleYear", placeholder: "e.g. 2023" },
                ].map(({ label, key, placeholder }) => (
                  <View key={key}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                    <TextInput
                      value={(vehicleForm as any)[key]}
                      onChangeText={v => setVehicleForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder}
                      placeholderTextColor={colors.mutedForeground + "88"}
                      style={[GD.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                ))}
                {(!vehicleForm.fuelType || vehicleForm.fuelType === "electric") && [
                  { label: "Connector", key: "connectorType", placeholder: "CCS / NACS / J1772", numeric: false },
                  { label: "Battery (kWh)", key: "batteryKwh", placeholder: "e.g. 75", numeric: true },
                  { label: "Range (miles)", key: "rangePerCharge", placeholder: "e.g. 330", numeric: true },
                ].map(({ label, key, placeholder, numeric }) => (
                  <View key={key}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                    <TextInput
                      value={(vehicleForm as any)[key]}
                      onChangeText={v => setVehicleForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder}
                      placeholderTextColor={colors.mutedForeground + "88"}
                      keyboardType={numeric ? "numeric" : "default"}
                      style={[GD.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                ))}
                {vehicleForm.fuelType && vehicleForm.fuelType !== "electric" && (
                  <View>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>Fuel Economy (MPG)</Text>
                    <TextInput
                      value={vehicleForm.mpg}
                      onChangeText={v => setVehicleForm(f => ({ ...f, mpg: v }))}
                      placeholder="e.g. 32"
                      placeholderTextColor={colors.mutedForeground + "88"}
                      keyboardType="numeric"
                      style={[GD.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                )}
                <View style={GD.actionRow}>
                  <TouchableOpacity onPress={() => setEditingVehicle(false)} style={[GD.cancelBtn, { borderColor: colors.border }]} activeOpacity={0.75}>
                    <Text style={[GD.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveVehicle} style={[GD.saveBtn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
                    <Text style={GD.saveTxt}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : effectiveVehicle?.vehicleMake ? (
              <VehicleDisplayCard profile={effectiveVehicle} />
            ) : (
              <Text style={[GD.hint, { color: colors.mutedForeground }]}>
                Add your vehicle to get personalized charger filters and fuel price highlights.
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[S.root, { backgroundColor: wallpaper.isDefault ? colors.background : "transparent" }]}>
      <WallpaperLayer tab="profile" />
      <VehiclePickerModal visible={vehiclePickerOpen} onClose={() => setVehiclePickerOpen(false)} onSelect={handleVehicleSelect} />
      <View style={[S.navBar, { paddingTop: topPad + 8, backgroundColor: wallpaper.isDefault ? colors.background : "transparent" }]}>
        {isAdmin && (
          <TouchableOpacity
            style={[S.homeBtn, { backgroundColor: colors.primary + "22", marginRight: showHomeBtn ? 8 : 0 }]}
            onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/admin" as any); }}
            activeOpacity={0.8}
          >
            <Feather name="shield" size={17} color={colors.primary} />
          </TouchableOpacity>
        )}
        {showHomeBtn && (
          <TouchableOpacity
            style={[S.homeBtn, { backgroundColor: colors.muted }]}
            onPress={() => { Haptics.selectionAsync(); router.navigate("/(tabs)/home" as any); }}
            activeOpacity={0.8}
          >
            <Feather name="home" size={17} color={colors.foreground} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* Profile hero */}
        <LinearGradient
          colors={[colors.primary + "22", colors.background]}
          style={[S.profileHero, !showHomeBtn && { paddingTop: topPad + 24 }]}
        >
          {user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={S.avatar} />
          ) : (
            <View style={[S.avatarPlaceholder, { backgroundColor: colors.primary + "22" }]}>
              <Ionicons name="person" size={32} color={colors.primary} />
            </View>
          )}
          <Text style={[S.displayName, { color: colors.foreground }]}>
            {user?.fullName || profile?.name || "ChargeBridge User"}
          </Text>
          <Text style={[S.email, { color: colors.mutedForeground }]}>
            {user?.primaryEmailAddress?.emailAddress || profile?.email}
          </Text>
          {(meta?.phone || meta?.dob || address?.city) && (
            <View style={S.metaRow}>
              {meta?.phone ? (
                <View style={[S.metaPill, { backgroundColor: colors.card }]}>
                  <Feather name="phone" size={11} color={colors.mutedForeground} />
                  <Text style={[S.metaTxt, { color: colors.mutedForeground }]}>{meta.phone}</Text>
                </View>
              ) : null}
              {address?.city ? (
                <View style={[S.metaPill, { backgroundColor: colors.card }]}>
                  <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                  <Text style={[S.metaTxt, { color: colors.mutedForeground }]}>{address.city}{address.state ? `, ${address.state}` : ""}</Text>
                </View>
              ) : null}
            </View>
          )}
          <View style={S.heroActions}>
            <TouchableOpacity
              style={[S.signOutBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => { Haptics.selectionAsync(); signOut(); }}
              activeOpacity={0.8}
            >
              <Feather name="log-out" size={13} color={colors.mutedForeground} />
              <Text style={[S.signOutTxt, { color: colors.mutedForeground }]}>Sign Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.signOutBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "12" }]}
              onPress={() => { Haptics.selectionAsync(); router.push("/edit-profile" as any); }}
              activeOpacity={0.8}
            >
              <Feather name="edit-2" size={13} color={colors.primary} />
              <Text style={[S.signOutTxt, { color: colors.primary }]}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.shareHeroBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <Feather name="share-2" size={13} color={colors.mutedForeground} />
              <Text style={[S.signOutTxt, { color: colors.mutedForeground }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.signOutBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => { Haptics.selectionAsync(); Linking.openURL("mailto:feedback@chargebridgeapp.com?subject=ChargeBridge%20Feedback"); }}
              activeOpacity={0.8}
            >
              <Feather name="message-circle" size={13} color={colors.mutedForeground} />
              <Text style={[S.signOutTxt, { color: colors.mutedForeground }]}>Feedback</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Stats */}
        <View style={S.statsRow}>
          <StatPill value={history.length} label="Sessions" tint={colors.primary} />
          <StatPill value={totalKwh > 0 ? totalKwh.toFixed(1) : "—"} label="kWh" tint="#3b82f6" />
          <StatPill value={totalSpent > 0 ? `$${totalSpent.toFixed(0)}` : "—"} label="Spent" tint="#f59e0b" />
          <StatPill value={profile?.favoritesCount ?? "—"} label="Saved" tint="#ef4444" />
        </View>

        {/* My Vehicles — multi-vehicle list (signed-in) */}
        <View style={[S.section]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>My Vehicles</Text>
            {!addingVehicle && editingVehicleId === null && (
              <TouchableOpacity onPress={startAddVehicle} activeOpacity={0.7}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary + "18", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Feather name="plus" size={13} color={colors.primary} />
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Add vehicle</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Error state */}
          {vehiclesIsError && !addingVehicle && (
            <View style={{ backgroundColor: "#ef444414", borderRadius: 10, borderWidth: 1, borderColor: "#ef444430", padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#ef4444", marginBottom: 4 }}>Couldn't load vehicles — check your connection</Text>
              <TouchableOpacity onPress={() => refetchVehicles()} activeOpacity={0.8}
                style={{ backgroundColor: "#ef444420", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#ef4444" }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Empty-state hint */}
          {vehiclesList.length === 0 && !vehiclesIsError && !addingVehicle && (
            <View style={{ backgroundColor: "#0D9E7E14", borderRadius: 10, borderWidth: 1, borderColor: "#0D9E7E30", padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="information-circle-outline" size={18} color="#0D9E7E" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#0D9E7E" }}>Add your vehicle for better results</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>EV drivers get charger filters. Gas &amp; hybrid drivers get personalized fuel price highlights.</Text>
              </View>
            </View>
          )}

          {/* Vehicle list */}
          {vehiclesList.map((v) => (
            <View key={v.id} style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              {editingVehicleId === v.id ? (
                /* ── Inline edit form ── */
                <View style={{ gap: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 2 }}>Edit Vehicle</Text>
                  <TouchableOpacity
                    onPress={() => setVehiclePickerOpen(true)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary + "12", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.primary + "30" }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="search-outline" size={15} color={colors.primary} />
                    <Text style={{ flex: 1, color: colors.primary, fontWeight: "600", fontSize: 14 }}>Search vehicle database (100+ models)</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                  </TouchableOpacity>
                  <View>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Vehicle Type</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {([{ label: "⚡ Electric", value: "electric" }, { label: "⛽ Gas", value: "regular" }, { label: "🔋 Hybrid", value: "hybrid" }] as { label: string; value: string }[]).map((opt) => {
                        const isActive = opt.value === "electric"
                          ? (!vehicleFormNew.fuelType || vehicleFormNew.fuelType === "electric")
                          : opt.value === "hybrid" ? vehicleFormNew.fuelType === "hybrid"
                          : (vehicleFormNew.fuelType !== "electric" && vehicleFormNew.fuelType !== "hybrid");
                        return (
                          <TouchableOpacity key={opt.value} onPress={() => { setVehicleFormNew(f => ({ ...f, fuelType: opt.value, connectorType: opt.value !== "electric" ? "" : f.connectorType, batteryKwh: opt.value !== "electric" ? "" : f.batteryKwh, rangePerCharge: opt.value !== "electric" ? "" : f.rangePerCharge })); Haptics.selectionAsync(); }}
                            style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: isActive ? colors.primary + "20" : colors.muted + "44", borderWidth: 1, borderColor: isActive ? colors.primary + "60" : colors.border }} activeOpacity={0.75}>
                            <Text style={{ fontSize: 13, fontWeight: isActive ? "700" : "400", color: isActive ? colors.primary : colors.foreground }}>{opt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  {[
                    { label: "Nickname (optional)", key: "nickname", placeholder: "e.g. My Tesla", numeric: false },
                    { label: "Make", key: "make", placeholder: "e.g. Tesla", numeric: false },
                    { label: "Model", key: "model", placeholder: "e.g. Model 3", numeric: false },
                    { label: "Year", key: "year", placeholder: "e.g. 2023", numeric: false },
                  ].map(({ label, key, placeholder, numeric }) => (
                    <View key={key}>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                      <TextInput value={String((vehicleFormNew as any)[key] ?? "")} onChangeText={v => setVehicleFormNew(f => ({ ...f, [key]: v }))} placeholder={placeholder} placeholderTextColor={colors.mutedForeground + "88"} keyboardType={numeric ? "numeric" : "default"} style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }} />
                    </View>
                  ))}
                  {(!vehicleFormNew.fuelType || vehicleFormNew.fuelType === "electric") && [
                    { label: "Connector", key: "connectorType", placeholder: "CCS / NACS / J1772", numeric: false },
                    { label: "Battery (kWh)", key: "batteryKwh", placeholder: "e.g. 75", numeric: true },
                    { label: "Range (miles)", key: "rangePerCharge", placeholder: "e.g. 330", numeric: true },
                  ].map(({ label, key, placeholder, numeric }) => (
                    <View key={key}>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                      <TextInput value={String((vehicleFormNew as any)[key] ?? "")} onChangeText={v => setVehicleFormNew(f => ({ ...f, [key]: v }))} placeholder={placeholder} placeholderTextColor={colors.mutedForeground + "88"} keyboardType={numeric ? "numeric" : "default"} style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }} />
                    </View>
                  ))}
                  {vehicleFormNew.fuelType && vehicleFormNew.fuelType !== "electric" && (
                    <View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>Fuel Economy (MPG)</Text>
                      <TextInput value={String((vehicleFormNew as any).mpg ?? "")} onChangeText={v => setVehicleFormNew(f => ({ ...f, mpg: v } as any))} placeholder="e.g. 32" placeholderTextColor={colors.mutedForeground + "88"} keyboardType="numeric" style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }} />
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    {editVehicleSessionExpired ? (
                      <TouchableOpacity
                        onPress={() => {
                          // Form data + vehicle ID already saved to AsyncStorage by onSessionExpired.
                          // Clear UI state and navigate with returnTo so the restore effect fires.
                          setEditingVehicleId(null);
                          setEditVehicleSessionExpired(false);
                          router.push({ pathname: "/(auth)/sign-in", params: { returnTo: "editVehicle" } });
                        }}
                        style={{ flex: 1, backgroundColor: "#6B6B6B", borderRadius: 8, paddingVertical: 9, alignItems: "center" }}
                        activeOpacity={0.85}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Sign In Again</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={submitVehicleForm}
                        disabled={editVehicleMutation.isPending}
                        style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 9, alignItems: "center" }}
                        activeOpacity={0.85}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{editVehicleMutation.isPending ? "Saving…" : "Save"}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => {
                        setEditingVehicleId(null);
                        setEditVehicleSessionExpired(false);
                        // Clean up any pending form data saved during a
                        // session-expiry round-trip so it doesn't bleed into a
                        // future Edit Vehicle flow. Must stay in sync with
                        // editVehicleMutation.onSuccess and the onSessionExpired
                        // AsyncStorage.setItem calls above.
                        AsyncStorage.multiRemove([PENDING_VEHICLE_FORM_KEY, PENDING_VEHICLE_ID_KEY]).catch(() => {});
                      }}
                      style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                      activeOpacity={0.85}
                    >
                      <Text style={{ color: colors.mutedForeground, fontWeight: "600", fontSize: 14 }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                  {editVehicleMutation.isError && !editVehicleSessionExpired && <Text style={{ fontSize: 11, color: "#ef4444" }}>{(editVehicleMutation.error as Error)?.message || "Failed to save. Please try again."}</Text>}
                </View>
              ) : (
                /* ── Vehicle display row ── */
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                    <Ionicons name="car-outline" size={18} color={colors.primary} style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || v.nickname || "Unnamed vehicle"}
                      </Text>
                      {v.nickname && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{v.nickname}</Text>}
                      {v.connectorType && <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 1 }}>{v.connectorType}{v.batteryKwh ? ` · ${v.batteryKwh} kWh` : ""}</Text>}
                    </View>
                    {v.isPrimary && (
                      <View style={{ backgroundColor: colors.primary + "18", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>Primary</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    {!v.isPrimary && (
                      setPrimarySessionExpiredId === v.id ? (
                        <TouchableOpacity
                          onPress={() => {
                            setSetPrimarySessionExpiredId(null);
                            router.push("/(auth)/sign-in");
                          }}
                          style={{ flex: 1, backgroundColor: "#6B6B6B", borderRadius: 8, paddingVertical: 7, alignItems: "center", borderWidth: 1, borderColor: "#6B6B6B" }}
                          activeOpacity={0.8}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>Sign In Again</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setPrimaryMutation.mutate(v.id)}
                          disabled={setPrimaryMutation.isPending}
                          style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, paddingVertical: 7, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                          activeOpacity={0.8}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>Set Primary</Text>
                        </TouchableOpacity>
                      )
                    )}
                    <TouchableOpacity
                      onPress={() => startEditVehicleItem(v)}
                      style={{ flex: 1, backgroundColor: colors.primary + "14", borderRadius: 8, paddingVertical: 7, alignItems: "center", borderWidth: 1, borderColor: colors.primary + "30" }}
                      activeOpacity={0.8}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Edit</Text>
                    </TouchableOpacity>
                    {deleteSessionExpiredId === v.id ? (
                      <TouchableOpacity
                        onPress={() => {
                          setDeleteSessionExpiredId(null);
                          router.push("/(auth)/sign-in");
                        }}
                        style={{ paddingHorizontal: 10, backgroundColor: "#6B6B6B", borderRadius: 8, paddingVertical: 7, alignItems: "center", borderWidth: 1, borderColor: "#6B6B6B" }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>Sign In Again</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => confirmDeleteVehicle(v)}
                        disabled={deleteVehicleMutation.isPending}
                        style={{ width: 36, backgroundColor: "#ef444414", borderRadius: 8, paddingVertical: 7, alignItems: "center", borderWidth: 1, borderColor: "#ef444430" }}
                        activeOpacity={0.8}
                      >
                        <Feather name="trash-2" size={14} color="#ef4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          ))}

          {/* Add new vehicle form */}
          {addingVehicle && (
            <View style={{ backgroundColor: colors.card, borderColor: colors.primary + "40", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 10 }}>Add Vehicle</Text>
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setVehiclePickerOpen(true)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary + "12", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.primary + "30" }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="search-outline" size={15} color={colors.primary} />
                  <Text style={{ flex: 1, color: colors.primary, fontWeight: "600", fontSize: 14 }}>Search vehicle database (100+ models)</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                </TouchableOpacity>
                <View>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Vehicle Type</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {([{ label: "⚡ Electric", value: "electric" }, { label: "⛽ Gas", value: "regular" }, { label: "🔋 Hybrid", value: "hybrid" }] as { label: string; value: string }[]).map((opt) => {
                      const isActive = opt.value === "electric"
                        ? (!vehicleFormNew.fuelType || vehicleFormNew.fuelType === "electric")
                        : opt.value === "hybrid" ? vehicleFormNew.fuelType === "hybrid"
                        : (vehicleFormNew.fuelType !== "electric" && vehicleFormNew.fuelType !== "hybrid");
                      return (
                        <TouchableOpacity key={opt.value} onPress={() => { setVehicleFormNew(f => ({ ...f, fuelType: opt.value, connectorType: opt.value !== "electric" ? "" : f.connectorType, batteryKwh: opt.value !== "electric" ? "" : f.batteryKwh, rangePerCharge: opt.value !== "electric" ? "" : f.rangePerCharge })); Haptics.selectionAsync(); }}
                          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: isActive ? colors.primary + "20" : colors.muted + "44", borderWidth: 1, borderColor: isActive ? colors.primary + "60" : colors.border }} activeOpacity={0.75}>
                          <Text style={{ fontSize: 13, fontWeight: isActive ? "700" : "400", color: isActive ? colors.primary : colors.foreground }}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                {[
                  { label: "Nickname (optional)", key: "nickname", placeholder: "e.g. My Tesla", numeric: false },
                  { label: "Make", key: "make", placeholder: "e.g. Tesla", numeric: false },
                  { label: "Model", key: "model", placeholder: "e.g. Model 3", numeric: false },
                  { label: "Year", key: "year", placeholder: "e.g. 2023", numeric: false },
                ].map(({ label, key, placeholder, numeric }) => (
                  <View key={key}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                    <TextInput
                      value={String((vehicleFormNew as any)[key] ?? "")}
                      onChangeText={v => setVehicleFormNew(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder}
                      placeholderTextColor={colors.mutedForeground + "88"}
                      keyboardType={numeric ? "numeric" : "default"}
                      style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>
                ))}
                {(!vehicleFormNew.fuelType || vehicleFormNew.fuelType === "electric") && [
                  { label: "Connector", key: "connectorType", placeholder: "CCS / NACS / J1772", numeric: false },
                  { label: "Battery (kWh)", key: "batteryKwh", placeholder: "e.g. 75", numeric: true },
                  { label: "Range (miles)", key: "rangePerCharge", placeholder: "e.g. 330", numeric: true },
                ].map(({ label, key, placeholder, numeric }) => (
                  <View key={key}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>{label}</Text>
                    <TextInput
                      value={String((vehicleFormNew as any)[key] ?? "")}
                      onChangeText={v => setVehicleFormNew(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder}
                      placeholderTextColor={colors.mutedForeground + "88"}
                      keyboardType={numeric ? "numeric" : "default"}
                      style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>
                ))}
                {vehicleFormNew.fuelType && vehicleFormNew.fuelType !== "electric" && (
                  <View>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>Fuel Economy (MPG)</Text>
                    <TextInput
                      value={String((vehicleFormNew as any).mpg ?? "")}
                      onChangeText={v => setVehicleFormNew(f => ({ ...f, mpg: v } as any))}
                      placeholder="e.g. 32"
                      placeholderTextColor={colors.mutedForeground + "88"}
                      keyboardType="numeric"
                      style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  {addVehicleSessionExpired ? (
                    <TouchableOpacity
                      onPress={() => {
                        // Form data already saved to AsyncStorage by onSessionExpired.
                        // Clear UI state and navigate with returnTo so the restore effect fires.
                        setAddingVehicle(false);
                        setAddVehicleSessionExpired(false);
                        router.push({ pathname: "/(auth)/sign-in", params: { returnTo: "addVehicle" } });
                      }}
                      style={{ flex: 1, backgroundColor: "#6B6B6B", borderRadius: 8, paddingVertical: 9, alignItems: "center" }}
                      activeOpacity={0.85}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Sign In Again</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={submitVehicleForm}
                      disabled={addVehicleMutation.isPending}
                      style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 9, alignItems: "center" }}
                      activeOpacity={0.85}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{addVehicleMutation.isPending ? "Adding…" : "Add Vehicle"}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      setAddingVehicle(false);
                      setAddVehicleSessionExpired(false);
                      // Clean up any pending form data saved during a
                      // session-expiry round-trip so it doesn't bleed into a
                      // future Add Vehicle flow. Must stay in sync with
                      // addVehicleMutation.onSuccess and the onSessionExpired
                      // AsyncStorage.setItem call above.
                      AsyncStorage.multiRemove([PENDING_VEHICLE_FORM_KEY, PENDING_VEHICLE_ID_KEY]).catch(() => {});
                    }}
                    style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: colors.mutedForeground, fontWeight: "600", fontSize: 14 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
                {addVehicleMutation.isError && !addVehicleSessionExpired && <Text style={{ fontSize: 11, color: "#ef4444" }}>{(addVehicleMutation.error as Error)?.message || "Failed to add vehicle. Please try again."}</Text>}
              </View>
            </View>
          )}

          {vehiclesList.length === 0 && !vehiclesIsError && !addingVehicle && (
            <View style={{ alignItems: "center", paddingVertical: 16, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Ionicons name="car-outline" size={32} color={colors.mutedForeground + "66"} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 8 }}>No vehicles added yet</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground + "88", marginTop: 2 }}>EV, gas, hybrid — all vehicle types supported</Text>
            </View>
          )}
        </View>

        {/* Charging Profile — connector affinity learned from history */}
        {isSignedIn && connectorAffinity.length > 0 && (() => {
          const maxWeight = Math.max(...connectorAffinity.map((a) => a.weight));
          const connectorColors: Record<string, string> = {
            NACS: "#0D9E7E",
            CCS: "#3b82f6",
            CHAdeMO: "#f59e0b",
            J1772: "#8b5cf6",
          };
          return (
            <View style={[S.section]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="analytics-outline" size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Charging Profile</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 1 }}>Learned from your history</Text>
                </View>
              </View>
              <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 }}>
                {connectorAffinity.map((item) => {
                  const pct = maxWeight > 0 ? item.weight / maxWeight : 0;
                  const accentColor = connectorColors[item.connectorType] ?? colors.primary;
                  const sessionLabel = item.sessionCount === 1 ? "1 session" : `${item.sessionCount} sessions`;
                  return (
                    <View key={item.connectorType}>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 5 }}>
                        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 7 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accentColor }} />
                          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{item.connectorType}</Text>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{sessionLabel}</Text>
                      </View>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted + "55", overflow: "hidden" }}>
                        <View style={{ height: 6, borderRadius: 3, backgroundColor: accentColor, width: `${Math.round(pct * 100)}%` as any }} />
                      </View>
                    </View>
                  );
                })}
                <View style={{ marginTop: 2, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="information-circle-outline" size={13} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1, lineHeight: 15 }}>
                    These preferences are used to personalise station rankings for you.
                  </Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* Wallet & Payments */}
        <View style={[S.section]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Wallet & Payments</Text>
          <View style={[S.walletCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Saved methods */}
            {pmIsError ? (
              <View style={[S.walletEmpty, { backgroundColor: colors.muted + "55" }]}>
                <Ionicons name="wifi-outline" size={28} color={colors.mutedForeground} />
                <Text style={[S.walletEmptyTxt, { color: colors.mutedForeground }]}>
                  Couldn't load payment methods — check your connection
                </Text>
                <TouchableOpacity onPress={() => refetchPaymentMethods()} style={{ marginTop: 10 }}>
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" }}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : paymentMethods.length > 0 ? (
              <View style={S.methodsList}>
                {paymentMethods.map(m => {
                  const iconName = m.type === "card" ? "card-outline" : m.type === "carrier" ? (isIOS ? "logo-apple" : "logo-google") : "business-outline";
                  const iconColor = m.type === "card" ? colors.primary : m.type === "carrier" ? (isIOS ? "#000" : "#4285F4") : "#3b82f6";
                  const iconBg = m.type === "card" ? colors.primary + "18" : m.type === "carrier" ? (isIOS ? "#00000014" : "#4285F414") : "#3b82f618";
                  return (
                  <View key={m.id} style={[S.methodRow, { borderBottomColor: colors.border }]}>
                    <View style={[S.methodIcon, { backgroundColor: iconBg }]}>
                      <Ionicons name={iconName as any} size={17} color={iconColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.methodLabel, { color: colors.foreground }]}>{m.label}</Text>
                      <Text style={[S.methodSub, { color: colors.mutedForeground }]}>{m.subLabel}</Text>
                    </View>
                    <TouchableOpacity
                      disabled={deletePaymentMethodMutation.isPending}
                      onPress={() => {
                        const filtered = paymentMethods.filter(x => x.id !== m.id);
                        // Optimistic UI: remove from local state immediately.
                        setPaymentMethods(filtered);
                        // Keep Clerk unsafeMetadata in sync (best-effort).
                        user?.update({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), paymentMethods: filtered } }).catch(() => {});
                        if (m.id.startsWith("pm_")) {
                          // Stripe-backed card: detach server-side so it no longer
                          // appears in the re-fetched list.  onSuccess/onError both
                          // call invalidateQueries to reconcile local state with the
                          // canonical server list.
                          deletePaymentMethodMutation.mutate(m.id);
                        } else {
                          // Local-only method (bank, carrier): no server record to
                          // delete.  Invalidate so the query cache stays consistent.
                          queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
                        }
                      }}
                    >
                      <Feather name="trash-2" size={15} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  );
                })}
              </View>
            ) : (
              <View style={[S.walletEmpty, { backgroundColor: colors.muted + "55" }]}>
                <Ionicons name="wallet-outline" size={28} color={colors.mutedForeground} />
                <Text style={[S.walletEmptyTxt, { color: colors.mutedForeground }]}>No payment methods saved yet</Text>
              </View>
            )}

            {/* Add options */}
            <View style={S.walletActions}>
              <TouchableOpacity
                style={[S.walletBtn, { backgroundColor: isIOS ? "#00000014" : "#4285F414", borderColor: isIOS ? "#00000033" : "#4285F433", borderWidth: 1 }]}
                onPress={() => { Haptics.selectionAsync(); setShowCarrierModal(true); }}
                activeOpacity={0.85}
              >
                <Ionicons name={isIOS ? "logo-apple" : "logo-google"} size={16} color={isIOS ? "#000" : "#4285F4"} />
                <Text style={[S.walletBtnTxt, { color: isIOS ? "#000" : "#4285F4" }]}>
                  {isIOS ? "Link Apple Pay to Phone Bill" : "Link Google Pay to Phone Bill"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.walletBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44", borderWidth: 1 }]}
                onPress={() => setShowCardModal(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="card-outline" size={16} color={colors.primary} />
                <Text style={[S.walletBtnTxt, { color: colors.primary }]}>Add Credit / Debit Card</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.walletBtn, { backgroundColor: "#3b82f618", borderColor: "#3b82f644", borderWidth: 1 }]}
                onPress={() => setShowBankModal(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="business-outline" size={16} color="#3b82f6" />
                <Text style={[S.walletBtnTxt, { color: "#3b82f6" }]}>Add Bank Account</Text>
              </TouchableOpacity>
            </View>
            <View style={[S.walletNote, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={11} color={colors.mutedForeground} />
              <Text style={[S.walletNoteTxt, { color: colors.mutedForeground }]}>Payment info is encrypted and stored securely in your profile.</Text>
            </View>
          </View>
        </View>

        {/* Charging history */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>Charging History</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {history.length > 0 && (
                <TouchableOpacity
                  style={[S.pdfBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "44" }]}
                  onPress={handleSharePDF}
                  disabled={pdfGenerating}
                  activeOpacity={0.75}
                >
                  {pdfGenerating ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Feather name="share" size={13} color={colors.primary} />
                      <Text style={[S.pdfBtnTxt, { color: colors.primary }]}>Share PDF</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[S.histFilterToggle, { borderColor: histFiltersVisible || histFrom || histTo || histSearchInput ? colors.primary + "88" : colors.border, backgroundColor: histFiltersVisible || histFrom || histTo || histSearchInput ? colors.primary + "12" : "transparent" }]}
                onPress={() => { Haptics.selectionAsync(); setHistFiltersVisible(v => !v); }}
                activeOpacity={0.75}
              >
                <Feather name="sliders" size={13} color={histFrom || histTo || histSearchInput ? colors.primary : colors.mutedForeground} />
                {(histFrom || histTo || histSearchInput) ? (
                  <View style={[S.histFilterBadge, { backgroundColor: colors.primary }]}>
                    <Text style={S.histFilterBadgeTxt}>{[histFrom, histTo, histSearchInput].filter(Boolean).length}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>
          </View>

          {histFiltersVisible && (
            <View style={[S.histFilterBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[S.histSearchRow, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
                <Feather name="search" size={14} color={colors.mutedForeground} />
                <TextInput
                  style={[S.histSearchInput, { color: colors.foreground }]}
                  value={histSearchInput}
                  onChangeText={setHistSearchInput}
                  placeholder="Search by station name…"
                  placeholderTextColor={colors.mutedForeground + "99"}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
                {histSearchInput.length > 0 && (
                  <TouchableOpacity onPress={() => setHistSearchInput("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={13} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={S.histDateRow}>
                <TouchableOpacity
                  style={[S.histDateChip, { borderColor: histFrom ? colors.primary + "88" : colors.border, backgroundColor: histFrom ? colors.primary + "10" : colors.muted + "44" }]}
                  onPress={() => { Haptics.selectionAsync(); setMonthPickerMode("from"); }}
                  activeOpacity={0.8}
                >
                  <Feather name="calendar" size={12} color={histFrom ? colors.primary : colors.mutedForeground} />
                  <Text style={[S.histDateChipTxt, { color: histFrom ? colors.primary : colors.mutedForeground }]}>
                    {histFrom ? histFrom.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "From"}
                  </Text>
                  {histFrom && (
                    <TouchableOpacity onPress={() => setHistFrom(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Feather name="x" size={11} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                <Feather name="arrow-right" size={13} color={colors.mutedForeground} />
                <TouchableOpacity
                  style={[S.histDateChip, { borderColor: histTo ? colors.primary + "88" : colors.border, backgroundColor: histTo ? colors.primary + "10" : colors.muted + "44" }]}
                  onPress={() => { Haptics.selectionAsync(); setMonthPickerMode("to"); }}
                  activeOpacity={0.8}
                >
                  <Feather name="calendar" size={12} color={histTo ? colors.primary : colors.mutedForeground} />
                  <Text style={[S.histDateChipTxt, { color: histTo ? colors.primary : colors.mutedForeground }]}>
                    {histTo ? histTo.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "To"}
                  </Text>
                  {histTo && (
                    <TouchableOpacity onPress={() => setHistTo(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Feather name="x" size={11} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                {(histFrom || histTo || histSearchInput) && (
                  <TouchableOpacity
                    style={[S.histClearBtn, { borderColor: colors.border }]}
                    onPress={() => { setHistFrom(null); setHistTo(null); setHistSearchInput(""); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[S.histClearBtnTxt, { color: colors.mutedForeground }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {historyLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : historyError ? (
            <View style={{ backgroundColor: "#ef444414", borderRadius: 10, borderWidth: 1, borderColor: "#ef444430", padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#ef4444", marginBottom: 4 }}>Couldn't load charging history — check your connection</Text>
              <TouchableOpacity onPress={() => refetchHistory()} activeOpacity={0.8}
                style={{ backgroundColor: "#ef444420", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#ef4444" }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filteredHistory.length === 0 ? (
            <View style={[S.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="flash-outline" size={32} color={colors.mutedForeground} />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>{histFrom || histTo || histSearchInput ? "No matching sessions" : "No sessions yet"}</Text>
              <Text style={[S.emptyBody, { color: colors.mutedForeground }]}>{histFrom || histTo || histSearchInput ? "Try adjusting your filters." : "Your charging history will appear here after your first session."}</Text>
            </View>
          ) : (
            filteredHistory.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[S.histCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push({
                    pathname: "/session-summary" as any,
                    params: {
                      ...(entry.stationId ? { stationId: String(entry.stationId) } : {}),
                      stationName: entry.stationName,
                      ...(entry.kwh != null ? { kwh: String(entry.kwh) } : {}),
                      ...(entry.amountCents != null ? { totalCost: String((entry.amountCents / 100).toFixed(2)) } : {}),
                      date: new Date(entry.chargedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
                    },
                  });
                }}
                activeOpacity={entry.stationId ? 0.7 : 1}
              >
                <View style={[S.histIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name="flash" size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[S.histStation, { color: colors.foreground }]} numberOfLines={1}>{entry.stationName}</Text>
                  {entry.stationAddress && (
                    <Text style={[S.histAddr, { color: colors.mutedForeground }]} numberOfLines={1}>{entry.stationAddress}</Text>
                  )}
                  <Text style={[S.histDate, { color: colors.mutedForeground }]}>{formatDate(entry.chargedAt)}</Text>
                </View>
                <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
                  {entry.kwh != null && (
                    <Text style={[S.histKwh, { color: colors.primary }]}>{entry.kwh.toFixed(1)} kWh</Text>
                  )}
                  {entry.amountCents != null && (
                    <Text style={[S.histAmt, { color: colors.mutedForeground }]}>${(entry.amountCents / 100).toFixed(2)}</Text>
                  )}
                  {entry.stationId && (
                    <Feather name="chevron-right" size={13} color={colors.mutedForeground + "88"} style={{ marginTop: 4 }} />
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* My Reviews */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>My Reviews</Text>
            {myReviews.length > 0 && (
              <View style={{ backgroundColor: colors.primary + "18", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{myReviews.length}</Text>
              </View>
            )}
          </View>
          {reviewsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
          ) : reviewsError ? (
            <View style={[S.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedForeground} />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>Couldn't load your reviews</Text>
              <Text style={[S.emptyBody, { color: colors.mutedForeground }]}>Check your connection and try again.</Text>
              <TouchableOpacity
                onPress={() => refetchReviews()}
                style={{ marginTop: 10, paddingHorizontal: 20, paddingVertical: 9, backgroundColor: colors.primary, borderRadius: 10 }}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : myReviews.length === 0 ? (
            <View style={[S.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="star-outline" size={32} color={colors.mutedForeground} />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>No reviews yet</Text>
              <Text style={[S.emptyBody, { color: colors.mutedForeground }]}>Rate stations you've visited to share your experience.</Text>
            </View>
          ) : (
            myReviews.map((review) => (
              <View key={review.id} style={[{ borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8, backgroundColor: colors.card, borderColor: colors.border }]}>
                {editingReviewId === review.id ? (
                  <View style={{ gap: 10 }}>
                    <View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Rating</Text>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {[1, 2, 3, 4, 5].map((s) => (
                          <TouchableOpacity key={s} onPress={() => { Haptics.selectionAsync(); setEditRating(s); }} activeOpacity={0.7}>
                            <Ionicons name={s <= editRating ? "star" : "star-outline"} size={22} color={s <= editRating ? "#FBBF24" : colors.mutedForeground} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Comment</Text>
                      <TextInput
                        value={editComment}
                        onChangeText={setEditComment}
                        placeholder="Share your experience…"
                        placeholderTextColor={colors.mutedForeground + "88"}
                        multiline
                        numberOfLines={3}
                        style={{ backgroundColor: colors.muted + "44", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.border, minHeight: 72 }}
                      />
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {reviewEditSessionExpired ? (
                        <TouchableOpacity
                          onPress={() => {
                            setEditingReviewId(null);
                            setReviewEditSessionExpired(false);
                            router.push("/(auth)/sign-in");
                          }}
                          style={{ flex: 1, backgroundColor: "#6B6B6B", borderRadius: 8, paddingVertical: 9, alignItems: "center" }}
                          activeOpacity={0.85}
                        >
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Sign In Again</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => saveEditReview(review.id)}
                          disabled={reviewSaving}
                          style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 9, alignItems: "center", opacity: reviewSaving ? 0.7 : 1 }}
                          activeOpacity={0.85}
                        >
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{reviewSaving ? "Saving…" : "Save"}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => { setEditingReviewId(null); setReviewEditSessionExpired(false); }}
                        style={{ flex: 1, backgroundColor: colors.muted + "44", borderRadius: 8, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                        activeOpacity={0.85}
                      >
                        <Text style={{ color: colors.mutedForeground, fontWeight: "600", fontSize: 13 }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <TouchableOpacity
                        onPress={() => { Haptics.selectionAsync(); router.push(`/station/${review.stationId}` as any); }}
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={1}>{review.stationName}</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </TouchableOpacity>
                      <View style={{ flexDirection: "row", gap: 4, marginLeft: 8 }}>
                        <TouchableOpacity
                          onPress={() => { Haptics.selectionAsync(); startEditReview(review); }}
                          style={{ padding: 6 }}
                          activeOpacity={0.7}
                        >
                          <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteReview(review.id)}
                          style={{ padding: 6 }}
                          activeOpacity={0.7}
                        >
                          <Feather name="trash-2" size={14} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 5 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Ionicons key={s} name={s <= review.rating ? "star" : "star-outline"} size={13} color={s <= review.rating ? "#FBBF24" : colors.mutedForeground} />
                      ))}
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginLeft: 4 }}>{formatDate(review.createdAt)}</Text>
                    </View>
                    {review.comment ? (
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }}>{review.comment}</Text>
                    ) : null}
                  </View>
                )}
              </View>
            ))
          )}
        </View>

        {/* Navigation Voice */}
        <View style={[S.section]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Navigation Voice</Text>
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setVoiceModalOpen(true); }}
            activeOpacity={0.75}
            style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="volume-medium-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{navVoiceName}</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 }}>Turn-by-turn voice guidance · {navLanguage}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Share section */}
        <View style={[S.section]}>
          <View style={[S.shareCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
            <View style={[S.shareIconBox, { backgroundColor: colors.primary }]}>
              <Feather name="share-2" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.shareTitle, { color: colors.foreground }]}>Spread the word</Text>
              <Text style={[S.shareSub, { color: colors.mutedForeground }]}>Help your fellow EV drivers find great charging stations</Text>
            </View>
            <TouchableOpacity style={[S.shareActionBtn, { backgroundColor: colors.primary }]} onPress={handleShare} activeOpacity={0.85}>
              <Text style={S.shareActionTxt}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Version footer — tap 5× to open Build Info */}
        <TouchableOpacity onPress={handleVersionTap} activeOpacity={0.6} style={{ alignItems: "center", paddingVertical: 20, paddingBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
              ChargeBridge {versionTapCount > 0 ? `· ${5 - versionTapCount} more tap${5 - versionTapCount !== 1 ? "s" : ""}` : "· v1.0.0 (191)"}
            </Text>
            {showOtaBadge && (
              <View style={{
                width: 7, height: 7, borderRadius: 4,
                backgroundColor: otaPendingReload ? "#f59e0b" : "#0D9E7E",
              }} />
            )}
          </View>
          {showOtaBadge && (
            <Text style={{ fontSize: 10, color: otaPendingReload ? "#f59e0b" : "#0D9E7E", fontFamily: "Inter_400Regular", marginTop: 2 }}>
              {otaPendingReload ? "Update queued" : "Update ready"}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <AddCardModal
        visible={showCardModal}
        onClose={() => setShowCardModal(false)}
        onSave={m => savePaymentMethods([...paymentMethods, m]).then(() => setShowCardModal(false))}
      />
      <AddBankModal
        visible={showBankModal}
        onClose={() => setShowBankModal(false)}
        onSave={m => savePaymentMethods([...paymentMethods, m]).then(() => setShowBankModal(false))}
      />

      {/* ── Navigation Voice Modal ── */}
      <Modal
        visible={voiceModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVoiceModalOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" }}>Voice &amp; Language</Text>
            <TouchableOpacity onPress={() => setVoiceModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 24 }}>
            {/* Language */}
            <View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Language</Text>
              {[
                { code: "en-US", label: "English (US)" },
                { code: "en-GB", label: "English (UK)" },
                { code: "es-ES", label: "Spanish" },
                { code: "fr-FR", label: "French" },
                { code: "de-DE", label: "German" },
                { code: "it-IT", label: "Italian" },
                { code: "pt-BR", label: "Portuguese (Brazil)" },
                { code: "ja-JP", label: "Japanese" },
                { code: "zh-CN", label: "Chinese (Simplified)" },
                { code: "ko-KR", label: "Korean" },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.code}
                  onPress={() => {
                    setNavLanguage(opt.code);
                    setNavVoiceId(null);
                    setNavVoiceName("Auto (Female)");
                    AsyncStorage.multiSet([["@chargebridge/nav_language", opt.code], ["@chargebridge/nav_voice_id", ""]]).catch(() => {});
                    Speech.getAvailableVoicesAsync().then((voices) => {
                      setAvailableVoices(voices);
                      const lang = opt.code.split("-")[0];
                      const femNames = ["samantha", "karen", "ava", "serena", "allison", "tessa", "zoe", "moira", "fiona"];
                      const pick = voices.find((v) => v.language.startsWith(lang) && femNames.some((n) => v.name.toLowerCase().includes(n)));
                      if (pick) {
                        setNavVoiceId(pick.identifier);
                        setNavVoiceName(pick.name);
                        AsyncStorage.setItem("@chargebridge/nav_voice_id", pick.identifier).catch(() => {});
                      }
                    }).catch(() => {});
                    Haptics.selectionAsync();
                  }}
                  activeOpacity={0.75}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                >
                  <Text style={{ color: navLanguage === opt.code ? colors.primary : colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular" }}>{opt.label}</Text>
                  {navLanguage === opt.code && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </View>

            {/* Voice list */}
            {availableVoices.length > 0 && (
              <View>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Voice</Text>
                {availableVoices
                  .filter((v) => v.language.startsWith(navLanguage.split("-")[0]))
                  .map((v) => (
                    <TouchableOpacity
                      key={v.identifier}
                      onPress={() => {
                        setNavVoiceId(v.identifier);
                        setNavVoiceName(v.name);
                        AsyncStorage.setItem("@chargebridge/nav_voice_id", v.identifier).catch(() => {});
                        try { Speech.stop(); } catch {}
                        const _selId = availableVoices.some((av) => av.identifier === v.identifier) ? v.identifier : null;
                        Speech.speak("Navigation voice selected.", { language: navLanguage, rate: 0.88, pitch: 0.95, ...(_selId ? { voice: _selId } : {}) });
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                    >
                      <View>
                        <Text style={{ color: navVoiceId === v.identifier ? colors.primary : colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular" }}>{v.name}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 }}>{v.language}{v.name.toLowerCase().includes("enhanced") || v.name.toLowerCase().includes("premium") ? " · Enhanced" : ""}</Text>
                      </View>
                      {navVoiceId === v.identifier ? (
                        <Feather name="check" size={16} color={colors.primary} />
                      ) : (
                        <TouchableOpacity onPress={() => { try { Speech.stop(); } catch {} const _prvId = availableVoices.some((av) => av.identifier === v.identifier) ? v.identifier : null; Speech.speak("Hello, I'll be your navigation guide.", { language: navLanguage, rate: 0.88, pitch: 0.95, ...(_prvId ? { voice: _prvId } : {}) }); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Feather name="volume-2" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  ))}
              </View>
            )}

            {/* Speaking speed */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>Speaking Speed</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([{ label: "Slow", rate: 0.75 }, { label: "Normal", rate: 0.88 }, { label: "Fast", rate: 1.0 }] as { label: string; rate: number }[]).map((opt) => {
                  const active = Math.abs(navVoiceRate - opt.rate) < 0.05;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? colors.primary + "22" : colors.muted + "66", borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
                      onPress={() => {
                        setNavVoiceRate(opt.rate);
                        AsyncStorage.setItem("@chargebridge/nav_voice_rate", String(opt.rate)).catch(() => {});
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Announcement level */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Announcement Level</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12, opacity: 0.7 }}>How often voice guidance fires per turn</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  { level: "quiet" as const, label: "Quiet", sub: "Turn only" },
                  { level: "normal" as const, label: "Normal", sub: "3 per turn" },
                  { level: "verbose" as const, label: "Verbose", sub: "Early + all" },
                ]).map((opt) => {
                  const active = navVoiceLevel === opt.level;
                  return (
                    <TouchableOpacity
                      key={opt.level}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? colors.primary + "22" : colors.muted + "66", borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
                      onPress={() => {
                        setNavVoiceLevel(opt.level);
                        AsyncStorage.setItem("@chargebridge/nav_voice_level", opt.level).catch(() => {});
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                      <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2, opacity: 0.7 }}>{opt.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Volume */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Volume</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12, opacity: 0.7 }}>Navigation voice loudness</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([{ label: "25%", vol: 0.25 }, { label: "50%", vol: 0.5 }, { label: "75%", vol: 0.75 }, { label: "100%", vol: 1.0 }] as { label: string; vol: number }[]).map((opt) => {
                  const active = Math.abs(navVoiceVolume - opt.vol) < 0.05;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? colors.primary + "22" : colors.muted + "66", borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
                      onPress={() => {
                        setNavVoiceVolume(opt.vol);
                        AsyncStorage.setItem("@chargebridge/nav_voice_volume", String(opt.vol)).catch(() => {});
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Mute toggle */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular" }}>Mute voice guidance</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 }}>Turn off all spoken instructions</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  const next = !navVoiceMuted;
                  setNavVoiceMuted(next);
                  AsyncStorage.setItem("@chargebridge/nav_voice_muted", next ? "1" : "0").catch(() => {});
                  Haptics.selectionAsync();
                }}
                style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: navVoiceMuted ? colors.primary : colors.border, alignItems: "center", justifyContent: "center" }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", position: "absolute", left: navVoiceMuted ? 22 : 3 }} />
              </TouchableOpacity>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </Modal>
      <CarrierBillingModal
        visible={showCarrierModal}
        onClose={() => setShowCarrierModal(false)}
        prefillPhone={meta?.phone as string | undefined}
        onSave={m => savePaymentMethods([...paymentMethods, m]).then(() => setShowCarrierModal(false))}
      />

      {/* Month picker modal */}
      <Modal
        visible={monthPickerMode !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMonthPickerMode(null)}
      >
        <Pressable style={WM.backdrop} onPress={() => setMonthPickerMode(null)} />
        <View style={[WM.sheet, { backgroundColor: colors.background }]}>
          <View style={WM.handle} />
          <View style={[WM.head, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[WM.title, { color: colors.foreground }]}>{monthPickerMode === "from" ? "From Month" : "To Month"}</Text>
            <TouchableOpacity onPress={() => setMonthPickerMode(null)} style={WM.closeBtn}>
              <Ionicons name="close" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 20 }}>
            {Array.from({ length: 30 }, (_, i) => {
              const now = new Date();
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
              const isSelected = monthPickerMode === "from"
                ? histFrom?.getFullYear() === d.getFullYear() && histFrom?.getMonth() === d.getMonth()
                : histTo?.getFullYear() === d.getFullYear() && histTo?.getMonth() === d.getMonth();
              return (
                <TouchableOpacity
                  key={i}
                  style={[S.monthRow, { borderBottomColor: colors.border, backgroundColor: isSelected ? colors.primary + "14" : "transparent" }]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    if (monthPickerMode === "from") {
                      const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
                      setHistFrom(start);
                    } else {
                      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
                      setHistTo(end);
                    }
                    setMonthPickerMode(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[S.monthRowTxt, { color: isSelected ? colors.primary : colors.foreground, fontWeight: isSelected ? "700" : "400" }]}>{label}</Text>
                  {isSelected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  navBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 8 },
  homeBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },

  signInWrap: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 20, gap: 12 },
  logoBox: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  siTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center" },
  siBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  featureBox: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 18, gap: 14, marginTop: 4, shadowColor: "#1A2530", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 14, fontWeight: "500", fontFamily: "Inter_500Medium" },
  signInBtn: { width: "100%", borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  signInBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  signUpBtn: { width: "100%", borderRadius: 16, paddingVertical: 15, alignItems: "center", borderWidth: 1.5 },
  signUpBtnTxt: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },

  profileHero: { alignItems: "center", paddingTop: 20, paddingBottom: 24, paddingHorizontal: 24 },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  displayName: { fontSize: 21, fontWeight: "800", fontFamily: "Inter_700Bold", marginBottom: 4 },
  email: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 10 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  metaTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  heroActions: { flexDirection: "row", gap: 10 },
  signOutBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  shareHeroBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  signOutTxt: { fontSize: 13, fontWeight: "500", fontFamily: "Inter_500Medium" },

  statsRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 6 },

  section: { marginHorizontal: 16, marginBottom: 14 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 12, opacity: 0.55 },
  pdfBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, minWidth: 36, justifyContent: "center" },
  pdfBtnTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  walletCard: { borderRadius: 20, borderWidth: 1, overflow: "hidden", shadowColor: "#1A2530", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  methodsList: { paddingHorizontal: 16, paddingTop: 4 },
  methodRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  methodIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  methodLabel: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  methodSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  walletEmpty: { margin: 16, borderRadius: 14, paddingVertical: 28, alignItems: "center", gap: 8 },
  walletEmptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },
  walletActions: { padding: 16, gap: 10 },
  walletBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  walletBtnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  walletNote: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginBottom: 14, borderRadius: 10, padding: 10 },
  walletNoteTxt: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },

  emptyBox: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  histCard: { flexDirection: "row", borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 10, gap: 12, alignItems: "center", shadowColor: "#1A2530", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 1 },
  histIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  histStation: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  histAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  histDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  histKwh: { fontSize: 15, fontWeight: "800", fontFamily: "Inter_700Bold" },
  histAmt: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  histFilterToggle: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  histFilterBadge: { position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  histFilterBadgeTxt: { color: "#fff", fontSize: 8, fontWeight: "700" },
  histFilterBar: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12, gap: 10 },
  histSearchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  histSearchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  histDateRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  histDateChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  histDateChipTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  histClearBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  histClearBtnTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  monthRowTxt: { fontSize: 15, fontFamily: "Inter_400Regular" },

  shareCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, padding: 16 },
  shareIconBox: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  shareTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  shareSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  shareActionBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, flexShrink: 0 },
  shareActionTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});

const GD = StyleSheet.create({
  card: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 4, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBadge: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  editBtnTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  fieldLabel: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailVal: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  cancelTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FEE2E2", backgroundColor: "#FEF2F2" },
  clearTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  saveBtn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 10 },
  saveTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
