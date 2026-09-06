import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSignIn, useClerk, useOAuth } from "@clerk/expo";
import * as WebBrowser from "expo-web-browser";
import { Link, useRouter, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { resolveInitialRoute } from "@/utils/resolveInitialRoute";
import {
  AuthFinalizeError,
  finalizeCompletedSignIn,
} from "@/utils/finalizeSignIn";
import {
  AuthContinuationError,
  beginAdditionalVerification,
  verifyAdditionalVerification,
  type AdditionalVerificationState,
} from "@/utils/continueSignIn";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn } = useSignIn();
  const clerk = useClerk();
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<AdditionalVerificationState | null>(null);
  const [verificationCode, setVerificationCode] = useState("");

  const { startOAuthFlow: startGoogle } = useOAuth({ strategy: "oauth_google" });
  const { startOAuthFlow: startApple } = useOAuth({ strategy: "oauth_apple" });

  /** Resolve where to land after a successful sign-in.
   *  If the user arrived here from a session-expiry path, send them straight
   *  back to the profile tab with the appropriate param so the interrupted flow
   *  resumes automatically (Add Card modal, Edit Vehicle form, Add Vehicle form).
   *  All other paths go through the normal resolveInitialRoute() logic. */
  async function resolvePostAuthRoute(): Promise<string> {
    if (returnTo === "addCard") {
      return "/(tabs)/profile?openAddCard=1";
    }
    if (returnTo === "editVehicle") {
      return "/(tabs)/profile?openEditVehicle=1";
    }
    if (returnTo === "addVehicle") {
      return "/(tabs)/profile?openAddVehicle=1";
    }
    if (returnTo === "profile") {
      return "/(tabs)/profile";
    }
    return resolveInitialRoute();
  }

  async function finalizeAndRoute() {
    if (!signIn) return;
    await finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => clerk.session?.id,
      onAuthenticated: async () => {
        router.replace(await resolvePostAuthRoute() as any);
      },
    });
  }

  const handleSignIn = async () => {
    if (!signIn) return;
    setLoading(true);
    setError("");
    try {
      const { error } = await signIn.password({ identifier: email, password });
      if (error) throw error;
      const nextVerification = await beginAdditionalVerification(signIn);
      if (nextVerification) {
        setVerification(nextVerification);
        setVerificationCode("");
        return;
      }
      await finalizeAndRoute();
    } catch (err: any) {
      const msg = err instanceof AuthFinalizeError || err instanceof AuthContinuationError
        ? err.message
        : err?.errors?.[0]?.message ?? err?.message ?? "Sign in failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!signIn || !verification) return;
    setLoading(true);
    setError("");
    try {
      await verifyAdditionalVerification(
        signIn,
        verification.method,
        verificationCode,
      );
      await finalizeAndRoute();
    } catch (err: any) {
      const msg = err instanceof AuthFinalizeError || err instanceof AuthContinuationError
        ? err.message
        : err?.errors?.[0]?.message ?? err?.message ?? "Verification failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = async () => {
    if (!signIn) return;
    await signIn.reset();
    setVerification(null);
    setVerificationCode("");
    setPassword("");
    setError("");
  };

  async function handleOAuth(provider: "google" | "apple") {
    setOauthLoading(provider);
    setError("");
    try {
      const { createdSessionId, setActive: setActiveSession } = await (
        provider === "google" ? startGoogle : startApple
      )();
      if (createdSessionId && setActiveSession) {
        await setActiveSession({ session: createdSessionId });
        router.replace(await resolvePostAuthRoute() as any);
      }
    } catch (err: any) {
      setError(
        err?.errors?.[0]?.message ??
          err?.message ??
          `${provider === "google" ? "Google" : "Apple"} sign-in failed`
      );
    } finally {
      setOauthLoading(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoBox}>
            <Feather name="zap" size={28} color="#0D9E7E" />
          </View>
          <Text style={styles.brand}>ChargeBridge</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>
            {verification ? "Verify your sign-in" : "Welcome back"}
          </Text>
          <Text style={styles.subtitle}>
            {verification?.reason === "needs_client_trust"
              ? "Clerk requires verification before trusting this device."
              : verification?.reason === "needs_second_factor"
                ? "Your account requires a second verification factor."
                : "Sign in to your account"}
          </Text>

          {verification ? (
            <>
              <Text style={styles.label}>
                {verification.method === "email_code"
                  ? "Email verification code"
                  : "Authenticator code"}
              </Text>
              <TextInput
                style={styles.input}
                value={verificationCode}
                onChangeText={setVerificationCode}
                placeholder="Enter verification code"
                placeholderTextColor="#9AAFAF"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                style={[
                  styles.button,
                  (!verificationCode.trim() || loading) && styles.buttonDisabled,
                ]}
                onPress={handleVerify}
                disabled={!verificationCode.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify and continue</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.secondaryButton}
                onPress={handleStartOver}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Start over</Text>
              </Pressable>
            </>
          ) : (
            <>
          {Platform.OS === "ios" && (
            <Pressable
              style={[styles.socialBtn, styles.appleBtn]}
              onPress={() => handleOAuth("apple")}
              disabled={!!oauthLoading || loading}
            >
              {oauthLoading === "apple" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={18} color="#fff" />
                  <Text style={[styles.socialBtnTxt, { color: "#fff" }]}>
                    Continue with Apple
                  </Text>
                </>
              )}
            </Pressable>
          )}

          <Pressable
            style={[styles.socialBtn, styles.googleBtn]}
            onPress={() => handleOAuth("google")}
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === "google" ? (
              <ActivityIndicator color="#1A2530" size="small" />
            ) : (
              <>
                <Ionicons name="logo-google" size={16} color="#4285F4" />
                <Text style={[styles.socialBtnTxt, { color: "#1A2530" }]}>
                  Continue with Google
                </Text>
              </>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerTxt}>or with email</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9AAFAF"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor="#9AAFAF"
              secureTextEntry={!showPassword}
              autoComplete="current-password"
            />
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeBtn}
            >
              <Feather
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color="#6B8080"
              />
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[
              styles.button,
              (!email || !password || loading) && styles.buttonDisabled,
            ]}
            onPress={handleSignIn}
            disabled={!email || !password || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/sign-up">
              <Text style={styles.linkText}>Sign up</Text>
            </Link>
          </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F7F4" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  header: { alignItems: "center", marginBottom: 32 },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#0D9E7E22",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  brand: { fontSize: 24, fontWeight: "700", color: "#1A2530", letterSpacing: -0.5 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#1A2530", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#6B6B6B", marginBottom: 20 },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: 10,
  },
  appleBtn: { backgroundColor: "#000" },
  googleBtn: {
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#D5D0C8",
  },
  socialBtnTxt: { fontSize: 15, fontWeight: "600" },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#D5D0C8",
  },
  dividerTxt: { fontSize: 12, color: "#9AAFAF", fontWeight: "500" },
  label: { fontSize: 13, fontWeight: "600", color: "#1A2530", marginBottom: 6 },
  input: {
    backgroundColor: "#F8F7F4",
    borderWidth: 1,
    borderColor: "#D5D0C8",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1A2530",
    marginBottom: 16,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  eyeBtn: { padding: 10 },
  button: {
    backgroundColor: "#0D9E7E",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { backgroundColor: "#9AAFAF" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 8,
  },
  secondaryButtonText: { color: "#0D9E7E", fontSize: 14, fontWeight: "600" },
  error: {
    color: "#EF4444",
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
  },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
  footerText: { fontSize: 14, color: "#6B6B6B" },
  linkText: { fontSize: 14, color: "#0D9E7E", fontWeight: "600" },
});
