import React, { useRef, useCallback } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useReduceMotion } from "@/hooks/useReduceMotion";

export type ButtonVariant = "primary" | "destructive" | "secondary" | "ghost" | "loading" | "disabled" | "warning" | "info";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  label: string;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  haptic?: "light" | "medium" | "success" | "none";
};

export function Button({
  onPress,
  variant = "primary",
  size = "md",
  label,
  icon,
  iconRight,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
  haptic,
}: ButtonProps) {
  const colors = useColors();
  const prefersReducedMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const isDisabled = disabled || loading || variant === "disabled";
  const activeVariant: ButtonVariant = loading ? "loading" : variant;

  function handlePressIn() {
    if (isDisabled || prefersReducedMotion) return;
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 40,
      bounciness: 2,
    }).start();
  }

  function handlePressOut() {
    if (prefersReducedMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  }

  const handlePress = useCallback(() => {
    if (isDisabled || !onPress) return;
    const h = haptic ?? (variant === "primary" ? "medium" : "light");
    if (h === "medium") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (h === "light") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (h === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onPress();
  }, [isDisabled, onPress, haptic, variant]);

  const bg = getBg(activeVariant, colors);
  const tc = getTc(activeVariant, colors);
  const bd = getBorder(activeVariant, colors);
  const sh = getShadow(activeVariant);
  const padV = size === "sm" ? 9 : size === "lg" ? 16 : 13;
  const padH = size === "sm" ? 14 : size === "lg" ? 22 : 18;
  const fs = size === "sm" ? 13 : size === "lg" ? 16 : 14;

  return (
    <Animated.View
      style={[{ transform: [{ scale }] }, style]}
    >
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={[
          S.base,
          {
            backgroundColor: bg,
            paddingVertical: padV,
            paddingHorizontal: padH,
            ...(bd ? { borderColor: bd, borderWidth: 1.5 } : {}),
            opacity: isDisabled && !loading ? 0.35 : 1,
            ...sh,
          },
          style,
        ]}
      >
        {loading ? (
          <View style={S.row}>
            <ActivityIndicator size="small" color={tc} />
            <Text style={[S.label, { color: tc, fontSize: fs }, textStyle]}>{label}</Text>
          </View>
        ) : (
          <View style={S.row}>
            {icon && <View style={S.iconSlot}>{icon}</View>}
            <Text style={[S.label, { color: tc, fontSize: fs }, textStyle]}>{label}</Text>
            {iconRight && <View style={S.iconSlot}>{iconRight}</View>}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function getBg(v: ButtonVariant, c: ReturnType<typeof useColors>): string {
  switch (v) {
    case "primary":     return c.primary;
    case "destructive": return c.destructive;
    case "secondary":   return c.primary + "14";
    case "ghost":       return "transparent";
    case "loading":     return c.primary;
    case "disabled":    return c.primary;
    case "warning":     return c.warningBackground;
    case "info":        return c.info;
    default:            return c.primary;
  }
}

function getTc(v: ButtonVariant, c: ReturnType<typeof useColors>): string {
  switch (v) {
    case "primary":     return c.primaryForeground;
    case "destructive": return "#ffffff";
    case "secondary":   return c.primary;
    case "ghost":       return c.mutedForeground;
    case "loading":     return c.primaryForeground;
    case "disabled":    return c.primaryForeground;
    case "warning":     return c.warningForeground;
    case "info":        return "#ffffff";
    default:            return "#ffffff";
  }
}

function getBorder(v: ButtonVariant, c: ReturnType<typeof useColors>): string | undefined {
  if (v === "secondary") return c.primary + "50";
  if (v === "ghost") return c.border;
  if (v === "warning") return c.warning + "50";
  return undefined;
}

function getShadow(v: ButtonVariant): object {
  if (v === "primary" || v === "loading") {
    return {
      shadowColor: "#0D9E7E",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    };
  }
  if (v === "destructive") {
    return {
      shadowColor: "#ef4444",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    };
  }
  if (v === "info") {
    return {
      shadowColor: "#3B82F6",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    };
  }
  return {};
}

const S = StyleSheet.create({
  base: {
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  label: {
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
});
