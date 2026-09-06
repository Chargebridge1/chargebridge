import React from "react";
import { TouchableOpacity, type ViewStyle, type StyleProp } from "react-native";
import * as Haptics from "expo-haptics";
import { Surface, type SurfaceVariant, type SurfaceElevation } from "./Surface";

export interface CardProps {
  onPress?: () => void;
  onLongPress?: () => void;
  activeOpacity?: number;
  haptic?: boolean;
  variant?: SurfaceVariant;
  elevation?: SurfaceElevation;
  glass?: boolean;
  padding?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "none";
  testID?: string;
}

export function Card({
  onPress,
  onLongPress,
  activeOpacity = 0.85,
  haptic = true,
  variant = "card",
  elevation,
  glass,
  padding,
  radius,
  style,
  children,
  accessibilityLabel,
  accessibilityRole,
  testID,
}: CardProps) {
  const surface = (
    <Surface
      variant={variant}
      elevation={elevation}
      glass={glass}
      padding={padding}
      radius={radius}
    >
      {children}
    </Surface>
  );

  if (onPress || onLongPress) {
    return (
      <TouchableOpacity
        style={style}
        onPress={() => {
          if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress?.();
        }}
        onLongPress={onLongPress}
        activeOpacity={activeOpacity}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {surface}
      </TouchableOpacity>
    );
  }

  return (
    <Surface
      variant={variant}
      elevation={elevation}
      glass={glass}
      padding={padding}
      radius={radius}
      style={style}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </Surface>
  );
}
