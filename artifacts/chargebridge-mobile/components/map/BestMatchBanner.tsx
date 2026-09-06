import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { typography } from "@/constants/typography";
import type { MatchFactor } from "@/lib/vehicleMatch";

const TEAL = "#1bc99a";

type MatchGrade = "A" | "B" | "C" | "D";

const GRADE_COLOR: Record<MatchGrade, string> = {
  A: "#1bc99a",
  B: "#3b82f6",
  C: "#f59e0b",
  D: "#ef4444",
};

interface Props {
  stationName: string;
  matchGrade: MatchGrade;
  matchScore: number;
  matchReasons: string[];
  matchFactors?: MatchFactor[];
  vehicleName: string;
  onPress: () => void;
  onWhyPress?: () => void;
}

export function BestMatchBanner({
  stationName,
  matchGrade,
  matchScore,
  matchReasons,
  matchFactors,
  vehicleName,
  onPress,
  onWhyPress,
}: Props) {
  const colors = useColors();
  const gradeColor = GRADE_COLOR[matchGrade];
  const hasFactors = matchFactors && matchFactors.length > 0;

  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.85}
      style={[
        styles.container,
        { backgroundColor: TEAL + "12", borderColor: TEAL + "40" },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.gradeBadge, { backgroundColor: gradeColor }]}>
          <Text style={styles.gradeText}>{matchGrade}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.label, { color: TEAL }]}>Best for {vehicleName}</Text>
          <Text
            style={[styles.stationName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {stationName}
          </Text>
        </View>
        <View style={styles.scoreWrap}>
          <Text style={[styles.scoreNum, { color: gradeColor }]}>{matchScore}</Text>
          <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>/100</Text>
        </View>
      </View>

      {matchReasons.length > 0 && (
        <View style={styles.reasons}>
          {matchReasons.map((r, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle" size={11} color={TEAL} />
              <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <Text style={[styles.cta, { color: TEAL }]}>Tap to view station</Text>
        <Ionicons name="arrow-forward" size={13} color={TEAL} />
        {hasFactors && onWhyPress && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              Haptics.selectionAsync();
              onWhyPress();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.whyBtn, { borderColor: TEAL + "60", backgroundColor: TEAL + "18" }]}
            accessibilityRole="button"
            accessibilityLabel="Why this score? Tap for breakdown"
          >
            <Text style={[styles.whyBtnText, { color: TEAL }]}>Why?</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  gradeBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  gradeText: {
    ...typography.callout,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    fontSize: 16,
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  label: {
    ...typography.caption,
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  stationName: {
    ...typography.callout,
    fontFamily: "Inter_600SemiBold",
  },
  scoreWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 1,
    flexShrink: 0,
  },
  scoreNum: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  scoreLabel: {
    ...typography.caption,
    fontSize: 11,
  },
  reasons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 1,
  },
  chipText: {
    ...typography.caption,
    fontSize: 11,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cta: {
    ...typography.caption,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  whyBtn: {
    marginLeft: "auto",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  whyBtnText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
