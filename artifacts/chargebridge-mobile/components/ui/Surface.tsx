import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import { useColors } from "@/hooks/useColors";

export type SurfaceVariant = "card" | "sheet" | "floating" | "overlay" | "banner";
export type SurfaceElevation = 0 | 1 | 2 | 3;

export interface SurfaceProps {
  variant?: SurfaceVariant;
  elevation?: SurfaceElevation;
  glass?: boolean;
  padding?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

type VariantDefaults = {
  radius: number;
  padding: number;
  borderWidth: number;
  topCornersOnly?: boolean;
  useMutedBg?: boolean;
};

const VARIANT_DEFAULTS: Record<SurfaceVariant, VariantDefaults> = {
  card:     { radius: 16, padding: 14, borderWidth: 1 },
  sheet:    { radius: 24, padding: 20, borderWidth: 1, topCornersOnly: true },
  floating: { radius: 18, padding: 14, borderWidth: 1 },
  overlay:  { radius: 24, padding: 20, borderWidth: 1 },
  banner:   { radius: 12, padding: 10, borderWidth: 0, useMutedBg: true },
};

function elevationStyle(level: SurfaceElevation): ViewStyle {
  if (level === 0) return {};
  return {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: level * 2 },
    shadowOpacity: 0.08 + level * 0.04,
    shadowRadius: level * 4,
    elevation: level * 4,
  };
}

export function Surface({
  variant = "card",
  elevation = 0,
  glass = false,
  padding: paddingProp,
  radius: radiusProp,
  style,
  children,
  accessibilityLabel,
  testID,
}: SurfaceProps) {
  const colors = useColors();
  const def = VARIANT_DEFAULTS[variant];

  const radius = radiusProp ?? def.radius;
  const padding = paddingProp ?? def.padding;

  const autoElevation: SurfaceElevation =
    variant === "floating" ? 1 : variant === "overlay" ? 2 : 0;
  const effectiveElevation = (
    Math.max(elevation, autoElevation) as SurfaceElevation
  );

  const bg = glass
    ? colors.card + "CC"
    : def.useMutedBg
      ? colors.muted
      : colors.card;

  const borderRadiusStyle: ViewStyle = def.topCornersOnly
    ? {
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }
    : { borderRadius: radius };

  return (
    <View
      style={[
        { backgroundColor: bg, padding },
        def.borderWidth > 0 && { borderWidth: def.borderWidth, borderColor: colors.border },
        borderRadiusStyle,
        effectiveElevation > 0 && elevationStyle(effectiveElevation),
        style,
      ]}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </View>
  );
}
