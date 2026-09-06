/**
 * check-nav-timing-summary.test.cjs
 *
 * Tests for scripts/check-nav-timing-summary.cjs using Node's built-in
 * `assert` and `child_process.spawnSync` — no extra test runner needed.
 *
 * Run:
 *   node scripts/__tests__/check-nav-timing-summary.test.cjs
 *
 * Each test calls the script with a fixture file and asserts the expected
 * exit code.  Prints a summary at the end; exits 1 if any test fails.
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

// ── helpers ────────────────────────────────────────────────────────────────

const SCRIPT = path.resolve(__dirname, "..", "check-nav-timing-summary.cjs");
const FIXTURES = path.resolve(__dirname, "fixtures");

function fix(name) {
  return path.join(FIXTURES, name);
}

function run(fixturePath) {
  const result = spawnSync(process.execPath, [SCRIPT, fixturePath], {
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
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
 * 1. A fully populated summary (no placeholders, no unresolved ❌) must exit 0.
 */
test("exits 0 for a fully populated summary", () => {
  const { code, stdout } = run(fix("complete-summary.md"));
  assert(code === 0, `Expected exit 0 but got ${code}`);
  assert(stdout.includes("✅"), `Expected ✅ in stdout but got: ${stdout}`);
});

/**
 * 2. A summary with *(fill in)* and *(paste)* cells must exit 1 and name the
 *    unfilled lines.
 */
test("exits 1 when table cells contain *(fill in)* or *(paste)*", () => {
  const { code, stderr } = run(fix("unfilled-placeholder.md"));
  assert(code === 1, `Expected exit 1 but got ${code}`);
  assert(
    stderr.includes("unfilled placeholder"),
    `Expected 'unfilled placeholder' in stderr but got: ${stderr}`
  );
});

/**
 * 3. Instructional prose containing ❌ (e.g. "If any row contains a ❌…")
 *    must NOT trigger a failure — only table data rows are checked.
 */
test("does not flag ❌ in instructional prose (no false positive)", () => {
  const { code } = run(fix("instructional-prose-cross.md"));
  assert(code === 0, `Expected exit 0 but got ${code} — prose ❌ was incorrectly flagged`);
});

/**
 * 4. A ❌ in a result table row where the related task IS triaged in the
 *    Regression Status table (evidence filled) must exit 0.
 *    This is the "filed/linked blocker" case.
 */
test("exits 0 when ❌ result row has a filed/linked blocker in Regression Status", () => {
  const { code, stderr } = run(fix("cross-filed-regression.md"));
  assert(
    code === 0,
    `Expected exit 0 (regression is filed) but got ${code}.\nstderr: ${stderr}`
  );
});

/**
 * 5. A ❌ in a result table row where the related task is NOT yet triaged
 *    (evidence still *(fill in)*) must exit 1 as an unresolved regression.
 */
test("exits 1 when ❌ result row has no triaged entry in Regression Status", () => {
  const { code, stderr } = run(fix("unresolved-regression.md"));
  assert(code === 1, `Expected exit 1 but got ${code}`);
  assert(
    stderr.includes("unresolved") || stderr.includes("unfilled"),
    `Expected 'unresolved' or 'unfilled' in stderr but got: ${stderr}`
  );
});

/**
 * 6. A ❌ in the Regression Status table itself is acceptable when the first
 *    cell contains a task ref (#NNN) — the task was filed.
 *    (Covered by the cross-filed-regression fixture which has ❌ in evidence.)
 */
test("exits 0 when Regression Status row has ❌ evidence but a valid task ref", () => {
  const { code, stderr } = run(fix("cross-filed-regression.md"));
  assert(
    code === 0,
    `Expected exit 0 (task ref present) but got ${code}.\nstderr: ${stderr}`
  );
});

/**
 * 7. A ❌ in the Regression Status table row WITHOUT a task ref must exit 1.
 */
test("exits 1 when Regression Status row has ❌ but no linked task ref", () => {
  const { code, stderr } = run(fix("regression-status-cross-no-ref.md"));
  assert(code === 1, `Expected exit 1 but got ${code}`);
  assert(
    stderr.includes("Regression Status") || stderr.includes("task ref"),
    `Expected task-ref error in stderr but got: ${stderr}`
  );
});

/**
 * 8. A section with MULTIPLE related tasks where only ONE task has been triaged
 *    in Regression Status (the other still has *(fill in)*) must exit 1.
 *    This prevents a ✅-evidence entry for a sibling task from masking an
 *    untriaged regression.
 */
test("exits 1 when a section has ❌ and only some related tasks are triaged", () => {
  const { code, stderr } = run(fix("partial-triage-section.md"));
  assert(
    code === 1,
    `Expected exit 1 (partial triage is not enough) but got ${code}.\nstderr: ${stderr}`
  );
  assert(
    stderr.includes("#704"),
    `Expected untriaged task #704 to be named in stderr but got: ${stderr}`
  );
});

/**
 * 9. All result rows are ✅ but a related task ref has NO entry at all in the
 *    Regression Status table → exits 1 (unconditional check).
 */
test("exits 1 when a related task has no Regression Status entry even with all-✅ results", () => {
  const { code, stderr } = run(fix("missing-regression-entry.md"));
  assert(
    code === 1,
    `Expected exit 1 (missing Regression Status entry) but got ${code}.\nstderr: ${stderr}`
  );
  assert(
    stderr.includes("#672") || stderr.includes("no entry"),
    `Expected missing-entry error for #672 in stderr but got: ${stderr}`
  );
});

/**
 * 10. All result rows are ✅ but a related task's Regression Status evidence
 *     cell is still *(fill in)* (blank/placeholder) → exits 1 (unconditional check).
 */
test("exits 1 when a Regression Status evidence cell is still a placeholder despite all-✅ results", () => {
  const { code, stderr } = run(fix("blank-regression-evidence.md"));
  assert(
    code === 1,
    `Expected exit 1 (blank evidence) but got ${code}.\nstderr: ${stderr}`
  );
  assert(
    stderr.includes("#672") || stderr.includes("unfilled") || stderr.includes("placeholder"),
    `Expected unfilled-evidence error for #672 in stderr but got: ${stderr}`
  );
});

/**
 * 11. A missing file must exit 1 with a clear error message.
 */
test("exits 1 for a missing file", () => {
  const { code, stderr } = run(fix("does-not-exist.md"));
  assert(code === 1, `Expected exit 1 but got ${code}`);
  assert(
    stderr.includes("not found") || stderr.includes("File not found"),
    `Expected 'not found' in stderr but got: ${stderr}`
  );
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
