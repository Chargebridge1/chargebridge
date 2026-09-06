import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type DimensionValue } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useReduceMotion } from "@/hooks/useReduceMotion";

type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: object;
};

export function Skeleton({ width = "100%", height, radius = 8, style }: SkeletonProps) {
  const colors = useColors();
  const prefersReducedMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (prefersReducedMotion) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, prefersReducedMotion]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.muted,
          opacity,
        },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

type SkeletonGroupProps = {
  children: React.ReactNode;
  gap?: number;
};

export function SkeletonGroup({ children, gap = 8 }: SkeletonGroupProps) {
  return <View style={[S.group, { gap }]}>{children}</View>;
}

type SkeletonCardProps = {
  lines?: number;
  hasIcon?: boolean;
};

export function SkeletonCard({ lines = 2, hasIcon = true }: SkeletonCardProps) {
  const colors = useColors();
  return (
    <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={S.cardRow}>
        {hasIcon && <Skeleton width={36} height={36} radius={10} />}
        <View style={[S.cardLines, { flex: 1 }]}>
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
              key={i}
              width={i === 0 ? "70%" : "45%"}
              height={i === 0 ? 14 : 11}
              radius={6}
            />
          ))}
        </View>
        <Skeleton width={48} height={28} radius={8} />
      </View>
    </View>
  );
}

type SkeletonScreenProps = {
  cardCount?: number;
};

export function SkeletonScreen({ cardCount = 3 }: SkeletonScreenProps) {
  return (
    <View style={S.screen}>
      <Skeleton width="30%" height={12} radius={6} />
      <Skeleton width="55%" height={26} radius={8} style={{ marginTop: 6 }} />
      <Skeleton width="100%" height={80} radius={16} style={{ marginTop: 16 }} />
      <View style={[S.quickRow, { marginTop: 16 }]}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={64} height={48} radius={12} />)}
      </View>
      <Skeleton width="40%" height={12} radius={6} style={{ marginTop: 20 }} />
      <View style={{ marginTop: 10, gap: 10 }}>
        {Array.from({ length: cardCount }).map((_, i) => <SkeletonCard key={i} />)}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  group: {
    flexDirection: "column",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardLines: {
    gap: 8,
  },
  screen: {
    flex: 1,
    padding: 16,
  },
  quickRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
});
