import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewToken,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { track } from "@/lib/analytics";
import { VehiclePickerModal } from "@/components/VehiclePickerModal";
import type { Vehicle } from "@/components/VehiclePickerModal";

const { width } = Dimensions.get("window");

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

// ── Connector options for custom vehicle form ─────────────────────────────────
type DCConnector = "CCS" | "NACS" | "CHAdeMO";
type ACConnector = "J1772" | "NACS";
const DC_CONNECTORS: DCConnector[] = ["CCS", "NACS", "CHAdeMO"];

const SLIDES = [
  {
    key: "welcome",
    icon: "⚡",
    title: "Welcome to ChargeBridge",
    body: "The community-powered map for independent EV charging stations. Find chargers that big networks don't list.",
    accent: "#0D9E7E",
  },
  {
    key: "find",
    icon: "📍",
    title: "Find Stations Near You",
    body: "Search by city or let us use your location. Filter by charger type, connector, network, and distance.",
    accent: "#0B8A6E",
  },
  {
    key: "charge",
    icon: "🔌",
    title: "Charge & Connect",
    body: "See live availability and pricing, read community reviews, and start a session right from the app.",
    accent: "#0A7860",
  },
  {
    key: "vehicle",
    icon: "🚗",
    title: "Set Up Your Vehicle",
    body: "Add your EV so we can auto-filter compatible chargers and personalize your experience.",
    accent: "#0D9E7E",
  },
];

export const ONBOARDING_KEY = "@chargebridge/onboarding_done";

function getPlugTypesForVehicle(v: Vehicle): string[] {
  const types: string[] = [];
  if (v.dcConnector) types.push(v.dcConnector);
  if (v.acConnector && v.acConnector !== v.dcConnector) types.push(v.acConnector);
  return types;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const { getToken, isSignedIn } = useAuth();
  const [showPicker, setShowPicker] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleNickname, setVehicleNickname] = useState("");
  const [vehicleSaving, setVehicleSaving] = useState(false);

  // ── Custom vehicle escape hatch ─────────────────────────────────────────────
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customMakeModel, setCustomMakeModel] = useState("");
  const [customBatteryKwh, setCustomBatteryKwh] = useState("");
  const [customConnector, setCustomConnector] = useState<DCConnector | null>(null);
  const [customDcMaxKw, setCustomDcMaxKw] = useState("");

  function applyCustomVehicle() {
    const label = customMakeModel.trim();
    if (!label) return;
    const parts = label.split(/\s+/);
    const make = parts[0] ?? "Custom";
    const model = parts.slice(1).join(" ") || "Vehicle";
    const vehicle: Vehicle = {
      id: "custom",
      name: label,
      make,
      model,
      yearRange: new Date().getFullYear().toString(),
      fuelCategory: "electric",
      dcConnector: (customConnector as Vehicle["dcConnector"]) ?? null,
      acConnector: "J1772",
      batteryKwh: customBatteryKwh ? parseFloat(customBatteryKwh) : undefined,
      dcMaxKw: customDcMaxKw ? parseFloat(customDcMaxKw) : undefined,
    };
    setSelectedVehicle(vehicle);
    setShowCustomForm(false);
  }

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  // ── Save vehicle to API ─────────────────────────────────────────────────────
  async function saveVehicle() {
    console.log("[Onboarding] saveVehicle() entered — isSignedIn:", isSignedIn, "selectedVehicle:", selectedVehicle?.id ?? "null");
    track("onboarding_savevehicle_started", { vehicle_id: selectedVehicle?.id ?? null, is_signed_in: isSignedIn });

    if (!selectedVehicle || !isSignedIn) {
      const reason = !selectedVehicle ? "no_vehicle" : "not_signed_in";
      console.log("[Onboarding] saveVehicle: early return —", reason, "selectedVehicle:", !!selectedVehicle, "isSignedIn:", isSignedIn);
      track("onboarding_savevehicle_blocked", { reason });
      return;
    }
    try {
      const token = await getToken();
      console.log("[Onboarding] getToken() result — token present:", !!token);
      if (!token) {
        console.log("[Onboarding] saveVehicle: skipped — no auth token");
        track("onboarding_savevehicle_blocked", { reason: "no_token" });
        return;
      }

      // Extract catalogTrimId from the vehicle id (format: "cat-{n}" or "custom")
      const catalogTrimId = selectedVehicle.id.startsWith("cat-")
        ? parseInt(selectedVehicle.id.slice(4), 10)
        : null;

      const plugTypes = getPlugTypesForVehicle(selectedVehicle);
      const body = {
        make: selectedVehicle.make,
        model: selectedVehicle.model,
        year: selectedVehicle.yearRange,
        fuelType: selectedVehicle.fuelCategory === "electric" ? "electric"
          : selectedVehicle.fuelCategory === "phev_hybrid" ? "hybrid"
          : selectedVehicle.fuelType ?? null,
        connectorType: selectedVehicle.dcConnector ?? selectedVehicle.acConnector ?? null,
        plugTypes,
        nickname: vehicleNickname.trim() || null,
        batteryKwh: selectedVehicle.batteryKwh ?? null,
        dcMaxKw: selectedVehicle.dcMaxKw ?? null,
        catalogTrimId,
      };

      console.log("[Onboarding] POST /api/me/vehicles →", JSON.stringify(body));
      track("onboarding_vehicle_post_request", {
        make: selectedVehicle.make,
        model: selectedVehicle.model,
        catalog_trim_id: catalogTrimId,
        has_token: true,
      });

      const res = await fetch(`${BASE}/api/me/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      console.log("[Onboarding] POST /api/me/vehicles ←", res.status);
      track("onboarding_vehicle_post_response", { status: res.status, ok: res.ok });

      if (res.ok) {
        const v = await res.json();
        console.log("[Onboarding] Vehicle created, id =", v.id, "isPrimary =", v.isPrimary, "— setting primary");
        const primRes = await fetch(`${BASE}/api/me/vehicles/${v.id}/primary`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const primBody = await primRes.json().catch(() => null);
        console.log("[Onboarding] Set-primary ←", primRes.status, "body:", JSON.stringify(primBody));
        track("onboarding_set_primary_response", { status: primRes.status, ok: primRes.ok, vehicle_id: v.id });
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["me-vehicles"] });
        console.log("[Onboarding] saveVehicle: profile + vehicles + me-vehicles queries invalidated");
        track("onboarding_savevehicle_complete", { vehicle_id: v.id });
      } else {
        const errText = await res.text().catch(() => "(unreadable)");
        console.warn("[Onboarding] POST /api/me/vehicles FAILED:", res.status, errText);
        track("onboarding_vehicle_post_failed", { status: res.status, error_text: errText });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[Onboarding] saveVehicle threw:", err);
      track("onboarding_savevehicle_exception", { message });
    }
  }

  // ── Finish onboarding ───────────────────────────────────────────────────────
  // NOTE: Never call resolveInitialRoute() here — it reads AsyncStorage and
  // can race with setItem, returning "/onboarding" and looping. Onboarding
  // always knows its post-completion destination: /(tabs)/home.
  async function finish() {
    console.log("[Onboarding] finish() entered — selectedVehicle:", selectedVehicle?.id ?? "none", "isSignedIn:", isSignedIn);
    track("onboarding_finish_entered", { vehicle_id: selectedVehicle?.id ?? null, is_signed_in: isSignedIn });
    try {
      if (selectedVehicle) {
        setVehicleSaving(true);
        console.log("[Onboarding] finish(): calling saveVehicle()");
        await saveVehicle();
        console.log("[Onboarding] finish(): saveVehicle() returned");
        setVehicleSaving(false);
      } else {
        console.log("[Onboarding] finish(): no vehicle selected — skipping saveVehicle()");
      }
      console.log("[Onboarding] finish(): writing AsyncStorage onboarding key");
      await AsyncStorage.setItem(ONBOARDING_KEY, "1");
      console.log("[Onboarding] finish(): AsyncStorage written — dispatching router.replace(/(tabs)/home)");
      track("onboarding_navigation_dispatched", {});
      router.replace("/(tabs)/home" as any);
      console.log("[Onboarding] finish(): router.replace dispatched");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[Onboarding] finish() caught error:", err);
      track("onboarding_finish_exception", { message });
      try { await AsyncStorage.setItem(ONBOARDING_KEY, "1"); } catch {}
      router.replace("/(tabs)/home" as any);
    }
  }

  function next() {
    console.log("[Onboarding] next() called — activeIndex:", activeIndex, "SLIDES.length:", SLIDES.length, "isLast:", activeIndex === SLIDES.length - 1);
    track("onboarding_next_tapped", {
      slide_index: activeIndex,
      is_last_slide: activeIndex === SLIDES.length - 1,
      vehicle_selected: !!selectedVehicle,
    });
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      console.log("[Onboarding] next(): last slide — calling finish()");
      void finish();
    }
  }

  const isLast = activeIndex === SLIDES.length - 1;
  const currentAccent = SLIDES[activeIndex]?.accent ?? "#0D9E7E";

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        style={{ flex: 1 }}
        renderItem={({ item }) => {
          if (item.key === "vehicle") {
            return (
              <View style={[styles.slide, { width }]}>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.vehicleScroll}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={[styles.iconCircle, { backgroundColor: item.accent + "22" }]}>
                      <Text style={styles.iconText}>{item.icon}</Text>
                    </View>
                    <Text style={[styles.title, { color: item.accent }]}>{item.title}</Text>
                    <Text style={styles.body}>{item.body}</Text>

                    {/* ── Catalog picker button ─────────────────────────── */}
                    <TouchableOpacity
                      style={[styles.pickBtn, { borderColor: item.accent }]}
                      onPress={() => { setShowPicker(true); setShowCustomForm(false); }}
                      activeOpacity={0.85}
                    >
                      {selectedVehicle && selectedVehicle.id !== "custom" ? (
                        <View style={{ alignItems: "center" }}>
                          <Text style={[styles.pickBtnTxt, { color: item.accent }]}>
                            {selectedVehicle.make} {selectedVehicle.model}
                          </Text>
                          <Text style={styles.pickBtnSub}>{selectedVehicle.yearRange} · Tap to change</Text>
                        </View>
                      ) : selectedVehicle?.id === "custom" ? (
                        <View style={{ alignItems: "center" }}>
                          <Text style={[styles.pickBtnTxt, { color: item.accent }]}>Browse Catalog</Text>
                          <Text style={styles.pickBtnSub}>Switch to catalog vehicle</Text>
                        </View>
                      ) : (
                        <Text style={[styles.pickBtnTxt, { color: item.accent }]}>Select Your Vehicle</Text>
                      )}
                    </TouchableOpacity>

                    {/* ── Plug chips (catalog vehicle) ──────────────────── */}
                    {selectedVehicle && selectedVehicle.id !== "custom" && getPlugTypesForVehicle(selectedVehicle).length > 0 && (
                      <View style={styles.plugRow}>
                        {getPlugTypesForVehicle(selectedVehicle).map((pt) => (
                          <View key={pt} style={[styles.plugChip, { backgroundColor: item.accent + "22", borderColor: item.accent }]}>
                            <Text style={[styles.plugChipTxt, { color: item.accent }]}>{pt}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* ── "Can't find your vehicle?" toggle ────────────── */}
                    {!showCustomForm && (
                      <TouchableOpacity
                        style={styles.escapeTrigger}
                        onPress={() => setShowCustomForm(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.escapeTriggerTxt, { color: item.accent }]}>
                          Can't find your vehicle?
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* ── Custom vehicle form ───────────────────────────── */}
                    {showCustomForm && (
                      <View style={styles.customForm}>
                        <Text style={[styles.customFormTitle, { color: item.accent }]}>
                          Enter Your Vehicle
                        </Text>

                        <TextInput
                          style={styles.customInput}
                          value={customMakeModel}
                          onChangeText={setCustomMakeModel}
                          placeholder="Make & Model (e.g. Scout Terra)"
                          placeholderTextColor="#9AAFAF"
                          returnKeyType="next"
                          autoCorrect={false}
                        />

                        <View style={styles.customRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.customLabel}>Battery (kWh)</Text>
                            <TextInput
                              style={styles.customInput}
                              value={customBatteryKwh}
                              onChangeText={setCustomBatteryKwh}
                              placeholder="e.g. 77"
                              placeholderTextColor="#9AAFAF"
                              keyboardType="decimal-pad"
                              returnKeyType="next"
                            />
                          </View>
                          <View style={{ width: 12 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.customLabel}>Max DC Speed (kW)</Text>
                            <TextInput
                              style={styles.customInput}
                              value={customDcMaxKw}
                              onChangeText={setCustomDcMaxKw}
                              placeholder="e.g. 150"
                              placeholderTextColor="#9AAFAF"
                              keyboardType="decimal-pad"
                              returnKeyType="done"
                            />
                          </View>
                        </View>

                        <Text style={styles.customLabel}>DC Connector Type</Text>
                        <View style={styles.connectorRow}>
                          {DC_CONNECTORS.map((c) => (
                            <TouchableOpacity
                              key={c}
                              style={[
                                styles.connectorChip,
                                customConnector === c
                                  ? { backgroundColor: item.accent, borderColor: item.accent }
                                  : { backgroundColor: "#fff", borderColor: "#D5D0C8" },
                              ]}
                              onPress={() => setCustomConnector(customConnector === c ? null : c)}
                              activeOpacity={0.8}
                            >
                              <Text style={[
                                styles.connectorChipTxt,
                                { color: customConnector === c ? "#fff" : "#374151" },
                              ]}>
                                {c}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        <View style={styles.customFormActions}>
                          <TouchableOpacity
                            style={[
                              styles.useVehicleBtn,
                              { backgroundColor: customMakeModel.trim() ? item.accent : "#9ca3af" },
                            ]}
                            onPress={applyCustomVehicle}
                            disabled={!customMakeModel.trim()}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.useVehicleTxt}>Use This Vehicle</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.cancelCustomBtn}
                            onPress={() => setShowCustomForm(false)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.cancelCustomTxt}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* ── Custom vehicle summary chips ──────────────────── */}
                    {selectedVehicle?.id === "custom" && (
                      <View style={styles.plugRow}>
                        {customConnector && (
                          <View style={[styles.plugChip, { backgroundColor: item.accent + "22", borderColor: item.accent }]}>
                            <Text style={[styles.plugChipTxt, { color: item.accent }]}>{customConnector}</Text>
                          </View>
                        )}
                        {customBatteryKwh && (
                          <View style={[styles.plugChip, { backgroundColor: item.accent + "22", borderColor: item.accent }]}>
                            <Text style={[styles.plugChipTxt, { color: item.accent }]}>{customBatteryKwh} kWh</Text>
                          </View>
                        )}
                        {customDcMaxKw && (
                          <View style={[styles.plugChip, { backgroundColor: item.accent + "22", borderColor: item.accent }]}>
                            <Text style={[styles.plugChipTxt, { color: item.accent }]}>{customDcMaxKw} kW DC</Text>
                          </View>
                        )}
                        <TouchableOpacity onPress={() => { setShowCustomForm(true); setSelectedVehicle(null); }}>
                          <View style={[styles.plugChip, { borderColor: "#9ca3af" }]}>
                            <Text style={[styles.plugChipTxt, { color: "#9ca3af" }]}>Edit</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* ── Nickname input ────────────────────────────────── */}
                    {selectedVehicle && (
                      <View style={styles.nicknameRow}>
                        <TextInput
                          style={styles.nicknameInput}
                          value={vehicleNickname}
                          onChangeText={setVehicleNickname}
                          placeholder='Nickname (e.g. "My Tesla")'
                          placeholderTextColor="#9AAFAF"
                          maxLength={40}
                        />
                      </View>
                    )}
                  </ScrollView>
              </View>
            );
          }

          return (
            <View style={[styles.slide, { width }]}>
              <View style={[styles.iconCircle, { backgroundColor: item.accent + "22" }]}>
                <Text style={styles.iconText}>{item.icon}</Text>
              </View>
              <Text style={[styles.title, { color: item.accent }]}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          );
        }}
      />
      </KeyboardAvoidingView>

      {/* Footer lives outside the KAV so the keyboard never collapses it */}
      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex ? [styles.dotActive, { backgroundColor: currentAccent }] : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: currentAccent, opacity: vehicleSaving ? 0.65 : 1 }]}
          onPress={next}
          activeOpacity={0.85}
          disabled={vehicleSaving}
        >
          {vehicleSaving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnText}>{isLast ? (selectedVehicle ? "Get Started" : "Skip for Now") : "Next"}</Text>}
        </TouchableOpacity>

        {!isLast && (
          <TouchableOpacity onPress={finish} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      <VehiclePickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(v) => {
          setSelectedVehicle(v);
          setShowPicker(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  slide: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "center",
    paddingHorizontal: 36,
    paddingTop: 32,
  },
  vehicleScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  iconText: {
    fontSize: 56,
  },
  title: {
    fontSize: 26,
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "sans-serif" }),
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 34,
  },
  body: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 26,
    fontFamily: Platform.select({ ios: "Inter_400Regular", default: "sans-serif" }),
  },
  pickBtn: {
    marginTop: 28,
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignItems: "center",
    minWidth: 220,
    backgroundColor: "#fff",
  },
  pickBtnTxt: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "sans-serif" }),
  },
  pickBtnSub: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
    fontFamily: Platform.select({ ios: "Inter_400Regular", default: "sans-serif" }),
  },
  plugRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
    justifyContent: "center",
  },
  plugChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  plugChipTxt: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "sans-serif" }),
  },
  nicknameRow: {
    marginTop: 14,
    width: "100%",
  },
  nicknameInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D5D0C8",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1A2530",
    textAlign: "center",
  },
  // ── Escape hatch ──────────────────────────────────────────────────────────
  escapeTrigger: {
    marginTop: 18,
    paddingVertical: 6,
  },
  escapeTriggerTxt: {
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "sans-serif" }),
  },
  // ── Custom vehicle form ────────────────────────────────────────────────────
  customForm: {
    marginTop: 20,
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    gap: 12,
  },
  customFormTitle: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "sans-serif" }),
    textAlign: "center",
    marginBottom: 4,
  },
  customLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 4,
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "sans-serif" }),
  },
  customInput: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#D5D0C8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1A2530",
  },
  customRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  connectorRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  connectorChip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  connectorChipTxt: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "sans-serif" }),
  },
  customFormActions: {
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  useVehicleBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  useVehicleTxt: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "sans-serif" }),
  },
  cancelCustomBtn: {
    paddingVertical: 4,
  },
  cancelCustomTxt: {
    color: "#9ca3af",
    fontSize: 14,
  },
  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 12 : 28,
    alignItems: "center",
    gap: 12,
  },
  dots: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
  },
  dotInactive: {
    width: 8,
    backgroundColor: "#d1d5db",
  },
  btn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "sans-serif" }),
  },
  skipBtn: {
    paddingVertical: 4,
  },
  skipText: {
    color: "#9ca3af",
    fontSize: 15,
  },
});
