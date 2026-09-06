import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { usePrimaryVehicle } from "@/hooks/usePrimaryVehicle";
import { Typography, Surface } from "@/components/ui";

const BEST_FOR_ME_KEY = "@chargebridge/activate_best_for_me";

type Urgency = "high" | "medium" | "low" | "good" | "info";

interface Rec {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  cta?: string;
  urgency: Urgency;
  onCta?: () => void;
}

function getRecommendation(args: {
  battery: number | null;
  hasVehicle: boolean;
  onSetBattery: () => void;
}): Rec {
  const hour = new Date().getHours();

  if (!args.hasVehicle) {
    return {
      icon: "car-outline",
      text: "Add your vehicle to get personalised charging recommendations and range estimates.",
      cta: "Set Up Vehicle",
      urgency: "info",
      onCta: () => router.push("/edit-profile" as any),
    };
  }

  if (args.battery === null) {
    return {
      icon: "battery-half-outline",
      text: "Update your battery level to see remaining range and smart recommendations.",
      cta: "Update Battery",
      urgency: "info",
      onCta: args.onSetBattery,
    };
  }

  if (args.battery <= 15) {
    return {
      icon: "warning-outline",
      text: "Battery is critically low. Find a charger nearby before your next trip.",
      cta: "Find Charger",
      urgency: "high",
      onCta: () => router.navigate("/(tabs)/map"),
    };
  }

  if (args.battery <= 30) {
    return {
      icon: "flash-outline",
      text: "Battery is below 30%. Find the best nearby charger matched to your vehicle.",
      cta: "Best Charger for Me",
      urgency: "medium",
      onCta: async () => {
        await AsyncStorage.setItem(BEST_FOR_ME_KEY, "1");
        router.navigate("/(tabs)/map");
      },
    };
  }

  if (hour >= 22 || hour < 6) {
    return {
      icon: "moon-outline",
      text: "Off-peak hours — great time to charge overnight at lower rates.",
      cta: "Best Charger for Me",
      urgency: "low",
      onCta: async () => {
        await AsyncStorage.setItem(BEST_FOR_ME_KEY, "1");
        router.navigate("/(tabs)/map");
      },
    };
  }

  if (args.battery >= 80) {
    return {
      icon: "checkmark-circle-outline",
      text: "Battery is well-charged. You're ready for today's driving.",
      urgency: "good",
    };
  }

  return {
    icon: "flash-outline",
    text: "Find the best nearby charger matched to your vehicle's connector and range.",
    cta: "Best Charger for Me",
    urgency: "info",
    onCta: async () => {
      await AsyncStorage.setItem(BEST_FOR_ME_KEY, "1");
      router.navigate("/(tabs)/map");
    },
  };
}

type UrgencyPalette = { bg: string; icon: string; border: string };

function getUrgencyPalette(
  urgency: Urgency,
  c: ReturnType<typeof useColors>,
): UrgencyPalette {
  switch (urgency) {
    case "high":   return { bg: c.errorBackground,   icon: c.error,   border: c.error   + "40" };
    case "medium": return { bg: c.warningBackground, icon: c.warning, border: c.warning + "40" };
    case "low":    return { bg: c.infoBackground,    icon: c.info,    border: c.info    + "40" };
    case "good":   return { bg: c.successBackground, icon: c.success, border: c.success + "40" };
    case "info":
    default:       return { bg: c.primary + "20",    icon: c.primary, border: c.primary + "40" };
  }
}

interface Props {
  batteryPercent: number | null;
  onSetBattery: () => void;
}

export function SmartRecommendationCard({ batteryPercent, onSetBattery }: Props) {
  const colors = useColors();
  const vehicle = usePrimaryVehicle();

  const rec = getRecommendation({
    battery: batteryPercent,
    hasVehicle: vehicle != null,
    onSetBattery,
  });

  const palette = getUrgencyPalette(rec.urgency, colors);

  return (
    <Surface
      variant="card"
      style={[
        S.cardMargin,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={S.inner}>
        <View style={[S.iconWrap, { backgroundColor: palette.icon + "22" }]}>
          <Ionicons name={rec.icon} size={20} color={palette.icon} />
        </View>
        <View style={S.body}>
          <Typography variant="body" color={colors.foreground}>{rec.text}</Typography>
          {rec.cta && rec.onCta && (
            <TouchableOpacity onPress={rec.onCta} style={S.ctaRow}>
              <Typography variant="callout" color={palette.icon} style={{ fontWeight: "700" }}>
                {rec.cta}
              </Typography>
              <Ionicons name="arrow-forward" size={13} color={palette.icon} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Surface>
  );
}

const S = StyleSheet.create({
  cardMargin: { marginHorizontal: 16, marginBottom: 12 },
  inner: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  body: { flex: 1, gap: 6 },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
});
