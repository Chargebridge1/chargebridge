const light = {
  brand: {
    primary:     "hsl(168, 80%, 38%)",
    primaryHover:"hsl(168, 80%, 33%)",
    glow:        "hsla(168, 80%, 38%, 0.15)",
    dim:         "hsl(158, 55%, 88%)",
    onPrimary:   "hsl(0, 0%, 100%)",
  },
  bg: {
    primary:   "hsl(40, 27%, 96%)",
    secondary: "hsl(40, 50%, 99%)",
    tertiary:  "hsl(38, 24%, 90%)",
    canvas:    "hsl(210, 30%, 96%)",   // #f2f5f8 — neutral loading / auth background
  },
  text: {
    primary:   "hsl(213, 30%, 15%)",
    secondary: "hsl(36, 9%, 44%)",
    tertiary:  "hsl(36, 9%, 60%)",
  },
  border: {
    default: "hsl(35, 15%, 86%)",
    subtle:  "hsl(35, 18%, 89%)",
    brand:   "hsl(168, 60%, 72%)",
  },
  status: {
    success: "hsl(142, 71%, 40%)",
    warning: "hsl(38, 92%, 50%)",
    error:   "hsl(0, 84%, 58%)",
    info:    "hsl(199, 80%, 48%)",
  },
  sidebar: {
    bg:      "hsl(219, 27%, 15%)",
    text:    "hsl(38, 18%, 88%)",
    primary: "hsl(167, 79%, 48%)",
    border:  "hsl(218, 21%, 19%)",
  },
} as const;

const dark = {
  brand: {
    primary:     "hsl(160, 70%, 45%)",
    primaryHover:"hsl(160, 70%, 40%)",
    glow:        "hsla(160, 70%, 45%, 0.15)",
    dim:         "hsl(161, 66%, 11%)",
    onPrimary:   "hsl(155, 35%, 8%)",
  },
  bg: {
    primary:   "hsl(230, 15%, 8%)",
    secondary: "hsl(224, 19%, 12%)",
    tertiary:  "hsl(222, 29%, 16%)",
  },
  text: {
    primary:   "hsl(38, 21%, 87%)",
    secondary: "hsl(240, 7%, 58%)",
    tertiary:  "hsl(240, 7%, 42%)",
  },
  border: {
    default: "hsl(221, 24%, 19%)",
    subtle:  "hsl(221, 24%, 22%)",
    brand:   "hsl(160, 50%, 28%)",
  },
  status: {
    success: "hsl(142, 71%, 45%)",
    warning: "hsl(38, 92%, 55%)",
    error:   "hsl(0, 84%, 65%)",
    info:    "hsl(199, 80%, 55%)",
  },
  sidebar: {
    bg:      "hsl(230, 15%, 8%)",
    text:    "hsl(38, 21%, 87%)",
    primary: "hsl(160, 70%, 45%)",
    border:  "hsl(221, 24%, 19%)",
  },
  tabBar: {
    activeTint:      "hsl(0, 0%, 100%)",       // #ffffff — active icon tint
    blurOverlay:     "rgba(5, 20, 32, 0.80)",  // dark navy at 80% — blur overlay tint
    ctaSurface:      "hsl(0, 0%, 100%)",        // #ffffff — Charge CTA button bg
    ctaSurfacePress: "hsl(0, 0%, 94%)",         // #f0f0f0 — Charge CTA pressed state
    ctaIcon:         "hsl(0, 0%, 0%)",          // #000000 — icon on Charge CTA button
    navPillSurface:  "hsl(0, 0%, 100%)",        // #ffffff — Map active pill bg
    navPillIcon:     "hsl(0, 0%, 0%)",          // #000000 — icon on active nav pill
    shadowColor:     "hsl(0, 0%, 100%)",        // #ffffff — CTA glow shadow colour
  },
} as const;

export const colors = { light, dark } as const;

export type ColorMode = "light" | "dark";
export type ColorTokens = typeof light;
