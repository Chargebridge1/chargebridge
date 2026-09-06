import React, { createContext, useContext } from "react";

/**
 * AmbientThemeContext — forces the dark colour palette for all child components
 * that call useColors(). Used to make existing Card/Surface/Typography components
 * render correctly inside the Ambient dark glass panel without requiring any
 * changes to those components individually.
 *
 * Phase 4 (Ambient Content Panels) uses this to wrap ContentPanel in dashboard.tsx.
 * Phase 7 may extend this to pass the full ambientDark token set if needed.
 */
const AmbientThemeContext = createContext(false);

export function AmbientThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <AmbientThemeContext.Provider value={true}>
      {children}
    </AmbientThemeContext.Provider>
  );
}

/** Returns true when rendered inside an AmbientThemeProvider. */
export function useIsAmbient(): boolean {
  return useContext(AmbientThemeContext);
}
