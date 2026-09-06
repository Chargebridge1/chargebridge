import React from "react";
import { View, TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Typography } from "./Typography";

export interface ListRowProps {
  icon: React.ReactNode;
  iconBackground?: string;
  iconSize?: number;
  titleLeft?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function ListRow({
  icon,
  iconBackground,
  iconSize = 42,
  titleLeft,
  title,
  subtitle,
  right,
  onPress,
  style,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const colors = useColors();
  const iconBg = iconBackground ?? colors.primary + "20";
  const iconRadius = Math.round(iconSize * 0.31);

  const inner = (
    <View style={[S.row, style]}>
      <View
        style={[
          S.iconWrap,
          { width: iconSize, height: iconSize, borderRadius: iconRadius, backgroundColor: iconBg },
        ]}
      >
        {icon}
      </View>

      <View style={S.info}>
        {titleLeft ? (
          <View style={S.titleRow}>
            {titleLeft}
            <Typography
              variant="callout"
              color={colors.foreground}
              numberOfLines={1}
              style={[S.title, { flex: 1 }]}
            >
              {title}
            </Typography>
          </View>
        ) : (
          <Typography
            variant="callout"
            color={colors.foreground}
            numberOfLines={1}
            style={S.title}
          >
            {title}
          </Typography>
        )}
        {subtitle ? (
          <Typography
            variant="caption"
            color={colors.mutedForeground}
            numberOfLines={1}
          >
            {subtitle}
          </Typography>
        ) : null}
      </View>

      {right ? <View style={S.right}>{right}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        testID={testID}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return inner;
}

const S = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontWeight: "700",
  },
  right: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
