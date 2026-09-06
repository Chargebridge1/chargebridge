import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Badge } from "@/components/ui/Badge";
import { typography } from "@/constants/typography";

import type { MatchFactor } from "@/lib/vehicleMatch";

export type StationRowItem = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  status: "available" | "busy" | "offline" | "unknown";
  chargerType: "Level1" | "Level2" | "DCFC";
  powerKw: number | null;
  pricePerKwh: number | null;
  priceText: string | null;
  isFree: boolean;
  availablePorts: number | null;
  totalPorts: number | null;
  distanceMiles: number;
  network: string | null;
  matchScore?: number;
  matchGrade?: "A" | "B" | "C" | "D";
  matchReasons?: string[];
  matchFactors?: MatchFactor[];
  connectorCompatible?: boolean;
};

const GRADE_COLOR: Record<string, string> = {
  A: "#1bc99a",
  B: "#3b82f6",
  C: "#f59e0b",
  D: "#ef4444",
};

const STATUS_COLOR: Record<string, string> = {
  available: "#22c55e",
  busy: "#f59e0b",
  offline: "#ef4444",
  unknown: "#94a3b8",
};

function priceLabel(s: StationRowItem): string {
  if (s.isFree) return "Free";
  if (s.priceText) return s.priceText;
  if (s.pricePerKwh) return `$${Number(s.pricePerKwh).toFixed(2)}/kWh`;
  return "";
}

type Props = {
  station: StationRowItem;
  onPress: (station: StationRowItem) => void;
  onWhyPress?: (station: StationRowItem) => void;
  isSelected?: boolean;
};

export function StationListRow({ station, onPress, onWhyPress, isSelected = false }: Props) {
  const colors = useColors();
  const dot = STATUS_COLOR[station.status] ?? "#94a3b8";
  const price = priceLabel(station);
  const typeVariant =
    station.chargerType === "DCFC"
      ? "primary"
      : station.chargerType === "Level2"
        ? "info"
        : "muted";
  const typeLabel =
    station.chargerType === "DCFC"
      ? "DC Fast"
      : station.chargerType === "Level2"
        ? "Level 2"
        : "Level 1";

  const incompatible = station.connectorCompatible === false;

  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress(station);
      }}
      activeOpacity={0.75}
      style={[
        styles.row,
        {
          backgroundColor: isSelected
            ? colors.primary + "14"
            : colors.background,
          borderColor: isSelected ? colors.primary + "40" : colors.border,
          opacity: incompatible ? 0.45 : 1,
        },
      ]}
    >
      {/* Left icon with status dot */}
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor:
              station.chargerType === "DCFC"
                ? "#0D9E7E18"
                : station.chargerType === "Level2"
                  ? "#3b82f618"
                  : "#94a3b818",
          },
        ]}
      >
        <Ionicons
          name="flash"
          size={18}
          color={
            station.chargerType === "DCFC"
              ? "#0D9E7E"
              : station.chargerType === "Level2"
                ? "#3b82f6"
                : "#94a3b8"
          }
        />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[typography.callout, styles.name, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {station.name}
        </Text>
        <Text
          style={[typography.caption, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {[station.address, station.city].filter(Boolean).join(", ") ||
            "EV Station"}
        </Text>
        <View style={styles.metaRow}>
          <Badge variant={typeVariant} label={typeLabel} size="sm" />
          {station.availablePorts != null && station.totalPorts != null && (
            <Text
              style={[
                typography.caption,
                {
                  color: station.availablePorts > 0
                    ? "#22c55e"
                    : colors.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {station.availablePorts}/{station.totalPorts} ports
            </Text>
          )}
          {price ? (
            <Text
              style={[
                typography.caption,
                {
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {price}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Right: match grade (if present) + distance + chevron */}
      <View style={styles.right}>
        {station.matchGrade != null && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              if (onWhyPress && station.matchFactors?.length) {
                Haptics.selectionAsync();
                onWhyPress(station);
              }
            }}
            activeOpacity={onWhyPress && station.matchFactors?.length ? 0.7 : 1}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Why grade ${station.matchGrade}? Tap for score breakdown`}
          >
            <View
              style={[
                styles.gradeBadge,
                { backgroundColor: GRADE_COLOR[station.matchGrade] },
              ]}
            >
              <Text style={styles.gradeText}>{station.matchGrade}</Text>
              {onWhyPress && station.matchFactors?.length ? (
                <Text style={styles.whyText}>?</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
        <Text
          style={[
            typography.caption,
            { color: "#0D9E7E", fontFamily: "Inter_700Bold" },
          ]}
        >
          {station.distanceMiles < 0.1
            ? "< 0.1 mi"
            : station.distanceMiles < 10
              ? `${station.distanceMiles.toFixed(1)} mi`
              : `${Math.round(station.distanceMiles)} mi`}
        </Text>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  content: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: "Inter_600SemiBold",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    marginTop: 2,
  },
  right: {
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  },
  gradeBadge: {
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 1,
  },
  gradeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  whyText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 11,
    marginTop: 1,
  },
});
