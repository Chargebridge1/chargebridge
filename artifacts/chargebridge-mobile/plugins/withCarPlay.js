const { withInfoPlist } = require("@expo/config-plugins");

/**
 * Expo config plugin for Apple CarPlay support.
 *
 * Adds the CPTemplateApplicationScene entry to UIApplicationSceneManifest
 * so iOS routes CarPlay connections to the library's native delegate.
 *
 * NOTE: CarPlay entitlements (com.apple.developer.carplay-ev-charging /
 * com.apple.developer.carplay-navigation) must be requested from Apple at
 * https://developer.apple.com/contact/carplay/ and then added to
 * ios.entitlements in app.json AFTER Apple approves them. The app behaves
 * normally on iPhone without the entitlements — CarPlay UI only appears
 * once they are granted.
 */
const withCarPlay = (config) => {
  config = withInfoPlist(config, (mod) => {
    const manifest = mod.modResults.UIApplicationSceneManifest || {};

    manifest.UIApplicationSupportsMultipleScenes = true;

    const scenes = manifest.UISceneConfigurations || {};

    // CarPlay scene — handled by react-native-carplay's native delegate
    scenes.CPTemplateApplicationSceneSessionRoleApplication = [
      {
        UISceneConfigurationName: "CarPlay Configuration",
        UISceneClassName: "CPTemplateApplicationScene",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate",
      },
    ];

    manifest.UISceneConfigurations = scenes;
    mod.modResults.UIApplicationSceneManifest = manifest;

    return mod;
  });

  return config;
};

module.exports = withCarPlay;
