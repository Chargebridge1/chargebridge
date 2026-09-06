import React from "react";
import {
  Alert,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { typography } from "@/constants/typography";
import { Button } from "@/components/ui/Button";

const TEAL = "#1bc99a";

type FilterId = "all" | "available" | "DCFC" | "Level2" | "Level1";

type Pill = {
  id: FilterId;
  label: string;
};

const PILLS: Pill[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "DCFC", label: "DC Fast" },
  { id: "Level2", label: "Level 2" },
  { id: "Level1", label: "Level 1" },
];

type Props = {
  activeTypes: string[];
  showAvailableOnly: boolean;
  bestForMeActive: boolean;
  showBestOnly: boolean;
  hasPrimaryVehicle: boolean;
  onToggleType: (type: string) => void;
  onToggleAvailable: () => void;
  onToggleBestForMe: () => void;
  onToggleBestOnly: () => void;
  onClearAll: () => void;
};

export function MapFilterPills({
  activeTypes,
  showAvailableOnly,
  bestForMeActive,
  showBestOnly,
  hasPrimaryVehicle,
  onToggleType,
  onToggleAvailable,
  onToggleBestForMe,
  onToggleBestOnly,
  onClearAll,
}: Props) {
  const colors = useColors();
  const activeCount = activeTypes.length + (showAvailableOnly ? 1 : 0) + (showBestOnly ? 1 : 0);
  const allActive = activeTypes.length === 0 && !showAvailableOnly && !bestForMeActive && !showBestOnly;

  function isActive(id: FilterId): boolean {
    if (id === "all") return allActive;
    if (id === "available") return showAvailableOnly;
    return activeTypes.includes(id);
  }

  function handlePress(id: FilterId) {
    Haptics.selectionAsync();
    if (id === "all") {
      onClearAll();
    } else if (id === "available") {
      onToggleAvailable();
    } else {
      onToggleType(id);
    }
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {/*
        "Best for Me" pill — always visible for discoverability.
        When no primary vehicle is set it renders disabled (opacity 0.4) and
        tapping prompts the user to add a vehicle instead of toggling the filter.
      */}
      <TouchableOpacity
        onPress={() => {
          Haptics.selectionAsync();
          if (!hasPrimaryVehicle) {
            Alert.alert(
              "No vehicle saved",
              "Add your EV in the Vehicles tab to unlock Best for Me recommendations.",
              [{ text: "OK" }],
            );
            return;
          }
          onToggleBestForMe();
        }}
        activeOpacity={hasPrimaryVehicle ? 0.75 : 1}
        accessibilityRole="button"
        accessibilityState={{ selected: bestForMeActive, disabled: !hasPrimaryVehicle }}
        accessibilityLabel={
          hasPrimaryVehicle ? "Best for My Vehicle" : "Best for Me — add a vehicle to unlock"
        }
        style={[
          styles.pill,
          styles.bestPill,
          {
            backgroundColor: bestForMeActive ? TEAL : colors.card,
            borderColor: bestForMeActive ? TEAL : TEAL + "60",
            opacity: hasPrimaryVehicle ? 1 : 0.4,
          },
        ]}
      >
        <Ionicons
          name="flash"
          size={12}
          color={bestForMeActive ? "#fff" : TEAL}
          style={{ marginRight: 4 }}
        />
        <Text
          style={[
            styles.pillText,
            { color: bestForMeActive ? "#fff" : TEAL, fontFamily: "Inter_600SemiBold" },
          ]}
        >
          Best for Me
        </Text>
      </TouchableOpacity>

      {/* "★ Best" grade filter — only visible when Best for Me is active */}
      {bestForMeActive && (
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            onToggleBestOnly();
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityState={{ selected: showBestOnly }}
          accessibilityLabel="Show A and B grade stations only"
          style={[
            styles.pill,
            styles.bestPill,
            {
              backgroundColor: showBestOnly ? "#f59e0b" : colors.card,
              borderColor: showBestOnly ? "#f59e0b" : "#f59e0b60",
            },
          ]}
        >
          <Text
            style={[
              styles.pillText,
              { color: showBestOnly ? "#fff" : "#f59e0b", fontFamily: "Inter_600SemiBold" },
            ]}
          >
            ★ Best
          </Text>
        </TouchableOpacity>
      )}

      {/*
        Filter toggles use TouchableOpacity — these are chip/toggle controls (stateful,
        multi-select) rather than one-time action buttons. Button is designed for discrete
        actions with a single label; forcing it into a pill-toggle role would misrepresent
        the semantic, require deep style overrides to achieve the pill shape, and conflict
        with Button's fixed minHeight and single-selection model.
      */}
      {PILLS.map((pill) => {
        const active = isActive(pill.id);
        return (
          <TouchableOpacity
            key={pill.id}
            onPress={() => handlePress(pill.id)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={pill.label}
            style={[
              styles.pill,
              {
                backgroundColor: active ? TEAL : colors.card,
                borderColor: active ? TEAL : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                { color: active ? "#fff" : colors.mutedForeground },
              ]}
            >
              {pill.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {/* "Clear" IS a one-time action — Button is semantically correct here */}
      {(activeCount > 0 || bestForMeActive) && (
        <Button
          variant="ghost"
          size="sm"
          label={`Clear ${activeCount + (bestForMeActive ? 1 : 0)}`}
          onPress={() => {
            Haptics.selectionAsync();
            onClearAll();
          }}
          haptic="none"
          style={{
            borderRadius: 100,
            paddingVertical: 6,
            paddingHorizontal: 12,
            minHeight: 0,
            backgroundColor: "#f9731612",
            borderColor: "#f9731640",
            borderWidth: 1,
          }}
          textStyle={{ color: "#f97316", fontSize: 13 }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
  },
  bestPill: {
    borderWidth: 1.5,
  },
  pillText: {
    ...typography.labelPlain,
    fontSize: 13,
  },
});
