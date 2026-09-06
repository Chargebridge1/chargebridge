export const typography = {
  fontFamily: {
    sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
    mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"],
  },

  size: {
    "2xs": "0.625rem",
    xs:    "0.75rem",
    sm:    "0.875rem",
    base:  "1rem",
    lg:    "1.125rem",
    xl:    "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
    "5xl": "3rem",
  },

  sizePx: {
    "2xs": 10,
    xs:    12,
    sm:    14,
    base:  16,
    lg:    18,
    xl:    20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
    "5xl": 48,
  },

  weight: {
    light:    "300",
    normal:   "400",
    medium:   "500",
    semibold: "600",
    bold:     "700",
  },

  weightNum: {
    light:    300,
    normal:   400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },

  lineHeight: {
    none:    "1",
    tight:   "1.25",
    snug:    "1.375",
    base:    "1.5",
    relaxed: "1.625",
    loose:   "2",
  },

  letterSpacing: {
    tighter: "-0.05em",
    tight:   "-0.025em",
    normal:  "0em",
    wide:    "0.025em",
    wider:   "0.05em",
    widest:  "0.1em",
  },
} as const;
