export const zIndex = {
  below:    -1,
  base:      0,
  raised:    1,
  dropdown:  10,
  sticky:    20,
  overlay:   30,
  modal:     40,
  toast:     50,
  tooltip:   60,
} as const;

export type ZIndexKey = keyof typeof zIndex;
