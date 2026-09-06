#!/usr/bin/env node
/**
 * run-nav-timing-gate.cjs
 *
 * EAS build gate — verifies the previous build's nav-timing feedback summary
 * is complete before allowing a new build to proceed.
 *
 * Invoked by the eas-build-post-install hook in package.json.
 *
 * ── EAS build path ────────────────────────────────────────────────────────
 * On EAS (`EAS_BUILD=true`) the gate reads the current build number from
 * app.json (ios.buildNumber) — or from the NAV_TIMING_GATE_BUILD_NUMBER env
 * var when testing.  The required previous-build summary is:
 *
 *   docs/nav-timing-feedback-summary-build-{N-1}.md
 *
 * where N is the current build number.  The gate fails immediately if that
 * exact file is absent from the clean checkout (meaning it was never committed
 * and pushed before this build was triggered).  If N <= 1 the gate skips
 * because there is no prior build.
 *
 * Failing closed on any config-read error ensures uncommitted summaries never
 * silently pass enforcement.
 *
 * ── Local pre-push path ───────────────────────────────────────────────────
 * When running from the git pre-push hook the gate finds the most recent
 * summary in docs/ and delegates to check-nav-timing-summary.cjs.  If no
 * summary files are present it skips (first build).
 *
 * ── Hotfix bypass (pre-push only — NOT honoured on EAS builds) ────────────
 * Set NAV_TIMING_GATE_SKIP=<reason> before pushing to skip the gate.
 * A loud warning is printed; the bypass is logged for audit.
 * Example:
 *   NAV_TIMING_GATE_SKIP="hotfix: auth crash in prod" git push
 * This escape hatch is intentionally unavailable during EAS builds so
 * that the build-time gate remains strict regardless of env vars.
 *
 * Exit codes mirror check-nav-timing-summary.cjs:
 *   0 — gate passed (complete summary, first build, or bypass active)
 *   1 — gate failed (incomplete summary, missing committed summary, or error)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ── Hotfix bypass (pre-push only) ─────────────────────────────────────────
//
// NAV_TIMING_GATE_SKIP is intentionally ignored when running inside an EAS
// build.  EAS sets EAS_BUILD=true for every build job, so checking that
// variable is sufficient to block the bypass at build time.

const isEasBuild  = Boolean(process.env.EAS_BUILD);
const skipReason  = process.env.NAV_TIMING_GATE_SKIP;

if (skipReason) {
  if (isEasBuild) {
    process.stderr.write(
      "\n⛔  nav-timing gate: NAV_TIMING_GATE_SKIP is set but this is an EAS build.\n" +
      "    The bypass is not honoured at build time.  Fill in the nav-timing\n" +
      "    summary before triggering this build.\n\n"
    );
    // Fall through — let the normal gate run and potentially block the build.
  } else {
    const border = "═".repeat(72);
    process.stdout.write(
      `\n╔${border}╗\n` +
      `║  ⚠️   NAV-TIMING GATE BYPASSED — HOTFIX / EMERGENCY PUSH           ║\n` +
      `║                                                                        ║\n` +
      `║  Reason : ${skipReason.padEnd(61)}║\n` +
      `║                                                                        ║\n` +
      `║  ACTION REQUIRED: file or update a task before the next regular        ║\n` +
      `║  build that documents why the summary was skipped.  See               ║\n` +
      `║  RELEASE-CHECKLIST.md § "Hotfix escape hatch" for the full policy.    ║\n` +
      `╚${border}╝\n\n`
    );
    process.exit(0);
  }
}

// ── Lockfile consistency check (pre-push only) ─────────────────────────────
//
// Verifies that pnpm-lock.yaml is in sync with every package.json in the
// monorepo before the push goes out.  EAS runs `pnpm install --frozen-lockfile`
// and rejects any mismatch immediately — surfacing the same failure here saves
// a build credit and the 5-minute upload + rejection cycle.
//
// Skipped on EAS builds: EAS already does this natively; this gate is solely
// for catching the problem before pushing.
//
// Bypass (pre-push only):
//   LOCKFILE_GATE_SKIP=<reason> git push
//
// NAV_TIMING_GATE_SKIP also bypasses this check because the process already
// exits(0) above before reaching this point.
//
// For testing, LOCKFILE_GATE_WORKSPACE_ROOT overrides the workspace root so
// tests can point at a synthetic directory without touching the real lockfile.

if (!isEasBuild) {
  const lockfileSkipReason = process.env.LOCKFILE_GATE_SKIP;
  // Default: three levels up from this script's directory is the monorepo root.
  const workspaceRoot = process.env.LOCKFILE_GATE_WORKSPACE_ROOT
    || path.resolve(__dirname, "../../..");

  if (lockfileSkipReason) {
    const border = "═".repeat(72);
    process.stdout.write(
      `\n╔${border}╗\n` +
      `║  ⚠️   LOCKFILE GATE BYPASSED — HOTFIX / EMERGENCY PUSH             ║\n` +
      `║                                                                        ║\n` +
      `║  Reason : ${lockfileSkipReason.padEnd(61)}║\n` +
      `║                                                                        ║\n` +
      `║  ACTION REQUIRED: run "pnpm install" and commit pnpm-lock.yaml        ║\n` +
      `║  before the next regular build.                                        ║\n` +
      `╚${border}╝\n\n`
    );
  } else {
    process.stdout.write("🔒  lockfile gate: checking pnpm-lock.yaml is in sync…\n");
    // Delegate to check-lockfile-sync.cjs which parses pnpm-lock.yaml and
    // compares specifiers to each workspace package.json directly — no pnpm
    // invocation, no node_modules required, completes in ~1 s on a cold machine.
    const checkLockfileScript = path.resolve(__dirname, "check-lockfile-sync.cjs");
    const lockResult = spawnSync(
      process.execPath,
      [checkLockfileScript, workspaceRoot],
      { stdio: "pipe" }
    );
    if (lockResult.status !== 0) {
      // Forward the script's stderr — it already contains the full error
      // message, mismatch list, fix instructions, and bypass hint.
      if (lockResult.stderr && lockResult.stderr.length > 0) {
        process.stderr.write(lockResult.stderr);
      }
      process.exit(1);
    }
    process.stdout.write("✅  lockfile gate: pnpm-lock.yaml is in sync.\n");
  }
}

// ── __DEV__-gated diagnostic log check ────────────────────────────────────
//
// Scans map.tsx for console.log calls whose tag matches [NavGPS], [NavVoice],
// or [NavRoute] and that are wrapped inside an `if (__DEV__)` block.
//
// In EAS `preview` builds __DEV__ is false at bundle time, so those logs
// become dead code — exactly the failure mode from build #209.  The check
// runs in BOTH the EAS and local pre-push paths so the problem is caught as
// early as possible.
//
// Pass cases (exit continues normally):
//   • No [Nav*] console.log calls in map.tsx at all — clean build with no
//     instrumentation in place.  Normal state after an investigation ends.
//   • [Nav*] calls exist but none are inside an if (__DEV__) block — they
//     will fire correctly in TestFlight.
//
// Fail case (exit 1):
//   • Any [Nav*] console.log call is found inside an if (__DEV__) block.
//
// The path to map.tsx can be overridden via NAV_DEV_LOG_GATE_MAP_PATH for
// testing without touching the real source file.
//
// Implementation notes:
//   Phase 1 — character classifier: marks every character as "code" or
//   "non-code" (inside a comment or string literal).  This prevents false
//   positives from [Nav*] text inside comments or string constants.
//
//   Phase 2 — DEV region extraction: scans the code-only view for
//   `if (__DEV__)` and records the [startLine, endLine] of the body.
//   Block bodies (`{ … }`) are terminated by the matching `}` tracked via
//   brace depth so inner blocks do NOT prematurely close the outer region.
//   Braceless single-statement bodies are terminated at the next `;` (or
//   `}` that closes a block statement) at depth 0.  Multiple and nested
//   regions are all stored; each is computed independently.
//
//   Phase 3 — call detection: scans the code-only view for `console.log(`
//   (preventing false positives from the literal text inside strings), then
//   checks the original source at that position for a [Nav*] tag (which
//   appears inside the string argument, so original source is needed).

function scanForDevGatedNavLogs(mapPath) {
  let source;
  try {
    source = fs.readFileSync(mapPath, "utf8");
  } catch {
    return []; // file absent or unreadable → no violations
  }

  const n = source.length;

  // ── Phase 1: character classifier ────────────────────────────────────
  // isCode[i] = 1  → source[i] is executable code
  // isCode[i] = 0  → source[i] is inside a comment or string literal
  //
  // Newlines that fall inside block comments or template literals are NOT
  // marked non-code here — the line counter in Phase 2 handles them via the
  // original source, so the mapping between character index and line number
  // is always accurate regardless of classification.

  const isCode = new Uint8Array(n).fill(1);

  let ci = 0;
  while (ci < n) {
    const c  = source[ci];
    const c1 = source[ci + 1];

    // Line comment  //…
    if (c === "/" && c1 === "/") {
      while (ci < n && source[ci] !== "\n") { isCode[ci] = 0; ci++; }
      continue; // leave '\n' as code
    }

    // Block comment  /* … */
    if (c === "/" && c1 === "*") {
      isCode[ci] = 0; isCode[ci + 1] = 0; ci += 2;
      while (ci < n && !(source[ci] === "*" && source[ci + 1] === "/")) {
        isCode[ci] = 0; ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }

    // Single-quoted string  '…'
    if (c === "'") {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== "'") {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }

    // Double-quoted string  "…"
    if (c === '"') {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== '"') {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }

    // Template literal  `…`
    // Simplified: ${ … } expressions are treated as string content so that
    // `console.log` inside a template expression is not detected as a call.
    // In practice no diagnostic call appears inside a template expression.
    if (c === "`") {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== "`") {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }

    ci++;
  }

  // ── Phase 2: line number map and code-only view ──────────────────────
  const charLine = new Int32Array(n);
  let lineNum = 1;
  for (let j = 0; j < n; j++) {
    charLine[j] = lineNum;
    if (source[j] === "\n") lineNum++;
  }

  // Non-code characters (except newlines) become spaces so structural regex
  // patterns cannot accidentally match across comment/string boundaries.
  let codeOnly = "";
  for (let j = 0; j < n; j++) {
    codeOnly += (isCode[j] || source[j] === "\n") ? source[j] : " ";
  }

  // ── Phase 3: find if (__DEV__) body regions as character-index ranges ─
  //
  // Each region is { bodyStartIdx, bodyEndIdx } — character indices into
  // source.  A console.log call at character index callStart is inside a
  // region iff bodyStartIdx <= callStart <= bodyEndIdx.
  //
  // Using character indices (not line numbers) prevents false positives from
  // constructs such as `if (__DEV__) {} else console.log("[Nav*]")` where
  // the else branch is on the same line as the closed DEV block.
  //
  // Block bodies: terminate at the `}` that brings brace depth to zero.
  // Inner blocks (`if (x) { … }`) do NOT close the outer region early
  // because we scan to the matching `}` upfront rather than toggling a flag.
  //
  // Braceless single-statement bodies: terminate at the first `;` at
  // depth 0, or at the `}` that closes a nested block statement.

  const DEV_IF_RE  = /\bif\s*\(\s*__DEV__\s*\)/g;
  const devRegions = []; // { bodyStartIdx, bodyEndIdx }

  for (const m of codeOnly.matchAll(DEV_IF_RE)) {
    // Skip whitespace after the condition to find the body's first character.
    let bodyStart = m.index + m[0].length;
    while (
      bodyStart < n &&
      (source[bodyStart] === " "  ||
       source[bodyStart] === "\t" ||
       source[bodyStart] === "\r" ||
       source[bodyStart] === "\n")
    ) bodyStart++;
    if (bodyStart >= n) continue;

    let bodyEnd = bodyStart; // will be updated below

    if (source[bodyStart] === "{" && isCode[bodyStart]) {
      // Block body: scan from the opening `{` tracking brace depth.
      let depth = 0;
      for (let k = bodyStart; k < n; k++) {
        if      (source[k] === "{" && isCode[k]) { depth++; }
        else if (source[k] === "}" && isCode[k]) {
          depth--;
          if (depth === 0) { bodyEnd = k; break; }
        }
      }
    } else {
      // Braceless single-statement body.
      let depth = 0;
      for (let k = bodyStart; k < n; k++) {
        if (!isCode[k]) continue;
        const ch = source[k];
        if      (ch === "{")               { depth++; }
        else if (ch === "}" && depth > 0)  { depth--; if (depth === 0) { bodyEnd = k; break; } }
        else if (ch === "}" && depth === 0) { bodyEnd = k; break; }
        else if (ch === ";" && depth === 0) { bodyEnd = k; break; }
      }
    }

    devRegions.push({ bodyStartIdx: bodyStart, bodyEndIdx: bodyEnd });
  }

  // ── Phase 4: find console.log([Nav*]) calls inside __DEV__ regions ───
  //
  // a. Match `console.log(` in the code-only view — the literal text
  //    "console.log(" inside a string or comment is replaced with spaces
  //    there, so only real function calls are found.
  //
  // b. Confirm the call's start character index falls inside a DEV body
  //    region (character-index comparison, not line comparison — avoids
  //    else-branch false positives).
  //
  // c. Find the matching `)` for this specific call by tracking paren depth
  //    in codeOnly.  String content is already spaces there, so parens
  //    inside string arguments do not skew the depth counter.
  //
  // d. Search the original source between the call start and its closing `)`
  //    for a [Nav*] tag.  The tag appears inside the string argument, so the
  //    original (not codeOnly) is needed.  Bounding to the call's own `)`
  //    prevents a Nav tag in a nearby subsequent call from being attributed
  //    to the preceding call.

  const CONSOLE_LOG_RE = /\bconsole\.log\s*\(/g;
  const NAV_TAG_RE     = /\[Nav(?:GPS|Voice|Route|Step)\]/;
  const violations     = [];

  for (const m of codeOnly.matchAll(CONSOLE_LOG_RE)) {
    const callStart = m.index;

    // (b) Is callStart inside any __DEV__ body region?
    if (!devRegions.some(
      (r) => callStart >= r.bodyStartIdx && callStart <= r.bodyEndIdx
    )) continue;

    // (c) Find the matching `)` for this call.
    // The opening `(` is the last character of the regex match.
    const openParenIdx = callStart + m[0].length - 1;
    let depth   = 0;
    let callEnd = n - 1; // fallback if paren is unclosed
    for (let k = openParenIdx; k < n; k++) {
      const ch = codeOnly[k]; // codeOnly: string content replaced with spaces
      if      (ch === "(") { depth++; }
      else if (ch === ")") { depth--; if (depth === 0) { callEnd = k; break; } }
    }

    // (d) Search the original source within this call's own bounds for [Nav*].
    if (!NAV_TAG_RE.test(source.slice(callStart, callEnd + 1))) continue;

    const lineText = source
      .slice(callStart, Math.min(n, callStart + 120))
      .split("\n")[0]
      .trim();
    violations.push({ lineNum: charLine[callStart], text: lineText });
  }

  return violations;
}

// ── scanForAnyNavLogs ─────────────────────────────────────────────────────
//
// Scans map.tsx for ANY console.log call whose argument contains a [NavGPS],
// [NavVoice], or [NavRoute] tag — regardless of whether it is inside an
// if (__DEV__) block or not.
//
// Used by the production-profile check below: on a production EAS build no
// diagnostic log calls are allowed in map.tsx, gated or ungated.
//
// Shares phases 1–3 with scanForDevGatedNavLogs but omits the DEV-region
// filter so every [Nav*] console.log is considered a violation.

function scanForAnyNavLogs(mapPath) {
  let source;
  try {
    source = fs.readFileSync(mapPath, "utf8");
  } catch {
    return []; // file absent or unreadable → no violations
  }

  const n = source.length;

  // Phase 1: character classifier (identical to scanForDevGatedNavLogs).
  const isCode = new Uint8Array(n).fill(1);
  let ci = 0;
  while (ci < n) {
    const c  = source[ci];
    const c1 = source[ci + 1];
    if (c === "/" && c1 === "/") {
      while (ci < n && source[ci] !== "\n") { isCode[ci] = 0; ci++; }
      continue;
    }
    if (c === "/" && c1 === "*") {
      isCode[ci] = 0; isCode[ci + 1] = 0; ci += 2;
      while (ci < n && !(source[ci] === "*" && source[ci + 1] === "/")) {
        isCode[ci] = 0; ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }
    if (c === "'") {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== "'") {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }
    if (c === '"') {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== '"') {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }
    if (c === "`") {
      isCode[ci] = 0; ci++;
      while (ci < n && source[ci] !== "`") {
        isCode[ci] = 0;
        if (source[ci] === "\\") { ci++; if (ci < n) { isCode[ci] = 0; ci++; } }
        else ci++;
      }
      if (ci < n) { isCode[ci] = 0; ci++; }
      continue;
    }
    ci++;
  }

  // Phase 2: line number map and code-only view.
  const charLine = new Int32Array(n);
  let lineNum = 1;
  for (let j = 0; j < n; j++) {
    charLine[j] = lineNum;
    if (source[j] === "\n") lineNum++;
  }
  let codeOnly = "";
  for (let j = 0; j < n; j++) {
    codeOnly += (isCode[j] || source[j] === "\n") ? source[j] : " ";
  }

  // Phase 3: find ALL console.log([Nav*]) calls (no DEV-region filter).
  //
  // Two detection strategies run in sequence for each call:
  //
  // a. Literal tag — search the RAW source slice for a [Nav*] tag.  Tags
  //    appear inside string arguments, which are in the original source but
  //    replaced with spaces in codeOnly, so the original source is needed.
  //
  // b. Indirect producer — check the CODEONLY slice for known nav log builder
  //    function names (buildNav*) and zone-log variables (_zone*Log).  These
  //    identifiers are code, not string content, so they survive the phase-1
  //    classifier and are present in codeOnly.  Using codeOnly prevents false
  //    positives from string literals that happen to contain those identifiers
  //    (e.g. a doc comment string like "buildNavSpeakLogLine is the helper").

  const CONSOLE_LOG_RE  = /\bconsole\.log\s*\(/g;
  const NAV_TAG_RE      = /\[Nav(?:GPS|Voice|Route|Step)\]/;
  // Matches known nav log builder functions and zone-announce variables whose
  // runtime output always carries a [Nav*] prefix.  Update this list whenever
  // a new indirect log producer is added to map.tsx.
  const NAV_PRODUCER_RE = /\bbuildNav[A-Za-z]+\b|_zone[A-Za-z0-9]+Log\b/;
  const violations      = [];

  for (const m of codeOnly.matchAll(CONSOLE_LOG_RE)) {
    const callStart    = m.index;
    const openParenIdx = callStart + m[0].length - 1;
    let depth   = 0;
    let callEnd = n - 1;
    for (let k = openParenIdx; k < n; k++) {
      const ch = codeOnly[k];
      if      (ch === "(") { depth++; }
      else if (ch === ")") { depth--; if (depth === 0) { callEnd = k; break; } }
    }
    // (a) literal [Nav*] tag in the original source (catches inline template literals)
    const hasLiteralTag  = NAV_TAG_RE.test(source.slice(callStart, callEnd + 1));
    // (b) indirect producer identifier in the code-only view (catches builder calls
    //     and zone-log variables; avoids false positives from string content)
    const hasProducer    = NAV_PRODUCER_RE.test(codeOnly.slice(callStart, callEnd + 1));
    if (!hasLiteralTag && !hasProducer) continue;
    const lineText = source
      .slice(callStart, Math.min(n, callStart + 120))
      .split("\n")[0]
      .trim();
    violations.push({ lineNum: charLine[callStart], text: lineText });
  }

  return violations;
}

const defaultMapPath = path.resolve(
  __dirname, "..", "app", "(tabs)", "map.tsx"
);
const mapTsxPath = process.env.NAV_DEV_LOG_GATE_MAP_PATH || defaultMapPath;

const devGatedViolations = scanForDevGatedNavLogs(mapTsxPath);
if (devGatedViolations.length > 0) {
  process.stderr.write(
    "\n⛔  nav-timing gate: Diagnostic logs are __DEV__-gated and will not\n" +
    "    fire in TestFlight.  Remove the if (__DEV__) guard from the\n" +
    "    following [NavGPS] / [NavVoice] / [NavRoute] console.log call(s)\n" +
    "    in app/(tabs)/map.tsx before triggering this build:\n\n"
  );
  for (const v of devGatedViolations) {
    process.stderr.write(`      Line ${v.lineNum}: ${v.text}\n`);
  }
  process.stderr.write("\n");
  process.exit(1);
}

// ── Production profile: reject ANY [Nav*] console.log ─────────────────────
//
// EAS sets EAS_BUILD_PROFILE to the profile name used for this build
// ('development', 'preview', or 'production').
//
// On a production build, no [NavGPS] / [NavVoice] / [NavRoute] console.log
// is allowed in map.tsx — gated or ungated.  A developer may temporarily
// remove the if (__DEV__) guard so logs fire in TestFlight (preview), but
// must remove the calls entirely before triggering a production build.
//
// Preview and development builds are not checked here; ungated logs in those
// profiles are intentional tester instrumentation.
//
// The NAV_DEV_LOG_GATE_MAP_PATH override that controls which file is scanned
// also applies to this check, so tests can inject a synthetic map.tsx without
// touching the real source file.

if (isEasBuild && process.env.EAS_BUILD_PROFILE === "production") {
  const allNavViolations = scanForAnyNavLogs(mapTsxPath);
  if (allNavViolations.length > 0) {
    process.stderr.write(
      "\n⛔  nav-timing gate: This is a production EAS build. No [NavGPS] /\n" +
      "    [NavVoice] / [NavRoute] console.log calls may be present in\n" +
      "    app/(tabs)/map.tsx — gated or not.  Remove all diagnostic log\n" +
      "    calls before triggering a production build:\n\n"
    );
    for (const v of allNavViolations) {
      process.stderr.write(`      Line ${v.lineNum}: ${v.text}\n`);
    }
    process.stderr.write("\n");
    process.exit(1);
  }
}

// ── Shared paths ───────────────────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, "..");
const docsDir     = path.join(projectRoot, "docs");
const SUMMARY_RE  = /^nav-timing-feedback-summary-build-(\d+)\.md$/;
const checker     = path.resolve(__dirname, "check-nav-timing-summary.cjs");

// ── Committed-to-HEAD check helper ────────────────────────────────────────
//
// Returns true  when the given path exists in the HEAD commit (i.e. has been
//               committed and pushed — safe for EAS clean-checkout builds).
// Returns false when the path is absent from HEAD (untracked, staged but not
//               yet committed, or the repo has no commits at all).
// Returns null  when git is unavailable or returns an unexpected error code.
//
// NOTE: `git ls-files --error-unmatch` is intentionally NOT used here because
// it checks the index (staging area), not HEAD.  A newly `git add`-ed file
// passes that check but is absent from a clean checkout — exactly the scenario
// this gate must reject.

function isCommittedToHead(repoRelativePath) {
  // Resolve the path relative to the repo root (git cat-file requires it).
  const repoRootResult = spawnSync(
    "git", ["rev-parse", "--show-toplevel"],
    { cwd: projectRoot, stdio: "pipe" }
  );
  if (repoRootResult.error || repoRootResult.status !== 0) return null;
  const repoRoot    = repoRootResult.stdout.toString().trim();
  const absPath     = path.join(projectRoot, repoRelativePath);
  const fromRoot    = path.relative(repoRoot, absPath).split(path.sep).join("/");

  const r = spawnSync(
    "git", ["cat-file", "-e", `HEAD:${fromRoot}`],
    { cwd: repoRoot, stdio: "pipe" }
  );
  if (r.error)        return null; // git unavailable
  if (r.status === 0) return true; // exists in HEAD
  // status 128 = fatal (no HEAD / no commits); status 1 = object not in HEAD
  return false;
}

// ── EAS build path ─────────────────────────────────────────────────────────
//
// Derive the current build number from app.json (ios.buildNumber), then
// require docs/nav-timing-feedback-summary-build-{N-1}.md to be present and
// complete in this clean checkout.  Fail closed on any config-read error so
// an unreadable app.json never silently passes the gate.

if (isEasBuild) {
  // Allow tests to inject the build number without modifying app.json.
  let currentBuildNum;
  const envOverride = process.env.NAV_TIMING_GATE_BUILD_NUMBER;
  if (envOverride !== undefined) {
    currentBuildNum = parseInt(envOverride, 10);
    if (!Number.isFinite(currentBuildNum)) {
      process.stderr.write(
        `\n⛔  nav-timing gate: NAV_TIMING_GATE_BUILD_NUMBER is set to` +
        ` "${envOverride}" which is not a valid integer.\n\n`
      );
      process.exit(1);
    }
  } else {
    // Read the platform-appropriate build number from app.json.
    // iOS builds (EAS_BUILD_PLATFORM=ios or unset) use expo.ios.buildNumber.
    // Android builds (EAS_BUILD_PLATFORM=android) use expo.android.versionCode.
    // Fail closed if anything goes wrong so an unreadable app.json never
    // silently passes the gate on either platform.
    const easPlatform   = process.env.EAS_BUILD_PLATFORM; // "ios" | "android" | undefined
    const isAndroid     = easPlatform === "android";
    const appJsonPath   = path.join(projectRoot, "app.json");
    let appJson;
    try {
      appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    } catch (err) {
      process.stderr.write(
        `\n⛔  nav-timing gate: could not read app.json — ${err.message}\n` +
        `    Cannot determine current build number.  The gate fails closed\n` +
        `    to prevent uncommitted summaries from silently passing.\n\n`
      );
      process.exit(1);
    }
    const rawBuildNum   = isAndroid
      ? appJson?.expo?.android?.versionCode
      : appJson?.expo?.ios?.buildNumber;
    const buildNumField = isAndroid
      ? "expo.android.versionCode"
      : "expo.ios.buildNumber";
    currentBuildNum = parseInt(rawBuildNum, 10);
    if (!Number.isFinite(currentBuildNum)) {
      process.stderr.write(
        `\n⛔  nav-timing gate: ${buildNumField} in app.json is` +
        ` "${rawBuildNum}" which is not a valid integer.\n` +
        `    Cannot determine the required previous-build summary.\n\n`
      );
      process.exit(1);
    }
  }

  if (currentBuildNum <= 1) {
    process.stdout.write(
      `ℹ️   nav-timing gate: build number is ${currentBuildNum} — ` +
      `no prior build, gate skipped.\n`
    );
    process.exit(0);
  }

  const requiredBuildNum  = currentBuildNum - 1;
  const requiredFileName  = `nav-timing-feedback-summary-build-${requiredBuildNum}.md`;
  const requiredSummaryPath = path.join("docs", requiredFileName);
  const requiredFullPath  = path.join(projectRoot, requiredSummaryPath);

  if (!fs.existsSync(requiredFullPath)) {
    process.stderr.write(
      `\n⛔  nav-timing gate: required summary file is absent from this checkout:\n` +
      `      ${requiredSummaryPath}\n\n` +
      `    This is the expected summary for build ${requiredBuildNum} (current build\n` +
      `    is ${currentBuildNum}).  EAS builds run against a clean git checkout —\n` +
      `    if the file exists on your local machine but was not committed and\n` +
      `    pushed, it is invisible here.\n\n` +
      `    To fix:\n` +
      `      1. On your local machine, fill in ${requiredSummaryPath}\n` +
      `      2. Commit and push:\n` +
      `           git add ${requiredSummaryPath}\n` +
      `           git commit -m "docs: add nav-timing summary for build ${requiredBuildNum}"\n` +
      `           git push\n` +
      `      3. Re-trigger this EAS build.\n\n`
    );
    process.exit(1);
  }

  // Verify the summary is actually committed to HEAD, not merely present on
  // disk (untracked) or staged (added but not yet committed).  On a genuine
  // EAS build the checkout is clean, so only committed files are visible —
  // this guard catches the "created locally but forgot to commit" scenario
  // even when EAS_BUILD=true is set outside of a real EAS environment.
  //
  // Fail CLOSED on any non-true result (false = not in HEAD; null = git
  // unavailable or no HEAD).  Passing null through would allow a summary
  // created in a no-VCS archive build to silently bypass enforcement.
  const easCommitted = isCommittedToHead(requiredSummaryPath);
  if (easCommitted !== true) {
    if (easCommitted === null) {
      process.stderr.write(
        `\n⛔  nav-timing gate: could not verify whether ${requiredSummaryPath}\n` +
        `    is committed to HEAD — git is unavailable or returned an error.\n\n` +
        `    Failing closed: HEAD verification is required on EAS builds.\n` +
        `    Ensure the repository has at least one commit and that git is\n` +
        `    accessible in the build environment.\n\n`
      );
    } else {
      process.stderr.write(
        `\n⛔  nav-timing gate: ${requiredSummaryPath} exists on disk but has\n` +
        `    NOT been committed to HEAD (file may be untracked or staged but\n` +
        `    not yet committed).\n\n` +
        `    EAS builds run against a clean git checkout — only files present\n` +
        `    in HEAD are visible.  This file will be absent from the real build.\n\n` +
        `    To fix:\n` +
        `      git add ${requiredSummaryPath}\n` +
        `      git commit -m "docs: add nav-timing summary for build ${requiredBuildNum}"\n` +
        `      git push\n` +
        `    Then re-trigger this build.\n\n`
      );
    }
    process.exit(1);
  }

  process.stdout.write(
    `🔍  nav-timing gate (EAS): checking ${requiredSummaryPath}` +
    ` (build ${requiredBuildNum}, required for current build ${currentBuildNum})…\n`
  );

  const result = spawnSync(
    process.execPath,
    [checker, requiredSummaryPath],
    { stdio: "inherit", cwd: projectRoot }
  );

  if (result.error) {
    process.stderr.write(
      `\n❌  nav-timing gate: failed to run checker — ${result.error.message}\n`
    );
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// ── Local pre-push path ────────────────────────────────────────────────────
//
// Find the highest-numbered summary in docs/ and validate it.
// If no summary files are present, skip (first build).

let entries = [];
try {
  entries = fs.readdirSync(docsDir);
} catch {
  // docs/ doesn't exist yet → first build
}

const summaryFiles = entries
  .map((name) => {
    const m = SUMMARY_RE.exec(name);
    return m ? { name, buildNum: parseInt(m[1], 10) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.buildNum - a.buildNum); // highest first

if (summaryFiles.length === 0) {
  process.stdout.write(
    "ℹ️   nav-timing gate: no prior summary found — treating as first build, gate skipped.\n"
  );
  process.exit(0);
}

// ── Run the check on the most recent summary ───────────────────────────────

const latest      = summaryFiles[0];
const summaryPath = path.join("docs", latest.name);

// Warn when the summary exists on disk but hasn't been committed to HEAD.
// The pre-push gate runs locally against the worktree, so it can read the
// file — but the EAS build runs against a clean checkout (only HEAD files
// are present) and will not see it, even if it has been `git add`-ed.
// This is non-fatal so the content check also runs; both issues are visible
// in one pass.  The build captain must commit + push before triggering EAS.
const localCommitted = isCommittedToHead(summaryPath);
if (localCommitted === false) {
  process.stdout.write(
    `\n⚠️   nav-timing gate: ${summaryPath} exists on disk but has NOT\n` +
    `    been committed to HEAD (may be untracked or staged but not committed).\n` +
    `    The EAS build runs against a clean checkout — this file will be\n` +
    `    invisible there and the build will fail.\n\n` +
    `    Commit and push the summary before triggering the next EAS build:\n` +
    `      git add ${summaryPath}\n` +
    `      git commit -m "docs: add nav-timing summary for build ${latest.buildNum}"\n` +
    `      git push\n\n`
  );
} else if (localCommitted === null) {
  process.stdout.write(
    `ℹ️   nav-timing gate: could not verify git HEAD status for ${summaryPath}\n` +
    `    (git unavailable or no commits yet) — skipping commit check.\n` +
    `    Ensure the summary is committed before triggering the EAS build.\n\n`
  );
}

// ── Check for current build's feedback template ────────────────────────────
//
// The template (nav-timing-feedback-build-NNN.md) must be committed to HEAD
// before the build goes live so testers can receive a properly tracked copy.
// If it exists on disk but hasn't been committed, timing data for this build
// will be lost.  This is non-fatal (a warning only) so the summary content
// check also runs and both issues are visible in one pass.
const currentBuildNum = latest.buildNum + 1;
const templateFileName = `nav-timing-feedback-build-${currentBuildNum}.md`;
const templatePath     = path.join("docs", templateFileName);
const templateFullPath = path.join(projectRoot, templatePath);

if (fs.existsSync(templateFullPath)) {
  const templateCommitted = isCommittedToHead(templatePath);
  if (templateCommitted === false) {
    process.stdout.write(
      `\n⚠️   nav-timing gate: ${templatePath} exists on disk but has NOT\n` +
      `    been committed to HEAD (may be untracked or staged but not committed).\n` +
      `    Testers receive this file — if it is not committed before the build\n` +
      `    goes live, they will have no feedback form and timing data for build\n` +
      `    ${currentBuildNum} will be lost.\n\n` +
      `    Commit and push the template before distributing it to testers:\n` +
      `      git add ${templatePath}\n` +
      `      git commit -m "docs: add nav-timing feedback template for build ${currentBuildNum}"\n` +
      `      git push\n\n`
    );
  } else if (templateCommitted === null) {
    process.stdout.write(
      `ℹ️   nav-timing gate: could not verify git HEAD status for ${templatePath}\n` +
      `    (git unavailable or no commits yet) — skipping template commit check.\n` +
      `    Ensure the template is committed before distributing it to testers.\n\n`
    );
  }
}

process.stdout.write(
  `🔍  nav-timing gate: checking ${summaryPath} (build ${latest.buildNum})…\n`
);

const result = spawnSync(
  process.execPath,
  [checker, summaryPath],
  { stdio: "inherit", cwd: projectRoot }
);

if (result.error) {
  process.stderr.write(`\n❌  nav-timing gate: failed to run checker — ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
