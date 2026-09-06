import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useUser, useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { VehiclePickerModal } from "@/components/VehiclePickerModal";
import type { Vehicle } from "@/components/VehiclePickerModal";
import { getPlugTypesForVehicle as lookupPlugTypes } from "@/constants/VehicleDatabase";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

const PLUG_TYPE_OPTIONS = ["NACS", "CCS", "CHAdeMO", "J1772"];
const VEHICLE_COLORS = ["White", "Black", "Silver", "Gray", "Red", "Blue", "Green", "Gold", "Brown", "Orange"];

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={EP.field}>
      <Text style={EP.fieldLbl}>{label}</Text>
      {children}
    </View>
  );
}

interface StoredVehicle {
  id: number;
  make: string | null;
  model: string | null;
  year: string | null;
  nickname: string | null;
  connectorType: string | null;
  plugTypes: string[] | null;
  color: string | null;
  batteryKwh: number | null;
  rangePerCharge: number | null;
  isPrimary: boolean;
}

export default function EditProfileScreen() {
  const { user } = useUser();
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const meta = user?.unsafeMetadata as Record<string, any> | undefined;
  const addrMeta = meta?.address as Record<string, string> | undefined;

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [phone, setPhone] = useState((meta?.phone as string) ?? "");
  const [dob, setDob] = useState((meta?.dob as string) ?? "");
  const [street, setStreet] = useState(addrMeta?.street ?? "");
  const [city, setCity] = useState(addrMeta?.city ?? "");
  const [stateVal, setStateVal] = useState(addrMeta?.state ?? "");
  const [zip, setZip] = useState(addrMeta?.zip ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [primaryVehicle, setPrimaryVehicle] = useState<StoredVehicle | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [vehicleNickname, setVehicleNickname] = useState("");
  const [vehiclePlugTypes, setVehiclePlugTypes] = useState<string[]>([]);
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleSaved, setVehicleSaved] = useState(false);
  const [vehicleError, setVehicleError] = useState("");

  useEffect(() => {
    if (!isSignedIn) return;
    getToken().then((token) => {
      if (!token) return;
      fetch(`${BASE}/api/me/vehicles`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((vehicles: StoredVehicle[]) => {
          const primary = vehicles.find((v) => v.isPrimary) ?? vehicles[0] ?? null;
          if (primary) {
            setPrimaryVehicle(primary);
            setVehicleNickname(primary.nickname ?? "");
            setVehiclePlugTypes(primary.plugTypes ?? []);
            setVehicleColor(primary.color ?? "");
          }
        })
        .catch(() => {});
    });
  }, [isSignedIn]);

  async function save() {
    if (!firstName.trim()) { setError("First name is required"); return; }
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      try {
        await user?.update({ firstName: firstName.trim(), lastName: lastName.trim() || undefined });
      } catch { }
      await user?.update({
        unsafeMetadata: {
          ...(user?.unsafeMetadata ?? {}),
          phone,
          dob,
          address: { street, city, state: stateVal, zip },
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      setTimeout(() => router.back(), 900);
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  async function saveVehicle() {
    setVehicleError("");
    setVehicleSaved(false);
    setVehicleSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      if (primaryVehicle) {
        const res = await fetch(`${BASE}/api/me/vehicles/${primaryVehicle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            nickname: vehicleNickname.trim() || null,
            plugTypes: vehiclePlugTypes,
            color: vehicleColor.trim() || null,
            make: primaryVehicle.make,
            model: primaryVehicle.model,
            year: primaryVehicle.year,
            connectorType: primaryVehicle.connectorType,
            batteryKwh: primaryVehicle.batteryKwh,
            rangePerCharge: primaryVehicle.rangePerCharge,
          }),
        });
        if (!res.ok) throw new Error("Failed to save vehicle");
        const updated = await res.json();
        setPrimaryVehicle(updated);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVehicleSaved(true);
      setTimeout(() => setVehicleSaved(false), 3000);
    } catch (e: any) {
      setVehicleError(e?.message ?? "Could not save vehicle");
    } finally {
      setVehicleSaving(false);
    }
  }

  async function onVehiclePicked(v: Vehicle) {
    setShowVehiclePicker(false);
    const plugTypes = [
      ...(v.dcConnector ? [v.dcConnector] : []),
      ...(v.acConnector && v.acConnector !== v.dcConnector ? [v.acConnector] : []),
    ].filter(Boolean);
    const token = await getToken();
    if (!token) return;
    if (primaryVehicle) {
      const res = await fetch(`${BASE}/api/me/vehicles/${primaryVehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          make: v.make,
          model: v.model,
          year: v.yearRange,
          connectorType: v.dcConnector ?? v.acConnector ?? null,
          fuelType: v.fuelCategory === "electric" ? "electric" : v.fuelCategory === "phev_hybrid" ? "hybrid" : v.fuelType ?? null,
          plugTypes,
          nickname: vehicleNickname.trim() || null,
          color: vehicleColor.trim() || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPrimaryVehicle(updated);
        setVehiclePlugTypes(updated.plugTypes ?? plugTypes);
      }
    } else {
      const res = await fetch(`${BASE}/api/me/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          make: v.make,
          model: v.model,
          year: v.yearRange,
          connectorType: v.dcConnector ?? v.acConnector ?? null,
          fuelType: v.fuelCategory === "electric" ? "electric" : v.fuelCategory === "phev_hybrid" ? "hybrid" : v.fuelType ?? null,
          plugTypes,
          nickname: vehicleNickname.trim() || null,
          color: vehicleColor.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        await fetch(`${BASE}/api/me/vehicles/${created.id}/primary`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        setPrimaryVehicle({ ...created, isPrimary: true });
        setVehiclePlugTypes(created.plugTypes ?? plugTypes);
      }
    }
  }

  function togglePlugType(pt: string) {
    setVehiclePlugTypes((prev) =>
      prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]
    );
  }

  return (
    <KeyboardAvoidingView style={EP.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[EP.topBar, { paddingTop: topPad + 8, paddingBottom: 12 }]}>
        <TouchableOpacity style={EP.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color="#1A2530" />
        </TouchableOpacity>
        <Text style={EP.topTitle}>Edit Profile</Text>
        <TouchableOpacity
          style={[EP.saveChip, saving && { opacity: 0.55 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={EP.saveChipTxt}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={EP.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {saved && (
          <View style={EP.successBanner}>
            <Ionicons name="checkmark-circle" size={15} color="#059669" />
            <Text style={EP.successTxt}>Profile updated!</Text>
          </View>
        )}

        {/* Personal Info */}
        <Text style={EP.sectionLabel}>Personal Info</Text>
        <View style={EP.card}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="First Name *">
                <TextInput
                  style={EP.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor="#9AAFAF"
                  autoCapitalize="words"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Last Name">
                <TextInput
                  style={EP.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor="#9AAFAF"
                  autoCapitalize="words"
                />
              </Field>
            </View>
          </View>

          <Field label="Phone Number">
            <TextInput
              style={EP.input}
              value={phone}
              onChangeText={v => setPhone(formatPhone(v))}
              placeholder="(555) 000-0000"
              placeholderTextColor="#9AAFAF"
              keyboardType="phone-pad"
              maxLength={14}
            />
          </Field>

          <Field label="Date of Birth">
            <TextInput
              style={EP.input}
              value={dob}
              onChangeText={v => setDob(formatDob(v))}
              placeholder="MM/DD/YYYY"
              placeholderTextColor="#9AAFAF"
              keyboardType="number-pad"
              maxLength={10}
            />
          </Field>
        </View>

        {/* Address */}
        <Text style={EP.sectionLabel}>Home Address</Text>
        <View style={EP.card}>
          <Field label="Street">
            <TextInput
              style={EP.input}
              value={street}
              onChangeText={setStreet}
              placeholder="123 Main St"
              placeholderTextColor="#9AAFAF"
              autoCapitalize="words"
            />
          </Field>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 2 }}>
              <Field label="City">
                <TextInput
                  style={EP.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="City"
                  placeholderTextColor="#9AAFAF"
                  autoCapitalize="words"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="State">
                <TextInput
                  style={EP.input}
                  value={stateVal}
                  onChangeText={v => setStateVal(v.toUpperCase().slice(0, 2))}
                  placeholder="CA"
                  placeholderTextColor="#9AAFAF"
                  autoCapitalize="characters"
                  maxLength={2}
                />
              </Field>
            </View>
          </View>

          <Field label="ZIP Code">
            <TextInput
              style={EP.input}
              value={zip}
              onChangeText={v => setZip(v.replace(/\D/g, "").slice(0, 5))}
              placeholder="90210"
              placeholderTextColor="#9AAFAF"
              keyboardType="number-pad"
              maxLength={5}
            />
          </Field>
        </View>

        {/* Vehicle */}
        <Text style={EP.sectionLabel}>My Vehicle</Text>
        <View style={EP.card}>
          {vehicleSaved && (
            <View style={[EP.successBanner, { marginBottom: 12 }]}>
              <Ionicons name="checkmark-circle" size={15} color="#059669" />
              <Text style={EP.successTxt}>Vehicle saved!</Text>
            </View>
          )}

          <TouchableOpacity style={EP.vehiclePickRow} onPress={() => setShowVehiclePicker(true)} activeOpacity={0.85}>
            <View style={EP.vehiclePickIcon}>
              <Ionicons name="car-outline" size={22} color="#0D9E7E" />
            </View>
            <View style={{ flex: 1 }}>
              {primaryVehicle?.make ? (
                <>
                  <Text style={EP.vehicleName}>{primaryVehicle.make} {primaryVehicle.model}</Text>
                  <Text style={EP.vehicleSub}>{primaryVehicle.year} · Tap to change</Text>
                </>
              ) : (
                <Text style={EP.vehiclePlaceholder}>Tap to add your vehicle</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9AAFAF" />
          </TouchableOpacity>

          <Field label="Nickname">
            <TextInput
              style={EP.input}
              value={vehicleNickname}
              onChangeText={setVehicleNickname}
              placeholder='e.g. "My Tesla"'
              placeholderTextColor="#9AAFAF"
              maxLength={40}
            />
          </Field>

          <View style={EP.field}>
            <Text style={EP.fieldLbl}>Connector Types</Text>
            <View style={EP.plugRow}>
              {PLUG_TYPE_OPTIONS.map((pt) => {
                const active = vehiclePlugTypes.includes(pt);
                return (
                  <TouchableOpacity
                    key={pt}
                    style={[EP.plugChip, active && EP.plugChipActive]}
                    onPress={() => togglePlugType(pt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[EP.plugChipTxt, active && EP.plugChipTxtActive]}>{pt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={EP.field}>
            <Text style={EP.fieldLbl}>Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingVertical: 2, paddingHorizontal: 2 }}>
                {VEHICLE_COLORS.map((c) => {
                  const active = vehicleColor.toLowerCase() === c.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[EP.colorChip, active && EP.colorChipActive]}
                      onPress={() => setVehicleColor(active ? "" : c)}
                      activeOpacity={0.8}
                    >
                      <Text style={[EP.colorChipTxt, active && EP.colorChipTxtActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {!!vehicleError && (
            <View style={[EP.errorBox, { marginBottom: 8 }]}>
              <Feather name="alert-circle" size={14} color="#dc2626" />
              <Text style={EP.errorTxt}>{vehicleError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[EP.vehicleSaveBtn, vehicleSaving && { opacity: 0.55 }]}
            onPress={saveVehicle}
            disabled={vehicleSaving}
            activeOpacity={0.85}
          >
            {vehicleSaving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={EP.vehicleSaveBtnTxt}>Save Vehicle</Text>}
          </TouchableOpacity>
        </View>

        <View style={EP.infoBox}>
          <Feather name="info" size={13} color="#6B6B6B" />
          <Text style={EP.infoTxt}>
            Your email address is managed by your Clerk account and cannot be changed here. To manage payment methods, visit your Profile tab.
          </Text>
        </View>

        {!!error && (
          <View style={EP.errorBox}>
            <Feather name="alert-circle" size={14} color="#dc2626" />
            <Text style={EP.errorTxt}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <VehiclePickerModal
        visible={showVehiclePicker}
        onClose={() => setShowVehiclePicker(false)}
        onSelect={onVehiclePicked}
        initialCategory="electric"
      />
    </KeyboardAvoidingView>
  );
}

const EP = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8F7F4" },
  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5E5",
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#F3F3F3", alignItems: "center", justifyContent: "center",
    marginRight: 10,
  },
  topTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: "#1A2530", fontFamily: "Inter_700Bold" },
  saveChip: {
    backgroundColor: "#0D9E7E", borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 56, alignItems: "center",
  },
  saveChipTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  scroll: { padding: 20, paddingBottom: 60 },

  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#d1fae5", borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: "#6ee7b7",
  },
  successTxt: { fontSize: 13, color: "#059669", fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  sectionLabel: {
    fontSize: 13, fontWeight: "700", color: "#6B6B6B", fontFamily: "Inter_700Bold",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 4,
  },
  card: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 20,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },

  field: { marginBottom: 14 },
  fieldLbl: { fontSize: 13, fontWeight: "600", color: "#1A2530", marginBottom: 6, fontFamily: "Inter_600SemiBold" },
  input: {
    backgroundColor: "#F8F7F4", borderWidth: 1, borderColor: "#D5D0C8",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: "#1A2530",
  },

  vehiclePickRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#F8F7F4", borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "#D5D0C8",
  },
  vehiclePickIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#0D9E7E22", alignItems: "center", justifyContent: "center",
  },
  vehicleName: { fontSize: 15, fontWeight: "700", color: "#1A2530", fontFamily: "Inter_700Bold" },
  vehicleSub: { fontSize: 12, color: "#6B6B6B", marginTop: 1, fontFamily: "Inter_400Regular" },
  vehiclePlaceholder: { fontSize: 15, color: "#9AAFAF", fontFamily: "Inter_400Regular" },

  plugRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  plugChip: {
    borderWidth: 1.5, borderColor: "#D5D0C8", borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#F8F7F4",
  },
  plugChipActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E22" },
  plugChipTxt: { fontSize: 13, fontWeight: "600", color: "#6B6B6B", fontFamily: "Inter_600SemiBold" },
  plugChipTxtActive: { color: "#0D9E7E" },

  colorChip: {
    borderWidth: 1.5, borderColor: "#D5D0C8", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#F8F7F4",
  },
  colorChipActive: { borderColor: "#0D9E7E", backgroundColor: "#0D9E7E22" },
  colorChipTxt: { fontSize: 13, fontWeight: "600", color: "#6B6B6B", fontFamily: "Inter_600SemiBold" },
  colorChipTxtActive: { color: "#0D9E7E" },

  vehicleSaveBtn: {
    backgroundColor: "#0D9E7E", borderRadius: 10, paddingVertical: 12,
    alignItems: "center", marginTop: 4,
  },
  vehicleSaveBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  infoBox: {
    flexDirection: "row", gap: 8, backgroundColor: "#F3F3F3",
    borderRadius: 12, padding: 12, marginBottom: 16, alignItems: "flex-start",
  },
  infoTxt: { fontSize: 12, color: "#6B6B6B", flex: 1, lineHeight: 17, fontFamily: "Inter_400Regular" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#fecaca",
  },
  errorTxt: { fontSize: 13, color: "#dc2626", flex: 1, fontFamily: "Inter_400Regular" },
});
