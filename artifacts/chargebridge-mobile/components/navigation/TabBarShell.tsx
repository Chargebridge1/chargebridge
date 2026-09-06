import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabBar as TabBarTokens } from "@/constants/motion";
import { tokens } from "@workspace/design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// TabBarShell — shared glass-bar chrome used by both CustomTabBar (normal
// mode) and EditableTabBar (wiggle/edit mode).
//
// Owns: safe-area measurement, barHeight computation, BlurView background,
// and the hairline top border. Children are rendered inside the bar.
// ─────────────────────────────────────────────────────────────────────────────

const T = tokens.colors.dark.tabBar;

interface TabBarShellProps {
  children:          React.ReactNode;
  pointerEvents?:    React.ComponentProps<typeof View>["pointerEvents"];
  accessibilityRole?: React.ComponentProps<typeof View>["accessibilityRole"];
}

export function TabBarShell({ children, pointerEvents, accessibilityRole }: TabBarShellProps) {
  const insets    = useSafeAreaInsets();
  const barHeight = Platform.OS === "web" ? 72 : insets.bottom + 64;

  return (
    <View
      style={[LS.bar, { height: barHeight, paddingBottom: insets.bottom }]}
      pointerEvents={pointerEvents}
      accessibilityRole={accessibilityRole}
    >
      <BlurView
        intensity={TabBarTokens.blurIntensity}
        tint="dark"
        style={[StyleSheet.absoluteFill, { backgroundColor: T.blurOverlay }]}
        pointerEvents="none"
      />
      <View style={LS.borderTop} pointerEvents="none" />
      {children}
    </View>
  );
}

const LS = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: "hidden",
  },
  borderTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: `rgba(255,255,255,${TabBarTokens.borderOpacity})`,
  },
});
