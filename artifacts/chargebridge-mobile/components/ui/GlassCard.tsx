import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { Glass } from "@/constants/motion";

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rounds only the top-left and top-right corners — for sliding panel effect */
  topRounded?: boolean;
  /** Blur intensity override (defaults to motion spec Glass.blurIntensity) */
  intensity?: number;
  /** Extra horizontal padding */
  padding?: number;
}

/**
 * Frosted glass surface card — Phase 1 Ambient dark foundation.
 * On iOS: uses expo-blur BlurView for native glass effect.
 * On Android: falls back to rgba dark surface with subtle border.
 */
export function GlassCard({
  children,
  style,
  topRounded = false,
  intensity = Glass.blurIntensity,
  padding,
}: GlassCardProps) {
  const borderRadius = topRounded
    ? { borderTopLeftRadius: 32, borderTopRightRadius: 32, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
    : { borderRadius: 20 };

  const inner = (
    <View
      style={[
        S.inner,
        borderRadius,
        padding !== undefined ? { padding } : undefined,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (Platform.OS === "ios") {
    return (
      <BlurView
        intensity={intensity}
        tint="dark"
        style={[S.blur, borderRadius, style ? {} : undefined]}
      >
        {inner}
      </BlurView>
    );
  }

  return (
    <View style={[S.androidFallback, borderRadius, style]}>
      {inner}
    </View>
  );
}

const S = StyleSheet.create({
  blur: {
    overflow: "hidden",
  },
  inner: {
    backgroundColor: `rgba(255,255,255,${Glass.backgroundOpacity})`,
    borderWidth: 1,
    borderColor: `rgba(255,255,255,${Glass.borderOpacity})`,
    overflow: "hidden",
  },
  androidFallback: {
    backgroundColor: "rgba(10, 22, 40, 0.92)",
    borderWidth: 1,
    borderColor: `rgba(255,255,255,${Glass.borderOpacity})`,
    overflow: "hidden",
  },
});
