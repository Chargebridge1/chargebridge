import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { track } from "@/lib/analytics";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { Spring } from "@/constants/motion";

// ─────────────────────────────────────────────────────────────────────────────
// NavPillCoachMark — one-time discovery tooltip for the Navigation Pills feature.
//
// • Shown exactly once: AsyncStorage key guards re-display.
// • Appears 1.2 s after mount (letting the dashboard settle first).
// • Auto-dismisses after 4.5 s; any tap also dismisses.
// • Respects Reduce Motion: skips spring animations when enabled.
// • Does NOT block interaction — renders above the tab bar as a floating card.
// • Analytics: navigation_coachmark_shown / navigation_coachmark_dismissed.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "CB_NAV_COACHMARK_SHOWN_V2";
const AUTO_DISMISS_MS = 4500;
const APPEAR_DELAY_MS = 1200;
const TEAL = "#2DD4BF";

// Segments that identify a tab-bar screen. The coach mark should only appear
// when the user is on one of these screens — not during onboarding or modals.
const TAB_SEGMENTS = ["/home", "/map", "/charge", "/activity", "/account"] as const;

interface NavPillCoachMarkProps {
  /**
   * Called the moment the user taps the card (before the dismiss animation).
   * Use this to enter Edit Mode so the coach mark tap becomes a direct CTA.
   * When omitted the card is still tappable — it just dismisses.
   */
  onPress?: () => void;
}

export function NavPillCoachMark({ onPress }: NavPillCoachMarkProps) {
  const insets = useSafeAreaInsets();
  const prefersReducedMotion = useReduceMotion();

  // Keep a ref so the dismiss closure reads the current value without
  // triggering stale-closure issues.
  const prefersReducedMotionRef = useRef(prefersReducedMotion);
  useEffect(() => {
    prefersReducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  // Only trigger the coach mark when the user is on a tab screen.
  // Without this guard the coach mark fires during onboarding, auto-dismisses
  // after 4.5 s, writes the storage key, and never appears on the actual tabs.
  const pathname = usePathname();
  const isOnTabs = TAB_SEGMENTS.some((s) => pathname.includes(s));

  const [visible, setVisible] = useState(false);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against double-tracking if auto-dismiss and tap fire close together.
  const trackFired = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (!trackFired.current) {
      trackFired.current = true;
      track("navigation_coachmark_dismissed");
    }
    void AsyncStorage.setItem(STORAGE_KEY, "1");

    if (prefersReducedMotionRef.current) {
      opacity.value = 0;
      translateY.value = 10;
      setVisible(false);
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(10, { duration: 180 });
      // setVisible after animation completes so the component doesn't pop away.
      setTimeout(() => setVisible(false), 200);
    }
  }, [opacity, translateY]);

  useEffect(() => {
    // Only start the appear sequence when the user is on a tab screen.
    if (!isOnTabs) return;
    let appearTimer: ReturnType<typeof setTimeout>;

    void AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) return;

      appearTimer = setTimeout(() => {
        setVisible(true);
        track("navigation_coachmark_shown");

        if (prefersReducedMotionRef.current) {
          opacity.value = 1;
          translateY.value = 0;
        } else {
          opacity.value = withSpring(1, Spring.gentle);
          translateY.value = withSpring(0, Spring.gentle);
        }

        dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
      }, APPEAR_DELAY_MS);
    });

    return () => {
      clearTimeout(appearTimer);
      // dismissTimer is intentionally NOT cleared: if the coach mark has
      // already appeared, let it complete its lifecycle (write the storage
      // key + animate out) regardless of subsequent navigation state.
    };
  }, [isOnTabs, dismiss]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  const barHeight = Platform.OS === "web" ? 72 : insets.bottom + 64;

  return (
    <Animated.View
      style={[LS.anchor, { bottom: barHeight + 10 }, animStyle]}
      // box-none so the floating card does not intercept taps outside the
      // visible card area — the main content beneath remains fully interactive.
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={LS.card}
        onPress={() => { onPress?.(); dismiss(); }}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={
          "Navigation tip: Customize Your Navigation. " +
          "Long-press any navigation pill to rearrange or hide shortcuts. " +
          "Tap to dismiss."
        }
      >
        {/* Frosted glass background */}
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={32}
            tint="dark"
            style={StyleSheet.absoluteFill as object}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill as object, LS.androidFill]} />
        )}

        <View style={LS.content}>
          <View style={LS.titleRow}>
            <View style={LS.dot} />
            <Text style={LS.title}>Customize Your Navigation</Text>
          </View>
          <Text style={LS.body}>
            Long-press any navigation pill to rearrange or hide shortcuts.
          </Text>
        </View>

        {/* Downward-pointing arrow toward the tab bar */}
        <View style={LS.arrowWrap}>
          <View style={LS.arrow} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const LS = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 200,
  },
  card: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(10,14,20,0.80)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 16,
  },
  androidFill: {
    backgroundColor: "rgba(12,18,28,0.96)",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: TEAL,
  },
  title: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
  body: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  arrowWrap: {
    alignItems: "center",
    paddingBottom: 8,
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(255,255,255,0.14)",
  },
});
