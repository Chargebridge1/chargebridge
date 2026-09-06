import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Typography } from "@/components/ui";

interface Action {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}

interface Props {
  actions: Action[];
}

export function QuickActionsRow({ actions }: Props) {
  const colors = useColors();

  return (
    <View style={S.wrap}>
      <Typography variant="label" color={colors.mutedForeground} style={{ marginBottom: 10 }}>
        Quick Actions
      </Typography>
      <View style={S.row}>
        {actions.slice(0, 4).map((a, i) => (
          <TouchableOpacity
            key={i}
            style={[S.btn, { backgroundColor: a.color + "22", borderColor: a.color + "44" }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); a.onPress(); }}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <View style={[S.iconWrap, { backgroundColor: a.color + "33" }]}>
              <Ionicons name={a.icon} size={22} color={a.color} />
            </View>
            <Typography variant="label" color={colors.foreground} numberOfLines={1} style={{ textTransform: "none", letterSpacing: 0 }}>
              {a.label}
            </Typography>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 12 },
  row: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    paddingVertical: 14, alignItems: "center", gap: 8,
  },
  iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
