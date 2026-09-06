export const animation = {
  duration: {
    instant:  0,
    fast:     150,
    base:     250,
    slow:     400,
    slower:   600,
    slowest:  800,
  },

  easing: {
    linear:       "linear",
    easeIn:       "cubic-bezier(0.4, 0, 1, 1)",
    easeOut:      "cubic-bezier(0, 0, 0.2, 1)",
    easeInOut:    "cubic-bezier(0.4, 0, 0.2, 1)",
    spring:       "cubic-bezier(0.34, 1.56, 0.64, 1)",
    decelerate:   "cubic-bezier(0, 0, 0.2, 1)",
    accelerate:   "cubic-bezier(0.4, 0, 1, 1)",
  },

  easingNative: {
    linear:    "linear" as const,
    easeIn:    "ease-in" as const,
    easeOut:   "ease-out" as const,
    easeInOut: "ease-in-out" as const,
  },
} as const;
