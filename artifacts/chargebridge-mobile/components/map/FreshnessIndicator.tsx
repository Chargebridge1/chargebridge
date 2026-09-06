import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { typography } from "@/constants/typography";

export type FreshnessLevel = "live" | "recent" | "stale" | "offline";

export function freshnessLevel(
  lastRefreshed: Date | null,
  isOffline = false,
): FreshnessLevel {
  if (isOffline) return "offline";
  if (!lastRefreshed) return "stale";
  const ageMins = (Date.now() - lastRefreshed.getTime()) / 60000;
  if (ageMins < 1) return "live";
  if (ageMins < 5) return "recent";
  return "stale";
}

export const FRESHNESS_COLOR: Record<FreshnessLevel, string> = {
  live: "#22c55e",
  recent: "#f59e0b",
  stale: "#f97316",
  offline: "#94a3b8",
};

function formatAge(lastRefreshed: Date | null): string {
  if (!lastRefreshed) return "No data yet";
  const ageSecs = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
  if (ageSecs < 30) return "Updated just now";
  if (ageSecs < 60) return `Updated ${ageSecs}s ago`;
  const ageMins = Math.floor(ageSecs / 60);
  if (ageMins < 60) return `Updated ${ageMins} min ago`;
  const ageHrs = Math.floor(ageMins / 60);
  return `Updated ${ageHrs}h ago`;
}

type Props = {
  lastRefreshed: Date | null;
  isRefreshing?: boolean;
  isOffline?: boolean;
  onRefresh?: () => void;
  showTimestamp?: boolean;
};

export function FreshnessIndicator({
  lastRefreshed,
  isRefreshing = false,
  isOffline = false,
  onRefresh,
  showTimestamp = true,
}: Props) {
  const level = freshnessLevel(lastRefreshed, isOffline);
  const color = FRESHNESS_COLOR[level];

  return (
    <View style={styles.row}>
      {isRefreshing ? (
        <ActivityIndicator size={10} color={color} style={styles.spinner} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      {showTimestamp && (
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {isRefreshing ? "Refreshing…" : formatAge(lastRefreshed)}
        </Text>
      )}
      {onRefresh && !isRefreshing && (
        <TouchableOpacity
          onPress={onRefresh}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.refreshBtn}
        >
          <Feather name="refresh-cw" size={11} color={color} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  spinner: {
    width: 10,
    height: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    ...typography.caption,
    fontFamily: "Inter_500Medium",
  },
  refreshBtn: {
    marginLeft: 1,
  },
});
