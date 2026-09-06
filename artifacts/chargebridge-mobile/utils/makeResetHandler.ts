/**
 * makeResetHandler — factory for the onReset callback passed to EditableTabBar.
 *
 * Critical ordering guarantee:
 *   exitEditMode() runs SYNCHRONOUSLY before `void resetToDefault()` fires.
 *
 * This means the edit sheet is already unmounted before the PATCH starts,
 * so any save error toast appears on the screen the user has navigated to —
 * not inside a sheet that is already gone.
 *
 * Extracted into its own module so it can be unit-tested without importing
 * React Native (CustomTabBar.tsx pulls in native modules that Jest cannot
 * parse without a full React Native test environment).
 */
export function makeResetHandler(
  exitEditMode: () => void,
  resetToDefault: () => Promise<void>,
): () => Promise<void> {
  return () => {
    exitEditMode();
    void resetToDefault();
    return Promise.resolve();
  };
}
