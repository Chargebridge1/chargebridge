import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@/lib/api-client";
import {
  setBaseUrl as setWorkspaceBaseUrl,
  setAuthTokenGetter as setWorkspaceAuthTokenGetter,
} from "@workspace/api-client-react";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, AppStateStatus, Linking, Platform, Settings, View } from "react-native";
import { track, identifyUser, posthogClient, PostHogProvider } from "@/lib/analytics";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StripeProvider } from "@stripe/stripe-react-native";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { checkClerkAlignment } from "@/utils/clerkInstanceCheck";
import { UnitsProvider } from "@/hooks/useUnits";
import { WallpaperProvider } from "@/contexts/WallpaperContext";
import { VoiceProvider } from "@/contexts/VoiceContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { NavPillProvider } from "@/contexts/NavPillContext";
import { NavStateProvider } from "@/contexts/NavStateContext";
import { CustomTabBar } from "@/components/navigation/CustomTabBar";
import { OtaUpdateChecker, OtaUpdateProvider } from "@/contexts/OtaUpdateContext";
import { urlToRoute } from "@/utils/resolveInitialRoute";
import { setPendingRoute } from "@/utils/pendingRoute";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";
import "@/utils/crashInstrumentation";
import {
  logStartup,
  readAndClearCrashLog,
  readAndClearStartupTrace,
} from "@/utils/crashInstrumentation";
import "@/tasks/backgroundNav";
import {
  initCarPlay,
  cleanupCarPlay,
} from "@/app/carplay/CarPlayService";
import { tokens } from "@workspace/design-tokens";
import * as Sentry from "@sentry/react-native";

if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: __DEV__ ? "development" : "production",
    tracesSampleRate: __DEV__ ? 0 : 0.1,
  });
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
if (domain) setWorkspaceBaseUrl(`https://${domain}`);

SplashScreen.preventAutoHideAsync();

// Show notifications while the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Analytics: app lifecycle + user identity ─────────────────────────────────
function AppLifecycleHandler() {
  const { userId } = useAuth();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const sessionStartRef = useRef<number>(Date.now());

  useEffect(() => {
    // Cold start
    track("app_opened", { source: "cold_start" });
    sessionStartRef.current = Date.now();

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "active" && prev !== "active") {
        sessionStartRef.current = Date.now();
        track("app_opened", { source: "resume" });
      } else if ((next === "background" || next === "inactive") && prev === "active") {
        const duration_s = Math.round((Date.now() - sessionStartRef.current) / 1000);
        track("app_backgrounded", { session_duration_s: duration_s });
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (userId) identifyUser(userId);
  }, [userId]);

  return null;
}

// ── CarPlay lifecycle ─────────────────────────────────────────────────────────
function CarPlayHandler() {
  useEffect(() => {
    logStartup("initCarPlay:before");
    initCarPlay();
    logStartup("initCarPlay:after");
    return () => cleanupCarPlay();
  }, []);
  return null;
}

// ── Deep link handler ────────────────────────────────────────────────────────
// parseDeepLink: navigate directly when the user is already authenticated.
// urlToRoute (imported from resolveInitialRoute) holds the URL→route logic and
// is also used by resolveInitialRoute() so we never duplicate the regex.
function parseDeepLink(url: string | null) {
  const route = urlToRoute(url);
  if (route) router.push(route as any);
}

function DeepLinkHandler() {
  const { isSignedIn } = useAuth();
  // Ref so the listener closure always reads the latest auth state without
  // needing to re-register itself whenever isSignedIn changes.
  const isSignedInRef = useRef(isSignedIn);

  useEffect(() => {
    isSignedInRef.current = isSignedIn;
  }, [isSignedIn]);

  useEffect(() => {
    // Cold-start initial URL:
    //   Signed in  → navigate directly (user is already inside the app).
    //   Not signed in → resolveInitialRoute() calls Linking.getInitialURL()
    //                   itself and handles the deep link after auth completes.
    if (isSignedIn) {
      Linking.getInitialURL().then(parseDeepLink);
    }

    // Ongoing listener (fires while the app is open and foregrounded)
    const sub = Linking.addEventListener("url", ({ url }) => {
      const route = urlToRoute(url);
      if (!route) return;
      if (isSignedInRef.current) {
        // Already authenticated — navigate immediately.
        router.push(route as any);
      } else {
        // User is on an auth screen. Store the route; resolveInitialRoute()
        // will consume it after sign-in/up completes.
        setPendingRoute(route);
      }
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── Notification tap handler ─────────────────────────────────────────────────
// When a user taps a "Port available!" notification, navigate to that station.
function NotificationResponseHandler() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const stationId = data?.stationId;
      if (stationId != null) {
        router.push(`/station/${stationId}` as any);
      }
    });
    return () => sub.remove();
  }, []);
  return null;
}

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

function AppShell() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  // In dev/staging, warn if the Clerk instance baked into this build does not
  // match the instance the production API server validates against.
  // Mismatch fingerprint: hasAuthHeader:true, clerkUserId:null in DIAG logs.
  useEffect(() => {
    if (!__DEV__) return;
    const apiBase = process.env.EXPO_PUBLIC_CLERK_PROXY_URL?.replace(/\/api\/__clerk.*$/, "") ||
      `https://${process.env.EXPO_PUBLIC_DOMAIN || "www.chargebridgeapp.com"}`;
    checkClerkAlignment(apiBase, process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).then((result) => {
      if (!result.aligned) {
        console.warn(
          "[ClerkInstanceCheck] MISMATCH — mobile Clerk instance does not match server.\n" +
          `  mobile : ${result.mobileInstance ?? "(none)"}\n` +
          `  server : ${result.serverInstance ?? "(unreachable)"}\n` +
          "  All authenticated API calls will return 401 with clerkUserId:null.\n" +
          "  Fix: update EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in EAS production env to match server clerkInstance."
        );
      }
      if (result.isTestKey) {
        console.warn(
          "[ClerkInstanceCheck] pk_test_ key detected in this build. " +
          "Production EAS builds must use a pk_live_ key."
        );
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register the Clerk Bearer token on both API clients so every generated
  // React Query hook sends authenticated requests to the backend.
  useEffect(() => {
    const getter = async () => {
      try { return await getToken(); } catch { return null; }
    };
    setAuthTokenGetter(getter);
    setWorkspaceAuthTokenGetter(getter);
    return () => {
      setAuthTokenGetter(null);
      setWorkspaceAuthTokenGetter(null);
    };
  }, [getToken]);

  // Clear the entire query cache when the user signs out so stale auth-error
  // results (e.g. cached 401s for vehicles, profile, reviews) are never served
  // as the opening state on the next sign-in.
  const prevSignedInRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevSignedInRef.current === true && isSignedIn === false) {
      queryClient.clear();
    }
    prevSignedInRef.current = isSignedIn;
  }, [isSignedIn]);

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: tokens.colors.light.bg.canvas }}>
        <ActivityIndicator size="large" color={tokens.colors.light.brand.primary} />
      </View>
    );
  }

  return (
    <OtaUpdateProvider>
      <AppLifecycleHandler />
      <CarPlayHandler />
      <DeepLinkHandler />
      <NotificationResponseHandler />
      <OtaUpdateChecker />
      <NavPillProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="station/[id]" options={{ headerShown: false, presentation: "card" }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false, presentation: "card" }} />
          <Stack.Screen name="trip-planner" options={{ headerShown: false, presentation: "card" }} />
          <Stack.Screen name="cities" options={{ headerShown: false, presentation: "card" }} />
          <Stack.Screen name="session-summary" options={{ headerShown: false, presentation: "card" }} />
          <Stack.Screen name="admin-setup" options={{ headerShown: false, presentation: "card" }} />
        </Stack>
        <CustomTabBar />
      </NavPillProvider>
    </OtaUpdateProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Read crash log written by the global error handler in the previous session.
  // Runs once on mount; output appears in EAS/Metro console logs for diagnosis.
  useEffect(() => {
    readAndClearCrashLog().then((log) => {
      if (log) console.warn("[ChargeBridge] Previous session crash log:", log);
    }).catch(() => {});
    readAndClearStartupTrace().then((trace) => {
      if (trace) console.warn("[ChargeBridge] Previous session startup trace:\n" + trace);
    }).catch(() => {});

    // CB-DIAG build 160: read void native exception written by RCTTurboModule.mm @catch
    // before it calls JSI. NSUserDefaults.synchronize() runs before the throw, so this
    // survives the process crash and appears on the NEXT launch.
    // Shows exactly which Module.method threw the ObjC exception.
    try {
      const voidExcModule = Settings.get("CBVoidExcModule") as string | undefined;
      const voidExcMethod = Settings.get("CBVoidExcMethod") as string | undefined;
      const voidExcName = Settings.get("CBVoidExcName") as string | undefined;
      const voidExcReason = Settings.get("CBVoidExcReason") as string | undefined;
      if (voidExcModule) {
        console.warn(
          `[ChargeBridge] Previous void native exception: ${voidExcModule}.${voidExcMethod}` +
          ` (${voidExcName}): ${voidExcReason}`
        );
        Settings.set({ CBVoidExcModule: "", CBVoidExcMethod: "", CBVoidExcName: "", CBVoidExcReason: "" });
      }
    } catch { }
  }, []);

  // Fallback: if fonts haven't resolved after 5 s, unblock the render anyway
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || fontTimedOut;

  // Fetch Stripe publishable key from API (safe — publishable key is public)
  const [stripeKey, setStripeKey] = useState("");
  useEffect(() => {
    const d = process.env.EXPO_PUBLIC_DOMAIN;
    if (!d) return;
    fetch(`https://${d}/api/stripe/config`)
      .then((r) => r.json())
      .then((data) => { if (data.publishableKey) setStripeKey(data.publishableKey); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) return null;

  const tree = (
    <StripeProvider
      publishableKey={stripeKey}
      merchantIdentifier="merchant.app.replit.chargebridge"
      urlScheme="chargebridge-mobile"
    >
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <UnitsProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <WallpaperProvider>
                      <SessionProvider>
                        <NavStateProvider>
                          <VoiceProvider>
                            <AppShell />
                            <VoiceOverlay />
                            <VoiceButton />
                          </VoiceProvider>
                        </NavStateProvider>
                      </SessionProvider>
                    </WallpaperProvider>
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </UnitsProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkProvider>
    </StripeProvider>
  );

  if (posthogClient) {
    return <PostHogProvider client={posthogClient}>{tree}</PostHogProvider>;
  }
  return tree;
}
