import React, { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Share,
  TouchableOpacity, Modal,
} from "react-native";
import { useUser } from "@clerk/expo";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { resolveInitialRoute } from "@/utils/resolveInitialRoute";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

const STEPS = ["Personal Info", "Address", "Wallet", "All Done"];

function ProgressBar({ step }: { step: number }) {
  return (
    <View style={PB.row}>
      {STEPS.map((label, i) => (
        <View key={label} style={PB.stepWrap}>
          <View style={[PB.dot, i <= step && PB.dotActive, i < step && PB.dotDone]}>
            {i < step
              ? <Feather name="check" size={11} color="#fff" />
              : <Text style={[PB.dotNum, i === step && PB.dotNumActive]}>{i + 1}</Text>}
          </View>
          {i < STEPS.length - 1 && (
            <View style={[PB.line, i < step && PB.lineActive]} />
          )}
        </View>
      ))}
    </View>
  );
}
const PB = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 28 },
  stepWrap: { flexDirection: "row", alignItems: "center" },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "#D5D0C8", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dotActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E18" },
  dotDone: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E" },
  dotNum: { fontSize: 11, fontWeight: "700", color: "#9AAFAF" },
  dotNumActive: { color: "#0D9E7E" },
  line: { width: 32, height: 2, backgroundColor: "#D5D0C8", marginHorizontal: 4 },
  lineActive: { backgroundColor: "#0D9E7E" },
});

function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, maxLength, optional }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; secureTextEntry?: boolean;
  maxLength?: number; optional?: boolean;
}) {
  return (
    <View style={F.wrap}>
      <Text style={F.label}>{label}{optional ? <Text style={F.opt}> (optional)</Text> : <Text style={F.req}> *</Text>}</Text>
      <TextInput
        style={F.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AAFAF"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoCapitalize="words"
      />
    </View>
  );
}
const F = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#1A2530", marginBottom: 6 },
  opt: { fontWeight: "400", color: "#9AAFAF" },
  req: { color: "#ef4444" },
  input: {
    backgroundColor: "#F8F7F4", borderWidth: 1, borderColor: "#D5D0C8",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: "#1A2530",
  },
});

type PaymentMethod = {
  id: string;
  type: "card" | "bank";
  label: string;
  last4: string;
  subLabel: string;
};

function AddCardModal({ visible, onClose, onSave }: {
  visible: boolean; onClose: () => void; onSave: (m: PaymentMethod) => void;
}) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState("");

  function formatCardNumber(v: string) {
    return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpiry(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
  }

  function handleSave() {
    const digits = number.replace(/\s/g, "");
    if (!name.trim()) { setError("Name on card is required"); return; }
    if (digits.length < 15) { setError("Enter a valid card number"); return; }
    if (expiry.length < 5) { setError("Enter a valid expiry date"); return; }
    if (cvv.length < 3) { setError("Enter a valid CVV"); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      id: Date.now().toString(),
      type: "card",
      label: "•••• " + digits.slice(-4),
      last4: digits.slice(-4),
      subLabel: "Expires " + expiry,
    });
    setName(""); setNumber(""); setExpiry(""); setCvv(""); setError("");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={M.backdrop} onPress={onClose} />
        <View style={M.sheet}>
          <View style={M.handle} />
          <View style={M.sheetHead}>
            <Text style={M.sheetTitle}>Add Card</Text>
            <TouchableOpacity onPress={onClose} style={M.closeBtn}>
              <Ionicons name="close" size={18} color="#6B6B6B" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={M.body}>
              <View style={M.cardArt}>
                <Ionicons name="card" size={32} color="#fff" />
                <Text style={M.cardNum}>{number || "•••• •••• •••• ••••"}</Text>
                <View style={M.cardRow}>
                  <Text style={M.cardSub}>{name || "CARDHOLDER NAME"}</Text>
                  <Text style={M.cardSub}>{expiry || "MM/YY"}</Text>
                </View>
              </View>
              <View style={M.field}>
                <Text style={M.label}>Name on Card *</Text>
                <TextInput style={M.input} value={name} onChangeText={setName} placeholder="Alex Morgan" placeholderTextColor="#9AAFAF" autoCapitalize="words" />
              </View>
              <View style={M.field}>
                <Text style={M.label}>Card Number *</Text>
                <TextInput style={M.input} value={number} onChangeText={v => setNumber(formatCardNumber(v))} placeholder="0000 0000 0000 0000" placeholderTextColor="#9AAFAF" keyboardType="number-pad" />
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[M.field, { flex: 1 }]}>
                  <Text style={M.label}>Expiry *</Text>
                  <TextInput style={M.input} value={expiry} onChangeText={v => setExpiry(formatExpiry(v))} placeholder="MM/YY" placeholderTextColor="#9AAFAF" keyboardType="number-pad" maxLength={5} />
                </View>
                <View style={[M.field, { flex: 1 }]}>
                  <Text style={M.label}>CVV *</Text>
                  <TextInput style={M.input} value={cvv} onChangeText={setCvv} placeholder="•••" placeholderTextColor="#9AAFAF" keyboardType="number-pad" maxLength={4} secureTextEntry />
                </View>
              </View>
              {!!error && <Text style={M.error}>{error}</Text>}
              <TouchableOpacity style={M.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                <Text style={M.saveTxt}>Save Card</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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

  function handleSave() {
    if (!bankName.trim()) { setError("Bank name is required"); return; }
    if (routing.length !== 9) { setError("Routing number must be 9 digits"); return; }
    if (account.length < 4) { setError("Enter a valid account number"); return; }
    if (account !== confirm) { setError("Account numbers don't match"); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      id: Date.now().toString(),
      type: "bank",
      label: bankName.trim(),
      last4: account.slice(-4),
      subLabel: acctType.charAt(0).toUpperCase() + acctType.slice(1) + " •••• " + account.slice(-4),
    });
    setBankName(""); setRouting(""); setAccount(""); setConfirm(""); setError("");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={M.backdrop} onPress={onClose} />
        <View style={M.sheet}>
          <View style={M.handle} />
          <View style={M.sheetHead}>
            <Text style={M.sheetTitle}>Add Bank Account</Text>
            <TouchableOpacity onPress={onClose} style={M.closeBtn}>
              <Ionicons name="close" size={18} color="#6B6B6B" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={M.body}>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                {(["checking", "savings"] as const).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[M.typeBtn, acctType === t && M.typeBtnActive]}
                    onPress={() => setAcctType(t)}
                  >
                    <Feather name={t === "checking" ? "credit-card" : "dollar-sign"} size={15} color={acctType === t ? "#0D9E7E" : "#6B6B6B"} />
                    <Text style={[M.typeTxt, acctType === t && M.typeTxtActive]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={M.field}>
                <Text style={M.label}>Bank Name *</Text>
                <TextInput style={M.input} value={bankName} onChangeText={setBankName} placeholder="Chase, Bank of America…" placeholderTextColor="#9AAFAF" autoCapitalize="words" />
              </View>
              <View style={M.field}>
                <Text style={M.label}>Routing Number *</Text>
                <TextInput style={M.input} value={routing} onChangeText={setRouting} placeholder="9-digit routing number" placeholderTextColor="#9AAFAF" keyboardType="number-pad" maxLength={9} />
              </View>
              <View style={M.field}>
                <Text style={M.label}>Account Number *</Text>
                <TextInput style={M.input} value={account} onChangeText={setAccount} placeholder="Account number" placeholderTextColor="#9AAFAF" keyboardType="number-pad" secureTextEntry />
              </View>
              <View style={M.field}>
                <Text style={M.label}>Confirm Account Number *</Text>
                <TextInput style={M.input} value={confirm} onChangeText={setConfirm} placeholder="Re-enter account number" placeholderTextColor="#9AAFAF" keyboardType="number-pad" secureTextEntry />
              </View>
              {!!error && <Text style={M.error}>{error}</Text>}
              <TouchableOpacity style={M.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                <Text style={M.saveTxt}>Link Bank Account</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const M = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D5D0C8", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5E5" },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: "#1A2530" },
  closeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F3F3F3", alignItems: "center", justifyContent: "center" },
  body: { padding: 20, paddingBottom: 36 },
  cardArt: { backgroundColor: "#0D9E7E", borderRadius: 16, padding: 20, marginBottom: 20, gap: 12 },
  cardNum: { color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: 2 },
  cardRow: { flexDirection: "row", justifyContent: "space-between" },
  cardSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#1A2530", marginBottom: 6 },
  input: { backgroundColor: "#F8F7F4", borderWidth: 1, borderColor: "#D5D0C8", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: "#1A2530" },
  error: { color: "#EF4444", fontSize: 13, marginBottom: 12, textAlign: "center" },
  saveBtn: { backgroundColor: "#0D9E7E", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  saveTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: "#D5D0C8", backgroundColor: "#F8F7F4" },
  typeBtnActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E12" },
  typeTxt: { fontSize: 14, fontWeight: "600", color: "#6B6B6B" },
  typeTxtActive: { color: "#0D9E7E" },
});

export default function CompleteProfileScreen() {
  const { user } = useUser();
  const router = useRouter();
  const { phone: phoneParam } = useLocalSearchParams<{ phone?: string }>();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [phone, setPhone] = useState(phoneParam ?? "");

  const [guestEmail, setGuestEmail] = useState("");

  useEffect(() => {
    AsyncStorage.multiGet(["@chargebridge/driver_name", "@chargebridge/driver_email"]).then(pairs => {
      const guestName = pairs[0][1];
      const storedEmail = pairs[1][1];
      if (guestName && !firstName && !lastName) {
        const parts = guestName.trim().split(" ");
        setFirstName(prev => prev || (parts[0] ?? ""));
        setLastName(prev => prev || (parts.slice(1).join(" ")));
      }
      if (storedEmail) setGuestEmail(storedEmail);
    }).catch(() => {});
  }, []);
  const [dob, setDob] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [showCardModal, setShowCardModal] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);

  function formatPhone(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  function formatDob(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return d.slice(0, 2) + "/" + d.slice(2);
    return d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
  }

  async function handleShare() {
    try {
      await Share.share({
        message: "I'm using ChargeBridge to find independent EV charging stations and community gas prices near me. Join me! 🔋⚡",
        url: "https://chargebridge.app",
      });
    } catch { }
  }

  async function saveAndContinue() {
    if (step === 0) {
      if (!firstName.trim()) { setError("First name is required"); return; }
      setError("");
      setSaving(true);
      try {
        // Update name fields first — silently skip if not enabled in Clerk dashboard
        try {
          await user?.update({ firstName: firstName.trim(), lastName: lastName.trim() || undefined });
        } catch { /* name fields may not be configured */ }
        // Always save phone/dob (+ guest email if present) into unsafeMetadata
        await user?.update({
          unsafeMetadata: {
            ...(user?.unsafeMetadata ?? {}),
            phone,
            dob,
            ...(guestEmail && !user?.primaryEmailAddress?.emailAddress
              ? { guestEmail }
              : {}),
          },
        });
        // Clear guest AsyncStorage now that data is in Clerk
        AsyncStorage.multiRemove(["@chargebridge/driver_name", "@chargebridge/driver_email"]).catch(() => {});
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setStep(1);
      } catch (e: any) {
        setError(e?.errors?.[0]?.message ?? "Could not save info");
      } finally { setSaving(false); }
    } else if (step === 1) {
      setError("");
      setSaving(true);
      try {
        await user?.update({
          unsafeMetadata: {
            ...(user?.unsafeMetadata ?? {}),
            address: { street, city, state, zip },
          },
        });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setStep(2);
      } catch (e: any) {
        setError(e?.errors?.[0]?.message ?? "Could not save address");
      } finally { setSaving(false); }
    } else if (step === 2) {
      setError("");
      setSaving(true);
      try {
        await user?.update({
          unsafeMetadata: {
            ...(user?.unsafeMetadata ?? {}),
            paymentMethods,
          },
        });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setStep(3);
      } catch (e: any) {
        setError(e?.errors?.[0]?.message ?? "Could not save wallet");
      } finally { setSaving(false); }
    } else {
      router.replace(await resolveInitialRoute() as any);
    }
  }

  async function skip() {
    Haptics.selectionAsync();
    if (step < 3) setStep(step + 1);
    else router.replace(await resolveInitialRoute() as any);
  }

  const isIOS = Platform.OS === "ios";

  return (
    <KeyboardAvoidingView style={CP.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[CP.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 36 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={CP.logoRow}>
          <View style={CP.logoBox}>
            <Feather name="zap" size={24} color="#0D9E7E" />
          </View>
          <Text style={CP.brand}>ChargeBridge</Text>
        </View>

        {/* Progress */}
        <ProgressBar step={step} />

        {/* Step 0: Personal Info */}
        {step === 0 && (
          <View style={CP.card}>
            <View style={CP.cardHead}>
              <View style={[CP.stepIcon, { backgroundColor: "#0D9E7E18" }]}>
                <Feather name="user" size={20} color="#0D9E7E" />
              </View>
              <View>
                <Text style={CP.cardTitle}>Personal Info</Text>
                <Text style={CP.cardSub}>Tell us a bit about yourself</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="First Name" value={firstName} onChangeText={setFirstName} placeholder="Alex" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Last Name" value={lastName} onChangeText={setLastName} placeholder="Morgan" optional />
              </View>
            </View>
            <View style={F.wrap}>
              <Text style={F.label}>Phone Number<Text style={F.opt}> (optional)</Text></Text>
              <TextInput
                style={F.input}
                value={phone}
                onChangeText={v => setPhone(formatPhone(v))}
                placeholder="(555) 000-0000"
                placeholderTextColor="#9AAFAF"
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
            </View>
            <View style={F.wrap}>
              <Text style={F.label}>Date of Birth<Text style={F.opt}> (optional)</Text></Text>
              <TextInput
                style={F.input}
                value={dob}
                onChangeText={v => setDob(formatDob(v))}
                placeholder="MM/DD/YYYY"
                placeholderTextColor="#9AAFAF"
                keyboardType="number-pad"
                maxLength={10}
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        {/* Step 1: Address */}
        {step === 1 && (
          <View style={CP.card}>
            <View style={CP.cardHead}>
              <View style={[CP.stepIcon, { backgroundColor: "#3b82f618" }]}>
                <Feather name="map-pin" size={20} color="#3b82f6" />
              </View>
              <View>
                <Text style={CP.cardTitle}>Home Address</Text>
                <Text style={CP.cardSub}>Used to find stations near you</Text>
              </View>
            </View>
            <View style={F.wrap}>
              <Text style={F.label}>Street Address<Text style={F.opt}> (optional)</Text></Text>
              <TextInput
                style={F.input}
                value={street}
                onChangeText={setStreet}
                placeholder="123 Main St"
                placeholderTextColor="#9AAFAF"
              />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 2 }}>
                <View style={F.wrap}>
                  <Text style={F.label}>City<Text style={F.opt}> (optional)</Text></Text>
                  <TextInput style={F.input} value={city} onChangeText={setCity} placeholder="San Francisco" placeholderTextColor="#9AAFAF" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <View style={F.wrap}>
                  <Text style={F.label}>State<Text style={F.opt}> (optional)</Text></Text>
                  <TextInput style={F.input} value={state} onChangeText={setState} placeholder="CA" placeholderTextColor="#9AAFAF" autoCapitalize="characters" maxLength={2} />
                </View>
              </View>
            </View>
            <View style={F.wrap}>
              <Text style={F.label}>ZIP Code<Text style={F.opt}> (optional)</Text></Text>
              <TextInput
                style={F.input}
                value={zip}
                onChangeText={setZip}
                placeholder="94102"
                placeholderTextColor="#9AAFAF"
                keyboardType="number-pad"
                maxLength={5}
                autoCapitalize="none"
              />
            </View>
            <View style={[CP.infoBox, { backgroundColor: "#3b82f612" }]}>
              <Feather name="info" size={13} color="#3b82f6" />
              <Text style={[CP.infoTxt, { color: "#3b82f6" }]}>Your address is stored securely and only used to pre-fill location searches.</Text>
            </View>
          </View>
        )}

        {/* Step 2: Wallet */}
        {step === 2 && (
          <View style={CP.card}>
            <View style={CP.cardHead}>
              <View style={[CP.stepIcon, { backgroundColor: "#f59e0b18" }]}>
                <Ionicons name="wallet-outline" size={20} color="#f59e0b" />
              </View>
              <View>
                <Text style={CP.cardTitle}>Wallet & Payments</Text>
                <Text style={CP.cardSub}>Save payment methods for charging</Text>
              </View>
            </View>

            {/* Saved methods */}
            {paymentMethods.length > 0 && (
              <View style={CP.methodsList}>
                {paymentMethods.map(m => (
                  <View key={m.id} style={CP.methodRow}>
                    <View style={[CP.methodIcon, { backgroundColor: m.type === "card" ? "#0D9E7E18" : "#3b82f618" }]}>
                      <Ionicons name={m.type === "card" ? "card-outline" : "business-outline"} size={18} color={m.type === "card" ? "#0D9E7E" : "#3b82f6"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={CP.methodLabel}>{m.label}</Text>
                      <Text style={CP.methodSub}>{m.subLabel}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setPaymentMethods(prev => prev.filter(x => x.id !== m.id))}>
                      <Feather name="trash-2" size={15} color="#9AAFAF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add options */}
            <View style={CP.walletOptions}>
              {isIOS && (
                <TouchableOpacity style={[CP.walletBtn, { backgroundColor: "#000" }]} activeOpacity={0.85}>
                  <Ionicons name="logo-apple" size={18} color="#fff" />
                  <Text style={[CP.walletBtnTxt, { color: "#fff" }]}>Apple Pay</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[CP.walletBtn, { backgroundColor: "#0D9E7E18", borderColor: "#0D9E7E44", borderWidth: 1 }]}
                activeOpacity={0.85}
                onPress={() => setShowCardModal(true)}
              >
                <Ionicons name="card-outline" size={18} color="#0D9E7E" />
                <Text style={[CP.walletBtnTxt, { color: "#0D9E7E" }]}>Add Credit / Debit Card</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[CP.walletBtn, { backgroundColor: "#3b82f618", borderColor: "#3b82f644", borderWidth: 1 }]}
                activeOpacity={0.85}
                onPress={() => setShowBankModal(true)}
              >
                <Ionicons name="business-outline" size={18} color="#3b82f6" />
                <Text style={[CP.walletBtnTxt, { color: "#3b82f6" }]}>Add Bank Account</Text>
              </TouchableOpacity>
            </View>
            <View style={[CP.infoBox, { backgroundColor: "#f59e0b12" }]}>
              <Feather name="lock" size={13} color="#f59e0b" />
              <Text style={[CP.infoTxt, { color: "#a16207" }]}>Payment info is encrypted and stored securely in your profile.</Text>
            </View>
          </View>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <View style={CP.card}>
            <View style={CP.successCircle}>
              <Ionicons name="checkmark-circle" size={64} color="#0D9E7E" />
            </View>
            <Text style={CP.successTitle}>You're all set!</Text>
            <Text style={CP.successSub}>Welcome to ChargeBridge. Help your community by sharing the app with fellow EV drivers.</Text>

            <TouchableOpacity style={CP.shareBtn} onPress={handleShare} activeOpacity={0.85}>
              <Feather name="share-2" size={18} color="#0D9E7E" />
              <Text style={CP.shareTxt}>Share ChargeBridge</Text>
            </TouchableOpacity>

            <View style={[CP.infoBox, { backgroundColor: "#0D9E7E12", marginTop: 12 }]}>
              <Ionicons name="flash-outline" size={13} color="#0D9E7E" />
              <Text style={[CP.infoTxt, { color: "#0D9E7E" }]}>Find and rate independent EV chargers, compare gas prices, and save your favorite stations.</Text>
            </View>
          </View>
        )}

        {/* Error */}
        {!!error && (
          <View style={CP.errorBox}>
            <Feather name="alert-circle" size={14} color="#dc2626" />
            <Text style={CP.errorTxt}>{error}</Text>
          </View>
        )}

        {/* Continue button */}
        <TouchableOpacity style={CP.continueBtn} onPress={saveAndContinue} activeOpacity={0.85} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={CP.continueTxt}>{step === 3 ? "Get Started" : "Continue"}</Text>}
        </TouchableOpacity>

        {/* Skip */}
        {step < 3 && (
          <TouchableOpacity style={CP.skipBtn} onPress={skip}>
            <Text style={CP.skipTxt}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <AddCardModal
        visible={showCardModal}
        onClose={() => setShowCardModal(false)}
        onSave={m => { setPaymentMethods(prev => [...prev, m]); setShowCardModal(false); }}
      />
      <AddBankModal
        visible={showBankModal}
        onClose={() => setShowBankModal(false)}
        onSave={m => { setPaymentMethods(prev => [...prev, m]); setShowBankModal(false); }}
      />
    </KeyboardAvoidingView>
  );
}

const CP = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8F7F4" },
  scroll: { paddingHorizontal: 24 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 28 },
  logoBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#0D9E7E18", alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 20, fontWeight: "700", color: "#1A2530" },
  card: { backgroundColor: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  stepIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#1A2530", marginBottom: 2 },
  cardSub: { fontSize: 13, color: "#6B6B6B" },
  infoBox: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12, alignItems: "flex-start", marginTop: 8 },
  infoTxt: { fontSize: 12, flex: 1, lineHeight: 17 },
  methodsList: { marginBottom: 14, gap: 8 },
  methodRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F8F7F4", borderRadius: 12, padding: 12 },
  methodIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  methodLabel: { fontSize: 14, fontWeight: "700", color: "#1A2530" },
  methodSub: { fontSize: 12, color: "#6B6B6B", marginTop: 1 },
  walletOptions: { gap: 10 },
  walletBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  walletBtnTxt: { fontSize: 15, fontWeight: "600" },
  successCircle: { alignItems: "center", marginBottom: 16, marginTop: 4 },
  successTitle: { fontSize: 22, fontWeight: "800", color: "#1A2530", textAlign: "center", marginBottom: 8 },
  successSub: { fontSize: 14, color: "#6B6B6B", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: "#0D9E7E", backgroundColor: "#0D9E7E12" },
  shareTxt: { fontSize: 16, fontWeight: "700", color: "#0D9E7E" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorTxt: { fontSize: 13, color: "#dc2626", flex: 1 },
  continueBtn: { backgroundColor: "#0D9E7E", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 12 },
  continueTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  skipBtn: { alignItems: "center", paddingVertical: 12 },
  skipTxt: { fontSize: 14, color: "#9AAFAF", fontWeight: "500" },
});
