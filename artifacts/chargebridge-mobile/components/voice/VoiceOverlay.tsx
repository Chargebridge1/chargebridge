import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useVoice } from "@/contexts/VoiceContext";
import { useColors } from "@/hooks/useColors";

const VISIBLE_STATES = new Set(["listening", "processing", "speaking", "confirming", "error"]);

function stateLabel(state: string): string {
  switch (state) {
    case "listening":  return "Listening…";
    case "processing": return "Thinking…";
    case "speaking":   return "ChargeBridge";
    case "confirming": return "Awaiting confirmation";
    case "error":      return "Error";
    default:           return "";
  }
}

export function VoiceOverlay() {
  const { state, transcript, response, pendingConfirmation, cancelVoice } = useVoice();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(200)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;
  const visible = VISIBLE_STATES.has(state);

  // Slide in/out
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: visible ? 0 : 200,
        duration: 280,
        easing: visible ? Easing.out(Easing.back(1.4)) : Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideAnim, opacityAnim]);

  // Listening dot animation
  useEffect(() => {
    if (state === "listening") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [state, dotAnim]);

  if (!visible) return null;

  const isListening = state === "listening";
  const isConfirming = state === "confirming";
  const showTranscript = !!transcript && (isListening || state === "processing");
  const showResponse = !!response && (state === "speaking" || isConfirming || state === "error");
  const bottomPad = insets.bottom > 0 ? insets.bottom : 16;

  return (
    <Animated.View
      style={[
        S.container,
        {
          bottom: bottomPad + 144,
          backgroundColor: colors.sidebar ?? "#1a2332",
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Header row */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          {isListening && (
            <Animated.View
              style={[
                S.dot,
                { opacity: dotAnim, backgroundColor: "#E53935" },
              ]}
            />
          )}
          <Text style={[S.label, { color: colors.sidebarMutedForeground ?? "#aaa" }]}>
            {stateLabel(state)}
          </Text>
        </View>
        <Pressable onPress={cancelVoice} hitSlop={12} accessibilityLabel="Cancel voice">
          <Feather name="x" size={18} color={colors.sidebarMutedForeground ?? "#aaa"} />
        </Pressable>
      </View>

      {/* Live transcript */}
      {showTranscript && (
        <Text
          style={[S.transcript, { color: colors.sidebarForeground ?? "#fff" }]}
          numberOfLines={2}
        >
          {transcript}
        </Text>
      )}

      {/* Assistant response */}
      {showResponse && (
        <Text
          style={[S.responseText, { color: colors.sidebarForeground ?? "#fff" }]}
          numberOfLines={3}
        >
          {response}
        </Text>
      )}

      {/* Confirmation hint */}
      {isConfirming && (
        <Text style={[S.hint, { color: colors.sidebarPrimary ?? "#13AE8F" }]}>
          Say "yes" to confirm or "no" to cancel
        </Text>
      )}

      {/* Listening waveform indicator */}
      {isListening && (
        <View style={S.waveRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <WaveBar key={i} delay={i * 80} color={colors.sidebarPrimary ?? "#13AE8F"} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

function WaveBar({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0.3,
          duration: 350,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={{
        width: 4,
        height: 22,
        borderRadius: 2,
        backgroundColor: color,
        marginHorizontal: 3,
        transform: [{ scaleY: anim }],
      }}
    />
  );
}

const S = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 16,
    zIndex: 190,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  transcript: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 6,
    lineHeight: 22,
  },
  responseText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 6,
  },
  waveRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    height: 28,
  },
});
