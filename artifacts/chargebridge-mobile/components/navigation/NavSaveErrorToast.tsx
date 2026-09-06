import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { tokens } from "@workspace/design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// NavSaveErrorToast — brief error banner shown above the tab bar when a
// nav-pill layout save fails on the server.  Auto-dismisses after 3 s (or 6 s
// when a Retry action is present so the user has time to tap it).
//
// Pause-on-touch: while the user's finger is anywhere on the toast area the
// auto-dismiss timer is cleared.  When the finger lifts a fresh full-length
// countdown starts, giving the user a reliable window to reach Retry.
// ─────────────────────────────────────────────────────────────────────────────

const TAB_BAR_HEIGHT = 64; // matches TabBarShell content height (excl. safe area)
const DISPLAY_MS_DEFAULT = 3000;
const DISPLAY_MS_WITH_RETRY = 6000;
const FADE_MS = 220;

interface NavSaveErrorToastProps {
  visible: boolean;
  onHide: () => void;
  /** When provided, a Retry button is rendered and the toast stays visible longer */
  onRetry?: () => void;
}

export function NavSaveErrorToast({
  visible,
  onHide,
  onRetry,
}: NavSaveErrorToastProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayMs = onRetry ? DISPLAY_MS_WITH_RETRY : DISPLAY_MS_DEFAULT;

  // Captures the latest onHide/displayMs so the timer callback always calls
  // the current version without adding them as effect dependencies.
  const onHideRef = useRef(onHide);
  const displayMsRef = useRef(displayMs);
  useEffect(() => { onHideRef.current = onHide; }, [onHide]);
  useEffect(() => { displayMsRef.current = displayMs; }, [displayMs]);

  /** Start (or restart) the auto-dismiss countdown from the full duration. */
  function startDismissTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 8,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      ]).start(() => onHideRef.current());
    }, displayMsRef.current);
  }

  /** Pause the timer while the user's finger is on the toast. */
  function handlePressIn() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * When the finger lifts, reset the full countdown so the user always has a
   * complete window after releasing their touch.
   */
  function handlePressOut() {
    startDismissTimer();
  }

  useEffect(() => {
    if (!visible) return;

    // Fade + slide in
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start();

    // Start the auto-dismiss countdown
    startDismissTimer();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      opacity.setValue(0);
      translateY.setValue(8);
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  // Position just above the tab bar (safe area + bar height + small gap)
  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + 10;

  return (
    <Animated.View
      style={[
        LS.container,
        { bottom: bottomOffset, opacity, transform: [{ translateY }] },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      // box-none lets touches pass through the container background but still
      // reach child views (the Pressable row and the Retry button).
      pointerEvents={onRetry ? "box-none" : "none"}
    >
      {/*
       * Pressable wraps the entire content row so that a finger anywhere on
       * the toast — not just on the Retry button — pauses the dismiss timer.
       * onPressIn clears the timer; onPressOut resets it to the full duration.
       * There is no onPress so no visual ripple is shown.
       */}
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={LS.pressableRow}
        accessible={false}
      >
        <Feather
          name="alert-circle"
          size={14}
          color={tokens.colors.dark.tabBar.activeTint}
          style={LS.icon}
        />
        <Text style={LS.text}>Layout couldn't be saved</Text>
        {onRetry && (
          <TouchableOpacity
            onPress={() => {
              // Cancel the auto-dismiss timer first so it can't fire onHide
              // a second time after we've already called it here.
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
              onHide();
              onRetry();
            }}
            style={LS.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry saving layout"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={LS.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </Pressable>
    </Animated.View>
  );
}

const LS = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  pressableRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(20,20,28,0.92)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flexShrink: 1,
  },
  retryButton: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  retryText: {
    color: tokens.colors.dark.tabBar.activeTint,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
