import React from "react";
import { View, TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Typography } from "./Typography";

export interface SectionHeaderProps {
  icon?: React.ReactNode;
  label: string;
  action?: {
    label: string;
    onPress: () => void;
  };
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ icon, label, action, style }: SectionHeaderProps) {
  const colors = useColors();

  return (
    <View style={[S.row, style]}>
      {icon && <View style={S.icon}>{icon}</View>}
      <Typography
        variant="label"
        color={colors.mutedForeground}
        style={S.labelStyle}
      >
        {label}
      </Typography>
      {action && (
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            action.onPress();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Typography
            variant="caption"
            color={colors.primary}
            style={S.actionStyle}
          >
            {action.label}
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  labelStyle: {
    flex: 1,
  },
  actionStyle: {
    fontWeight: "600",
  },
});
