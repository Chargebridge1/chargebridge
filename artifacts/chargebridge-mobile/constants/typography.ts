import { StyleSheet } from "react-native";

export const typography = StyleSheet.create({
  display: {
    fontSize: 34,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  title1: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  title2: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  headline: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  callout: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_700Bold",
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  subheading: {
    fontSize: 19,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 24,
    letterSpacing: -0.1,
  },
  labelPlain: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    lineHeight: 14,
    letterSpacing: 0.3,
  },
});

export type TypographyToken = keyof typeof typography;
