const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Injects the Google Maps API key into AndroidManifest.xml.
 *
 * The key is read from the GOOGLE_MAPS_API_KEY environment variable,
 * which should be set as an EAS secret or environment variable in eas.json.
 *
 * To get a free key:
 * 1. Go to https://console.cloud.google.com/
 * 2. Enable "Maps SDK for Android"
 * 3. Create an API key
 * 4. Add it to your EAS project: eas secret:create GOOGLE_MAPS_API_KEY
 */
const withAndroidMaps = (config) => {
  return withAndroidManifest(config, (mod) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || "";

    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;

    if (!app["meta-data"]) app["meta-data"] = [];

    // Remove any existing Google Maps key entry
    app["meta-data"] = app["meta-data"].filter(
      (m) => m.$?.["android:name"] !== "com.google.android.geo.API_KEY"
    );

    // Inject the key (placeholder if not set — shows watermarked map on device)
    app["meta-data"].push({
      $: {
        "android:name": "com.google.android.geo.API_KEY",
        "android:value": apiKey || "REPLACE_WITH_YOUR_GOOGLE_MAPS_API_KEY",
      },
    });

    return mod;
  });
};

module.exports = withAndroidMaps;
