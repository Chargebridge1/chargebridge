// ─────────────────────────────────────────────────────────────────────────────
// ChargeBridge Ambient v1 — Motion Specification (Phase 0)
// ─────────────────────────────────────────────────────────────────────────────
// ALL animation values across the app must reference this file.
// No hardcoded durations, spring configs, or opacity ramps are permitted
// outside of this module. Violations block the Phase 6 motion audit.

// ── Duration tokens (ms) ─────────────────────────────────────────────────────
export const Duration = {
  /** Micro-interactions: icon swaps, badge updates */
  fast: 150,
  /** Standard transitions: card appear/disappear, state changes */
  base: 300,
  /** Deliberate reveals: panel slide-up, modal entrance */
  slow: 500,
  /** Hero morphs: Idle → Charging → Complete state machine */
  hero: 600,
  /** Idle pulse ring: one full cycle at rest */
  pulse: 3000,
  /** Charging pulse ring: minimum cycle (full power) */
  pulseMin: 800,
} as const;

// ── Spring presets (react-native-reanimated withSpring config) ────────────────
export const Spring = {
  /** Quick snappy response — button press, badge tap */
  snappy: { mass: 0.5, stiffness: 300, damping: 25 },
  /** Standard feel — card expand, list reorder */
  base: { mass: 1, stiffness: 200, damping: 20 },
  /** Gentle settle — panel open, sheet snap */
  gentle: { mass: 1, stiffness: 120, damping: 22 },
  /** Hero morph — state machine transitions */
  hero: { mass: 1.2, stiffness: 150, damping: 18 },
  /** Playful bounce — success states, completion badge */
  bouncy: { mass: 0.8, stiffness: 250, damping: 15 },
} as const;

// ── Timing easing presets (cubic-bezier coefficients) ────────────────────────
// Use with react-native-reanimated Easing.bezier(x1, y1, x2, y2)
export const Bezier = {
  /** Expo ease-out — matches CSS slide-up animation */
  easeOut: [0.16, 1, 0.3, 1] as const,
  /** Standard ease-in — elements leaving the screen */
  easeIn: [0.4, 0, 1, 1] as const,
  /** Material standard — elements moving across the screen */
  standard: [0.4, 0, 0.2, 1] as const,
} as const;

// ── Glow contracts ─────────────────────────────────────────────────────────
export const Glow = {
  /** Soft ambient background glow behind vehicle silhouette (px) */
  ambientBlurRadius: 80,
  /** Hero charging arc outer glow radius (px) */
  heroBlurRadius: 120,
  /** Pulse ring maximum outward spread (px) */
  pulseMaxSpread: 40,
  /** Teal glow opacity per state */
  opacity: {
    idle: 0.18,
    charging: 0.38,
    peak: 0.60,
  },
  /** Teal glow colour (rgba base) */
  color: {
    r: 45, g: 212, b: 191, // #2DD4BF = teal-400
  },
} as const;

// ── Hero morph specification ───────────────────────────────────────────────
// One AmbientHero component drives three states.
// Content morphs in place — no screen transitions, no banners.
export const HeroMorph = {
  /** Duration for state content cross-fade (ms) */
  contentFadeDuration: Duration.base,
  /** Spring for metric number counter entrance */
  numberEntrance: Spring.hero,
  /** Duration for number count-up animation (ms) */
  numberCountDuration: Duration.slow,
  /** Duration for glow intensity transition (ms) */
  glowTransitionDuration: Duration.base,
  /** Scale bounce when entering Complete state */
  completionBounce: Spring.bouncy,
  /** Opacity for elements exiting during state transition */
  exitOpacity: 0,
  /** Opacity for elements entering during state transition */
  enterOpacity: 1,
} as const;

// ── Charging pulse formula ────────────────────────────────────────────────
// Pulse ring animation speed and glow intensity scale with live kW output.
// Min 1 kW → slow idle-like pulse. Max 350 kW → fast energetic pulse.

/**
 * Returns the pulse ring cycle duration (ms) for a given power output.
 * At 0 kW or null: idle pulse (Duration.pulse = 3000ms)
 * At 350 kW:       maximum speed pulse (Duration.pulseMin = 800ms)
 */
export function chargingPulseDuration(powerKw: number | null): number {
  if (!powerKw || powerKw <= 0) return Duration.pulse;
  const minKw = 1, maxKw = 350;
  const clamped = Math.min(Math.max(powerKw, minKw), maxKw);
  const t = (clamped - minKw) / (maxKw - minKw);
  return Math.round(Duration.pulse - t * (Duration.pulse - Duration.pulseMin));
}

/**
 * Returns the teal glow background opacity for a given power output.
 * 0 kW → Glow.opacity.idle. 350 kW → Glow.opacity.peak.
 */
export function chargingGlowOpacity(powerKw: number | null): number {
  if (!powerKw || powerKw <= 0) return Glow.opacity.idle;
  const clamped = Math.min(powerKw, 350);
  const t = clamped / 350;
  return Glow.opacity.idle + t * (Glow.opacity.peak - Glow.opacity.idle);
}

// ── Glass surface ──────────────────────────────────────────────────────────
export const Glass = {
  /** expo-blur intensity value */
  blurIntensity: 20,
  /** Glass card background opacity (rgba white) */
  backgroundOpacity: 0.05,
  /** Glass card border opacity (rgba white) */
  borderOpacity: 0.10,
  /** Drag handle opacity */
  handleOpacity: 0.20,
} as const;

// ── Page transitions ───────────────────────────────────────────────────────
export const PageTransition = {
  /** Content panel slide-up on dashboard mount */
  slideUp: { duration: Duration.slow },
  /** Standard screen fade-in */
  fadeIn: { duration: Duration.base },
} as const;

// ── Press feedback ─────────────────────────────────────────────────────────
export const PressScale = {
  /** Scale factor during press */
  activeScale: 0.96,
  /** Scale factor during card tap (larger target) */
  cardScale: 0.98,
  /** Spring to use for all press animations */
  spring: Spring.snappy,
} as const;

// ── Tab bar ────────────────────────────────────────────────────────────────
export const TabBar = {
  /** Background blur intensity */
  blurIntensity: 22,
  /** Border opacity at top edge */
  borderOpacity: 0.07,
  /** Inactive icon opacity */
  inactiveOpacity: 0.45,
  /** Centre CTA elevation above tab bar (px) */
  ctaElevation: 10,
  /** Centre CTA shadow glow radius */
  ctaShadowRadius: 18,
} as const;

// ── Nav pill edit mode ──────────────────────────────────────────────────────
export const NavPillEdit = {
  /** Row height in the edit sheet (px) */
  rowHeight: 64,
  /** Vertical spacing between rows (px) */
  rowGap: 6,
  /** Scale applied to the row being dragged */
  liftedScale: 1.03,
  /** Shadow opacity for the lifted row */
  liftedShadowOpacity: 0.28,
  /** Shadow blur radius for the lifted row */
  liftedShadowRadius: 14,
  /** Minimum Y movement (px) before the pan gesture activates */
  panActivationThreshold: 4,
  /** Long-press delay before entering edit mode from the tab bar (ms) */
  longPressDelayMs: 500,
  /** Sheet slide-in spring — gentle settle */
  sheetSpring: Spring.gentle,
  /** Spring used for row position shifts during drag */
  rowSpring: Spring.base,
} as const;
