/**
 * Thin AsyncStorage wrappers for NavPillLayout persistence.
 * Extracted from NavPillContext so they can be unit-tested in isolation
 * without a React rendering environment.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavPillLayout, normalizeLayout } from "@/constants/navPills";

export const NAV_PILL_STORAGE_KEY = "CB_NAV_PILL_LAYOUT_V1";

/**
 * Read the persisted layout from AsyncStorage.
 * Returns null on a cache-miss or any parse / storage error.
 */
export async function readLocal(): Promise<NavPillLayout | null> {
  try {
    const raw = await AsyncStorage.getItem(NAV_PILL_STORAGE_KEY);
    return raw ? normalizeLayout(JSON.parse(raw) as Partial<NavPillLayout>) : null;
  } catch {
    return null;
  }
}

/**
 * Persist a layout to AsyncStorage.
 * Returns true on success, false if the write fails for any reason.
 */
export async function writeLocal(layout: NavPillLayout): Promise<boolean> {
  try {
    await AsyncStorage.setItem(NAV_PILL_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}
