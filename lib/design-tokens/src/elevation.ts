export const elevation = {
  web: {
    0: "none",
    1: "0px 1px 3px 0px rgba(0,0,0,0.08)",
    2: "0px 2px 4px 0px rgba(0,0,0,0.08), 0px 1px 2px -1px rgba(0,0,0,0.06)",
    3: "0px 4px 6px -1px rgba(0,0,0,0.08), 0px 2px 4px -2px rgba(0,0,0,0.05)",
    4: "0px 10px 15px -3px rgba(0,0,0,0.08), 0px 4px 6px -4px rgba(0,0,0,0.05)",
  },
  webDark: {
    0: "none",
    1: "0px 1px 3px 0px rgba(0,0,0,0.35)",
    2: "0px 2px 4px 0px rgba(0,0,0,0.35), 0px 1px 2px -1px rgba(0,0,0,0.25)",
    3: "0px 4px 6px -1px rgba(0,0,0,0.35), 0px 2px 4px -2px rgba(0,0,0,0.25)",
    4: "0px 10px 15px -3px rgba(0,0,0,0.35), 0px 4px 6px -4px rgba(0,0,0,0.25)",
  },
  native: {
    0: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    1: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    2: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
      elevation: 4,
    },
    3: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 8,
    },
    4: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 20,
      elevation: 16,
    },
  },
} as const;
