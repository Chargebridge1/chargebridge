import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { Typography, Skeleton, EmptyState, Card, SectionHeader, ListRow } from "@/components/ui";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(mins: number | null | undefined): string | null {
  if (mins == null) return null;
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function RecentActivityCard() {
  const colors = useColors();
  const { data: activity, isLoading } = useRecentActivity();

  const goHistory = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/(tabs)/history" as any);
  };

  return (
    <Card
      onPress={goHistory}
      style={S.cardMargin}
      accessibilityLabel="Recent activity — tap to view full history"
    >
      <SectionHeader
        icon={<Ionicons name="time-outline" size={16} color={colors.primary} />}
        label="Recent Activity"
        action={{ label: "See All →", onPress: goHistory }}
      />

      {isLoading ? (
        <Skeleton height={50} radius={10} />
      ) : activity ? (
        <ListRow
          icon={<Ionicons name="flash" size={20} color={colors.primary} />}
          iconBackground={colors.primary + "20"}
          title={activity.stationName}
          subtitle={`${formatDate(activity.chargedAt)}${formatDuration(activity.durationMinutes) ? ` · ${formatDuration(activity.durationMinutes)}` : ""}`}
          right={
            <View style={S.amounts}>
              {activity.amountCents != null && (
                <Typography variant="body" color={colors.foreground} style={{ fontWeight: "800" }}>
                  ${(activity.amountCents / 100).toFixed(2)}
                </Typography>
              )}
              {activity.kwh != null && (
                <Typography variant="caption" color={colors.mutedForeground}>
                  {activity.kwh.toFixed(1)} kWh
                </Typography>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </View>
          }
        />
      ) : (
        <EmptyState
          compact
          icon={<Ionicons name="flash-outline" size={22} color={colors.mutedForeground} />}
          iconColor={colors.mutedForeground}
          title="No charging sessions yet"
          body="Your first session will appear here"
          action={{ label: "Find a Charger", onPress: () => router.navigate("/(tabs)"), variant: "ghost" }}
        />
      )}
    </Card>
  );
}

const S = StyleSheet.create({
  cardMargin: { marginHorizontal: 16, marginBottom: 12 },
  amounts: { alignItems: "flex-end", gap: 2, flexDirection: "row", alignContent: "center" },
});
