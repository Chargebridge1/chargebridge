// ─────────────────────────────────────────────────────────────────────────────
// Nav Pill Definitions — source of truth for all tab bar pill metadata.
// ─────────────────────────────────────────────────────────────────────────────

export type PillId = "home" | "map" | "charge" | "activity" | "account";

export interface NavPillDef {
  id: PillId;
  /** expo-router href */
  route: string;
  /** Display label used in the edit sheet */
  label: string;
  /** iOS SF Symbol name */
  sfSymbol: string;
  /** @expo/vector-icons Feather icon name */
  featherIcon: string;
  /**
   * Pinned pills are always visible — cannot be toggled off.
   * The Charge CTA is pinned because it is the primary conversion action.
   */
  isPinned: boolean;
}

export const NAV_PILLS: Record<PillId, NavPillDef> = {
  home: {
    id: "home",
    route: "/(tabs)/home",
    label: "Home",
    sfSymbol: "house.fill",
    featherIcon: "home",
    isPinned: false,
  },
  map: {
    id: "map",
    route: "/(tabs)/map",
    label: "Map",
    sfSymbol: "location.fill",
    featherIcon: "navigation",
    isPinned: false,
  },
  charge: {
    id: "charge",
    route: "/(tabs)/charge",
    label: "Charge",
    sfSymbol: "bolt.fill",
    featherIcon: "zap",
    isPinned: true,
  },
  activity: {
    id: "activity",
    route: "/(tabs)/activity",
    label: "Activity",
    sfSymbol: "clock.fill",
    featherIcon: "clock",
    isPinned: false,
  },
  account: {
    id: "account",
    route: "/(tabs)/account",
    label: "Account",
    sfSymbol: "person.circle.fill",
    featherIcon: "user",
    isPinned: false,
  },
} as const;

export const ALL_PILL_IDS: PillId[] = [
  "home",
  "map",
  "charge",
  "activity",
  "account",
];

export const DEFAULT_ORDER: PillId[] = [
  "home",
  "map",
  "charge",
  "activity",
  "account",
];

export const DEFAULT_HIDDEN: PillId[] = [];

export interface NavPillLayout {
  order: PillId[];
  hidden: PillId[];
  /**
   * Unix-ms timestamp of when this layout was last saved.
   * Used by Phase 2 server hydration to avoid overwriting a newer local
   * layout with a stale server copy (cross-device race condition).
   * Optional for backward-compat with layouts saved before this field existed.
   */
  savedAt?: number;
}

export const DEFAULT_LAYOUT: NavPillLayout = {
  order: DEFAULT_ORDER,
  hidden: DEFAULT_HIDDEN,
};

/**
 * Coerce a potentially stale persisted layout into a valid one.
 * - Adds any new pills not yet in the saved order
 * - Strips unknown IDs
 * - Prevents pinned pills from being hidden
 */
export function normalizeLayout(
  raw: Partial<NavPillLayout> | undefined,
): NavPillLayout {
  const rawOrder = (raw?.order ?? []).filter(
    (id): id is PillId => id in NAV_PILLS,
  );
  const order: PillId[] = [...rawOrder];
  for (const id of ALL_PILL_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden = (raw?.hidden ?? []).filter(
    (id): id is PillId => id in NAV_PILLS && !NAV_PILLS[id].isPinned,
  );
  // Preserve savedAt so Phase 2 can compare timestamps across devices.
  return { order, hidden, ...(raw?.savedAt != null ? { savedAt: raw.savedAt } : {}) };
}

/** Return pills that appear in the tab bar: pinned or not hidden. */
export function resolveVisiblePills(layout: NavPillLayout): PillId[] {
  return layout.order.filter(
    (id) => NAV_PILLS[id].isPinned || !layout.hidden.includes(id),
  );
}

/**
 * Minimum number of visible (non-hidden) optional pills the user must keep.
 * Charge (pinned) + at least 1 optional = 2 minimum total.
 */
export const MIN_OPTIONAL_VISIBLE = 1;
