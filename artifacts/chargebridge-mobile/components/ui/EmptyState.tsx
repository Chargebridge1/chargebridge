import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Button } from "./Button";

type EmptyStateAction = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
};

type EmptyStateProps = {
  icon: React.ReactNode;
  iconColor?: string;
  iconBackground?: string;
  title: string;
  body?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  compact?: boolean;
};

export function EmptyState({
  icon,
  iconColor,
  iconBackground,
  title,
  body,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  const colors = useColors();

  const ic = iconColor ?? colors.primary;
  const ibg = iconBackground ?? ic + "18";
  const iconSize = compact ? 56 : 76;
  const iconRadius = compact ? 16 : 22;

  return (
    <View
      style={[S.container, compact && S.containerCompact]}
      accessibilityRole="none"
    >
      <View
        style={[
          S.iconWrap,
          {
            width: iconSize,
            height: iconSize,
            borderRadius: iconRadius,
            backgroundColor: ibg,
            borderColor: ic + "28",
          },
        ]}
      >
        {icon}
      </View>

      <Text
        style={[S.title, { color: colors.foreground }, compact && S.titleCompact]}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {body ? (
        <Text style={[S.body, { color: colors.mutedForeground }, compact && S.bodyCompact]}>
          {body}
        </Text>
      ) : null}

      {(action || secondaryAction) ? (
        <View style={[S.actions, compact && S.actionsCompact]}>
          {action && (
            <Button
              label={action.label}
              onPress={action.onPress}
              variant={action.variant ?? "primary"}
              size={compact ? "sm" : "md"}
            />
          )}
          {secondaryAction && (
            <Button
              label={secondaryAction.label}
              onPress={secondaryAction.onPress}
              variant={secondaryAction.variant ?? "ghost"}
              size={compact ? "sm" : "md"}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 12,
  },
  containerCompact: {
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 8,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 24,
  },
  titleCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  bodyCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    marginTop: 8,
    gap: 8,
    width: "100%",
    alignItems: "center",
  },
  actionsCompact: {
    marginTop: 4,
    flexDirection: "row",
  },
});
