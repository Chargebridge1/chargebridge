import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { SymbolView } from "expo-symbols";

import { useVoice } from "@/contexts/VoiceContext";
import { useNavState } from "@/contexts/NavStateContext";
import { useColors } from "@/hooks/useColors";

export function VoiceButton() {
  const { state, startListening, isSupported } = useVoice();
  const { isNavigating, navCardHeight } = useNavState();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const isActive =
    state === "listening" || state === "confirming" || state === "processing";

  useEffect(() => {
    if (isActive) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.22,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isActive, pulseAnim]);

  if (!isSupported) return null;

  const btnColor = isActive ? "#E53935" : colors.sidebarPrimary ?? "#13AE8F";
  // +76 instead of +68: 8 px extra clearance so hitSlop={12} never reaches the
  // Customize button at the top of the tab bar shell (prevents touch conflicts).
  const tabBarHeight = insets.bottom > 0 ? insets.bottom + 76 : 88;
  // During navigation, position the button just above the nav card.
  // navCardHeight is measured via onLayout on the card itself; fall back to
  // 120 px until the first layout fires so the button is never occluded.
  const clearance = isNavigating ? Math.max(navCardHeight, 120) + 12 : 0;
  const bottomPos = tabBarHeight + clearance;

  return (
    <View
      pointerEvents="box-none"
      style={[S.wrapper, { bottom: bottomPos }]}
    >
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        {isActive && (
          <View style={[S.ring, { borderColor: btnColor + "50" }]} />
        )}
        <Pressable
          onPress={() => void startListening()}
          style={[S.btn, { backgroundColor: btnColor }]}
          accessibilityLabel={isActive ? "Stop listening" : "Start voice command"}
          accessibilityRole="button"
          hitSlop={12}
        >
          {isIOS ? (
            <SymbolView
              name={isActive ? "mic.fill" : "mic"}
              tintColor="#fff"
              size={22}
            />
          ) : (
            <Feather
              name="mic"
              size={22}
              color="#fff"
            />
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const S = StyleSheet.create({
  wrapper: {
    position: "absolute",
    right: 20,
    zIndex: 200,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "box-none",
  } as any,
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 8,
  },
  ring: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    top: -8,
    left: -8,
  },
});
