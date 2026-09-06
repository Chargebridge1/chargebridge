import React from "react";
import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";

interface Props {
  percent: number | null;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}

export function BatteryRing({
  percent,
  size = 84,
  strokeWidth = 7,
  color = "#0D9E7E",
  trackColor = "rgba(255,255,255,0.12)",
}: Props) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const dash = (pct / 100) * circ;

  const ringColor =
    percent == null
      ? trackColor
      : pct <= 20
        ? "#ef4444"
        : pct <= 40
          ? "#f59e0b"
          : color;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {percent != null && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90, ${size / 2}, ${size / 2})`}
          />
        )}
      </Svg>
      <Text
        style={{
          fontSize: percent != null ? 17 : 11,
          fontWeight: "800",
          color: percent != null ? "#fff" : "rgba(255,255,255,0.4)",
          fontFamily: "Inter_700Bold",
          textAlign: "center",
        }}
      >
        {percent != null ? `${pct}%` : "—"}
      </Text>
    </View>
  );
}
