export { colors } from "./colors";
export type { ColorMode, ColorTokens } from "./colors";

export { typography } from "./typography";
export { spacing } from "./spacing";
export type { SpacingKey } from "./spacing";

export { radius } from "./radius";
export type { RadiusKey } from "./radius";

export { elevation } from "./elevation";
export { animation } from "./animation";
export { iconography } from "./iconography";
export type { IconSize } from "./iconography";

export { opacity } from "./opacity";
export type { OpacityKey } from "./opacity";

export { zIndex } from "./z-index";
export type { ZIndexKey } from "./z-index";

import { colors } from "./colors";
import { typography } from "./typography";
import { spacing } from "./spacing";
import { radius } from "./radius";
import { elevation } from "./elevation";
import { animation } from "./animation";
import { iconography } from "./iconography";
import { opacity } from "./opacity";
import { zIndex } from "./z-index";

export const tokens = {
  colors,
  typography,
  spacing,
  radius,
  elevation,
  animation,
  iconography,
  opacity,
  zIndex,
} as const;
