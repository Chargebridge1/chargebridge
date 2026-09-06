import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { typography } from "@/constants/typography";
import type { MatchFactor } from "@/lib/vehicleMatch";

const TEAL = "#1bc99a";

const GRADE_COLOR: Record<string, string> = {
  A: "#1bc99a",
  B: "#3b82f6",
  C: "#f59e0b",
  D: "#ef4444",
};

const FACTOR_ICON: Record<string, string> = {
  Connector:    "flash-outline",
  Speed:        "speedometer-outline",
  "Range / SoC": "battery-half-outline",
  Availability: "layers-outline",
  Cost:         "pricetag-outline",
  Access:       "lock-open-outline",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  stationName: string;
  matchScore: number;
  matchGrade: "A" | "B" | "C" | "D";
  matchFactors: MatchFactor[];
}

function scoreBarWidth(subScore: number): number {
  return Math.min(100, Math.round(Math.min(subScore, 1.0) * 100));
}

function scoreBarColor(subScore: number): string {
  const clamped = Math.min(subScore, 1.0);
  if (clamped >= 0.75) return "#1bc99a";
  if (clamped >= 0.5)  return "#3b82f6";
  if (clamped >= 0.25) return "#f59e0b";
  return "#ef4444";
}

function weightLabel(w: number): string {
  return `${Math.round(w * 100)}%`;
}

export function MatchExplanationSheet({
  visible,
  onClose,
  stationName,
  matchScore,
  matchGrade,
  matchFactors,
}: Props) {
  const colors = useColors();
  const gradeColor = GRADE_COLOR[matchGrade] ?? TEAL;

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.gradeCircle, { backgroundColor: gradeColor }]}>
              <Text style={styles.gradeText}>{matchGrade}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.stationName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {stationName}
              </Text>
              <Text style={[styles.scoreLabel, { color: gradeColor }]}>
                {matchScore}/100 match score
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close explanation"
          >
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* ── Intro ──────────────────────────────────────────────────────── */}
        <View style={[styles.introBanner, { backgroundColor: gradeColor + "12", borderColor: gradeColor + "30" }]}>
          <Ionicons name="information-circle-outline" size={15} color={gradeColor} />
          <Text style={[styles.introText, { color: colors.foreground }]}>
            Scores are calculated from 6 factors. Each factor is weighted by how
            much it matters for a real charging stop.
          </Text>
        </View>

        {/* ── Factor rows ────────────────────────────────────────────────── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {matchFactors.map((factor) => {
            const barWidth = scoreBarWidth(factor.subScore);
            const barColor = scoreBarColor(factor.subScore);
            const icon = FACTOR_ICON[factor.label] ?? "ellipse-outline";
            const contribution = Math.round(
              Math.min(factor.subScore, 1.0) * factor.weight * 100
            );

            return (
              <View
                key={factor.label}
                style={[styles.factorCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {/* Row: icon + label + weight tag */}
                <View style={styles.factorHeader}>
                  <View style={[styles.factorIconWrap, { backgroundColor: barColor + "18" }]}>
                    <Ionicons name={icon as any} size={16} color={barColor} />
                  </View>
                  <Text style={[styles.factorLabel, { color: colors.foreground }]}>
                    {factor.label}
                  </Text>
                  <View style={[styles.weightTag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.weightTagText, { color: colors.mutedForeground }]}>
                      {weightLabel(factor.weight)}
                    </Text>
                  </View>
                </View>

                {/* Score bar */}
                <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${barWidth}%` as any, backgroundColor: barColor },
                    ]}
                  />
                </View>

                {/* Reason + contribution */}
                <View style={styles.factorFooter}>
                  <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
                    {factor.reason ?? "No data · neutral score"}
                  </Text>
                  <Text style={[styles.contributionText, { color: barColor }]}>
                    +{contribution} pts
                  </Text>
                </View>
              </View>
            );
          })}

          {/* ── Algorithm note ───────────────────────────────────────────── */}
          <View style={[styles.algorithmNote, { borderColor: colors.border }]}>
            <Text style={[styles.algorithmNoteTitle, { color: colors.foreground }]}>
              How scores work
            </Text>
            <View style={styles.algorithmRows}>
              {[
                ["Connector", "30%", "Plug compatibility + adapter support"],
                ["Speed",     "20%", "Effective kW vs your vehicle's max rate"],
                ["Range / SoC","20%","Estimated battery % when you arrive"],
                ["Availability","15%","Open ports ratio and real-time status"],
                ["Cost",      "10%", "Price per kWh relative to $0.30 baseline"],
                ["Access",    " 5%", "Public > unknown > restricted"],
              ].map(([factor, weight, desc]) => (
                <View key={factor} style={styles.algorithmRow}>
                  <Text style={[styles.algorithmFactor, { color: colors.foreground }]}>{factor}</Text>
                  <Text style={[styles.algorithmWeight, { color: TEAL }]}>{weight}</Text>
                  <Text style={[styles.algorithmDesc, { color: colors.mutedForeground }]}>{desc}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.algorithmFooter, { color: colors.mutedForeground }]}>
              Grades: A ≥ 80 · B ≥ 60 · C ≥ 40 · D &lt; 40.{" "}
              Scores improve as you charge — the app learns which connectors you
              use most.
            </Text>
          </View>
        </ScrollView>

        {/* ── Close button ───────────────────────────────────────────────── */}
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: TEAL, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.closeBtnText}>Got it</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  gradeCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  gradeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#fff",
  },
  stationName: {
    ...typography.callout,
    fontFamily: "Inter_700Bold",
  },
  scoreLabel: {
    ...typography.caption,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  introBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  introText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 17,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 8,
  },
  factorCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  factorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  factorIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  factorLabel: {
    ...typography.callout,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  weightTag: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  weightTagText: {
    ...typography.caption,
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  factorFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reasonText: {
    ...typography.caption,
    flex: 1,
  },
  contributionText: {
    ...typography.caption,
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    flexShrink: 0,
    marginLeft: 8,
  },
  algorithmNote: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 6,
    gap: 10,
  },
  algorithmNoteTitle: {
    ...typography.callout,
    fontFamily: "Inter_700Bold",
  },
  algorithmRows: {
    gap: 6,
  },
  algorithmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  algorithmFactor: {
    ...typography.caption,
    fontFamily: "Inter_600SemiBold",
    width: 80,
    flexShrink: 0,
  },
  algorithmWeight: {
    ...typography.caption,
    fontFamily: "Inter_700Bold",
    width: 30,
    flexShrink: 0,
  },
  algorithmDesc: {
    ...typography.caption,
    flex: 1,
    lineHeight: 16,
  },
  algorithmFooter: {
    ...typography.caption,
    lineHeight: 17,
    fontStyle: "italic",
  },
  closeBtn: {
    marginHorizontal: 16,
    marginBottom: 32,
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeBtnText: {
    ...typography.callout,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    fontSize: 16,
  },
});
