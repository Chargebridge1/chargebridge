import React from "react";
import { Pressable } from "react-native";
import type { StyleProp, ViewStyle, AccessibilityRole } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { PressScale } from "@/constants/motion";

interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Scale target on press-in (defaults to motion spec PressScale.activeScale = 0.96) */
  scale?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  disabled?: boolean;
}

/**
 * Drop-in Pressable replacement that applies a spring scale animation on press.
 * Uses the motion spec PressScale.spring and PressScale.activeScale by default.
 * All press animations run on the UI thread via Reanimated worklets.
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  style,
  scale = PressScale.activeScale,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  disabled = false,
}: PressableScaleProps) {
  const pressed = useSharedValue(false);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(
          pressed.value ? scale : 1,
          PressScale.spring,
        ),
      },
    ],
  }));

  return (
    <Pressable
      onPressIn={() => { pressed.value = true; }}
      onPressOut={() => { pressed.value = false; }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
    >
      <Animated.View style={[style, animStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
