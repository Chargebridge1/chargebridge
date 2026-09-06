import React from "react";
import { Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SymbolView } from "expo-symbols";

import { NAV_PILLS, PillId } from "@/constants/navPills";

// ─────────────────────────────────────────────────────────────────────────────
// NavPillIcon — platform-correct icon for a navigation pill.
//
// Encapsulates the iOS (SF Symbol via SymbolView) / Android (Feather) split
// so callers only pass id, tintColor, and size. Used by both the normal tab
// bar (CustomTabBar → TabPillIcon) and the wiggle edit bar (WigglePill).
// ─────────────────────────────────────────────────────────────────────────────

interface NavPillIconProps {
  id:        PillId;
  tintColor: string;
  size:      number;
}

export function NavPillIcon({ id, tintColor, size }: NavPillIconProps) {
  const pill = NAV_PILLS[id];
  return Platform.OS === "ios" ? (
    <SymbolView name={pill.sfSymbol as never} tintColor={tintColor} size={size} />
  ) : (
    <Feather name={pill.featherIcon as never} size={size} color={tintColor} />
  );
}
