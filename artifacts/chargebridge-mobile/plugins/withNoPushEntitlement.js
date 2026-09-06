const { withEntitlementsPlist, withInfoPlist } = require('@expo/config-plugins');

/**
 * Removes push-notification-related entitlements and background modes
 * that Expo prebuild injects automatically (e.g. triggered by background
 * location usage strings in infoPlist). The "ChargeBridge AppStore Replit"
 * provisioning profile does not include Push Notifications capability,
 * so these entitlements must be absent from the final binary.
 *
 * This plugin runs LAST so it overrides whatever earlier plugins injected.
 */
function withNoPushEntitlement(config) {
  config = withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    delete c.modResults['com.apple.developer.usernotifications.communication'];
    delete c.modResults['com.apple.developer.usernotifications.filtering'];
    return c;
  });

  config = withInfoPlist(config, (c) => {
    const modes = c.modResults['UIBackgroundModes'];
    if (Array.isArray(modes)) {
      c.modResults['UIBackgroundModes'] = modes.filter(
        (m) => m !== 'remote-notification'
      );
      if (c.modResults['UIBackgroundModes'].length === 0) {
        delete c.modResults['UIBackgroundModes'];
      }
    }
    return c;
  });

  return config;
}

module.exports = withNoPushEntitlement;
