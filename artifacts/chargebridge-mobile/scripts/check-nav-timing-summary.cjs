#!/usr/bin/env node
/**
 * check-nav-timing-summary.cjs
 *
 * Verifies that a nav-timing feedback summary document is fully populated
 * before the next EAS build is triggered (RELEASE-CHECKLIST.md §3a).
 *
 * Usage:
 *   node scripts/check-nav-timing-summary.cjs <path-to-summary>
 *
 * Example:
 *   node scripts/check-nav-timing-summary.cjs \
 *     docs/nav-timing-feedback-summary-build-207.md
 *
 * Exit codes:
 *   0 — summary is complete (no unfilled placeholders, no unresolved regressions)
 *   1 — summary is incomplete; details printed to stderr
 *
 * Checks applied:
 *   A. Any TABLE DATA row (not header, not separator, not prose) containing a
 *      *(fill in)* or *(paste)* placeholder is flagged as unfilled.
 *
 *   B. For every ### result subsection, ALL referenced task refs (from
 *      "Related task(s):" lines) must appear in the Regression Status table
 *      with non-blank, non-placeholder evidence — unconditionally, regardless
 *      of whether any result rows show ❌ or ✅.  A task that is simply absent
 *      from the Regression Status table is also flagged.
 *
 *   C. A ❌ in a result-section data row is evaluated against only THAT
 *      subsection's own related task refs.  All of those refs must be triaged.
 *
 *   D. A ❌ in the Regression Status table row itself is acceptable when the
 *      first cell contains a task ref (#NNN) — that means the regression was
 *      filed.  A ❌ in a Regression Status row with no task ref is flagged.
 *
 *   Prose lines, blockquotes, table separator rows, and table header rows
 *   are never inspected for ❌ (avoids false positives on instructional text
 *   such as "If any row contains a ❌ …").
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI ────────────────────────────────────────────────────────────────────

function die(msg) {
  process.stderr.write(`\n❌  ${msg}\n\n`);
  process.exit(1);
}

const [, , filePath] = process.argv;

if (!filePath) {
  die(
    "Usage: node scripts/check-nav-timing-summary.cjs <path-to-summary>\n" +
      "  e.g. node scripts/check-nav-timing-summary.cjs \\\n" +
      "         docs/nav-timing-feedback-summary-build-207.md"
  );
}

const absPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(absPath)) die(`File not found: ${absPath}`);

const raw = fs.readFileSync(absPath, "utf8");

// ── Constants ──────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\*\(fill in\)\*|\*\(paste\)\*/i;
const TABLE_SEPARATOR_RE = /^\|[\s\-:|]+\|?\s*$/;

// ── Low-level line helpers ─────────────────────────────────────────────────

/** True for any line that is a markdown table row (not a separator). */
function isTableRow(line) {
  const t = line.trim();
  return t.startsWith("|") && !TABLE_SEPARATOR_RE.test(t);
}

/** Split a markdown table row into trimmed cells. */
function splitCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

// ── Document parsing ───────────────────────────────────────────────────────

/**
 * Parse the raw markdown into a list of blocks.  Each block is either a
 * ##-level section or a ###-level subsection (nested within its parent).
 *
 *   Section  { kind:'section',    heading, subsections, lines }
 *   Subsection { kind:'subsection', heading, parentHeading, lines }
 *
 * Each line entry:  { raw, num (1-based), kind }
 *   kind: 'prose' | 'table-header' | 'table-data' | 'separator'
 */
function parseDocument(text) {
  const rawLines = text.split("\n");

  // Pre-compute which line indices are table headers (the row immediately
  // before a table separator).
  const headerLineIndices = new Set();
  for (let i = 0; i < rawLines.length - 1; i++) {
    for (let j = i + 1; j < rawLines.length; j++) {
      const next = rawLines[j].trim();
      if (next === "") continue;
      if (TABLE_SEPARATOR_RE.test(next) && rawLines[i].trim().startsWith("|")) {
        headerLineIndices.add(i);
      }
      break;
    }
  }

  function lineKind(line, idx) {
    const t = line.trim();
    if (!t.startsWith("|")) return "prose";
    if (TABLE_SEPARATOR_RE.test(t)) return "separator";
    if (headerLineIndices.has(idx)) return "table-header";
    return "table-data";
  }

  const sections = [];
  let currentSection = null;
  let currentSubsection = null;

  function closeSubsection() {
    if (currentSubsection && currentSection) {
      currentSection.subsections.push(currentSubsection);
      currentSubsection = null;
    }
  }

  function closeSection() {
    closeSubsection();
    if (currentSection) sections.push(currentSection);
    currentSection = null;
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    if (/^## /.test(line)) {
      closeSection();
      currentSection = {
        kind: "section",
        heading: line.slice(3).trim(),
        subsections: [],
        lines: [],
      };
      continue;
    }

    if (/^### /.test(line)) {
      closeSubsection();
      if (!currentSection) {
        currentSection = {
          kind: "section",
          heading: "__preamble__",
          subsections: [],
          lines: [],
        };
      }
      currentSubsection = {
        kind: "subsection",
        heading: line.slice(4).trim(),
        parentHeading: currentSection.heading,
        lines: [],
      };
      continue;
    }

    const entry = { raw: line, num: i + 1, kind: lineKind(line, i) };
    if (currentSubsection) {
      currentSubsection.lines.push(entry);
    } else if (currentSection) {
      currentSection.lines.push(entry);
    }
  }

  closeSection();
  return sections;
}

// ── Regression Status table ────────────────────────────────────────────────

/**
 * Build a map from task ref string (e.g. "#672") to { triaged: boolean }.
 * triaged = true when evidence column is non-empty and not a placeholder.
 */
function buildRegressionMap(sections) {
  const map = new Map();

  const regSection = sections.find((s) =>
    s.heading.toLowerCase().includes("regression status")
  );
  if (!regSection) return map;

  let evidenceColIdx = -1;
  let headerSeen = false;

  // The Regression Status table lives in section.lines (no ### subsection)
  for (const { raw, kind } of regSection.lines) {
    if (kind === "table-header") {
      const cells = splitCells(raw);
      evidenceColIdx = cells.findIndex((c) => /evidence/i.test(c));
      headerSeen = true;
      continue;
    }
    if (kind !== "table-data" || !headerSeen) continue;

    const cells = splitCells(raw);
    const firstCell = cells[0] || "";
    const refMatch = firstCell.match(/#\d+/);
    if (!refMatch) continue;

    const ref = refMatch[0];
    const evidenceCell =
      evidenceColIdx >= 0 ? cells[evidenceColIdx] || "" : "";
    const triaged =
      evidenceCell.length > 0 && !PLACEHOLDER_RE.test(evidenceCell);

    map.set(ref, { triaged });
  }

  return map;
}

// ── Related task ref extraction ────────────────────────────────────────────

/**
 * Extract task refs from "Related task(s):" prose lines within a block's
 * own line list.
 */
function extractRelatedRefs(lines) {
  const refs = new Set();
  for (const { raw } of lines) {
    if (/related task/i.test(raw)) {
      for (const m of raw.matchAll(/#(\d+)/g)) refs.add(`#${m[1]}`);
    }
  }
  return refs;
}

// ── Main checks ────────────────────────────────────────────────────────────

function runChecks(sections, regressionMap) {
  const problems = [];

  for (const section of sections) {
    const isRegressionSection = section.heading
      .toLowerCase()
      .includes("regression status");

    // ── A. Placeholder check in the section's own (non-subsection) lines ──
    for (const { raw, num, kind } of section.lines) {
      if (kind !== "table-data") continue;
      if (splitCells(raw).some((c) => PLACEHOLDER_RE.test(c))) {
        problems.push(
          `  Line ${num}: unfilled placeholder — ${raw.trim()}`
        );
        continue;
      }

      // D. ❌ in Regression Status data row without a task ref
      if (isRegressionSection && raw.includes("❌")) {
        const cells = splitCells(raw);
        if (!/#\d+/.test(cells[0] || "")) {
          problems.push(
            `  Line ${num}: ❌ in Regression Status table without a linked task ref — ${raw.trim()}`
          );
        }
      }
    }

    // ── Per-### subsection checks ──────────────────────────────────────────
    for (const sub of section.subsections) {
      const relatedRefs = extractRelatedRefs(sub.lines);

      // B. Unconditional: every related task ref must be in Regression Status
      //    with non-blank, non-placeholder evidence.
      for (const ref of relatedRefs) {
        if (!regressionMap.has(ref)) {
          problems.push(
            `  Subsection "${sub.heading}": Regression Status table has no entry for ${ref} — all related tasks must be triaged before the next build`
          );
        } else if (!regressionMap.get(ref).triaged) {
          // Evidence is placeholder/empty — also caught by Check A for the
          // specific table row, but flag here too to name the subsection.
          problems.push(
            `  Subsection "${sub.heading}": ${ref} has an unfilled evidence cell in the Regression Status table`
          );
        }
      }

      // A + C. Table data row checks within this subsection
      for (const { raw, num, kind } of sub.lines) {
        if (kind !== "table-data") continue;

        const cells = splitCells(raw);

        // A. Placeholder in any cell
        if (cells.some((c) => PLACEHOLDER_RE.test(c))) {
          problems.push(
            `  Line ${num}: unfilled placeholder — ${raw.trim()}`
          );
          continue;
        }

        // C. ❌ in a result row: all of THIS subsection's related refs must
        //    be triaged (not just any ref across the whole document).
        if (raw.includes("❌") && relatedRefs.size > 0) {
          const untriagedRefs = [...relatedRefs].filter((ref) => {
            const entry = regressionMap.get(ref);
            return !entry || !entry.triaged;
          });
          if (untriagedRefs.length > 0) {
            problems.push(
              `  Line ${num}: unresolved ❌ — task(s) ${untriagedRefs.join(", ")} not yet triaged in Regression Status table — ${raw.trim()}`
            );
          }
        }
      }
    }
  }

  return problems;
}

// ── Entry point ────────────────────────────────────────────────────────────

const sections = parseDocument(raw);
const regressionMap = buildRegressionMap(sections);
const problems = runChecks(sections, regressionMap);

// Deduplicate (the unconditional subsection check and the row-level placeholder
// check can both fire for the same evidence cell; keep the more informative one)
const seen = new Set();
const unique = problems.filter((p) => {
  // Normalise away the line number prefix for dedup purposes when a subsection
  // message covers the same underlying issue as a row-level message.
  const key = p.replace(/Line \d+: /, "").trim();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

if (unique.length === 0) {
  process.stdout.write(
    `✅  ${path.basename(filePath)} — summary is complete, no blockers found.\n`
  );
  process.exit(0);
} else {
  process.stderr.write(
    `\n❌  ${path.basename(filePath)} — summary is NOT complete.\n` +
      `    Resolve the following before triggering the next build:\n\n` +
      unique.join("\n") +
      "\n\n"
  );
  process.exit(1);
}
