import React from "react";
import { Text, type TextStyle, type StyleProp } from "react-native";
import { typography, type TypographyToken } from "@/constants/typography";

export interface TypographyProps {
  variant: TypographyToken;
  color?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
  accessibilityRole?: "header" | "link" | "none" | "text";
  accessibilityLabel?: string;
  testID?: string;
}

export function Typography({
  variant,
  color,
  numberOfLines,
  style,
  children,
  accessibilityRole,
  accessibilityLabel,
  testID,
}: TypographyProps) {
  return (
    <Text
      style={[typography[variant], color != null ? { color } : undefined, style]}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </Text>
  );
}
