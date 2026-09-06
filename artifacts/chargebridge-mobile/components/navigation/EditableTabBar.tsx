import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  TouchableOpacity,
} from "react-native-gesture-handler";
import Animated, {
  SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Spring } from "@/constants/motion";
import { TabBarShell } from "./TabBarShell";
import { NavPillIcon } from "./NavPillIcon";
import { tokens } from "@workspace/design-tokens";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import {
  ALL_PILL_IDS,
  MIN_OPTIONAL_VISIBLE,
  NAV_PILLS,
  PillId,
} from "@/constants/navPills";

// ─────────────────────────────────────────────────────────────────────────────
// EditableTabBar — iPhone-style "wiggle mode" for nav pill customisation.
//
// Shown by CustomTabBar when isEditMode is true (entered via the Customize
// button or the coach-mark CTA). Each pill wiggles, can be drag-reordered
// horizontally, and has a show/hide badge. Done/Reset buttons live at the
// top corners of the bar.
// ─────────────────────────────────────────────────────────────────────────────

const T = tokens.colors.dark.tabBar;

const WIGGLE_DEG = 2.5;  // ±degrees of rotation
const WIGGLE_MS  = 115;  // ms per half-swing
const STAGGER_MS = 50;   // delay between successive pill wiggle starts

// ── Per-pill wiggle + drag component ─────────────────────────────────────────

interface WigglePillProps {
  id:            PillId;
  index:         number;
  fingerX:       SharedValue<number>;
  draggingIdSV:  SharedValue<string>;
  dispX:         SharedValue<number>;
  isHidden:      boolean;
  canHide:       boolean;
  onDragStart:   (id: PillId) => void;
  onDragMove:    (id: PillId, tx: number) => void;
  onDragEnd:     (id: PillId, tx: number) => void;
  onToggleHide?: () => void;
}

function WigglePill({
  id, index, fingerX, draggingIdSV, dispX,
  isHidden, canHide, onDragStart, onDragMove, onDragEnd, onToggleHide,
}: WigglePillProps) {
  const pill          = NAV_PILLS[id];
  const reducedMotion = useReduceMotion();
  const rot     = useSharedValue(0);
  const opacity = useSharedValue(isHidden ? 0.42 : 1);

  // Sync hidden state → animated opacity on the UI thread.
  useEffect(() => {
    opacity.value = withSpring(isHidden ? 0.42 : 1, Spring.snappy);
  }, [isHidden, opacity]);

  // Staggered wiggle — skipped entirely when Reduce Motion is enabled.
  // Re-runs if the user toggles Reduce Motion mid-session so the animation
  // stops or starts immediately.
  useEffect(() => {
    if (reducedMotion) {
      rot.value = withTiming(0, { duration: 80 });
      return;
    }
    rot.value = withDelay(
      index * STAGGER_MS,
      withRepeat(
        withSequence(
          withTiming( WIGGLE_DEG, { duration: WIGGLE_MS }),
          withTiming(-WIGGLE_DEG, { duration: WIGGLE_MS }),
        ),
        -1,
        false,
      ),
    );
  }, [reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Horizontal pan gesture: minDistance(6) ensures short taps fall through
  // to the hide badge TouchableOpacity instead of triggering a drag.
  const panGesture = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      draggingIdSV.value = id;
      runOnJS(onDragStart)(id);
    })
    .onUpdate((e) => {
      if (draggingIdSV.value !== id) return;
      fingerX.value = e.translationX;
      runOnJS(onDragMove)(id, e.translationX);
    })
    .onEnd((e) => {
      fingerX.value = withSpring(0, Spring.snappy);
      draggingIdSV.value = "";
      runOnJS(onDragEnd)(id, e.translationX);
    });

  const pillStyle = useAnimatedStyle(() => {
    const dragging = draggingIdSV.value === id;
    return {
      transform: [
        {
          translateX: dragging
            ? fingerX.value
            : withSpring(dispX.value, Spring.base),
        },
        { rotate: `${dragging ? 0 : rot.value}deg` },
        { scale: withSpring(dragging ? 1.10 : 1, Spring.snappy) },
      ],
      zIndex:        dragging ? 10 : 1,
      shadowOpacity: withSpring(dragging ? 0.38 : 0, Spring.snappy),
      opacity:       opacity.value,
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[LS.pill, pillStyle]}
        accessibilityRole="adjustable"
        accessibilityLabel={`${pill.label}${isHidden ? ", hidden" : ""}`}
        accessibilityHint="Drag left or right to reorder"
      >
        {/* Grip affordance — hints that the pill is draggable */}
        <Feather name="menu" size={10} color="rgba(255,255,255,0.38)" style={LS.grip} />

        {/* Nav icon */}
        <NavPillIcon id={id} tintColor="rgba(255,255,255,0.78)" size={22} />

        {/* Tab label */}
        <Text style={LS.label} numberOfLines={1}>{pill.label}</Text>

        {/* Show/hide badge — optional pills only */}
        {canHide && onToggleHide && (
          <TouchableOpacity
            style={LS.hideBadge}
            onPress={onToggleHide}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={isHidden ? `Show ${pill.label}` : `Hide ${pill.label}`}
          >
            <Feather
              name={isHidden ? "plus-circle" : "minus-circle"}
              size={14}
              color={isHidden ? T.activeTint : "rgba(255,72,72,0.85)"}
            />
          </TouchableOpacity>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface EditableTabBarProps {
  initialOrder:  PillId[];
  initialHidden: PillId[];
  onDone:  (order: PillId[], hidden: PillId[]) => Promise<void>;
  onReset: () => Promise<void>;
}

export function EditableTabBar({
  initialOrder,
  initialHidden,
  onDone,
  onReset,
}: EditableTabBarProps) {
  const { width } = useWindowDimensions();

  // ── DIAGNOSTIC: confirm EditableTabBar actually mounts/unmounts.
  //   If "CustomTabBar render — isEditMode: true" appears but this log never
  //   appears, the conditional branch is not executing as expected.
  useEffect(() => {
    console.log("[NavPill][DIAG] EditableTabBar MOUNTED");
    return () => { console.log("[NavPill][DIAG] EditableTabBar UNMOUNTED"); };
  }, []);

  const [order,  setOrder]  = useState<PillId[]>(initialOrder);
  const [hidden, setHidden] = useState<PillId[]>(initialHidden);

  // ── 5 fixed SharedValues for horizontal slot displacement (one per PillId) ──
  // Declared at top level — cannot conditionally call hooks.
  const homeDisp     = useSharedValue(0);
  const mapDisp      = useSharedValue(0);
  const chargeDisp   = useSharedValue(0);
  const activityDisp = useSharedValue(0);
  const accountDisp  = useSharedValue(0);
  const fingerX      = useSharedValue(0);
  const draggingIdSV = useSharedValue<string>("");

  // Stable map: pill → its displacement SharedValue.
  // useRef so identity is stable across renders.
  const dispMap = useRef<Record<PillId, SharedValue<number>>>({
    home:     homeDisp,
    map:      mapDisp,
    charge:   chargeDisp,
    activity: activityDisp,
    account:  accountDisp,
  }).current;

  // Slot geometry: assumes even spacing across the full bar width.
  const slotW = width / Math.max(order.length, 1);

  // ── Drag callbacks ────────────────────────────────────────────────────────────
  const fromIndexRef  = useRef(0);
  const prevTargetRef = useRef(0);

  const handleDragStart = useCallback((id: PillId) => {
    fromIndexRef.current  = order.indexOf(id);
    prevTargetRef.current = fromIndexRef.current;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [order]);

  const handleDragMove = useCallback((id: PillId, tx: number) => {
    const from   = fromIndexRef.current;
    const n      = order.length;
    const target = Math.max(0, Math.min(n - 1, Math.round((from * slotW + tx) / slotW)));
    if (target === prevTargetRef.current) return;
    prevTargetRef.current = target;
    Haptics.selectionAsync();

    // Shift intermediate pills to show where the dragged pill will land.
    order.forEach((pid, i) => {
      if (pid === id) return;
      let shift = 0;
      if (target > from && i > from  && i <= target) shift = -slotW;
      if (target < from && i >= target && i < from)  shift =  slotW;
      dispMap[pid].value = shift;
    });
  }, [order, slotW, dispMap]);

  const handleDragEnd = useCallback((id: PillId, tx: number) => {
    const from   = fromIndexRef.current;
    const n      = order.length;
    const target = Math.max(0, Math.min(n - 1, Math.round((from * slotW + tx) / slotW)));

    // Commit new order and reset all displacement animations.
    const next = [...order];
    next.splice(from, 1);
    next.splice(target, 0, id);
    setOrder(next);
    for (const pid of ALL_PILL_IDS) dispMap[pid].value = 0;
  }, [order, slotW, dispMap]);

  // ── Visibility toggle ─────────────────────────────────────────────────────────
  const visibleOptional = order.filter(
    (id) => !NAV_PILLS[id].isPinned && !hidden.includes(id)
  ).length;

  const toggleHide = useCallback((id: PillId) => {
    setHidden((prev) => {
      const hiding = !prev.includes(id);
      // Enforce minimum — can't hide if we're already at the floor.
      if (hiding && visibleOptional <= MIN_OPTIONAL_VISIBLE) return prev;
      return hiding ? [...prev, id] : prev.filter((h) => h !== id);
    });
    Haptics.selectionAsync();
  }, [visibleOptional]);

  // ── Done / Reset ──────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    Alert.alert(
      "Reset Navigation?",
      "This will restore the default tab arrangement.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => { void onReset(); },
        },
      ],
    );
  }, [onReset]);

  return (
    <TabBarShell>

      {/* Wiggle pill row */}
      <View style={LS.row}>
        {order.map((id, index) => (
          <WigglePill
            key={id}
            id={id}
            index={index}
            fingerX={fingerX}
            draggingIdSV={draggingIdSV}
            dispX={dispMap[id]}
            isHidden={hidden.includes(id)}
            canHide={!NAV_PILLS[id].isPinned}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onToggleHide={NAV_PILLS[id].isPinned ? undefined : () => toggleHide(id)}
          />
        ))}
      </View>

      {/* Reset — top-left, destructive-tinted */}
      <TouchableOpacity
        style={LS.resetBtn}
        onPress={handleReset}
        accessibilityRole="button"
        accessibilityLabel="Reset navigation to default layout"
      >
        <Text style={LS.resetTxt}>Reset</Text>
      </TouchableOpacity>

      {/* Done — top-right, primary teal */}
      <TouchableOpacity
        style={LS.doneBtn}
        onPress={() => { void onDone(order, hidden); }}
        accessibilityRole="button"
        accessibilityLabel="Done — save navigation layout"
      >
        <Text style={LS.doneTxt}>Done</Text>
      </TouchableOpacity>
    </TabBarShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const LS = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
  },
  pill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    minHeight: 44,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  grip: {
    marginBottom: 2,
  },
  label: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  hideBadge: {
    position: "absolute",
    top: 0,
    right: 2,
  },
  resetBtn: {
    position: "absolute",
    top: 8,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,72,72,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  resetTxt: {
    color: "rgba(255,72,72,0.85)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  doneBtn: {
    position: "absolute",
    top: 8,
    right: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: T.activeTint,
  },
  doneTxt: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
