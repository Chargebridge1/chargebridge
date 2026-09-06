import React, { useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert, Platform,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type ChargerType = "Level1" | "Level2" | "DCFC";

const CHARGER_TYPES: { key: ChargerType; label: string }[] = [
  { key: "DCFC", label: "DC Fast (DCFC)" },
  { key: "Level2", label: "Level 2" },
  { key: "Level1", label: "Level 1" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export function AddStationModal({ visible, onClose, onAdded }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [chargerType, setChargerType] = useState<ChargerType>("Level2");
  const [powerKw, setPowerKw] = useState("7.2");
  const [pricePerKwh, setPricePerKwh] = useState("0.20");
  const [totalPorts, setTotalPorts] = useState("2");
  const [network, setNetwork] = useState("");
  const [locLoading, setLocLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function reset() {
    setName(""); setAddress(""); setCity(""); setState("");
    setLat(""); setLng(""); setChargerType("Level2");
    setPowerKw("7.2"); setPricePerKwh("0.20"); setTotalPorts("2"); setNetwork("");
    setFieldError(null); setSubmitted(false);
  }

  async function useMyLocation() {
    setLocLoading(true);
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { setFieldError("Location permission is required to auto-fill coordinates."); return; }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setFieldError(null);
      } else {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); resolve(); },
            () => { setFieldError("Could not get location."); reject(); }
          )
        );
      }
    } finally {
      setLocLoading(false);
    }
  }

  async function handleSubmit() {
    if (!name.trim()) { setFieldError("Station name is required."); return; }
    if (!address.trim()) { setFieldError("Address is required."); return; }
    if (!city.trim()) { setFieldError("City is required."); return; }
    if (!state.trim()) { setFieldError("State / Region is required."); return; }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setFieldError("Valid latitude and longitude are required. Tap 'Use My Location' or enter coordinates manually.");
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${BASE}/api/stations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          lat: latNum,
          lng: lngNum,
          chargerType,
          powerKw: parseFloat(powerKw) || 7.2,
          pricePerKwh: parseFloat(pricePerKwh) || 0,
          totalPorts: parseInt(totalPorts, 10) || 1,
          network: network.trim() || null,
          description: null,
        }),
      });
      if (!res.ok) throw new Error("Server error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      onAdded?.();
    } catch {
      setFieldError("Could not submit your station. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { reset(); onClose(); }}>
      <View style={[S.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>

        {/* ── Success state ── */}
        {submitted ? (
          <View style={S.successWrap}>
            <View style={[S.successIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="checkmark-circle" size={56} color={colors.primary} />
            </View>
            <Text style={[S.successTitle, { color: colors.foreground }]}>Submitted for Review</Text>
            <Text style={[S.successBody, { color: colors.mutedForeground }]}>
              Thank you! Your station has been submitted to the community directory.
              It will appear on the map after a brief review to ensure accuracy.
            </Text>
            <View style={[S.successBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={S.successRow}>
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={[S.successRowTxt, { color: colors.foreground }]}>Stations are reviewed within 24 hours</Text>
              </View>
              <View style={S.successRow}>
                <Ionicons name="people-outline" size={16} color={colors.primary} />
                <Text style={[S.successRowTxt, { color: colors.foreground }]}>Community members can verify and rate it</Text>
              </View>
              <View style={S.successRow}>
                <Ionicons name="notifications-outline" size={16} color={colors.primary} />
                <Text style={[S.successRowTxt, { color: colors.foreground }]}>You'll see it in the network once approved</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[S.successBtn, { backgroundColor: colors.primary }]}
              onPress={() => { reset(); onClose(); }}
              activeOpacity={0.85}
            >
              <Text style={S.successBtnTxt}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.successSecondaryBtn, { borderColor: colors.border }]}
              onPress={() => { setSubmitted(false); reset(); }}
              activeOpacity={0.8}
            >
              <Text style={[S.successSecondaryTxt, { color: colors.mutedForeground }]}>Add Another Station</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Header */}
            <View style={[S.header, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => { reset(); onClose(); }} style={S.cancelBtn}>
                <Text style={[S.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[S.title, { color: colors.foreground }]}>Add Station</Text>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting}
                style={[S.saveBtn, { backgroundColor: colors.primary }]}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={S.saveTxt}>Submit</Text>}
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 32 }]}
              keyboardShouldPersistTaps="handled"
            >
              {/* Inline field error */}
              {fieldError ? (
                <View style={[S.errorBanner, { backgroundColor: "#fef2f2", borderColor: "#fca5a5" }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                  <Text style={S.errorBannerTxt}>{fieldError}</Text>
                </View>
              ) : null}

              {/* Station info */}
              <Text style={[S.sectionLabel, { color: colors.mutedForeground }]}>STATION INFO</Text>
              <View style={[S.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Field label="Station Name *" value={name} onChangeText={(v) => { setName(v); setFieldError(null); }} placeholder="e.g. Community Center Charger" colors={colors} />
                <Divider colors={colors} />
                <Field label="Address *" value={address} onChangeText={(v) => { setAddress(v); setFieldError(null); }} placeholder="123 Main St" colors={colors} />
                <Divider colors={colors} />
                <View style={S.row2}>
                  <View style={{ flex: 1 }}>
                    <Field label="City *" value={city} onChangeText={(v) => { setCity(v); setFieldError(null); }} placeholder="Austin" colors={colors} noBottom />
                  </View>
                  <View style={[S.dividerV, { backgroundColor: colors.border }]} />
                  <View style={{ flex: 1 }}>
                    <Field label="State / Region *" value={state} onChangeText={(v) => { setState(v); setFieldError(null); }} placeholder="TX" colors={colors} noBottom />
                  </View>
                </View>
              </View>

              {/* Location */}
              <Text style={[S.sectionLabel, { color: colors.mutedForeground }]}>LOCATION</Text>
              <View style={[S.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[S.locBtn, { borderBottomColor: colors.border }]}
                  onPress={useMyLocation}
                  disabled={locLoading}
                >
                  {locLoading
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Feather name="navigation" size={15} color={colors.primary} />}
                  <Text style={[S.locBtnTxt, { color: colors.primary }]}>
                    {lat && lng ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : "Use My Location"}
                  </Text>
                </TouchableOpacity>
                <View style={S.row2}>
                  <View style={{ flex: 1 }}>
                    <Field label="Latitude" value={lat} onChangeText={(v) => { setLat(v); setFieldError(null); }} placeholder="30.2672" keyboardType="decimal-pad" colors={colors} noBottom />
                  </View>
                  <View style={[S.dividerV, { backgroundColor: colors.border }]} />
                  <View style={{ flex: 1 }}>
                    <Field label="Longitude" value={lng} onChangeText={(v) => { setLng(v); setFieldError(null); }} placeholder="-97.7431" keyboardType="decimal-pad" colors={colors} noBottom />
                  </View>
                </View>
              </View>

              {/* Charger specs */}
              <Text style={[S.sectionLabel, { color: colors.mutedForeground }]}>CHARGER SPECS</Text>
              <View style={[S.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={S.chargerTypeRow}>
                  {CHARGER_TYPES.map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      style={[
                        S.typePill,
                        chargerType === key
                          ? { backgroundColor: colors.primary }
                          : { backgroundColor: colors.muted, borderColor: colors.border },
                      ]}
                      onPress={() => { Haptics.selectionAsync(); setChargerType(key); }}
                    >
                      <Text style={[S.typePillTxt, { color: chargerType === key ? "#fff" : colors.mutedForeground }]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Divider colors={colors} />
                <View style={S.row3}>
                  <View style={{ flex: 1 }}>
                    <Field label="Power (kW)" value={powerKw} onChangeText={setPowerKw} placeholder="7.2" keyboardType="decimal-pad" colors={colors} noBottom />
                  </View>
                  <View style={[S.dividerV, { backgroundColor: colors.border }]} />
                  <View style={{ flex: 1 }}>
                    <Field label="Price ($/kWh)" value={pricePerKwh} onChangeText={setPricePerKwh} placeholder="0.20" keyboardType="decimal-pad" colors={colors} noBottom />
                  </View>
                  <View style={[S.dividerV, { backgroundColor: colors.border }]} />
                  <View style={{ flex: 1 }}>
                    <Field label="Total Ports" value={totalPorts} onChangeText={setTotalPorts} placeholder="2" keyboardType="number-pad" colors={colors} noBottom />
                  </View>
                </View>
              </View>

              {/* Optional */}
              <Text style={[S.sectionLabel, { color: colors.mutedForeground }]}>OPTIONAL</Text>
              <View style={[S.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Field label="Network / Operator" value={network} onChangeText={setNetwork} placeholder="e.g. ChargePoint, Tesla, etc." colors={colors} />
              </View>

              <Text style={[S.reviewNote, { color: colors.mutedForeground }]}>
                ⓘ  Submissions are reviewed by the community before appearing on the map.
              </Text>

              <TouchableOpacity
                style={[S.submitBtn, { backgroundColor: colors.primary }]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Ionicons name="add-circle-outline" size={18} color="#fff" />
                      <Text style={S.submitBtnTxt}>Submit for Community Review</Text>
                    </>}
              </TouchableOpacity>
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

function Divider({ colors }: { colors: ReturnType<typeof useColors> }) {
  return <View style={[S.divider, { backgroundColor: colors.border }]} />;
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, colors, noBottom,
}: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: "default" | "decimal-pad" | "number-pad";
  colors: ReturnType<typeof useColors>; noBottom?: boolean;
}) {
  return (
    <View style={[S.field, noBottom && { borderBottomWidth: 0 }]}>
      <Text style={[S.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[S.fieldInput, { color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground + "88"}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={keyboardType ? "none" : "words"}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  cancelBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  cancelTxt: { fontSize: 15, fontFamily: "Inter_400Regular" },
  saveBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, minWidth: 72, alignItems: "center" },
  saveTxt: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },
  errorBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 16,
  },
  errorBannerTxt: {
    flex: 1, fontSize: 13, color: "#ef4444", fontFamily: "Inter_400Regular", lineHeight: 18,
  },
  fieldGroup: {
    borderRadius: 14, borderWidth: 1, marginBottom: 20, overflow: "hidden",
  },
  field: {
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  fieldInput: { fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: StyleSheet.hairlineWidth },
  dividerV: { width: StyleSheet.hairlineWidth },
  row2: { flexDirection: "row", alignItems: "stretch" },
  row3: { flexDirection: "row", alignItems: "stretch" },
  locBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  locBtnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  chargerTypeRow: {
    flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap",
  },
  typePill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1,
  },
  typePillTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  reviewNote: {
    fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17,
    marginTop: -8, marginBottom: 16, paddingHorizontal: 4,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 14, paddingVertical: 15, marginTop: 8,
  },
  submitBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  // Success screen
  successWrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 28, gap: 14,
  },
  successIcon: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  successTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center" },
  successBody: {
    fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center",
    lineHeight: 21, maxWidth: 300,
  },
  successBox: {
    width: "100%", borderRadius: 14, borderWidth: 1, padding: 16, gap: 12, marginTop: 4,
  },
  successRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  successRowTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  successBtn: {
    width: "100%", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginTop: 8,
  },
  successBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  successSecondaryBtn: {
    width: "100%", borderRadius: 14, paddingVertical: 13,
    alignItems: "center", borderWidth: 1,
  },
  successSecondaryTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
