/**
 * CarPlay stub for Android/Web.
 *
 * On iOS, Metro resolves CarPlayService.ios.ts instead, which contains the
 * full react-native-carplay implementation. This file is used on Android and
 * Web where CarPlay is not available — all functions are no-ops.
 */

export function initCarPlay(): void {}
export function cleanupCarPlay(): void {}
export function updateCarPlayLocation(_loc: {
  latitude: number;
  longitude: number;
}): void {}
