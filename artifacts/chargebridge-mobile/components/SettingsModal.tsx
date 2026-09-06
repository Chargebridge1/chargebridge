import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, Modal, ScrollView,
  TouchableOpacity, Switch, Linking, Alert,
  Platform, ActivityIndicator,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/expo";
import { router } from "expo-router";
import Constants from "expo-constants";
import { useColors } from "@/hooks/useColors";
import { useUnits } from "@/hooks/useUnits";
import { AllTabsWallpaperPicker } from "@/components/WallpaperPicker";
import { useButtonConfigs, useToggleButton, type ButtonConfig } from "@/hooks/useButtonConfigs";
import { useDefaultMap, MAP_OPTIONS } from "@/hooks/useDefaultMap";

// ── Role helper ──────────────────────────────────────────────────────────────
type UserRole = "admin" | "client";
function useRole() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.publicMetadata as { role?: UserRole } | undefined)?.role ?? "client";
  return { isAdmin: role === "admin" };
}

// ── Shared row components ────────────────────────────────────────────────────
function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[S.sectionHeader, { color: colors.mutedForeground }]}>{label}</Text>
  );
}

function SettingsRow({
  icon, iconColor, label, sublabel, onPress, rightElement, colors, isLast = false,
}: {
  icon: string; iconColor: string; label: string; sublabel?: string;
  onPress?: () => void; rightElement?: React.ReactNode;
  colors: ReturnType<typeof useColors>; isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[S.row, { borderBottomColor: isLast ? "transparent" : colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[S.rowIcon, { backgroundColor: iconColor + "18" }]}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={S.rowText}>
        <Text style={[S.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {sublabel ? <Text style={[S.rowSub, { color: colors.mutedForeground }]}>{sublabel}</Text> : null}
      </View>
      {rightElement ?? (
        onPress ? <Feather name="chevron-right" size={16} color={colors.mutedForeground} /> : null
      )}
    </TouchableOpacity>
  );
}

function SettingsCard({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

// ── Admin button toggle row ──────────────────────────────────────────────────
function AdminButtonRow({ config, colors }: { config: ButtonConfig; colors: ReturnType<typeof useColors> }) {
  const toggle = useToggleButton();
  return (
    <View style={[S.adminRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[S.adminRowLabel, { color: colors.foreground }]}>{config.label}</Text>
        <Text style={[S.adminRowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{config.description}</Text>
      </View>
      <Switch
        value={config.enabled}
        onValueChange={(v) => { Haptics.selectionAsync(); toggle.mutate({ key: config.key, enabled: v }); }}
        trackColor={{ false: colors.border, true: "#0D9E7E55" }}
        thumbColor={config.enabled ? "#0D9E7E" : colors.mutedForeground}
        disabled={toggle.isPending}
      />
    </View>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function SettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { units, toggleUnits } = useUnits();
  const { defaultMap, setDefaultMap } = useDefaultMap();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { isAdmin } = useRole();
  const queryClient = useQueryClient();

  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // 7-tap developer unlock on version number
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVersionTap = useCallback(() => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDevUnlocked(true);
    } else {
      tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 1500);
    }
  }, []);

  const { data: btnCfgs, isLoading: cfgLoading } = useButtonConfigs();
  const mobileCfgs = (btnCfgs ?? []).filter((c) => c.platform === "mobile");

  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  const buildNumber = Platform.OS === "ios"
    ? Constants.expoConfig?.ios?.buildNumber ?? "—"
    : Constants.expoConfig?.android?.versionCode ?? "—";

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out", style: "destructive",
        onPress: async () => {
          onClose();
          await signOut();
          router.replace("/(auth)/sign-in" as any);
        },
      },
    ]);
  }

  async function handleClearCache() {
    Alert.alert("Clear Cache", "This will reset app preferences and cached data. You will not be signed out.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive",
        onPress: async () => {
          setClearingCache(true);
          try {
            await AsyncStorage.multiRemove([
              "@cb:wallpapers_v1",
              "@cb:wallpaper_photos_v1",
              "chargebridge:lastMapPosition",
            ]);
            queryClient.clear();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Done", "Cache cleared. Some preferences have been reset.");
          } catch {
            Alert.alert("Error", "Could not clear cache.");
          } finally {
            setClearingCache(false);
          }
        },
      },
    ]);
  }

  const displayName = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Driver";
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <View style={[S.root, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[S.header, { paddingTop: 20, borderBottomColor: colors.border }]}>
            <Text style={[S.headerTitle, { color: colors.foreground }]}>Settings</Text>
            <TouchableOpacity
              style={[S.closeBtn, { backgroundColor: colors.muted }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 8 }}
          >
            {/* ── ACCOUNT ──────────────────────────────────────── */}
            <SectionHeader label="ACCOUNT" colors={colors} />
            <SettingsCard colors={colors}>
              {/* Profile summary */}
              <View style={[S.profileRow, { borderBottomColor: colors.border }]}>
                <View style={[S.avatarCircle, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[S.avatarInitial, { color: colors.primary }]}>
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.profileName, { color: colors.foreground }]}>{displayName}</Text>
                  {email ? <Text style={[S.profileEmail, { color: colors.mutedForeground }]}>{email}</Text> : null}
                </View>
                <TouchableOpacity
                  style={[S.editProfileBtn, { borderColor: colors.border }]}
                  onPress={() => { onClose(); router.push("/edit-profile" as any); }}
                  activeOpacity={0.8}
                >
                  <Text style={[S.editProfileTxt, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
              </View>

              <SettingsRow
                icon="shield-checkmark-outline" iconColor="#6366f1"
                label="Membership" sublabel="Plans & pricing"
                onPress={() => { onClose(); router.navigate("/(tabs)/home"); }}
                colors={colors}
              />
              <SettingsRow
                icon="document-text-outline" iconColor="#0891b2"
                label="Invoices & Billing"
                onPress={() => { onClose(); router.navigate("/(tabs)/invoices" as any); }}
                colors={colors}
              />
              {!isAdmin && (
                <SettingsRow
                  icon="shield-outline" iconColor="#0D9E7E"
                  label="Admin Setup"
                  sublabel="Claim administrator access"
                  onPress={() => { onClose(); router.push("/admin-setup" as any); }}
                  colors={colors}
                />
              )}
              <SettingsRow
                icon="log-out-outline" iconColor="#ef4444"
                label="Sign Out"
                onPress={handleSignOut}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── PREFERENCES ──────────────────────────────────── */}
            <SectionHeader label="PREFERENCES" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="compass-outline" iconColor="#f59e0b"
                label="Distance Units"
                sublabel="Used for nearby search and distances"
                rightElement={
                  <TouchableOpacity
                    style={[S.unitToggle, { backgroundColor: colors.primary }]}
                    onPress={() => { Haptics.selectionAsync(); toggleUnits(); }}
                    activeOpacity={0.85}
                  >
                    <Text style={S.unitToggleTxt}>{units.toUpperCase()}</Text>
                  </TouchableOpacity>
                }
                colors={colors}
              />
              <SettingsRow
                icon="search-outline" iconColor="#3b82f6"
                label="Default Search Radius"
                sublabel="Set on the Nearby tab filter"
                onPress={() => { onClose(); router.navigate("/(tabs)" as any); }}
                colors={colors}
              />
              <SettingsRow
                icon="star-outline" iconColor="#a855f7"
                label="Saved Stations"
                sublabel="Your bookmarked chargers"
                onPress={() => { onClose(); router.navigate("/(tabs)/favorites" as any); }}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── NAVIGATION ───────────────────────────────────── */}
            <SectionHeader label="NAVIGATION" colors={colors} />
            <SettingsCard colors={colors}>
              {MAP_OPTIONS
                .filter((opt) => !opt.iosOnly || Platform.OS === "ios")
                .map((opt, i, arr) => (
                  <SettingsRow
                    key={opt.id}
                    icon={opt.icon as any}
                    iconColor="#0D9E7E"
                    label={opt.label}
                    sublabel={opt.desc}
                    onPress={() => { Haptics.selectionAsync(); void setDefaultMap(opt.id); }}
                    colors={colors}
                    isLast={i === arr.length - 1}
                    rightElement={
                      defaultMap === opt.id
                        ? <Ionicons name="checkmark-circle" size={20} color="#0D9E7E" />
                        : undefined
                    }
                  />
                ))}
            </SettingsCard>

            {/* ── APPEARANCE ───────────────────────────────────── */}
            <SectionHeader label="APPEARANCE" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="color-palette-outline" iconColor="#7c3aed"
                label="Wallpaper & Themes"
                sublabel="Customize each tab background"
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                  setTimeout(() => setWallpaperOpen(true), 480);
                }}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── NOTIFICATIONS ────────────────────────────────── */}
            <SectionHeader label="NOTIFICATIONS" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="notifications-outline" iconColor="#0D9E7E"
                label="Push Notifications"
                sublabel="Manage in device Settings"
                onPress={() => Linking.openURL("app-settings:")}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── PRIVACY & DATA ────────────────────────────────── */}
            <SectionHeader label="PRIVACY & DATA" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="location-outline" iconColor="#22c55e"
                label="Location Access"
                sublabel="Required for nearby search"
                onPress={() => Linking.openURL("app-settings:")}
                colors={colors}
              />
              <SettingsRow
                icon="document-lock-outline" iconColor="#0891b2"
                label="Privacy Policy"
                onPress={() => Linking.openURL("https://chargebridgeapp.com/privacy")}
                colors={colors}
              />
              <SettingsRow
                icon="reader-outline" iconColor="#6366f1"
                label="Terms of Service"
                onPress={() => Linking.openURL("https://chargebridgeapp.com/terms")}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── SUPPORT ──────────────────────────────────────── */}
            <SectionHeader label="SUPPORT" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="chatbubble-ellipses-outline" iconColor="#0D9E7E"
                label="Send Feedback"
                sublabel="feedback@chargebridgeapp.com"
                onPress={() => Linking.openURL("mailto:feedback@chargebridgeapp.com?subject=ChargeBridge%20Feedback")}
                colors={colors}
              />
              <SettingsRow
                icon="star-half-outline" iconColor="#f59e0b"
                label="Rate ChargeBridge"
                sublabel="Leave a review on the App Store"
                onPress={() => Linking.openURL(
                  Platform.OS === "ios"
                    ? "https://apps.apple.com/app/id6768124853?action=write-review"
                    : "https://play.google.com/store/apps/details?id=app.replit.chargebridge"
                )}
                colors={colors}
              />
              <SettingsRow
                icon="people-outline" iconColor="#8b5cf6"
                label="Community Stations"
                sublabel="View and manage the directory"
                onPress={() => { onClose(); router.push("/community-stations" as any); }}
                colors={colors}
              />
              <SettingsRow
                icon="book-outline" iconColor="#7c3aed"
                label="EV Driver Guides"
                sublabel="Charging levels, connectors, etiquette"
                onPress={() => { onClose(); router.push("/guides" as any); }}
                colors={colors}
              />
              <SettingsRow
                icon="git-network-outline" iconColor="#0D9E7E"
                label="Charging Networks"
                sublabel="ChargePoint, Tesla, EVgo and more"
                onPress={() => { onClose(); router.push("/networks" as any); }}
                colors={colors}
              />
              <SettingsRow
                icon="business-outline" iconColor="#f59e0b"
                label="Connect Your Charger"
                sublabel="List your station on ChargeBridge"
                onPress={() => { onClose(); Linking.openURL(`https://${process.env.EXPO_PUBLIC_DOMAIN}/operators`); }}
                colors={colors}
                isLast
              />
            </SettingsCard>

            {/* ── ABOUT ────────────────────────────────────────── */}
            <SectionHeader label="ABOUT" colors={colors} />
            <SettingsCard colors={colors}>
              <SettingsRow
                icon="information-circle-outline" iconColor="#94a3b8"
                label="What's New"
                sublabel="ChargeBridge release notes"
                onPress={() => Linking.openURL("https://chargebridgeapp.com/changelog")}
                colors={colors}
              />
              <TouchableOpacity
                style={[S.row, { borderBottomColor: "transparent" }]}
                onPress={handleVersionTap}
                activeOpacity={0.7}
              >
                <View style={[S.rowIcon, { backgroundColor: "#94a3b8" + "18" }]}>
                  <Ionicons name="code-slash-outline" size={18} color="#94a3b8" />
                </View>
                <View style={S.rowText}>
                  <Text style={[S.rowLabel, { color: colors.foreground }]}>Version</Text>
                  <Text style={[S.rowSub, { color: colors.mutedForeground }]}>
                    {appVersion} (Build {buildNumber})
                  </Text>
                </View>
                {devUnlocked && (
                  <View style={[S.devBadge, { backgroundColor: "#f59e0b20" }]}>
                    <Text style={S.devBadgeTxt}>DEV</Text>
                  </View>
                )}
              </TouchableOpacity>
            </SettingsCard>

            {/* ── ADMIN PANEL (role-gated) ──────────────────────── */}
            {isAdmin && (
              <>
                <SectionHeader label="ADMIN" colors={colors} />
                <SettingsCard colors={colors}>
                  <TouchableOpacity
                    style={[S.row, { borderBottomColor: adminExpanded ? colors.border : "transparent" }]}
                    onPress={() => { Haptics.selectionAsync(); setAdminExpanded((v) => !v); }}
                    activeOpacity={0.7}
                  >
                    <View style={[S.rowIcon, { backgroundColor: "#0D9E7E18" }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#0D9E7E" />
                    </View>
                    <View style={S.rowText}>
                      <Text style={[S.rowLabel, { color: colors.foreground }]}>Admin Panel</Text>
                      <Text style={[S.rowSub, { color: colors.mutedForeground }]}>
                        {cfgLoading ? "Loading…" : `${(btnCfgs ?? []).filter((c) => c.enabled).length}/${(btnCfgs ?? []).length} features enabled`}
                      </Text>
                    </View>
                    <Feather
                      name={adminExpanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>

                  {adminExpanded && (
                    <>
                      {/* Feature flag toggles — mobile buttons */}
                      <View style={[S.adminGroupHeader, { backgroundColor: colors.muted + "80" }]}>
                        <Feather name="smartphone" size={12} color="#8b5cf6" />
                        <Text style={[S.adminGroupLabel, { color: "#8b5cf6" }]}>MOBILE FEATURES</Text>
                      </View>
                      {cfgLoading ? (
                        <ActivityIndicator color="#0D9E7E" style={{ marginVertical: 16 }} />
                      ) : (
                        mobileCfgs.map((c, i) => (
                          <AdminButtonRow
                            key={c.key}
                            config={c}
                            colors={colors}
                          />
                        ))
                      )}

                      {/* Jump to full admin tab */}
                      <TouchableOpacity
                        style={[S.adminFullBtn, { borderTopColor: colors.border }]}
                        onPress={() => { onClose(); router.navigate("/(tabs)/admin" as any); }}
                        activeOpacity={0.8}
                      >
                        <Feather name="external-link" size={14} color="#0D9E7E" />
                        <Text style={S.adminFullBtnTxt}>Open Full Admin Panel</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {!adminExpanded && (
                    <SettingsRow
                      icon="bar-chart-outline" iconColor="#6366f1"
                      label="Analytics & Ops"
                      sublabel="Full admin tools on web dashboard"
                      onPress={() => { onClose(); router.navigate("/(tabs)/admin" as any); }}
                      colors={colors}
                      isLast
                    />
                  )}
                </SettingsCard>
              </>
            )}

            {/* ── DEVELOPER TOOLS (7-tap unlock) ───────────────── */}
            {devUnlocked && (
              <>
                <SectionHeader label="DEVELOPER TOOLS" colors={colors} />
                <SettingsCard colors={colors}>
                  <View style={[S.devInfoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[S.devInfoKey, { color: colors.mutedForeground }]}>App Version</Text>
                    <Text style={[S.devInfoVal, { color: colors.foreground }]}>{appVersion}</Text>
                  </View>
                  <View style={[S.devInfoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[S.devInfoKey, { color: colors.mutedForeground }]}>Build Number</Text>
                    <Text style={[S.devInfoVal, { color: colors.foreground }]}>{buildNumber}</Text>
                  </View>
                  <View style={[S.devInfoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[S.devInfoKey, { color: colors.mutedForeground }]}>Platform</Text>
                    <Text style={[S.devInfoVal, { color: colors.foreground }]}>{Platform.OS} {Platform.Version}</Text>
                  </View>
                  <View style={[S.devInfoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[S.devInfoKey, { color: colors.mutedForeground }]}>Domain</Text>
                    <Text style={[S.devInfoVal, { color: colors.foreground }]} numberOfLines={1}>
                      {process.env.EXPO_PUBLIC_DOMAIN ?? "—"}
                    </Text>
                  </View>
                  <SettingsRow
                    icon="refresh-outline" iconColor="#f59e0b"
                    label="Refresh All Data"
                    sublabel="Invalidate all React Query caches"
                    onPress={() => {
                      queryClient.invalidateQueries();
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert("Done", "All caches invalidated. Data will refresh on next render.");
                    }}
                    colors={colors}
                  />
                  <SettingsRow
                    icon="trash-outline" iconColor="#ef4444"
                    label={clearingCache ? "Clearing…" : "Clear App Cache"}
                    sublabel="Resets wallpapers, map position, and cached prefs"
                    onPress={clearingCache ? undefined : handleClearCache}
                    colors={colors}
                  />
                  <SettingsRow
                    icon="bug-outline" iconColor="#94a3b8"
                    label="Hide Developer Tools"
                    onPress={() => setDevUnlocked(false)}
                    colors={colors}
                    isLast
                  />
                </SettingsCard>
              </>
            )}

            <Text style={[S.footer, { color: colors.mutedForeground }]}>
              ChargeBridge · Community-powered EV charging
            </Text>
          </ScrollView>
        </View>
      </Modal>

      {/* Wallpaper picker floated outside main modal so it can slide over it */}
      <AllTabsWallpaperPicker visible={wallpaperOpen} onClose={() => setWallpaperOpen(false)} />
    </>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },

  sectionHeader: {
    fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, marginLeft: 20, marginTop: 20, marginBottom: 6,
  },
  card: {
    marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden",
    shadowColor: "#1A2530", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 1,
  },

  profileRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  avatarInitial: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  profileEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  editProfileBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  editProfileTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500", fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  unitToggle: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  unitToggleTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#fff" },

  devBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  devBadgeTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", color: "#f59e0b" },

  adminGroupHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  adminGroupLabel: {
    fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6,
  },
  adminRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  adminRowLabel: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  adminRowDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  adminFullBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth,
  },
  adminFullBtnTxt: {
    fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#0D9E7E",
  },

  devInfoRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  devInfoKey: { fontSize: 13, fontFamily: "Inter_400Regular" },
  devInfoVal: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", maxWidth: "60%" },

  footer: {
    textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular",
    marginTop: 24, marginBottom: 8,
  },
});
