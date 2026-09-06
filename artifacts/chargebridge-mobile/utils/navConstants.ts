/**
 * Shared navigation constants used by backgroundNav.ts and its tests.
 *
 * Kept in a separate module so the test suite can import constants without
 * pulling in react-native / expo-task-manager / expo-location, which are
 * unavailable in the Jest environment.
 */

/**
 * Distance to destination (in metres) at which the arrival notification fires
 * and navigation is considered complete.
 *
 * INVARIANT: ARRIVAL_GATE_METERS must always be strictly less than the maximum
 * value returned by navStepThreshold() (currently 65 m at highway speed
 * > 50 mph).  If this constant is raised above the highway threshold, the
 * step-advance block will no longer run before the arrival check on the final
 * approach, causing the final-turn push notification to be silently skipped.
 *
 * See __tests__/backgroundNavThreshold.test.ts (Suite 12) for an automated
 * assertion that enforces this ordering invariant.
 */
export const ARRIVAL_GATE_METERS = 60;
