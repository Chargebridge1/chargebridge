const colors = {
  light: {
    text: "#1A2530",
    tint: "#0D9E7E",
    background: "#f7f5f1",
    foreground: "#1A2530",
    card: "#fefcfa",
    cardForeground: "#1A2530",
    primary: "#0D9E7E",
    primaryForeground: "#ffffff",
    secondary: "#ede9e2",
    secondaryForeground: "#2e3a48",
    muted: "#ede9e2",
    mutedForeground: "#7a7266",
    accent: "#d2f0e8",
    accentForeground: "#075c48",
    destructive: "#ef4444",
    destructiveForeground: "#ffffff",
    border: "#e2ddd6",
    input: "#e2ddd6",
    sidebar: "#1C2230",
    sidebarForeground: "#e8e4dc",
    sidebarBorder: "#252d3a",
    sidebarPrimary: "#18DCB5",
    sidebarPrimaryForeground: "#0d1a14",
    sidebarMutedForeground: "#8a8070",
    success: "#10B981",
    successForeground: "#065F46",
    successBackground: "#D1FAE5",
    warning: "#F59E0B",
    warningForeground: "#78350F",
    warningBackground: "#FEF3C7",
    error: "#EF4444",
    errorForeground: "#991B1B",
    errorBackground: "#FEE2E2",
    info: "#3B82F6",
    infoForeground: "#1E3A8A",
    infoBackground: "#DBEAFE",
  },
  dark: {
    text: "#e8e2d8",
    tint: "#1bc99a",
    background: "#0f1116",
    foreground: "#e8e2d8",
    card: "#181c24",
    cardForeground: "#e8e2d8",
    primary: "#1bc99a",
    primaryForeground: "#091a13",
    secondary: "#1e2535",
    secondaryForeground: "#c8d0de",
    muted: "#1a2030",
    mutedForeground: "#9a9aaa",
    accent: "#0a2e24",
    accentForeground: "#1bc99a",
    destructive: "#ef4444",
    destructiveForeground: "#ffffff",
    border: "#242c3c",
    input: "#242c3c",
    sidebar: "#0f1116",
    sidebarForeground: "#e8e2d8",
    sidebarBorder: "#242c3c",
    sidebarPrimary: "#1bc99a",
    sidebarPrimaryForeground: "#091a13",
    sidebarMutedForeground: "#9a9aaa",
    success: "#10B981",
    successForeground: "#A7F3D0",
    successBackground: "#064E3B",
    warning: "#F59E0B",
    warningForeground: "#FDE68A",
    warningBackground: "#451A03",
    error: "#EF4444",
    errorForeground: "#FECACA",
    errorBackground: "#450A0A",
    info: "#3B82F6",
    infoForeground: "#BFDBFE",
    infoBackground: "#1E3A8A",
  },
  radius: 12,
};

export default colors;

// ── Ambient Dark palette (Phase 1) ─────────────────────────────────────────
// Used by the Ambient v1 experience layer. These tokens are intentionally
// separate from the light/dark system so the rest of the app is unaffected
// during the Phase 1–2 rollout. Phase 4 migrates the whole app to this palette.
export const ambientDark = {
  // Backgrounds — three-stop depth gradient (#0D1117 → #0A1628 → #051420)
  bgDeep: "#0D1117",
  bgMid: "#0A1628",
  bgDark: "#051420",

  // Primary accent — teal-400 (#2DD4BF)
  teal: "#2DD4BF",
  tealDim: "#1BC9A0",

  // Glow layers
  tealGlowIdle: "rgba(45,212,191,0.18)",
  tealGlowCharging: "rgba(45,212,191,0.38)",

  // Text
  textPrimary: "rgba(255,255,255,0.90)",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",

  // Glass surfaces
  glassBg: "rgba(255,255,255,0.05)",
  glassBgStrong: "rgba(255,255,255,0.08)",
  glassBorder: "rgba(255,255,255,0.10)",
  glassBorderSubtle: "rgba(255,255,255,0.06)",

  // Tab bar
  tabBarBg: "rgba(5,20,32,0.85)",
  tabBarBorder: "rgba(255,255,255,0.07)",

  // Status colours (carried from dark theme, adjusted for dark canvas)
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
} as const;

export type AmbientDarkPalette = typeof ambientDark;
