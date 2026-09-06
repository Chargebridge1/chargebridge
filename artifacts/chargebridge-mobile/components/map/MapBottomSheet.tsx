import React, { useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Surface } from "@/components/ui/Surface";
import { FreshnessIndicator } from "@/components/map/FreshnessIndicator";
import { Feather } from "@expo/vector-icons";
import { typography } from "@/constants/typography";
import * as Haptics from "expo-haptics";

const SCREEN_H = Dimensions.get("window").height;
const TAB_BAR_H = 58;

export const SHEET_SNAP_PEEK = 0;
export const SHEET_SNAP_PARTIAL = 1;
export const SHEET_SNAP_FULL = 2;

const PEEK_VISIBLE = 80;
const PARTIAL_VISIBLE = 280;
const SPRING = { damping: 80, stiffness: 500 };

// The sheet's natural top at translateY=0 = FULL state (~10% from screen top)
const SHEET_TOP_FULL = Math.round(SCREEN_H * 0.1);
// Tall enough to fill the screen from FULL top to the bottom
const SHEET_TOTAL_HEIGHT = SCREEN_H * 0.96;

function computeSnapAt(idx: number, insetBottom: number): number {
  "worklet";
  const floor = SCREEN_H - insetBottom - TAB_BAR_H;
  if (idx === 0) return floor - PEEK_VISIBLE - SHEET_TOP_FULL;    // PEEK
  if (idx === 1) return floor - PARTIAL_VISIBLE - SHEET_TOP_FULL; // PARTIAL
  return 0;                                                         // FULL
}

type Props = {
  snapIdx: number; // 0=PEEK 1=PARTIAL 2=FULL
  onSnapChange: (idx: number) => void;
  stationCount: number;
  lastRefreshed: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  filterContent: React.ReactNode;
  children: React.ReactNode;
  hidden?: boolean;
};

export function MapBottomSheet({
  snapIdx,
  onSnapChange,
  stationCount,
  lastRefreshed,
  isRefreshing,
  onRefresh,
  filterContent,
  children,
  hidden = false,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Store inset in a shared value so the UI-thread gesture can read it
  const insetBottom = useSharedValue(insets.bottom);
  useEffect(() => {
    insetBottom.value = insets.bottom;
  }, [insets.bottom]);

  const translateY = useSharedValue(computeSnapAt(snapIdx, insets.bottom));
  const startY = useSharedValue(0);

  // Sync translateY when snapIdx changes from JS side
  useEffect(() => {
    translateY.value = withSpring(
      computeSnapAt(snapIdx, insets.bottom),
      SPRING,
    );
  }, [snapIdx, insets.bottom]);

  const notifySnap = useCallback(
    (idx: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSnapChange(idx);
    },
    [onSnapChange],
  );

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      "worklet";
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      "worklet";
      const peekTY = computeSnapAt(0, insetBottom.value);
      const fullTY = computeSnapAt(2, insetBottom.value); // = 0
      const next = startY.value + e.translationY;
      translateY.value = Math.max(fullTY, Math.min(peekTY, next));
    })
    .onEnd((e) => {
      "worklet";
      const peekTY = computeSnapAt(0, insetBottom.value);
      const partialTY = computeSnapAt(1, insetBottom.value);
      const fullTY = computeSnapAt(2, insetBottom.value); // = 0
      const currentTY = startY.value + e.translationY;

      // Snap to nearest of the three points
      const distPeek = Math.abs(peekTY - currentTY);
      const distPartial = Math.abs(partialTY - currentTY);
      const distFull = Math.abs(fullTY - currentTY);

      let nearestIdx = 0;
      let nearestTY = peekTY;
      if (distPartial < distPeek && distPartial <= distFull) {
        nearestIdx = 1;
        nearestTY = partialTY;
      } else if (distFull < distPeek && distFull < distPartial) {
        nearestIdx = 2;
        nearestTY = fullTY;
      }

      translateY.value = withSpring(nearestTY, SPRING);
      runOnJS(notifySnap)(nearestIdx);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (hidden) return null;

  const isExpanded = snapIdx >= SHEET_SNAP_PARTIAL;

  return (
    <Animated.View
      style={[
        styles.sheet,
        { top: SHEET_TOP_FULL, height: SHEET_TOTAL_HEIGHT },
        animatedStyle,
      ]}
      pointerEvents="box-none"
    >
      {/*
        Surface provides background colour, border, and top-corner radius from the
        design system "sheet" variant. Shadow stays on the outer Animated.View because
        Surface.elevation uses downward (positive-y) projection; bottom sheets need an
        upward shadow (negative-y), which Surface's elevation model does not support.
      */}
      <Surface variant="sheet" padding={0} style={styles.sheetSurface}>
      {/* ── Drag handle area ── */}
      <GestureDetector gesture={panGesture}>
        <View style={styles.handleArea} pointerEvents="box-only">
          <View
            style={[
              styles.handleBar,
              { backgroundColor: colors.mutedForeground + "60" },
            ]}
          />

          {/* Peek header: count + freshness dot + expand button */}
          <View style={styles.peekRow}>
            <View style={styles.peekLeft}>
              {isRefreshing ? (
                <ActivityIndicator size={14} color="#1bc99a" />
              ) : (
                <Text style={[styles.countText, { color: colors.foreground }]}>
                  {stationCount} station{stationCount !== 1 ? "s" : ""} nearby
                </Text>
              )}
              <FreshnessIndicator
                lastRefreshed={lastRefreshed}
                isRefreshing={isRefreshing}
                onRefresh={onRefresh}
                showTimestamp={false}
              />
            </View>
            {/*
              Icon-only control: Button requires a visible label string and is not
              designed for icon-only affordances. TouchableOpacity is the correct
              primitive here; accessibilityLabel covers the semantic gap.
            */}
            <TouchableOpacity
              onPress={() => {
                const nextSnap =
                  snapIdx === SHEET_SNAP_PEEK
                    ? SHEET_SNAP_PARTIAL
                    : snapIdx === SHEET_SNAP_PARTIAL
                      ? SHEET_SNAP_FULL
                      : SHEET_SNAP_PEEK;
                notifySnap(nextSnap);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={
                snapIdx === SHEET_SNAP_FULL ? "Collapse sheet" : "Expand sheet"
              }
              style={styles.expandBtn}
            >
              <Feather
                name={
                  snapIdx === SHEET_SNAP_FULL ? "chevron-down" : "chevron-up"
                }
                size={16}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
        </View>
      </GestureDetector>

      {/* ── Filter pills (always visible when sheet is shown) ── */}
      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {filterContent}
      </View>

      {/* ── Freshness timestamp (shown in expanded states) ── */}
      {isExpanded && (
        <View
          style={[styles.freshnessRow, { borderBottomColor: colors.border }]}
        >
          <FreshnessIndicator
            lastRefreshed={lastRefreshed}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
            showTimestamp
          />
        </View>
      )}

      {/* ── Station list content ── */}
      <View style={styles.listContainer} pointerEvents="box-none">
        {children}
      </View>
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
    // Surface variant="sheet" owns background, border, and top-corner radius.
    // Shadow stays here with negative-y offset (upward projection for bottom sheet).
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetSurface: {
    flex: 1,
  },
  handleArea: {
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  peekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  peekLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  countText: {
    ...typography.callout,
    fontFamily: "Inter_700Bold",
  },
  expandBtn: {
    padding: 4,
  },
  filterRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  freshnessRow: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listContainer: {
    flex: 1,
  },
});
