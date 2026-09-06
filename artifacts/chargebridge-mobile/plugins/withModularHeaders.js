const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * ClerkGoogleSignIn -> GoogleSignIn -> AppCheckCore (Swift static lib).
 * AppCheckCore imports GoogleUtilities and RecaptchaInterop from Swift, so
 * those ObjC pods must generate module maps (DEFINES_MODULE=YES).
 *
 * We use withDangerousMod (NOT withPodfile) because withDangerousMod runs
 * after all base mods have flushed their results to disk, guaranteeing the
 * generated Podfile exists. withPodfile can receive a null modResults when
 * EAS clears and reinitialises the ios directory during prebuild.
 *
 * We use targeted per-pod declarations rather than global use_modular_headers!
 * because the global flag re-generates a module map for React-RuntimeHermes
 * (which already has one), causing "Redefinition of module 'react_runtime'"
 * compile errors.
 */
function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile'
      );

      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Idempotency check — skip if already patched
      if (podfile.includes(":modular_headers => true")) {
        return config;
      }

      // Inject right after use_expo_modules! inside the target block.
      // use_expo_modules! is always present in the generated Podfile.
      const marker = 'use_expo_modules!';
      if (!podfile.includes(marker)) {
        return config;
      }

      podfile = podfile.replace(
        marker,
        [
          marker,
          "  # ClerkGoogleSignIn -> GoogleSignIn -> AppCheckCore (Swift static lib)",
          "  # needs these ObjC pods to generate module maps for Swift imports:",
          "  pod 'GoogleUtilities', :modular_headers => true",
          "  pod 'RecaptchaInterop', :modular_headers => true",
        ].join('\n')
      );

      fs.writeFileSync(podfilePath, podfile, 'utf8');
      return config;
    },
  ]);
}

module.exports = withModularHeaders;
