import { useAuth } from "@clerk/expo";
import { useRouter, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch,
  ActivityIndicator, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useButtonConfigs, useToggleButton, type ButtonConfig } from "@/hooks/useButtonConfigs";
import * as Haptics from "expo-haptics";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

function useAdminReviewStats() {
  const { getToken } = useAuth();
  return useQuery<{ pendingStations: number; pendingApplications: number; removedStations: number }>({
    queryKey: ["admin-review-stats"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/review-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch review stats");
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 300_000,
    refetchInterval: 60_000,
  });
}

interface AdminsResponse {
  admins: { clerkId: string; email: string; name: string | null }[];
  envAdminIds: string[];
}

function useAdminCount() {
  const { getToken } = useAuth();
  return useQuery<AdminsResponse>({
    queryKey: ["admin-admins-count"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch admin list");
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

type UserRole = "admin" | "client";
function useRole() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.publicMetadata as { role?: UserRole } | undefined)?.role ?? "client";
  return { isAdmin: role === "admin" };
}

interface FoundUser {
  clerkId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  existingRole: "admin" | "reviewer" | null;
}

function PromoteUserSection() {
  const { getToken } = useAuth();
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundUser | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState<"admin" | "reviewer">("admin");

  function handleEmailChange(v: string) {
    setEmail(v);
    if (found || searchError) { setFound(null); setSearchError(null); }
    if (promoteSuccess) setPromoteSuccess(null);
    if (promoteError) setPromoteError(null);
  }

  async function handleSearch() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) return;
    Haptics.selectionAsync();
    setSearching(true);
    setSearchError(null);
    setFound(null);
    setPromoteSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/users?email=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setSearchError(data.error ?? "User not found."); return; }
      setFound(data as FoundUser);
    } catch {
      setSearchError("Network error — please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handlePromote() {
    if (!found) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPromoting(true);
    setPromoteError(null);
    try {
      const token = await getToken();
      const endpoint = targetRole === "admin" ? "/api/admin/admins" : "/api/admin/reviewers";
      const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: found.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to promote user.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPromoteSuccess(`${found.name ?? found.email} promoted to ${targetRole}. Role takes effect on next sign-in.`);
      setFound(null);
      setEmail("");
    } catch (err: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPromoteError(err instanceof Error ? err.message : "Failed to promote user.");
    } finally {
      setPromoting(false);
    }
  }

  const promoteDisabled =
    promoting ||
    !found ||
    found.existingRole === targetRole ||
    (targetRole === "reviewer" && found.existingRole === "admin");

  const initials = found ? (found.name ?? found.email).charAt(0).toUpperCase() : "";

  return (
    <View style={styles.promoteSection}>
      <View style={styles.promoteSectionHeader}>
        <View style={styles.promoteIconWrap}>
          <Feather name="user-plus" size={18} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.promoteSectionTitle}>Promote User</Text>
          <Text style={styles.promoteSectionSub}>Search by email and grant a role</Text>
        </View>
      </View>

      {/* Role selector */}
      <View style={styles.roleTabRow}>
        <Pressable
          style={[styles.roleTab, targetRole === "admin" && styles.roleTabActive]}
          onPress={() => { setTargetRole("admin"); setFound(null); setSearchError(null); setPromoteError(null); setPromoteSuccess(null); }}
        >
          <Text style={[styles.roleTabTxt, targetRole === "admin" && styles.roleTabTxtActive]}>Admin</Text>
        </Pressable>
        <Pressable
          style={[styles.roleTab, targetRole === "reviewer" && styles.roleTabActive]}
          onPress={() => { setTargetRole("reviewer"); setFound(null); setSearchError(null); setPromoteError(null); setPromoteSuccess(null); }}
        >
          <Text style={[styles.roleTabTxt, targetRole === "reviewer" && styles.roleTabTxtActive]}>Reviewer</Text>
        </Pressable>
      </View>

      {/* Email search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.emailInput}
          value={email}
          onChangeText={handleEmailChange}
          placeholder="user@example.com"
          placeholderTextColor="#9AAFAF"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!searching && !promoting}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[styles.findBtn, (!email.includes("@") || searching || promoting) && styles.findBtnDisabled]}
          onPress={handleSearch}
          disabled={!email.includes("@") || searching || promoting}
          activeOpacity={0.8}
        >
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.findBtnTxt}>Find</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Search error */}
      {searchError && (
        <View style={styles.alertRow}>
          <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
          <Text style={styles.alertTxt}>{searchError}</Text>
        </View>
      )}

      {/* Found user card */}
      {found && (
        <View style={styles.foundCard}>
          <View style={styles.foundTopRow}>
            {/* Avatar */}
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarTxt}>{initials}</Text>
            </View>

            {/* Name + email + role badge */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.foundName} numberOfLines={1}>
                  {found.name ?? found.email}
                </Text>
                {found.existingRole === "admin" && (
                  <View style={[styles.roleBadge, styles.roleBadgeAdmin]}>
                    <Text style={[styles.roleBadgeTxt, styles.roleBadgeAdminTxt]}>Already an Admin</Text>
                  </View>
                )}
                {found.existingRole === "reviewer" && (
                  <View style={[styles.roleBadge, styles.roleBadgeReviewer]}>
                    <Text style={[styles.roleBadgeTxt, styles.roleBadgeReviewerTxt]}>Already a Reviewer</Text>
                  </View>
                )}
              </View>
              <Text style={styles.foundEmail} numberOfLines={1}>{found.email}</Text>
            </View>
          </View>

          {/* Conflict explanation */}
          {found.existingRole === targetRole && (
            <View style={styles.conflictNote}>
              <Ionicons name="information-circle-outline" size={13} color="#6B6B6B" />
              <Text style={styles.conflictNoteTxt}>
                This user already has the <Text style={{ fontWeight: "700" }}>{targetRole}</Text> role — no action needed.
              </Text>
            </View>
          )}
          {found.existingRole === "admin" && targetRole === "reviewer" && (
            <View style={styles.conflictNote}>
              <Ionicons name="information-circle-outline" size={13} color="#6B6B6B" />
              <Text style={styles.conflictNoteTxt}>
                This user is already an <Text style={{ fontWeight: "700" }}>Admin</Text>, which includes all reviewer permissions.
              </Text>
            </View>
          )}

          {/* Promote error */}
          {promoteError && (
            <View style={[styles.alertRow, { marginTop: 8 }]}>
              <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
              <Text style={styles.alertTxt}>{promoteError}</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.promoteBtn, promoteDisabled && styles.promoteBtnDisabled]}
              onPress={handlePromote}
              disabled={promoteDisabled}
              activeOpacity={0.85}
            >
              {promoting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.promoteBtnTxt}>Promote to {targetRole === "admin" ? "Admin" : "Reviewer"}</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => { setFound(null); setPromoteError(null); }}
              disabled={promoting}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Promote success */}
      {promoteSuccess && (
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={13} color="#22c55e" />
          <Text style={styles.successTxt}>{promoteSuccess}</Text>
        </View>
      )}
    </View>
  );
}

const ADMIN_SECTIONS = [
  { icon: "bar-chart-2", label: "Analytics", description: "Station usage, revenue & trends", color: "#6366F1" },
  { icon: "dollar-sign", label: "Pricing & Fees", description: "Configure rates and fee structures", color: "#0D9E7E" },
  { icon: "briefcase", label: "Operators", description: "Manage network operator applications", color: "#F59E0B" },
  { icon: "file-text", label: "Audit Log", description: "Hard deletions and role changes", color: "#B91C1C", route: "/admin-audit-log" },
];

function ButtonRow({ config }: { config: ButtonConfig }) {
  const toggle = useToggleButton();

  return (
    <View style={styles.btnRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.btnLabel}>{config.label}</Text>
        <Text style={styles.btnDesc} numberOfLines={2}>{config.description}</Text>
      </View>
      <Switch
        value={config.enabled}
        onValueChange={(enabled) => toggle.mutate({ key: config.key, enabled })}
        trackColor={{ false: "#D5D0C8", true: "#0D9E7E55" }}
        thumbColor={config.enabled ? "#0D9E7E" : "#9AAFAF"}
        disabled={toggle.isPending}
      />
    </View>
  );
}

function LocationGroup({ location, configs }: { location: string; configs: ButtonConfig[] }) {
  return (
    <View style={styles.locationGroup}>
      <Text style={styles.locationLabel}>{location.toUpperCase()}</Text>
      {configs.map((c) => <ButtonRow key={c.key} config={c} />)}
    </View>
  );
}

export default function AdminTab() {
  const { isAdmin } = useRole();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: allConfigs, isLoading } = useButtonConfigs();
  const { data: reviewStats, refetch: refetchReviewStats } = useAdminReviewStats();
  const { data: adminsData } = useAdminCount();
  const removedCount = reviewStats?.removedStations ?? 0;

  useFocusEffect(
    useCallback(() => {
      refetchReviewStats();
    }, [refetchReviewStats])
  );

  const totalAdmins = (adminsData?.admins.length ?? 0) + (adminsData?.envAdminIds.length ?? 0);
  const soleAdmin = adminsData !== undefined && totalAdmins === 1;
  const atMinimumAdmins = adminsData !== undefined && totalAdmins === 2;

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/(tabs)/home");
    }
  }, [isAdmin]);

  if (!isAdmin) return null;

  const mobileConfigs = (allConfigs ?? []).filter((c) => c.platform === "mobile");
  const webConfigs = (allConfigs ?? []).filter((c) => c.platform === "web");

  const mobileByLocation = mobileConfigs.reduce<Record<string, ButtonConfig[]>>((acc, c) => {
    (acc[c.location] ??= []).push(c);
    return acc;
  }, {});

  const webByLocation = webConfigs.reduce<Record<string, ButtonConfig[]>>((acc, c) => {
    (acc[c.location] ??= []).push(c);
    return acc;
  }, {});

  const enabledCount = (allConfigs ?? []).filter((c) => c.enabled).length;
  const totalCount = (allConfigs ?? []).length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerTopRow}>
            <View style={styles.badgeRow}>
              <Feather name="shield" size={14} color="#0D9E7E" />
              <Text style={styles.badge}>ChargeBridge Admin</Text>
            </View>
            {removedCount > 0 && (
              <Pressable
                style={styles.removedBadge}
                onPress={() => router.push("/admin-removed" as any)}
              >
                <Feather name="trash-2" size={11} color="#B91C1C" />
                <Text style={styles.removedBadgeText}>{removedCount} removed</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.heading}>Admin Panel</Text>
          <Text style={styles.subheading}>Manage your network operations</Text>
        </View>

        {soleAdmin && (
          <View style={styles.soleAdminBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#991b1b" />
            <Text style={styles.soleAdminBannerTxt}>
              <Text style={{ fontWeight: "700" }}>Warning: only 1 admin remains.</Text>
              {" "}If the ADMIN_CLERK_USER_IDS env var has been emptied, there may be no fallback admin. Add another admin now to avoid losing access.
            </Text>
          </View>
        )}

        {atMinimumAdmins && (
          <View style={styles.minAdminBanner}>
            <Ionicons name="warning-outline" size={16} color="#92400e" />
            <Text style={styles.minAdminBannerTxt}>
              <Text style={{ fontWeight: "700" }}>Minimum 2 admins required.</Text>
              {" "}You currently have exactly 2 admins. To revoke one, add a third admin first using the web dashboard or the Promote section below.
            </Text>
          </View>
        )}

        <View style={styles.grid}>
          {ADMIN_SECTIONS.map(({ icon, label, description, color, route }) => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={route ? () => router.push(route as any) : undefined}
            >
              <View style={[styles.iconBox, { backgroundColor: color + "18" }]}>
                <Feather name={icon as any} size={22} color={color} />
              </View>
              <Text style={styles.cardLabel}>{label}</Text>
              <Text style={styles.cardDesc}>{description}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── Promote User ── */}
        <PromoteUserSection />

        {/* ── Button Manager ── */}
        <View style={styles.managerSection}>
          <View style={styles.managerHeader}>
            <View style={styles.managerIconWrap}>
              <Feather name="sliders" size={18} color="#0D9E7E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.managerTitle}>Button Manager</Text>
              <Text style={styles.managerSub}>
                {isLoading ? "Loading…" : `${enabledCount} of ${totalCount} buttons enabled`}
              </Text>
            </View>
          </View>

          {isLoading ? (
            <ActivityIndicator color="#0D9E7E" style={{ marginTop: 16 }} />
          ) : (
            <>
              {/* Mobile */}
              <View style={styles.platformSection}>
                <View style={styles.platformRow}>
                  <Feather name="smartphone" size={14} color="#8b5cf6" />
                  <Text style={[styles.platformLabel, { color: "#8b5cf6" }]}>Mobile App</Text>
                </View>
                {Object.entries(mobileByLocation).map(([loc, cfgs]) => (
                  <LocationGroup key={loc} location={loc} configs={cfgs} />
                ))}
              </View>

              {/* Web */}
              <View style={styles.platformSection}>
                <View style={styles.platformRow}>
                  <Feather name="monitor" size={14} color="#0D9E7E" />
                  <Text style={[styles.platformLabel, { color: "#0D9E7E" }]}>Website</Text>
                </View>
                {Object.entries(webByLocation).map(([loc, cfgs]) => (
                  <LocationGroup key={loc} location={loc} configs={cfgs} />
                ))}
              </View>
            </>
          )}

          <View style={styles.managerNote}>
            <Feather name="info" size={12} color="#6B6B6B" />
            <Text style={styles.managerNoteTxt}>
              Disabling a button hides it from the UI. The underlying data and API routes remain active.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.webDashboardRow}
          activeOpacity={0.8}
          onPress={() => {
            Haptics.selectionAsync();
            WebBrowser.openBrowserAsync(`https://${process.env.EXPO_PUBLIC_DOMAIN}/admin`);
          }}
        >
          <View style={styles.webDashboardIcon}>
            <Feather name="users" size={18} color="#6366F1" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.webDashboardLabel}>Manage admin roles</Text>
            <Text style={styles.webDashboardSub}>Open the full role management dashboard</Text>
          </View>
          <Feather name="external-link" size={16} color="#9AAFAF" />
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Feather name="info" size={14} color="#6B6B6B" />
          <Text style={styles.infoText}>
            Full admin tools are available on the web dashboard. This panel provides a quick overview.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F7F4" },
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E4DC",
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { fontSize: 11, fontWeight: "700", color: "#0D9E7E", textTransform: "uppercase", letterSpacing: 0.5 },
  removedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: "#FEE2E2", borderRadius: 20,
    borderWidth: 1, borderColor: "#FECACA",
  },
  removedBadgeText: { fontSize: 11, fontWeight: "700", color: "#B91C1C" },
  heading: { fontSize: 24, fontWeight: "800", color: "#1A2530", marginBottom: 4 },
  subheading: { fontSize: 14, color: "#6B6B6B" },
  grid: { padding: 16, gap: 12 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 18, borderWidth: 1, borderColor: "#E8E4DC" },
  cardPressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  cardLabel: { fontSize: 16, fontWeight: "700", color: "#1A2530", marginBottom: 4 },
  cardDesc: { fontSize: 13, color: "#6B6B6B", lineHeight: 18 },

  promoteSection: {
    margin: 16,
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8E4DC",
    padding: 16,
  },
  promoteSectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  promoteIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "#6366F118",
    alignItems: "center", justifyContent: "center",
  },
  promoteSectionTitle: { fontSize: 16, fontWeight: "700", color: "#1A2530" },
  promoteSectionSub: { fontSize: 12, color: "#6B6B6B", marginTop: 2 },

  roleTabRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  roleTab: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: "#E8E4DC",
    alignItems: "center",
  },
  roleTabActive: { backgroundColor: "#6366F1", borderColor: "#6366F1" },
  roleTabTxt: { fontSize: 13, fontWeight: "600", color: "#6B6B6B" },
  roleTabTxtActive: { color: "#fff" },

  searchRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  emailInput: {
    flex: 1, fontSize: 14, color: "#1A2530",
    borderWidth: 1, borderColor: "#E8E4DC", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: "#F8F7F4",
  },
  findBtn: {
    backgroundColor: "#6366F1", borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 10,
    alignItems: "center", justifyContent: "center",
    minWidth: 60,
  },
  findBtnDisabled: { opacity: 0.5 },
  findBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },

  alertRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  alertTxt: { flex: 1, fontSize: 12, color: "#ef4444", lineHeight: 16 },

  successRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  successTxt: { flex: 1, fontSize: 12, color: "#22c55e", lineHeight: 16 },

  foundCard: {
    marginTop: 10,
    borderWidth: 1, borderColor: "#E8E4DC",
    borderRadius: 12, padding: 12,
    backgroundColor: "#F8F7F4",
  },
  foundTopRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#6366F118",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  avatarTxt: { fontSize: 15, fontWeight: "700", color: "#6366F1" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  foundName: { fontSize: 14, fontWeight: "600", color: "#1A2530" },
  foundEmail: { fontSize: 11, color: "#6B6B6B", marginTop: 1 },

  roleBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 20, flexShrink: 0,
  },
  roleBadgeAdmin: { backgroundColor: "#0D9E7E18" },
  roleBadgeAdminTxt: { color: "#0D9E7E", fontSize: 10, fontWeight: "700" },
  roleBadgeReviewer: { backgroundColor: "#DBEAFE" },
  roleBadgeReviewerTxt: { color: "#1D4ED8", fontSize: 10, fontWeight: "700" },
  roleBadgeTxt: {},

  conflictNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: "#F0F0ED", borderRadius: 8, padding: 8, marginBottom: 8,
  },
  conflictNoteTxt: { flex: 1, fontSize: 11, color: "#6B6B6B", lineHeight: 16 },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  promoteBtn: {
    flex: 1, backgroundColor: "#6366F1", borderRadius: 10,
    paddingVertical: 10, alignItems: "center", justifyContent: "center",
  },
  promoteBtnDisabled: { opacity: 0.4 },
  promoteBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#E8E4DC", borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  cancelBtnTxt: { fontSize: 13, color: "#6B6B6B", fontWeight: "600" },

  managerSection: {
    margin: 16,
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8E4DC",
    padding: 16,
  },
  managerHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  managerIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "#0D9E7E18",
    alignItems: "center", justifyContent: "center",
  },
  managerTitle: { fontSize: 16, fontWeight: "700", color: "#1A2530" },
  managerSub: { fontSize: 12, color: "#6B6B6B", marginTop: 2 },

  platformSection: { marginBottom: 16 },
  platformRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  platformLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  locationGroup: { marginBottom: 12 },
  locationLabel: { fontSize: 10, fontWeight: "600", color: "#9AAFAF", letterSpacing: 0.4, marginBottom: 8 },

  btnRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E8E4DC",
  },
  btnLabel: { fontSize: 14, fontWeight: "600", color: "#1A2530" },
  btnDesc: { fontSize: 12, color: "#6B6B6B", marginTop: 2, lineHeight: 16 },

  managerNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginTop: 12, padding: 10, backgroundColor: "#F8F7F4", borderRadius: 8,
  },
  managerNoteTxt: { flex: 1, fontSize: 11, color: "#6B6B6B", lineHeight: 16 },

  webDashboardRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#fff",
    borderRadius: 14, borderWidth: 1, borderColor: "#E8E4DC",
    padding: 14,
  },
  webDashboardIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "#6366F118",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  webDashboardLabel: { fontSize: 15, fontWeight: "700", color: "#1A2530" },
  webDashboardSub: { fontSize: 12, color: "#6B6B6B", marginTop: 2 },

  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    margin: 16, marginTop: 6, padding: 14, backgroundColor: "#F0F0ED", borderRadius: 10,
  },
  infoText: { flex: 1, fontSize: 12, color: "#6B6B6B", lineHeight: 18 },

  soleAdminBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginHorizontal: 16, marginTop: 12,
    padding: 14,
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  soleAdminBannerTxt: { flex: 1, fontSize: 13, color: "#991b1b", lineHeight: 19 },

  minAdminBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginHorizontal: 16, marginTop: 12,
    padding: 14,
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  minAdminBannerTxt: { flex: 1, fontSize: 13, color: "#92400e", lineHeight: 19 },
});
