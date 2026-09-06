import { useColorScheme } from "react-native";
import colors from "@/constants/colors";
import { useIsAmbient } from "@/contexts/AmbientTheme";

/**
 * Returns the design tokens for the current colour scheme.
 *
 * Priority order:
 *  1. AmbientThemeContext — when inside an AmbientThemeProvider (the Ambient
 *     dark glass panel on the Dashboard), always returns the dark palette so
 *     Card, Surface, Typography etc. render correctly on the dark surface.
 *  2. Device system setting — dark → dark palette, light → light palette.
 *  3. Fallback — light palette when neither condition is met.
 */
export function useColors() {
  const scheme = useColorScheme();
  const isAmbient = useIsAmbient();
  const useDark = isAmbient || (scheme === "dark" && "dark" in colors);
  const palette = useDark
    ? ((colors as unknown) as Record<string, typeof colors.light>).dark
    : colors.light;
  return { ...palette, radius: colors.radius };
}
