import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { usePrimaryVehicle } from "@/hooks/usePrimaryVehicle";
import { BatteryRing } from "@/components/dashboard/BatteryRing";
import { Typography, Badge, EmptyState, Card } from "@/components/ui";

const COLOR_MAP: Record<string, string> = {
  white: "#f1f5f9", silver: "#94a3b8", gray: "#64748b", black: "#1e293b",
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e", yellow: "#eab308",
  orange: "#f97316", purple: "#a855f7", brown: "#92400e", gold: "#ca8a04",
};

interface Props {
  batteryPercent: number | null;
  onUpdateBattery: () => void;
}

export function VehicleSummaryCard({ batteryPercent, onUpdateBattery }: Props) {
  const colors = useColors();
  const vehicle = usePrimaryVehicle();
  const plugTypes = vehicle?.plugTypes ?? [];

  if (!vehicle) {
    return (
      <Card style={S.cardMargin}>
        <EmptyState
          compact
          icon={<Ionicons name="car-outline" size={32} color={colors.primary} />}
          iconColor={colors.primary}
          title="Add Your Vehicle"
          body="Get personalised charging recommendations and range estimates"
          action={{
            label: "Set Up Vehicle",
            onPress: () => router.push("/edit-profile" as any),
            variant: "primary",
          }}
        />
      </Card>
    );
  }

  const vehicleColor = vehicle.color
    ? (COLOR_MAP[vehicle.color.toLowerCase()] ?? colors.primary)
    : colors.primary;
  const displayName = vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`;
  const rangeKm = vehicle.rangePerCharge;
  const estimatedRange =
    batteryPercent != null && rangeKm != null
      ? Math.round((batteryPercent / 100) * rangeKm)
      : null;

  return (
    <Card style={[S.cardMargin, S.overflow]} padding={0} radius={18}>
      <View style={[S.stripe, { backgroundColor: vehicleColor }]} />

      <View style={S.inner}>
        <View style={S.info}>
          <Typography variant="headline" color={colors.foreground} numberOfLines={1}>
            {displayName}
          </Typography>
          <Typography variant="caption" color={colors.mutedForeground} numberOfLines={1}>
            {vehicle.year ? `${vehicle.year} · ` : ""}{vehicle.make} {vehicle.model}
          </Typography>

          {plugTypes.length > 0 && (
            <View style={S.badges}>
              {plugTypes.slice(0, 3).map((pt: string) => (
                <Badge key={pt} variant="primary" label={pt} />
              ))}
            </View>
          )}

          {estimatedRange != null ? (
            <View style={S.rangeRow}>
              <Ionicons name="navigate-outline" size={13} color={colors.mutedForeground} />
              <Typography variant="caption" color={colors.mutedForeground}>
                ~{estimatedRange} mi estimated range
              </Typography>
            </View>
          ) : (
            <TouchableOpacity
              style={S.rangeRow}
              onPress={onUpdateBattery}
              accessibilityRole="button"
              accessibilityLabel="Tap to set battery level"
            >
              <Ionicons name="battery-half-outline" size={13} color={colors.primary} />
              <Typography variant="caption" color={colors.primary}>
                Tap to set battery level
              </Typography>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={onUpdateBattery}
          activeOpacity={0.75}
          style={S.ringWrap}
          accessibilityRole="button"
          accessibilityLabel={`Battery ${batteryPercent ?? 0}%. Tap to update.`}
        >
          <BatteryRing percent={batteryPercent} size={84} color={colors.primary} />
          <Typography variant="caption" color={colors.mutedForeground} style={{ fontSize: 9, textAlign: "center" }}>
            Tap to update
          </Typography>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const S = StyleSheet.create({
  cardMargin: { marginHorizontal: 16, marginBottom: 12 },
  overflow: { overflow: "hidden" },
  stripe: { height: 3, width: "100%" },
  inner: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  info: { flex: 1, gap: 4 },
  badges: { flexDirection: "row", gap: 6, marginTop: 4 },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  ringWrap: { alignItems: "center", gap: 4 },
});
