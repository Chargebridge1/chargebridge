export const opacity = {
  0:   0,
  5:   0.05,
  10:  0.10,
  15:  0.15,
  20:  0.20,
  25:  0.25,
  30:  0.30,
  40:  0.40,
  50:  0.50,
  60:  0.60,
  70:  0.70,
  75:  0.75,
  80:  0.80,
  90:  0.90,
  95:  0.95,
  100: 1,
} as const;

export type OpacityKey = keyof typeof opacity;
