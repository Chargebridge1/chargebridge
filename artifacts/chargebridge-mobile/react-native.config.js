/**
 * Exclude iOS-only packages from Android autolinking.
 *
 * - react-native-carplay: uses androidx.car.app beta libs; iOS-only for now
 * - expo-glass-effect: iOS-only (no android/ dir); uses iOS Liquid Glass APIs
 * - expo-symbols: iOS-only (SF Symbols); no Android native code
 *
 * All of these are guarded by Platform.OS === "ios" checks in app code so
 * Android runtime behaviour is unaffected.
 */
module.exports = {
  dependencies: {
    "react-native-carplay": {
      platforms: { android: null },
    },
    "expo-glass-effect": {
      platforms: { android: null },
    },
    "expo-symbols": {
      platforms: { android: null },
    },
  },
};
