export const iconography = {
  size: {
    xs:   12,
    sm:   16,
    base: 20,
    lg:   24,
    xl:   28,
    "2xl":32,
    "3xl":40,
    "4xl":48,
  },

  strokeWidth: {
    thin:    1,
    regular: 1.5,
    medium:  2,
    bold:    2.5,
  },
} as const;

export type IconSize = keyof typeof iconography.size;
