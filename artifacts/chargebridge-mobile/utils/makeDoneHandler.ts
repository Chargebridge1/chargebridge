/**
 * makeDoneHandler — factory for the onDone callback passed to EditableTabBar.
 *
 * Critical ordering guarantee:
 *   exitEditMode() runs SYNCHRONOUSLY before `void savePillLayout(order, hidden)` fires.
 *
 * This means the edit sheet is already unmounted before the PATCH starts,
 * so any save error toast appears on the screen the user has navigated to —
 * not inside a sheet that is already gone.
 *
 * Extracted into its own module so it can be unit-tested without importing
 * React Native (CustomTabBar.tsx pulls in native modules that Jest cannot
 * parse without a full React Native test environment).
 */
import { PillId } from "../constants/navPills";

export function makeDoneHandler(
  exitEditMode: () => void,
  savePillLayout: (order: PillId[], hidden: PillId[]) => Promise<void>,
): (order: PillId[], hidden: PillId[]) => Promise<void> {
  return (order, hidden) => {
    exitEditMode();
    void savePillLayout(order, hidden);
    return Promise.resolve();
  };
}
