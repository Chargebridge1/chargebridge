const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Injects packaging resource options into android/app/build.gradle to fix
 * mergeReleaseJavaResource failures caused by duplicate META-INF entries from
 * okhttp3:logging-interceptor and org.jspecify:jspecify sharing the same
 * 'META-INF/versions/9/OSGI-INF/MANIFEST.MF' file.
 *
 * This runs during `expo prebuild`, so it survives EAS build's PREBUILD phase.
 */
module.exports = function withAndroidPackagingOptions(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes('META-INF/versions/9/OSGI-INF/MANIFEST.MF')) {
      return config;
    }

    const resourcesBlock = `        resources {
            // Fix mergeReleaseJavaResource: okhttp3 and jspecify share this path
            pickFirsts += [
                'META-INF/versions/9/OSGI-INF/MANIFEST.MF',
                'kotlin-tooling-metadata.json',
                '**/*.kotlin_module'
            ]
            excludes += [
                'META-INF/AL2.0',
                'META-INF/LGPL2.1',
                'META-INF/NOTICE.md',
                'META-INF/LICENSE.md',
                'META-INF/NOTICE',
                'META-INF/LICENSE',
                'META-INF/DEPENDENCIES',
                'DebugProbesKt.bin'
            ]
        }
        jniLibs {`;

    contents = contents.replace(
      /(\s*packagingOptions\s*\{[^}]*jniLibs\s*\{)/,
      (match) => match.replace('jniLibs {', resourcesBlock)
    );

    config.modResults.contents = contents;
    return config;
  });
};
