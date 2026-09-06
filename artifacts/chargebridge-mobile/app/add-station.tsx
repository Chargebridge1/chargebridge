import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCreateStation } from "@/lib/api-client";

const CHARGER_TYPES = [
  { key: "Level2", label: "Level 2", sub: "240V AC · Home/Destination" },
  { key: "DCFC",   label: "DC Fast",  sub: "DC rapid charge" },
  { key: "Level1", label: "Level 1",  sub: "120V AC · Slow" },
] as const;

type ChargerType = "Level1" | "Level2" | "DCFC";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

async function geocodeAddress(address: string, city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = [address, city, state].filter(Boolean).join(", ");
    const url = `${BASE}/api/geocode?q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

function FieldLabel({ children }: { children: string }) {
  const colors = useColors();
  return <Text style={[S.label, { color: colors.mutedForeground }]}>{children}</Text>;
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, multiline, lines,
  editable = true, rightAction,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean;
  lines?: number; editable?: boolean; rightAction?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={S.fieldWrap}>
      <FieldLabel>{label}</FieldLabel>
      <View style={[S.inputRow, { backgroundColor: editable ? colors.card : colors.muted, borderColor: colors.border }]}>
        <TextInput
          style={[S.input, { color: editable ? colors.foreground : colors.mutedForeground }, multiline && { height: (lines ?? 3) * 22, textAlignVertical: "top" }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType ?? "default"}
          multiline={multiline}
          numberOfLines={lines}
          editable={editable}
          returnKeyType="next"
        />
        {rightAction}
      </View>
    </View>
  );
}

export default function AddStationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const qc = useQueryClient();
  const createStation = useCreateStation();

  const [name, setName]           = useState("");
  const [address, setAddress]     = useState("");
  const [city, setCity]           = useState("");
  const [state, setState]         = useState("");
  const [lat, setLat]             = useState("");
  const [lng, setLng]             = useState("");
  const [chargerType, setChargerType] = useState<ChargerType>("Level2");
  const [powerKw, setPowerKw]     = useState("7.2");
  const [price, setPrice]         = useState("0.20");
  const [ports, setPorts]         = useState("2");
  const [description, setDescription] = useState("");
  const [network, setNetwork]     = useState("");

  const [locLoading, setLocLoading]   = useState(false);
  const [geoLoading, setGeoLoading]   = useState(false);
  const [locSource, setLocSource]     = useState<"none" | "gps" | "address">("none");
  const [submitting, setSubmitting]   = useState(false);
  const [formError, setFormError]     = useState<string | null>(null);
  const [submitted, setSubmitted]     = useState(false);

  async function handleDetectLocation() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocLoading(true);
    setLocSource("none");
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { Alert.alert("Permission denied", "Location access is needed."); setLocLoading(false); return; }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        const rev = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }).catch(() => []);
        if (rev[0]) {
          if (!address && rev[0].street) setAddress(rev[0].street);
          if (!city && rev[0].city) setCity(rev[0].city);
          if (!state && (rev[0].region || rev[0].isoCountryCode)) setState(rev[0].region ?? rev[0].isoCountryCode ?? "");
        }
        setLocSource("gps");
      } else {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setLocSource("gps"); resolve(); },
            () => { Alert.alert("Error", "Could not get location."); reject(); }
          )
        );
      }
    } catch {
      Alert.alert("Error", "Could not get location.");
    } finally {
      setLocLoading(false);
    }
  }

  async function handleGeocodeAddress() {
    if (!address.trim() && !city.trim()) {
      Alert.alert("Enter address first", "Fill in at least the address or city before geocoding.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGeoLoading(true);
    const result = await geocodeAddress(address, city, state);
    setGeoLoading(false);
    if (result) {
      setLat(result.lat.toFixed(6));
      setLng(result.lng.toFixed(6));
      setLocSource("address");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setFormError("Could not geocode that address. Try to be more specific or enter coordinates manually.");
    }
  }

  function validate(): string | null {
    if (!name.trim() || name.trim().length < 2) return "Station name must be at least 2 characters.";
    if (!address.trim()) return "Street address is required.";
    if (!city.trim()) return "City is required.";
    if (!state.trim()) return "State / Region is required.";
    const latN = parseFloat(lat), lngN = parseFloat(lng);
    if (isNaN(latN) || latN < -90 || latN > 90) return "Valid latitude (−90 to 90) is required.";
    if (isNaN(lngN) || lngN < -180 || lngN > 180) return "Valid longitude (−180 to 180) is required.";
    if (isNaN(parseFloat(powerKw)) || parseFloat(powerKw) <= 0) return "Power (kW) must be a positive number.";
    if (isNaN(parseFloat(price)) || parseFloat(price) < 0) return "Price must be 0 or more.";
    if (isNaN(parseInt(ports)) || parseInt(ports) < 1) return "Number of ports must be at least 1.";
    return null;
  }

  function handleSubmit() {
    setFormError(null);
    const err = validate();
    if (err) { setFormError(err); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    createStation.mutate(
      {
        data: {
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          chargerType,
          powerKw: parseFloat(powerKw),
          pricePerKwh: parseFloat(price),
          totalPorts: parseInt(ports),
          description: description.trim() || null,
          network: network.trim() || null,
        },
      },
      {
        onSuccess: (station) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          qc.invalidateQueries({ queryKey: ["listStations"] });
          setSubmitted(true);
          setTimeout(() => router.replace(`/station/db-${station.id}` as any), 2500);
        },
        onError: () => {
          setSubmitting(false);
          setFormError("Could not add station. Please try again.");
        },
      }
    );
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 36 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#22c55e14", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <Ionicons name="checkmark-circle" size={52} color="#22c55e" />
        </View>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground, textAlign: "center", marginBottom: 10, fontFamily: "Inter_700Bold" }}>Submitted for review!</Text>
        <Text style={{ fontSize: 15, color: colors.mutedForeground, textAlign: "center", lineHeight: 22 }}>
          Your station has been submitted and will appear in the community directory after a quick review. Opening it now…
        </Text>
        <ActivityIndicator style={{ marginTop: 28 }} color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Nav bar */}
      <View style={[S.nav, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={[S.backBtn, { backgroundColor: colors.muted }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>Add Station</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 34 : insets.bottom + 32 }}>
        {/* Intro */}
        <View style={[S.heroBanner, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "28" }]}>
          <Ionicons name="flash" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[S.heroTitle, { color: colors.foreground }]}>Add a charging station</Text>
            <Text style={[S.heroSub, { color: colors.mutedForeground }]}>
              Help the community by listing an independent EV charger
            </Text>
          </View>
        </View>

        {/* Station name */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Station Details</Text>
          <Field label="Station name *" value={name} onChangeText={setName} placeholder="e.g. East Side Community Charger" />
          <Field label="Network / Operator" value={network} onChangeText={setNetwork} placeholder="e.g. Community EV Network (optional)" />
          <Field label="Description" value={description} onChangeText={setDescription}
            placeholder="Hours, access notes, parking info…" multiline lines={3} />
        </View>

        {/* Location */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Location</Text>

          <View style={S.locButtons}>
            <TouchableOpacity
              style={[S.locBtn, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={handleDetectLocation}
              disabled={locLoading}
            >
              {locLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="crosshair" size={14} color="#fff" />}
              <Text style={S.locBtnTxt}>Use My Location</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.locBtn, { backgroundColor: colors.muted, flex: 1 }]}
              onPress={handleGeocodeAddress}
              disabled={geoLoading}
            >
              {geoLoading ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="map-pin" size={14} color={colors.foreground} />}
              <Text style={[S.locBtnTxt, { color: colors.foreground }]}>Fill from Address</Text>
            </TouchableOpacity>
          </View>

          {locSource !== "none" && (
            <View style={[S.locSuccess, { backgroundColor: "#22c55e14", borderColor: "#22c55e40" }]}>
              <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
              <Text style={[S.locSuccessTxt, { color: "#22c55e" }]}>
                {locSource === "gps" ? "Location set from GPS" : "Coordinates filled from address"}
              </Text>
            </View>
          )}

          <Field label="Street address *" value={address} onChangeText={setAddress} placeholder="123 Main St" />
          <View style={S.rowTwo}>
            <View style={{ flex: 1 }}>
              <Field label="City *" value={city} onChangeText={setCity} placeholder="e.g. Austin" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="State / Region *" value={state} onChangeText={setState} placeholder="e.g. TX, Bavaria" />
            </View>
          </View>
          <View style={S.rowTwo}>
            <View style={{ flex: 1 }}>
              <Field label="Latitude *" value={lat} onChangeText={setLat} placeholder="e.g. 30.2672" keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Longitude *" value={lng} onChangeText={setLng} placeholder="e.g. -97.7431" keyboardType="decimal-pad" />
            </View>
          </View>
        </View>

        {/* Charger specs */}
        <View style={[S.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>Charger Specs</Text>

          <FieldLabel>Charger type *</FieldLabel>
          <View style={S.typeRow}>
            {CHARGER_TYPES.map((ct) => {
              const active = chargerType === ct.key;
              return (
                <TouchableOpacity
                  key={ct.key}
                  style={[S.typeCard, {
                    backgroundColor: active ? colors.primary + "18" : colors.muted,
                    borderColor: active ? colors.primary : colors.border,
                  }]}
                  onPress={() => { Haptics.selectionAsync(); setChargerType(ct.key); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="flash" size={16} color={active ? colors.primary : colors.mutedForeground} />
                  <Text style={[S.typeLabel, { color: active ? colors.primary : colors.foreground }]}>{ct.label}</Text>
                  <Text style={[S.typeSub, { color: colors.mutedForeground }]}>{ct.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={S.rowTwo}>
            <View style={{ flex: 1 }}>
              <Field label="Power output (kW) *" value={powerKw} onChangeText={setPowerKw} keyboardType="decimal-pad" placeholder="7.2" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Price per kWh ($) *" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.20" />
            </View>
          </View>

          <Field label="Number of ports *" value={ports} onChangeText={setPorts} keyboardType="number-pad" placeholder="2" />
        </View>

        {/* Inline form error */}
        {formError && (
          <View style={{ backgroundColor: "#fef2f2", borderRadius: 10, borderWidth: 1, borderColor: "#fecaca", padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="alert-circle" size={16} color="#ef4444" />
            <Text style={{ flex: 1, fontSize: 13, color: "#ef4444" }}>{formError}</Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[S.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="flash" size={18} color="#fff" />
          )}
          <Text style={S.submitTxt}>{submitting ? "Adding station…" : "Add Station"}</Text>
        </TouchableOpacity>

        <Text style={[S.disclaimer, { color: colors.mutedForeground }]}>
          By adding a station you confirm it is an independent charger and the details are accurate to the best of your knowledge.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  nav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  backBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  heroBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14,
  },
  heroTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: {
    borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 14,
    shadowColor: "#1A2530", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2,
  },
  sectionTitle: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 14, opacity: 0.5 },
  fieldWrap: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  inputRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 11 },
  rowTwo: { flexDirection: "row", gap: 10 },
  locButtons: { flexDirection: "row", gap: 8, marginBottom: 12 },
  locBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
  },
  locBtnTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#fff" },
  locSuccess: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 12,
  },
  locSuccessTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  typeCard: {
    flex: 1, borderRadius: 16, borderWidth: 1.5, padding: 12,
    alignItems: "center", gap: 4,
  },
  typeLabel: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  typeSub: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 14, paddingVertical: 15, marginBottom: 12,
  },
  submitTxt: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },
  disclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
});
