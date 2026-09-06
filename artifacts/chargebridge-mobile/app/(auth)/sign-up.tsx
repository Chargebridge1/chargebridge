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
import { useSignUp, useOAuth, useClerk } from "@clerk/expo";
import * as WebBrowser from "expo-web-browser";
import { Link, useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { resolveInitialRoute } from "@/utils/resolveInitialRoute";

WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const { signUp } = useSignUp();
  const { setActive } = useClerk();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const { startOAuthFlow: startGoogle } = useOAuth({ strategy: "oauth_google" });
  const { startOAuthFlow: startApple } = useOAuth({ strategy: "oauth_apple" });

  function formatPhone(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  function validateFields(): boolean {
    let valid = true;
    if (!email.includes("@") || !email.includes(".")) {
      setEmailError("Enter a valid email address");
      valid = false;
    } else {
      setEmailError("");
    }
    if (password.length < 8) {
      setPasswordError("Must be at least 8 characters");
      valid = false;
    } else {
      setPasswordError("");
    }
    return valid;
  }

  const handleSignUp = async () => {
    if (!signUp) return;
    if (!validateFields()) return;
    setLoading(true);
    setError("");
    try {
      const { error: passErr } = await signUp.password({ emailAddress: email, password });
      if (passErr) throw passErr;
      const { error: sendErr } = await signUp.verifications.sendEmailCode();
      if (sendErr) throw sendErr;
      setPendingVerification(true);
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message ?? err?.message ?? "Sign up failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!signUp) return;
    setLoading(true);
    setError("");
    try {
      const { error: verifyErr } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyErr) throw verifyErr;
      if (signUp.status === "complete") {
        const { error: finalizeErr } = await signUp.finalize();
        if (finalizeErr) throw finalizeErr;
        const dest = phone.trim()
          ? `/(auth)/complete-profile?phone=${encodeURIComponent(phone.trim())}`
          : "/(auth)/complete-profile";
        router.replace(dest as any);
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message ?? err?.message ?? "Verification failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!signUp) return;
    try {
      await signUp.verifications.sendEmailCode();
    } catch {}
  };

  async function handleOAuth(provider: "google" | "apple") {
    setOauthLoading(provider);
    setError("");
    try {
      const { createdSessionId, setActive: setActiveSession, signUp: oauthSignUp } =
        await (provider === "google" ? startGoogle : startApple)();
      if (createdSessionId && setActiveSession) {
        await setActiveSession({ session: createdSessionId });
        if (oauthSignUp?.status === "complete") {
          router.replace("/(auth)/complete-profile" as any);
        } else {
          router.replace(await resolveInitialRoute() as any);
        }
      }
    } catch (err: any) {
      setError(
        err?.errors?.[0]?.message ??
          err?.message ??
          `${provider === "google" ? "Google" : "Apple"} sign-up failed`
      );
    } finally {
      setOauthLoading(null);
    }
  }

  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
          <View style={styles.card}>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a verification code to {email}
            </Text>

            <Text style={styles.label}>Verification code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              placeholderTextColor="#9AAFAF"
              keyboardType="numeric"
              autoComplete="one-time-code"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[
                styles.button,
                (!code || loading) && styles.buttonDisabled,
              ]}
              onPress={handleVerify}
              disabled={!code || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify email</Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleResend}
              style={{ marginTop: 12, alignItems: "center" }}
            >
              <Text style={styles.linkText}>Resend code</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
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
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join the ChargeBridge community</Text>

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
            style={[styles.input, !!emailError && styles.inputError]}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (emailError) setEmailError("");
            }}
            placeholder="you@example.com"
            placeholderTextColor="#9AAFAF"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          {emailError ? (
            <Text style={styles.fieldError}>{emailError}</Text>
          ) : null}

          <Text style={styles.label}>
            Phone Number{" "}
            <Text style={styles.optional}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(v) => setPhone(formatPhone(v))}
            placeholder="(555) 000-0000"
            placeholderTextColor="#9AAFAF"
            keyboardType="phone-pad"
            maxLength={14}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[
                styles.input,
                { flex: 1, marginBottom: 0 },
                !!passwordError && styles.inputError,
              ]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (passwordError) setPasswordError("");
              }}
              placeholder="At least 8 characters"
              placeholderTextColor="#9AAFAF"
              secureTextEntry={!showPassword}
              autoComplete="new-password"
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
          {passwordError ? (
            <Text style={styles.fieldError}>{passwordError}</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[
              styles.button,
              (!email || !password || loading) && styles.buttonDisabled,
            ]}
            onPress={handleSignUp}
            disabled={!email || !password || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/sign-in">
              <Text style={styles.linkText}>Sign in</Text>
            </Link>
          </View>
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
  inputError: { borderColor: "#EF4444" },
  fieldError: {
    color: "#EF4444",
    fontSize: 12,
    marginTop: -12,
    marginBottom: 10,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 0,
  },
  eyeBtn: { padding: 10 },
  button: {
    backgroundColor: "#0D9E7E",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: { backgroundColor: "#9AAFAF" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: {
    color: "#EF4444",
    fontSize: 13,
    marginBottom: 4,
    marginTop: 10,
    textAlign: "center",
  },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
  footerText: { fontSize: 14, color: "#6B6B6B" },
  linkText: { fontSize: 14, color: "#0D9E7E", fontWeight: "600" },
  optional: { fontSize: 12, color: "#9AAFAF", fontWeight: "400" },
});
