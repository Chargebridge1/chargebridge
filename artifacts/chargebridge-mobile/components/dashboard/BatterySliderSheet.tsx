import React, { useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  current: number | null;
  onSet: (pct: number) => void;
  onClose: () => void;
}

const PRESETS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function BatterySliderSheet({ visible, current, onSet, onClose }: Props) {
  const colors = useColors();
  const [selected, setSelected] = useState<number | null>(current);

  const handleSelect = (pct: number) => {
    Haptics.selectionAsync();
    setSelected(pct);
  };

  const handleConfirm = () => {
    if (selected != null) {
      onSet(selected);
    }
    onClose();
  };

  const tintFor = (pct: number) =>
    pct <= 20 ? "#ef4444" : pct <= 40 ? "#f59e0b" : colors.primary;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose} />
      <View style={[S.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={S.handle} />
        <View style={S.header}>
          <Ionicons name="battery-half-outline" size={22} color={colors.primary} />
          <Text style={[S.title, { color: colors.foreground }]}>Update Battery Level</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <Text style={[S.sub, { color: colors.mutedForeground }]}>
          Select your current charge — used to estimate remaining range
        </Text>

        <View style={S.grid}>
          {PRESETS.map((pct) => {
            const active = selected === pct;
            const tint = tintFor(pct);
            return (
              <TouchableOpacity
                key={pct}
                style={[
                  S.preset,
                  { backgroundColor: active ? tint : colors.muted, borderColor: active ? tint : "transparent" },
                ]}
                onPress={() => handleSelect(pct)}
                activeOpacity={0.75}
              >
                <Text style={[S.presetTxt, { color: active ? "#fff" : colors.mutedForeground }]}>
                  {pct}%
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[S.confirm, { backgroundColor: colors.primary, opacity: selected != null ? 1 : 0.4 }]}
          onPress={handleConfirm}
          disabled={selected == null}
        >
          <Text style={S.confirmTxt}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, padding: 20, paddingBottom: 36,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  preset: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, minWidth: 62, alignItems: "center",
  },
  presetTxt: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  confirm: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  confirmTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
