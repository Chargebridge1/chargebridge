#!/usr/bin/env node
/**
 * check-lockfile-sync.cjs
 *
 * Checks that pnpm-lock.yaml is in sync with the workspace configuration by
 * parsing the lockfile's `importers`, `catalogs`, and `overrides` sections
 * directly against the live workspace source files.
 *
 * Unlike `pnpm install --frozen-lockfile`, this script:
 *   • requires no pnpm cache and no full node_modules installation
 *   • completes in ~1 second regardless of environment state (cold or warm)
 *   • is entirely network-free and deterministic
 *
 * Prerequisite: `yaml@2.9.0` (transitive dep of vite in this workspace) must be
 * resolvable from the pnpm virtual store at node_modules/.pnpm/.  `pnpm install`
 * satisfies this; it does not require hoisting or a full node_modules tree.
 *
 * Usage:
 *   node check-lockfile-sync.cjs [workspace-root]
 *
 *   workspace-root defaults to three levels up from this script's __dirname,
 *   which is the monorepo root when the script lives at
 *   artifacts/chargebridge-mobile/scripts/.
 *
 * Environment:
 *   LOCKFILE_GATE_WORKSPACE_ROOT — override for workspace root (used by tests)
 *
 * Exit codes:
 *   0 — lockfile is in sync with all workspace config
 *   1 — mismatch found, lockfile/workspace config absent or unreadable, or
 *       any other configuration error
 *
 * ── What is checked ──────────────────────────────────────────────────────────
 *
 * Step 1 — Workspace member check (bidirectional):
 *   Enumerates workspace members from pnpm-workspace.yaml globs plus the root
 *   ".".  Every member must have a lockfile importers entry, and vice versa.
 *   Fails closed when the lockfile has no importers: section.
 *
 * Step 2 — Overrides check (bidirectional):
 *   Compares the complete live override map (root package.json → pnpm.overrides
 *   merged with pnpm-workspace.yaml → overrides:) against the lockfile's
 *   top-level `overrides:` block.  A changed transitive override that has not
 *   been propagated to the lockfile is caught here — even though no importer
 *   specifier changes.
 *
 * Step 3 — Catalog check (bidirectional):
 *   Compares pnpm-workspace.yaml's `catalog:` block against the lockfile's
 *   `catalogs: default:` block.  A version bump in the workspace catalog that
 *   is not reflected in the lockfile is caught here — even though all importers
 *   still show `specifier: catalog:` and would otherwise pass step 4.
 *
 * Step 4 — Specifier comparison (per importer):
 *   For each importer / package.json pair, all {,dev,optional}Dependencies and
 *   peerDependencies are merged into a full map and compared:
 *
 *   Lockfile → package.json direction:
 *     Every entry recorded in the lockfile (including any peerDependencies that
 *     pnpm stores there under certain configurations) must appear in the
 *     package.json under any dependency group.
 *
 *   Package.json → lockfile direction:
 *     Every non-peer dependency declared in package.json must appear in the
 *     lockfile.  peerDependencies are excluded from this direction because pnpm
 *     does not record them in the importers section when autoInstallPeers is
 *     false (the configuration used by this workspace).
 *
 *   Specifier matching:
 *     For direct (non-versioned, non-chain) overrides declared in the live
 *     workspace config, the lockfile specifier is compared against the live
 *     override value rather than the package.json specifier — so a changed
 *     direct override that was not regenerated into the lockfile is also caught.
 */

"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// ── YAML parser ───────────────────────────────────────────────────────────────
//
// `yaml` is declared as a devDependency of @workspace/chargebridge-mobile and
// is therefore reliably resolvable after `pnpm install`.  It is also present
// as a transitive dep of vite in the workspace, so it exists in the pnpm
// virtual store on any machine that has run the standard project setup.
//
// Using a real YAML parser prevents misinterpretation of valid YAML forms that
// a handwritten line scanner cannot handle (flow sequences, anchors, tags,
// YAML 1.1 booleans, etc.) and ensures malformed YAML fails closed.
const YAML_PARSER = (() => {
  const candidates = [
    // Primary: declared devDependency — resolved from the package's own node_modules.
    require.resolve("yaml", { paths: [__dirname] }),
  ];
  for (const c of candidates) {
    try { return require(c); } catch {}
  }
  process.stderr.write(
    "\n⛔  check-lockfile-sync.cjs: cannot load the 'yaml' package.\n" +
    "    Run `pnpm install` from the workspace root and try again.\n\n"
  );
  process.exit(1);
})();

// ── Workspace root ────────────────────────────────────────────────────────────

const workspaceRoot =
  process.env.LOCKFILE_GATE_WORKSPACE_ROOT ||
  process.argv[2] ||
  path.resolve(__dirname, "../../..");

// ── YAML scalar helpers ───────────────────────────────────────────────────────

/** Strip surrounding single or double quotes from a YAML scalar string. */
function unquoteYamlScalar(str) {
  if (str.length >= 2) {
    const f = str[0], l = str[str.length - 1];
    if ((f === "'" && l === "'") || (f === '"' && l === '"')) return str.slice(1, -1);
  }
  return str;
}

/** Extract a YAML map key from a trimmed line ("key:" or "key: value"). */
function extractYamlKey(trimmedLine) {
  const inlineIdx = trimmedLine.indexOf(": ");
  if (inlineIdx !== -1) return unquoteYamlScalar(trimmedLine.slice(0, inlineIdx));
  return unquoteYamlScalar(trimmedLine.replace(/:$/, ""));
}

/** Extract the YAML scalar value from the text following a map key colon. */
function extractYamlValue(afterColon) {
  return unquoteYamlScalar(afterColon.trim());
}

// ── Workspace YAML parser ─────────────────────────────────────────────────────

/**
 * Parse a YAML boolean scalar string ("true"/"false") into a JS boolean.
 * Returns undefined for unrecognized strings.
 */
function parseYamlBool(str) {
  if (str === "true")  return true;
  if (str === "false") return false;
  return undefined;
}

/**
 * Parse pnpm-workspace.yaml using the real `yaml` YAML parser.
 *
 * Using a real parser prevents silent misinterpretation of valid YAML forms
 * the old line-scanner could not handle (flow sequences, anchors, tags,
 * YAML 1.1 booleans, comments inside block lists, etc.).  Any YAML that the
 * parser rejects produces a parseError that the caller turns into a mismatch.
 *
 * Returns:
 *   globs            — string[] of package-glob strings from `packages:`, or null
 *   catalog          — Map<pkgName, specifier> from `catalog:`, or null
 *   overrides        — Map<rawKey, value> from `overrides:`, or empty Map
 *   settings         — { autoInstallPeers?: boolean, excludeLinksFromLockfile?: boolean }
 *   wsPatchedDeps    — Map<pkgVer, patchPath> from `patchedDependencies:`, or empty Map
 *   hasNamedCatalogs — true when `catalogs:` (plural) block is present
 *   parseError       — set when parsing or structural validation fails
 */
function parseWorkspaceYaml(workspaceRoot) {
  const ABSENT = { globs: null, catalog: null, overrides: new Map(), settings: {},
                   wsPatchedDeps: new Map(), hasNamedCatalogs: false };

  const yamlPath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  let raw;
  try { raw = fs.readFileSync(yamlPath, "utf8"); }
  catch { return ABSENT; }

  // Parse with real YAML parser. Any malformed YAML fails closed.
  let doc;
  try { doc = YAML_PARSER.parse(raw); }
  catch (err) {
    return { ...ABSENT, parseError: `pnpm-workspace.yaml is not valid YAML: ${err.message}` };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ...ABSENT, parseError: "pnpm-workspace.yaml is empty or not a YAML mapping" };
  }

  // ── packages ──────────────────────────────────────────────────────────────
  const globs = [];
  if (doc.packages !== undefined) {
    if (!Array.isArray(doc.packages)) {
      return {
        ...ABSENT,
        parseError: `pnpm-workspace.yaml: "packages" must be a YAML sequence, got ${typeof doc.packages}`,
      };
    }
    for (const g of doc.packages) {
      if (typeof g === "string") globs.push(g);
      else return { ...ABSENT, parseError: `pnpm-workspace.yaml: each "packages" entry must be a string, got ${typeof g}` };
    }
  }

  // ── catalog (default) ─────────────────────────────────────────────────────
  const catalog = new Map();
  if (doc.catalog !== undefined && doc.catalog !== null) {
    if (typeof doc.catalog !== "object" || Array.isArray(doc.catalog)) {
      return { ...ABSENT, parseError: `pnpm-workspace.yaml: "catalog" must be a YAML mapping` };
    }
    for (const [pkg, ver] of Object.entries(doc.catalog)) {
      if (typeof ver === "string" || typeof ver === "number") {
        catalog.set(String(pkg), String(ver));
      }
    }
  }

  // ── named catalogs ────────────────────────────────────────────────────────
  let hasNamedCatalogs = false;
  if (doc.catalogs !== undefined && doc.catalogs !== null) {
    if (typeof doc.catalogs === "object" && !Array.isArray(doc.catalogs)) {
      hasNamedCatalogs = Object.keys(doc.catalogs).length > 0;
    }
  }

  // ── overrides ─────────────────────────────────────────────────────────────
  const overrides = new Map();
  if (doc.overrides !== undefined && doc.overrides !== null) {
    if (typeof doc.overrides !== "object" || Array.isArray(doc.overrides)) {
      return { ...ABSENT, parseError: `pnpm-workspace.yaml: "overrides" must be a YAML mapping` };
    }
    for (const [key, val] of Object.entries(doc.overrides)) {
      if (val === undefined || val === null || val === "-") {
        overrides.set(key, String(val ?? "-"));
      } else if (typeof val === "string" || typeof val === "number") {
        overrides.set(key, String(val));
      }
    }
  }

  // ── patchedDependencies ───────────────────────────────────────────────────
  const wsPatchedDeps = new Map();
  const rawPatches = doc.patchedDependencies;
  if (rawPatches !== undefined && rawPatches !== null) {
    if (typeof rawPatches !== "object" || Array.isArray(rawPatches)) {
      return { ...ABSENT, parseError: `pnpm-workspace.yaml: "patchedDependencies" must be a YAML mapping` };
    }
    for (const [pkgVer, patchPath] of Object.entries(rawPatches)) {
      if (typeof patchPath === "string") wsPatchedDeps.set(pkgVer, patchPath);
    }
  }

  // ── settings ──────────────────────────────────────────────────────────────
  const settings = {};
  if (typeof doc.autoInstallPeers === "boolean")         settings.autoInstallPeers         = doc.autoInstallPeers;
  if (typeof doc.excludeLinksFromLockfile === "boolean") settings.excludeLinksFromLockfile  = doc.excludeLinksFromLockfile;

  return {
    globs:            globs.length > 0    ? globs   : null,
    catalog:          catalog.size > 0    ? catalog : null,
    overrides,
    settings,
    wsPatchedDeps,
    hasNamedCatalogs,
  };
}

/**
 * Parse the root .npmrc file for pnpm settings that affect the lockfile.
 *
 * pnpm's effective configuration precedence (highest first):
 *   1. pnpm-workspace.yaml (returned by parseWorkspaceYaml as `settings`)
 *   2. .npmrc              (returned by this function)
 *   3. pnpm defaults
 *
 * Only settings that are recorded in the lockfile's `settings:` block are
 * extracted here: `auto-install-peers` and `exclude-links-from-lockfile`.
 *
 * Returns { autoInstallPeers?: boolean, excludeLinksFromLockfile?: boolean }.
 */
function parseNpmrc(workspaceRoot) {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(path.join(workspaceRoot, ".npmrc"), "utf8"); }
  catch { return out; }

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim().toLowerCase();

    const truthy = val === "true" || val === "1" || val === "yes";
    if (key === "auto-install-peers")          out.autoInstallPeers         = truthy;
    if (key === "exclude-links-from-lockfile") out.excludeLinksFromLockfile = truthy;
  }
  return out;
}

// ── Live override map ─────────────────────────────────────────────────────────

/**
 * Build the complete live override map by merging pnpm-workspace.yaml overrides
 * with root package.json → pnpm.overrides (package.json takes precedence on
 * key conflicts).
 *
 * Returns Map<rawKey, value> using the exact key strings that pnpm records in
 * the lockfile's `overrides:` section.
 */
function buildLiveOverrideMap(workspaceRoot, wsOverrides) {
  let pkgOverrides = {};
  try {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")
    );
    pkgOverrides = (rootPkg.pnpm && rootPkg.pnpm.overrides) || rootPkg.overrides || {};
  } catch {}

  const result = new Map(wsOverrides); // start with workspace.yaml overrides
  for (const [key, value] of Object.entries(pkgOverrides)) {
    result.set(key, typeof value === "string" ? value : String(value));
  }
  return result;
}

/**
 * Derive the set of direct (non-versioned, non-chain) override package names
 * from the live override map.  Used for per-importer specifier comparisons.
 *
 * "Direct" means the override key is a plain package name without a version
 * selector ("pkg@range") or chain ("pkg>dep") — only these replace the
 * specifier that pnpm records in the lockfile importers section.
 *
 * Returns Map<pkgName, overrideValue>.
 */
function buildDirectOverrideValues(liveOverrideMap) {
  const result = new Map();
  for (const [key, value] of liveOverrideMap) {
    if (key.includes(">")) continue;
    if (value === "-") continue;

    let pkgName   = key;
    let versioned = false;
    if (pkgName.startsWith("@")) {
      const secondAt = pkgName.indexOf("@", 1);
      if (secondAt !== -1) { pkgName = pkgName.slice(0, secondAt); versioned = true; }
    } else {
      const atIdx = pkgName.indexOf("@");
      if (atIdx !== -1) { pkgName = pkgName.slice(0, atIdx); versioned = true; }
    }
    if (versioned) continue;

    result.set(pkgName, value);
  }
  return result;
}

// ── Workspace member enumeration ──────────────────────────────────────────────

/**
 * Classify whether a workspace glob pattern is supported and, if so, return
 * the matched member paths.
 *
 * Supported forms:
 *   • Literal path     — "scripts", "lib/utils"    (no wildcards)
 *   • Single-dir glob  — "artifacts/*", "lib/*"    (trailing /*)
 *   • Multi-level glob — "lib/integrations/*"      (path prefix with trailing /*)
 *
 * Unsupported forms (fail closed rather than silently returning no members):
 *   • Nested wildcard  — "packages/**"
 *   • Brace expansion  — "{packages,apps}/*"
 *   • Exclusion glob   — "!packages/excluded"
 *   • Any other form containing wildcards that don't fit the above
 *
 * Returns:
 *   { members: string[], unsupported: string|null }
 *     members     — matched workspace-relative paths (empty for literal miss)
 *     unsupported — set to the pattern string when the pattern is not supported
 */
function expandWorkspaceGlob(workspaceRoot, pattern) {
  // ── Exclusion patterns ─────────────────────────────────────────────────
  if (pattern.startsWith("!")) {
    return {
      members: [],
      unsupported:
        `exclusion pattern "${pattern}" — exclusions are not supported; ` +
        `run pnpm install directly or set LOCKFILE_GATE_SKIP`,
    };
  }

  // ── Brace-expansion patterns ───────────────────────────────────────────
  if (pattern.includes("{") || pattern.includes("}")) {
    return {
      members: [],
      unsupported:
        `brace-expansion pattern "${pattern}" — brace expansion is not supported; ` +
        `run pnpm install directly or set LOCKFILE_GATE_SKIP`,
    };
  }

  // ── Nested wildcard patterns (contains ** anywhere) ────────────────────
  if (pattern.includes("**")) {
    return {
      members: [],
      unsupported:
        `nested wildcard pattern "${pattern}" — "**" globs are not supported; ` +
        `run pnpm install directly or set LOCKFILE_GATE_SKIP`,
    };
  }

  // ── Literal path (no wildcards) ────────────────────────────────────────
  if (!pattern.includes("*")) {
    try {
      fs.accessSync(path.join(workspaceRoot, pattern, "package.json"), fs.constants.F_OK);
      return { members: [pattern], unsupported: null };
    } catch {
      return { members: [], unsupported: null }; // not found — fine (might be optional)
    }
  }

  // ── Single-level wildcard (must be trailing /*) ────────────────────────
  //    Valid: "artifacts/*", "lib/*", "lib/integrations/*"
  //    Invalid: "*/src", "lib/*/src"
  if (!pattern.endsWith("/*")) {
    return {
      members: [],
      unsupported:
        `wildcard pattern "${pattern}" — only trailing "/*" globs are supported; ` +
        `run pnpm install directly or set LOCKFILE_GATE_SKIP`,
    };
  }

  const parentRel = pattern.slice(0, -2);

  // Ensure no additional wildcards remain in the parent path.
  if (parentRel.includes("*")) {
    return {
      members: [],
      unsupported:
        `wildcard pattern "${pattern}" — only a single trailing "/*" is supported; ` +
        `run pnpm install directly or set LOCKFILE_GATE_SKIP`,
    };
  }

  const parentAbs = path.join(workspaceRoot, parentRel);
  let entries;
  try { entries = fs.readdirSync(parentAbs, { withFileTypes: true }); }
  catch { return { members: [], unsupported: null }; } // parent dir absent — fine

  const members = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const memberRel = parentRel + "/" + entry.name;
    try {
      fs.accessSync(path.join(workspaceRoot, memberRel, "package.json"), fs.constants.F_OK);
      members.push(memberRel);
    } catch {}
  }
  return { members, unsupported: null };
}

/**
 * Enumerate all workspace members from the configured globs plus ".".
 *
 * Returns { members: Set<string>, errors: string[] }.
 * `errors` is non-empty when any configured glob pattern is unsupported
 * (the caller should treat this as a mismatch — fail closed).
 */
function enumerateWorkspaceMembers(workspaceRoot, globs) {
  const members = new Set(["."]);
  const errors  = [];

  if (globs !== null) {
    for (const glob of globs) {
      const { members: found, unsupported } = expandWorkspaceGlob(workspaceRoot, glob);
      if (unsupported !== null) {
        errors.push(
          `  pnpm-workspace.yaml: unsupported workspace glob — ${unsupported}`
        );
      } else {
        for (const m of found) members.add(m);
      }
    }
  }

  return { members, errors };
}

// ── Lockfile parser ───────────────────────────────────────────────────────────

/**
 * Parse a pnpm-lock.yaml v9 file using the real YAML parser.
 *
 * Using a real parser means malformed YAML (truncated nodes, bad indentation,
 * invalid scalars, etc.) causes an immediate parse error that propagates to
 * the caller as a fail-closed mismatch, rather than silently producing an
 * incomplete result.
 *
 * Structural errors (wrong YAML type for any expected section, missing required
 * fields in importer/patch entries) also throw so callers can fail closed.
 *
 * Returns:
 *   {
 *     importers:           { [importerPath]: { [depGroup]: { [pkgName]: specifier } } }
 *     lockCatalog:         Map<pkgName, specifier>
 *     lockOverrides:       Map<rawKey, value>
 *     lockSettings:        { autoInstallPeers?: boolean, excludeLinksFromLockfile?: boolean }
 *     lockPatchedDeps:     Map<"pkg@ver", { hash: string, path: string }>
 *     lockHasNamedCatalogs: boolean
 *     importersFound:      boolean
 *   }
 *
 * Throws an Error when the file cannot be read, is not valid YAML, or violates
 * the expected structural types.
 */
function parseLockfile(lockfilePath) {
  let raw;
  try { raw = fs.readFileSync(lockfilePath, "utf8"); }
  catch (err) { throw new Error(`Cannot read lockfile at ${lockfilePath}: ${err.message}`); }

  let doc;
  try { doc = YAML_PARSER.parse(raw); }
  catch (err) { throw new Error(`pnpm-lock.yaml is not valid YAML: ${err.message}`); }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("pnpm-lock.yaml is empty or not a YAML mapping");
  }

  // ── settings ────────────────────────────────────────────────────────────
  const lockSettings = {};
  if (doc.settings !== undefined && doc.settings !== null) {
    if (typeof doc.settings !== "object" || Array.isArray(doc.settings)) {
      throw new Error(`pnpm-lock.yaml: "settings" must be a YAML mapping, got ${typeof doc.settings}`);
    }
    if (typeof doc.settings.autoInstallPeers === "boolean")
      lockSettings.autoInstallPeers = doc.settings.autoInstallPeers;
    if (typeof doc.settings.excludeLinksFromLockfile === "boolean")
      lockSettings.excludeLinksFromLockfile = doc.settings.excludeLinksFromLockfile;
  }

  // ── patchedDependencies ─────────────────────────────────────────────────
  const lockPatchedDeps = new Map();
  if (doc.patchedDependencies !== undefined && doc.patchedDependencies !== null) {
    if (typeof doc.patchedDependencies !== "object" || Array.isArray(doc.patchedDependencies)) {
      throw new Error(`pnpm-lock.yaml: "patchedDependencies" must be a YAML mapping`);
    }
    for (const [pkgVer, info] of Object.entries(doc.patchedDependencies)) {
      if (!info || typeof info !== "object" || Array.isArray(info)) {
        throw new Error(`pnpm-lock.yaml: patchedDependencies["${pkgVer}"] must be a mapping`);
      }
      if (typeof info.hash !== "string" || typeof info.path !== "string") {
        throw new Error(
          `pnpm-lock.yaml: patchedDependencies["${pkgVer}"] must have string hash and path fields`
        );
      }
      lockPatchedDeps.set(pkgVer, { hash: info.hash, path: info.path });
    }
  }

  // ── overrides ───────────────────────────────────────────────────────────
  const lockOverrides = new Map();
  if (doc.overrides !== undefined && doc.overrides !== null) {
    if (typeof doc.overrides !== "object" || Array.isArray(doc.overrides)) {
      throw new Error(`pnpm-lock.yaml: "overrides" must be a YAML mapping`);
    }
    for (const [key, val] of Object.entries(doc.overrides)) {
      if (val === null || val === undefined) {
        lockOverrides.set(key, "-");
      } else if (typeof val === "string" || typeof val === "number") {
        lockOverrides.set(key, String(val));
      } else {
        throw new Error(`pnpm-lock.yaml: overrides["${key}"] has unexpected type ${typeof val}`);
      }
    }
  }

  // ── catalogs ────────────────────────────────────────────────────────────
  const lockCatalog          = new Map();
  let   lockHasNamedCatalogs = false;
  if (doc.catalogs !== undefined && doc.catalogs !== null) {
    if (typeof doc.catalogs !== "object" || Array.isArray(doc.catalogs)) {
      throw new Error(`pnpm-lock.yaml: "catalogs" must be a YAML mapping`);
    }
    for (const [catalogName, catalogData] of Object.entries(doc.catalogs)) {
      if (catalogName !== "default") { lockHasNamedCatalogs = true; continue; }
      if (!catalogData || typeof catalogData !== "object" || Array.isArray(catalogData)) {
        throw new Error(`pnpm-lock.yaml: catalogs.default must be a YAML mapping`);
      }
      for (const [pkgName, entry] of Object.entries(catalogData)) {
        if (typeof entry === "string") {
          lockCatalog.set(pkgName, entry);
        } else if (entry && typeof entry === "object" && typeof entry.specifier === "string") {
          lockCatalog.set(pkgName, entry.specifier);
        } else {
          throw new Error(`pnpm-lock.yaml: catalogs.default["${pkgName}"] has unexpected type`);
        }
      }
    }
  }

  // ── importers ───────────────────────────────────────────────────────────
  const importers      = {};
  const importersFound = doc.importers !== undefined && doc.importers !== null;

  if (importersFound) {
    if (typeof doc.importers !== "object" || Array.isArray(doc.importers)) {
      throw new Error(
        `pnpm-lock.yaml: "importers" must be a YAML mapping; ` +
        `got ${Array.isArray(doc.importers) ? "sequence" : typeof doc.importers} — ` +
        `the lockfile may be corrupt or generated by an incompatible pnpm version`
      );
    }

    const DEP_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

    for (const [importerPath, importerData] of Object.entries(doc.importers)) {
      importers[importerPath] = {};

      // An empty importer is written as `{}` in the lockfile — valid.
      if (!importerData) continue;

      if (typeof importerData !== "object" || Array.isArray(importerData)) {
        throw new Error(`pnpm-lock.yaml: importer "${importerPath}" must be a YAML mapping`);
      }

      for (const group of DEP_GROUPS) {
        if (importerData[group] === undefined || importerData[group] === null) continue;
        if (typeof importerData[group] !== "object" || Array.isArray(importerData[group])) {
          throw new Error(
            `pnpm-lock.yaml: importer "${importerPath}" > "${group}" must be a YAML mapping`
          );
        }
        importers[importerPath][group] = {};
        for (const [pkgName, info] of Object.entries(importerData[group])) {
          if (!info || typeof info !== "object" || Array.isArray(info)) {
            throw new Error(
              `pnpm-lock.yaml: importer "${importerPath}" > "${group}" > "${pkgName}" must be a mapping`
            );
          }
          if (typeof info.specifier !== "string") {
            throw new Error(
              `pnpm-lock.yaml: importer "${importerPath}" > "${group}" > "${pkgName}" ` +
              `must have a string "specifier" field`
            );
          }
          // Store both specifier (for comparison with package.json) and
          // version (the resolved version, for packages/snapshots lookup).
          importers[importerPath][group][pkgName] = {
            specifier: info.specifier,
            version:   typeof info.version === "string" ? info.version : null,
          };
        }
      }
    }
  }

  // ── packages + snapshots (version-reference coverage) ───────────────────
  //
  // Build a set of all resolvable version references from the lockfile.
  // Each importer dep's `version` field must resolve to an entry in either
  // `packages:` or `snapshots:`.  A missing entry means pnpm would report
  // ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY and refuse to proceed.
  //
  // Both sections use the resolved package identifier as the YAML key
  // (e.g. "is-odd@1.0.0" or "react-dom@19.1.0(react@19.1.0)").
  // We collect keys from both sections into a single Set so a caller can do
  // a O(1) existence check: `lockVersionRefs.has("pkgName@version")`.
  const lockVersionRefs = new Set();

  for (const section of ["packages", "snapshots"]) {
    const data = doc[section];
    if (data === undefined || data === null) continue;
    if (typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`pnpm-lock.yaml: "${section}" must be a YAML mapping`);
    }
    for (const key of Object.keys(data)) {
      lockVersionRefs.add(key);
    }
  }

  return {
    importers,
    lockCatalog,
    lockOverrides,
    lockSettings,
    lockPatchedDeps,
    lockHasNamedCatalogs,
    lockVersionRefs,
    importersFound,
  };
}

// ── Dependency flattening ─────────────────────────────────────────────────────

const ALL_DEP_GROUPS  = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const INST_DEP_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"]; // exclude peers

/**
 * Flatten all four dep groups (including peerDependencies) into a single map.
 * Used to verify that every lockfile importer entry is present in package.json
 * under any dep group (including peers).
 */
function flattenAllDeps(depObject) {
  const result = {};
  for (const group of ALL_DEP_GROUPS) {
    for (const [pkg, specifier] of Object.entries(depObject[group] || {})) {
      if (!(pkg in result)) result[pkg] = specifier;
    }
  }
  return result;
}

/**
 * Flatten only non-peer dep groups into a single map.
 * Used to check that every package.json non-peer entry is present in the
 * lockfile (pnpm does not record peerDeps in importers when autoInstallPeers
 * is false, so we exclude them from this direction to avoid false positives).
 */
function flattenInstDeps(depObject) {
  const result = {};
  for (const group of INST_DEP_GROUPS) {
    for (const [pkg, specifier] of Object.entries(depObject[group] || {})) {
      if (!(pkg in result)) result[pkg] = specifier;
    }
  }
  return result;
}

/**
 * Flatten all dep groups from the lockfile importer entry (which may include
 * peerDependencies in some pnpm configurations).
 */
function flattenLockDeps(lockDeps) {
  const result = {};
  for (const group of ALL_DEP_GROUPS) {
    for (const [pkg, specifier] of Object.entries(lockDeps[group] || {})) {
      if (!(pkg in result)) result[pkg] = specifier;
    }
  }
  return result;
}

// ── Patch file helpers ────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hex digest of a patch file's content.
 * Returns null when the file cannot be read.
 */
function computePatchHash(patchFilePath) {
  try {
    const content = fs.readFileSync(patchFilePath, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Build the complete live patchedDependencies map by merging:
 *   1. pnpm-workspace.yaml `patchedDependencies:` (workspace-level patches)
 *   2. Root package.json `pnpm.patchedDependencies` (root-package patches)
 *
 * The workspace yaml takes precedence on key conflicts (same package patched
 * in both places uses the workspace yaml path, matching pnpm's resolution).
 *
 * Returns Map<"pkg@version", patchRelPath>.
 */
function parseLivePatchedDeps(workspaceRoot, wsPatchedDeps) {
  // Start with workspace yaml patches (higher precedence).
  const map = new Map(wsPatchedDeps);

  // Merge root package.json patches (workspace yaml wins on conflict).
  try {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")
    );
    const patches = rootPkg.pnpm && rootPkg.pnpm.patchedDependencies;
    if (patches && typeof patches === "object") {
      for (const [pkgVer, patchPath] of Object.entries(patches)) {
        if (typeof patchPath === "string" && !map.has(pkgVer)) {
          map.set(pkgVer, patchPath);
        }
      }
    }
  } catch {}

  return map;
}

// ── Error footer ──────────────────────────────────────────────────────────────

function fixInstructions() {
  return (
    `    Fix:\n` +
    `      1. pnpm install\n` +
    `      2. git add pnpm-lock.yaml\n` +
    `      3. git commit -m "chore: update lockfile"\n` +
    `      4. git push\n\n` +
    `    To bypass for a genuine hotfix:\n` +
    `      LOCKFILE_GATE_SKIP="<reason>" git push\n\n`
  );
}

// ── Main check ────────────────────────────────────────────────────────────────

function checkSync(workspaceRoot) {
  // ── Read live workspace configuration ──────────────────────────────────
  const {
    globs, catalog: workspaceCatalog, overrides: wsOverrides,
    settings: wsSettings, wsPatchedDeps,
    hasNamedCatalogs: wsHasNamedCatalogs,
    parseError: wsParseError,
  } = parseWorkspaceYaml(workspaceRoot);

  // A YAML parse or structural error in pnpm-workspace.yaml is fail-closed:
  // we cannot validate configuration we cannot read.
  if (wsParseError) {
    process.stderr.write(
      `\n⛔  lockfile gate: pnpm-lock.yaml is out of sync — ${wsParseError}\n\n` +
      fixInstructions()
    );
    return false;
  }

  // ── Read .npmrc for pnpm setting overrides ──────────────────────────────
  const npmrcSettings = parseNpmrc(workspaceRoot);

  const liveOverrideMap      = buildLiveOverrideMap(workspaceRoot, wsOverrides);
  const directOverrideValues = buildDirectOverrideValues(liveOverrideMap);
  const livePatchedDeps      = parseLivePatchedDeps(workspaceRoot, wsPatchedDeps);

  // ── Read lockfile ───────────────────────────────────────────────────────
  const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
  let importers, lockCatalog, lockOverrides, lockSettings, lockPatchedDeps, lockHasNamedCatalogs, lockVersionRefs, importersFound;
  try {
    ({ importers, lockCatalog, lockOverrides, lockSettings, lockPatchedDeps, lockHasNamedCatalogs, lockVersionRefs, importersFound } = parseLockfile(lockfilePath));
  } catch (err) {
    process.stderr.write(
      `\n⛔  lockfile gate: pnpm-lock.yaml is out of sync — ${err.message}\n\n` +
      fixInstructions()
    );
    return false;
  }

  const mismatches = [];

  // ── Step 0: Fail-closed guard for unsupported configuration ───────────────
  //
  // Named catalogs ("catalogs:" plural in pnpm-workspace.yaml, or catalog names
  // other than "default" in the lockfile) cannot be fully validated by this
  // parser.  Rather than silently passing an incomplete check, we fail closed
  // and emit an actionable error so the developer knows to run pnpm directly.

  if (wsHasNamedCatalogs) {
    mismatches.push(
      `  pnpm-workspace.yaml: named catalogs ("catalogs:" block) are not supported; ` +
      `run pnpm install directly or set LOCKFILE_GATE_SKIP`
    );
  }
  if (lockHasNamedCatalogs) {
    mismatches.push(
      `  pnpm-lock.yaml: lockfile contains named catalogs that cannot be validated; ` +
      `run pnpm install directly or set LOCKFILE_GATE_SKIP`
    );
  }

  // ── Step 1: Workspace member check (bidirectional) ──────────────────────
  const { members: workspaceMembers, errors: globErrors } = enumerateWorkspaceMembers(workspaceRoot, globs);
  const lockfileImporters = new Set(Object.keys(importers));

  // Any unsupported glob pattern is a fail-closed error — we cannot guarantee
  // we found all workspace members, so the check cannot be authoritative.
  for (const err of globErrors) mismatches.push(err);

  for (const member of workspaceMembers) {
    if (!lockfileImporters.has(member)) {
      mismatches.push(
        `  ${member}: workspace member has a package.json but is absent from` +
        ` the lockfile importers section — the lockfile needs to be regenerated`
      );
    }
  }
  // Reverse direction: every lockfile importer must be in the enumerated
  // workspace member set.  An importer that was removed from packages: in
  // pnpm-workspace.yaml would still have a package.json on disk but should
  // no longer appear in the lockfile.
  for (const importerPath of lockfileImporters) {
    if (!workspaceMembers.has(importerPath)) {
      mismatches.push(
        `  ${importerPath}: lockfile importer is not selected by any packages: glob` +
        ` in pnpm-workspace.yaml — it may have been removed from the workspace;` +
        ` run pnpm install to update the lockfile`
      );
    }
  }

  // ── Step 2: Settings check ──────────────────────────────────────────────
  //
  // Workspace settings that pnpm records in the lockfile's `settings:` block
  // must match the live pnpm-workspace.yaml configuration.  Changing
  // `autoInstallPeers` or `excludeLinksFromLockfile` without regenerating the
  // lockfile causes `pnpm install --frozen-lockfile` to fail.
  //
  // Only settings that are explicitly declared in pnpm-workspace.yaml are
  // validated; settings absent from the workspace file use pnpm defaults and
  // are not compared.

  // Settings are compared unconditionally using the EFFECTIVE live value,
  // resolving from the same sources pnpm itself uses (highest priority first):
  //   1. pnpm-workspace.yaml explicit value (wsSettings)
  //   2. Root .npmrc value (npmrcSettings)
  //   3. pnpm v8+ defaults (PNPM_SETTING_DEFAULTS)
  //
  // This catches several cases that a simple key-presence guard misses:
  //   • A setting removed from pnpm-workspace.yaml while the lockfile retains
  //     the old value — the effective value falls through to .npmrc or default.
  //   • A setting changed solely in .npmrc with the lockfile still reflecting
  //     an old value — .npmrc is the authoritative source in that tier.
  const PNPM_SETTING_DEFAULTS = {
    autoInstallPeers:          true,  // pnpm 8+ default (changed from false in ≤7)
    excludeLinksFromLockfile:  false, // always false by default
  };

  for (const [key, defaultVal] of Object.entries(PNPM_SETTING_DEFAULTS)) {
    let effectiveLive, source;
    if (key in wsSettings) {
      effectiveLive = wsSettings[key];
      source = "pnpm-workspace.yaml";
    } else if (key in npmrcSettings) {
      effectiveLive = npmrcSettings[key];
      source = ".npmrc";
    } else {
      effectiveLive = defaultVal;
      source = "pnpm default";
    }

    const lockVal = lockSettings[key];
    if (lockVal === undefined) {
      // pnpm v9 lockfiles always record both settings; absence is unusual —
      // flag only when the effective value differs from the default (an
      // explicit non-default config was not recorded in the lockfile).
      if (effectiveLive !== defaultVal) {
        mismatches.push(
          `  settings: "${key}" is ${effectiveLive} in effective pnpm config (from ${source})` +
          ` but is absent from the lockfile settings section`
        );
      }
    } else if (lockVal !== effectiveLive) {
      mismatches.push(
        `  settings: "${key}" mismatch —` +
        ` effective live value is ${effectiveLive} (from ${source}),` +
        ` lockfile has ${lockVal}`
      );
    }
  }

  // ── Step 2b: Patched-dependencies check ────────────────────────────────
  //
  // The `pnpm.patchedDependencies` map in root package.json and the lockfile's
  // `patchedDependencies:` section must agree exactly.  For each entry we also
  // verify that the patch file on disk hashes (SHA-256) to the value stored in
  // the lockfile — this catches the scenario where a patch file is edited but
  // `pnpm install` is not re-run to update the hash in the lockfile.

  for (const [pkgVer, livePatchPath] of livePatchedDeps) {
    if (!lockPatchedDeps.has(pkgVer)) {
      mismatches.push(
        `  patchedDependencies: "${pkgVer}" is in package.json pnpm.patchedDependencies` +
        ` but is absent from the lockfile patchedDependencies section`
      );
      continue;
    }
    const { hash: lockHash, path: lockPath } = lockPatchedDeps.get(pkgVer);
    if (lockPath !== livePatchPath) {
      mismatches.push(
        `  patchedDependencies: "${pkgVer}" path mismatch —` +
        ` package.json has "${livePatchPath}", lockfile has "${lockPath}"`
      );
      continue;
    }
    // Verify the patch file hash to detect edited-but-not-reinstalled patches.
    const actualHash = computePatchHash(path.join(workspaceRoot, livePatchPath));
    if (actualHash === null) {
      mismatches.push(
        `  patchedDependencies: "${pkgVer}" patch file at "${livePatchPath}" cannot be read`
      );
    } else if (actualHash !== lockHash) {
      mismatches.push(
        `  patchedDependencies: "${pkgVer}" patch file hash mismatch —` +
        ` lockfile has "${lockHash}", actual file SHA-256 is "${actualHash}"`
      );
    }
  }
  for (const [pkgVer] of lockPatchedDeps) {
    if (!livePatchedDeps.has(pkgVer)) {
      mismatches.push(
        `  patchedDependencies: "${pkgVer}" is in the lockfile patchedDependencies section` +
        ` but is absent from package.json pnpm.patchedDependencies`
      );
    }
  }

  // ── Step 3: Overrides check (bidirectional) ─────────────────────────────
  //
  // The complete live override map (from root package.json pnpm.overrides and
  // pnpm-workspace.yaml overrides:) must exactly mirror the lockfile's top-level
  // `overrides:` block.  A changed or newly added transitive override that
  // was not propagated to the lockfile is caught here — even though no
  // importer specifier changes.

  for (const [key, liveValue] of liveOverrideMap) {
    if (!lockOverrides.has(key)) {
      mismatches.push(
        `  overrides: "${key}" is declared in the live workspace config` +
        ` but is absent from the lockfile overrides section`
      );
    } else if (lockOverrides.get(key) !== liveValue) {
      mismatches.push(
        `  overrides: "${key}" value mismatch —` +
        ` live config has "${liveValue}",` +
        ` lockfile has "${lockOverrides.get(key)}"`
      );
    }
  }
  for (const [key] of lockOverrides) {
    if (!liveOverrideMap.has(key)) {
      mismatches.push(
        `  overrides: "${key}" is in the lockfile overrides section` +
        ` but is absent from the live workspace config`
      );
    }
  }

  // ── Step 4: Catalog check (bidirectional) ──────────────────────────────
  //
  // The `catalog:` block in pnpm-workspace.yaml must exactly mirror the
  // `catalogs.default` block in pnpm-lock.yaml.  Any version bump in the
  // workspace catalog that was not propagated to the lockfile is flagged here,
  // even though the importer specifiers all still read `catalog:` and would
  // otherwise pass step 5.

  if (workspaceCatalog !== null) {
    for (const [pkg, wsSpecifier] of workspaceCatalog) {
      if (!lockCatalog.has(pkg)) {
        mismatches.push(
          `  catalog: "${pkg}" is declared in pnpm-workspace.yaml` +
          ` but is absent from the lockfile catalogs.default section`
        );
      } else if (lockCatalog.get(pkg) !== wsSpecifier) {
        mismatches.push(
          `  catalog: "${pkg}" specifier mismatch —` +
          ` pnpm-workspace.yaml has "${wsSpecifier}",` +
          ` lockfile catalogs.default has "${lockCatalog.get(pkg)}"`
        );
      }
    }
  }
  for (const pkg of lockCatalog.keys()) {
    if (workspaceCatalog === null || !workspaceCatalog.has(pkg)) {
      mismatches.push(
        `  catalog: "${pkg}" is in the lockfile catalogs.default section` +
        ` but is absent from pnpm-workspace.yaml`
      );
    }
  }

  // ── Step 5: Specifier comparison (per importer, per dependency group) ─────
  //
  // Dependency groups (dependencies, devDependencies, optionalDependencies) are
  // compared INDEPENDENTLY.  Moving a package between groups without running
  // pnpm install changes the lockfile importer structure, and pnpm
  // --frozen-lockfile rejects this with ERR_PNPM_OUTDATED_LOCKFILE.  Flattening
  // all groups into a single map would miss this class of mismatch.
  //
  // peerDependencies are compared separately because pnpm's behavior depends on
  // the effective autoInstallPeers setting:
  //   • false (default): pnpm does NOT record peer deps in importers; the
  //     package.json → lockfile direction skips peerDependencies.
  //   • true: peers are auto-installed and recorded in importers; the
  //     package.json → lockfile direction includes peerDependencies.
  //
  // The live setting takes precedence; a mismatch with the lockfile setting is
  // already caught in step 2.
  const effectiveAutoInstallPeers =
    wsSettings.autoInstallPeers !== undefined
      ? wsSettings.autoInstallPeers
      : (lockSettings.autoInstallPeers !== undefined ? lockSettings.autoInstallPeers : false);

  // Regular dep groups — compared per package using effective group precedence.
  //
  // pnpm records each package under the HIGHEST-priority group it appears in
  // across all dep groups.  Priority: dependencies > devDependencies >
  // optionalDependencies.  A package declared in both dependencies and
  // devDependencies is recorded only under dependencies.
  //
  // We mirror this by computing each package's "effective group" from
  // package.json and requiring the lockfile to record it under that group.
  // This catches group moves (deps → devDeps) while correctly handling the
  // case where a package is listed in multiple groups.

  const REGULAR_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];

  // Priority map — lower number = higher priority.
  const GROUP_PRIORITY = { dependencies: 0, devDependencies: 1, optionalDependencies: 2 };

  // Override-aware specifier comparison helper.
  // Returns a mismatch message or null.
  const compareSpecifier = (importerPath, group, pkg, lockSpecifier, pkgSpecifier) => {
    const overrideValue = directOverrideValues.get(pkg);
    if (overrideValue !== undefined) {
      if (lockSpecifier !== overrideValue) {
        return (
          `  ${importerPath}: "${pkg}" (${group}) override specifier mismatch —` +
          ` live override is "${overrideValue}", lockfile has "${lockSpecifier}"`
        );
      }
    } else if (pkgSpecifier !== lockSpecifier) {
      return (
        `  ${importerPath}: "${pkg}" (${group}) specifier mismatch —` +
        ` package.json has "${pkgSpecifier}", lockfile has "${lockSpecifier}"`
      );
    }
    return null;
  };

  for (const [importerPath, lockDeps] of Object.entries(importers)) {
    const pkgJsonPath = path.join(workspaceRoot, importerPath, "package.json");
    let pkgJson;
    try { pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")); }
    catch {
      // package.json unreadable or invalid JSON — this importer cannot be
      // validated. Treat as a mismatch (fail closed) rather than silently
      // skipping it, which could allow a stale specifier to pass undetected.
      mismatches.push(
        `  ${importerPath}: package.json is missing or contains invalid JSON` +
        ` — the lockfile cannot be validated for this member`
      );
      continue;
    }

    // ── Compute effective dep group for each package ───────────────────────
    //
    // effectivePkgGroups: Map<pkg, { group: string, specifier: string }>
    // Represents the single lockfile group pnpm would record this package under.
    const effectivePkgGroups = new Map();
    for (const group of REGULAR_GROUPS) {
      for (const [pkg, specifier] of Object.entries(pkgJson[group] || {})) {
        const current = effectivePkgGroups.get(pkg);
        if (!current || GROUP_PRIORITY[group] < GROUP_PRIORITY[current.group]) {
          effectivePkgGroups.set(pkg, { group, specifier });
        }
      }
    }

    // ── Direction: lockfile → package.json ───────────────────────────────
    //
    // For each package recorded in the lockfile:
    //   • It must appear in package.json (in some regular dep group).
    //   • Its lockfile group must equal the effective group for that package
    //     — if the lockfile records it under a lower-priority group than what
    //     package.json declares, the lockfile is stale.
    //   • Its specifier must match the package.json specifier (or live override).
    for (const group of REGULAR_GROUPS) {
      const lockGroup = lockDeps[group] || {};
      for (const [pkg, lockEntry] of Object.entries(lockGroup)) {
        const lockSpecifier = lockEntry.specifier;
        const eff = effectivePkgGroups.get(pkg);
        if (!eff) {
          mismatches.push(
            `  ${importerPath}: "${pkg}" is in lockfile ${group}` +
            ` but is absent from package.json`
          );
          continue;
        }
        if (eff.group !== group) {
          mismatches.push(
            `  ${importerPath}: "${pkg}" is recorded in lockfile ${group}` +
            ` but package.json declares it in ${eff.group}` +
            ` (dependency group mismatch — run pnpm install to update the lockfile)`
          );
          continue;
        }
        const msg = compareSpecifier(importerPath, group, pkg, lockSpecifier, eff.specifier);
        if (msg) mismatches.push(msg);
      }
    }

    // ── Direction: package.json → lockfile ───────────────────────────────
    //
    // For each package in package.json (using its effective group):
    //   • It must appear in the lockfile under its effective group.
    for (const [pkg, { group: effGroup }] of effectivePkgGroups) {
      const lockGroup = lockDeps[effGroup] || {};
      if (!(pkg in lockGroup)) {
        mismatches.push(
          `  ${importerPath}: "${pkg}" is in package.json ${effGroup}` +
          ` but is absent from lockfile ${effGroup}`
        );
      }
    }

    // ── peerDependencies ──────────────────────────────────────────────────
    {
      const lockPeers = lockDeps.peerDependencies || {};
      const pkgPeers  = pkgJson.peerDependencies  || {};

      // Direction: lockfile → package.json (always)
      for (const [pkg, lockEntry] of Object.entries(lockPeers)) {
        const lockSpecifier = lockEntry.specifier;
        if (!(pkg in pkgPeers)) {
          mismatches.push(
            `  ${importerPath}: "${pkg}" is in lockfile peerDependencies` +
            ` but is absent from package.json peerDependencies`
          );
          continue;
        }
        const msg = compareSpecifier(importerPath, "peerDependencies", pkg, lockSpecifier, pkgPeers[pkg]);
        if (msg) mismatches.push(msg);
      }

      // Direction: package.json → lockfile (only when autoInstallPeers=true)
      if (effectiveAutoInstallPeers) {
        for (const pkg of Object.keys(pkgPeers)) {
          if (!(pkg in lockPeers)) {
            mismatches.push(
              `  ${importerPath}: "${pkg}" is in package.json peerDependencies` +
              ` but is absent from lockfile importers section` +
              ` (autoInstallPeers is true)`
            );
          }
        }
      }
    }
  }

  // ── Step 5b: Version-reference coverage check ──────────────────────────────
  //
  // For every dependency recorded in the lockfile's importers section, the
  // `version` field must resolve to an entry in either the `packages:` or
  // `snapshots:` section of the lockfile.  A missing entry means pnpm would
  // report ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY and refuse to install.
  //
  // This catches corrupted lockfiles that have syntactically valid specifiers
  // in importers but whose resolution entries were accidentally removed or
  // never added.
  //
  // Note: this check only applies when packages/snapshots sections exist
  // (lockVersionRefs is non-empty).  A lockfile with no packages/snapshots
  // at all (e.g. a workspace of zero deps) passes this check vacuously.

  if (lockVersionRefs.size > 0) {
    const ALL_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    for (const [importerPath, lockDeps] of Object.entries(importers)) {
      for (const group of ALL_GROUPS) {
        const groupDeps = lockDeps[group];
        if (!groupDeps) continue;
        for (const [depName, lockEntry] of Object.entries(groupDeps)) {
          // `lockEntry.version` is the resolved version from the lockfile importer
          // (e.g. "1.0.0" or "19.1.0(react@19.1.0)").  The canonical lookup key
          // in packages/snapshots is "depName@resolvedVersion".
          //
          // Skip workspace links (version starts with "link:") — these are
          // resolved at install time and have no packages/snapshots entry.
          // Skip null versions (importer entry had no version field).
          const resolvedVersion = lockEntry.version;
          if (!resolvedVersion || resolvedVersion.startsWith("link:")) continue;

          const refKey = `${depName}@${resolvedVersion}`;
          if (!lockVersionRefs.has(refKey)) {
            mismatches.push(
              `  ${importerPath}: "${depName}" (${group}) resolved version "${resolvedVersion}" has no` +
              ` corresponding entry in the lockfile packages/snapshots section —` +
              ` the lockfile may be corrupt or was edited manually`
            );
          }
        }
      }
    }
  }

  if (mismatches.length > 0) {
    process.stderr.write(
      `\n⛔  lockfile gate: pnpm-lock.yaml is out of sync with one or more\n` +
      `    package.json files or workspace configuration:\n\n` +
      mismatches.join("\n") + "\n\n" +
      fixInstructions()
    );
    return false;
  }

  return true;
}

// ── Entry point ───────────────────────────────────────────────────────────────

process.exit(checkSync(workspaceRoot) ? 0 : 1);
