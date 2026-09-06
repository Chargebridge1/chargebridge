import React from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

export type BadgeVariant = "primary" | "success" | "warning" | "error" | "info" | "muted";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: "auto" | "yes" | "no" | "no-hide-descendants";
}

export function Badge({
  label,
  variant = "muted",
  size = "sm",
  dot = false,
  icon,
  style,
  accessibilityLabel,
  accessibilityElementsHidden,
  importantForAccessibility,
}: BadgeProps) {
  const colors = useColors();
  const { bg, fg } = getBadgeColors(variant, colors);
  const padV = size === "md" ? 5 : 3;
  const padH = size === "md" ? 10 : 7;
  const fontSize = size === "md" ? 12 : 11;

  return (
    <View
      style={[
        S.base,
        { backgroundColor: bg, paddingVertical: padV, paddingHorizontal: padH },
        style,
      ]}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
    >
      {dot && (
        <View
          style={[S.dot, { backgroundColor: fg }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      {!dot && icon != null && <View style={S.iconSlot}>{icon}</View>}
      <Text style={[S.label, { color: fg, fontSize }]}>{label}</Text>
    </View>
  );
}

function getBadgeColors(
  variant: BadgeVariant,
  c: ReturnType<typeof useColors>,
): { bg: string; fg: string } {
  switch (variant) {
    case "primary":
      return { bg: c.primary + "1A", fg: c.primary };
    case "success":
      return { bg: c.successBackground, fg: c.successForeground };
    case "warning":
      return { bg: c.warningBackground, fg: c.warningForeground };
    case "error":
      return { bg: c.errorBackground, fg: c.errorForeground };
    case "info":
      return { bg: c.infoBackground, fg: c.infoForeground };
    case "muted":
    default:
      return { bg: c.muted, fg: c.mutedForeground };
  }
}

const S = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    lineHeight: 14,
  },
});
