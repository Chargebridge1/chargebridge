import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Platform, KeyboardAvoidingView,
  Alert,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useUser } from "@clerk/expo";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type Driver = { id: number; vehicleId: number; driverEmail: string; driverName: string | null; assignedAt: string } | null;

type Vehicle = {
  id: number;
  nickname: string;
  make: string | null;
  model: string | null;
  year: string | null;
  licensePlate: string | null;
  vin: string | null;
  color: string | null;
  status: "active" | "inactive";
  driver: Driver;
};

type FleetData =
  | { role: "owner"; vehicles: Vehicle[] }
  | { role: "driver"; vehicle: Vehicle }
  | { role: "none"; vehicles: [] };

type Stage = "list" | "add_vehicle" | "edit_vehicle" | "assign_driver";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899", "#64748b"];

function vehicleIcon(make: string | null) {
  const m = (make ?? "").toLowerCase();
  if (m.includes("tesla")) return "flash";
  if (m.includes("truck") || m.includes("ford") || m.includes("chevy") || m.includes("ram")) return "car-sport";
  return "car-outline";
}

function VehicleCard({
  vehicle,
  isOwner,
  onEdit,
  onAssignDriver,
  onRemoveDriver,
  onDelete,
  colors,
}: {
  vehicle: Vehicle;
  isOwner: boolean;
  onEdit: (v: Vehicle) => void;
  onAssignDriver: (v: Vehicle) => void;
  onRemoveDriver: (v: Vehicle) => void;
  onDelete: (v: Vehicle) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const tint = vehicle.status === "active" ? "#22c55e" : "#94a3b8";
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle";

  return (
    <View style={[VS.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={VS.row}>
        <View style={[VS.icon, { backgroundColor: tint + "20" }]}>
          <Ionicons name={vehicleIcon(vehicle.make) as any} size={22} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[VS.nickname, { color: colors.foreground }]}>{vehicle.nickname}</Text>
          <Text style={[VS.sub, { color: colors.mutedForeground }]}>{label}</Text>
          {vehicle.licensePlate && (
            <Text style={[VS.plate, { color: colors.mutedForeground }]}>
              🔲 {vehicle.licensePlate}
            </Text>
          )}
        </View>
        <View style={[VS.statusPill, { backgroundColor: tint + "18" }]}>
          <Text style={[VS.statusTxt, { color: tint }]}>{vehicle.status}</Text>
        </View>
      </View>

      {/* Driver assignment */}
      <View style={[VS.driverRow, { borderTopColor: colors.border }]}>
        {vehicle.driver ? (
          <View style={VS.driverInfo}>
            <View style={[VS.driverIcon, { backgroundColor: "#8b5cf620" }]}>
              <Feather name="user-check" size={13} color="#8b5cf6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[VS.driverEmail, { color: colors.foreground }]}>
                {vehicle.driver.driverName || vehicle.driver.driverEmail}
              </Text>
              {vehicle.driver.driverName && (
                <Text style={[VS.driverSub, { color: colors.mutedForeground }]}>
                  {vehicle.driver.driverEmail}
                </Text>
              )}
            </View>
            {isOwner && (
              <TouchableOpacity onPress={() => onRemoveDriver(vehicle)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="user-minus" size={15} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={VS.driverInfo}>
            <View style={[VS.driverIcon, { backgroundColor: "#94a3b820" }]}>
              <Feather name="user-plus" size={13} color="#94a3b8" />
            </View>
            <Text style={[VS.driverEmail, { color: colors.mutedForeground }]}>No driver assigned</Text>
            {isOwner && (
              <TouchableOpacity
                style={[VS.assignBtn, { backgroundColor: colors.primary + "18" }]}
                onPress={() => onAssignDriver(vehicle)}
              >
                <Text style={[VS.assignBtnTxt, { color: colors.primary }]}>Assign</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {isOwner && (
        <View style={[VS.actions, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={VS.actionBtn} onPress={() => onEdit(vehicle)}>
            <Feather name="edit-2" size={13} color={colors.primary} />
            <Text style={[VS.actionTxt, { color: colors.primary }]}>Edit</Text>
          </TouchableOpacity>
          {!vehicle.driver && (
            <TouchableOpacity style={VS.actionBtn} onPress={() => onAssignDriver(vehicle)}>
              <Feather name="user-plus" size={13} color="#8b5cf6" />
              <Text style={[VS.actionTxt, { color: "#8b5cf6" }]}>Assign Driver</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={VS.actionBtn} onPress={() => onDelete(vehicle)}>
            <Feather name="trash-2" size={13} color="#ef4444" />
            <Text style={[VS.actionTxt, { color: "#ef4444" }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const VS = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  nickname: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  plate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  driverRow: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12 },
  driverInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  driverIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  driverEmail: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  driverSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  assignBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  assignBtnTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});

function DriverVehicleCard({ vehicle, colors }: { vehicle: Vehicle; colors: ReturnType<typeof useColors> }) {
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle";
  const fields = [
    { label: "Make", value: vehicle.make },
    { label: "Model", value: vehicle.model },
    { label: "Year", value: vehicle.year },
    { label: "Plate", value: vehicle.licensePlate },
    { label: "Color", value: vehicle.color },
  ].filter(f => f.value);

  return (
    <View style={[DV.card, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
      <View style={[DV.header, { backgroundColor: colors.primary + "10" }]}>
        <View style={[DV.icon, { backgroundColor: colors.primary + "20" }]}>
          <Ionicons name={vehicleIcon(vehicle.make) as any} size={28} color={colors.primary} />
        </View>
        <View>
          <Text style={[DV.nickname, { color: colors.foreground }]}>{vehicle.nickname}</Text>
          <Text style={[DV.label, { color: colors.mutedForeground }]}>{label}</Text>
        </View>
      </View>
      <View style={DV.grid}>
        {fields.map(f => (
          <View key={f.label} style={[DV.cell, { borderColor: colors.border }]}>
            <Text style={[DV.cellLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
            <Text style={[DV.cellValue, { color: colors.foreground }]}>{f.value}</Text>
          </View>
        ))}
      </View>
      <View style={[DV.statusRow, { borderTopColor: colors.border }]}>
        <View style={[DV.statusDot, { backgroundColor: vehicle.status === "active" ? "#22c55e" : "#94a3b8" }]} />
        <Text style={[DV.statusTxt, { color: colors.mutedForeground }]}>
          Vehicle is {vehicle.status}
        </Text>
      </View>
    </View>
  );
}

const DV = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  icon: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  nickname: { fontSize: 18, fontWeight: "800", fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8 },
  cell: { width: "50%", padding: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  cellLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  cellValue: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginTop: 3 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },
});

type VehicleFormData = {
  nickname: string; make: string; model: string; year: string;
  licensePlate: string; vin: string; color: string;
};

function VehicleForm({
  initial, onSave, onCancel, loading, error, colors,
}: {
  initial?: Partial<VehicleFormData>;
  onSave: (d: VehicleFormData) => void;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [form, setForm] = useState<VehicleFormData>({
    nickname: initial?.nickname ?? "",
    make: initial?.make ?? "",
    model: initial?.model ?? "",
    year: initial?.year ?? "",
    licensePlate: initial?.licensePlate ?? "",
    vin: initial?.vin ?? "",
    color: initial?.color ?? "",
  });

  const set = (k: keyof VehicleFormData) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const fields: { key: keyof VehicleFormData; label: string; placeholder: string; required?: boolean; keyboard?: any; cap?: any }[] = [
    { key: "nickname", label: "Vehicle Nickname *", placeholder: "e.g. Blue Tesla, Fleet Truck 1", required: true, cap: "words" },
    { key: "make", label: "Make", placeholder: "Tesla, Ford, GM…", cap: "words" },
    { key: "model", label: "Model", placeholder: "Model 3, F-150…", cap: "words" },
    { key: "year", label: "Year", placeholder: "2024", keyboard: "number-pad" },
    { key: "licensePlate", label: "License Plate", placeholder: "ABC-1234", cap: "characters" },
    { key: "vin", label: "VIN", placeholder: "17-character VIN (optional)", cap: "characters" },
    { key: "color", label: "Color", placeholder: "White, Blue, Red…", cap: "words" },
  ];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={F.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Color picker */}
        <View style={F.colorRow}>
          {COLORS.map(c => (
            <TouchableOpacity
              key={c}
              style={[F.colorDot, { backgroundColor: c }, form.color.toLowerCase() === c.toLowerCase() && F.colorDotActive]}
              onPress={() => set("color")(c)}
            />
          ))}
        </View>

        {fields.map(f => (
          <View key={f.key} style={[F.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[F.label, { color: colors.mutedForeground }]}>{f.label}</Text>
            <TextInput
              style={[F.input, { color: colors.foreground }]}
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              value={form[f.key]}
              onChangeText={set(f.key)}
              keyboardType={f.keyboard ?? "default"}
              autoCapitalize={f.cap ?? "none"}
              autoCorrect={false}
            />
          </View>
        ))}

        {error && (
          <View style={F.errorRow}>
            <Feather name="alert-circle" size={14} color="#ef4444" />
            <Text style={F.errorTxt}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[F.saveBtn, { backgroundColor: colors.primary }]}
          onPress={() => onSave(form)}
          activeOpacity={0.82}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Feather name="check" size={16} color="#fff" /><Text style={F.saveTxt}>Save Vehicle</Text></>}
        </TouchableOpacity>

        <TouchableOpacity style={[F.cancelBtn, { borderColor: colors.border }]} onPress={onCancel}>
          <Text style={[F.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const F = StyleSheet.create({
  scroll: { padding: 16, gap: 10 },
  colorRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  colorDot: { width: 28, height: 28, borderRadius: 14 },
  colorDotActive: { borderWidth: 3, borderColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  field: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 },
  label: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  input: { fontSize: 15, fontFamily: "Inter_400Regular" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#ef4444", flex: 1 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  saveTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  cancelBtn: { borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1 },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
});

export function FleetModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const qc = useQueryClient();

  const [stage, setStage] = useState<Stage>("list");
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null);
  const [assignTarget, setAssignTarget] = useState<Vehicle | null>(null);
  const [driverEmail, setDriverEmail] = useState("");
  const [driverName, setDriverName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const token = await getToken();
    return fetch(`${BASE}${url}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
    });
  }, [getToken]);

  const { data: fleetData, isLoading, refetch } = useQuery<FleetData>({
    queryKey: ["fleet-me"],
    queryFn: async () => {
      const r = await authFetch("/api/fleet/me");
      if (!r.ok) throw new Error("Failed to load fleet");
      return r.json();
    },
    enabled: visible,
    staleTime: 30_000,
  });

  const addVehicle = useMutation({
    mutationFn: async (form: VehicleFormData) => {
      const r = await authFetch("/api/fleet/vehicles", { method: "POST", body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to add vehicle");
      return d;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-me"] }); setStage("list"); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: any) => setFormError(e.message),
  });

  const editVehicle = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: VehicleFormData }) => {
      const r = await authFetch(`/api/fleet/vehicles/${id}`, { method: "PUT", body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to update vehicle");
      return d;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-me"] }); setStage("list"); setEditTarget(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: any) => setFormError(e.message),
  });

  const deleteVehicle = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`/api/fleet/vehicles/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-me"] }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); },
  });

  const assignDriver = useMutation({
    mutationFn: async ({ id, email, name }: { id: number; email: string; name: string }) => {
      const r = await authFetch(`/api/fleet/vehicles/${id}/driver`, { method: "POST", body: JSON.stringify({ driverEmail: email, driverName: name }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to assign driver");
      return d;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-me"] }); setStage("list"); setAssignTarget(null); setDriverEmail(""); setDriverName(""); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: any) => setFormError(e.message),
  });

  const removeDriver = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`/api/fleet/vehicles/${id}/driver`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to remove driver");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-me"] }); },
  });

  function handleClose() {
    setStage("list"); setEditTarget(null); setAssignTarget(null);
    setDriverEmail(""); setDriverName(""); setFormError(null);
    onClose();
  }

  function handleDeleteVehicle(v: Vehicle) {
    Alert.alert(
      "Remove Vehicle",
      `Remove "${v.nickname}" from your fleet? This will also remove the driver assignment.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => deleteVehicle.mutate(v.id) },
      ]
    );
  }

  function handleRemoveDriver(v: Vehicle) {
    Alert.alert(
      "Remove Driver",
      `Remove ${v.driver?.driverEmail} from "${v.nickname}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeDriver.mutate(v.id) },
      ]
    );
  }

  const role = fleetData?.role ?? "none";
  const isOwner = role === "owner";

  const headerTitle =
    stage === "add_vehicle" ? "Add Vehicle" :
    stage === "edit_vehicle" ? "Edit Vehicle" :
    stage === "assign_driver" ? "Assign Driver" :
    "Fleet Manager";

  const renderContent = () => {
    if (isLoading) {
      return <View style={S.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    if (stage === "add_vehicle") {
      return (
        <VehicleForm
          onSave={(form) => { setFormError(null); addVehicle.mutate(form); }}
          onCancel={() => { setStage("list"); setFormError(null); }}
          loading={addVehicle.isPending}
          error={formError}
          colors={colors}
        />
      );
    }

    if (stage === "edit_vehicle" && editTarget) {
      return (
        <VehicleForm
          initial={{
            nickname: editTarget.nickname,
            make: editTarget.make ?? "",
            model: editTarget.model ?? "",
            year: editTarget.year ?? "",
            licensePlate: editTarget.licensePlate ?? "",
            vin: editTarget.vin ?? "",
            color: editTarget.color ?? "",
          }}
          onSave={(form) => { setFormError(null); editVehicle.mutate({ id: editTarget.id, form }); }}
          onCancel={() => { setStage("list"); setEditTarget(null); setFormError(null); }}
          loading={editVehicle.isPending}
          error={formError}
          colors={colors}
        />
      );
    }

    if (stage === "assign_driver" && assignTarget) {
      return (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">
            <View style={[S.planSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name={vehicleIcon(assignTarget.make) as any} size={20} color={colors.primary} />
              <Text style={[S.planSummaryTxt, { color: colors.foreground }]}>{assignTarget.nickname}</Text>
            </View>

            <Text style={[S.fieldLabel, { color: colors.mutedForeground }]}>DRIVER NAME (optional)</Text>
            <View style={[S.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="user" size={15} color={colors.mutedForeground} />
              <TextInput
                style={[S.input, { color: colors.foreground }]}
                placeholder="Driver's full name"
                placeholderTextColor={colors.mutedForeground}
                value={driverName}
                onChangeText={setDriverName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            <Text style={[S.fieldLabel, { color: colors.mutedForeground, marginTop: 8 }]}>DRIVER EMAIL *</Text>
            <View style={[S.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="mail" size={15} color={colors.mutedForeground} />
              <TextInput
                style={[S.input, { color: colors.foreground }]}
                placeholder="driver@email.com"
                placeholderTextColor={colors.mutedForeground}
                value={driverEmail}
                onChangeText={(t) => { setDriverEmail(t); setFormError(null); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={[S.hint, { color: colors.mutedForeground }]}>
              When this driver logs in with this email, they will only see this vehicle's data.
            </Text>

            {formError && (
              <View style={S.errorRow}>
                <Feather name="alert-circle" size={14} color="#ef4444" />
                <Text style={S.errorTxt}>{formError}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[S.submitBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                const e = driverEmail.trim().toLowerCase();
                if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
                  setFormError("Please enter a valid email address.");
                  return;
                }
                setFormError(null);
                assignDriver.mutate({ id: assignTarget.id, email: e, name: driverName.trim() });
              }}
              disabled={assignDriver.isPending}
              activeOpacity={0.82}
            >
              {assignDriver.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="user-check" size={15} color="#fff" /><Text style={S.submitBtnTxt}>Assign Driver</Text></>}
            </TouchableOpacity>

            <TouchableOpacity style={[S.cancelBtn, { borderColor: colors.border }]} onPress={() => { setStage("list"); setAssignTarget(null); setFormError(null); }}>
              <Text style={[S.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }

    // ── Main list view ────────────────────────────────────────────────────────
    if (role === "driver" && fleetData && "vehicle" in fleetData) {
      return (
        <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <View style={[S.driverBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
            <Text style={[S.driverBannerTxt, { color: colors.primary }]}>
              You are assigned as a driver for this vehicle
            </Text>
          </View>
          <DriverVehicleCard vehicle={fleetData.vehicle} colors={colors} />
        </ScrollView>
      );
    }

    if (role === "owner" && fleetData && "vehicles" in fleetData) {
      const vehicles = fleetData.vehicles;
      return (
        <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 32 }]}>
          {vehicles.length === 0 ? (
            <View style={S.empty}>
              <View style={[S.emptyIcon, { backgroundColor: colors.primary + "15" }]}>
                <Ionicons name="car-outline" size={40} color={colors.primary} />
              </View>
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>No vehicles yet</Text>
              <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
                Add your first vehicle to start managing your fleet
              </Text>
              <TouchableOpacity
                style={[S.addFirstBtn, { backgroundColor: colors.primary }]}
                onPress={() => { setFormError(null); setStage("add_vehicle"); }}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={S.addFirstBtnTxt}>Add First Vehicle</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={S.statsRow}>
                <View style={[S.statPill, { backgroundColor: "#22c55e15" }]}>
                  <Text style={[S.statVal, { color: "#22c55e" }]}>{vehicles.filter(v => v.status === "active").length}</Text>
                  <Text style={[S.statLbl, { color: "#22c55e" }]}>Active</Text>
                </View>
                <View style={[S.statPill, { backgroundColor: "#8b5cf615" }]}>
                  <Text style={[S.statVal, { color: "#8b5cf6" }]}>{vehicles.filter(v => v.driver).length}</Text>
                  <Text style={[S.statLbl, { color: "#8b5cf6" }]}>Assigned</Text>
                </View>
                <View style={[S.statPill, { backgroundColor: "#94a3b815" }]}>
                  <Text style={[S.statVal, { color: "#94a3b8" }]}>{vehicles.length}</Text>
                  <Text style={[S.statLbl, { color: "#94a3b8" }]}>Total</Text>
                </View>
              </View>

              {vehicles.map(v => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  isOwner
                  onEdit={(veh) => { setEditTarget(veh); setFormError(null); setStage("edit_vehicle"); }}
                  onAssignDriver={(veh) => { setAssignTarget(veh); setDriverEmail(veh.driver?.driverEmail ?? ""); setDriverName(veh.driver?.driverName ?? ""); setFormError(null); setStage("assign_driver"); }}
                  onRemoveDriver={handleRemoveDriver}
                  onDelete={handleDeleteVehicle}
                  colors={colors}
                />
              ))}
            </>
          )}
        </ScrollView>
      );
    }

    // role === "none"
    return (
      <View style={S.centered}>
        <View style={[S.emptyIcon, { backgroundColor: "#8b5cf615" }]}>
          <Ionicons name="business-outline" size={40} color="#8b5cf6" />
        </View>
        <Text style={[S.emptyTitle, { color: colors.foreground }]}>Fleet Pro Required</Text>
        <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
          Vehicle fleet management is available on the Fleet Pro plan.
        </Text>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[S.sheet, { backgroundColor: colors.background }]}>
        <View style={[S.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12 }]}>
          {(stage !== "list") ? (
            <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.muted }]} onPress={() => { setStage("list"); setFormError(null); }}>
              <Feather name="arrow-left" size={18} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 34 }} />
          )}
          <Text style={[S.headerTitle, { color: colors.foreground }]}>{headerTitle}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {stage === "list" && isOwner && (
              <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.primary }]} onPress={() => { setFormError(null); setStage("add_vehicle"); }}>
                <Feather name="plus" size={18} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[S.iconBtn, { backgroundColor: colors.muted }]} onPress={handleClose}>
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {renderContent()}
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  scroll: { padding: 16, gap: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  statPill: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12 },
  statVal: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  empty: { alignItems: "center", marginTop: 40, gap: 12, paddingHorizontal: 24 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  addFirstBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  addFirstBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  driverBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 4 },
  driverBannerTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  // Assign driver form
  planSummary: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  planSummaryTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#ef4444", flex: 1 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  submitBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  cancelBtn: { borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1 },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
