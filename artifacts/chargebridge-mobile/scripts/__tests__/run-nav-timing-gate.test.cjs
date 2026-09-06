/**
 * run-nav-timing-gate.test.cjs
 *
 * Tests for scripts/run-nav-timing-gate.cjs using Node's built-in
 * `assert` and `child_process.spawnSync` — no extra test runner needed.
 *
 * Run:
 *   node scripts/__tests__/run-nav-timing-gate.test.cjs
 *
 * Tests cover:
 *   1. No docs/ directory → exit 0 (first-build skip)
 *   2. docs/ exists but contains no summary files → exit 0 (first-build skip)
 *   3. Single summary file that is complete → exit 0
 *   4. Single summary file that is incomplete → exit 1
 *   5. Multiple summary files → picks the highest build number
 *      5a. Highest is complete → exit 0
 *      5b. Highest is incomplete (lower is complete) → exit 1
 *
 * The gate script hardcodes its docs/ path relative to __dirname, so tests
 * that need an empty or absent docs/ temporarily rename the real directory.
 * All fixture files use build numbers ≥ 99990 to avoid colliding with real
 * summary files in docs/.
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs   = require("fs");

// ── paths ──────────────────────────────────────────────────────────────────

const GATE     = path.resolve(__dirname, "..", "run-nav-timing-gate.cjs");
const DOCS_DIR = path.resolve(__dirname, "..", "..", "docs");
const DOCS_BAK = DOCS_DIR + ".test-bak";
const FIXTURES = path.resolve(__dirname, "fixtures");

// ── fixture content ────────────────────────────────────────────────────────

// Use existing checker fixtures so we inherit their full correctness rules.
const COMPLETE_CONTENT   = fs.readFileSync(path.join(FIXTURES, "complete-summary.md"),       "utf8");
const INCOMPLETE_CONTENT = fs.readFileSync(path.join(FIXTURES, "unfilled-placeholder.md"),   "utf8");

// Build numbers reserved for test use — well above any real build.
const BUILD_A = 99990; // used in single-file tests and as the "low" file
const BUILD_B = 99992; // always the "high" file in multi-file tests

// ── helpers ────────────────────────────────────────────────────────────────

function runGate(extraEnv = {}) {
  return spawnSync(process.execPath, [GATE], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function summaryName(buildNum) {
  return `nav-timing-feedback-summary-build-${buildNum}.md`;
}

function writeSummary(buildNum, content) {
  fs.writeFileSync(path.join(DOCS_DIR, summaryName(buildNum)), content, "utf8");
}

function removeSummary(buildNum) {
  const p = path.join(DOCS_DIR, summaryName(buildNum));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── Git commit/reset helpers ───────────────────────────────────────────────
//
// The gate uses `git cat-file -e HEAD:<path>` which checks the HEAD commit,
// not the staging area.  Tests that simulate a "committed" file must actually
// create a real commit so HEAD contains the fixture.
//
// gitCommitSummary  — writes, stages, and commits the fixture (no-verify).
// gitUncommitSummary — undoes the last commit (mixed reset, file kept on disk).
//
// Both helpers operate on the repo root so git sees the correct paths.
// Build numbers ≥ 99990 keep test fixtures well above real build numbers.

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Write, stage, and commit a summary fixture — safely.
 *
 * Safety measures:
 *   1. Pre-flight: aborts if any files other than the fixture are already
 *      staged (to prevent accidentally committing developer work-in-progress).
 *   2. Each git subprocess result is checked; an Error is thrown on failure.
 *   3. Git identity env vars are injected so the commit succeeds even when
 *      global user.name/email are unset (common in CI/sandbox environments).
 *
 * Always pair with gitUncommitSummary in a finally block so the repo
 * history stays clean.  The file must already exist on disk before calling
 * this function (call writeSummary first).
 */
function gitCommitSummary(buildNum) {
  const absPath    = path.join(DOCS_DIR, summaryName(buildNum));
  const relFromRoot = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");

  // ── 1. Pre-flight: abort if other files are staged ──────────────────────
  const preStaged = spawnSync("git", ["diff", "--cached", "--name-only"],
    { cwd: REPO_ROOT, stdio: "pipe" });
  if (preStaged.error) throw new Error(`git diff --cached failed: ${preStaged.error.message}`);
  const alreadyStaged = preStaged.stdout.toString().trim().split("\n").filter(Boolean);
  if (alreadyStaged.length > 0) {
    throw new Error(
      `gitCommitSummary: aborting — the following files are already staged and would ` +
      `be accidentally committed alongside the test fixture:\n  ${alreadyStaged.join("\n  ")}\n` +
      `Unstage them first or run this test with a clean index.`
    );
  }

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME:     "Nav Timing Gate Test",
    GIT_AUTHOR_EMAIL:    "test@nav-timing-gate.invalid",
    GIT_COMMITTER_NAME:  "Nav Timing Gate Test",
    GIT_COMMITTER_EMAIL: "test@nav-timing-gate.invalid",
  };

  // ── 2. Stage only the fixture ────────────────────────────────────────────
  const addResult = spawnSync("git", ["add", absPath], { cwd: REPO_ROOT, stdio: "pipe" });
  if (addResult.error || addResult.status !== 0) {
    throw new Error(`git add failed (status ${addResult.status}): ${addResult.stderr.toString()}`);
  }

  // ── 3. Commit only the fixture ───────────────────────────────────────────
  const commitResult = spawnSync(
    "git",
    ["commit", "--no-verify", "-m", `test: nav-timing gate fixture for build ${buildNum} [auto-cleanup]`],
    { cwd: REPO_ROOT, stdio: "pipe", env: gitEnv }
  );
  if (commitResult.error || commitResult.status !== 0) {
    // Unstage the fixture so the index is clean even if commit failed.
    spawnSync("git", ["restore", "--staged", absPath], { cwd: REPO_ROOT, stdio: "pipe" });
    throw new Error(
      `git commit failed (status ${commitResult.status}): ${commitResult.stderr.toString()}`
    );
  }
}

/**
 * Undo the most recent commit (mixed reset — files remain on disk, unstaged).
 * Call after gitCommitSummary in a finally block to leave the repo clean.
 */
function gitUncommitSummary() {
  const r = spawnSync("git", ["reset", "--mixed", "HEAD~1"], { cwd: REPO_ROOT, stdio: "pipe" });
  if (r.error || r.status !== 0) {
    process.stderr.write(`⚠️  gitUncommitSummary: git reset failed — manual cleanup may be required.\n`);
  }
}

/**
 * Temporarily hide docs/ so the gate sees no directory at all.
 * Returns a restore function — MUST be called even if the test throws.
 */
function hideDocsDir() {
  const existed = fs.existsSync(DOCS_DIR);
  if (existed) fs.renameSync(DOCS_DIR, DOCS_BAK);
  return function restore() {
    if (existed) {
      // If an empty docs/ was created during the test, remove it first.
      if (fs.existsSync(DOCS_DIR)) fs.rmdirSync(DOCS_DIR);
      fs.renameSync(DOCS_BAK, DOCS_DIR);
    } else if (fs.existsSync(DOCS_DIR)) {
      fs.rmdirSync(DOCS_DIR);
    }
  };
}

/**
 * Temporarily replace docs/ with an empty directory.
 * Returns a restore function — MUST be called even if the test throws.
 */
function replaceWithEmptyDocsDir() {
  const existed = fs.existsSync(DOCS_DIR);
  if (existed) fs.renameSync(DOCS_DIR, DOCS_BAK);
  fs.mkdirSync(DOCS_DIR);
  return function restore() {
    fs.rmdirSync(DOCS_DIR);
    if (existed) fs.renameSync(DOCS_BAK, DOCS_DIR);
  };
}

// ── test registry ──────────────────────────────────────────────────────────

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ── test cases ─────────────────────────────────────────────────────────────

/**
 * 1. No docs/ directory → gate exits 0 (first-build skip).
 */
test("exits 0 when docs/ directory does not exist (first build)", () => {
  const restore = hideDocsDir();
  let result;
  try {
    result = runGate();
  } finally {
    restore();
  }
  assert(
    result.status === 0,
    `Expected exit 0 (no docs dir) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("first build") || result.stdout.includes("gate skipped"),
    `Expected first-build message in stdout but got: ${result.stdout}`
  );
});

/**
 * 2. docs/ exists but contains no summary files → exit 0 (first-build skip).
 */
test("exits 0 when docs/ exists but has no summary files", () => {
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate();
  } finally {
    restore();
  }
  assert(
    result.status === 0,
    `Expected exit 0 (no summary files) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("first build") || result.stdout.includes("gate skipped"),
    `Expected first-build message in stdout but got: ${result.stdout}`
  );
});

/**
 * 3. Single summary file — complete → exit 0.
 */
test("exits 0 for a single complete summary file", () => {
  writeSummary(BUILD_A, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate();
  } finally {
    removeSummary(BUILD_A);
  }
  assert(
    result.status === 0,
    `Expected exit 0 (complete summary) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 4. Single summary file — incomplete (has *(fill in)* cells) → exit 1.
 */
test("exits 1 for a single incomplete summary file", () => {
  writeSummary(BUILD_A, INCOMPLETE_CONTENT);
  let result;
  try {
    result = runGate();
  } finally {
    removeSummary(BUILD_A);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (incomplete summary) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 5a. Multiple summary files — highest build number is complete → exit 0.
 *
 * BUILD_A (lower, incomplete) and BUILD_B (higher, complete).
 * The gate must pick BUILD_B and exit 0.
 */
test("exits 0 when multiple files exist and the highest-numbered one is complete", () => {
  writeSummary(BUILD_A, INCOMPLETE_CONTENT); // lower build, incomplete
  writeSummary(BUILD_B, COMPLETE_CONTENT);   // higher build, complete
  let result;
  try {
    result = runGate();
  } finally {
    removeSummary(BUILD_A);
    removeSummary(BUILD_B);
  }
  assert(
    result.status === 0,
    `Expected exit 0 (highest build is complete) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  // The log line must reference the higher build number.
  assert(
    result.stdout.includes(String(BUILD_B)),
    `Expected stdout to mention build ${BUILD_B} (the highest) but got: ${result.stdout}`
  );
});

/**
 * 5b. Multiple summary files — highest build number is INCOMPLETE → exit 1.
 *
 * BUILD_A (lower, complete) and BUILD_B (higher, incomplete).
 * The gate must pick BUILD_B and exit 1 — not be fooled by the lower complete file.
 */
test("exits 1 when multiple files exist and the highest-numbered one is incomplete", () => {
  writeSummary(BUILD_A, COMPLETE_CONTENT);   // lower build, complete
  writeSummary(BUILD_B, INCOMPLETE_CONTENT); // higher build, incomplete
  let result;
  try {
    result = runGate();
  } finally {
    removeSummary(BUILD_A);
    removeSummary(BUILD_B);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (highest build is incomplete) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  // The log line must reference the higher build number, confirming correct selection.
  assert(
    result.stdout.includes(String(BUILD_B)),
    `Expected stdout to mention build ${BUILD_B} (the highest) but got: ${result.stdout}`
  );
});

/**
 * 6. Checker script missing → exit 1, stderr contains a meaningful error.
 *
 * Temporarily rename check-nav-timing-summary.cjs so the gate cannot find it,
 * but leave a real summary file in docs/ so the gate reaches the spawnSync call
 * rather than short-circuiting as a first build.
 */
test("exits 1 and writes a meaningful error to stderr when the checker script is missing", () => {
  const CHECKER     = path.resolve(__dirname, "..", "check-nav-timing-summary.cjs");
  const CHECKER_BAK = CHECKER + ".test-bak";

  // Provide a summary so the gate proceeds past the "first build" check.
  writeSummary(BUILD_A, COMPLETE_CONTENT);

  // Hide the checker script to simulate it being deleted or mis-pathed.
  fs.renameSync(CHECKER, CHECKER_BAK);

  let result;
  try {
    result = runGate();
  } finally {
    // Always restore the checker and clean up the fixture file.
    fs.renameSync(CHECKER_BAK, CHECKER);
    removeSummary(BUILD_A);
  }

  assert(
    result.status === 1,
    `Expected exit 1 (checker missing) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  // When spawnSync can launch node but the script file is absent, Node itself
  // prints the MODULE_NOT_FOUND / "Cannot find module" error via stdio:inherit
  // to the gate's stderr.  The gate's own "❌ failed to run checker" branch
  // only fires when spawnSync cannot exec node at all (result.error is set).
  // Either way, stderr must contain something meaningful — not be empty.
  assert(
    result.stderr.includes("Cannot find module") ||
    result.stderr.includes("MODULE_NOT_FOUND") ||
    result.stderr.includes("failed to run checker") ||
    result.stderr.includes("ENOENT"),
    `Expected a meaningful error message in stderr but got: ${result.stderr}`
  );
});

/**
 * 7. Checker script present but unreadable (chmod 000) → exit 1, stderr has error.
 *
 * When Node cannot read the checker file it exits with a non-zero code and
 * prints an error to stderr; the gate must propagate exit 1.
 *
 * Skipped automatically when the process is running as root because chmod
 * restrictions don't apply to the superuser.
 */
test("exits 1 and writes a meaningful error to stderr when the checker script is present but unreadable", () => {
  // chmod has no effect when running as root — skip gracefully.
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    console.log("    ⚠️  skipped (running as root — chmod restrictions don't apply)");
    return;
  }

  const CHECKER  = path.resolve(__dirname, "..", "check-nav-timing-summary.cjs");
  const origMode = fs.statSync(CHECKER).mode;

  // Provide a summary so the gate proceeds past the "first build" check.
  writeSummary(BUILD_A, COMPLETE_CONTENT);

  // Strip all permissions so Node cannot open the file.
  fs.chmodSync(CHECKER, 0o000);

  let result;
  try {
    result = runGate();
  } finally {
    fs.chmodSync(CHECKER, origMode);
    removeSummary(BUILD_A);
  }

  assert(
    result.status === 1,
    `Expected exit 1 (unreadable checker) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.length > 0,
    `Expected a meaningful error message in stderr but got: ${result.stderr}`
  );
});

/**
 * 8. Checker script present but corrupted (binary garbage / invalid JS) → exit 1.
 *
 * Node fails to parse the file and exits non-zero; the gate must propagate
 * exit 1 rather than treating result.status=null as a pass.
 */
test("exits 1 and writes a meaningful error to stderr when the checker script is present but corrupted", () => {
  const CHECKER     = path.resolve(__dirname, "..", "check-nav-timing-summary.cjs");
  const CHECKER_BAK = CHECKER + ".corrupt-test-bak";

  // Provide a summary so the gate proceeds past the "first build" check.
  writeSummary(BUILD_A, COMPLETE_CONTENT);

  // Replace the checker with binary garbage that Node cannot parse.
  fs.renameSync(CHECKER, CHECKER_BAK);
  fs.writeFileSync(CHECKER, Buffer.from([0x00, 0xff, 0x00, 0xff, 0x00]));

  let result;
  try {
    result = runGate();
  } finally {
    // Restore the real checker even if assertions throw.
    if (fs.existsSync(CHECKER)) fs.unlinkSync(CHECKER);
    fs.renameSync(CHECKER_BAK, CHECKER);
    removeSummary(BUILD_A);
  }

  assert(
    result.status === 1,
    `Expected exit 1 (corrupted checker) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.length > 0,
    `Expected a meaningful error message in stderr but got: ${result.stderr}`
  );
});

// ── EAS build path tests (build-number-based enforcement) ─────────────────
//
// These tests use NAV_TIMING_GATE_BUILD_NUMBER to inject a controllable build
// number without modifying app.json.  All test build numbers are ≥ 99990 to
// avoid colliding with real summary files in docs/.
//
// Convention for EAS tests:
//   EAS_CURRENT      = 99993  (the build being triggered)
//   EAS_REQUIRED_PREV = 99992  (current - 1; the summary the gate demands)
//   EAS_OLDER        = 99990  (an older on-disk summary that must NOT satisfy
//                              the requirement for 99992)

const EAS_CURRENT       = 99993;
const EAS_REQUIRED_PREV = EAS_CURRENT - 1; // 99992
const EAS_OLDER         = 99990;

/**
 * 9. EAS build — an older summary IS present on disk but the required
 *    previous-build summary (N-1) is absent → exit 1.
 *
 * This is the key regression the gate must catch: the gate must not accept
 * an older committed summary as a substitute for the specifically required
 * (N-1) summary.  Without this test, a build captain could skip build-N's
 * summary and the gate would silently accept the older build-(N-2) file.
 */
test("exits 1 on EAS when an older summary is present but the required previous-build summary is absent", () => {
  // Older summary present (99990) — must NOT satisfy the 99992 requirement.
  writeSummary(EAS_OLDER, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
    });
  } finally {
    removeSummary(EAS_OLDER);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + older summary on disk but required ${EAS_REQUIRED_PREV} absent) ` +
    `but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes(String(EAS_REQUIRED_PREV)),
    `Expected stderr to mention required build number ${EAS_REQUIRED_PREV} but got: ${result.stderr}`
  );
});

/**
 * 10. EAS build — the exact required previous-build summary is present,
 *     committed to HEAD, and complete → exit 0.
 *
 * The file is written and committed (real git commit) before the gate runs
 * so that isCommittedToHead() returns true, accurately simulating a committed
 * checkout.  The commit is rolled back with --mixed reset in the finally
 * block, then the file is removed from disk.
 */
test("exits 0 on EAS when the exact required previous-build summary is present and complete", () => {
  writeSummary(EAS_REQUIRED_PREV, COMPLETE_CONTENT);
  gitCommitSummary(EAS_REQUIRED_PREV);
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
    });
  } finally {
    gitUncommitSummary();
    removeSummary(EAS_REQUIRED_PREV);
  }
  assert(
    result.status === 0,
    `Expected exit 0 (EAS + required summary committed to HEAD and complete) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 11. EAS build — the exact required previous-build summary is present and
 *     committed to HEAD but INCOMPLETE → exit 1.
 *
 * The file is committed so the HEAD check passes; the gate must then fail on
 * the content check (unfilled cells), not on the commit check.
 */
test("exits 1 on EAS when the exact required previous-build summary is present but incomplete", () => {
  writeSummary(EAS_REQUIRED_PREV, INCOMPLETE_CONTENT);
  gitCommitSummary(EAS_REQUIRED_PREV);
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
    });
  } finally {
    gitUncommitSummary();
    removeSummary(EAS_REQUIRED_PREV);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + required summary committed but incomplete) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 14a. EAS build — the required summary exists on disk but is UNTRACKED
 *      (never git-add-ed) → exit 1, stderr explains it is not in HEAD.
 *
 * This is the primary regression the gate prevents: a build captain creates
 * the file locally but forgets to commit it before triggering the EAS build.
 */
test("exits 1 on EAS when the required summary exists on disk but is untracked (never staged)", () => {
  // writeSummary only writes the file — no git add, no commit.
  writeSummary(EAS_REQUIRED_PREV, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
    });
  } finally {
    removeSummary(EAS_REQUIRED_PREV);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + summary on disk but untracked) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("NOT been committed") ||
    result.stderr.includes("not been committed") ||
    result.stderr.includes("not committed"),
    `Expected stderr to explain the file is not in HEAD but got: ${result.stderr}`
  );
});

/**
 * 14b. EAS build — the required summary is staged (git add-ed) but NOT yet
 *      committed → exit 1, stderr explains it is not in HEAD.
 *
 * `git ls-files --error-unmatch` would pass this case (the file is in the
 * index).  The gate must use HEAD comparison and reject it.
 */
test("exits 1 on EAS when the required summary is staged but not yet committed to HEAD", () => {
  writeSummary(EAS_REQUIRED_PREV, COMPLETE_CONTENT);
  // Stage the file without committing — the dangerous in-between state.
  spawnSync("git", ["add", path.join(DOCS_DIR, summaryName(EAS_REQUIRED_PREV))],
    { cwd: REPO_ROOT, stdio: "pipe" });
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
    });
  } finally {
    // Unstage then remove the file.
    spawnSync("git", ["restore", "--staged", path.join(DOCS_DIR, summaryName(EAS_REQUIRED_PREV))],
      { cwd: REPO_ROOT, stdio: "pipe" });
    removeSummary(EAS_REQUIRED_PREV);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + summary staged but not committed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("NOT been committed") ||
    result.stderr.includes("not been committed") ||
    result.stderr.includes("not committed"),
    `Expected stderr to explain the file is not in HEAD but got: ${result.stderr}`
  );
});

/**
 * 15. Local pre-push — the most recent summary exists on disk but has NOT
 *     been committed to HEAD (untracked) → gate prints a ⚠️ warning but
 *     continues and exits 0 when the content is complete.
 *
 * Non-fatal so the build captain sees both the commit reminder and any
 * content issues in the same run.
 */
test("prints a warning but still exits 0 (local) when the summary is complete but not committed to HEAD", () => {
  writeSummary(BUILD_A, COMPLETE_CONTENT); // untracked — not staged, not committed
  let result;
  try {
    result = runGate(); // no EAS_BUILD env var → local pre-push path
  } finally {
    removeSummary(BUILD_A);
  }
  assert(
    result.status === 0,
    `Expected exit 0 (local + complete but not committed to HEAD) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("committed to HEAD") ||
    result.stdout.includes("NOT\n    been committed") ||
    result.stdout.includes("not been committed") ||
    result.stdout.includes("NOT been committed"),
    `Expected stdout to warn about file not in HEAD but got: ${result.stdout}`
  );
});

/**
 * 16. EAS build — git is unavailable (no git binary on PATH) and the required
 *     summary is present on disk → exit 1 (fail closed).
 *
 * When isCommittedToHead() returns null the EAS path must not silently pass.
 * This simulates the EAS_NO_VCS=1 / source-archive scenario where there is
 * no .git directory or git binary available.
 *
 * A temporary directory containing a stub `git` that always exits 128 is
 * prepended to PATH so every git invocation fails.
 */
test("exits 1 on EAS when git is unavailable and HEAD cannot be verified (fail closed)", () => {
  const os       = require("os");
  const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), "mock-git-"));
  const mockGit  = path.join(tmpDir, "git");
  // Stub that exits 128 (git fatal error) regardless of arguments.
  fs.writeFileSync(mockGit, "#!/bin/sh\nexit 128\n", { mode: 0o755 });

  writeSummary(EAS_REQUIRED_PREV, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: String(EAS_CURRENT),
      PATH: `${tmpDir}${path.delimiter}${process.env.PATH}`,
    });
  } finally {
    fs.unlinkSync(mockGit);
    fs.rmdirSync(tmpDir);
    removeSummary(EAS_REQUIRED_PREV);
  }
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + git unavailable, fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("unavailable") ||
    result.stderr.includes("could not verify") ||
    result.stderr.includes("git"),
    `Expected stderr to explain git is unavailable but got: ${result.stderr}`
  );
});

/**
 * 12. EAS build — build number is 1 (first ever build) → exit 0 (skip).
 */
test("exits 0 on EAS when the build number is 1 (genuine first build, no prior build)", () => {
  const result = runGate({
    EAS_BUILD: "true",
    NAV_TIMING_GATE_BUILD_NUMBER: "1",
  });
  assert(
    result.status === 0,
    `Expected exit 0 (EAS + buildNumber=1) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("first build") || result.stdout.includes("gate skipped") ||
    result.stdout.includes("no prior build"),
    `Expected first-build/skip message in stdout but got: ${result.stdout}`
  );
});

/**
 * 13. EAS build — injected build number is not a valid integer → exit 1
 *     (fail closed; invalid config must never silently pass).
 */
test("exits 1 on EAS when the injected build number is not a valid integer (fail closed)", () => {
  const result = runGate({
    EAS_BUILD: "true",
    NAV_TIMING_GATE_BUILD_NUMBER: "not-a-number",
  });
  assert(
    result.status === 1,
    `Expected exit 1 (EAS + invalid build number) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 17. Local pre-push — the most recent summary is staged (git add-ed) but NOT
 *     yet committed to HEAD → gate prints a ⚠️ warning but continues and exits
 *     0 when the content is complete.
 *
 * This is the "in-between" state between untracked (test 15) and committed:
 * the file is in the git index but absent from HEAD.  `git ls-files
 * --error-unmatch` would pass it (the file is tracked in the index), but
 * `git cat-file -e HEAD:<path>` returns non-zero because HEAD does not yet
 * contain the blob.  The gate must recognise this as "not committed to HEAD"
 * and produce the same ⚠️ warning it emits for untracked files — while still
 * running the content check and exiting 0 for a complete summary.
 */
test("prints a warning but still exits 0 (local) when the summary is staged but not yet committed to HEAD", () => {
  writeSummary(BUILD_A, COMPLETE_CONTENT);
  // Stage the file without committing — same dangerous in-between state as test 14b
  // but on the local (non-EAS) path.
  spawnSync("git", ["add", path.join(DOCS_DIR, summaryName(BUILD_A))],
    { cwd: REPO_ROOT, stdio: "pipe" });
  let result;
  try {
    result = runGate(); // no EAS_BUILD → local pre-push path
  } finally {
    // Unstage then remove the file so the index stays clean.
    spawnSync("git", ["restore", "--staged", path.join(DOCS_DIR, summaryName(BUILD_A))],
      { cwd: REPO_ROOT, stdio: "pipe" });
    removeSummary(BUILD_A);
  }
  assert(
    result.status === 0,
    `Expected exit 0 (local + complete but staged, not committed to HEAD) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("committed to HEAD") ||
    result.stdout.includes("NOT\n    been committed") ||
    result.stdout.includes("not been committed") ||
    result.stdout.includes("NOT been committed"),
    `Expected stdout to warn that the file has not been committed to HEAD but got: ${result.stdout}`
  );
});

// ── __DEV__-gated diagnostic log check tests ──────────────────────────────
//
// These tests use NAV_DEV_LOG_GATE_MAP_PATH to point the gate at a temp file
// so the real app/(tabs)/map.tsx is not modified.  Both tests also provide a
// complete summary file so the gate reaches the __DEV__ check rather than
// short-circuiting as a first build.

// ── __DEV__ map.tsx helpers ────────────────────────────────────────────────

const os = require("os");

/** Write a temporary map.tsx with the given content; returns { tmpMap, cleanup }. */
function makeTmpMap(content) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nav-gate-map-"));
  const tmpMap = path.join(tmpDir, "map.tsx");
  fs.writeFileSync(tmpMap, content, "utf8");
  return {
    tmpMap,
    cleanup() {
      if (fs.existsSync(tmpMap)) fs.unlinkSync(tmpMap);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    },
  };
}

/** Run the gate with a temporary map.tsx and a complete summary. */
function runGateWithMap(content) {
  const { tmpMap, cleanup } = makeTmpMap(content);
  writeSummary(BUILD_A, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({ NAV_DEV_LOG_GATE_MAP_PATH: tmpMap });
  } finally {
    removeSummary(BUILD_A);
    cleanup();
  }
  return result;
}

/**
 * 18. map.tsx has no [Nav*] console.log calls at all (clean build, no
 *     instrumentation in place) → gate exits 0.
 *
 * This is the normal production state: investigation is complete, all
 * diagnostic log blocks have been removed.
 */
test("exits 0 when map.tsx contains no [Nav*] console.log calls (clean build)", () => {
  const result = runGateWithMap(
    "// Normal map.tsx — no diagnostic instrumentation.\n" +
    "console.log('unrelated log — no nav tag');\n"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (no [Nav*] logs in map.tsx) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 19. map.tsx contains a [NavGPS] console.log in a brace-style if (__DEV__)
 *     block → gate exits 1 with a clear message.
 *
 * This is the regression from build #209: diagnostic logs gated behind
 * __DEV__ produce dead code in EAS preview builds (__DEV__ = false at
 * bundle time) so the tester captures nothing.
 */
test("exits 1 when map.tsx has a [Nav*] console.log inside a brace-style if (__DEV__) block", () => {
  const result = runGateWithMap(
    "if (__DEV__) {\n" +
    "  console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n" +
    "}\n"
  );
  assert(
    result.status === 1,
    `Expected exit 1 ([NavGPS] inside if (__DEV__) {}) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("__DEV__") &&
    (result.stderr.includes("NavGPS") || result.stderr.includes("Nav")),
    `Expected stderr to mention __DEV__ and Nav tag but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("Remove") || result.stderr.includes("remove"),
    `Expected stderr to tell the developer to remove the guard but got: ${result.stderr}`
  );
});

/**
 * 20. Braceless if (__DEV__) body → gate exits 1.
 *
 * `if (__DEV__)\n  console.log(...)` has no braces around the body.
 * The scanner must still detect the Nav log as guarded.
 */
test("exits 1 when map.tsx has a [Nav*] console.log in a braceless if (__DEV__) body", () => {
  const result = runGateWithMap(
    "if (__DEV__)\n" +
    "  console.log(`[NavVoice][TRACE] step=1`);\n" +
    "const x = 1; // this line is NOT inside the guard\n"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (braceless __DEV__ guard) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 21. [Nav*] console.log after an inner block closes inside a __DEV__ block
 *     → gate still exits 1.
 *
 * The inner block closing must NOT reset the outer __DEV__ scope.
 * Previously the brace-depth counter would drop to the entry level at the
 * inner `}` and prematurely mark the outer block as closed.
 */
test("exits 1 when a [Nav*] console.log follows an inner block inside if (__DEV__)", () => {
  const result = runGateWithMap(
    "if (__DEV__) {\n" +
    "  if (someCondition) {\n" +
    "    // inner block\n" +
    "  }\n" +
    "  // Still inside __DEV__ — the inner } must not close the outer scope.\n" +
    "  console.log(`[NavRoute][TRACE] reroute_start`);\n" +
    "}\n"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (Nav log after inner block inside __DEV__) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 22. [Nav*] text inside a line comment → gate exits 0 (no false positive).
 *
 * A commented-out diagnostic log must not trigger the gate.
 */
test("exits 0 when [Nav*] text appears only inside a line comment (no false positive)", () => {
  const result = runGateWithMap(
    "if (__DEV__) {\n" +
    "  // console.log(`[NavGPS][TRACE] disabled for now`);\n" +
    "}\n"
  );
  assert(
    result.status === 0,
    `Expected exit 0 ([Nav*] only in comment) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 23. [Nav*] text inside a string literal (not a console.log call) → exit 0.
 *
 * A string constant that happens to contain a Nav tag prefix must not be
 * mistaken for an executable diagnostic log.
 */
test("exits 0 when [Nav*] text appears only inside a string literal (no false positive)", () => {
  const result = runGateWithMap(
    "if (__DEV__) {\n" +
    "  const prefix = '[NavGPS] is a log prefix';\n" +
    "}\n"
  );
  assert(
    result.status === 0,
    `Expected exit 0 ([Nav*] only in string literal) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 24. [Nav*] console.log outside any __DEV__ guard → gate exits 0.
 *
 * Ungated logs fire correctly in TestFlight and must not be blocked.
 */
test("exits 0 when a [Nav*] console.log exists but is not inside any if (__DEV__) block", () => {
  const result = runGateWithMap(
    "// Not __DEV__-gated: must fire in TestFlight builds.\n" +
    "console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n"
  );
  assert(
    result.status === 0,
    `Expected exit 0 ([Nav*] log outside __DEV__ guard) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 25. [Nav*] console.log in the else branch of an if (__DEV__) statement
 *     → gate exits 0 (no false positive).
 *
 * The else branch is explicitly NOT the __DEV__-gated path.  Line-number-
 * based region checking would include the else branch when both branches are
 * on the same line; character-index regions must not.
 */
test("exits 0 when [Nav*] console.log is in the else branch of if (__DEV__) (no false positive)", () => {
  const result = runGateWithMap(
    "if (__DEV__) { /* nothing */ } else console.log(`[NavGPS][TRACE] t=0`);\n"
  );
  assert(
    result.status === 0,
    `Expected exit 0 ([Nav*] in else branch) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 26. A [Nav*] tag in a nearby subsequent call must not cause the preceding
 *     ordinary call to be reported (no false positive from fixed lookahead).
 *
 * Previously a 300-char lookahead from call A could reach call B's [Nav*]
 * tag and falsely flag call A.  Argument-boundary detection fixes this.
 */
test("exits 0 for an ungated call followed closely by a gated [Nav*] call with correct blame", () => {
  // The ungated console.log("ordinary") is NOT inside __DEV__.
  // The gated console.log(`[NavGPS]...`) IS inside __DEV__.
  // Only the second call should be a violation.
  const result = runGateWithMap(
    "console.log('ordinary'); // NOT in __DEV__\n" +
    "if (__DEV__) {\n" +
    "  console.log(`[NavGPS][TRACE] step=1`);\n" +
    "}\n"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (only the gated call is a violation) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  // The violation message must reference the gated call, not the ordinary one.
  assert(
    result.stderr.includes("NavGPS"),
    `Expected stderr to mention NavGPS but got: ${result.stderr}`
  );
});

/**
 * 27. Long console.log argument (tag appears beyond 300 chars) → exits 1.
 *
 * A fixed 300-char lookahead would miss the [Nav*] tag here.
 * The call's own argument boundary must be used instead.
 */
test("exits 1 when the [Nav*] tag appears beyond 300 chars into the console.log argument", () => {
  // Build a long log message where [NavRoute] appears after >300 filler chars.
  const filler = "x".repeat(310);
  const result = runGateWithMap(
    "if (__DEV__) {\n" +
    "  console.log(`" + filler + "[NavRoute][TRACE] reroute`);\n" +
    "}\n"
  );
  assert(
    result.status === 1,
    `Expected exit 1 ([NavRoute] beyond 300 chars in arg) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

// ── Production-profile diagnostic log check tests ─────────────────────────
//
// These tests exercise the EAS_BUILD_PROFILE=production check that rejects
// ANY [Nav*] console.log in map.tsx — gated or not.
//
// Helpers reuse makeTmpMap / writeSummary / removeSummary from above.
// A new helper runGateWithMapForProfile mirrors runGateWithMap but also sets
// EAS_BUILD and EAS_BUILD_PROFILE so the production gate path is reached.

/** Run the gate for a specific EAS profile with a temporary map.tsx and a complete summary. */
function runGateWithMapForProfile(content, profile) {
  const { tmpMap, cleanup } = makeTmpMap(content);
  writeSummary(BUILD_A, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({
      NAV_DEV_LOG_GATE_MAP_PATH: tmpMap,
      EAS_BUILD: "true",
      EAS_BUILD_PROFILE: profile,
      // Inject a dummy build number so the EAS path doesn't look for app.json.
      NAV_TIMING_GATE_BUILD_NUMBER: "1", // build 1 → no prior build, EAS summary gate skips
    });
  } finally {
    removeSummary(BUILD_A);
    cleanup();
  }
  return result;
}

/**
 * 28. Production profile + ungated [NavGPS] log → exit 1.
 *
 * A developer removed the __DEV__ guard so the log fires in TestFlight but
 * forgot to remove the call before triggering the production build.  The gate
 * must catch this even though the log is not DEV-gated.
 */
test("exits 1 on production profile when an ungated [NavGPS] console.log is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "// Ungated — fires in TestFlight but must NOT ship to App Store.\n" +
    "console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (production + ungated [NavGPS]) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("production") &&
    (result.stderr.includes("NavGPS") || result.stderr.includes("Nav")),
    `Expected stderr to mention production and NavGPS but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("Remove") || result.stderr.includes("remove"),
    `Expected stderr to tell the developer to remove the calls but got: ${result.stderr}`
  );
});

/**
 * 29. Preview profile + ungated [NavGPS] log → exit 0 (allowed).
 *
 * Ungated logs are intentional tester instrumentation on preview builds.
 * The gate must NOT reject them on the preview profile.
 */
test("exits 0 on preview profile when an ungated [NavGPS] console.log is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "// Ungated — intentional instrumentation for TestFlight testers.\n" +
    "console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n",
    "preview"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (preview + ungated [NavGPS] is allowed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 30. Production profile + no [Nav*] logs at all → exit 0.
 *
 * Normal production state: investigation is complete, all diagnostic log
 * calls have been removed.  The gate must pass cleanly.
 */
test("exits 0 on production profile when map.tsx contains no [Nav*] console.log calls", () => {
  const result = runGateWithMapForProfile(
    "// Clean map.tsx — no diagnostic instrumentation.\n" +
    "console.log('unrelated log — no nav tag');\n",
    "production"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (production + no [Nav*] logs) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 31. Production profile + [NavVoice] log inside if (__DEV__) → exit 1.
 *
 * The production check must catch DEV-gated logs too (the DEV-gated check
 * also fires, but this confirms the production check is independently correct
 * for gated calls when both checks run in sequence).
 */
test("exits 1 on production profile when a DEV-gated [NavVoice] console.log is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "if (__DEV__) {\n" +
    "  console.log(`[NavVoice][TRACE] step=1`);\n" +
    "}\n",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (production + DEV-gated [NavVoice]) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 32. Production profile + [NavRoute] log in a comment → exit 0 (no false positive).
 *
 * A commented-out nav log must not trigger the production check.
 */
test("exits 0 on production profile when [NavRoute] text appears only inside a comment (no false positive)", () => {
  const result = runGateWithMapForProfile(
    "// console.log(`[NavRoute][TRACE] reroute`);\n" +
    "console.log('unrelated');\n",
    "production"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (production + [NavRoute] only in comment) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 33. Production profile + [NavStep] log → exit 1.
 *
 * [NavStep] was missing from the original NAV_TAG_RE.  Any [Nav*]-tagged log
 * must be rejected on production regardless of the specific tag variant.
 */
test("exits 1 on production profile when a [NavStep] console.log is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "console.log(`[NavStep][TRACE] advance stepIdx=1→2 distM=30m speedMph=25 threshold=35m`);\n",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (production + [NavStep] log) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("NavStep") || result.stderr.includes("Nav"),
    `Expected stderr to mention the Nav tag but got: ${result.stderr}`
  );
});

/**
 * 34. Production profile + indirect buildNavSpeakLogLine call → exit 1.
 *
 * console.log(buildNavSpeakLogLine(...)) contains no literal [Nav*] tag at the
 * call site, but the function always produces a [NavVoice] log.  The production
 * gate must detect the builder function name in the code-only view and reject it.
 */
test("exits 1 on production profile when console.log(buildNavSpeakLogLine(...)) is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "const line = buildNavSpeakLogLine(_t, force, routeVersion, stepIdx, text);\n" +
    "console.log(buildNavSpeakLogLine(_tSpeak, force, _capturedRouteVersion, _capturedStepIdx, text));\n",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (production + buildNavSpeakLogLine indirect call) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 35. Production profile + zone-log variable pattern → exit 1.
 *
 * `if (_zoneA1Log) console.log(_zoneA1Log)` carries no literal [Nav*] tag at
 * the call site; the value always contains [NavVoice] at runtime.  The gate
 * must detect the _zone*Log variable identifier in the code-only view.
 */
test("exits 1 on production profile when console.log(_zoneA1Log) (zone-log variable) is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "const _zoneA1Log = buildNavZoneLogLine(steps, curIdx, distToNextM, 'a1', rv, ts, tz);\n" +
    "if (_zoneA1Log) console.log(_zoneA1Log);\n",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (production + _zoneA1Log variable) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 36. Preview profile + indirect buildNavSpeakLogLine call → exit 0 (allowed).
 *
 * Indirect nav log calls are allowed on preview builds — they are intentional
 * tester instrumentation.  Only production builds must reject them.
 */
test("exits 0 on preview profile when console.log(buildNavSpeakLogLine(...)) is present in map.tsx", () => {
  const result = runGateWithMapForProfile(
    "console.log(buildNavSpeakLogLine(_tSpeak, force, _capturedRouteVersion, _capturedStepIdx, text));\n",
    "preview"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (preview + buildNavSpeakLogLine is allowed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 37. Production profile + builder name only inside a string literal → exit 0
 *     (no false positive from string content).
 *
 * A comment or string that happens to contain "buildNavSpeakLogLine" must not
 * trigger the production gate.  The code-only view replaces string content with
 * spaces, so the identifier is invisible to NAV_PRODUCER_RE there.
 */
test("exits 0 on production profile when buildNavSpeakLogLine appears only inside a string (no false positive)", () => {
  const result = runGateWithMapForProfile(
    "console.log('call buildNavSpeakLogLine to produce the log line');\n",
    "production"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (production + buildNavSpeakLogLine only in string) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

// ── Android platform __DEV__ check tests ──────────────────────────────────
//
// These tests confirm that the __DEV__-gated diagnostic log check fires
// regardless of which EAS platform (ios / android) triggered the build.
//
// A new helper mirrors runGateWithMapForProfile but also passes
// EAS_BUILD_PLATFORM so the platform-detection branch in the gate is
// exercised.  NAV_TIMING_GATE_BUILD_NUMBER=1 skips the build-number
// enforcement (no prior build), isolating the __DEV__-log check.

/**
 * Run the gate for a specific EAS platform + profile with a temporary map.tsx
 * and a complete summary.
 *
 * @param {string} content    - Content to write to the temporary map.tsx.
 * @param {string} platform   - "android" | "ios" — value for EAS_BUILD_PLATFORM.
 * @param {string} [profile]  - EAS build profile (default: "preview").
 */
function runGateWithMapForPlatform(content, platform, profile = "preview") {
  const { tmpMap, cleanup } = makeTmpMap(content);
  writeSummary(BUILD_A, COMPLETE_CONTENT);
  let result;
  try {
    result = runGate({
      NAV_DEV_LOG_GATE_MAP_PATH: tmpMap,
      EAS_BUILD: "true",
      EAS_BUILD_PLATFORM: platform,
      EAS_BUILD_PROFILE: profile,
      // Build 1 → no prior build, EAS summary gate skips.
      NAV_TIMING_GATE_BUILD_NUMBER: "1",
    });
  } finally {
    removeSummary(BUILD_A);
    cleanup();
  }
  return result;
}

/**
 * 38. Android EAS build + __DEV__-gated [NavGPS] log → exit 1.
 *
 * Confirms the __DEV__ diagnostic log check fires on Android builds, not just
 * iOS.  In EAS non-development builds __DEV__ is false at bundle time, so the
 * gated log becomes dead code on Android just as it does on iOS.
 */
test("exits 1 on Android EAS build when map.tsx has a [NavGPS] console.log inside if (__DEV__)", () => {
  const result = runGateWithMapForPlatform(
    "if (__DEV__) {\n" +
    "  console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n" +
    "}\n",
    "android"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (Android EAS + [NavGPS] inside if (__DEV__) {}) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("__DEV__") &&
    (result.stderr.includes("NavGPS") || result.stderr.includes("Nav")),
    `Expected stderr to mention __DEV__ and Nav tag but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("Remove") || result.stderr.includes("remove"),
    `Expected stderr to tell the developer to remove the guard but got: ${result.stderr}`
  );
});

/**
 * 39. iOS EAS build (EAS_BUILD_PLATFORM=ios, explicit) + __DEV__-gated log → exit 1.
 *
 * Confirms the explicit EAS_BUILD_PLATFORM=ios value also triggers the check,
 * as a symmetry control for test 38.
 */
test("exits 1 on iOS EAS build (EAS_BUILD_PLATFORM=ios, explicit) when map.tsx has a [NavVoice] log inside if (__DEV__)", () => {
  const result = runGateWithMapForPlatform(
    "if (__DEV__) {\n" +
    "  console.log(`[NavVoice][TRACE] step=1`);\n" +
    "}\n",
    "ios"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (iOS EAS + [NavVoice] inside if (__DEV__) {}) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("__DEV__") &&
    (result.stderr.includes("NavVoice") || result.stderr.includes("Nav")),
    `Expected stderr to mention __DEV__ and NavVoice but got: ${result.stderr}`
  );
});

/**
 * 40. Android EAS build + map.tsx has no [Nav*] logs → exit 0.
 *
 * Clean build on Android: the __DEV__ check must pass when no diagnostic
 * instrumentation is present, just as it does on iOS.
 */
test("exits 0 on Android EAS build when map.tsx contains no [Nav*] console.log calls (clean build)", () => {
  const result = runGateWithMapForPlatform(
    "// Normal map.tsx — no diagnostic instrumentation.\n" +
    "console.log('unrelated log — no nav tag');\n",
    "android"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (Android EAS + no [Nav*] logs) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 41. Android EAS build + ungated [NavGPS] log → exit 0 on preview profile.
 *
 * Ungated logs are allowed on preview (TestFlight / internal track) builds
 * on both platforms.  The gate must not over-fire on Android.
 */
test("exits 0 on Android EAS preview build when an ungated [NavGPS] log is present (allowed instrumentation)", () => {
  const result = runGateWithMapForPlatform(
    "// Ungated — intentional tester instrumentation.\n" +
    "console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n",
    "android",
    "preview"
  );
  assert(
    result.status === 0,
    `Expected exit 0 (Android EAS preview + ungated [NavGPS] is allowed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 42. Android EAS production build + ungated [NavGPS] log → exit 1.
 *
 * On production builds no [Nav*] log may be present on either platform.
 * The production-profile check must fire on Android just as it does on iOS.
 */
test("exits 1 on Android EAS production build when an ungated [NavGPS] log is present in map.tsx", () => {
  const result = runGateWithMapForPlatform(
    "// Ungated — must NOT ship to Play Store.\n" +
    "console.log(`[NavGPS][TRACE] t=${Date.now()} posAge=42ms`);\n",
    "android",
    "production"
  );
  assert(
    result.status === 1,
    `Expected exit 1 (Android EAS production + ungated [NavGPS]) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("production") &&
    (result.stderr.includes("NavGPS") || result.stderr.includes("Nav")),
    `Expected stderr to mention production and NavGPS but got: ${result.stderr}`
  );
});

// ── Lockfile gate tests ───────────────────────────────────────────────────
//
// These tests exercise the lockfile consistency check that runs in the local
// pre-push path (before the nav-timing summary check).
//
// LOCKFILE_GATE_WORKSPACE_ROOT overrides the workspace root used by the gate,
// allowing tests to point at synthetic directories without modifying the real
// pnpm-lock.yaml or package.json files.

/**
 * Create a temporary directory containing a package.json that declares a
 * fictional dependency version, but NO pnpm-lock.yaml.  pnpm install
 * --frozen-lockfile requires a lockfile and will fail immediately.
 * Returns the path to the temp directory.
 */
function makeMismatchedWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-gate-test-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-mismatch", version: "0.0.0", dependencies: { "does-not-exist-xyz": "^99.0.0" } }, null, 2),
    "utf8"
  );
  // Intentionally NO pnpm-lock.yaml — frozen-lockfile fails without one.
  return dir;
}

/**
 * 43. LOCKFILE_GATE_SKIP set → lockfile check is bypassed, gate exits 0
 *     (when docs/ has no summary files the nav-timing check also skips).
 */
test("exits 0 when LOCKFILE_GATE_SKIP is set (lockfile gate bypassed)", () => {
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_SKIP: "hotfix: critical auth crash" });
  } finally {
    restore();
  }
  assert(
    result.status === 0,
    `Expected exit 0 (LOCKFILE_GATE_SKIP bypass) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("LOCKFILE GATE BYPASSED") || result.stdout.includes("lockfile gate bypassed"),
    `Expected lockfile bypass banner in stdout but got: ${result.stdout}`
  );
});

/**
 * 44. LOCKFILE_GATE_WORKSPACE_ROOT points to the real workspace root and the
 *     lockfile IS in sync → lockfile gate passes, gate exits 0 overall
 *     (docs/ is empty so nav-timing skips too).
 */
test("exits 0 when lockfile is in sync with the workspace package manifests", () => {
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: REPO_ROOT });
  } finally {
    restore();
  }
  assert(
    result.status === 0,
    `Expected exit 0 (lockfile in sync) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stdout.includes("lockfile gate") && result.stdout.includes("in sync"),
    `Expected "lockfile gate … in sync" in stdout but got: ${result.stdout}`
  );
});

/**
 * 45. LOCKFILE_GATE_WORKSPACE_ROOT points to a directory with no pnpm-lock.yaml
 *     → pnpm install --frozen-lockfile fails → gate exits 1 with a clear message
 *     instructing the developer to run pnpm install and commit the lockfile.
 */
test("exits 1 with a clear fix message when pnpm-lock.yaml is absent/mismatched", () => {
  const mismatchDir = makeMismatchedWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: mismatchDir });
  } finally {
    restore();
    // Clean up temp dir (best effort — OS will also clean up on reboot).
    try { fs.rmSync(mismatchDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (lockfile mismatch) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("LOCKFILE_GATE_SKIP"),
    `Expected LOCKFILE_GATE_SKIP bypass hint in stderr but got: ${result.stderr}`
  );
});

/**
 * Create a temporary directory that reproduces the exact Build #212 failure:
 * a package was removed from package.json but is still listed in pnpm-lock.yaml.
 *
 * The workspace has:
 *   package.json  — declares only `is-odd` (one dependency)
 *   pnpm-lock.yaml — lists BOTH `is-odd` AND `is-even` (stale entry) in the
 *                    importer's `dependencies` specifiers
 *
 * pnpm install --frozen-lockfile exits 1 for this mismatch because the
 * specifiers in the lockfile importer no longer match package.json:
 *   ERR_PNPM_OUTDATED_LOCKFILE … 1 dependencies were removed: is-even@^1.0.0
 *
 * Returns the path to the temp directory.
 */
function makeStaleLockfileWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-stale-test-"));

  // package.json — only is-odd; is-even was removed.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "stale-lockfile-test", version: "0.0.0", dependencies: { "is-odd": "^3.0.0" } },
      null,
      2
    ),
    "utf8"
  );

  // pnpm-lock.yaml — still lists is-even in the importer's dependencies
  // (exactly the Build #212 scenario: removed from package.json, not from lockfile).
  //
  // Lockfile version 9.0 format (pnpm ≥ 9.x):
  //   importers["."].dependencies  must mirror package.json specifiers exactly.
  //   Leaving is-even there makes pnpm exit 1 with ERR_PNPM_OUTDATED_LOCKFILE.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      is-odd:",
      "        specifier: ^3.0.0",
      "        version: 3.0.0",
      "      is-even:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0",
      "",
      "packages:",
      "",
      "  is-number@6.0.0:",
      "    resolution: {integrity: sha512-2jYp7uABMSQxWB5JkJMnKj6bFfGCGmNWDDZBcxKFglCKzjXNxLbSCmJUe7FRqxDvhXmS7UDl+3vvX00O2Z8A==}",
      "    engines: {node: '>=0.12.0'}",
      "",
      "  is-odd@3.0.0:",
      "    resolution: {integrity: sha512-U14EFZlJFBBLDz7n3T0Y6bHJN37Zer8gqk77YQEP1VKXZJ9wuPFdMFh5t8e6LKUZ9G2w1mFrGAyR4l61BSYQ==}",
      "    engines: {node: '>=6'}",
      "",
      "  is-even@1.0.0:",
      "    resolution: {integrity: sha512-mTC8TepVZ+y5Un5TXmMkQr1V2QLBP1g2x5mFkl4dIe4gUxkK5j7J7nZS2JZHF11QHklAiJFJ8rqIXp7HVFCQ==}",
      "    engines: {node: '>=0.10.0'}",
      "",
      "snapshots:",
      "",
      "  is-number@6.0.0: {}",
      "",
      "  is-odd@3.0.0:",
      "    dependencies:",
      "      is-number: 6.0.0",
      "",
      "  is-even@1.0.0: {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * 47. Build #212 regression — package removed from package.json but NOT from
 *     pnpm-lock.yaml → gate exits 1 with a clear fix message.
 *
 * This is the exact scenario that caused Build #212 to fail on EAS:
 * `expo-file-system` was deleted from package.json but pnpm-lock.yaml was not
 * updated.  EAS runs `pnpm install --frozen-lockfile` and rejects the mismatch.
 *
 * pnpm 9.x exits 1 with ERR_PNPM_OUTDATED_LOCKFILE and explains which
 * specifiers were removed, so the gate's existing --frozen-lockfile invocation
 * is sufficient to catch this case without any additional checks.
 *
 * Verification: the test creates a synthetic workspace where package.json
 * declares only `is-odd` while pnpm-lock.yaml still lists `is-even` as a
 * specifier in the importer's dependency map.  pnpm must exit 1 and the gate
 * must propagate that exit code.
 */
test("exits 1 (Build #212 scenario) when a package is removed from package.json but still listed in pnpm-lock.yaml", () => {
  const staleDir = makeStaleLockfileWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: staleDir });
  } finally {
    restore();
    try { fs.rmSync(staleDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (Build #212: stale lockfile entry) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}\n\n` +
    `If pnpm is now tolerating stale lockfile entries in --frozen-lockfile mode, ` +
    `the gate implementation must be updated with an alternative check (e.g. ` +
    `comparing importer dependency counts between package.json and the lockfile).`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 46. EAS build (EAS_BUILD=true) skips the lockfile gate entirely — EAS
 *     natively validates the lockfile; the gate must not double-check it.
 *     We point LOCKFILE_GATE_WORKSPACE_ROOT at a mismatched dir so a
 *     spurious lockfile check would fail.  The gate should still exit 0
 *     (build number 1 → no prior summary required → EAS path exits 0).
 */
test("skips lockfile gate on EAS builds (EAS_BUILD=true)", () => {
  const mismatchDir = makeMismatchedWorkspace();
  let result;
  try {
    result = runGate({
      EAS_BUILD: "true",
      NAV_TIMING_GATE_BUILD_NUMBER: "1", // build 1 → no prior summary required
      LOCKFILE_GATE_WORKSPACE_ROOT: mismatchDir,
    });
  } finally {
    try { fs.rmSync(mismatchDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 0,
    `Expected exit 0 (EAS skips lockfile gate, build 1 skips nav-timing) but got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  // Confirm lockfile gate output is absent from stdout — the gate must not run.
  assert(
    !result.stdout.includes("lockfile gate"),
    `Expected lockfile gate to be skipped on EAS but found gate output: ${result.stdout}`
  );
});

/**
 * Create a temporary workspace where pnpm-workspace.yaml declares a member
 * ("members/new-pkg") that has a package.json on disk but NO corresponding
 * entry in the lockfile's importers section.
 *
 * This reproduces the scenario where a developer adds a new workspace package
 * to pnpm-workspace.yaml and package.json but forgets to run `pnpm install`
 * before pushing — the lockfile is stale and EAS would reject it.
 *
 * Returns the path to the temp directory.
 */
function makeWorkspaceMemberMissingFromLockfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-member-missing-"));

  // Root package.json — no external deps so root importer "." stays empty.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-root", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml — declares one workspace glob.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'members/*'", ""].join("\n"),
    "utf8"
  );

  // Create the workspace member directory and its package.json.
  fs.mkdirSync(path.join(dir, "members", "new-pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "members", "new-pkg", "package.json"),
    JSON.stringify({ name: "@synthetic/new-pkg", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-lock.yaml — has an importer for "." but NOT for "members/new-pkg".
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace whose pnpm-lock.yaml has root-level dependencies
 * declared in its root package.json but no `importers:` section at all.
 *
 * A lockfile without an importers section is malformed with respect to what
 * `pnpm install --frozen-lockfile` expects; the gate must fail closed.
 *
 * Returns the path to the temp directory.
 */
function makeLockfileWithNoImportersSection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-no-importers-"));

  // Root package.json declares a dependency.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "synthetic-no-importers", version: "0.0.0", dependencies: { "is-odd": "^3.0.0" } },
      null,
      2
    ),
    "utf8"
  );

  // pnpm-lock.yaml — valid header and packages section but no importers: key.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "packages:",
      "",
      "  is-odd@3.0.0:",
      "    resolution: {integrity: sha512-fake}",
      "",
      "snapshots:",
      "",
      "  is-odd@3.0.0: {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where pnpm-workspace.yaml declares a catalog
 * entry ("test-lib") at version "^2.0.0", but the lockfile's catalogs.default
 * section still has the old specifier "^1.0.0".
 *
 * This reproduces the scenario where a developer bumps a shared catalog version
 * in pnpm-workspace.yaml without running `pnpm install` — the lockfile is stale
 * and EAS would reject it.  All importer specifiers still show `catalog:` and
 * would not be caught by the per-importer specifier check.
 *
 * Returns the path to the temp directory.
 */
function makeStaleCatalogWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-stale-catalog-"));

  // Root package.json — no external deps so the root importer stays empty.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-catalog-root", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml — declares a catalog entry at the BUMPED version.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - '.'",
      "",
      "catalog:",
      "  test-lib: '^2.0.0'",
      "",
    ].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml — catalogs.default still has the OLD specifier "^1.0.0".
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "catalogs:",
      "  default:",
      "    test-lib:",
      "      specifier: '^1.0.0'",
      "      version: 1.9.9",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where root package.json declares a live pnpm
 * override for "test-pkg" at "3.0.0", but the lockfile's importer for "."
 * still has the OLD override specifier "2.9.0".
 *
 * This reproduces the scenario where a developer changes an override in
 * package.json without running `pnpm install` — the lockfile is stale and
 * EAS would reject it.
 *
 * Returns the path to the temp directory.
 */
function makeStaleOverrideWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-stale-override-"));

  // Root package.json with a direct override at the NEW value.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "synthetic-override-root",
        version: "0.0.0",
        private: true,
        dependencies: { "test-pkg": "^2.0.0" },
        pnpm: { overrides: { "test-pkg": "3.0.0" } }, // live override: 3.0.0
      },
      null,
      2
    ),
    "utf8"
  );

  // pnpm-lock.yaml — importer still has the OLD override specifier "2.9.0".
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "overrides:",
      "  test-pkg: 2.9.0",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      test-pkg:",
      "        specifier: 2.9.0",  // stale — override was changed to 3.0.0 in package.json
      "        version: 2.9.0",
      "",
      "packages:",
      "",
      "  test-pkg@2.9.0:",
      "    resolution: {integrity: sha512-fake}",
      "",
      "snapshots:",
      "",
      "  test-pkg@2.9.0: {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * 48. Workspace member exists in pnpm-workspace.yaml and has a package.json but
 *     is absent from the lockfile importers section → gate exits 1 with a clear
 *     message naming the affected member.
 *
 * This is the scenario where a developer adds a new workspace package
 * (directory + package.json + entry in pnpm-workspace.yaml) but does not run
 * `pnpm install` before pushing.  EAS would reject the build because the
 * lockfile is out of date.
 */
test("exits 1 when a workspace member is absent from the lockfile importers section", () => {
  const missingMemberDir = makeWorkspaceMemberMissingFromLockfile();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: missingMemberDir });
  } finally {
    restore();
    try { fs.rmSync(missingMemberDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (workspace member absent from lockfile) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("members/new-pkg"),
    `Expected stderr to name the missing workspace member but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 49. Lockfile exists but has no `importers:` section → gate exits 1 (fail closed).
 *
 * A lockfile without an importers section is structurally incomplete; the root
 * workspace member (".") is always expected to appear in importers.  pnpm's own
 * `--frozen-lockfile` would also reject such a lockfile.
 */
test("exits 1 when pnpm-lock.yaml exists but has no importers section (fail closed)", () => {
  const noImportersDir = makeLockfileWithNoImportersSection();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: noImportersDir });
  } finally {
    restore();
    try { fs.rmSync(noImportersDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (lockfile has no importers section) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * Create a temporary workspace where the live pnpm-workspace.yaml has a
 * transitive chain override ("micromatch>picomatch") at a NEW value, but the
 * lockfile's top-level `overrides:` section still has the OLD value.
 *
 * This is the canonical "stale transitive override" scenario: no importer
 * specifier changes (the override is purely transitive), so only a comparison
 * of the overrides sections catches it.
 *
 * Returns the path to the temp directory.
 */
function makeStaleTransitiveOverrideWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-stale-transitive-override-"));

  // Root package.json — no direct overrides (override is in workspace yaml).
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-override-root", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml — declares a transitive chain override at the BUMPED value.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - '.'",
      "",
      "overrides:",
      "  micromatch>picomatch: 4.0.5",  // bumped from 4.0.4
      "",
    ].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml — overrides section still has the OLD value "4.0.4".
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "overrides:",
      "  micromatch>picomatch: 4.0.4",   // stale — should be 4.0.5
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where the lockfile importer section records a
 * peerDependency for a workspace member but the package.json does not declare
 * that package in any dependency group.
 *
 * This exercises the "lockfile → package.json" direction of the peerDependencies
 * check: if pnpm stores a peer in the lockfile importer (which it does in some
 * configurations), the gate must verify it appears in the package.json.
 *
 * Returns the path to the temp directory.
 */
function makeLockfileWithPeerDepNotInPackageJson() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-peer-not-in-pkg-"));

  // Root package.json — no dependencies at all.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-peer-root", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-lock.yaml — lockfile records a peerDependency for the root importer
  // that is NOT declared in package.json.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    peerDependencies:",
      "      some-peer:",
      "        specifier: '^1.0.0'",
      "        version: 1.0.0",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * 52. Transitive chain override changed in pnpm-workspace.yaml but the lockfile
 *     `overrides:` section still has the old value → gate exits 1.
 *
 * No importer specifier changes (chain overrides only affect transitive
 * dependency resolution, not the specifier stored per importer).  Only the
 * overrides-section bidirectional comparison catches this staleness.
 */
test("exits 1 when a transitive override value in pnpm-workspace.yaml differs from lockfile overrides section", () => {
  const staleTransDir = makeStaleTransitiveOverrideWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: staleTransDir });
  } finally {
    restore();
    try { fs.rmSync(staleTransDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (stale transitive override: workspace says 4.0.5, lockfile has 4.0.4) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("micromatch") || result.stderr.includes("picomatch"),
    `Expected stderr to name the affected override key but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 53. Lockfile importer records a peerDependency that does not appear in the
 *     package.json under any dependency group → gate exits 1.
 *
 * Some pnpm configurations store peerDependencies in the lockfile importers
 * section.  The gate checks that every entry the lockfile records appears in
 * the package.json (including peerDependencies), so an importer entry that
 * has no corresponding package.json declaration is caught.
 */
test("exits 1 when lockfile importer records a peerDependency absent from package.json", () => {
  const peerMismatchDir = makeLockfileWithPeerDepNotInPackageJson();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: peerMismatchDir });
  } finally {
    restore();
    try { fs.rmSync(peerMismatchDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (lockfile peerDep absent from package.json) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("some-peer"),
    `Expected stderr to name the missing peer package but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 50. Catalog version bumped in pnpm-workspace.yaml but lockfile not yet
 *     regenerated → gate exits 1.
 *
 * All importer specifiers still read `catalog:` (unchanged), so only the
 * catalog-section bidirectional comparison can catch this staleness.
 */
test("exits 1 when catalog version in pnpm-workspace.yaml differs from lockfile catalogs.default", () => {
  const staleCatalogDir = makeStaleCatalogWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: staleCatalogDir });
  } finally {
    restore();
    try { fs.rmSync(staleCatalogDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (stale catalog: workspace says ^2.0.0, lockfile has ^1.0.0) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("catalog") && result.stderr.includes("test-lib"),
    `Expected stderr to name the catalog and package ("test-lib") but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 51. Override value changed in root package.json pnpm.overrides but lockfile
 *     not yet regenerated → gate exits 1.
 *
 * The lockfile importer still shows the old override specifier "2.9.0" while
 * the live package.json override says "3.0.0".
 */
test("exits 1 when live override value in package.json differs from lockfile importer specifier", () => {
  const staleOverrideDir = makeStaleOverrideWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: staleOverrideDir });
  } finally {
    restore();
    try { fs.rmSync(staleOverrideDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (stale override: package.json says 3.0.0, lockfile has 2.9.0) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("test-pkg"),
    `Expected stderr to name the affected package ("test-pkg") but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * Create a temporary workspace where pnpm-workspace.yaml uses a nested wildcard
 * glob ("packages/**") that the lightweight checker cannot fully enumerate.
 * A new workspace member that matches this glob but is absent from the lockfile
 * importers would be silently missed if the checker treated unsupported globs
 * as empty matches (fail-open).
 *
 * The checker must fail closed and emit an actionable error, never silently pass.
 *
 * Returns the path to the temp directory.
 */
function makeWorkspaceWithUnsupportedGlobPattern() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-unsupported-glob-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-unsupported-glob", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml uses a nested "**" wildcard — not supported by the
  // lightweight checker.  Any member matching this glob that is absent from the
  // lockfile would be silently missed if the checker returns empty instead of
  // failing closed.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'packages/**'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml — minimal valid lockfile with only the root importer.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where pnpm-workspace.yaml declares
 * `autoInstallPeers: false` but the lockfile's settings block says
 * `autoInstallPeers: true`.
 *
 * This is the "settings changed but lockfile not regenerated" scenario.
 * `pnpm install --frozen-lockfile` rejects this because the settings
 * mismatch means the lockfile was produced under a different peer-resolution
 * mode than the current configuration.
 *
 * Returns the path to the temp directory.
 */
function makeSettingsMismatchWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-settings-mismatch-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-settings-mismatch", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml — live setting is autoInstallPeers: false
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", "", "autoInstallPeers: false", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml — settings says autoInstallPeers: true (stale lockfile)
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",          // mismatch vs pnpm-workspace.yaml
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where pnpm-workspace.yaml declares
 * `autoInstallPeers: true`, and the root package.json has a peerDependency
 * for "react" that is NOT recorded in the lockfile importer section.
 *
 * When autoInstallPeers is true, pnpm installs peer dependencies as regular
 * dependencies AND records them in the lockfile importers section.  A missing
 * importer entry for an installed peer means the lockfile is stale.
 *
 * Returns the path to the temp directory.
 */
function makeAutoInstallPeersMissingFromLockfileWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-auto-peers-missing-"));

  // Root package.json: declares react as a peerDependency.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "synthetic-auto-peers",
        version: "0.0.0",
        private: true,
        peerDependencies: { react: "^19.0.0" },
      },
      null,
      2
    ),
    "utf8"
  );

  // pnpm-workspace.yaml — autoInstallPeers: true means peers are installed.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", "", "autoInstallPeers: true", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml — lockfile importers section for "." has NO peerDependencies
  // entry even though autoInstallPeers is true (stale lockfile).
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",  // react peerDependency missing from lockfile importer
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where pnpm-workspace.yaml contains a "catalogs:"
 * (plural, named catalogs) block that the lightweight checker cannot validate.
 *
 * Returns the path to the temp directory.
 */
function makeNamedCatalogWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-named-catalog-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-named-catalog", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml uses "catalogs:" (plural) with a named catalog "frontend".
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - '.'",
      "",
      "catalogs:",
      "  frontend:",
      "    react: 19.1.0",
      "",
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "catalogs:",
      "  frontend:",
      "    react:",
      "      specifier: 19.1.0",
      "      version: 19.1.0",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where root package.json has a patchedDependency,
 * and the lockfile has the same dependency recorded but with a STALE hash
 * (the patch file was edited but pnpm install was not re-run).
 *
 * Returns the path to the temp directory.
 */
function makeStalePatchHashWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-stale-patch-hash-"));

  // Create the patches directory and a patch file.
  fs.mkdirSync(path.join(dir, "patches"), { recursive: true });
  const patchContent = "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-old\n+new\n";
  fs.writeFileSync(path.join(dir, "patches", "minimatch@3.1.5.patch"), patchContent, "utf8");

  // Compute the real hash of the patch file.
  const realHash = require("crypto").createHash("sha256").update(patchContent).digest("hex");
  // Use a different (stale) hash in the lockfile — simulates editing the patch without reinstalling.
  const staleHash = "0".repeat(64);

  // Root package.json with pnpm.patchedDependencies.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "synthetic-stale-patch",
        version: "0.0.0",
        private: true,
        pnpm: { patchedDependencies: { "minimatch@3.1.5": "patches/minimatch@3.1.5.patch" } },
      },
      null,
      2
    ),
    "utf8"
  );

  // pnpm-lock.yaml — patchedDependencies section has the OLD (stale) hash.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "patchedDependencies:",
      "  minimatch@3.1.5:",
      `    hash: ${staleHash}`,
      "    path: patches/minimatch@3.1.5.patch",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where a member was removed from the `packages:`
 * list in pnpm-workspace.yaml but the lockfile still has an importer for it.
 *
 * This is the "removed member without regenerating lockfile" scenario.
 * `pnpm install --frozen-lockfile` rejects this because the lockfile contains
 * an importer for a path that is no longer a workspace member.
 *
 * Returns the path to the temp directory.
 */
function makeRemovedMemberWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-removed-member-"));

  // Create the member directory with a package.json (still on disk, but removed from packages:).
  const memberDir = path.join(dir, "packages", "removed-member");
  fs.mkdirSync(memberDir, { recursive: true });
  fs.writeFileSync(
    path.join(memberDir, "package.json"),
    JSON.stringify({ name: "removed-member", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // Root package.json — no pnpm-specific config.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-removed-member", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: packages/removed-member was removed from packages:
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"), // only root, NOT packages/*
    "utf8"
  );

  // pnpm-lock.yaml: still has the removed member as an importer (stale lockfile)
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
      "  packages/removed-member:",     // stale importer — no longer in packages:
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where pnpm-workspace.yaml uses flow-style YAML
 * for the `packages:` key (e.g. `packages: ['.']`) instead of block style.
 *
 * Now that the gate uses a real YAML parser, flow-style sequences are parsed
 * correctly.  This workspace is in sync and the gate should EXIT 0.
 *
 * Returns the path to the temp directory.
 */
function makeFlowStyleYamlWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-flow-style-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-flow-style", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: uses flow-style sequence for packages:.
  // The real YAML parser handles this correctly; it should not fail closed.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    "packages: ['.']\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",   // pnpm default when autoInstallPeers not declared
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a workspace whose pnpm-lock.yaml is malformed YAML
 * (a parse error the real YAML parser will reject) but has enough
 * syntactically correct-looking text that a line scanner might pass it.
 *
 * The gate must fail closed on any YAML parse error in pnpm-lock.yaml.
 *
 * Returns the path to the temp directory.
 */
function makeMalformedLockfileYaml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-malformed-lock-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-malformed-lock", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: syntactically looks OK for a line scanner but is invalid
  // YAML due to a bad flow-node inside the importers block.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      is-odd: {specifier: ^1.0.0, version: 1.0.0",  // unbalanced brace — malformed
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a workspace whose pnpm-lock.yaml has an importers section that is
 * structurally invalid: the dep-group value for an importer is a sequence
 * instead of a mapping.
 *
 * Returns the path to the temp directory.
 */
function makeLockfileImporterTypeMismatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-importer-type-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-importer-type", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: the '.' importer's dependencies is a sequence, not a mapping.
  // This is structurally invalid — the gate must fail closed.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      - specifier: ^1.0.0",   // sequence instead of mapping — structurally invalid
      "        version: 1.0.0",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a workspace whose pnpm-lock.yaml has a trailing malformed YAML node
 * appended after the valid sections.  A line scanner that stops processing
 * sections early (after finding the importers block) would silently pass
 * this file; the real YAML parser must reject it.
 *
 * Returns the path to the temp directory.
 */
function makeLockfileTrailingMalformedNode() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-trailing-bad-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-trailing-bad", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: valid importers section, but a trailing key with an
  // invalid inline-flow value that breaks YAML parsing.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
      // Trailing malformed YAML after the importers section.
      "packages:",
      "  is-odd@1.0.0:",
      "    resolution: {integrity: sha512-BADINPUT",   // unbalanced brace — malformed
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a workspace whose pnpm-workspace.yaml is malformed YAML
 * (a parse error the real YAML parser will reject).
 *
 * The gate must fail closed and exit 1 rather than treating the
 * configuration as absent (which would silently skip all comparisons).
 */
function makeMalformedWorkspaceYaml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-malformed-yaml-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-malformed-yaml", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: invalid YAML (unbalanced brackets)
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    "packages: [unterminated\n  - '.'\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a workspace where pnpm-workspace.yaml has NO autoInstallPeers
 * setting, but root .npmrc has `auto-install-peers=false`.  The lockfile
 * records `autoInstallPeers: true` (stale — was generated before .npmrc was
 * changed).
 *
 * The gate must pick up the .npmrc setting as the effective live value and
 * report a mismatch (exit 1).
 */
function makeNpmrcSettingMismatchWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-npmrc-setting-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-npmrc-setting", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: no autoInstallPeers declaration.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // .npmrc: sets auto-install-peers=false.
  fs.writeFileSync(
    path.join(dir, ".npmrc"),
    "auto-install-peers=false\n",
    "utf8"
  );

  // Lockfile: records autoInstallPeers: true — stale (predates .npmrc change).
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",     // stale — effective live value (from .npmrc) is false
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where `autoInstallPeers: false` was REMOVED from
 * pnpm-workspace.yaml (making the effective value pnpm's default = true) while
 * the lockfile still records `autoInstallPeers: false` (stale).
 *
 * The old implementation only compared settings that were explicitly present in
 * pnpm-workspace.yaml (`if (key in wsSettings)`), so removing the setting would
 * silently skip the comparison and the gate would pass — a concrete false-open.
 * The fix compares every setting unconditionally using effective pnpm defaults.
 *
 * Returns the path to the temp directory.
 */
function makeRemovedSettingWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-removed-setting-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-removed-setting", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: autoInstallPeers NOT present (effective default = true).
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: settings still has autoInstallPeers: false (stale value
  // from when it was explicitly set; now the effective live value is true).
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",   // stale — live effective value is true (pnpm default)
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where `pnpm-workspace.yaml` has a
 * patchedDependencies entry that doesn't match the lockfile (the patch file was
 * replaced / renamed in pnpm-workspace.yaml without regenerating the lockfile).
 *
 * Returns the path to the temp directory.
 */
function makeWsPatchedDepsMismatchWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-ws-patched-mismatch-"));

  // Create the patches directory and patch file.
  fs.mkdirSync(path.join(dir, "patches"), { recursive: true });
  const newPatchContent = "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-old\n+new\n";
  const oldPatchContent = "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-stale\n+content\n";
  // File on disk has the NEW content.
  fs.writeFileSync(path.join(dir, "patches", "is-odd@1.0.0.patch"), newPatchContent, "utf8");
  // Compute the hash of the OLD content (what the lockfile records).
  const staleHash = require("crypto").createHash("sha256").update(oldPatchContent).digest("hex");

  // Root package.json — no pnpm.patchedDependencies (patches come from workspace yaml).
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-ws-patched-mismatch", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // pnpm-workspace.yaml: declares the patch via patchedDependencies:.
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - '.'",
      "",
      "patchedDependencies:",
      "  is-odd@1.0.0: patches/is-odd@1.0.0.patch",
      "",
    ].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: patch recorded with the OLD hash (stale lockfile).
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "patchedDependencies:",
      "  is-odd@1.0.0:",
      `    hash: ${staleHash}`,
      "    path: patches/is-odd@1.0.0.patch",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where a workspace member's package.json exists
 * on disk but is invalid JSON (e.g. corrupted or partially written file).
 *
 * The lockfile has an importer for this member with a real dependency.
 * Because the package.json cannot be parsed, the specifier comparison for that
 * member cannot be validated.  Rather than silently skipping the member (which
 * would allow a stale specifier to pass undetected), the gate must fail closed.
 *
 * Returns the path to the temp directory.
 */
function makeInvalidPkgJsonWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-invalid-pkgjson-"));

  // Root package.json — valid.
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-root", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  // Member directory with an INVALID package.json.
  const memberDir = path.join(dir, "packages", "broken-member");
  fs.mkdirSync(memberDir, { recursive: true });
  fs.writeFileSync(
    path.join(memberDir, "package.json"),
    "{ this is not valid json !!!",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", "  - 'packages/*'", ""].join("\n"),
    "utf8"
  );

  // Lockfile has the broken member as an importer with a real dependency.
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    {}",
      "",
      "  packages/broken-member:",
      "    dependencies:",
      "      is-odd:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where the lockfile has `importers: .`
 * (scalar value instead of a block mapping) — a structurally invalid lockfile.
 *
 * pnpm install --frozen-lockfile would reject this as a malformed lockfile.
 * The gate must also exit 1, detecting that the importers section is absent or
 * invalid rather than silently treating all importers as in sync.
 *
 * Returns the path to the temp directory.
 */
function makeMalformedImporterLockfileWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-malformed-importers-"));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "synthetic-malformed-importers", version: "0.0.0", private: true }, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: importers: scalar instead of block mapping
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "importers: .",  // scalar value — not a valid lockfile structure
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * Create a temporary workspace where a package was moved from `dependencies`
 * to `devDependencies` in package.json, but pnpm install was not re-run.
 * The lockfile still records the package under `dependencies`.
 *
 * This is the group-move false-negative that the flattened comparison missed:
 * both approaches had the package in the same flat set, so no mismatch was
 * detected.  The per-group effective-group algorithm catches it by checking
 * that the lockfile group matches the package's effective package.json group.
 *
 * Returns the path to the temp directory.
 */
function makeGroupMoveWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-group-move-"));

  // package.json: is-odd was moved to devDependencies (no longer in dependencies)
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "synthetic-group-move",
        version: "0.0.0",
        private: true,
        devDependencies: { "is-odd": "^1.0.0" }, // moved here
        // dependencies: {} — no longer listed here
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - '.'", ""].join("\n"),
    "utf8"
  );

  // pnpm-lock.yaml: is-odd is STILL under dependencies (stale lockfile)
  fs.writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: false",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",             // stale — should be devDependencies now
      "      is-odd:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0",
      "",
    ].join("\n"),
    "utf8"
  );

  return dir;
}

/**
 * 57. `autoInstallPeers: false` was REMOVED from pnpm-workspace.yaml (making
 *     the effective pnpm value its default = true) while the lockfile still
 *     records `autoInstallPeers: false` → gate exits 1.
 *
 * The previous implementation guarded settings comparison with
 * `if (key in wsSettings)`, so deleting the setting from the workspace yaml
 * silently skipped the comparison and the gate passed — a concrete false-open.
 * The fix compares all settings unconditionally using effective pnpm defaults.
 */
test("exits 1 when a setting is removed from pnpm-workspace.yaml but the lockfile retains the old value", () => {
  const removedSettingDir = makeRemovedSettingWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: removedSettingDir });
  } finally {
    restore();
    try { fs.rmSync(removedSettingDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (removed autoInstallPeers, lockfile still has false) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("autoInstallPeers"),
    `Expected "autoInstallPeers" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 58. pnpm-workspace.yaml has a patchedDependencies entry whose patch file was
 *     replaced (new content, old hash in lockfile) → gate exits 1.
 *
 * Previously, parseLivePatchedDeps read only from root package.json, so
 * a patch declared in pnpm-workspace.yaml was not validated at all.  Merging
 * both sources ensures workspace-yaml patches are also hash-verified.
 */
test("exits 1 when a pnpm-workspace.yaml patchedDependency hash is stale in the lockfile", () => {
  const wsPatchedDir = makeWsPatchedDepsMismatchWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: wsPatchedDir });
  } finally {
    restore();
    try { fs.rmSync(wsPatchedDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (ws patchedDep hash mismatch) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("is-odd") || result.stderr.includes("patchedDependencies") || result.stderr.includes("hash"),
    `Expected the patch mismatch to be mentioned in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 57. A workspace member's package.json is invalid JSON (corrupted/partially
 *     written) → gate exits 1 (fail closed).
 *
 * The previous implementation silently skipped any importer whose package.json
 * could not be parsed, so a stale or invalid manifest could pass undetected.
 * The gate now fails closed with an error naming the affected member.
 */
test("exits 1 when a workspace member's package.json is unreadable or invalid JSON", () => {
  const invalidPkgDir = makeInvalidPkgJsonWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: invalidPkgDir });
  } finally {
    restore();
    try { fs.rmSync(invalidPkgDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (invalid package.json must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("broken-member") || result.stderr.includes("package.json"),
    `Expected stderr to name the broken member but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 58. Lockfile has `importers: .` (scalar instead of block mapping) — a
 *     structurally invalid lockfile → gate exits 1.
 *
 * A well-formed lockfile must have importers as a block mapping.  A scalar
 * value on the same line as `importers:` means the section is absent (the
 * exact token "importers:" on its own line is not found), which should be
 * caught by the fail-closed importers-absent check.
 */
test("exits 1 when pnpm-lock.yaml has importers as a scalar (importers: .) instead of a block mapping", () => {
  const malformedDir = makeMalformedImporterLockfileWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: malformedDir });
  } finally {
    restore();
    try { fs.rmSync(malformedDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (importers: scalar must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 57. A workspace member was removed from the `packages:` list in
 *     pnpm-workspace.yaml, but the lockfile was NOT regenerated.  The lockfile
 *     still has an importer for the removed member → gate exits 1.
 *
 * This is the false-open path: the previous implementation checked only
 * whether the importer path had a package.json on disk, not whether it was
 * actually selected by the workspace packages: globs.  The package.json still
 * exists on disk after removal from packages:, so the old check passed.
 */
test("exits 1 when a workspace member is removed from packages: but its lockfile importer remains", () => {
  const removedMemberDir = makeRemovedMemberWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: removedMemberDir });
  } finally {
    restore();
    try { fs.rmSync(removedMemberDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (removed member still in lockfile) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("packages/removed-member"),
    `Expected stderr to name the removed importer path but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 59. pnpm-workspace.yaml uses flow-style YAML for `packages:` (e.g.
 *     `packages: ['.']`) — the workspace is in sync → gate exits 0.
 *
 * With a real YAML parser, flow-style sequences are parsed correctly.  The old
 * block-style scanner would have treated the packages list as empty and failed
 * closed.  Now that we use yaml@2.9.0, valid flow-style input is parsed
 * properly and a sync'd workspace should exit 0 regardless of style.
 */
test("exits 0 when pnpm-workspace.yaml uses flow-style YAML for packages: (real parser handles it)", () => {
  const flowStyleDir = makeFlowStyleYamlWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: flowStyleDir });
  } finally {
    restore();
    try { fs.rmSync(flowStyleDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 0,
    `Expected exit 0 (flow-style is valid; workspace is in sync) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
});

/**
 * 59b-lock. pnpm-lock.yaml is malformed YAML (bad flow-node inside importers)
 *           → gate exits 1 (fail closed).
 *
 * A line-scanner approach would stop reading the importers block after the
 * unrecognized token and return partial results (possibly exit 0).  The real
 * YAML parser rejects the whole file and the gate must fail closed.
 */
test("exits 1 (fail closed) when pnpm-lock.yaml is malformed YAML", () => {
  const malformedLockDir = makeMalformedLockfileYaml();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: malformedLockDir });
  } finally {
    restore();
    try { fs.rmSync(malformedLockDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (malformed pnpm-lock.yaml must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 59c-lock. pnpm-lock.yaml has an importers section where a dep-group value
 *           is a sequence instead of a mapping — structurally invalid → exit 1.
 *
 * The YAML parser parses this successfully (it is valid YAML), but the
 * structural type check must catch the wrong type and fail closed.
 */
test("exits 1 (fail closed) when pnpm-lock.yaml has a dep-group value that is a sequence instead of a mapping", () => {
  const typeDir = makeLockfileImporterTypeMismatch();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: typeDir });
  } finally {
    restore();
    try { fs.rmSync(typeDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (sequence instead of mapping in dep group must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 59d-lock. pnpm-lock.yaml has a trailing malformed YAML node after the valid
 *           sections.  A line scanner that exits importers processing early
 *           would pass; the real YAML parser rejects the whole file → exit 1.
 */
test("exits 1 (fail closed) when pnpm-lock.yaml has a trailing malformed YAML node", () => {
  const trailingDir = makeLockfileTrailingMalformedNode();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: trailingDir });
  } finally {
    restore();
    try { fs.rmSync(trailingDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (trailing malformed YAML must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 59b. pnpm-workspace.yaml is malformed YAML (a real parse error) → gate
 *      exits 1 (fail closed).
 *
 * With a real YAML parser, any malformed YAML is caught immediately and
 * treated as a fail-closed error.  The old block-style scanner would silently
 * ignore unparseable lines and treat the configuration as absent, which could
 * allow a stale lockfile to pass undetected.
 */
test("exits 1 (fail closed) when pnpm-workspace.yaml is malformed YAML", () => {
  const malformedYamlDir = makeMalformedWorkspaceYaml();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: malformedYamlDir });
  } finally {
    restore();
    try { fs.rmSync(malformedYamlDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (malformed YAML must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("YAML") || result.stderr.includes("pnpm-workspace"),
    `Expected YAML error context in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 59c. Root .npmrc sets `auto-install-peers=false` but the lockfile records
 *      `autoInstallPeers: true` (stale from before the .npmrc change) → gate
 *      exits 1.
 *
 * pnpm reads settings from multiple sources with a defined precedence:
 *   pnpm-workspace.yaml > .npmrc > pnpm defaults.
 * When autoInstallPeers is absent from pnpm-workspace.yaml, the .npmrc value
 * is authoritative.  A lockfile that disagrees with the .npmrc value would
 * cause `pnpm install --frozen-lockfile` to fail; the gate must agree.
 */
test("exits 1 when .npmrc sets auto-install-peers=false but the lockfile records autoInstallPeers: true", () => {
  const npmrcDir = makeNpmrcSettingMismatchWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: npmrcDir });
  } finally {
    restore();
    try { fs.rmSync(npmrcDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (.npmrc autoInstallPeers mismatch) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("autoInstallPeers"),
    `Expected "autoInstallPeers" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes(".npmrc"),
    `Expected ".npmrc" as the source to be named in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 57. A package was moved from `dependencies` to `devDependencies` in
 *     package.json, but the lockfile was NOT regenerated.  The lockfile still
 *     records the package under `dependencies` → gate exits 1.
 *
 * This is the exact false-negative that the flattened-comparison approach
 * produced: the flat map included the package regardless of which group it
 * came from, so the mismatch was invisible.  The per-group effective-group
 * algorithm detects it by comparing each package's lockfile group against its
 * highest-priority declared group in package.json.
 */
test("exits 1 when a package is moved between dep groups in package.json but the lockfile is not regenerated", () => {
  const groupMoveDir = makeGroupMoveWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: groupMoveDir });
  } finally {
    restore();
    try { fs.rmSync(groupMoveDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (is-odd moved deps→devDeps, lockfile stale) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("is-odd"),
    `Expected stderr to name the mismatched package ("is-odd") but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 58. pnpm-workspace.yaml contains a "catalogs:" (plural, named catalogs) block
 *     → gate exits 1 (fail closed) with an actionable error, rather than
 *     silently passing an incomplete check.
 *
 * Named catalogs cannot be fully validated by the lightweight parser because
 * it only understands the singular "catalog:" default mapping.  Silently
 * passing would allow a stale named-catalog entry to reach EAS.
 */
test("exits 1 (fail closed) when pnpm-workspace.yaml contains a named catalogs block", () => {
  const namedCatalogDir = makeNamedCatalogWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: namedCatalogDir });
  } finally {
    restore();
    try { fs.rmSync(namedCatalogDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (named catalogs must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("named catalog") || result.stderr.includes("catalogs"),
    `Expected "named catalog" or "catalogs" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install") || result.stderr.includes("LOCKFILE_GATE_SKIP"),
    `Expected actionable fix instruction in stderr but got: ${result.stderr}`
  );
});

/**
 * 58. Patch file was edited after pnpm install — lockfile still has the old
 *     hash → gate exits 1.
 *
 * pnpm records a SHA-256 hash of each patch file in the lockfile.  When a
 * patch is edited without re-running pnpm install, the hash becomes stale.
 * The gate catches this by recomputing the hash and comparing.
 */
test("exits 1 when a patchedDependency's patch file was edited and the lockfile hash is stale", () => {
  const stalePatchDir = makeStalePatchHashWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: stalePatchDir });
  } finally {
    restore();
    try { fs.rmSync(stalePatchDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (stale patch hash) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("patchedDependencies") || result.stderr.includes("hash"),
    `Expected "patchedDependencies" or "hash" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 55. autoInstallPeers differs between pnpm-workspace.yaml (live: false) and
 *     the lockfile settings block (stale: true) → gate exits 1.
 *
 * pnpm produces a different lockfile structure depending on the autoInstallPeers
 * setting.  A settings mismatch means the lockfile was generated under a
 * different peer-resolution mode and must be regenerated before pushing.
 */
test("exits 1 when autoInstallPeers setting in pnpm-workspace.yaml differs from lockfile settings", () => {
  const settingsMismatchDir = makeSettingsMismatchWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: settingsMismatchDir });
  } finally {
    restore();
    try { fs.rmSync(settingsMismatchDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (settings mismatch: ws=false, lockfile=true) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("autoInstallPeers"),
    `Expected "autoInstallPeers" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 56. When autoInstallPeers is true, a peerDependency declared in package.json
 *     that is absent from the lockfile importer → gate exits 1.
 *
 * When autoInstallPeers is enabled, pnpm installs and records peers in the
 * lockfile importers section.  A missing importer entry for an auto-installed
 * peer means the lockfile is stale — pnpm frozen-lockfile would reject it.
 */
test("exits 1 when autoInstallPeers is true and a package.json peerDependency is absent from the lockfile importer", () => {
  const autoInstallDir = makeAutoInstallPeersMissingFromLockfileWorkspace();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: autoInstallDir });
  } finally {
    restore();
    try { fs.rmSync(autoInstallDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (autoInstallPeers=true, react peerDep absent from lockfile) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("react"),
    `Expected stderr to name the missing peer package ("react") but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install"),
    `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
  );
});

/**
 * 54. pnpm-workspace.yaml uses a nested "**" wildcard glob that the lightweight
 *     checker cannot enumerate → gate exits 1 (fail closed) with an actionable
 *     error telling the developer to run pnpm install directly.
 *
 * This prevents silent false-negatives where a newly added nested package is
 * missing from the lockfile but the gate would report success because it could
 * not see the package at all.
 */
test("exits 1 (fail closed) when pnpm-workspace.yaml contains an unsupported glob pattern", () => {
  const unsupportedGlobDir = makeWorkspaceWithUnsupportedGlobPattern();
  const restore = replaceWithEmptyDocsDir();
  let result;
  try {
    result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: unsupportedGlobDir });
  } finally {
    restore();
    try { fs.rmSync(unsupportedGlobDir, { recursive: true, force: true }); } catch {}
  }
  assert(
    result.status === 1,
    `Expected exit 1 (unsupported "**" glob must fail closed) but got ${result.status}\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert(
    result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
    `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("unsupported") || result.stderr.includes("not supported"),
    `Expected "unsupported" or "not supported" in stderr but got: ${result.stderr}`
  );
  assert(
    result.stderr.includes("pnpm install") || result.stderr.includes("LOCKFILE_GATE_SKIP"),
    `Expected actionable fix instruction in stderr but got: ${result.stderr}`
  );
});

/**
 * 59e-lock. pnpm-lock.yaml is syntactically valid YAML and the importer
 *           specifier matches package.json, but the importer's resolved
 *           `version` field has no corresponding entry in packages or
 *           snapshots → gate exits 1 (fail closed).
 *
 * This is exactly the scenario pnpm reports as
 * ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY.  A specifier-only check would pass
 * this file; the packages/snapshots coverage check must catch it.
 */
test("exits 1 when lockfile importer version has no packages/snapshots entry (ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY scenario)", () => {
  const missingPkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-missing-pkg-"));
  try {
    fs.writeFileSync(
      path.join(missingPkgDir, "package.json"),
      JSON.stringify({
        name: "synthetic-missing-pkg",
        version: "0.0.0",
        private: true,
        dependencies: { "is-odd": "^1.0.0" },
      }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(missingPkgDir, "pnpm-workspace.yaml"),
      ["packages:", "  - '.'", ""].join("\n"),
      "utf8"
    );

    // pnpm-lock.yaml: importer specifier matches package.json (^1.0.0),
    // and the importer records resolved version 1.0.0 — but the packages
    // and snapshots sections have NO entry for is-odd@1.0.0.
    // This is syntactically valid YAML; only the resolution graph check
    // can detect the missing entry.
    fs.writeFileSync(
      path.join(missingPkgDir, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "settings:",
        "  autoInstallPeers: true",
        "  excludeLinksFromLockfile: false",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      is-odd:",
        "        specifier: ^1.0.0",
        "        version: 1.0.0",
        "",
        // packages: and snapshots: sections exist but do NOT contain is-odd@1.0.0.
        // A specifier-only check would exit 0; the resolution check must exit 1.
        "packages:",
        "  some-other-pkg@2.0.0:",
        "    resolution: {integrity: sha512-AAAA==}",
        "",
        "snapshots:",
        "  some-other-pkg@2.0.0: {}",
        "",
      ].join("\n"),
      "utf8"
    );

    const restore = replaceWithEmptyDocsDir();
    let result;
    try {
      result = runGate({ LOCKFILE_GATE_WORKSPACE_ROOT: missingPkgDir });
    } finally {
      restore();
    }

    assert(
      result.status === 1,
      `Expected exit 1 (missing packages/snapshots entry must be caught) but got ${result.status}\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
    assert(
      result.stderr.includes("lockfile gate") && result.stderr.includes("out of sync"),
      `Expected "lockfile gate … out of sync" in stderr but got: ${result.stderr}`
    );
    assert(
      result.stderr.includes("is-odd"),
      `Expected dep name "is-odd" in the error output but got: ${result.stderr}`
    );
    assert(
      result.stderr.includes("packages/snapshots"),
      `Expected "packages/snapshots" in the error output but got: ${result.stderr}`
    );
    assert(
      result.stderr.includes("pnpm install"),
      `Expected fix instruction "pnpm install" in stderr but got: ${result.stderr}`
    );
  } finally {
    try { fs.rmSync(missingPkgDir, { recursive: true, force: true }); } catch {}
  }
});

// ── runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
