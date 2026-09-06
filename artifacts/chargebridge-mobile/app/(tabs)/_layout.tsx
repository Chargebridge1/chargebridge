import { Tabs, useRouter } from "expo-router";
import React, { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ONBOARDING_KEY } from "@/app/onboarding";

// ─────────────────────────────────────────────────────────────────────────────
// Tab layout — routing only.
//
// tabBar={() => null} removes the default React Navigation tab bar entirely
// so that screens render full-height. The visible tab bar is rendered by
// CustomTabBar (in app/_layout.tsx, mounted inside NavPillProvider) as an
// absolute overlay, which gives it access to NavPillContext for reordering.
// ─────────────────────────────────────────────────────────────────────────────

export default function TabLayout() {
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      if (!val) router.replace("/onboarding");
    });
  }, []);

  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
    >
      {/* Visible tabs — routing is the only purpose of these Screen entries */}
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="map" options={{ title: "Map" }} />
      <Tabs.Screen name="charge" options={{ title: "Charge" }} />
      <Tabs.Screen name="activity" options={{ title: "Activity" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />

      {/* Hidden — prevents expo-router from auto-generating tab items */}
      <Tabs.Screen name="dashboard" options={{ href: null }} />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="gas" options={{ href: null }} />
      <Tabs.Screen name="invoices" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="favorites" options={{ href: null }} />
    </Tabs>
  );
}
