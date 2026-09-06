import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth, useUser } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type UserRole = "admin" | "client";
function useRole() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.publicMetadata as { role?: UserRole } | undefined)?.role ?? "client";
  return { isAdmin: role === "admin" };
}

export default function AdminSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, isLoaded: userLoaded } = useUser();
  const { getToken, signOut } = useAuth();
  const { isAdmin } = useRole();

  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [secureEntry, setSecureEntry] = useState(true);

  async function handleClaim() {
    if (!key.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);
    setLoading(true);
    try {
      let token = await getToken();
      if (!token) {
        try { token = await getToken({ skipCache: true }); } catch { }
      }
      if (!token) {
        setError("Your session has expired. Please sign out and sign back in, then try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const res = await fetch(`${BASE}/api/admin/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(true);
    } catch {
      setError("Network error — check your connection and try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    Alert.alert(
      "Sign Out to Activate",
      "You need to sign out and sign back in for your admin privileges to take effect.",
      [
        { text: "Not Yet", style: "cancel" },
        {
          text: "Sign Out",
          onPress: async () => {
            await signOut();
            router.replace("/(auth)/sign-in" as any);
          },
        },
      ]
    );
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); router.back(); }} style={S.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: colors.foreground }]}>Admin Setup</Text>
      </View>

      <ScrollView
        contentContainerStyle={[S.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Icon + intro */}
        <View style={S.hero}>
          <View style={[S.heroIcon, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="shield-checkmark-outline" size={36} color={colors.primary} />
          </View>
          <Text style={[S.heroTitle, { color: colors.foreground }]}>Admin Setup</Text>
          <Text style={[S.heroSub, { color: colors.mutedForeground }]}>
            Claim administrator access for your ChargeBridge account
          </Text>
        </View>

        {/* Card */}
        <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Already admin */}
          {!userLoaded ? (
            <View style={S.stateBlock}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : isAdmin ? (
            <View style={S.stateBlock}>
              <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
              <Text style={[S.stateTitle, { color: colors.foreground }]}>You're already an admin</Text>
              <Text style={[S.stateSub, { color: colors.mutedForeground }]}>
                Your account has full administrator access.
              </Text>
              <TouchableOpacity
                style={[S.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => { Haptics.selectionAsync(); router.replace("/(tabs)/admin" as any); }}
                activeOpacity={0.85}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
                <Text style={S.actionBtnTxt}>Open Admin Panel</Text>
              </TouchableOpacity>
            </View>
          ) : !user ? (
            /* Not signed in */
            <View style={S.stateBlock}>
              <Ionicons name="log-in-outline" size={44} color={colors.mutedForeground} />
              <Text style={[S.stateTitle, { color: colors.foreground }]}>Sign in first</Text>
              <Text style={[S.stateSub, { color: colors.mutedForeground }]}>
                You need to be signed in to claim admin access.
              </Text>
              <TouchableOpacity
                style={[S.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => { Haptics.selectionAsync(); router.replace("/(auth)/sign-in" as any); }}
                activeOpacity={0.85}
              >
                <Text style={S.actionBtnTxt}>Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : success ? (
            /* Success */
            <View style={S.stateBlock}>
              <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
              <Text style={[S.stateTitle, { color: colors.foreground }]}>Admin access granted!</Text>
              <Text style={[S.stateSub, { color: colors.mutedForeground }]}>
                Your account has been upgraded. Sign out and back in to activate your admin privileges.
              </Text>
              <TouchableOpacity
                style={[S.actionBtn, { backgroundColor: colors.primary }]}
                onPress={handleSignOut}
                activeOpacity={0.85}
              >
                <Ionicons name="log-out-outline" size={16} color="#fff" />
                <Text style={S.actionBtnTxt}>Sign Out & Sign In Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Key entry form */
            <View style={S.form}>
              {/* Signed-in as */}
              <View style={[S.accountBanner, { backgroundColor: colors.muted + "80", borderColor: colors.border }]}>
                <View style={[S.accountAvatar, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[S.accountAvatarTxt, { color: colors.primary }]}>
                    {(user.firstName || user.primaryEmailAddress?.emailAddress || "?").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.accountName, { color: colors.foreground }]}>
                    {user.fullName || user.firstName || "Driver"}
                  </Text>
                  <Text style={[S.accountEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {user.primaryEmailAddress?.emailAddress}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
              </View>

              {/* Key label */}
              <View style={S.fieldLabelRow}>
                <Ionicons name="key-outline" size={15} color={colors.mutedForeground} />
                <Text style={[S.fieldLabel, { color: colors.foreground }]}>Admin setup key</Text>
              </View>

              {/* Key input */}
              <View style={[S.inputWrap, { borderColor: error ? "#ef4444" : colors.border, backgroundColor: colors.background }]}>
                <TextInput
                  style={[S.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                  value={key}
                  onChangeText={(v) => { setKey(v); setError(null); }}
                  placeholder="Paste your admin setup key…"
                  placeholderTextColor={colors.mutedForeground + "88"}
                  secureTextEntry={secureEntry}
                  autoCorrect={false}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity
                  style={S.eyeBtn}
                  onPress={() => { Haptics.selectionAsync(); setSecureEntry(v => !v); }}
                  activeOpacity={0.7}
                >
                  <Feather name={secureEntry ? "eye" : "eye-off"} size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {/* Error */}
              {error && (
                <View style={[S.errorBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                  <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                  <Text style={S.errorTxt}>{error}</Text>
                </View>
              )}

              {/* Claim button */}
              <TouchableOpacity
                style={[S.claimBtn, { backgroundColor: colors.primary, opacity: loading || !key.trim() ? 0.6 : 1 }]}
                onPress={handleClaim}
                disabled={loading || !key.trim()}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <>
                      <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
                      <Text style={S.claimBtnTxt}>Claim Admin Access</Text>
                    </>
                  )}
              </TouchableOpacity>

              {/* Hint */}
              <Text style={[S.hint, { color: colors.mutedForeground }]}>
                The setup key is stored in your Replit environment under{" "}
                <Text style={{ fontFamily: "Inter_700Bold" }}>ADMIN_SETUP_KEY</Text>
              </Text>
            </View>
          )}
        </View>

        {/* Info box */}
        <View style={[S.infoBox, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
          <Text style={[S.infoTxt, { color: colors.mutedForeground }]}>
            Admin access grants full control over station reviews, feature flags, pricing, and analytics. Keep your setup key private.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },

  content: { padding: 20, gap: 16 },

  hero: { alignItems: "center", gap: 10, paddingVertical: 8 },
  heroIcon: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  card: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },

  stateBlock: { alignItems: "center", padding: 28, gap: 10 },
  stateTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 4 },
  stateSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8,
  },
  actionBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  form: { padding: 18, gap: 14 },

  accountBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  accountAvatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  accountAvatarTxt: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  accountName: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  accountEmail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 14, letterSpacing: 0.5 },
  eyeBtn: { padding: 4 },

  errorBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 12,
  },
  errorTxt: { flex: 1, fontSize: 12, color: "#ef4444", fontFamily: "Inter_400Regular", lineHeight: 16 },

  claimBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  claimBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  hint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 15 },

  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  infoTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
