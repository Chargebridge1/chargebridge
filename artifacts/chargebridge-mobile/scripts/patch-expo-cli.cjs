'use strict';
const fs = require('fs');
const path = require('path');

let expoCliDir;
try {
  expoCliDir = path.dirname(
    require.resolve('@expo/cli/package.json', {
      paths: [__dirname, path.join(__dirname, '..')]
    })
  );
} catch {
  console.log('[patch-expo-cli] @expo/cli not found — skipping');
  process.exit(0);
}

const TARGET = path.join(
  expoCliDir,
  'build/src/start/server/metro/instantiateMetro.js'
);

if (!fs.existsSync(TARGET)) {
  console.log('[patch-expo-cli] instantiateMetro.js not found — skipping');
  process.exit(0);
}

let content = fs.readFileSync(TARGET, 'utf8');

// --- Marker: already has null-check patch ---
const MARKER = 'const _innerBundler = metro.getBundler() && metro.getBundler().getBundler';
if (content.includes(MARKER)) {
  console.log('[patch-expo-cli] null-check patch already applied — skipping');
  process.exit(0);
}

// --- Target region: the entire getBundler block (covers both unpatched and old metro.ready-patched versions) ---
// This anchors on the comment line and everything up through patchTransformFileForPackedMaps.
const REGION_START = '    // Patch transform file to remove inconvenient customTransformOptions which are only used in single well-known files.\n';
const REGION_END   = '(0, _packedMap().patchTransformFileForPackedMaps)(metro.getBundler().getBundler());';

const startIdx = content.indexOf(REGION_START);
const endIdx   = content.indexOf(REGION_END);

if (startIdx === -1 || endIdx === -1) {
  console.log('[patch-expo-cli] target region not found (package version changed?) — skipping');
  process.exit(0);
}

const before   = content.slice(0, startIdx);
const after    = content.slice(endIdx + REGION_END.length);

const NULL_CHECK_PATCH =
  '    // Patch transform file to remove inconvenient customTransformOptions which are only used in single well-known files.\n' +
  '    // Guarded: inner bundler may not be initialized when waitForBundler:false / isExporting:true\n' +
  '    const _innerBundler = metro.getBundler() && metro.getBundler().getBundler ? metro.getBundler().getBundler() : null;\n' +
  '    if (_innerBundler) {\n' +
  '        const originalTransformFile = _innerBundler.transformFile.bind(_innerBundler);\n' +
  '        _innerBundler.transformFile = async function(filePath, transformOptions, fileBuffer) {\n' +
  '            return originalTransformFile(filePath, pruneCustomTransformOptions(projectRoot, filePath, // Clone the options so we don\'t mutate the original.\n' +
  '            {\n' +
  '                ...transformOptions,\n' +
  '                customTransformOptions: {\n' +
  '                    __proto__: null,\n' +
  '                    ...transformOptions.customTransformOptions\n' +
  '                }\n' +
  '            }), fileBuffer);\n' +
  '        };\n' +
  '        // Layered on top of the prune patch above. Both fresh worker results\n' +
  '        // and cache hits flow through `Bundler.transformFile`, so wrapping\n' +
  '        // here covers both.\n' +
  '        (0, _packedMap().patchTransformFileForPackedMaps)(_innerBundler);\n' +
  '    }';

const patched  = before + NULL_CHECK_PATCH + after;
const tmpPath  = TARGET + '.patch-tmp';
fs.writeFileSync(tmpPath, patched, 'utf8');
fs.renameSync(tmpPath, TARGET);
console.log('[patch-expo-cli] null-check patch applied to', TARGET);
