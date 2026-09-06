import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useNearbyStation } from "@/hooks/useNearbyStation";
import { useUnits } from "@/hooks/useUnits";
import { Typography, Skeleton, Badge, EmptyState, Card, SectionHeader, ListRow } from "@/components/ui";

function formatDistance(miles: number, units: "mi" | "km") {
  if (units === "km") return `${(miles * 1.609).toFixed(1)} km`;
  return `${miles.toFixed(1)} mi`;
}

function estimateChargeMins(powerKw: number | null, batteryPercent: number | null, batteryKwh: number | null): string | null {
  if (!powerKw || !batteryPercent || !batteryKwh) return null;
  const needed = ((100 - batteryPercent) / 100) * batteryKwh;
  const hrs = needed / (powerKw * 0.9);
  const mins = Math.round(hrs * 60);
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface Props {
  batteryPercent: number | null;
  batteryKwh: number | null;
}

export function NearbyStationCard({ batteryPercent, batteryKwh }: Props) {
  const colors = useColors();
  const { station, loading, hasLocation, locationDenied } = useNearbyStation();
  const { units } = useUnits();

  const goMap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/(tabs)");
  };

  if (loading || (!hasLocation && !locationDenied)) {
    return (
      <Card style={S.cardMargin}>
        <SectionHeader
          icon={<Ionicons name="flash" size={16} color={colors.primary} />}
          label="Nearby Charging"
          style={{ marginBottom: 12 }}
        />
        <Skeleton height={50} radius={10} />
      </Card>
    );
  }

  if (locationDenied || !station) {
    return (
      <Card style={S.cardMargin}>
        <SectionHeader
          icon={<Ionicons name="flash" size={16} color={colors.primary} />}
          label="Nearby Charging"
          style={{ marginBottom: 8 }}
        />
        <EmptyState
          compact
          icon={
            <Ionicons
              name={locationDenied ? "location-outline" : "search-outline"}
              size={22}
              color={colors.mutedForeground}
            />
          }
          iconColor={colors.mutedForeground}
          title={locationDenied ? "Location access needed" : "No stations found nearby"}
          body={locationDenied ? "Enable location to see EV stations near you" : "Try a larger search radius"}
          action={{
            label: "Browse All Stations",
            onPress: goMap,
            variant: "ghost",
          }}
        />
      </Card>
    );
  }

  const chargeEst = estimateChargeMins(station.powerKw, batteryPercent, batteryKwh);
  const statusVariant =
    station.status === "available" ? "success" :
    station.status === "busy" ? "warning" : "muted";

  return (
    <Card
      onPress={goMap}
      style={S.cardMargin}
      accessibilityLabel={`Nearby station: ${station.name}, status ${station.status}. Tap to view on map.`}
    >
      <SectionHeader
        icon={<Ionicons name="flash" size={16} color={colors.primary} />}
        label="Nearby Charging"
        action={{ label: "View on Map →", onPress: goMap }}
      />

      <ListRow
        icon={<Ionicons name="flash" size={20} color={colors.primary} />}
        iconBackground={colors.primary + "20"}
        titleLeft={
          <Badge
            variant={statusVariant}
            dot
            label={station.status}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        }
        title={station.name}
        subtitle={station.address}
        right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
        style={{ marginBottom: 12 }}
      />

      <View style={S.pills}>
        <Badge
          variant="muted"
          label={formatDistance(station.distanceMiles, units as "mi" | "km")}
          icon={<Ionicons name="navigate-outline" size={11} color={colors.mutedForeground} />}
        />
        {station.pricePerKwh != null && (
          <Badge
            variant="muted"
            label={`$${station.pricePerKwh.toFixed(2)}/kWh`}
            icon={<Ionicons name="pricetag-outline" size={11} color={colors.mutedForeground} />}
          />
        )}
        {station.connectorType && (
          <Badge variant="primary" label={station.connectorType} />
        )}
        {chargeEst && (
          <Badge
            variant="muted"
            label={chargeEst}
            icon={<Ionicons name="time-outline" size={11} color={colors.mutedForeground} />}
          />
        )}
      </View>
    </Card>
  );
}

const S = StyleSheet.create({
  cardMargin: { marginHorizontal: 16, marginBottom: 12 },
  pills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
});
